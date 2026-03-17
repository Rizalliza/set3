'use strict';
/**
 * enrichRoute.js — Per-leg cost attribution for triangle arbitrage quotes.
 *
 * WHAT THIS DOES
 * ──────────────
 * quoteTriangle() returns a net profitBps that already includes all DEX fees
 * and price impact but gives you NO visibility into WHERE the cost came from.
 *
 * This module runs a tiny spot quote on each leg (amountIn / SPOT_DIVISOR) to
 * separate fee cost from price-impact cost, then adds fixed execution costs
 * (priority fee + Jito tip) that quoteTriangle never sees.
 *
 * OUTPUT SHAPE per enriched route
 * ────────────────────────────────
 *   enrichment.legs.AB / BC / CA  {
 *     feeBps           – DEX's nominal fee rate (from pool.feeBps)
 *     spotScaled       – spotQuoteOut * SPOT_DIVISOR  (fee-included, near-zero impact)
 *     impactBps        – (spotScaled - actualOut) / spotScaled * 10000
 *     impactAtoms      – spotScaled - actualOut
 *     totalLegCostBps  – feeBps + impactBps
 *   }
 *   enrichment.costs  {
 *     leg1FeeBps / leg2FeeBps / leg3FeeBps
 *     leg1ImpactBps / leg2ImpactBps / leg3ImpactBps
 *     priorityFeeLamports / jitoTipLamports
 *     fixedCostBps       – (priority + Jito) / amountIn * 10000
 *   }
 *   enrichment.summary {
 *     grossProfitBps     – profitBps from quoteTriangle (net of DEX fees+impact)
 *     netProfitBps       – grossProfitBps - fixedCostBps
 *     slippageBudgetBps  – execution slippage risk window (NOT yet a cost)
 *     worstCaseBps       – netProfitBps - slippageBudgetBps
 *     verdict            – EXECUTE | MARGINAL | SKIP
 *   }
 *
 * USAGE

   // Import into _all-trianglesArb.js
   const { enrichRoute, displayEnrichedTable, exportEnrichedXLSX } = require('./diagnostic/enrichRoute.js');
   const enriched = await enrichRoute(connection, results, { topN: 15 });
   displayEnrichedTable(enriched);
   await exportEnrichedXLSX(enriched, './exports/enriched.xlsx');

 *   // CLI — enrich an existing exports JSON
 *   node diagnostic/enrichRoute.js exports/arbitrage_2026-03-10T12-06-37.json
 *   node diagnostic/enrichRoute.js exports/arbitrage_2026-03-10T12-06-37.json --topn 10 --slippage 100
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { Connection, PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');
const { getQuote } = require('../src/arbitrage/logQuote.js');
const { KNOWN_TOKENS, getTokenSymbol } = require('../libs/KNOWN_TOKENS.js');


// ============================================================================
// CONSTANTS — override via opts
// ============================================================================
const DEFAULTS = {
    priorityFeeLamports: 5_000,     // 0.000005 SOL
    jitoTipLamports: 10_000,     // 0.000010 SOL
    slippageBudgetBps: 30,     // 1% execution slippage risk window
    minProfitBps: 10,     // threshold for EXECUTE verdict
    marginalBps: 5,     // within this of minProfit → MARGINAL
    spotDivisor: 1000,     // amountIn / this = spot quote size per leg
    minSpotAtoms: 1000,     // floor on spot quote input
    delayBetweenMs: 150,     // ms pause between spot batches
};

const C = {
    green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m',
    reset: '\x1b[0m',
};

// ============================================================================
// BATCH ENRICHMENT
// ============================================================================


/**
 * @param {Connection} connection
 * @param {Array}      results  – array from quoteTopRoutes()
 * @param {object}     opts
 * @param {number}     [opts.topN=15]  – only enrich top N (by profitBps)
 */
