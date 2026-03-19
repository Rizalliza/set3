'use strict';
require('dotenv').config();

const fs = require('fs');
const { Connection } = require('@solana/web3.js');

const path = require('path');
const { PublicKey } = require('@solana/web3.js');
const Decimal = require('decimal.js');
//const { fetchWithRetry } = require("../tools/fetch_pools_batch.js");
const CPMM = require('@raydium-io/raydium-sdk-v2');
const { loadPoolsFromAny } = require('../utils/poolLoader.js');


/**
 * CPMM quoter aligned to Q-dlmm.js structure.
 *
 * Requires reserves (x/y) from poolData (ideally from poolFetch enrich).
 * Will FAIL FAST if reserves are missing/zero, to avoid fake "profitable" quotes.
 */
try {

  const Keypair = path.join(__dirname, './../keyPair/solflare_keypair.json');
  const keypairData = JSON.parse(fs.readFileSync(Keypair, 'utf8'));
  this.wallet = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  const wallet = wallet.PublicKey;
} catch (error) {
  throw new Error('Failed to load wallet keypair: ' + error.message);
}

function ensure(cond, msg) { if (!cond) throw new Error(msg); }

function makeAmount({ mint, decimals, atomic }) {
  ensure(mint, 'mint required');
  ensure(Number.isInteger(decimals) && decimals >= 0, 'decimals required');
  // atomic as string to avoid BigInt/JSON pain
  ensure(atomic !== undefined && atomic !== null, 'atomic required');
  return { mint: mint.toString(), decimals, atomic: atomic.toString() };
}

function addFeeToLedger(ledger, feeAmt) {
  // ledger: Map<string, bigint> or plain object of strings
  const mint = feeAmt.mint;
  const a = BigInt(feeAmt.atomic);
  ledger[mint] = (ledger[mint] ? (BigInt(ledger[mint]) + a) : a).toString();
  return ledger;
}
function toDec(v) {
  if (v instanceof Decimal) return v;
  if (v === undefined || v === null) return new Decimal(0);
  return new Decimal(v.toString());
}
const PRICE_DEBUG = ['1', 'true', 'yes'].includes(String(process.env.PRICE_DEBUG || '').toLowerCase());
function debugPriceSource(pool, price, source) {
  if (!PRICE_DEBUG) return;
  const p = price instanceof Decimal ? price : toDec(price);
  if (!p.isFinite()) return;
  const poolId = pool.poolAddress || pool.address || pool.id || pool.pubkey || 'unknown';
  const dex = pool.dex || pool.dexType || 'raydium';
  const type = pool.type || pool.poolType || 'cpmm';
  console.log(`[PRICE_DEBUG] ${dex} ${type} ${poolId}: ${p.toFixed(6)} from ${source}`);
}
function toHuman(atomicStr, decimals) {
  return toDec(atomicStr).div(Decimal.pow(10, decimals));
}

// Lightweight, synchronous CPMM quote for rankers (no RPC)
function quoteCpmmSwap(pool, inAmountAtomic, swapForY = true, slippageBps = 50) {
  try {
    const x = toDec(pool.xReserve ?? pool.baseReserve ?? pool.reserve_x ?? pool.raw?.reserve_x ?? 0);
    const y = toDec(pool.yReserve ?? pool.quoteReserve ?? pool.reserve_y ?? pool.raw?.reserve_y ?? 0);
    if (x.lte(0) || y.lte(0)) return { valid: false, reason: 'cpmm-no-reserves' };
    debugPriceSource(pool, y.div(x), 'reserves');

    const feeBps = Number(
      pool.feeBps ?? pool.fee_bps ?? (typeof pool.fee === 'number' ? pool.fee * 10000 : 25)
    );
    const feeRate = new Decimal(feeBps).div(10000);

    const inAmt = toDec(inAmountAtomic);
    if (inAmt.lte(0)) return { valid: false, reason: 'cpmm-bad-inAmount' };

    const inAfterFee = inAmt.mul(new Decimal(1).minus(feeRate));
    const out = swapForY
      ? inAfterFee.mul(y).div(x.add(inAfterFee))
      : inAfterFee.mul(x).div(y.add(inAfterFee));

    const slip = new Decimal(slippageBps).div(10000);
    const minOut = out.mul(new Decimal(1).minus(slip)).floor();

    return {
      valid: true,
      outAmountAtomic: out.floor().toFixed(0),
      minOutAtomic: minOut.toFixed(0),
      feeBps,
      priceImpact: 0,
    };
  } catch (e) {
    return { valid: false, reason: 'cpmm-error', error: e?.message || String(e) };
  }
}

