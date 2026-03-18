'use strict';
/**
 * triangleRunner4.js — Triangle Arbitrage Execution Runner
 * 
 * Depends on: batchFetcher4.js (core engine)
 * NO circular dependencies
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Connection, PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');
const ExcelJS = require('exceljs');

// Import from batchFetcher4.js ONLY
const {
    RPCConnectionManager,
    BatchReserveFetcher,
    ReserveQuoteEngine,
    categorizePools,
    calculatePriceDiffs,
    generateTriangleCandidates,
    loadPools,
    getSymbol,
    SOL,
    USDC,
    USDT,
    toBN,
    batchQuoteCategory
} = require('./batchFetcher4.js');

const EXPORT_DIR = path.resolve('exports');
const C = {
    green: '[32m',
    red: '[31m',
    yellow: '[33m',
    cyan: '[36m',
    dim: '[2m',
    reset: '[0m'
};

const CONFIG = {
    MIN_POOL_LIQ: 250000,
    MIN_PROFIT_BPS: 1,
    MAX_TOTAL_FEE_BPS: 15,
    TOXIC_FEE_TIERS: new Set([25, 29, 30, 100, 250, 300, 500, 1000]),
    CONCURRENCY_PER_RPC: 2,
    BASE_DELAY_MS: 200,
    MAX_RETRIES: 2,
    COOLDOWN_AFTER_429_MS: 5000,
    OPTIMAL_SIZE_SEARCH: true,
    BIDIRECTIONAL_QUOTE: true,
};

const PUBLIC_RPC_ENDPOINTS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana',
];

// ════════════════════════════════════════════════════════════════════════
// ENHANCED RPC MANAGER
// ════════════════════════════════════════════════════════════════════════
class RPCManager {
    constructor() {
        const privateUrl = process.env.RPC_URL;
        this.connectionManager = new RPCConnectionManager(privateUrl, 'https://mainnet.helius-rpc.com/?api-key=2abdf423-a7a5-43a1-9912-438f00454906');
        this.privateEndpoints = [];
        this.publicEndpoints = [];
        this.usingPublicFallback = false;


        if (privateUrl && privateUrl.startsWith('http')) {
            this.privateEndpoints.push({
                url: privateUrl,
                index: 0,
                type: 'private',
                connection: null,
                lastError: 0,
                failed: false,
            });
        }

        PUBLIC_RPC_ENDPOINTS.forEach((url, idx) => {
            this.publicEndpoints.push({
                url: url,
                index: idx + 100,
                type: 'public',
                connection: null,
                lastError: 0,
                failed: false,
            });
        });

        this.currentIndex = 0;
        this.authFailureCount = 0;
    }

    async initialize() {
        await this.connectionManager.getWorkingConnection();
    }

    get connection() {
        return this.connectionManager.getConnection();
    }

    getHealthyEndpoints() {
        const now = Date.now();
        if (this.usingPublicFallback) {
            return this.publicEndpoints.filter(e => !e.failed && (now - e.lastError > 3000));
        }
        const healthyPrivate = this.privateEndpoints.filter(e =>
            !e.failed && (now - e.lastError > CONFIG.COOLDOWN_AFTER_429_MS)
        );
        if (healthyPrivate.length > 0) return healthyPrivate;
        console.log(`${C.yellow}⚠ Switching to public RPC fallback${C.reset}`);
        this.usingPublicFallback = true;
        return this.publicEndpoints.filter(e => !e.failed);
    }

    getNextConnection() {
        const healthy = this.getHealthyEndpoints();
        if (healthy.length === 0) return null;
        const conn = healthy[this.currentIndex % healthy.length];
        this.currentIndex++;
        return conn;
    }

    markFailed(index, error) {
        const isPrivate = index < 100;
        const collection = isPrivate ? this.privateEndpoints : this.publicEndpoints;
        const endpoint = collection.find(e => e.index === index);

        if (endpoint) {
            endpoint.lastError = Date.now();
            const isAuthError = error.message?.includes('401') ||
                error.message?.includes('invalid api key') ||
                error.message?.includes('Unauthorized');

            if (isAuthError && isPrivate) {
                console.log(`${C.red}🔒 Auth failed for private RPC${C.reset}`);
                endpoint.failed = true;
                this.authFailureCount++;
                if (this.authFailureCount >= this.privateEndpoints.length) {
                    this.usingPublicFallback = true;
                }
            } else if (error.message?.includes('429')) {
                console.log(`${C.yellow}⏱ Rate limited, cooling down${C.reset}`);
            } else {
                endpoint.failed = true;
                setTimeout(() => { endpoint.failed = false; }, 10000);
            }
        }
    }

    getStats() {
        return {
            private: this.privateEndpoints.map(e => ({
                url: e.url.replace(/api-key=.*/, 'api-key=***'),
                failed: e.failed,
                type: e.type
            })),
            public: this.publicEndpoints.map(e => ({
                url: e.url,
                failed: e.failed,
                type: e.type
            })),
            usingFallback: this.usingPublicFallback
        };
    }
}