async function enrichRoute(connection, r, opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };


    try {
        // Skip failed quotes
        if (!r.ok || !r.poolAB || !r.poolBC || !r.poolCA) {
            return { ...r, enriched: false, enrichedError: 'skipped — quote failed' };
        }

        const amountIn = new BN(r.amountIn || '0');
        if (amountIn.isZero()) return { ...r, enriched: false, enrichedError: 'amountIn is zero' };

        const resolveDex = (pool, key) => {
            const d = pool?.dex ? String(pool.dex).toUpperCase() : '';
            return (d && d !== 'UNKNOWN') ? d : (r.dexTypes?.[key] ? String(r.dexTypes[key]).toUpperCase() : 'UNKNOWN');
        };

        // ── Spot quotes for each leg ─────────────────────────────────────────────
        const legInputs = [
            new BN(r.amountIn),
            new BN(r.outAB),
            new BN(r.outBC),
        ];
        const legActuals = [
            new BN(r.outAB),
            new BN(r.outBC),
            new BN(r.outCA),
        ];
        const legPools = [r.poolAB, r.poolBC, r.poolCA];
        const legKeys = ['AB', 'BC', 'CA'];

        const legData = [];

        for (let i = 0; i < 3; i++) {
            const pool = legPools[i];
            const key = legKeys[i];
            const actualIn = legInputs[i];
            const actualOut = legActuals[i];
            // Safe integer feeBps — handles both clean (25) and legacy (0.0025)
            let feeBps = 0;
            const rawFee = pool.feeBps;
            if (rawFee !== undefined && rawFee !== null) {
                const num = Number(rawFee);
                if (num >= 1) feeBps = Math.round(num);
                else if (num > 0 && num < 1) feeBps = Math.round(num * 10000);
            }
            const dex = resolveDex(pool, key);

            // Validate pool data
            if (!pool?.address && !pool?.poolAddress || !pool?.inputMint || !pool?.outputMint) {
                legData.push({
                    key,
                    dex,
                    inputMint: pool?.inputMint || 'unknown',
                    outputMint: pool?.outputMint || 'unknown',
                    amountIn: actualIn.toString(),
                    actualOut: actualOut.toString(),
                    spotAmountIn: '0',
                    spotScaled: null,
                    feeBps,
                    impactBps: null,
                    impactAtoms: null,
                    totalLegCostBps: feeBps,
                    spotError: 'Invalid pool data',
                });
                continue;
            }

            // Spot size calculation with safety checks
            const rawSpot = actualIn.divn(cfg.spotDivisor);
            const spotIn = rawSpot.ltn(cfg.minSpotAtoms)
                ? new BN(cfg.minSpotAtoms)
                : rawSpot;

            // Prevent division by zero
            const scaleFactor = spotIn.isZero()
                ? 1
                : Number(actualIn.toString()) / Number(spotIn.toString());

            let spotScaled = null;
            let impactBps = null;
            let impactAtoms = null;
            let spotError = null;

            try {
                // getQuote() returns { amountOut: BN, feeBps: number }
                const spotResult = await getQuote(
                    connection, dex,
                    new PublicKey(pool.address || pool.poolAddress),
                    new PublicKey(pool.inputMint),
                    new PublicKey(pool.outputMint),
                    spotIn
                );

                // Use on-chain fee from spot quote — overrides potentially broken stage1 cache
                if (spotResult.feeBps > 0) {
                    feeBps = spotResult.feeBps;
                }

                const spotOutBN = spotResult.amountOut;
                if (!spotOutBN || spotOutBN.isZero()) {
                    spotError = 'spot quote returned 0 or null';
                } else {
                    // Scale spot output up to full trade size
                    const spotScaledNum = Math.round(spotOutBN.toNumber() * scaleFactor);
                    spotScaled = new BN(spotScaledNum);

                    // IMPACT ISOLATION:
                    // Both spotScaled and actualOut are NET of fees (getQuote deducts fees).
                    // spotScaled ≈ near-zero-size output (minimal impact).
                    // actualOut = full-size output (includes price impact).
                    // impactAtoms = spotScaled - actualOut = pure price impact.
                    const actualOutNum = actualOut.toNumber();
                    const impactAtomsNum = spotScaledNum - actualOutNum;
                    impactAtoms = impactAtomsNum;

                    if (spotScaledNum > 0) {
                        impactBps = (impactAtomsNum / spotScaledNum) * 10000;
                    } else {
                        impactBps = 0;
                    }
                }
            } catch (e) {
                spotError = e.message || 'Unknown error in spot quote';
            }

            legData.push({
                key,
                dex,
                inputMint: pool.inputMint,
                outputMint: pool.outputMint,
                amountIn: actualIn.toString(),
                actualOut: actualOut.toString(),
                spotAmountIn: spotIn.toString(),
                spotScaled: spotScaled ? spotScaled.toString() : null,
                feeBps,
                impactBps: impactBps !== null ? parseFloat(impactBps.toFixed(2)) : null,
                impactAtoms: impactAtoms !== null ? impactAtoms : null,
                totalLegCostBps: impactBps !== null
                    ? parseFloat((feeBps + Math.max(impactBps, 0)).toFixed(2)) // Only positive impact adds cost
                    : feeBps,
                spotError,
            });
        }

        // ── Fixed execution costs ────────────────────────────────────────────────
        const totalFixedLamports = cfg.priorityFeeLamports + cfg.jitoTipLamports;
        const fixedCostBps = amountIn.toNumber() > 0
            ? (totalFixedLamports / amountIn.toNumber()) * 10000
            : 0;

        // ── Route-level summary ──────────────────────────────────────────────────
        // FIX: Calculate actual profit correctly
        const finalOut = new BN(r.outCA || '0');
        const grossProfit = finalOut.sub(amountIn);
        const grossProfitBps = amountIn.isZero() ? 0 :
            (grossProfit.toNumber() / amountIn.toNumber()) * 10000;

        const netProfitBps = parseFloat((grossProfitBps - fixedCostBps).toFixed(2));
        const worstCaseBps = parseFloat((netProfitBps - cfg.slippageBudgetBps).toFixed(2));

        let verdict, verdictReason;
        if (netProfitBps >= cfg.minProfitBps) {
            verdict = 'EXECUTE';
            verdictReason = `Net ${netProfitBps.toFixed(1)} bps — above threshold`;
        } else if (netProfitBps >= cfg.minProfitBps - cfg.marginalBps) {
            verdict = 'MARGINAL';
            verdictReason = `Net ${netProfitBps.toFixed(1)} bps — within ${cfg.marginalBps} bps of threshold`;
        } else {
            verdict = 'SKIP';
            const gap = Math.abs(netProfitBps - cfg.minProfitBps);
            verdictReason = `Net ${netProfitBps.toFixed(1)} bps — ${gap.toFixed(1)} bps short`;
        }

        // Total nominal fee bps
        const totalNominalFeeBps = legData.reduce((s, l) => s + l.feeBps, 0);
        const validLegs = legData.filter(l => l.impactBps !== null);
        const avgImpactBps = validLegs.length
            ? validLegs.reduce((s, l) => s + l.impactBps, 0) / validLegs.length
            : null;

        return {
            ...r,
            enriched: true,
            enrichment: {
                inputSol: parseFloat((amountIn.toNumber() / 1e9).toFixed(4)),
                inputLamports: r.amountIn,

                legs: {
                    AB: legData[0],
                    BC: legData[1],
                    CA: legData[2],
                },

                costs: {
                    leg1FeeBps: legData[0].feeBps,
                    leg2FeeBps: legData[1].feeBps,
                    leg3FeeBps: legData[2].feeBps,
                    totalNominalFeeBps,

                    leg1ImpactBps: legData[0].impactBps,
                    leg2ImpactBps: legData[1].impactBps,
                    leg3ImpactBps: legData[2].impactBps,
                    avgImpactBps: avgImpactBps !== null
                        ? parseFloat(avgImpactBps.toFixed(2)) : null,

                    priorityFeeLamports: cfg.priorityFeeLamports,
                    jitoTipLamports: cfg.jitoTipLamports,
                    totalFixedLamports,
                    fixedCostBps: parseFloat(fixedCostBps.toFixed(3)),
                },

                summary: {
                    grossProfitBps,
                    grossProfitLamports: grossProfit.toString(),
                    fixedCostBps: parseFloat(fixedCostBps.toFixed(3)),
                    netProfitBps,
                    netProfitLamports: Math.round(
                        grossProfit.toNumber() - (fixedCostBps / 10000 * amountIn.toNumber())
                    ),
                    slippageBudgetBps: cfg.slippageBudgetBps,
                    worstCaseBps,
                    verdict,
                    verdictReason,
                },
            },
        };
    } catch (error) {
        console.error(`Error enriching route:`, error);
        return {
            ...r,
            enriched: false,
            enrichedError: `Enrichment failed: ${error.message}`
        };
    }
}