function attachTypedToCpmmQuote(q, { inMint, outMint, inDecimals, outDecimals }) {
  // q has inAmountRaw/outAmountRaw/minOutAmountRaw already
  q.typed = {
    in: makeAmount({ mint: inMint, decimals: inDecimals, atomic: q.inAmountRaw }),
    out: makeAmount({ mint: outMint, decimals: outDecimals, atomic: q.outAmountRaw }),
    minOut: makeAmount({ mint: outMint, decimals: outDecimals, atomic: q.minOutAmountRaw }),
    // Only include fee here if you have a reliable fee amount + fee mint.
    // Otherwise: store feeRateBps and let fee be "unknown" until you compute it correctly.
    fee: null,
    feeRateBps: q.feeBps ?? null
  };

  // Hard assertions (safety rails)
  if (q.typed.in.atomic !== q.inAmountRaw.toString()) throw new Error('typed.in.atomic mismatch');
  if (q.typed.out.atomic !== q.outAmountRaw.toString()) throw new Error('typed.out.atomic mismatch');
  if (q.typed.minOut.atomic !== q.minOutAmountRaw.toString()) throw new Error('typed.minOut.atomic mismatch');

  return q;
}
class CPMMAdapter {
  constructor(connection, poolAddress = null, poolData = null) {
    this.connection = connection || new Connection(
      process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    this.poolAddress = poolAddress
      ? (poolAddress instanceof PublicKey ? poolAddress : new PublicKey(poolAddress))
      : null;
    this.poolData = poolData || {};

    const pd = this.poolData;

    this.tokenXMint = pd.baseMint || pd.mintA || pd.raw?.mintA || pd.raw?.mint_a || pd.mint_x || pd.raw?.mint_x || null;
    this.tokenYMint = pd.quoteMint || pd.mintB || pd.raw?.mintB || pd.raw?.mint_b || pd.mint_y || pd.raw?.mint_y || null;

    this.tokenXDecimals = pd.baseDecimals ?? pd.decimalsA ?? pd.raw?.baseDecimals ?? pd.raw?.decimalsA ?? pd.decA ?? null;
    this.tokenYDecimals = pd.quoteDecimals ?? pd.decimalsB ?? pd.raw?.quoteDecimals ?? pd.raw?.decimalsB ?? pd.decB ?? null;

    this.feeBps = pd.feeBps ?? pd.fee_bps ?? pd.raw?.feeBps ?? 25;

    // Reserves may be in many forms
    this.xReserveRaw = pd.xReserve ?? pd.baseReserve ?? pd.reserve_x ?? pd.raw?.reserve_x ?? pd.raw?.baseReserve ?? null;
    this.yReserveRaw = pd.yReserve ?? pd.quoteReserve ?? pd.reserve_y ?? pd.raw?.reserve_y ?? pd.raw?.quoteReserve ?? null;
  }

  async init() { return this; }

  _normalizeQuote({ inAmountAtomic, outAmountAtomic, minOutAtomic, swapForY, executionPrice, priceImpact }) {
    const inDecimals = swapForY ? this.tokenXDecimals : this.tokenYDecimals;
    const outDecimals = swapForY ? this.tokenYDecimals : this.tokenXDecimals;
    ensure(Number.isInteger(inDecimals) && Number.isInteger(outDecimals), 'CPMMAdapter missing token decimals');

    const inHuman = toHuman(inAmountAtomic, inDecimals);
    const outHuman = toHuman(outAmountAtomic, outDecimals);
    const minOutHuman = toHuman(minOutAtomic, outDecimals);

    const execPx = executionPrice != null
      ? Number(executionPrice)
      : (inHuman.gt(0) ? outHuman.div(inHuman).toNumber() : 0);

    return {
      inAmountRaw: String(inAmountAtomic),
      outAmountRaw: String(outAmountAtomic),
      minOutAmountRaw: String(minOutAtomic),

      inAmountDecimal: inHuman.toNumber(),
      outAmountDecimal: outHuman.toNumber(),
      minOutAmountDecimal: minOutHuman.toNumber(),

      executionPrice: execPx,
      priceImpact: Number(priceImpact ?? 0),
      fee: Number(this.feeBps) / 10000,

      poolAddress: this.poolAddress ? this.poolAddress.toBase58() : '',
      dexType: 'RAYDIUM_CPMM',
      swapForY: Boolean(swapForY),

      success: true,
      error: null
    };
  }

  async quoteFastExactIn(inAmountAtomic, swapForY = true, slippageBps = 50) {
    return this.quoteExactIn(inAmountAtomic, swapForY, slippageBps);
  }

  async quoteExactIn(inAmountAtomic, swapForY = true, slippageBps = 50) {
    if (!inAmountAtomic || BigInt(inAmountAtomic.toString()) <= 0n) {
      return { success: false, error: 'inAmountAtomic must be > 0' };
    }
    const xR = this.xReserveRaw;
    const yR = this.yReserveRaw;
    ensure(xR != null && yR != null, 'CPMM reserves missing (run enrich reserves first)');
    const x = toDec(xR);
    const y = toDec(yR);
    ensure(x.gt(0) && y.gt(0), 'CPMM reserves are zero (cannot quote)');

    const inAmt = toDec(inAmountAtomic);
    ensure(inAmt.gt(0), 'inAmountAtomic must be > 0');

    const feeRate = new Decimal(this.feeBps).div(10000);
    const oneMinusFee = new Decimal(1).minus(feeRate);

    let out;
    if (swapForY) {
      // X -> Y
      const inAfterFee = inAmt.mul(oneMinusFee);
      out = inAfterFee.mul(y).div(x.add(inAfterFee));
    } else {
      // Y -> X
      const inAfterFee = inAmt.mul(oneMinusFee);
      out = inAfterFee.mul(x).div(y.add(inAfterFee));
    }

    // slippage on output
    const slip = new Decimal(slippageBps).div(10000);
    const minOut = out.mul(new Decimal(1).minus(slip)).floor();

    // mid price (ui) for priceImpact
    const xDec = this.tokenXDecimals;
    const yDec = this.tokenYDecimals;
    ensure(Number.isInteger(xDec) && Number.isInteger(yDec), 'CPMMAdapter missing decimals for midPrice');

    const xUi = x.div(Decimal.pow(10, xDec));
    const yUi = y.div(Decimal.pow(10, yDec));
    const midPrice = xUi.gt(0) ? yUi.div(xUi) : new Decimal(0);

    // execution price (ui)
    const inDec = swapForY ? xDec : yDec;
    const outDec = swapForY ? yDec : xDec;

    const inUi = inAmt.div(Decimal.pow(10, inDec));
    const outUi = out.div(Decimal.pow(10, outDec));
    const execPrice = inUi.gt(0) ? outUi.div(inUi) : new Decimal(0);

    const priceImpact = (midPrice.gt(0) && execPrice.gt(0))
      ? midPrice.minus(execPrice).abs().div(midPrice).toNumber()
      : 0;


    return this._normalizeQuote({
      inAmountAtomic: inAmt.toFixed(0),
      outAmountAtomic: out.floor().toFixed(0),
      minOutAtomic: minOut.toFixed(0),
      swapForY,
      executionPrice: execPrice.toNumber(),
      priceImpact
    });
  }
}

module.exports = CPMMAdapter;
module.exports.CPMMAdapter = CPMMAdapter;
module.exports.quoteCpmmSwap = quoteCpmmSwap;
module.exports.makeAmount = makeAmount;
module.exports.addFeeToLedger = addFeeToLedger;
module.exports.attachTypedToCpmmQuote = attachTypedToCpmmQuote;


if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    // Arg 0: Input source (file path) OR Pool Address OR Output file (if old usage)
    // Arg 1: Amount
    // Arg 2: Output file (optional)