// ════════════════════════════════════════════════════════════════════════
// CONCURRENCY CONTROLLER
// ════════════════════════════════════════════════════════════════════════
class ConcurrencyController {
    constructor(rpcManager, maxConcurrency) {
        this.connector = new ConcurrencyController(privateUrl, 'confirmed');
        this.rpcManager = rpcManager(privateUrl, 'https://mainnet.helius-rpc.com/?api-key=2abdf423-a7a5-43a1-9912-438f00454906', 'confirmed');
        this.maxConcurrency = maxConcurrency;
        this.running = new Set();
        this.queue = [];
        this.authErrors = 0;
    }

    async execute(taskFn, ...args) {
        if (this.running.size >= this.maxConcurrency) {
            await new Promise(resolve => this.queue.push(resolve));
        }

        const promise = this.runTask(taskFn, ...args);
        this.running.add(promise);

        promise.finally(() => {
            this.running.delete(promise);
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                next();
            }
        });

        return promise;
    }

    async runTask(taskFn, ...args) {
        for (let attempt = 0; attempt < CONFIG.MAX_RETRIES; attempt++) {
            const rpc = this.rpcManager.getNextConnection();
            if (!rpc) {
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            try {
                const result = await taskFn(this.rpcManager.connection, ...args);
                return result;
            } catch (err) {
                const isAuthError = err.message?.includes('401') ||
                    err.message?.includes('invalid api key') ||
                    err.message?.includes('Unauthorized');

                if (isAuthError) {
                    this.rpcManager.markFailed(rpc.index, err);
                    this.authErrors++;
                    console.log(`${C.red}🔐 Auth error on attempt ${attempt + 1}${C.reset}`);
                    continue;
                }

                if (err.message?.includes('429')) {
                    this.rpcManager.markFailed(rpc.index, err);
                    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    continue;
                }

                if (attempt === CONFIG.MAX_RETRIES - 1) throw err;
            }
        }
        throw new Error('Max retries exceeded');
    }

    async drain() {
        await Promise.all([...this.running]);
    }
}

// ════════════════════════════════════════════════════════════════════════
// POOL LOADING & TRIANGLE FINDING
// ════════════════════════════════════════════════════════════════════════
function filterPools(pools) {
    return pools.filter(p => {
        const liq = Number(p.liquidity || p.tvl || 0);
        const fee = Number(p.feeBps || p.feeRate || 0);
        if (liq < CONFIG.MIN_POOL_LIQ) return false;
        if (CONFIG.TOXIC_FEE_TIERS.has(fee)) return false;
        if (!p.address && !p.poolAddress && !p.id) return false;
        if (!p.mintA && !p.baseMint && !p.tokenMintA) return false;
        if (!p.mintB && !p.quoteMint && !p.tokenMintB) return false;
        return true;
    });
}

function sym(mint) {
    return getSymbol(mint);
}

function getLiq(pool) {
    return Number(pool.liquidity || pool.tvl || 0);
}