// ============================================================================
// DISPLAY: per-route box breakdown
// ============================================================================

function displayEnrichedRoute(e) {
    if (!e.enriched) {
        console.log(`  ${C.dim}[not enriched] ${e.path || e.routeId}${C.reset}`);
        return;
    }
    const s = e.enrichment.summary;
    const c = e.enrichment.costs;
    const lgs = e.enrichment.legs;
    const vCol = s.verdict === 'EXECUTE' ? C.green : s.verdict === 'MARGINAL' ? C.yellow : C.red;
    const W = 72;

    console.log('\n┌' + '─'.repeat(W - 2) + '┐');
    console.log(`│ ${C.cyan}${C.bold}${(e.path || '').padEnd(W - 4)}${C.reset} │`);
    console.log('├' + '─'.repeat(W - 2) + '┤');

    // Per-leg rows
    for (const [key, l] of Object.entries(lgs)) {
        const legLabel = `Leg ${key}`;
        const dexStr = (l.dex || '').padEnd(20);
        const feeStr = `fee=${l.feeBps} bps`;
        const impStr = l.impactBps !== null
            ? `impact=${l.impactBps.toFixed(2)} bps`
            : `impact=n/a`;
        const totStr = `total=${l.totalLegCostBps.toFixed(2)} bps`;
        console.log(`│  ${legLabel}  ${dexStr} ${feeStr.padEnd(12)} ${impStr.padEnd(18)} ${totStr.padEnd(16)}│`);

        if (l.spotError) {
            console.log(`│  ${C.dim}      ↳ spot error: ${l.spotError.slice(0, 50)}${C.reset}${' '.repeat(Math.max(0, W - 22 - l.spotError.slice(0, 50).length))}│`);
        }
    }

    console.log('├' + '─'.repeat(W - 2) + '┤');

    // Cost summary
    const feeSum = `Σ fees (nominal): ${c.totalNominalFeeBps} bps`;
    const avgImp = c.avgImpactBps !== null ? `  avg impact/leg: ${c.avgImpactBps.toFixed(2)} bps` : '';
    console.log(`│  ${feeSum}${avgImp}${' '.repeat(Math.max(0, W - 4 - feeSum.length - avgImp.length))}│`);

    const fixedStr = `Fixed execution:  priority=${c.priorityFeeLamports.toLocaleString()} + Jito=${c.jitoTipLamports.toLocaleString()} lam = ${c.fixedCostBps.toFixed(3)} bps`;
    console.log(`│  ${fixedStr}${' '.repeat(Math.max(0, W - 4 - fixedStr.length))}│`);

    console.log('├' + '─'.repeat(W - 2) + '┤');

    // P&L
    const grossCol = s.grossProfitBps >= 0 ? C.green : C.red;
    const netCol = s.netProfitBps >= 0 ? C.green : C.red;
    console.log(`│  Gross P&L (quoted, net of DEX fees+impact):  ${grossCol}${s.grossProfitBps.toFixed(1).padStart(8)} bps${C.reset}             │`);
    console.log(`│  Fixed costs:                                 ${(' - ' + s.fixedCostBps.toFixed(3)).padStart(8)} bps             │`);
    console.log(`│  Net P&L:                                     ${netCol}${s.netProfitBps.toFixed(1).padStart(8)} bps${C.reset}             │`);
    console.log(`│  Execution slippage budget (risk window):     ${('± ' + s.slippageBudgetBps).padStart(8)} bps             │`);
    console.log(`│  Worst-case P&L:                              ${s.worstCaseBps.toFixed(1).padStart(8)} bps             │`);

    console.log('├' + '─'.repeat(W - 2) + '┤');
    const verdictStr = `VERDICT: ${s.verdict}  —  ${s.verdictReason}`;
    console.log(`│  ${vCol}${C.bold}${verdictStr}${C.reset}${' '.repeat(Math.max(0, W - 4 - verdictStr.length))}│`);
    console.log('└' + '─'.repeat(W - 2) + '┘');
}

