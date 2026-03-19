'use strict';
/**
 * Q_whirlpool_fixed.js - Orca Whirlpool Adapter
 * 
 * FIXES:
 * - Removed recursive constructor call that caused stack overflow
 * - Proper SDK initialization
 * - Returns dexType: 'ORCA_WHIRLPOOL' consistently
 */

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { PublicKey, Keypair, Connection } = require('@solana/web3.js');
const BN = require('bn.js');
const Decimal = require('decimal.js');

function ensure(cond, msg) { if (!cond) throw new Error(msg); }

function toDec(v) {
  if (v instanceof Decimal) return v;
  if (v === undefined || v === null) return new Decimal(0);
  return new Decimal(v.toString());
}

function toHuman(atomicStr, decimals) {
  return toDec(atomicStr).div(Decimal.pow(10, decimals));
}
const RPC_URL = process.env.RPC_URL;
// ============================================================================
// SDK LOADING
// ============================================================================

let WhirlpoolSDK = null;
let WhirlpoolContext = null;
let swapQuoteByInputToken = null;
let buildWhirlpoolClient = null;
let PDAUtil = null;
let ORCA_WHIRLPOOL_PROGRAM_ID = null;


// ============================================================================
// WHIRLPOOL ADAPTER
// ============================================================================

class WhirlpoolAdapter {
  constructor(connection, poolAddress, poolData = null) {
    // Initialize connection first (use provided connection or create new one)
    this.connection = connection || new Connection(
      process.env.RPC_URL || 'http://api.mainnet-beta.solana.com',
      'confirmed'
    );

    // Initialize context and fetcher

    // Initialize wallet
    // Initialize wallet - updated version
    try {
      const fs = require('fs');
      const path = require('path');
      const keypairPath = path.join(__dirname, './keys/payer_keypair.json');
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
      this.wallet = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch (error) {
      throw new Error('Failed to load wallet keypair: ' + error.message);
    }

    // Handle pool address
    this.poolAddress = typeof poolAddress === 'string'
      ? new PublicKey(poolAddress)
      : poolAddress;

    this.poolData = poolData || {};

    // Initialize token properties
    this.tokenXMint = null;
    this.tokenYMint = null;
    this.tokenXDecimals = null;
    this.tokenYDecimals = null;
    this.tickSpacing = null;

    // Set fee basis points
    const pd = this.poolData;
    this.feeBps = pd.feeBps ?? pd.fee_bps ??
      (pd.feeRate ? Math.round(pd.feeRate * 10000) : 30);

    // Initialize other properties
    (this._ctx === null);
    (this._whirlpool === null);
    (this._fetcher === null);
  }

  async init() {
    const pd = this.poolData;

    const baseMint = pd.baseMint || pd.mintA || pd.tokenA?.mint;
    const quoteMint = pd.quoteMint || pd.mintB || pd.tokenB?.mint;
    const baseDec = pd.baseDecimals ?? pd.decimalsA ?? 9;
    const quoteDec = pd.quoteDecimals ?? pd.decimalsB ?? 6;

    if (baseMint) this.tokenXMint = new PublicKey(baseMint);
    if (quoteMint) this.tokenYMint = new PublicKey(quoteMint);
    this.tokenXDecimals = baseDec;
    this.tokenYDecimals = quoteDec;
    this.tickSpacing = pd.tickSpacing ?? 64;


    try {
      const orcaSdk = require('@orca-so/whirlpools-sdk');
      WhirlpoolContext = orcaSdk.WhirlpoolContext;
      swapQuoteByInputToken = orcaSdk.swapQuoteByInputToken;
      buildWhirlpoolClient = orcaSdk.buildWhirlpoolClient;
      PDAUtil = orcaSdk.PDAUtil;
      ORCA_WHIRLPOOL_PROGRAM_ID = orcaSdk.ORCA_WHIRLPOOL_PROGRAM_ID;

      const commonSdk = require('@orca-so/common-sdk');
      WhirlpoolSDK = { orcaSdk, commonSdk };

      console.log('Q_whirlpool_fixed: Orca Whirlpools SDK loaded');
    } catch (e) {
      console.warn('Q_whirlpool_fixed: Orca SDK not available (' + e.message + ')');
    }

    if (WhirlpoolSDK && this.connection) {
      try {
        const wallet = this.wallet;

        // Create context once
        // FIX: WhirlpoolContext.from(connection, wallet, fetcher, ...)
        // DO NOT pass programId as 3rd arg!
        this._ctx = WhirlpoolContext.from(
          this.connection, wallet
        );
        this._fetcher = this._ctx.fetcher;

        const client = buildWhirlpoolClient(this._ctx);
        this._whirlpool = await client.getPool(this.poolAddress);

        if (this._whirlpool) {
          const data = this._whirlpool.getData();
          if (!this.tokenXMint) this.tokenXMint = data.tokenMintA;
          if (!this.tokenYMint) this.tokenYMint = data.tokenMintB;
          this.tickSpacing = data.tickSpacing;
          this.feeBps = data.feeRate / 100;
        }
      } catch (e) {
        console.warn('WhirlpoolAdapter init SDK failed: ' + e.message);
      }
    }
    return this;
  }

  _errorQuote(inAmountAtomic, swapForY, errorMsg) {
    return {
      inAmountRaw: String(inAmountAtomic),
      outAmountRaw: '0',
      minOutAmountRaw: '0',
      executionPrice: 0,
      priceImpact: 0,
      fee: 0,
      poolAddress: this.poolAddress.toBase58(),
      dexType: 'ORCA_WHIRLPOOL',
      swapForY: Boolean(swapForY),
      tickArrays: [],
      success: false,
      error: errorMsg
    };
  }


  _normalizeQuote({ inAmountAtomic, outAmountAtomic, minOutAtomic, swapForY, priceImpact, executionPrice, tickArrays }) {
    const inDec = swapForY ? this.tokenXDecimals : this.tokenYDecimals;
    const outDec = swapForY ? this.tokenYDecimals : this.tokenXDecimals;

    return {
      inAmountRaw: String(inAmountAtomic),
      outAmountRaw: String(outAmountAtomic),
      minOutAmountRaw: String(minOutAtomic),
      inAmountDecimal: toHuman(inAmountAtomic, inDec).toNumber(),
      outAmountDecimal: toHuman(outAmountAtomic, outDec).toNumber(),
      executionPrice: executionPrice || 0,
      priceImpact: priceImpact || 0,
      fee: this.feeBps / 10000,
      poolAddress: this.poolAddress.toBase58(),
      dexType: 'ORCA_WHIRLPOOL',
      swapForY: Boolean(swapForY),
      tickArrays: tickArrays || [],
      remainingAccounts: tickArrays || [],
      success: true,
      error: null
    };
  }

  async quoteFastExactIn(inAmountAtomic, swapForY = true, slippageBps = 50) {
    return this.quoteExactIn(inAmountAtomic, swapForY, slippageBps);
  }

  async quoteExactIn(inAmountAtomic, swapForY = true, slippageBps = 50) {
    if (!inAmountAtomic) return this._errorQuote(0, swapForY, 'inAmountAtomic required');
    if (!WhirlpoolSDK || !this._whirlpool) {
      return this._errorQuote(inAmountAtomic, swapForY, 'SDK not initialized');
    }

    try {
      const { Percentage } = WhirlpoolSDK.commonSdk;
      const inputMint = swapForY ? this.tokenXMint : this.tokenYMint;
      const slippage = Percentage.fromFraction(slippageBps, 10000);

      const quote = await swapQuoteByInputToken(
        this._whirlpool,
        inputMint,
        new BN(inAmountAtomic.toString()),
        slippage,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        this._fetcher,
        true
      );

      if (!quote) return this._errorQuote(inAmountAtomic, swapForY, 'Quote null');

      const outAmount = quote.estimatedAmountOut?.toString() || '0';
      const minOutAmount = quote.otherAmountThreshold?.toString() || '0';

      const inDec = swapForY ? this.tokenXDecimals : this.tokenYDecimals;
      const outDec = swapForY ? this.tokenYDecimals : this.tokenXDecimals;
      const inHuman = Number(inAmountAtomic) / Math.pow(10, inDec);
      const outHuman = Number(outAmount) / Math.pow(10, outDec);

      let priceImpact = 0;
      try {
        const pi = quote.estimatedPriceImpact ?? quote.priceImpact;
        if (pi != null) {
          if (typeof pi === 'number') priceImpact = pi;
          else if (typeof pi.toNumber === 'function') priceImpact = pi.toNumber();
          else if (pi.numerator != null && pi.denominator != null) {
            priceImpact = Number(pi.numerator) / Number(pi.denominator);
          } else if (typeof pi.toFixed === 'function') {
            priceImpact = Number(pi.toFixed());
          }
        }
      } catch { }

      if (!Number.isFinite(priceImpact)) priceImpact = 0;
      if (priceImpact > 1) priceImpact = priceImpact / 100;

      const tickArrays = [];
      if (quote.tickArray0) tickArrays.push(quote.tickArray0.toBase58());
      if (quote.tickArray1) tickArrays.push(quote.tickArray1.toBase58());
      if (quote.tickArray2) tickArrays.push(quote.tickArray2.toBase58());

      return this._normalizeQuote({
        inAmountAtomic,
        outAmountAtomic: outAmount,
        minOutAtomic: minOutAmount,
        swapForY,
        priceImpact,
        executionPrice: inHuman > 0 ? outHuman / inHuman : 0,
        tickArrays
      });
    } catch (e) {
      return this._errorQuote(inAmountAtomic, swapForY, e.message);
    }
  }
}

module.exports = WhirlpoolAdapter;

if (require.main === module) {
  (async () => {
    try {
      function parseArgs(argv) {
        const out = { input: null, output: null, amount: null, pool: null, rpc: null, help: false, pos: [] };
        const setKey = (k, v) => {
          const key = String(k || '').replace(/^--?/, '').toLowerCase();
          const val = v == null ? '' : String(v);
          if (['input', 'in'].includes(key)) out.input = val;
          else if (['output', 'out'].includes(key)) out.output = val;
          else if (['amount', 'amt'].includes(key)) out.amount = val;
          else if (['pool', 'pooladdress', 'address'].includes(key)) out.pool = val;
          else if (['rpc', 'rpcurl'].includes(key)) out.rpc = val;
        };
        for (let i = 0; i < argv.length; i++) {
          const a = argv[i];
          if (!a) continue;
          if (a === '--help' || a === '-h') { out.help = true; continue; }
          const kv = a.match(/^([a-zA-Z][\\w-]*)=(.*)$/);
          if (kv) {
            let val = kv[2];
            if (val === '' && argv[i + 1] && !argv[i + 1].startsWith('-')) val = argv[++i];
            setKey(kv[1], val);
            continue;
          }
          if (a.startsWith('--')) {
            const key = a.replace(/^--?/, '');
            let val = argv[i + 1];
            if (val && val.startsWith('--')) val = '';
            if (val !== '' && val != null && !val.startsWith('--')) i++;
            setKey(key, val);
            continue;
          }
          out.pos.push(a);
        }
        return out;
      }

      const parsed = parseArgs(process.argv.slice(2));
      const args = process.argv.slice(2);

      const normalizePools = (raw) => {
        if (Array.isArray(raw)) return raw;
        if (raw?.pools) return raw.pools;
        if (raw?.data) return raw.data;
        return Object.values(raw || {});
      };
      const isWhirlpool = (p) => {
        const t = String(p?.type || p?.poolType || '').toLowerCase();
        const d = String(p?.dex || '').toLowerCase();
        return t.includes('whirlpool') || d.includes('orca');
      };

      let poolAddress;
      let amount = parsed.amount || '1000000000';
      let outputFile = parsed.output || 'results/_WHIRLPOOL.json';
      let poolData = null;

      const arg0 = parsed.input || parsed.pool || args[0];
      const arg1 = parsed.amount || args[1];
      const arg2 = parsed.output || args[2];

      if (arg0 && fs.existsSync(arg0) && fs.lstatSync(arg0).isFile()) {
        console.log(`Loading pools from ${arg0}...`);
        const raw = JSON.parse(fs.readFileSync(arg0, 'utf8'));
        const pools = normalizePools(raw);
        const whirl = pools.find(isWhirlpool);
        if (!whirl) {
          console.error("No Whirlpool pools found in input file.");
          process.exit(1);
        }
        poolAddress = whirl.poolAddress || whirl.address || whirl.id;
        poolData = whirl;
        console.log(`Found Whirlpool pool in file: ${poolAddress}`);
        if (arg1) amount = arg1;
        if (arg2) outputFile = arg2;
      } else if (arg0 && arg0.length > 30) {
        poolAddress = arg0;
        if (arg1) amount = arg1;
        if (arg2) outputFile = arg2;
      }

      if (!poolAddress) {
        // Fallback demo if no args provided
        let adapter = new WhirlpoolAdapter(null, '7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm'); // SOL/USDC
        await adapter.init();
        const quotes = await Promise.all([
          adapter.quoteExactIn(1000000000), // 1 SOL -> USDC
          adapter.quoteExactIn(1000000, false), // 1 USDC -> SOL
        ]);
        console.log('Quotes:', JSON.stringify(quotes, null, 2));
        return;
      }

      console.log(`Running WHIRLPOOL quoter...`);
      console.log(`Pool: ${poolAddress}`);
      console.log(`Amount: ${amount}`);
      console.log(`Output: ${outputFile}`);

      const rpcUrl = parsed.rpc || process.env.RPC_URL || 'http://api.mainnet-beta.solana.com';
      const adapter = new WhirlpoolAdapter(new Connection(rpcUrl, 'confirmed'), poolAddress, poolData);
      await adapter.init();

      const fastQuote = await adapter.quoteExactIn(amount.toString(), true);
      console.log('Fast Quote Result:', JSON.stringify(fastQuote, null, 2));

      const exactQuote = await adapter.quoteExactIn(amount.toString(), true);
      console.log('Exact Quote Result:', JSON.stringify(exactQuote, null, 2));

      const output = {
        timestamp: new Date().toISOString(),
        poolAddress,
        amount,
        fastQuote,
        exactQuote
      };

      const dir = outputFile.substring(0, outputFile.lastIndexOf('/'));
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
      console.log(`Quotes written to ${outputFile}`);
    } catch (e) {
      console.error('Test execution failed:', e);
    }
  })();
}




// node engine/Q-Whirlpool.js output/pools_batch.json 1000000000 results/_WHIRLPOOL.json