function getFeeBps(pool) {
    const raw = pool.feeBps ?? pool.feeRate;
    if (raw !== undefined && raw !== null) {
        const n = Number(raw);
        if (n >= 1) return Math.round(n);
        if (n > 0 && n < 1) return Math.round(n * 10000);
    }
    return 0;
}

function normalizePool(p) {
    return {
        address: p.address || p.poolAddress || p.id,
        market: (p.market || p.dex || 'unknown').toUpperCase(),
        mintA: p.mintA || p.baseMint || p.tokenMintA,
        mintB: p.mintB || p.quoteMint || p.tokenMintB,
        feeBps: getFeeBps(p),
        liquidity: getLiq(p),
        source: p.source || p.type || '',
    };
}

function buildPairMap(pools) {
    const pairMap = new Map();
    for (const raw of pools) {
        const p = normalizePool(raw);
        if (!p.mintA || !p.mintB || !p.address) continue;

        // Normalize market names
        if (p.market === 'ORCA') p.market = 'ORCA_WHIRLPOOL';
        if (p.market === 'RAYDIUM' && (p.source === 'clmm' || raw.type === 'clmm')) p.market = 'RAYDIUM_CLMM';
        if (p.market === 'RAYDIUM' && (p.source === 'cpmm' || raw.type === 'cpmm')) p.market = 'RAYDIUM_CPMM';
        if (p.market === 'RAYDIUM' && !p.market.includes('_')) p.market = 'RAYDIUM_AMM';
        if (p.market === 'METEORA') p.market = 'METEORA_DLMM';

        for (const k of [`${p.mintA}-${p.mintB}`, `${p.mintB}-${p.mintA}`]) {
            if (!pairMap.has(k)) pairMap.set(k, []);
            pairMap.get(k).push(p);
        }
    }
    return pairMap;
}

function getConnectedMints(pairMap, mint) {
    const out = new Set();
    for (const k of pairMap.keys()) {
        if (k.startsWith(mint + '-')) out.add(k.split('-')[1]);
    }
    return [...out];
}

function getPoolsByDex(pairMap, mintA, mintB) {
    const pools = pairMap.get(`${mintA}-${mintB}`) || pairMap.get(`${mintB}-${mintA}`) || [];
    const byDexFee = new Map();
    for (const p of pools) {
        const dex = (p.market || 'unknown').toUpperCase();
        const fee = getFeeBps(p);
        const key = `${dex}:${fee}`;
        if (!byDexFee.has(key) || getLiq(p) > getLiq(byDexFee.get(key))) {
            byDexFee.set(key, p);
        }
    }
    return [...byDexFee.values()].sort((a, b) => {
        const feeA = getFeeBps(a), feeB = getFeeBps(b);
        if (feeA !== feeB) return feeA - feeB;
        return getLiq(b) - getLiq(a);
    });
}

const ARB_TOKEN_WHITELIST = new Set([
    USDC,
    USDT,
    'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
]);