// ============================================================================
// DISPLAY: compact enrichment table
// ============================================================================

function displayEnrichedTable(enrichedArray, title = 'ENRICHED ROUTE BREAKDOWN') {
    const W = 155;
    console.log('\n' + '═'.repeat(W));
    console.log(`${title}  —  ${new Date().toLocaleTimeString()}`);
    console.log('═'.repeat(W));

    const COL = [
        'Rk'.padEnd(4),
        'Path'.padEnd(34),
        'Gross bps'.padEnd(11),
        'Net bps'.padEnd(10),
        'L1 fee'.padEnd(8), 'L1 impact'.padEnd(11),
        'L2 fee'.padEnd(8), 'L2 impact'.padEnd(11),
        'L3 fee'.padEnd(8), 'L3 impact'.padEnd(11),
        'Fixed bps'.padEnd(10),
        'Worst'.padEnd(9),
        'Verdict'.padEnd(9),
    ];
    console.log(COL.join(' | '));
    console.log('-'.repeat(W));

    enrichedArray.filter(e => e.enriched).forEach((e, i) => {
        const s = e.enrichment.summary;
        const c = e.enrichment.costs;
        const lgs = e.enrichment.legs;
        const vCol = s.verdict === 'EXECUTE' ? C.green : s.verdict === 'MARGINAL' ? C.yellow : C.dim;
        const gCol = s.grossProfitBps >= 0 ? C.green : C.red;
        const nCol = s.netProfitBps >= 0 ? C.green : C.red;

        const fmt = (v, dec = 1) => v !== null ? v.toFixed(dec) : 'n/a';

        const row = [
            String(i + 1).padEnd(4),
            (e.path || '').slice(0, 34).padEnd(34),
            (gCol + s.grossProfitBps.toFixed(1) + C.reset).padEnd(11),
            (nCol + s.netProfitBps.toFixed(1) + C.reset).padEnd(10),
            fmt(c.leg1FeeBps).padEnd(8),
            (c.leg1ImpactBps !== null ? fmt(c.leg1ImpactBps) : 'n/a').padEnd(11),
            fmt(c.leg2FeeBps).padEnd(8),
            (c.leg2ImpactBps !== null ? fmt(c.leg2ImpactBps) : 'n/a').padEnd(11),
            fmt(c.leg3FeeBps).padEnd(8),
            (c.leg3ImpactBps !== null ? fmt(c.leg3ImpactBps) : 'n/a').padEnd(11),
            c.fixedCostBps.toFixed(3).padEnd(10),
            s.worstCaseBps.toFixed(1).padEnd(9),
            (vCol + s.verdict + C.reset).padEnd(9),
        ];
        console.log(row.join(' | '));
    });

    console.log('═'.repeat(W));
}

