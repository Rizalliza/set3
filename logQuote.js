'use strict';
/**
 * logQuote.js — 3-Leg Price Analysis & Ranking System
 *
 * Depends on: batchFetcher4.js (core engine)
 * NO circular dependencies
 */
const { Connection, PublicKey } = require('@solana/web3.js');
const ExcelJS = require('exceljs');
require('dotenv').config();
const BN = require('bn.js');
const fs = require('fs');
const path = require('path');
// Import from batchFetcher4.js ONLY - no circular dependencies
const { RPCConnectionManager, BatchReserveFetcher, ReserveQuoteEngine, categorizePools, calculatePriceDiffs, generateTriangleCandidates, loadPools, getSymbol, SOL, USDC, USDT, TOKEN_SYMBOLS, toBN, toDecimal } = require('./batchFetcher4.js');
const SUPPORTED_PAIRS = new Set([
    `${SOL}/${USDC}`,
    `${SOL}/${USDT}`,
    `${SOL}/J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn`, // jitoSOL
    `${SOL}/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So`, // mSOL
    `${SOL}/7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj`, // stSOL
    `${USDC}/${USDT}`,
]);
function formatLiq(n) {
    if (n >= 1e9)
        return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6)
        return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3)
        return (n / 1e3).toFixed(0) + 'K';
    return n.toFixed(0);
}
// ════════════════════════════════════════════════════════════════════════
// RPC MANAGER — Wrapper around batchFetcher4's RPCConnectionManager
// ════════════════════════════════════════════════════════════════════════
class RPCManager {
    constructor() {
        this.connectionManager = new RPCConnectionManager();
        this.endpoints = [];
        const privateUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
        this.endpoints.push({
            url: privateUrl,
            connection: null,
            failed: false,
            lastError: 0,
        });
    }
    async initialize() {
        await this.connectionManager.getWorkingConnection();
    }
    get connection() {
        return this.connectionManager.getConnection();
    }
    getNext() {
        return {
            connection: this.connection,
            url: this.connectionManager.workingUrl
        };
    }
    markFailed(endpoint, err) {
        console.log(`   ⚠️ RPC issue: ${err.message?.substring(0, 50)}`);
    }
}
// ════════════════════════════════════════════════════════════════════════
// FILTERING FUNCTIONS
// ════════════════════════════════════════════════════════════════════════
function filterWorkingPools(pools) {
    console.log('\n🔍 Filtering pools...');
    const filtered = pools.filter(pool => {
        if (!pool.address || pool.address.length < 32) {
            console.log(`  Skipping ${pool.address?.slice(0, 8)}...: Invalid address`);
            return false;
        }
        if (!pool.market || !pool.mintA || !pool.mintB) {
            console.log(`  Skipping ${pool.address?.slice(0, 8)}...: Missing required fields`);
            return false;
        }
        const liquidity = pool.liquidity || pool.tvl || 0;
        if (liquidity < 10000) {
            console.log(`  Skipping ${pool.address?.slice(0, 8)}...: Low liquidity ($${liquidity})`);
            return false;
        }
        return true;
    });
    console.log(`  Kept ${filtered.length}/${pools.length} pools after filtering`);
    return filtered;
}
function isSupportedPair(mintA, mintB) {
    const pair1 = `${mintA}/${mintB}`;
    const pair2 = `${mintB}/${mintA}`;
    return SUPPORTED_PAIRS.has(pair1) || SUPPORTED_PAIRS.has(pair2);
}
function filterSupportedPools(pools) {
    return pools.filter(pool => {
        const pair1 = `${pool.mintA}/${pool.mintB}`;
        const pair2 = `${pool.mintB}/${pool.mintA}`;
        const isSupported = SUPPORTED_PAIRS.has(pair1) || SUPPORTED_PAIRS.has(pair2);
        const hasSOL = pool.mintA === SOL || pool.mintB === SOL;
        return isSupported && hasSOL;
    });
}
// ════════════════════════════════════════════════════════════════════════
// QUOTE CATEGORY - Uses batchFetcher4 engine
// ════════════════════════════════════════════════════════════════════════
async function quoteCategory(rpcManager, pools, testAmountLamports, label) {
    console.log(`\n📊 Quoting ${pools.length} ${label} pools...`);
    const fetcher = new BatchReserveFetcher(rpcManager.connectionManager);
    const engine = new ReserveQuoteEngine(fetcher.reserveCache, rpcManager.connectionManager.workingUrl);
    // Fetch all reserves first
    await fetcher.fetchAllReserves(pools);
    const results = [];
    const batchSize = 5; // Conservative for public RPC
    for (let i = 0; i < pools.length; i += batchSize) {
        const batch = pools.slice(i, i + batchSize);
        for (const pool of batch) {
            try {
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
            catch (err) {
                // Skip failed pools silently
            }
        }
        // Progress
        if (i % 10 === 0) {
            process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, pools.length)}/${pools.length} (${results.length} successful)`);
        }
        // Rate limit protection
        await new Promise(r => setTimeout(r, 100));
    }
    console.log(`\n  ✅ Got ${results.length} valid quotes`);
    return results;
}
// ════════════════════════════════════════════════════════════════════════
// EXPORT TO XLSX — 3 TABLES + TRIANGLE CANDIDATES
// ════════════════════════════════════════════════════════════════════════
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
    // Table 1: SOL/X (Leg 1)
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
    // Table 2: X/Y (Leg 2)
    createSheet('Leg2_X_Y', leg2Data, [
        { header: 'Rank', key: 'rank', width: 6 },
        { header: 'Pair', key: 'pair', width: 20 },
        { header: 'Pool Type', key: 'poolType', width: 18 },
        { header: 'TVL', key: 'tvl', width: 12 },
        { header: 'Amount Out (raw)', key: 'amountOutRaw', width: 20 },
        { header: 'Amount Out', key: 'amountOutReadable', width: 12 },
        { header: 'Price Diff (bps)', key: 'priceDiffBps', width: 15 },
        { header: 'Price Diff %', key: 'priceDiffPct', width: 12 },
        { header: 'Fee (bps)', key: 'feeBps', width: 10 },
        { header: 'Direction', key: 'direction', width: 10 },
        { header: 'Best?', key: 'isBestInPair', width: 8 },
        { header: 'Pool Address', key: 'address', width: 46 },
    ]);
    // Table 3: Y/SOL (Leg 3)
    createSheet('Leg3_Y_SOL', leg3Data, [
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
    // Table 4: Triangle Candidates
    const triangles = generateTriangleCandidates(leg1Data, leg2Data, leg3Data);
    createSheet('Triangle_Candidates', triangles, [
        { header: 'Rank', key: 'rank', width: 6 },
        { header: 'Path', key: 'path', width: 35 },
        { header: 'Est. Profit (bps)', key: 'estProfitBps', width: 15 },
        { header: 'Total Fees', key: 'totalFees', width: 12 },
        { header: 'Leg1 Pool', key: 'leg1Pool', width: 20 },
        { header: 'Leg2 Pool', key: 'leg2Pool', width: 20 },
        { header: 'Leg3 Pool', key: 'leg3Pool', width: 20 },
        { header: 'Leg1 Diff', key: 'leg1Diff', width: 12 },
        { header: 'Leg2 Diff', key: 'leg2Diff', width: 12 },
        { header: 'Leg3 Diff', key: 'leg3Diff', width: 12 },
        { header: 'Combined Score', key: 'score', width: 15 },
    ]);
    const xlsxPath = path.join(exportDir, `3leg_analysis_${timestamp}.xlsx`);
    await wb.xlsx.writeFile(xlsxPath);
    const jsonPath = path.join(exportDir, `3leg_analysis_${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        testAmountSOL,
        leg1: leg1Data,
        leg2: leg2Data,
        leg3: leg3Data,
        triangleCandidates: triangles.slice(0, 50),
    }, null, 2));
    console.log(`\n💾 Exported:`);
    console.log(`   XLSX: ${xlsxPath}`);
    console.log(`   JSON: ${jsonPath}`);
    return { xlsxPath, jsonPath, triangles };
}
// ════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ════════════════════════════════════════════════════════════════════════
async function main() {
    const args = process.argv.slice(2);
    const poolsFile = args[0] || 'pool_list.json';
    const testAmountSOL = parseFloat(args[1]) || 1.0;
    console.log('═'.repeat(70));
    console.log('  3-LEG PRICE ANALYSIS SYSTEM');
    console.log('═'.repeat(70));
    console.log(`📁 Pools: ${poolsFile}`);
    console.log(`💰 Test amount: ${testAmountSOL} SOL`);
    try {
        // Load and categorize
        const pools = loadPools(poolsFile);
        console.log(`📊 Loaded ${pools.length} pools`);
        const { leg1, leg2, leg3 } = categorizePools(pools);
        console.log(`\n📋 Categorized:`);
        console.log(`   Leg1 (SOL/X): ${leg1.length} pools`);
        console.log(`   Leg2 (X/Y):   ${leg2.length} pools`);
        console.log(`   Leg3 (Y/SOL): ${leg3.length} pools`);
        // Setup RPC
        const rpcManager = new RPCManager();
        await rpcManager.initialize();
        const testAmountLamports = new BN(Math.round(testAmountSOL * 1e9));
        // Quote each leg
        const leg1Quoted = await quoteCategory(rpcManager, leg1, testAmountLamports, 'Leg 1 (SOL/X)');
        const leg2Quoted = await quoteCategory(rpcManager, leg2, testAmountLamports, 'Leg 2 (X/Y)');
        const leg3Quoted = await quoteCategory(rpcManager, leg3, testAmountLamports, 'Leg 3 (Y/SOL)');
        // Calculate price differences
        const leg1Data = calculatePriceDiffs(leg1Quoted, testAmountLamports).map((d, i) => ({ ...d, rank: i + 1 }));
        const leg2Data = calculatePriceDiffs(leg2Quoted, testAmountLamports).map((d, i) => ({ ...d, rank: i + 1 }));
        const leg3Data = calculatePriceDiffs(leg3Quoted, testAmountLamports).map((d, i) => ({ ...d, rank: i + 1 }));
        // Export
        const { xlsxPath, jsonPath, triangles } = await exportAnalysis(leg1Data, leg2Data, leg3Data, testAmountSOL);
        // Summary
        console.log('\n' + '═'.repeat(70));
        console.log('  ANALYSIS COMPLETE');
        console.log('═'.repeat(70));
        console.log(`\n📈 Results:`);
        console.log(`   Leg1 quoted: ${leg1Data.length}`);
        console.log(`   Leg2 quoted: ${leg2Data.length}`);
        console.log(`   Leg3 quoted: ${leg3Data.length}`);
        console.log(`   Triangle candidates: ${triangles.length}`);
        if (triangles.length > 0) {
            console.log(`\n🏆 Top 3 Triangle Candidates:`);
            triangles.slice(0, 3).forEach((t, i) => {
                const profitColor = t.estProfitBps > 0 ? '\x1b[32m' : '\x1b[31m';
                console.log(`   ${i + 1}. ${t.path}`);
                console.log(`      Est. profit: ${profitColor}${t.estProfitBps.toFixed(1)} bps\x1b[0m | Fees: ${t.totalFees} bps`);
            });
        }
        console.log(`\n📤 HANDOVER TO TRIANGLERUNNER4.JS:`);
        console.log(`   Use JSON: ${jsonPath}`);
        console.log(`   Or run: node triangleRunner4.js --use-analysis ${jsonPath}`);
    }
    catch (error) {
        console.error('❌ Error:', error);
        console.error(error.stack);
        process.exit(1);
    }
}
module.exports = {
    categorizePools,
    quoteCategory,
    calculatePriceDiffs,
    generateTriangleCandidates,
    loadPools,
    main,
    filterSupportedPools,
    isSupportedPair,
    RPCManager,
    exportAnalysis
};
if (require.main === module) {
    main().catch(console.error);
}
//. node core/logQuote.js pool_list_enriched.json