function findTriangles(pairMap) {
    const tokenBs = getConnectedMints(pairMap, SOL);
    const triangles = [];
    const seenCombos = new Set();

    for (const tokenB of tokenBs) {
        if (!ARB_TOKEN_WHITELIST.has(tokenB)) continue;
        const tokenCs = getConnectedMints(pairMap, tokenB);

        for (const tokenC of tokenCs) {
            if (tokenC === SOL || tokenC === tokenB) continue;
            if (!ARB_TOKEN_WHITELIST.has(tokenC)) continue;

            const poolsAB = getPoolsByDex(pairMap, SOL, tokenB);
            const poolsBC = getPoolsByDex(pairMap, tokenB, tokenC);
            const poolsCA = getPoolsByDex(pairMap, tokenC, SOL);

            if (!poolsAB.length || !poolsBC.length || !poolsCA.length) continue;

            for (const pAB of poolsAB.slice(0, 3)) {
                for (const pCA of poolsCA.slice(0, 3)) {
                    for (const pBC of poolsBC.slice(0, 3)) {
                        const comboKey = `${pAB.address}-${pBC.address}-${pCA.address}`;
                        if (seenCombos.has(comboKey)) continue;
                        seenCombos.add(comboKey);

                        const feeAB = getFeeBps(pAB);
                        const feeBC = getFeeBps(pBC);
                        const feeCA = getFeeBps(pCA);
                        const totalFee = feeAB + feeBC + feeCA;

                        if (totalFee > CONFIG.MAX_TOTAL_FEE_BPS) {
                            const dexAB = (pAB.market || '').toUpperCase();
                            const dexCA = (pCA.market || '').toUpperCase();
                            if (dexAB === dexCA) continue;
                        }

                        const liqMin = Math.min(getLiq(pAB), getLiq(pBC), getLiq(pCA));
                        const dexAB = (pAB.market || '').toUpperCase();
                        const dexBC = (pBC.market || '').toUpperCase();
                        const dexCA = (pCA.market || '').toUpperCase();

                        const crossDexBonus = (dexAB !== dexCA) ? 500 : 0;
                        const feePenalty = totalFee * 2;
                        const liqBonus = Math.log10(Math.max(liqMin, 1));

                        triangles.push({
                            path: `${sym(SOL)} → ${sym(tokenB)} → ${sym(tokenC)} → ${sym(SOL)}`,
                            combo: `${dexAB.slice(0, 8)}→${dexBC.slice(0, 8)}→${dexCA.slice(0, 8)}`,
                            tokenA: SOL, tokenB, tokenC,
                            poolAB: pAB, poolBC: pBC, poolCA: pCA,
                            totalFeeBps: totalFee,
                            liqMin,
                            isCrossDex: dexAB !== dexCA,
                            priorityScore: crossDexBonus - feePenalty + liqBonus,
                        });
                    }
                }
            }
        }
    }
    return triangles.sort((a, b) => b.priorityScore - a.priorityScore);
}

// ════════════════════════════════════════════════════════════════════════
// QUOTING FUNCTIONS
// ════════════════════════════════════════════════════════════════════════
async function quoteTriangle(connection, tri, amountInLamports) {
    const { poolAB, poolBC, poolCA, tokenA, tokenB, tokenC } = tri;

    const engine = new ReserveQuoteEngine(new Map());
    const legRoute = {
        leg1: { ...poolAB, inputMint: tokenA, outputMint: tokenB },
        leg2: { ...poolBC, inputMint: tokenB, outputMint: tokenC },
        leg3: { ...poolCA, inputMint: tokenC, outputMint: tokenA },
    };

    const routeQuote = engine.quoteThreeLegRoute(legRoute, amountInLamports);
    if (!routeQuote) return null;

    const qAB = routeQuote.q1;
    const qBC = routeQuote.q2;
    const qCA = routeQuote.q3;

    const profitLamports = new BN(routeQuote.profitLamports);
    const profitBps = routeQuote.profitBps;
    const inputSol = Number(amountInLamports.toString()) / 1e9;

    return {
        path: tri.path,
        combo: tri.combo || '',
        isCrossDex: tri.isCrossDex || false,
        tokenB: tri.tokenB, tokenC: tri.tokenC,
        amountIn: amountInLamports.toString(),
        inputSol,
        outAB: qAB.amountOut.toString(),
        outBC: qBC.amountOut.toString(),
        outCA: qCA.amountOut.toString(),
        profitLamports: profitLamports.toString(),
        profitBps,
        profitPct: (profitBps / 100).toFixed(4),
        profitSOL: (Number(profitLamports.toString()) / 1e9).toFixed(6),
        profitable: profitBps >= CONFIG.MIN_PROFIT_BPS,
        totalFeeBps: (qAB.feeBps || 0) + (qBC.feeBps || 0) + (qCA.feeBps || 0),
        dexTypes: { AB: (poolAB.market || '').toUpperCase(), BC: (poolBC.market || '').toUpperCase(), CA: (poolCA.market || '').toUpperCase() },
        legFees: { AB: qAB.feeBps, BC: qBC.feeBps, CA: qCA.feeBps },
        poolAB: { address: poolAB.address, market: poolAB.market },
        poolBC: { address: poolBC.address, market: poolBC.market },
        poolCA: { address: poolCA.address, market: poolCA.market },
        direction: 'forward',
    };
}