// ============================================================================
// XLSX EXPORT — enriched workbook
// ============================================================================

async function exportEnrichedXLSX(enrichedArray, xlsxPath) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'TriangleArb-Enriched';
    wb.created = new Date();

    const H_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    const H_FONT = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    const D_FONT = { name: 'Arial', size: 9 };
    const G_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
    const Y_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
    const R_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
    const A_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };

    function styleHeader(row) {
        row.eachCell(c => {
            c.fill = H_FILL; c.font = H_FONT;
            c.alignment = { horizontal: 'center', vertical: 'middle' };
            c.border = { bottom: { style: 'medium', color: { argb: 'FF2C5F8A' } } };
        });
        row.height = 22;
    }

    // ── Sheet 1: Full Breakdown ───────────────────────────────────────────────
    const ws1 = wb.addWorksheet('Cost Breakdown');
    ws1.columns = [
        { header: 'Rank', key: 'rank', width: 6 },
        { header: 'Path', key: 'path', width: 42 },
        { header: 'Gross bps', key: 'gross', width: 12 },
        { header: 'Gross SOL', key: 'grossSol', width: 13 },
        { header: 'Fixed Cost bps', key: 'fixedBps', width: 14 },
        { header: 'Net bps', key: 'net', width: 10 },
        { header: 'Net SOL', key: 'netSol', width: 12 },
        { header: 'Slippage Risk', key: 'slip', width: 14 },
        { header: 'Worst-Case bps', key: 'worst', width: 14 },
        { header: 'L1 DEX', key: 'dex1', width: 20 },
        { header: 'L1 Fee bps', key: 'fee1', width: 11 },
        { header: 'L1 Impact bps', key: 'imp1', width: 13 },
        { header: 'L1 Cost bps', key: 'cost1', width: 12 },
        { header: 'L2 DEX', key: 'dex2', width: 20 },
        { header: 'L2 Fee bps', key: 'fee2', width: 11 },
        { header: 'L2 Impact bps', key: 'imp2', width: 13 },
        { header: 'L2 Cost bps', key: 'cost2', width: 12 },
        { header: 'L3 DEX', key: 'dex3', width: 20 },
        { header: 'L3 Fee bps', key: 'fee3', width: 11 },
        { header: 'L3 Impact bps', key: 'imp3', width: 13 },
        { header: 'L3 Cost bps', key: 'cost3', width: 12 },
        { header: 'Σ Fees (nom)', key: 'feeSum', width: 12 },
        { header: 'Priority Lam', key: 'priority', width: 13 },
        { header: 'Jito Lam', key: 'jito', width: 10 },
        { header: 'Verdict', key: 'verdict', width: 12 },
        { header: 'Reason', key: 'reason', width: 42 },
        { header: 'Pool L1', key: 'pool1', width: 46 },
        { header: 'Pool L2', key: 'pool2', width: 46 },
        { header: 'Pool L3', key: 'pool3', width: 46 },
    ];
    styleHeader(ws1.getRow(1));
    ws1.views = [{ state: 'frozen', ySplit: 1 }];

    const richOnly = enrichedArray.filter(e => e.enriched);
    richOnly.forEach((e, i) => {
        const s = e.enrichment.summary;
        const c = e.enrichment.costs;
        const lgs = e.enrichment.legs;
        const inputLam = Number(e.enrichment.inputLamports || e.amountIn || 0);

        const row = ws1.addRow({
            rank: i + 1,
            path: e.path || '',
            gross: s.grossProfitBps,
            grossSol: inputLam > 0 ? (s.grossProfitBps / 10000 * inputLam / 1e9).toFixed(6) : '0',
            fixedBps: c.fixedCostBps,
            net: s.netProfitBps,
            netSol: (s.netProfitLamports / 1e9).toFixed(6),
            slip: s.slippageBudgetBps,
            worst: s.worstCaseBps,
            dex1: lgs.AB.dex, fee1: lgs.AB.feeBps, imp1: lgs.AB.impactBps, cost1: lgs.AB.totalLegCostBps,
            dex2: lgs.BC.dex, fee2: lgs.BC.feeBps, imp2: lgs.BC.impactBps, cost2: lgs.BC.totalLegCostBps,
            dex3: lgs.CA.dex, fee3: lgs.CA.feeBps, imp3: lgs.CA.impactBps, cost3: lgs.CA.totalLegCostBps,
            feeSum: c.totalNominalFeeBps,
            priority: c.priorityFeeLamports,
            jito: c.jitoTipLamports,
            verdict: s.verdict,
            reason: s.verdictReason,
            pool1: lgs.AB.poolAddress || e.poolAB?.address || e.poolAB?.poolAddress || '',
            pool2: lgs.BC.poolAddress || e.poolBC?.address || e.poolBC?.poolAddress || '',
            pool3: lgs.CA.poolAddress || e.poolCA?.address || e.poolCA?.poolAddress || '',
        });

        row.eachCell(c => { c.font = D_FONT; });

        const vFill = s.verdict === 'EXECUTE' ? G_FILL : s.verdict === 'MARGINAL' ? Y_FILL : null;
        if (vFill) {
            row.getCell('verdict').fill = vFill;
            row.getCell('net').fill = vFill;
        }
        if (s.netProfitBps < 0) row.getCell('net').fill = R_FILL;
        if (i % 2 === 1) row.eachCell(c => { if (!c.fill?.fgColor) c.fill = A_FILL; });
    });
    ws1.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws1.columns.length } };

    // ── Sheet 2: Leg Impact Analysis ─────────────────────────────────────────
    const ws2 = wb.addWorksheet('Leg Impact Analysis');
    ws2.columns = [
        { header: 'Route', key: 'path', width: 42 },
        { header: 'Leg', key: 'leg', width: 5 },
        { header: 'DEX', key: 'dex', width: 22 },
        { header: 'Amount In', key: 'amtIn', width: 18 },
        { header: 'Actual Out', key: 'actOut', width: 18 },
        { header: 'Spot Scaled', key: 'spotScl', width: 18 },
        { header: 'Fee bps', key: 'fee', width: 10 },
        { header: 'Impact bps', key: 'impact', width: 13 },
        { header: 'Impact Atoms', key: 'impAtom', width: 16 },
        { header: 'Total Cost bps', key: 'total', width: 14 },
        { header: 'Spot In', key: 'spotIn', width: 16 },
        { header: 'Spot Error', key: 'err', width: 40 },
    ];
    styleHeader(ws2.getRow(1));
    ws2.views = [{ state: 'frozen', ySplit: 1 }];

    richOnly.forEach(e => {
        for (const [key, l] of Object.entries(e.enrichment.legs)) {
            const row = ws2.addRow({
                path: e.path || '',
                leg: key,
                dex: l.dex,
                amtIn: l.amountIn,
                actOut: l.actualOut,
                spotScl: l.spotScaled,
                fee: l.feeBps,
                impact: l.impactBps,
                impAtom: l.impactAtoms,
                total: l.totalLegCostBps,
                spotIn: l.spotAmountIn,
                err: l.spotError || '',
            });
            row.eachCell(c => { c.font = D_FONT; });
            if (l.impactBps !== null) {
                const impFill = l.impactBps > 50 ? R_FILL : l.impactBps > 10 ? Y_FILL : G_FILL;
                row.getCell('impact').fill = impFill;
            }
        }
    });

    // ── Sheet 3: Summary ─────────────────────────────────────────────────────
    const ws3 = wb.addWorksheet('Enrichment Summary');
    ws3.columns = [{ key: 'k', width: 32 }, { key: 'v', width: 36 }];

    const execRoutes = richOnly.filter(e => e.enrichment.summary.verdict === 'EXECUTE');
    const margRoutes = richOnly.filter(e => e.enrichment.summary.verdict === 'MARGINAL');

    const summRows = [
        ['Field', 'Value'],
        ['Enriched at', new Date().toLocaleString()],
        ['Total routes enriched', richOnly.length],
        ['EXECUTE candidates', execRoutes.length],
        ['MARGINAL candidates', margRoutes.length],
        ['SKIP candidates', richOnly.length - execRoutes.length - margRoutes.length],
        ['Best gross profit (bps)', richOnly[0]?.enrichment.summary.grossProfitBps?.toFixed(1) || '—'],
        ['Best net profit (bps)', richOnly[0]?.enrichment.summary.netProfitBps?.toFixed(1) || '—'],
        ['Best route', richOnly[0]?.path || '—'],
        ['Best L1 DEX', richOnly[0]?.enrichment.legs.AB.dex || '—'],
        ['Best L1 impact bps', richOnly[0]?.enrichment.legs.AB.impactBps?.toFixed(2) || '—'],
        ['Best L2 DEX', richOnly[0]?.enrichment.legs.BC.dex || '—'],
        ['Best L2 impact bps', richOnly[0]?.enrichment.legs.BC.impactBps?.toFixed(2) || '—'],
        ['Best L3 DEX', richOnly[0]?.enrichment.legs.CA.dex || '—'],
        ['Best L3 impact bps', richOnly[0]?.enrichment.legs.CA.impactBps?.toFixed(2) || '—'],
        ['Fixed cost assumption', `priority=${DEFAULTS.priorityFeeLamports}+Jito=${DEFAULTS.jitoTipLamports} lam`],
        ['Slippage risk budget', `${DEFAULTS.slippageBudgetBps} bps (execution window)`],
        ['Min profit threshold', `${DEFAULTS.minProfitBps} bps`],
    ];
    summRows.forEach((row, i) => {
        const r = ws3.addRow(row);
        if (i === 0) { r.eachCell(c => { c.fill = H_FILL; c.font = H_FONT; c.alignment = { horizontal: 'center' }; }); }
        else { r.eachCell(c => { c.font = D_FONT; }); if (i % 2 === 0) r.eachCell(c => { c.fill = A_FILL; }); }
    });

    await wb.xlsx.writeFile(xlsxPath);
    console.log(`\n💾 Enriched XLSX → ${xlsxPath}  (${richOnly.length} routes, 3 sheets)`);
    return xlsxPath;
}

