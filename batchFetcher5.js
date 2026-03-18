// =============================================================================
// FIXED BATCH RESERVE-BASED QUOTE SYSTEM v4.1
// Supports: Raydium CPMM, Raydium CLMM, Orca Whirlpool, Meteora DLMM
// NO CIRCULAR DEPENDENCIES - Clean architecture
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Connection, PublicKey } = require('@solana/web3.js');
const ExcelJS = require('exceljs');
const BN = require('bn.js');
const Decimal = require('decimal.js');
require('dotenv').config();
// -----------------------------------------------------------------------------
// CONSTANTS & HELPERS
// -----------------------------------------------------------------------------
const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const HUBS = new Set([SOL, USDC, USDT]);
const TOKEN_SYMBOLS = {
    [SOL]: 'SOL',
    [USDC]: 'USDC',
    [USDT]: 'USDT',
    'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': 'jitoSOL',
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
    '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': 'stSOL',
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP',
    '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4': 'JLP',
};
function getSymbol(mint) {
    return TOKEN_SYMBOLS[mint] || mint.slice(0, 6) + '…';
}
function toBN(val) {
    if (val === undefined || val === null)
        return new BN(0);
    if (BN.isBN(val))
        return val;
    return new BN(val.toString());
}
function toDecimal(val, decimals = 0) {
    return new Decimal(val.toString()).div(new Decimal(10).pow(decimals));
}
const DEX_MODULE_PATHS = {
    METEORA_DLMM: '../../dist/markets/meteora-dlmm',
    DAMM_V1: './dist/markets/damm-v1',
    DAMM_V2: './dist/markets/damm-v2',
    RAYDIUM_CPMM: './dist/markets/raydium-cpmm',
    RAYDIUM_CLMM: './dist/markets/raydium-clmm',
    RAYDIUM_AMM: './dist/markets/raydium-amm',
    ORCA_WHIRLPOOL: '../../dist/markets/orca-whirlpool',
};
function normalizeDexType(dexType = '') {
    const upper = String(dexType).toUpperCase();
    if (upper.includes('METEORA'))
        return 'METEORA_DLMM';
    if (upper.includes('DAMM') && upper.includes('V1'))
        return 'DAMM_V1';
    if (upper.includes('DAMM') && upper.includes('V2'))
        return 'DAMM_V2';
    if (upper.includes('RAYDIUM') && upper.includes('CLMM'))
        return 'RAYDIUM_CLMM';
    if (upper.includes('RAYDIUM') && upper.includes('CPMM'))
        return 'RAYDIUM_CPMM';
    if (upper.includes('RAYDIUM') && upper.includes('AMM'))
        return 'RAYDIUM_AMM';
    if (upper.includes('ORCA'))
        return 'ORCA_WHIRLPOOL';
    return upper;
}
// -----------------------------------------------------------------------------
// RPC CONNECTION MANAGER
// -----------------------------------------------------------------------------
class RPCConnectionManager {
    constructor() {
        this.rpcUrls = this.getWorkingRpcUrls();
        this.connection = null;
        this.workingUrl = null;
    }
    getWorkingRpcUrls() {
        const urls = [];
        if (process.env.RPC_URL2)
            urls.push(process.env.RPC_URL2);
        if (process.env.RPC_URL1)
            urls.push(process.env.RPC_URL1);
        if (process.env.RPC_URL)
            urls.push(process.env.RPC_URL);
        urls.push('https://api.mainnet-beta.solana.com', 'https://solana-api.projectserum.com');
        return urls.filter(url => url && url.startsWith('http'));
    }
    async getWorkingConnection() {
        for (const url of this.rpcUrls) {
            try {
                console.log(`🔧 Testing RPC: ${url.split('?')[0]}...`);
                const connection = new Connection(url, {
                    commitment: 'confirmed',
                    disableRetryOnRateLimit: false,
                    confirmTransactionInitialTimeout: 10000,
                });
                const version = await Promise.race([
                    connection.getVersion(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
                ]);
                console.log(`✅ Working RPC found: ${url.split('?')[0]}...`);
                console.log(`   Version: ${version['solana-core']}, Feature-set: ${version['feature-set']}`);
                this.connection = connection;
                this.workingUrl = url;
                return connection;
            }
            catch (error) {
                const errorMsg = error.message || '';
                if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
                    console.log(`   ❌ 401 Unauthorized - API key invalid`);
                }
                else if (errorMsg.includes('429')) {
                    console.log(`   ❌ Rate limited (429)`);
                }
                else if (errorMsg.includes('Timeout')) {
                    console.log(`   ❌ Connection timeout`);
                }
                else {
                    console.log(`   ❌ ${errorMsg.substring(0, 50)}`);
                }
                continue;
            }
        }
        throw new Error('❌ No working RPC connection found. Check your API keys.');
    }
    getConnection() {
        if (!this.connection) {
            throw new Error('Connection not initialized. Call getWorkingConnection() first.');
        }
        return this.connection;
    }
}
// -----------------------------------------------------------------------------
// BATCH RESERVE FETCHER
// -----------------------------------------------------------------------------
class BatchReserveFetcher {
    constructor(rpcManager) {
        this.rpcManager = rpcManager;
        this.reserveCache = new Map();
        this.batchSize = 100;
    }
    get connection() {
        return this.rpcManager.getConnection();
    }
    async fetchAllReserves(pools) {
        console.log(`\n🚀 Batch fetching reserves for ${pools.length} pools…`);
        const byDex = this.groupByDex(pools);
        const allResults = new Map();
        for (const [dexType, dexPools] of Object.entries(byDex)) {
            const chunks = this.chunkArray(dexPools, this.batchSize);
            console.log(`   📦 ${dexType}: ${dexPools.length} pools in ${chunks.length} batch(es)`);
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                try {
                    const accounts = await this.connection.getMultipleAccountsInfo(chunk.map(p => new PublicKey(p.address)), 'confirmed');
                    accounts.forEach((account, idx) => {
                        const pool = chunk[idx];
                        if (!account) {
                            allResults.set(pool.address, null);
                            return;
                        }
                        try {
                            const reserves = this.decodeReserves(dexType, account.data, pool);
                            this.reserveCache.set(pool.address, reserves);
                            allResults.set(pool.address, reserves);
                        }
                        catch (err) {
                            allResults.set(pool.address, null);
                        }
                    });
                }
                catch (error) {
                    console.error(`\n   ❌ Batch ${i + 1} failed:`, error.message);
                    chunk.forEach(p => allResults.set(p.address, null));
                }
                if (i < chunks.length - 1)
                    await this.delay(100);
            }
        }
        const successful = Array.from(allResults.values()).filter(r => r !== null).length;
        console.log(`   ✅ Successful decodes: ${successful}/${pools.length}`);
        return allResults;
    }
    groupByDex(pools) {
        const groups = {};
        pools.forEach(p => {
            const dex = (p.market || 'unknown').toUpperCase();
            if (!groups[dex])
                groups[dex] = [];
            groups[dex].push(p);
        });
        return groups;
    }
    chunkArray(arr, size) {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size)
            chunks.push(arr.slice(i, i + size));
        return chunks;
    }
    delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    // Simplified reserve decoder - returns basic info
    decodeReserves(dexType, data, pool) {
        // This is a placeholder - in production you'd use actual DEX SDK decoders
        return {
            reserveA: { amount: new BN(1000000000) },
            reserveB: { amount: new BN(1000000000) },
            feeBps: pool.feeBps || 25,
            dexType: dexType
        };
    }
}
// -----------------------------------------------------------------------------
// QUOTE ENGINE
// -----------------------------------------------------------------------------
class ReserveQuoteEngine {
    constructor(reserveCache, rpcUrl) {
        this.reserveCache = reserveCache || new Map();
        this.rpcUrl = rpcUrl;
        this.connection = null;
        this.dexModules = new Map();
    }
    async getConnection() {
        if (!this.connection) {
            this.connection = new Connection(this.rpcUrl, 'confirmed');
        }
        return this.connection;
    }
    loadDexModule(dexType) {
        const normalized = normalizeDexType(dexType);
        if (!normalized)
            return null;
        if (this.dexModules.has(normalized))
            return this.dexModules.get(normalized);
        const modulePath = DEX_MODULE_PATHS[normalized];
        if (!modulePath) {
            this.dexModules.set(normalized, null);
            return null;
        }
        const absolutePath = path.resolve(modulePath);
        if (!fs.existsSync(absolutePath) && !fs.existsSync(`${absolutePath}.js`)) {
            this.dexModules.set(normalized, null);
            return null;
        }
        const mod = require(absolutePath);
        this.dexModules.set(normalized, mod);
        return mod;
    }
    getQuoteViaDexModule(pool, inputMint, outputMint, amountIn) {
        const dexType = normalizeDexType(pool.market || pool.dexType);
        const dex = this.loadDexModule(dexType);
        if (!dex || !dex.price)
            return null;
        const amount = toBN(amountIn);
        const amountAsString = amount.toString();
        const poolArg = { ...pool, dexType };
        const quoteArgs = [poolArg, inputMint, outputMint, amountAsString, this.reserveCache];
        const quoteFn = dex.price.getQuote ||
            dex.price.quote ||
            dex.price.getSwapQuote ||
            dex.price.computeSwapQuote;
        if (typeof quoteFn !== 'function')
            return null;
        const rawQuote = quoteFn(...quoteArgs);
        if (!rawQuote)
            return null;
        const amountOutRaw = rawQuote.amountOut || rawQuote.outAmount || rawQuote.outputAmount;
        if (!amountOutRaw)
            return null;
        return {
            amountOut: toBN(amountOutRaw),
            feeBps: Number(rawQuote.feeBps ?? rawQuote.fee ?? pool.feeBps ?? 25),
            source: `dex-module:${dexType}`,
        };
    }
    getQuoteFixed(pool, inputMint, outputMint, amountIn) {
        try {
          















            
        catch (error) {
                console.warn(`Quote error for ${pool.market} ${pool.address?.slice(0, 8)}: ${error.message}`);
                return { amountOut: new BN(0), feeBps: pool.feeBps || 25 };
            }
        }
    quoteThreeLegRoute(route, amountInLamports) {
            const q1 = this.getQuoteFixed(route.leg1, route.leg1.inputMint, route.leg1.outputMint, amountInLamports);
            if (!q1 || q1.amountOut.isZero())
                return null;
            const q2 = this.getQuoteFixed(route.leg2, route.leg2.inputMint, route.leg2.outputMint, q1.amountOut);
            if (!q2 || q2.amountOut.isZero())
                return null;
            const q3 = this.getQuoteFixed(route.leg3, route.leg3.inputMint, route.leg3.outputMint, q2.amountOut);
            if (!q3 || q3.amountOut.isZero())
                return null;
            const amountIn = toBN(amountInLamports);
            const profitLamports = q3.amountOut.sub(amountIn);
            const profitBps = amountIn.isZero() ? 0 : profitLamports.muln(10000).div(amountIn).toNumber();
            return {
                q1,
                q2,
                q3,
                amountIn: amountIn.toString(),
                amountOut: q3.amountOut.toString(),
                profitLamports: profitLamports.toString(),
                profitBps,
            };
        }
    }
}
// -----------------------------------------------------------------------------
// PRICE DIFF CALCULATION
// -----------------------------------------------------------------------------
function calculatePriceDiffs(results, testAmountLamports) {
    if (results.length === 0)
        return [];
    const byPair = {};
    results.forEach(r => {
        const pairKey = r.pair || `${getSymbol(r.inputMint)}/${getSymbol(r.outputMint)}`;
        if (!byPair[pairKey])
            byPair[pairKey] = [];
        byPair[pairKey].push(r);
    });
    const processed = [];
    Object.entries(byPair).forEach(([pair, items]) => {
        items.sort((a, b) => {
            if (a.quote.amountOut.gt(b.quote.amountOut))
                return -1;
            if (a.quote.amountOut.lt(b.quote.amountOut))
                return 1;
            return 0;
        });
        const best = items[0];
        const bestAmount = best.quote.amountOut;
        items.forEach(item => {
            const diffBps = bestAmount.sub(item.quote.amountOut)
                .mul(new BN(10000))
                .div(bestAmount)
                .toNumber();
            processed.push({
                pair,
                poolType: item.market,
                address: item.address,
                tvl: item.liquidity,
                amountOutRaw: item.quote.amountOut.toString(),
                amountOutReadable: toDecimal(item.quote.amountOut, 9).toFixed(6),
                priceDiffBps: diffBps,
                priceDiffPct: (diffBps / 100).toFixed(2) + '%',
                feeBps: item.quote.feeBps,
                isBestInPair: item === best,
                inputMint: item.inputMint,
                outputMint: item.outputMint,
            });
        });
    });
    return processed.sort((a, b) => a.priceDiffBps - b.priceDiffBps);
}
// -----------------------------------------------------------------------------
// POOL LOADING & CATEGORIZATION
// -----------------------------------------------------------------------------
function loadPools(filePath) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    if (!fs.existsSync(resolved))
        throw new Error(`File not found: ${resolved}`);
    const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const pools = Array.isArray(raw) ? raw : (raw.pools || raw.data || []);
    return pools.map(p => ({
        address: p.address || p.poolAddress || p.id,
        market: (p.market || p.dex || 'unknown').toUpperCase(),
        mintA: p.mintA || p.baseMint || p.tokenMintA,
        mintB: p.mintB || p.quoteMint || p.tokenMintB,
        impact: Number(p.impact ?? p.priceImpact ?? 0),
        slippage: Number(p.poolBaseSlippage ?? p.slippage ?? 0),
        feeBps: Number(p.feeBps || p.feeRate || 0),
        liquidity: Number(p.liquidity || p.tvl || 0),
        source: p.source || '',
    })).filter(p => p.address && p.mintA && p.mintB);
}
function categorizePools(pools) {
    const leg1 = []; // SOL → X
    const leg2 = []; // X → Y
    const leg3 = []; // Y → SOL
    const leg1Seen = new Set();
    const leg2Seen = new Set();
    const leg3Seen = new Set();
    for (const p of pools) {
        const isASOL = p.mintA === SOL;
        const isBSOL = p.mintB === SOL;
        if (isASOL && !isBSOL) {
            const key1 = `${p.address}:sol→${p.mintB}`;
            if (!leg1Seen.has(key1)) {
                leg1Seen.add(key1);
                leg1.push({ ...p, inputMint: SOL, outputMint: p.mintB, pair: `SOL/${getSymbol(p.mintB)}` });
            }
            const key3 = `${p.address}:${p.mintB}→sol`;
            if (!leg3Seen.has(key3)) {
                leg3Seen.add(key3);
                leg3.push({ ...p, inputMint: p.mintB, outputMint: SOL, pair: `${getSymbol(p.mintB)}/SOL` });
            }
        }
        else if (isBSOL && !isASOL) {
            const key1 = `${p.address}:sol→${p.mintA}`;
            if (!leg1Seen.has(key1)) {
                leg1Seen.add(key1);
                leg1.push({ ...p, inputMint: SOL, outputMint: p.mintA, pair: `SOL/${getSymbol(p.mintA)}` });
            }
            const key3 = `${p.address}:${p.mintA}→sol`;
            if (!leg3Seen.has(key3)) {
                leg3Seen.add(key3);
                leg3.push({ ...p, inputMint: p.mintA, outputMint: SOL, pair: `${getSymbol(p.mintA)}/SOL` });
            }
        }
        else if (!isASOL && !isBSOL) {
            const isKnown = (m) => TOKEN_SYMBOLS[m] || HUBS.has(m);
            if (isKnown(p.mintA) || isKnown(p.mintB)) {
                const keyFwd = `${p.address}:${p.mintA}→${p.mintB}`;
                if (!leg2Seen.has(keyFwd)) {
                    leg2Seen.add(keyFwd);
                    leg2.push({
                        ...p,
                        inputMint: p.mintA,
                        outputMint: p.mintB,
                        pair: `${getSymbol(p.mintA)}/${getSymbol(p.mintB)}`,
                    });
                }
                const keyRev = `${p.address}:${p.mintB}→${p.mintA}`;
                if (!leg2Seen.has(keyRev)) {
                    leg2Seen.add(keyRev);
                    leg2.push({
                        ...p,
                        inputMint: p.mintB,
                        outputMint: p.mintA,
                        pair: `${getSymbol(p.mintB)}/${getSymbol(p.mintA)}`,
                    });
                }
            }
        }
    }
    return { leg1, leg2, leg3 };
}
async function batchQuoteCategory(fetcher, engine, pools, testAmountLamports, label) {
    console.log(`\n📊 Batch quoting ${pools.length} ${label} pools…`);
    const results = [];
    for (const pool of pools) {
        const quote = engine.getQuoteFixed(pool, pool.inputMint, pool.outputMint, testAmountLamports);
        if (quote && quote.amountOut && !quote.amountOut.isZero()) {
            results.push({
                ...pool,
                quote: {
                    amountOut: quote.amountOut,
                    feeBps: quote.feeBps
                }
            });
        }
    }
    console.log(`  ✅ Got ${results.length} valid quotes`);
    return results;
}
// -----------------------------------------------------------------------------
// EXPORT & TRIANGLE GENERATION
// -----------------------------------------------------------------------------
async function exportAnalysis(leg1Data, leg2Data, leg3Data, testAmountSOL) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportDir = path.resolve('exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const wb = new ExcelJS.Workbook();
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    const bestFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
    const goodFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
    const badFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };
    function createSheet(name, data, columns) {
        const ws = wb.addWorksheet(name);
        ws.columns = columns;
        const hdr = ws.getRow(1);
        hdr.eachCell(c => {
            c.fill = headerFill;
            c.font = headerFont;
            c.alignment = { horizontal: 'center' };
        });
        const diffColumnIndex = columns.findIndex(c => c.key === 'priceDiffBps') + 1;
        const pairColumnIndex = columns.findIndex(c => c.key === 'pair') + 1;
        data.forEach((row) => {
            const r = ws.addRow(row);
            const hasDiffColumn = diffColumnIndex > 0;
            const hasPairColumn = pairColumnIndex > 0;
            const diffCell = hasDiffColumn ? r.getCell(diffColumnIndex) : null;
            if (row.isBestInPair) {
                if (diffCell)
                    diffCell.fill = bestFill;
                if (hasPairColumn)
                    r.getCell(pairColumnIndex).fill = bestFill;
            }
            else if (typeof row.priceDiffBps === 'number' && hasDiffColumn) {
                if (row.priceDiffBps < 50) {
                    diffCell.fill = goodFill;
                }
                else if (row.priceDiffBps > 200) {
                    diffCell.fill = badFill;
                }
            }
        });
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
        return ws;
    }
    createSheet('Leg1_SOL_X', leg1Data, [
        { header: 'Rank', key: 'rank', width: 6 },
        { header: 'Pair', key: 'pair', width: 15 },
        { header: 'Pool Type', key: 'poolType', width: 18 },
        { header: 'TVL', key: 'tvl', width: 12 },
        { header: 'Amount Out (raw)', key: 'amountOutRaw', width: 20 },
        { header: 'Amount Out', key: 'amountOutReadable', width: 12 },
        { header: 'Price Diff (bps)', key: 'priceDiffBps', width: 15 },
        { header: 'Price Diff %', key: 'priceDiffPct', width: 12 },
        { header: 'Fee (bps)', key: 'feeBps', width: 10 },
        { header: 'Best?', key: 'isBestInPair', width: 8 },
        { header: 'Pool Address', key: 'address', width: 46 },
        { header: 'Input Mint', key: 'inputMint', width: 46 },
        { header: 'Output Mint', key: 'outputMint', width: 46 },
    ]);
    createSheet('Leg2_X_Y', leg2Data, [
        { header: 'Rank', key: 'rank', width: 6 },
        { header: 'Pair', key: 'pair', width: 12 },
        { header: 'Pool Type', key: 'poolType', width: 18 },
        { header: 'TVL', key: 'tvl', width: 12 },
        { header: 'Amount Out (raw)', key: 'amountOutRaw', width: 20 },
        { header: 'Amount Out', key: 'amountOutReadable', width: 12 },
        { header: 'Price Diff (bps)', key: 'priceDiffBps', width: 15 },
        { header: 'Price Diff %', key: 'priceDiffPct', width: 12 },
        { header: 'Fee (bps)', key: 'feeBps', width: 10 },
        { header: 'Best?', key: 'isBestInPair', width: 8 },
        { header: 'Pool Address', key: 'address', width: 46 },
    ]);
    createSheet('Leg3_Y_SOL', leg3Data, [
        { header: 'Rank', key: 'rank', width: 6 },
        { header: 'Pair', key: 'pair', width: 12 },
        { header: 'Pool Type', key: 'poolType', width: 18 },
        { header: 'TVL', key: 'tvl', width: 12 },
        { header: 'Amount Out (raw)', key: 'amountOutRaw', width: 20 },
        { header: 'Amount Out', key: 'amountOutReadable', width: 12 },
        { header: 'Price Diff (bps)', key: 'priceDiffBps', width: 15 },
        { header: 'Price Diff %', key: 'priceDiffPct', width: 12 },
        { header: 'Fee (bps)', key: 'feeBps', width: 10 },
        { header: 'Best?', key: 'isBestInPair', width: 8 },
        { header: 'Pool Address', key: 'address', width: 46 },
        { header: 'Input Mint', key: 'inputMint', width: 46 },
        { header: 'Output Mint', key: 'outputMint', width: 46 },
    ]);
    const triangles = generateTriangleCandidates(leg1Data, leg2Data, leg3Data);
    createSheet('Triangle_Candidates', triangles, [
        { header: 'Rank', key: 'rank', width: 6 },
        { header: 'Path', key: 'path', width: 25 },
        { header: 'Est. Profit (bps)', key: 'estProfitBps', width: 15 },
        { header: 'Total Fees', key: 'totalFees', width: 12 },
        { header: 'Leg1 Pool', key: 'leg1Pool', width: 20 },
        { header: 'Leg2 Pool', key: 'leg2Pool', width: 20 },
        { header: 'Leg3 Pool', key: 'leg3Pool', width: 20 },
        { header: 'Leg1 Diff', key: 'leg1Diff', width: 8 },
        { header: 'Leg2 Diff', key: 'leg2Diff', width: 8 },
        { header: 'Leg3 Diff', key: 'leg3Diff', width: 8 },
        { header: 'Combined Score', key: 'score', width: 10 },
    ]);
    const xlsxPath = path.join(exportDir, `batch_analysis_${timestamp}.xlsx`);
    await wb.xlsx.writeFile(xlsxPath);
    const jsonPath = path.join(exportDir, `batch_analysis_${timestamp}.json`);
    const payload = {
        timestamp: new Date().toISOString(),
        testAmountSOL,
        leg1: leg1Data,
        leg2: leg2Data,
        leg3: leg3Data,
        triangleCandidates: triangles.slice(0, 40),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    const selectedPath = path.join(exportDir, './exports/selected_3leg_routes.json');
    fs.writeFileSync(selectedPath, JSON.stringify(payload, null, 2));
    console.log(`\n💾 Exported:`);
    console.log(`   XLSX: ${xlsxPath}`);
    console.log(`   JSON: ${jsonPath}`);
    return { xlsxPath, jsonPath, selectedPath, triangles };
}
function generateTriangleCandidates(leg1, leg2, leg3) {
    const candidates = [];
    const seen = new Set();
    const THRESHOLD_L1 = 5;
    const THRESHOLD_L2 = 8;
    const THRESHOLD_L3 = 5;
    const TOP_N = 15;
    const bestLeg1 = leg1.filter(l => l.priceDiffBps <= THRESHOLD_L1).slice(0, TOP_N);
    const bestLeg2 = leg2.filter(l => l.priceDiffBps <= THRESHOLD_L2).slice(0, TOP_N);
    const bestLeg3 = leg3.filter(l => l.priceDiffBps <= THRESHOLD_L3).slice(0, TOP_N);
    console.log(`\n🔺 Generating triangle candidates (TIGHT thresholds):`);
    console.log(`   Leg1 ≤${THRESHOLD_L1}bps: ${bestLeg1.length} pools (from ${leg1.length})`);
    console.log(`   Leg2 ≤${THRESHOLD_L2}bps: ${bestLeg2.length} pools (from ${leg2.length})`);
    console.log(`   Leg3 ≤${THRESHOLD_L3}bps: ${bestLeg3.length} pools (from ${leg3.length})`);
    for (const l1 of bestLeg1) {
        const tokenX = l1.outputMint;
        for (const l2 of bestLeg2) {
            if (l2.inputMint !== tokenX)
                continue;
            const tokenY = l2.outputMint;
            for (const l3 of bestLeg3) {
                if (l3.inputMint !== tokenY || l3.outputMint !== SOL)
                    continue;
                const comboKey = `${l1.address}|${l2.address}|${l3.address}`;
                if (seen.has(comboKey))
                    continue;
                seen.add(comboKey);
                const totalFees = l1.feeBps + l2.feeBps + l3.feeBps;
                const totalDiff = l1.priceDiffBps + l2.priceDiffBps + l3.priceDiffBps;
                const estProfit = -totalDiff - totalFees;
                const isCrossDex = l1.poolType !== l3.poolType;
                const crossDexBonus = isCrossDex ? 2 : 0;
                const score = estProfit + crossDexBonus;
                candidates.push({
                    path: `SOL → ${getSymbol(tokenX)} → ${getSymbol(tokenY)} → SOL`,
                    estProfitBps: estProfit,
                    totalFees,
                    leg1Pool: l1.address.slice(0, 8) + '…',
                    leg2Pool: l2.address.slice(0, 8) + '…',
                    leg3Pool: l3.address.slice(0, 8) + '…',
                    leg1Diff: l1.priceDiffBps,
                    leg2Diff: l2.priceDiffBps,
                    leg3Diff: l3.priceDiffBps,
                    score,
                    leg1Full: l1,
                    leg2Full: l2,
                    leg3Full: l3,
                });
            }
        }
    }
    const sorted = candidates.sort((a, b) => b.score - a.score);
    if (sorted.length > 0) {
        console.log(`\n   📊 Generated ${sorted.length} candidates`);
        console.log(`   Top 15:`);
        sorted.slice(0, 15).forEach((c, i) => {
            console.log(`     ${i + 1}. ${c.path}  est=${c.estProfitBps.toFixed(1)}bps  fees=${c.totalFees}  score=${c.score.toFixed(1)}`);
        });
    }
    return sorted;
}
// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------
async function main() {
    const args = process.argv.slice(8);
    const poolsFile = args[0] || `exports/3leg_analysis_${timestamp}json`;  //
    const testAmountSOL = parseFloat(args[1]) || 1.0;
    console.log('═'.repeat(70));
    console.log('  CLEANED BATCH RESERVE-BASED 3-LEG ANALYSIS');
    console.log('═'.repeat(70));
    console.log(`📁 Pools: ${poolsFile}`);
    console.log(`💰 Test amount: ${testAmountSOL} SOL\n`);
    try {
        const rpcManager = new RPCConnectionManager();
        await rpcManager.getWorkingConnection();
        const pools = loadPools(poolsFile);
        console.log(`📊 Loaded ${pools.length} pools`);
        const { leg1, leg2, leg3 } = categorizePools(pools);
        console.log(`\n📋 Categorized:`);
        console.log(`   Leg1 (SOL/X): ${leg1.length} pools`);
        console.log(`   Leg2 (X/Y):   ${leg2.length} pools`);
        console.log(`   Leg3 (Y/SOL): ${leg3.length} pools`);
        const fetcher = new BatchReserveFetcher(rpcManager);
        const engine = new ReserveQuoteEngine(fetcher.reserveCache, rpcManager.workingUrl);
        const testAmountLamports = new BN(Math.round(testAmountSOL * 1e9));
        const startTime = Date.now();
        const allLegPools = [...leg1, ...leg2, ...leg3];
        await fetcher.fetchAllReserves(allLegPools);
        // Sequential processing to avoid rate limits
        const leg1Quoted = await batchQuoteCategory(fetcher, engine, leg1, testAmountLamports, 'Leg 1 (SOL/X)');
        const leg2Quoted = await batchQuoteCategory(fetcher, engine, leg2, testAmountLamports, 'Leg 2 (X/Y)');
        const leg3Quoted = await batchQuoteCategory(fetcher, engine, leg3, testAmountLamports, 'Leg 3 (Y/SOL)');
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const leg1Data = calculatePriceDiffs(leg1Quoted, testAmountLamports).map((d, i) => ({ ...d, rank: i + 1 }));
        const leg2Data = calculatePriceDiffs(leg2Quoted, testAmountLamports).map((d, i) => ({ ...d, rank: i + 1 }));
        const leg3Data = calculatePriceDiffs(leg3Quoted, testAmountLamports).map((d, i) => ({ ...d, rank: i + 1 }));
        await exportAnalysis(leg1Data, leg2Data, leg3Data, testAmountSOL);
        console.log(`\n⏱️  Total time: ${duration}s`);
    }
    catch (error) {
        console.error('\n❌ Fatal Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}
// -----------------------------------------------------------------------------
// EXPORTS - Clean exports with NO circular dependencies
// -----------------------------------------------------------------------------
module.exports = {
    // Core classes
    RPCConnectionManager,
    BatchReserveFetcher,
    ReserveQuoteEngine,
    // Utility functions
    categorizePools,
    calculatePriceDiffs,
    generateTriangleCandidates,
    loadPools,
    getSymbol,
    toBN,
    toDecimal,
    // Constants
    SOL,
    USDC,
    USDT,
    HUBS,
    TOKEN_SYMBOLS,
    // Main entry
    main,
    batchQuoteCategory
};
if (require.main === module) {
    main().catch(console.error);
}
//. node core/batchFetcher5.js  pool_list_enriched.json