async function quoteTriangleReverse(connection, tri, amountInLamports) {
    const reverseTri = {
        ...tri,
        tokenB: tri.tokenC,
        tokenC: tri.tokenB,
        poolAB: tri.poolCA,
        poolCA: tri.poolAB,
        path: `${sym(SOL)} → ${sym(tri.tokenC)} → ${sym(tri.tokenB)} → ${sym(SOL)}`,
        combo: `${(tri.poolCA.market || '').toUpperCase().slice(0, 8)}→${(tri.poolBC.market || '').toUpperCase().slice(0, 8)}→${(tri.poolAB.market || '').toUpperCase().slice(0, 8)}`,
    };

    const result = await quoteTriangle(connection, reverseTri, amountInLamports);
    if (result) {
        result.direction = 'reverse';
        result.originalPath = tri.path;
    }
    return result;
}

async function findOptimalSize(rpcManager, tri, baseAmountLamports) {
    if (!CONFIG.OPTIMAL_SIZE_SEARCH) {
        return quoteTriangle(rpcManager.connection, tri, baseAmountLamports);
    }

    const testSizes = [
        baseAmountLamports.divn(20),
        baseAmountLamports.divn(10),
        baseAmountLamports.divn(5),
        baseAmountLamports.divn(2),
        baseAmountLamports,
    ].filter(s => s.gtn(10_000_000));

    const results = [];
    const first = await quoteTriangle(rpcManager.connection, tri, testSizes[0]).catch(() => null);
    if (!first) return null;

    results.push({ ...first, optimalSize: true, testSizeSol: testSizes[0].toNumber() / 1e9 });

    if (first.profitBps > 0) {
        for (let i = 1; i < testSizes.length; i++) {
            const res = await quoteTriangle(rpcManager.connection, tri, testSizes[i]).catch(() => null);
            if (res) {
                results.push({ ...res, optimalSize: true, testSizeSol: testSizes[i].toNumber() / 1e9 });
                if (res.profitBps < results[results.length - 2].profitBps * 0.8) break;
            }
        }
    }

    return results.reduce((best, curr) => curr && curr.profitBps > best.profitBps ? curr : best, first);
}

async function quoteBothDirections(rpcManager, tri, amountInLamports) {
    if (!CONFIG.BIDIRECTIONAL_QUOTE) {
        const forward = await quoteTriangle(rpcManager.connection, tri, amountInLamports);
        return { forward, reverse: null, best: forward, direction: 'forward' };
    }

    const [forward, reverse] = await Promise.all([
        quoteTriangle(rpcManager.connection, tri, amountInLamports).catch(() => null),
        quoteTriangleReverse(rpcManager.connection, tri, amountInLamports).catch(() => null)
    ]);

    const forwardBps = forward?.profitBps || -Infinity;
    const reverseBps = reverse?.profitBps || -Infinity;

    if (forwardBps > reverseBps) {
        return { forward, reverse, best: forward, direction: 'forward' };
    } else if (reverseBps > forwardBps) {
        return { forward, reverse, best: reverse, direction: 'reverse' };
    } else {
        return { forward, reverse, best: forward || reverse, direction: 'tie' };
    }
}

async function optimizeAndQuote(rpcManager, tri, baseAmountLamports) {
    const directional = await quoteBothDirections(rpcManager, tri, baseAmountLamports);
    if (!directional.best) return null;
    if (directional.best.profitBps < -50 && !CONFIG.OPTIMAL_SIZE_SEARCH) return directional.best;

    const bestTri = directional.direction === 'reverse' && directional.reverse ?
        { ...tri, tokenB: tri.tokenC, tokenC: tri.tokenB, poolAB: tri.poolCA, poolCA: tri.poolAB, isReverse: true } :
        tri;

    const optimized = await findOptimalSize(rpcManager, bestTri, baseAmountLamports);
    if (!optimized) return directional.best;

    if (directional.direction === 'reverse') {
        optimized.direction = 'reverse';
        optimized.originalPath = tri.path;
    }
    return optimized;
}