    let poolAddress;
    let amount = '1000000000';
    let outputFile = 'in/results_CPMM.json';
    let poolData = null;

    // Heuristic argument parsing
    const arg0 = args[0];
    const arg1 = args[1];
    const arg2 = args[2];

    const normalizePools = (raw) => {
      if (Array.isArray(raw)) return raw;
      if (raw?.pools) return raw.pools;
      if (raw?.data) return raw.data;
      return Object.values(raw || {});
    };

    try {
      if (arg0 && fs.existsSync(arg0) && fs.lstatSync(arg0).isFile()) {
        // First arg is a file -> Input Source
        console.log(`Loading pools from ${arg0}...`);
        const raw = JSON.parse(fs.readFileSync(arg0, 'utf8'));
        const pools = await loadPoolsFromAny(raw);
        const cpmmPool = pools.find(p => p.type === 'cpmm');

        if (!cpmmPool) {
          console.error("No CPMM pools found in input file.");
          process.exit(1);
        }
        poolAddress = cpmmPool.address;
        poolData = cpmmPool;
        console.log(`Found CPMM pool in file: ${poolAddress}`);

        if (arg1) amount = arg1;
        if (arg2) outputFile = arg2;

      } else if (arg0 && arg0.length > 30) {
        // Likely a pool address (PublicKey string is usually 32-44 chars)
        poolAddress = arg0;
        if (arg1) amount = arg1; // temp
        if (arg2) outputFile = arg2; // temp
      } else {
        // Fallback/Legacy: Output file first?

        outputFile = arg0 || outputFile;
        amount = arg1 || amount;
        poolAddress = arg2 || "9DiruRpjnAnzhn6ts5HGLouHtJrT1JGsPbXNYCrFz2ad"; // Default
      }

      console.log(`Running CPMM quoter...`);
      console.log(`Pool: ${poolAddress}`);
      console.log(`Amount: ${amount}`);
      console.log(`Output: ${outputFile}`);

      const adapter = new CPMMAdapter(new Connection("https://solana-mainnet.g.alchemy.com/v2/D45KPIYJAK973XyrdTmjy"), poolAddress, poolData);
      await adapter.init();

      const fastQuote = await adapter.quoteFastExactIn(Number(amount), true);
      console.log('Fast Quote Result:', JSON.stringify(fastQuote, null, 2));

      const exactQuote = await adapter.quoteExactIn(Number(amount), true);
      console.log('Exact Quote Result:', JSON.stringify(exactQuote, null, 2));

      const baseMint = adapter.tokenXMint ? adapter.tokenXMint.toString() : (poolData?.baseMint || poolData?.mintA || '');
      const quoteMint = adapter.tokenYMint ? adapter.tokenYMint.toString() : (poolData?.quoteMint || poolData?.mintB || '');
      const baseDecimals = Number.isInteger(adapter.tokenXDecimals) ? adapter.tokenXDecimals : (poolData?.baseDecimals ?? poolData?.decimalsA);
      const quoteDecimals = Number.isInteger(adapter.tokenYDecimals) ? adapter.tokenYDecimals : (poolData?.quoteDecimals ?? poolData?.decimalsB);

      // Write to file
      const output = {
        timestamp: new Date().toISOString(),
        poolAddress,
        dex: 'raydium',
        type: 'cpmm',
        baseMint,
        quoteMint,
        baseDecimals,
        quoteDecimals,
        amount,
        fastQuote,
        exactQuote
      };

      // Ensure directory exists
      const dir = outputFile.substring(0, outputFile.lastIndexOf('/'));
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
      console.log(`Quotes written to ${outputFile}`);
      process.exit(0);
    } catch (e) {
      console.error("Error:", e);
      process.exit(1);
    }
  })();
}



/*

node Q-Math/Q_cpmm.js data/input/800k5.json 1000000000 data/single/results_cpmm1.json
node engine/Q_whirlpool.js pools/800k_custom_E.json 1000000000 /single/results_whirlpool.json

node engine/Q_clmm.js pools/800k_custom_E.json 1000000000 single/results_clmm.json
  node Q-Math/Q_cpmm.js data/input/800k5.json 1000000000 data/single/results_cpmm1.json

*/