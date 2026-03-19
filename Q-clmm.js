'use strict';
require('dotenv').config({ quiet: true });

const fs = require('fs');
const { PublicKey, Keypair, Connection } = require('@solana/web3.js');
const BN = require('bn.js');
const Decimal = require('decimal.js');
const axios = require('axios');

//const { solana } = require('@web3')

try {
  const wallet = web3_js_1.Keypair.fromSecretKey(secret);
  const keypairPath = path.join(__dirname, 'keyPair', 'solflare_keypair.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  //this.wallet = Keypair.fromSecretKey(Uint8Array.from(keypairData));
} catch (error) {
  throw new Error('Failed to load wallet keypair: ' + error.message);
}

const priceCache = new Map();
let lastPriceFetch = 0;

async function fetchCoinGeckoPrices(mintAddresses) {
  const now = Date.now();
  if (now - lastPriceFetch < 30000 && priceCache.size > 0) {
    return priceCache;
  }

  try {
    const mintToId = {
      [SOL_MINT]: 'solana',
      [USDC_MINT]: 'usd-coin',
      [USDT_MINT]: 'tether',
    };

    const ids = [...new Set(mintAddresses.map(m => mintToId[m] || m).filter(Boolean))].join(',');
    if (!ids) return priceCache;



    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { timeout: 5000 }
    );

    for (const [mint, id] of Object.entries(mintToId)) {
      if (response.data[id]) {
        priceCache.set(mint, response.data[id].usd);
      }
    }

    lastPriceFetch = now;
    return priceCache;
  } catch (e) {
    console.warn('CoinGecko fetch failed:', e.message);
    return priceCache;
  }
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const ONE_SOL_ATOMIC = new Decimal(10).pow(9);

function isSol(m) { return String(m) === SOL_MINT; }
function isUsdc(m) { return String(m) === USDC_MINT; }
function isUsdt(m) { return String(m) === USDT_MINT; }
function toDec(v) { return new Decimal(v == null ? 0 : v.toString()); }

// --- Tick Array Functions ---

const CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const TICK_ARRAY_SEED = Buffer.from('tick_array', 'utf8');

function i32ToBytes(num) {
  const arr = new ArrayBuffer(4);
  const view = new DataView(arr);
  view.setInt32(0, num, false);
  return new Uint8Array(arr);
}

function readI32(buffer, offset) {
  return buffer.readInt32LE(offset);
}

function readU128(buffer, offset) {
  return new BN(buffer.slice(offset, offset + 16), 'le');
}

function readI128(buffer, offset) {
  return new BN(buffer.slice(offset, offset + 16), 'le').fromTwos(128);
}

function getTickArrayAddress(programId, poolId, startIndex) {
  const [publicKey] = PublicKey.findProgramAddressSync(
    [TICK_ARRAY_SEED, poolId.toBuffer(), i32ToBytes(startIndex)],
    programId
  );
  return publicKey;
}

// --- Tick Array Manager ---

class TickArrayManager {
  constructor(poolData, connection) {
    this.poolData = poolData;
    this.connection = connection;
    this.tickArrays = new Map();
    this.tickSpacing = poolData.tickSpacing || 1;

    if (!connection) {
      this.buildMockTickArrays();
    }
  }

  async getTickArrays(tickCurrent, zeroForOne, count = 3) {
    if (!this.connection) return;

    const currentStartIndex = TickUtils.getTickArrayStartIndexByTick(tickCurrent, this.tickSpacing);
    const startIndices = [currentStartIndex];

    let nextIndex = currentStartIndex;
    for (let i = 0; i < count - 1; i++) {
      nextIndex = TickUtils.getNextTickArrayStartIndex(nextIndex, this.tickSpacing, zeroForOne);
      startIndices.push(nextIndex);
    }

    await this.fetchTickArrays(startIndices);
  }

  async fetchTickArrays(startIndices) {
    const poolId = new PublicKey(this.poolData.poolAddress || this.poolData.address);
    const keys = startIndices.map(index => getTickArrayAddress(CLMM_PROGRAM_ID, poolId, index));

    try {
      const infos = await this.connection.getMultipleAccountsInfo(keys);

      infos.forEach((info, i) => {
        const startIndex = startIndices[i];
        if (info) {
          const tickArray = this.decodeTickArray(info.data, startIndex);
          this.tickArrays.set(startIndex, tickArray);
        } else {
          this.tickArrays.set(startIndex, {
            startTickIndex: startIndex,
            ticks: Array(TICK_ARRAY_SIZE).fill(null).map((_, i) => ({
              tick: startIndex + i * this.tickSpacing,
              liquidityNet: ZERO,
              liquidityGross: ZERO,
              feeGrowthOutsideX64A: ZERO,
              feeGrowthOutsideX64B: ZERO,
              rewardGrowthsOutsideX64: [],
            }))
          });
        }
      });
    } catch (error) {
      console.error('Error fetching tick arrays:', error);
    }
  }

  decodeTickArray(buffer, expectedStartIndex) {
    let offset = 8; // Skip discriminator

    const poolId = new PublicKey(buffer.slice(offset, offset + 32));
    offset += 32;

    const startTickIndex = readI32(buffer, offset);
    offset += 4;

    const ticks = [];
    for (let i = 0; i < TICK_ARRAY_SIZE; i++) {
      const tick = readI32(buffer, offset);
      offset += 4;
      const liquidityNet = readI128(buffer, offset);
      offset += 16;
      const liquidityGross = readU128(buffer, offset);
      offset += 16;
      const feeGrowthOutside0X64 = readU128(buffer, offset);
      offset += 16;
      const feeGrowthOutside1X64 = readU128(buffer, offset);
      offset += 16;
      const rewardGrowthsOutsideX64 = [];
      for (let j = 0; j < 3; j++) {
        rewardGrowthsOutsideX64.push(readU128(buffer, offset));
        offset += 16;
      }
      offset += 52; // Padding

      ticks.push({
        tick,
        liquidityNet,
        liquidityGross,
        feeGrowthOutsideX64A: feeGrowthOutside0X64,
        feeGrowthOutsideX64B: feeGrowthOutside1X64,
        rewardGrowthsOutsideX64
      });
    }

    return { startTickIndex, ticks, isInitialized: true };
  }

  buildMockTickArrays() {
    const tickSpacing = this.tickSpacing;
    const currentTick = this.poolData.tickCurrent || 0;
    const liquidity = toBN(this.poolData.liquidity || 0);
    const currentStartIndex = TickUtils.getTickArrayStartIndexByTick(currentTick, tickSpacing);

    const tickArray = {
      startTickIndex: currentStartIndex,
      ticks: Array(TICK_ARRAY_SIZE).fill(null).map((_, i) => ({
        tick: currentStartIndex + i * tickSpacing,
        liquidityNet: (currentStartIndex + i * tickSpacing) === currentTick ? liquidity : ZERO,
        liquidityGross: (currentStartIndex + i * tickSpacing) === currentTick ? liquidity : ZERO,
        feeGrowthOutsideX64A: ZERO,
        feeGrowthOutsideX64B: ZERO,
        rewardGrowthsOutsideX64: [],
      }))
    };

    this.tickArrays.set(currentStartIndex, tickArray);

    // Adjacent arrays
    const nextStart = currentStartIndex + tickSpacing * TICK_ARRAY_SIZE;
    const prevStart = currentStartIndex - tickSpacing * TICK_ARRAY_SIZE;

    if (nextStart <= 306600) {
      this.tickArrays.set(nextStart, this.createEmptyTickArray(nextStart));
    }
    if (prevStart >= -307200) {
      this.tickArrays.set(prevStart, this.createEmptyTickArray(prevStart));
    }
  }

  createEmptyTickArray(startIndex) {
    return {
      startTickIndex: startIndex,
      ticks: Array(TICK_ARRAY_SIZE).fill(null).map((_, i) => ({
        tick: startIndex + i * this.tickSpacing,
        liquidityNet: ZERO,
        liquidityGross: ZERO,
        feeGrowthOutsideX64A: ZERO,
        feeGrowthOutsideX64B: ZERO,
        rewardGrowthsOutsideX64: [],
      }))
    };
  }

  getCache() {
    const cache = {};
    for (const [startIndex, tickArray] of this.tickArrays) {
      cache[startIndex] = tickArray;
    }
    return cache;
  }
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
function toHuman(atomicStr, decimals) {
  return toDec(atomicStr).div(Decimal.pow(10, decimals));
}
function attachTypedToClmmQuote(q, { inMint, outMint, inDecimals, outDecimals }) {
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

const QUIET = process.env.QUIET === '1' || process.env.QUIET === 'true';
let RaydiumV2 = null;
try {
  RaydiumV2 = require('@raydium-io/raydium-sdk-v2');
  if (!RaydiumV2.Raydium) throw new Error('Invalid Raydium SDK v2 import');
  ensure(RaydiumV2.Raydium, 'Invalid Raydium SDK v2 import');

  if (!QUIET) console.log(`Q_clmm fixed: using Raydium SDK v2`);

} catch (e) {
  if (!QUIET) {
    console.warn(`Q_clmm fixed: Raydium SDK v2 not available (${e.message})`);
    console.warn(`Q_clmm fixed: falling back to slower quoteExactIn() implementation.`);
  }

}

async function generateRankingTables(pools, solMint = SOL_MINT, usdcMint = USDC_MINT) {
  const tables = {
    solToX: [],
    xToY: [],
    yToSol: []
  };

  const allMints = [...new Set(pools.flatMap(p => [p.mintA, p.mintB]))];
  const cgPrices = await fetchCoinGeckoPrices(allMints);

  for (const pool of pools) {
    try {
      const adapter = new CLMMAdapter(null, pool.address, pool);
      await adapter.init();

      // Table 1: SOL/X pairs
      if (pool.mintA === solMint) {
        const quote = await adapter.getQuote(1e9, true, 50);
        if (quote.success) {
          const tokenPriceUsd = cgPrices.get(pool.mintB) || 0;
          const solPriceUsd = cgPrices.get(solMint) || 150;
          const expectedOutput = tokenPriceUsd > 0 ? (1 * solPriceUsd) / tokenPriceUsd : 0;
          const priceDiff = expectedOutput > 0 ? ((quote.outAmountDecimal - expectedOutput) / expectedOutput) * 100 : 0;

          tables.solToX.push({
            pair: `${pool.baseSymbol}/${pool.quoteSymbol}`,
            poolAddress: pool.address,
            inSol: 1,
            outToken: quote.outAmountDecimal,
            execPrice: quote.executionPrice,
            spotPrice: quote.spotPrice,
            priceDiffPct: priceDiff,
            feeBps: quote.feeBps,
            impact: (quote.priceImpact * 100).toFixed(2),
            tvl: pool.liquidity
          });
        }
      } else if (pool.mintB === solMint) {
        const quote = await adapter.getQuote(1e9, false, 50);
        if (quote.success) {
          const tokenPriceUsd = cgPrices.get(pool.mintA) || 0;
          const solPriceUsd = cgPrices.get(solMint) || 150;
          const expectedOutput = tokenPriceUsd > 0 ? (1 * solPriceUsd) / tokenPriceUsd : 0;
          const priceDiff = expectedOutput > 0 ? ((quote.outAmountDecimal - expectedOutput) / expectedOutput) * 100 : 0;

          tables.solToX.push({
            pair: `SOL/${pool.baseSymbol}`,
            poolAddress: pool.address,
            inSol: 1,
            outToken: quote.outAmountDecimal,
            execPrice: 1 / quote.executionPrice,
            spotPrice: quote.spotPrice,
            priceDiffPct: priceDiff,
            feeBps: quote.feeBps,
            impact: (quote.priceImpact * 100).toFixed(2),
            tvl: pool.liquidity
          });
        }
      }

      // Table 3: Y/SOL pairs
      if (pool.mintB === solMint) {
        const testAmount = Math.pow(10, pool.baseDecimals || 9);
        const quote = await adapter.getQuote(testAmount, true, 50);
        if (quote.success) {
          tables.yToSol.push({
            pair: `${pool.baseSymbol}/SOL`,
            poolAddress: pool.address,
            inToken: 1,
            outSol: quote.outAmountDecimal,
            execPrice: quote.executionPrice,
            priceDiffPct: 0,
            feeBps: quote.feeBps,
            impact: (quote.priceImpact * 100).toFixed(2),
            tvl: pool.liquidity
          });
        }
      }

    } catch (e) {
      // Silent fail for individual pools
    }
  }

  tables.solToX.sort((a, b) => Math.abs(b.priceDiffPct) - Math.abs(a.priceDiffPct));
  tables.yToSol.sort((a, b) => Math.abs(b.priceDiffPct) - Math.abs(a.priceDiffPct));

  return tables;
}

class CLMMAdapter {
  /**
   * @param {import('@solana/web3.js').Connection} connection
   * @param {string|PublicKey} poolAddress
   * @param {object|null} poolData - optional enriched pool record; should include mints/decimals/fee if available
   */
  constructor(connection, poolAddress, poolData = null) {
    this.connection = connection;
    this.poolAddress = new PublicKey(poolAddress);
    this.poolData = poolData;

    this.tokenXMint = null;
    this.tokenYMint = null;
    this.tokenXDecimals = null;
    this.tokenYDecimals = null;

    // fee bps if known (used only as a "rate" field in the standard quote; real SDK quote already includes fee impact)
    this.feeBps = (poolData && (poolData.feeBps ?? poolData.fee_bps ?? poolData.raw?.feeBps)) ?? 0;

    this._raydium = null; // lazy Raydium v2 client
  }

  async init() {
    // Prefer poolData for static metadata
    const pd = this.poolData || {};
    const baseMint = pd.baseMint || pd.mintA || pd.raw?.mintA || pd.raw?.mint_a || pd.mint_x || pd.raw?.mint_x;
    const quoteMint = pd.quoteMint || pd.mintB || pd.raw?.mintB || pd.raw?.mint_b || pd.mint_y || pd.raw?.mint_y;
    const baseDec = pd.baseDecimals ?? pd.decimalsA ?? pd.raw?.baseDecimals ?? pd.raw?.decimalsA ?? pd.decA;
    const quoteDec = pd.quoteDecimals ?? pd.decimalsB ?? pd.raw?.quoteDecimals ?? pd.raw?.decimalsB ?? pd.decB;

    if (baseMint && quoteMint) {
      this.tokenXMint = new PublicKey(baseMint);
      this.tokenYMint = new PublicKey(quoteMint);
    }
    if (Number.isInteger(baseDec)) this.tokenXDecimals = baseDec;
    if (Number.isInteger(quoteDec)) this.tokenYDecimals = quoteDec;

    return this;
  }

  _normalizeQuote({ inAmountAtomic, outAmountAtomic, minOutAtomic, swapForY, feeRate, priceImpact, executionPrice, remainingAccounts }) {
    let inDecimals = (swapForY ? this.tokenXDecimals : this.tokenYDecimals);
    let outDecimals = (swapForY ? this.tokenYDecimals : this.tokenXDecimals);

    if (inDecimals == null || outDecimals == null) {
      if (this.poolData) {
        inDecimals = swapForY ? (this.poolData.baseDecimals || (this.poolData.tokenA && this.poolData.tokenA.decimals)) : (this.poolData.quoteDecimals || (this.poolData.tokenB && this.poolData.tokenB.decimals));
        outDecimals = swapForY ? (this.poolData.quoteDecimals || (this.poolData.tokenB && this.poolData.tokenB.decimals)) : (this.poolData.baseDecimals || (this.poolData.tokenA && this.poolData.tokenA.decimals));
      }
    }

    if (inDecimals == null || outDecimals == null) {
      inDecimals = 6;
      outDecimals = 9;
    }

    if (!Number.isInteger(inDecimals) || !Number.isInteger(outDecimals)) {
      throw new Error('CLMMAdapter missing token decimals (enrich poolData or set decimals)');
    }

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
      fee: Number(feeRate ?? (this.feeBps / 10000)),

      poolAddress: this.poolAddress.toBase58(),
      dexType: 'RAYDIUM_CLMM',
      swapForY: Boolean(swapForY),

      remainingAccounts: Array.isArray(remainingAccounts) ? remainingAccounts.map(String) : [],

      success: true,
      error: null
    };
  }

  async _getRaydiumClient() {
    if (!RaydiumV2) return null;
    if (this._raydium) return this._raydium;

    const { Raydium } = RaydiumV2;
    if (!Raydium || typeof Raydium.load !== 'function') return null;

    // owner is required by Raydium.load; a throwaway keypair is fine for quoting.
    const owner = Keypair.generate();
    this._raydium = await Raydium.load({
      connection: this.connection,
      owner,
      disableFeatureCheck: true,
      disableLoadToken: true,
      blockhashCommitment: 'confirmed'
    });
    return this._raydium;
  }

  /**
   * Fast quote: same as exact for now (Raydium CLMM needs tick traversal anyway).
   */
  async quoteFastExactIn(inAmountAtomic, swapForY = true, slippageBps = 50, opts = {}) {
    return this.quoteExactIn(inAmountAtomic, swapForY, slippageBps, opts);
  }

  /**
   * Exact quote (SDK-first unless you inject quoteProvider).
   * @param {string|number|bigint} inAmountAtomic
   * @param {boolean} swapForY  true => X->Y (base->quote), false => Y->X
   * @param {number} slippageBps
   * @param {object} opts
   * @param {function} [opts.quoteProvider] optional injected provider
   */
  async quoteExactIn(inAmountAtomic, swapForY = true, slippageBps = 50, opts = {}) {
    if (inAmountAtomic == null) throw new Error('inAmountAtomic required');

    const quoteProvider = opts.quoteProvider;
    if (typeof quoteProvider === 'function') {
      try {
        const q = await quoteProvider({
          poolAddress: this.poolAddress.toBase58(),
          inAmountAtomic: String(inAmountAtomic),
          swapForY: Boolean(swapForY),
          slippageBps: Number(slippageBps),
          poolData: this.poolData,
          connection: this.connection
        });
        ensure(q && q.outAmountRaw != null && q.minOutAmountRaw != null, 'quoteProvider must return outAmountRaw and minOutAmountRaw');
        return this._normalizeQuote({
          inAmountAtomic: String(inAmountAtomic),
          outAmountAtomic: String(q.outAmountRaw),
          minOutAtomic: String(q.minOutAmountRaw),
          swapForY,
          feeRate: q.feeRate,
          priceImpact: q.priceImpact,
          executionPrice: q.executionPrice,
          remainingAccounts: q.remainingAccounts || q.tickArrays || q.binArrays
        });
      } catch (e) {
        return {
          inAmountRaw: String(inAmountAtomic),
          outAmountRaw: '0',
          minOutAmountRaw: '0',
          inAmountDecimal: 0,
          outAmountDecimal: 0,
          minOutAmountDecimal: 0,
          executionPrice: 0,
          priceImpact: 0,
          fee: Number(this.feeBps / 10000),
          poolAddress: this.poolAddress.toBase58(),
          dexType: 'RAYDIUM_CLMM',
          swapForY: Boolean(swapForY),
          remainingAccounts: [],
          success: false,
          error: `quoteProvider failed: ${e.message || String(e)}`
        };
      }
    }

    // SDK v2 path (best-effort). If it can't quote, return a clear error to trigger fallback.
    try {
      const raydium = await this._getRaydiumClient();
      ensure(raydium && raydium.api && typeof raydium.api.fetchPoolById === 'function', 'Raydium SDK v2 not available (install @raydium-io/raydium-sdk-v2 or pass quoteProvider)');

      const { PoolUtils } = RaydiumV2;
      ensure(PoolUtils, 'Raydium SDK v2 PoolUtils not found');

      const res = await raydium.api.fetchPoolById({ ids: this.poolAddress.toBase58() });
      const poolInfo = Array.isArray(res) ? res[0] : (res?.data ? res.data[0] : res);
      ensure(poolInfo, 'Raydium api.fetchPoolById returned no pool');

      // Compute clmm info + fetch tick arrays
      const clmmInfo = await PoolUtils.fetchComputeClmmInfo({
        connection: this.connection,
        poolInfo
      });
      ensure(clmmInfo, 'PoolUtils.fetchComputeClmmInfo returned no clmmInfo');

      if (!this.tokenXMint && clmmInfo.mintA?.address) this.tokenXMint = new PublicKey(clmmInfo.mintA.address);
      if (!this.tokenYMint && clmmInfo.mintB?.address) this.tokenYMint = new PublicKey(clmmInfo.mintB.address);
      if (!Number.isInteger(this.tokenXDecimals) && Number.isInteger(clmmInfo.mintA?.decimals)) this.tokenXDecimals = clmmInfo.mintA.decimals;
      if (!Number.isInteger(this.tokenYDecimals) && Number.isInteger(clmmInfo.mintB?.decimals)) this.tokenYDecimals = clmmInfo.mintB.decimals;
      if (!this.feeBps && typeof poolInfo.feeRate === 'number') this.feeBps = Math.round(poolInfo.feeRate * 10000);

      // Fetch tick arrays cache
      const tickCache = await PoolUtils.fetchMultiplePoolTickArrays({
        connection: this.connection,
        poolKeys: [clmmInfo],
        batchRequest: true
      });
      const poolId = clmmInfo.id?.toString?.() ?? String(clmmInfo.id);
      const tickArrayCache = tickCache?.[poolId];
      ensure(tickArrayCache, 'PoolUtils.fetchMultiplePoolTickArrays returned no tick arrays');

      const mintA = clmmInfo.mintA?.address;
      const mintB = clmmInfo.mintB?.address;
      const inMint = swapForY ? this.tokenXMint?.toBase58() : this.tokenYMint?.toBase58();
      const outMint = swapForY ? this.tokenYMint?.toBase58() : this.tokenXMint?.toBase58();

      const tokenOut =
        (outMint && outMint === mintA) ? clmmInfo.mintA :
          (outMint && outMint === mintB) ? clmmInfo.mintB :
            (inMint && inMint === mintA) ? clmmInfo.mintB :
              (inMint && inMint === mintB) ? clmmInfo.mintA :
                (swapForY ? clmmInfo.mintB : clmmInfo.mintA);

      // Compute quote
      const amountIn = new BN(inAmountAtomic.toString());
      const slippage = Number(slippageBps) / 10000;

      const quote = await PoolUtils.computeAmountOutFormat({
        poolInfo: clmmInfo,
        tickArrayCache,
        amountIn,
        tokenOut,
        slippage
      });

      const readRaw = (v) => {
        if (v === null || v === undefined) return null;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return v.toString();
        if (v.raw != null) return v.raw.toString();
        if (v.numerator != null) return v.numerator.toString();
        if (v.amount != null) return readRaw(v.amount);
        return typeof v.toString === 'function' ? v.toString() : null;
      };

      const outRaw = readRaw(quote?.amountOut ?? quote?.outAmount ?? quote?.amountOutRaw);
      const minOutRaw = readRaw(quote?.minAmountOut ?? quote?.minOutAmount ?? quote?.minAmountOutRaw);
      ensure(outRaw != null && minOutRaw != null, 'Raydium computeAmountOutFormat returned no out/minOut');

      const execPxRaw = quote?.executionPrice;
      const execPxNum = execPxRaw?.toNumber?.() ??
        (typeof execPxRaw?.toFixed === 'function' ? Number(execPxRaw.toFixed()) : null) ??
        (typeof execPxRaw?.toSignificant === 'function' ? Number(execPxRaw.toSignificant(10)) : null);
      const execPx = Number.isFinite(execPxNum) ? execPxNum : null;

      const piRaw = quote?.priceImpact;
      let priceImpact = null;
      if (typeof piRaw === 'number') {
        priceImpact = piRaw;
      } else if (typeof piRaw?.toNumber === 'function') {
        const n = piRaw.toNumber();
        if (Number.isFinite(n)) priceImpact = n;
      }
      if (!Number.isFinite(priceImpact)) {
        const pct = (typeof piRaw?.toFixed === 'function' ? Number(piRaw.toFixed()) : null) ??
          (typeof piRaw?.toSignificant === 'function' ? Number(piRaw.toSignificant(10)) : null);
        priceImpact = Number.isFinite(pct) ? (pct / 100) : 0;
      }

      // Normalization: different SDK builds name fields differently
      const remaining = quote?.remainingAccounts?.map?.(a => a.toString?.() ?? String(a)) ?? [];

      return this._normalizeQuote({
        inAmountAtomic: String(inAmountAtomic),
        outAmountAtomic: String(outRaw),
        minOutAtomic: String(minOutRaw),
        swapForY,
        feeRate: quote?.feeRate ?? (this.feeBps / 10000),
        priceImpact,
        executionPrice: execPx ?? quote?.executionPriceX64 ?? null,
        remainingAccounts: remaining
      });
    } catch (e) {
      return {
        inAmountRaw: String(inAmountAtomic),
        outAmountRaw: '0',
        minOutAmountRaw: '0',
        inAmountDecimal: 0,
        outAmountDecimal: 0,
        minOutAmountDecimal: 0,
        executionPrice: 0,
        priceImpact: 0,
        fee: Number(this.feeBps / 10000),
        poolAddress: this.poolAddress.toBase58(),
        dexType: 'RAYDIUM_CLMM',
        swapForY: Boolean(swapForY),
        remainingAccounts: [],
        success: false,
        error: e.message || String(e)
      };
    }
  }
}

module.exports = CLMMAdapter;
module.exports.TickArrayManager = TickArrayManager;
module.exports.makeAmount = makeAmount;
module.exports.addFeeToLedger = addFeeToLedger;
module.exports.attachTypedToCpmmQuote = attachTypedToClmmQuote;
module.exports.generateRankingTables = generateRankingTables;
module.exports.fetchCoinGeckoPrices = fetchCoinGeckoPrices;

if (require.main === module) {
  (async () => {
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
    // Arg 0: Input source (file path) OR Pool Address OR Output file (if old usage)
    // Arg 1: Amount
    // Arg 2: Output file (optional)

    let poolAddress;
    let amount = '1000000000';
    let outputFile = 'results/_CLMM.json';
    let poolData = null;

    const arg0 = parsed.input || parsed.pool || args[0];
    const arg1 = parsed.amount || args[1];
    const arg2 = parsed.output || args[2];

    const normalizePools = (raw) => {
      if (Array.isArray(raw)) return raw;
      if (raw?.pools) return raw.pools;
      if (raw?.data) return raw.data;
      return Object.values(raw || {});
    };

    const isClmm = (p) => String(p?.type || p?.poolType || '').toLowerCase().includes('clmm');

    try {
      if (arg0 && fs.existsSync(arg0) && fs.lstatSync(arg0).isFile()) {
        console.log(`Loading pools from ${arg0}...`);
        const raw = JSON.parse(fs.readFileSync(arg0, 'utf8'));
        const pools = normalizePools(raw);
        const clmmPool = pools.find(isClmm);

        if (!clmmPool) {
          console.error("No CLMM pools found in input file.");
          process.exit(1);
        }
        poolAddress = clmmPool.poolAddress || clmmPool.address || clmmPool.id;
        poolData = clmmPool;
        console.log(`Found CLMM pool in file: ${poolAddress}`);

        if (arg1) amount = arg1;
        if (arg2) outputFile = arg2;
      } else if (arg0 && arg0.length > 30) {
        poolAddress = arg0;
        if (arg1) amount = arg1;
        if (arg2) outputFile = arg2;
      } else {
        outputFile = arg0 || outputFile;
        amount = arg1 || amount;
        poolAddress = arg2 || "CAMMCzo5YL8w4VFF8kVJuifRSzC55tVhdn2ml6B16Ad";
      }

      console.log(`Running CLMM quoter...`);
      console.log(`Pool: ${poolAddress}`);
      console.log(`Amount: ${amount}`);
      console.log(`Output: ${outputFile}`);

      const rpcUrl = parsed.rpc || process.env.RPC_URL;
      if (!rpcUrl) {
        console.error("ERROR: RPC_URL environment variable is required");
        console.error("Please set RPC_URL in your .env file with a secure RPC endpoint");
        process.exit(1);
      }
      const adapter = new CLMMAdapter(new Connection(rpcUrl, 'confirmed'), poolAddress, poolData);
      await adapter.init();

      const fastQuote = await adapter.quoteFastExactIn(amount.toString(), true);
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
      process.exit(0);
    } catch (e) {
      console.error("Error:", e);
      process.exit(1);
    }
  })();
}
/*
  
  node Q-Math/Q-cpmm.js output/1_pools.json 1000000000 results/_CPMM.json
  node engine/Q-dlmm.js output/1_pools.json 1000000000 results/_DLMM.json
  node engine/Q-whirlpool.js output/pools_batch.json 1000000000 results/_WHIRLPOOL.json
  node Q-Math/Q-clmm.js  output/pools_batch.json  1000000000 results/_CLMM.json
*/