// ════════════════════════════════════════════════════════════════════════
// EXPORT & MAIN
// ════════════════════════════════════════════════════════════════════════
async function exportXlsx(results, inputSol, executionMs) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const basePath = path.join(EXPORT_DIR, `arbitrage_${ts}`);

    const sorted = [...results].sort((a, b) => b.profitBps - a.profitBps);
    const profitable = sorted.filter(r => r.profitable);
    const nearProfit = sorted.filter(r => !r.profitable && r.profitBps > -10);

    fs.writeFileSync(`${basePath}.json`, JSON.stringify({
        timestamp: ts, inputSol, executionMs,
        totalQuoted: results.length, profitable: profitable.length, nearProfit: nearProfit.length,
        routes: sorted
    }, null, 2));

    const wb = new ExcelJS.Workbook();
    const HF = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    const HFont = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    const DF = { name: 'Arial', size: 9 };
    const GF = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
    const YF = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
    const RF = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };

    function addSheet(ws, rows) {
        ws.columns = [
            { header: 'Rank', key: 'rank', width: 6 },
            { header: 'Path', key: 'path', width: 40 },
            { header: 'DEX Combo', key: 'combo', width: 30 },
            { header: 'X-DEX', key: 'xdex', width: 6 },
            { header: 'Dir', key: 'direction', width: 8 },
            { header: 'Profit bps', key: 'profitBps', width: 11 },
            { header: 'Profit %', key: 'profitPct', width: 9 },
            { header: 'Profit SOL', key: 'profitSol', width: 12 },
            { header: 'Input SOL', key: 'inputSol', width: 10 },
            { header: 'Opt Size', key: 'optSize', width: 8 },
            { header: 'DEX L1', key: 'dexAB', width: 18 },
            { header: 'L1 Fee', key: 'feeAB', width: 8 },
            { header: 'DEX L2', key: 'dexBC', width: 18 },
            { header: 'L2 Fee', key: 'feeBC', width: 8 },
            { header: 'DEX L3', key: 'dexCA', width: 18 },
            { header: 'L3 Fee', key: 'feeCA', width: 8 },
            { header: 'Σ Fee', key: 'totalFee', width: 8 },
            { header: 'Pool L1', key: 'pAB', width: 46 },
            { header: 'Pool L2', key: 'pBC', width: 46 },
            { header: 'Pool L3', key: 'pCA', width: 46 },
            { header: 'Profitable', key: 'prof', width: 10 },
        ];

        const hdr = ws.getRow(1);
        hdr.eachCell(c => { c.fill = HF; c.font = HFont; c.alignment = { horizontal: 'center' }; });
        hdr.height = 22;
        ws.views = [{ state: 'frozen', ySplit: 1 }];

        rows.forEach((r, i) => {
            const row = ws.addRow({
                rank: i + 1, path: r.path, combo: r.combo || '', xdex: r.isCrossDex ? '⚡' : '',
                direction: r.direction === 'reverse' ? 'REV' : (r.direction === 'forward' ? 'FWD' : ''),
                profitBps: r.profitBps, profitPct: r.profitPct, profitSol: r.profitSOL,
                inputSol: r.inputSol || inputSol, optSize: r.optimalSize ? '✓' : '',
                dexAB: r.dexTypes?.AB, feeAB: r.legFees?.AB, dexBC: r.dexTypes?.BC, feeBC: r.legFees?.BC,
                dexCA: r.dexTypes?.CA, feeCA: r.legFees?.CA, totalFee: r.totalFeeBps,
                pAB: r.poolAB?.address, pBC: r.poolBC?.address, pCA: r.poolCA?.address,
                prof: r.profitable ? 'YES' : (r.profitBps > -10 ? 'NEAR' : 'NO'),
            });
            row.eachCell(c => { c.font = DF; });
            if (r.profitable) { row.getCell('profitBps').fill = GF; row.getCell('prof').fill = GF; }
            else if (r.profitBps > -10) { row.getCell('profitBps').fill = YF; row.getCell('prof').fill = YF; }
            else if (r.profitBps < -50) { row.getCell('profitBps').fill = RF; }
        });

        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
    }

    addSheet(wb.addWorksheet('All Routes'), sorted);
    if (profitable.length) addSheet(wb.addWorksheet('Profitable'), profitable);
    if (nearProfit.length) addSheet(wb.addWorksheet('Near Profit (-10 to 0)'), nearProfit);

    const xlsxPath = `${basePath}.xlsx`;
    await wb.xlsx.writeFile(xlsxPath);

    console.log(`\n💾 ${C.cyan}JSON → ${basePath}.json${C.reset}`);
    console.log(`💾 ${C.cyan}XLSX → ${xlsxPath}${C.reset}`);
    return xlsxPath;
}