module.exports = { enrichRoute, displayEnrichedRoute, displayEnrichedTable, exportEnrichedXLSX };

// ============================================================================
// CLI
// ============================================================================

if (require.main === module) {
    (async () => {
        const argv = process.argv.slice(2);
        const args = {};
        for (let i = 0; i < argv.length; i++) {
            const a = argv[i];
            if (a.startsWith('--')) {
                const k = a.slice(2).toLowerCase();
                args[k] = (!argv[i + 1] || argv[i + 1].startsWith('--')) ? true : argv[++i];
            } else if (!args.input) args.input = a;
        }

        const inputFile = args.input;
        const topN = parseInt(args.topn || '15', 10);
        const slippageBudget = parseInt(args.slippage || String(DEFAULTS.slippageBudgetBps), 10);
        const priorityFee = parseInt(args.priority || String(DEFAULTS.priorityFeeLamports), 10);
        const jitoTip = parseInt(args.jito || String(DEFAULTS.jitoTipLamports), 10);
        const verbose = !!args.verbose;

        if (!inputFile) {
            console.log(`
Usage: node diagnostic/enrichRoute.js stage1_pools.json --topn  15--slippage 10 --verbose  

Options:
  --topn      <n>     How many routes to enrich  (default: 15)
  --slippage  <bps>   Execution slippage risk    (default: ${DEFAULTS.slippageBudgetBps})
  --priority  <lam>   Priority fee lamports      (default: ${DEFAULTS.priorityFeeLamports})
  --jito      <lam>   Jito tip lamports          (default: ${DEFAULTS.jitoTipLamports})
  --verbose           Show per-route box display
            `);
            process.exit(0);
        }

        if (!fs.existsSync(inputFile)) {
            console.error(`File not found: ${inputFile}`); process.exit(1);
        }

        try {
            const rpcUrl = process.env.RPC_URL;
            if (!rpcUrl) { console.error('RPC_URL required'); process.exit(1); }
            const connection = new Connection(rpcUrl, 'confirmed');

            const raw = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
            const results = raw.routes || raw.allCombinations || raw.combinations ||
                (Array.isArray(raw) ? raw : []);

            if (!results.length) {
                console.error('No routes found in file.');
                console.error('Keys:', Object.keys(raw));
                process.exit(1);
            }
            console.log(`Loaded ${results.length} routes from ${inputFile}`);

            const opts = { topN, slippageBudgetBps: slippageBudget, priorityFeeLamports: priorityFee, jitoTipLamports: jitoTip };
            const enriched = [];
            for (let i = 0; i < Math.min(results.length, topN); i++) {
                const e = await enrichRoute(connection, results[i], opts);
                enriched.push(e);
            }

            displayEnrichedTable(enriched.filter(e => e.enriched));

            if (verbose) {
                enriched.filter(e => e.enriched).forEach(e => displayEnrichedRoute(e));
            }

            const base = inputFile.replace(/\.json$/, '');
            const xlsxPath = `${base}_enriched.xlsx`;
            await exportEnrichedXLSX(enriched.filter(e => e.enriched), xlsxPath);

            const jsonPath = `${base}_enriched.json`;
            fs.writeFileSync(jsonPath, JSON.stringify(enriched, null, 2));
            console.log(`💾 Enriched JSON → ${jsonPath}`);

            process.exit(0);
        } catch (e) {
            console.error('Error:', e.message);
            console.error(e.stack);
            process.exit(1);
        }
    })();
}


//.  node diagnostic/enrichRoute.js pool_list.json --topn  15--slippage 10 --verbose  
//. node diagnostic/enrichRoute.js exports/arbitrage_2026-03-10T12-06-37-251Z_enriched.json

//  node diagnostic/enrichRoute.js --input candidates_routed_SOL.json  --topn 10 --verbose --slippage 20
//.  node diagnostic/enrichRoute.js --input Dashboard/stage1_pools.json --topn 10 --verbose
//. node diagnostic/enrichRoute.js exports/arbitrage_2026-03-10T12-06-37-251Z_enriched.json

//  node diagnostic/enrichRoute.js --input exports/arbitrage_2026-03-11T05-58-49-414Z.json  --priority 10000 --jito 20000 --slippage 20