async function run(poolsFile, inputSol = 1, topN = 15, analysisFile = null) {
    const t0 = Date.now();

    console.log('═'.repeat(70));
    console.log('  TRIANGLE ARB RUNNER v4.1 — Clean Dependencies');
    console.log('═'.repeat(70));

    const rpcManager = new RPCManager();
    await rpcManager.initialize();

    const stats = rpcManager.getStats();
    console.log(`\n🌐 RPC Configuration:`);
    console.log(`   Private endpoints: ${stats.private.length}`);
    console.log(`   Public fallbacks: ${stats.public.length}`);

    const pools = loadPools(poolsFile);
    const filteredPools = filterPools(pools);
    const pairMap = buildPairMap(filteredPools);
    const pairCount = new Set([...pairMap.keys()].map(k => k.split('-').sort().join('-'))).size;
    console.log(`🔗 ${pairCount} unique pairs after filtering`);

    let triangles = [];

    if (analysisFile && fs.existsSync(analysisFile)) {
        console.log(`\n📥 Loading pre-ranked triangles from: ${analysisFile}`);
        const analysis = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));

        if (analysis.triangleCandidates && analysis.triangleCandidates.length > 0) {
            const preRanked = analysis.triangleCandidates.slice(0, topN * 2);
            console.log(`   Loaded ${preRanked.length} pre-ranked candidates`);

            triangles = preRanked.map((c) => ({
                path: c.path,
                combo: `${c.leg1Full.poolType}→${c.leg2Full.poolType}→${c.leg3Full.poolType}`,
                tokenA: SOL,
                tokenB: c.leg1Full.outputMint,
                tokenC: c.leg2Full.outputMint,
                poolAB: {
                    address: c.leg1Full.address,
                    market: c.leg1Full.poolType,
                    liquidity: c.leg1Full.tvl,
                    feeBps: c.leg1Full.feeBps,
                },
                poolBC: {
                    address: c.leg2Full.address,
                    market: c.leg2Full.poolType,
                    liquidity: c.leg2Full.tvl,
                    feeBps: c.leg2Full.feeBps,
                },
                poolCA: {
                    address: c.leg3Full.address,
                    market: c.leg3Full.poolType,
                    liquidity: c.leg3Full.tvl,
                    feeBps: c.leg3Full.feeBps,
                },
                totalFeeBps: c.totalFees,
                liqMin: Math.min(c.leg1Full.tvl, c.leg2Full.tvl, c.leg3Full.tvl),
                isCrossDex: (c.leg1Full.poolType !== c.leg3Full.poolType),
                priorityScore: c.score,
                preRanked: true,
                estProfitBps: c.estProfitBps,
            }));
        }
    }

    if (triangles.length === 0) {
        console.log(`\n🔍 Using standard triangle finder...`);
        triangles = findTriangles(pairMap);
    }

    const crossDex = triangles.filter(t => t.isCrossDex);
    console.log(`\n🔺 Found ${triangles.length} quality combos (${crossDex.length} cross-DEX)`);

    if (!triangles.length) {
        console.log('❌ No valid triangles. Check pool quality or whitelist.');
        return [];
    }

    const toQuote = triangles.slice(0, topN);
    console.log(`   Quoting top ${toQuote.length}:\n`);

    const amountIn = new BN(Math.round(inputSol * 1e9));
    const results = [];

    for (let i = 0; i < toQuote.length; i++) {
        const tri = toQuote[i];
        const prefix = `  [${String(i + 1).padStart(2)}/${toQuote.length}] ${tri.path.padEnd(38)} ${tri.combo.padEnd(28)} `;

        try {
            const result = await optimizeAndQuote(rpcManager, tri, amountIn);
            if (result) {
                results.push(result);
                const color = result.profitBps >= 0 ? C.green : (result.profitBps > -10 ? C.yellow : C.red);
                const dirMark = result.direction === 'reverse' ? '↻' : (result.direction === 'forward' ? '→' : '');
                const sizeNote = result.optimalSize && result.inputSol !== inputSol ? ` @${result.inputSol.toFixed(2)}SOL` : '';
                console.log(`${prefix}${color}${result.profitBps.toFixed(1).padStart(7)} bps${C.reset} ${dirMark} fee=${result.totalFeeBps}bps${sizeNote}`);
            } else {
                console.log(`${prefix}${C.red}NO_QUOTE${C.reset}`);
            }
        } catch (err) {
            console.log(`${prefix}${C.red}ERR: ${err.message.slice(0, 40)}${C.reset}`);
        }
    }

    results.sort((a, b) => b.profitBps - a.profitBps);
    const profitable = results.filter(r => r.profitable);
    const nearProfit = results.filter(r => !r.profitable && r.profitBps > -10);
    const ms = Date.now() - t0;

    console.log('\n' + '═'.repeat(70));
    console.log(`  RESULTS: ${results.length} quoted, ${C.green}${profitable.length} profitable${C.reset}, ${C.yellow}${nearProfit.length} near-profit${C.reset}, ${(ms / 1000).toFixed(1)}s`);
    console.log('═'.repeat(70));

    if (profitable.length) {
        console.log(`\n${C.green}💰 PROFITABLE ROUTES:${C.reset}`);
        profitable.forEach((r, i) => {
            const xd = r.isCrossDex ? '⚡' : '';
            const dir = r.direction === 'reverse' ? ' [R]' : '';
            const sz = r.optimalSize && r.inputSol !== inputSol ? ` @${r.inputSol.toFixed(2)}SOL` : '';
            console.log(`  ${i + 1}. ${xd}${r.path}${dir}  ${C.green}+${r.profitBps.toFixed(1)} bps${C.reset}  (${r.profitSOL} SOL)${sz}`);
        });
    }

    await exportXlsx(results, inputSol, ms);

    const finalStats = rpcManager.getStats();
    console.log(`\n📊 RPC Usage:`);
    console.log(`   Using public fallback: ${finalStats.usingFallback ? 'YES' : 'NO'}`);

    return results;
}

module.exports = {
    run,
    findTriangles,
    quoteTriangle,
    quoteTriangleReverse,
    findOptimalSize,
    quoteBothDirections,
    optimizeAndQuote,
    loadPools,
    buildPairMap,
    RPCManager,
    filterPools
};

if (require.main === module) {
    const args = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--use-analysis' && argv[i + 1]) {
            args.analysisFile = argv[++i];
        } else if (a.startsWith('--')) {
            const k = a.slice(2).toLowerCase();
            args[k] = (!argv[i + 1] || argv[i + 1].startsWith('--')) ? true : argv[++i];
        } else if (!args.file) {
            args.file = a;
        }
    }

    const poolsFile = args.file || 'stage1_pools.json';
    const inputSol = parseFloat(args.amount || '1');
    const topN = parseInt(args.topn || '15');
    const analysisFile = args.analysisFile || null;

    if (!fs.existsSync(poolsFile)) {
        console.error(`❌ File not found: ${poolsFile}`);
        process.exit(1);
    }

    run(poolsFile, inputSol, topN, analysisFile)
        .then(results => {
            console.log(`\n✅ Complete. ${results.length} routes processed.`);
            process.exit(0);
        })
        .catch(err => {
            console.error(`\n❌ Fatal: ${err.message}`);
            console.error(err.stack);
            process.exit(1);
        });
}

//. node triangleRunner4.js Dashboard/stage1_pools_enriched.json