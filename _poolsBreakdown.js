#!/usr/bin/env node
'use strict';
/**
 * _diagnose_pools.js - Understand why pool types aren't in routes
 * 
 * Usage: node set1/_diagnose_poolsBreakdown.js ./samplePool.json
 * Usage: node tools/_diagnose_poolsBreakdownXX.js ./out/RICHed.json
 */

const fs = require('fs');
const path = require('path');

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// Token symbol cache - will be populated from Jupiter token list
let tokenSymbolCache = {};

// Hard-coded common tokens as fallback
const FALLBACK_SYMBOLS = {
  [SOL]: 'SOL',
  [USDC]: 'USDC',
  [USDT]: 'USDT',
  'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij': 'cbBTC',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
  'J1toso1uCk3RLmjorhTtrVwY9HJ7XxfVPEgD1tqr43z': 'JITOSOL',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
  'bSo13r4TkiE4xumDGjLMqMpzR8vKE9UXWsXYQjtNJXe': 'bSOL',
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': 'stETH',
  'LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp': 'LST',
  'RChsv3Z1NefW9Zq6UkhV6U8Tq7bG1FHy3JCn9JDE9j9': 'RAY',
  '7BgBvy9rXoHnRxqr7NhcNhcC8y5v1L2Qy1Q9L9P1mJw9': 'PYTH',
  'orcaEKTdK7LKz57vaAYr9QeDsVE4gxw94VzC4b6YQ4U': 'ORCA',
  'MNDEFzGvMt87ueuHvVU9VcTgsAP4d4c8hQe6c1kM9s1': 'MNDE',
  'KMNoG2D33pSTo9q3zTjK1Aj7qZ1kX2o5C7hY9eX4zP2': 'KMNO',
  '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4': 'PENGU',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP',
  'HZ1J1NiSHqEzZ9g2xQS4JqJr1HG7bXaqCCY72qMWZ7pJ': 'USDS',
  'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdWBhqvooch': 'JUPSOL',
  '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4': 'JLP',
  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh': 'NVDAx',
  'METAewgxyPbgwsseH8T16a39CQ5VyVxZi9zXiDPY18m': 'META',
  '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump': 'FARTCOIN',
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB': 'USD1',
  'BLVxek8YMXUQhcKmMvrFTrzh5FXg8ec88Crp6otEaCMf': 'BELIEVE',
  'Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk': 'USELESS',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP',
  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr': 'POPCAT'
};

// Fetch Jupiter strict token list
async function loadTokenSymbols() {
  try {
    const response = await fetch('https://token.jup.ag/strict');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const tokenList = await response.json();

    // Build cache from token list
    for (const token of tokenList) {
      if (token.address && token.symbol) {
        tokenSymbolCache[token.address] = token.symbol;
      }
    }

    // Merge with fallback symbols (fallback takes precedence for known tokens)
    tokenSymbolCache = { ...tokenSymbolCache, ...FALLBACK_SYMBOLS };

    return tokenSymbolCache;
  } catch (err) {
    // Use fallback symbols if fetch fails
    tokenSymbolCache = { ...FALLBACK_SYMBOLS };
    return tokenSymbolCache;
  }
}

function shortMint(m) {
  return m ? `${m.slice(0, 6)}...${m.slice(-4)}` : '???';
}

function getTokenSymbol(mint) {
  if (!mint) return '???';
  return tokenSymbolCache[mint] || shortMint(mint);
}

function getPairSymbol(baseMint, quoteMint) {
  return `${getTokenSymbol(baseMint)}/${getTokenSymbol(quoteMint)}`;
}

function normalizeType(pool) {
  const t = (pool?.type || pool?.poolType || '').toLowerCase();
  const dex = (pool?.dex || '').toLowerCase();

  if (t.includes('dlmm') || dex.includes('dlmm')) return 'dlmm';
  if (t.includes('whirlpool') || dex.includes('orca') || dex.includes('whirlpool')) return 'whirlpool';
  if (t.includes('clmm') || dex.includes('clmm')) return 'clmm';
  if (t.includes('cpmm') || t.includes('amm') || dex.includes('raydium')) return 'cpmm'; // Default Raydium to CPMM if not CLMM
  return 'cpmm';
}

function hasReserves(pool) {
  // CPMM/General reserves
  const x = parseFloat(pool?.baseReserve || pool?.xReserve || pool?.reserve_x_amount || pool?.tokenAAmount || 0);
  const y = parseFloat(pool?.quoteReserve || pool?.yReserve || pool?.reserve_y_amount || pool?.tokenBAmount || 0);

  // DLMM/CLMM liquidity
  const liq = parseFloat(pool?.liquidity || 0);

  return (x > 0 && y > 0) || liq > 0;
}

// Check if pool has explicit vault addresses if that's what we are looking for
function hasVaults(pool) {
  if (pool.type === 'dlmm') {
    // Some DLMM dumps might use reserveX/Y as vault amounts, but here we might check for vault accounts?
    // Let's assume having reserves is enough for now, or check specific fields if known.
    // Referring to the broken code, it looked for xVault/yVault.
    return (pool.xVault || pool.tokenXVault) && (pool.yVault || pool.tokenYVault);
  }
  return false;
}

async function diagnose(filePath) {
  console.log('═'.repeat(70));
  console.log('POOL COMPOSITION DIAGNOSTIC');
  console.log('═'.repeat(70));

  // Load token symbols first
  await loadTokenSymbols();

  // Load pools
  let raw;
  try {
    if (fs.lstatSync(filePath).isDirectory()) {
      // If directory, maybe look for json files?
      console.error("Provided path is a directory. Please provide a JSON file.");
      return;
    }
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Failed to read file: ${e.message}`);
    return;
  }

  const pools = Array.isArray(raw) ? raw : (raw.pools || raw.data || Object.values(raw));

  console.log(`\nLoaded ${pools.length} pools\n`);

  // Group by type
  const byType = { dlmm: [], whirlpool: [], clmm: [], cpmm: [] };

  for (const p of pools) {
    const type = normalizeType(p);
    if (byType[type]) {
      byType[type].push(p);
    } else {
      // Fallback or unknown
      byType.cpmm.push(p);
    }
  }

  const cpmmPools = byType.cpmm;
  const dlmmPools = byType.dlmm;
  const clmmPools = byType.clmm;
  const whirlpoolPools = byType.whirlpool;

  // =========================================================================
  // 1. Overview
  // =========================================================================
  console.log('[1] POOL COUNT BY TYPE');
  console.log('-'.repeat(70));
  for (const [type, arr] of Object.entries(byType)) {
    console.log(`  ${type.toUpperCase()}: ${arr.length} pools`);
  }

  // =========================================================================
  // 2. SOL/USDC availability per type
  // =========================================================================
  console.log('\n[2] SOL/USDC PAIRS PER TYPE');
  console.log('-'.repeat(70));

  for (const [type, arr] of Object.entries(byType)) {
    if (arr.length === 0) continue;

    const withSol = arr.filter(p => p.baseMint === SOL || p.quoteMint === SOL);
    const withUsdc = arr.filter(p => p.baseMint === USDC || p.quoteMint === USDC);
    const solUsdc = arr.filter(p =>
      (p.baseMint === SOL && p.quoteMint === USDC) ||
      (p.baseMint === USDC && p.quoteMint === SOL)
    );
    const withReserves = arr.filter(hasReserves);

    console.log(`\n  ${type.toUpperCase()} (${arr.length} pools):`);
    console.log(`    With reserves/liq: ${withReserves.length}`);
    console.log(`    With SOL: ${withSol.length}`);
    console.log(`    With USDC: ${withUsdc.length}`);
    console.log(`    SOL/USDC direct: ${solUsdc.length}`);

    if (withSol.length === 0 && withUsdc.length === 0) {
      console.log(`    ⚠️  NO SOL OR USDC PAIRS - cannot form triangular routes!`);
    }
  }

  // =========================================================================
  // 3. Sample pools per type
  // =========================================================================
  console.log('\n[3] SAMPLE POOLS PER TYPE');
  console.log('-'.repeat(70));

  for (const [type, arr] of Object.entries(byType)) {
    if (arr.length === 0) continue;

    console.log(`\n  ${type.toUpperCase()} samples:`);

    // Show up to 3 samples
    for (const p of arr.slice(0, 3)) {
      const pair = getPairSymbol(p.baseMint, p.quoteMint);
      const addr = shortMint(p.poolAddress || p.address || p.pubkey);
      console.log(`    ${addr} | ${pair}`);
    }
  }

  // =========================================================================
  // 4a. CLMM Deep Dive
  // =========================================================================
  if (clmmPools.length > 0) {
    console.log('\n[4a] CLMM DEEP DIVE');
    console.log('-'.repeat(70));

    // Get all unique tokens in CLMM
    const clmmTokens = new Set();
    for (const p of clmmPools) {
      if (p.baseMint) clmmTokens.add(p.baseMint);
      if (p.quoteMint) clmmTokens.add(p.quoteMint);
    }

    console.log(`  Unique tokens in CLMM pools: ${clmmTokens.size}`);
    console.log(`  Has SOL: ${clmmTokens.has(SOL) ? 'YES' : 'NO'}`);
    console.log(`  Has USDC: ${clmmTokens.has(USDC) ? 'YES' : 'NO'}`);

    const clmmWithReserves = clmmPools.filter(hasReserves);
    console.log(`\n  CLMM with reserves: ${clmmWithReserves.length}/${clmmPools.length}`);

    if (clmmWithReserves.length === 0) {
      console.log(`  ❌ NO CPMM pools have reserves - they can't be simulated!`);
      const sample = cpmmPools[0];
      console.log(`  Sample pool reserves:`);
      console.log(`    baseReserve: ${sample.baseReserve || sample.xReserve}`);
      console.log(`    quoteReserve: ${sample.quoteReserve || sample.yReserve}`);
    }
  }

  // =========================================================================
  // 4. CPMM Deep Dive
  // =========================================================================
  if (cpmmPools.length > 0) {
    console.log('\n[4b] CPMM DEEP DIVE');
    console.log('-'.repeat(70));

    // Get all unique tokens in CPMM
    const cpmmTokens = new Set();
    for (const p of cpmmPools) {
      if (p.baseMint) cpmmTokens.add(p.baseMint);
      if (p.quoteMint) cpmmTokens.add(p.quoteMint);
    }

    console.log(`  Unique tokens in CPMM pools: ${cpmmTokens.size}`);
    console.log(`  Has SOL: ${cpmmTokens.has(SOL) ? 'YES' : 'NO'}`);
    console.log(`  Has USDC: ${cpmmTokens.has(USDC) ? 'YES' : 'NO'}`);

    const cpmmWithReserves = cpmmPools.filter(hasReserves);
    console.log(`\n  CPMM with reserves: ${cpmmWithReserves.length}/${cpmmPools.length}`);

    if (cpmmWithReserves.length === 0) {
      console.log(`  ❌ NO CPMM pools have reserves - they can't be simulated!`);
      const sample = cpmmPools[0];
      console.log(`  Sample pool reserves:`);
      console.log(`    baseReserve: ${sample.baseReserve || sample.xReserve}`);
      console.log(`    quoteReserve: ${sample.quoteReserve || sample.yReserve}`);
    }
  }

  // =========================================================================
  // 4. whirlpools Deep Dive
  // =========================================================================
  if (whirlpoolPools.length > 0) {
    console.log('\n[4c] whirlpoolPools DEEP DIVE');
    console.log('-'.repeat(70));

    // Get all unique tokens in whirlpoolPools
    const whirlpoolTokens = new Set();
    for (const p of whirlpoolPools) {
      if (p.baseMint) whirlpoolTokens.add(p.baseMint);
      if (p.quoteMint) whirlpoolTokens.add(p.quoteMint);
    }

    console.log(`  Unique tokens in whirlpool pools: ${whirlpoolTokens.size}`);
    console.log(`  Has SOL: ${whirlpoolTokens.has(SOL) ? 'YES' : 'NO'}`);
    console.log(`  Has USDC: ${whirlpoolTokens.has(USDC) ? 'YES' : 'NO'}`);

    const whirlpoolWithReserves = whirlpoolPools.filter(hasReserves);
    console.log(`\n  whirlpool with reserves: ${whirlpoolWithReserves.length}/${whirlpoolPools.length}`);

    if (whirlpoolWithReserves.length === 0) {
      console.log(`  ❌ NO whirlpool pools have reserves - they can't be simulated!`);
      const sample = whirlpoolPools[0];
      console.log(`  Sample pool reserves:`);
      console.log(`    baseReserve: ${sample.baseReserve || sample.xReserve}`);
      console.log(`    quoteReserve: ${sample.quoteReserve || sample.yReserve}`);
    }
  }

  // =========================================================================
  // 5. DLMM Deep Dive
  // =========================================================================
  if (dlmmPools.length > 0) {
    console.log('\n[5] DLMM DEEP DIVE');
    console.log('-'.repeat(70));

    // Check reserves
    const dlmmWithVaults = dlmmPools.filter(hasVaults);
    const dlmmWithBins = dlmmPools.filter(hasBins);
    console.log(`  DLMM with vaults/bins: ${dlmmWithVaults.length}/${dlmmPools.length}`);
    console.log(`  DLMM with vaults/bins: ${dlmmWithBins.length}/${dlmmPools.length}`);
    if (dlmmWithVaults.length === 0) {
      console.log(`  ❌ NO DLMM pools have vaults!`);
      const Vaults = dlmmPools[0];
      console.log('Sample pool keys:', Object.keys(Vaults).join(', '));
    }
  } else if (dlmmWithBins.length === 0) {
    console.log(`  ❌ NO DLMM pools have bins!`);
    const Bins = dlmmPools[0];
    console.log('Sample pool keys:', Object.keys(Bins).join(', '));
  }
}

// =========================================================================
// 6. TVL ANALYSIS (Liquidity Depth Check)
// =========================================================================
// Add missing helper functions (define these before using them)
function normalizeType(pool) {
  // Implement based on your pool type detection logic
  if (pool.type) return pool.type.toLowerCase();
  if (pool.ammType) return pool.ammType.toLowerCase();
  if (pool.programId?.includes('whirlpool')) return 'whirlpool';
  // Add more detection logic as needed
  return 'unknown';
}

function getPairSymbol(baseMint, quoteMint) {
  // Implement based on your token symbol mapping
  const baseSymbol = tokenSymbols[baseMint] || shortMint(baseMint);
  const quoteSymbol = tokenSymbols[quoteMint] || shortMint(quoteMint);
  return `${baseSymbol}/${quoteSymbol}`;
}

function shortMint(address) {
  if (!address) return 'N/A';
  return address.substring(0, 4) + '...' + address.substring(address.length - 4);
}

// Initialize byType object (if not defined elsewhere)
const byType = {
  cpmm: [],
  clmm: [],
  whirlpool: [],
  dlmm: [],
  unknown: []
};

// Fix the main function - add parameter for pools array
// Modify the analyzeTVL function to include the summary
function analyzeTVL(pools) {
  // ... previous TVL analysis code ...

  // Add pool summary at the end
  console.log(`\n[7] POOL SUMMARY (All ${pools.length} Pools)`);
  console.log('-'.repeat(70));

  // Summary statistics
  const typeCounts = {};
  pools.forEach(p => {
    const type = normalizeType(p);
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });

  console.log('  Pool Type Distribution:');
  for (const [type, count] of Object.entries(typeCounts)) {
    const percentage = ((count / pools.length) * 100).toFixed(1);
    console.log(`    ${type.padEnd(12)}: ${count.toString().padEnd(4)} (${percentage}%)`);
  }

  // ... rest of your summary logic
}
{  // Changed from using global 'pool' variable
  console.log('\n[6] TVL ANALYSIS (Liquidity Depth)');
  console.log('-'.repeat(70));

  // Calculate TVL for each pool with error handling
  function calculateTVL(pool) {
    try {
      const type = normalizeType(pool);

      // For CPMM: use reserves
      if (type === 'cpmm') {
        const x = BigInt(pool.baseReserve || pool.xReserve || pool.reserve_x_amount || 0);
        const y = BigInt(pool.quoteReserve || pool.yReserve || pool.reserve_y_amount || 0);
        // Rough TVL estimate: sum of both sides (in lamports)
        return Number(x + y) / 1e9; // Convert to SOL units
      }

      // For CLMM/Whirlpool: use liquidity (virtual liquidity in Q64.64)
      if (type === 'clmm' || type === 'whirlpool') {
        const liq = BigInt(pool.liquidity || 0);
        // Convert virtual liquidity to approximate SOL value
        // This is a rough approximation - you might need to adjust the scaling factor
        return Number(liq) / 1e12; // Scale down from Q64.64
      }

      // For DLMM: sum bin reserves
      if (type === 'dlmm') {
        const bins = pool.bins || [];
        let total = 0n;
        for (const bin of bins) {
          total += BigInt(bin.reserveA || 0) + BigInt(bin.reserveB || 0);
        }
        return Number(total) / 1e9;
      }

      return 0;
    } catch (error) {
      console.error(`Error calculating TVL for pool: ${pool.poolAddress || pool.address}`, error);
      return 0;
    }
  }

  // ============================================
  // TVL ANALYSIS FUNCTION
  // ============================================

  function analyzeTVL(pools) {
    console.log('\n[6] TVL ANALYSIS (Liquidity Depth)');
    console.log('-'.repeat(70));

    // Validate input
    if (!pools || !Array.isArray(pools)) {
      console.error('  ❌ ERROR: pools must be an array');
      return null;
    }

    if (pools.length === 0) {
      console.log('  ℹ️  No pools to analyze');
      return null;
    }

    // Calculate TVL for each pool
    function calculateTVL(pool) {
      try {
        const type = normalizeType(pool);
        const raw = pool._raw || {};

        // 1. Try to use pre-calculated TVL from API
        if (raw.tvl) {
          return Number(raw.tvl);
        }
        if (raw.liquidity && type === 'dlmm') {
          // For DLMM, raw.liquidity often represents USD value
          return Number(raw.liquidity);
        }

        // 2. Fallback to reserves/liquidity calculation

        // For CPMM: use reserves
        if (type === 'cpmm') {
          const x = BigInt(pool.baseReserve || pool.xReserve || pool.reserve_x_amount || 0);
          const y = BigInt(pool.quoteReserve || pool.yReserve || pool.reserve_y_amount || 0);
          // Rough estimate if no TVL available (often unreliable without price)
          return Number(x + y) / 1e9;
        }

        // For CLMM/Whirlpool: use liquidity (L)
        // Note: This is NOT USD TVL, just raw liquidity value.
        // Without price, we can't get true TVL.
        if (type === 'clmm' || type === 'whirlpool') {
          const liq = BigInt(pool.liquidity || raw.liquidity || 0);
          // If we really want to show something non-zero, we might just return it scaled
          // But generally, if raw.tvl is missing, we might report 0 or N/A
          return Number(liq) / 1e12;
        }

        // For DLMM: sum bin reserves
        if (type === 'dlmm') {
          const bins = pool.bins || [];
          let total = 0n;
          for (const bin of bins) {
            total += BigInt(bin.reserveA || 0) + BigInt(bin.reserveB || 0);
          }
          return Number(total) / 1e9;
        }

        return 0;
      } catch (error) {
        console.warn(`  ⚠️  TVL calculation error for pool: ${pool.address || 'unknown'}`);
        return 0;
      }
    }

    // Calculate TVL for all pools
    const poolsWithTVL = pools.map(p => ({
      ...p,
      tvl: calculateTVL(p),
      type: normalizeType(p)
    }));

    // Sort by TVL descending
    const sortedByTVL = poolsWithTVL.sort((a, b) => b.tvl - a.tvl);

    // TVL threshold
    const TVL_THRESHOLD = 750000;

    // Count pools above threshold
    const aboveThreshold = sortedByTVL.filter(p => p.tvl >= TVL_THRESHOLD);
    const belowThreshold = sortedByTVL.filter(p => p.tvl < TVL_THRESHOLD);

    console.log(`  TVL Threshold: $${TVL_THRESHOLD.toLocaleString()} USD-equivalent`);
    console.log(`  Pools above threshold: ${aboveThreshold.length}/${pools.length}`);
    console.log(`  Pools below threshold: ${belowThreshold.length}/${pools.length}`);

    // Show top 20 pools by TVL
    console.log(`\n  Top 20 Pools by TVL:`);
    console.log(`  ${'Rank'.padEnd(6)} ${'Type'.padEnd(12)} ${'TVL'.padEnd(16)} ${'Fee'.padEnd(10)} ${'Pair'.padEnd(30)} ${'Pool Address'}`);
    console.log(`  ${'-'.repeat(100)}`);

    sortedByTVL.slice(0, 100).forEach((p, i) => {
      const pair = getPairSymbol(p, p.baseMint, p.quoteMint);
      const addr = shortMint(p.poolAddress || p.address);
      const tvlStr = formatTVL(p.tvl);
      const marker = p.tvl >= TVL_THRESHOLD ? '✓' : '✗';

      // Fee handling
      let feeStr = 'N/A';
      if (p.feeRate !== undefined) feeStr = (p.feeRate * 100).toFixed(2) + '%';
      if (p.fee !== undefined) feeStr = (p.fee * 100).toFixed(2) + '%';
      if (p.feeBps !== undefined) feeStr = (p.feeBps / 100).toFixed(2) + '%'; // Whirlpool uses BPS
      if (p._raw && p._raw.feeRate !== undefined) feeStr = (p._raw.feeRate * 100).toFixed(2) + '%'; // Raw override

      console.log(`  ${marker} ${(i + 1).toString().padEnd(3)} ${p.type.padEnd(12)} ${tvlStr.padEnd(16)} ${feeStr.padEnd(10)} ${pair.padEnd(30)} ${addr}`);
    });

    // Show pools below threshold
    if (belowThreshold.length > 0) {
      console.log(`\n  Sample Pools Below Threshold (${belowThreshold.length} total):`);
      console.log(`  ${'Type'.padEnd(12)} ${'TVL'.padEnd(16)} ${'Pair'.padEnd(20)} ${'Pool Address'}`);
      console.log(`  ${'-'.repeat(80)}`);
      belowThreshold.slice(0, 5).forEach(p => {
        const pair = getPairSymbol(p, p.baseMint, p.quoteMint);
        const addr = shortMint(p.poolAddress || p.address);
        const tvlStr = formatTVL(p.tvl);
        console.log(`  ✗ ${p.type.padEnd(12)} ${tvlStr.padEnd(16)} ${pair.padEnd(20)} ${addr}`);
      });
    }

    // TVL by type summary
    console.log(`\n  TVL Summary by Type:`);
    console.log(`  ${'Type'.padEnd(12)} ${'Count'.padEnd(8)} ${'Above Threshold'.padEnd(16)} ${'Avg TVL'.padEnd(15)} ${'Max TVL'}`);
    console.log(`  ${'-'.repeat(70)}`);

    // Group by type
    const byType = {};
    poolsWithTVL.forEach(p => {
      const type = p.type;
      if (!byType[type]) byType[type] = [];
      byType[type].push(p);
    });

    for (const [type, arr] of Object.entries(byType)) {
      if (arr.length === 0) continue;

      const aboveCount = arr.filter(p => p.tvl >= TVL_THRESHOLD).length;
      const avgTVL = arr.reduce((sum, p) => sum + p.tvl, 0) / arr.length;
      const maxTVL = Math.max(...arr.map(p => p.tvl));

      console.log(`  ${type.padEnd(12)} ${arr.length.toString().padEnd(8)} ${aboveCount.toString().padEnd(16)} ${avgTVL.toLocaleString(undefined, { maximumFractionDigits: 2 }).padEnd(15)} ${maxTVL.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    }

    // Filter check
    console.log(`\n  Filter Check:`);
    if (aboveThreshold.length === 0) {
      console.log(`  🔴 WARNING: No pools meet the $${TVL_THRESHOLD.toLocaleString()} USD TVL threshold!`);
      console.log(`     Routes will be filtered out. Consider lowering threshold.`);
    } else if (aboveThreshold.length < 10) {
      console.log(`  🟡 WARNING: Only ${aboveThreshold.length} pools above threshold - limited route options`);
    } else {
      console.log(`  ✅ ${aboveThreshold.length} pools available for routing (above threshold)`);
    }

    return {
      sortedByTVL,
      aboveThreshold,
      belowThreshold,
      byType
    };
  }
  // Define a function that accepts pools as parameter

  function generatePoolSummary(pools) {
    console.log(`\n[7] POOL SUMMARY (All ${pools.length} Pools)`);
    console.log('-'.repeat(70));

    if (!pools || !Array.isArray(pools) || pools.length === 0) {
      console.log('  ℹ️  No pools to summarize');
      return;
    }

    // Type distribution
    const typeCounts = {};
    pools.forEach(p => {
      const type = normalizeType(p);
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    console.log('  Pool Type Distribution:');
    for (const [type, count] of Object.entries(typeCounts)) {
      const percentage = ((count / pools.length) * 100).toFixed(1);
      console.log(`    ${type.padEnd(12)}: ${count.toString().padEnd(4)} (${percentage}%)`);
    }

    // Additional statistics
    const hasTVL = pools.some(p => p.tvl !== undefined);
    if (hasTVL) {
      const poolsWithTVL = pools.filter(p => p.tvl !== undefined);
      const totalTVL = poolsWithTVL.reduce((sum, p) => sum + (p.tvl || 0), 0);
      const avgTVL = totalTVL / poolsWithTVL.length;

      console.log(`\n  TVL Statistics:`);
      console.log(`    Total TVL: ${formatTVL(totalTVL)}`);
      console.log(`    Average TVL per pool: ${formatTVL(avgTVL)}`);
      console.log(`    Pools with TVL data: ${poolsWithTVL.length}/${pools.length}`);
    }

    // Mint statistics
    const uniqueMints = new Set();
    pools.forEach(p => {
      if (p.baseMint) uniqueMints.add(p.baseMint);
      if (p.quoteMint) uniqueMints.add(p.quoteMint);
    });

    console.log(`\n  Token Statistics:`);
    console.log(`    Unique tokens: ${uniqueMints.size}`);
    console.log(`    Total pools: ${pools.length}`);
    console.log(`    Average pools per token: ${(pools.length / Math.max(uniqueMints.size, 1)).toFixed(1)}`);
  }

  return {
    analyzeTVL,
    simulateAllTriangles,
    simulateTriangle,
    simulateSwap,
    calculateSlippage,
    generatePoolSummary,
    exportResults,
    isUSDCUSDTLeg
  };
}


// Helper function for TVL formatting
function formatTVL(tvl) {
  if (tvl >= 1000000) {
    return (tvl / 1000000).toFixed(2) + 'M';
  } else if (tvl >= 1000) {
    return (tvl / 1000).toFixed(2) + 'K';
  } else {
    return tvl.toFixed(2);
  }
}



// You'll need to define this somewhere (or fetch from API)
const tokenSymbols = {
  // Add your token mint to symbol mappings here
  // Example: 'So11111111111111111111111111111111111111112': 'SOL'
};

// Usage:
// const result = analyzeTVL(yourPoolsArray);



// Helper: detect a USDC<->USDT leg by mint or symbol
function isUSDCUSDTLeg(pool, legInfo = null) {
  const inMint = legInfo?.inputMint || pool.baseMint || pool.mintA || pool.tokenXMint || pool.tokenAMint || '';
  const outMint = legInfo?.outputMint || pool.quoteMint || pool.mintB || pool.tokenYMint || pool.tokenBMint || '';
  const hasUSDC = [inMint, outMint].some(m => typeof m === 'string' && m.startsWith('EPjF'));
  const hasUSDT = [inMint, outMint].some(m => typeof m === 'string' && m.startsWith('Es9v'));
  if (hasUSDC && hasUSDT) return true;

  // Fallback to symbols if mints not present
  const aSym = (pool.tokenASymbol || pool.symbolA || legInfo?.from || '').toUpperCase();
  const bSym = (pool.tokenBSymbol || pool.symbolB || legInfo?.to || '').toUpperCase();
  const syms = [aSym, bSym];
  if (syms.includes('USDC') && syms.includes('USDT')) return true;

  return false;
}
function parseArgs(argv) {
  const out = { input: null, help: false, pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    const kv = a.match(/^([a-zA-Z][\\w-]*)=(.*)$/);
    if (kv) {
      let val = kv[2];
      if (val === '' && argv[i + 1] && !argv[i + 1].startsWith('-')) val = argv[++i];
      if (['input', 'in'].includes(kv[1])) out.input = val;
      continue;
    }
    if (a.startsWith('--')) {
      const key = a.replace(/^--?/, '').toLowerCase();
      let val = argv[i + 1];
      if (val && val.startsWith('--')) val = '';
      if (val !== '' && val != null && !val.startsWith('--')) i++;
      if (['input', 'in'].includes(key)) out.input = val;
      continue;
    }
    out.pos.push(a);
  }
  return out;
}


// Enhanced slippage calculation
function calculateSlippage(pool, amountIn, direction) {
  const poolType = pool.type || pool.poolType || 'unknown';
  let baseSlippage = 50; // 0.5% base

  if (pool.liquidityUSD) {
    // Adjust based on liquidity
    if (pool.liquidityUSD < 100000) baseSlippage = 200; // 2%
    else if (pool.liquidityUSD < 500000) baseSlippage = 100; // 1%
    else if (pool.liquidityUSD < 1000000) baseSlippage = 50; // 0.5%
    else baseSlippage = 25; // 0.25%
  }

  // Size adjustment (if amount is large relative to liquidity)
  if (pool.xReserve && pool.yReserve) {
    const relevantReserve = direction === 'A2B' ? pool.xReserve : pool.yReserve;
    const reserveAmount = parseFloat(relevantReserve) || 0;
    const inputRatio = amountIn / reserveAmount;

    if (inputRatio > 0.01) { // >1% of reserve
      baseSlippage *= (1 + inputRatio * 10);
    }
  }

  // Cap at maximum
  return Math.min(baseSlippage, this.config.MAX_SLIPPAGE_BPS);
}

// Simulate swap through a pool
function simulateSwap(pool, amountIn, direction, legInfo = null) {
  const poolType = pool.type || pool.poolType || 'unknown';
  const feeBps = pool.feeBps || 25;
  const slippageBps = this.calculateSlippage(pool, amountIn, direction);

  // Hard block: USDC<->USDT off-peg quotes outside ±0.5%
  if (this.isUSDCUSDTLeg(pool, legInfo)) {
    // Calculate implied price from pool
    let impliedPrice = 1;
    if (pool.sqrtPriceX64) {
      const sqrtPrice = parseFloat(pool.sqrtPriceX64);
      const rawPrice = sqrtPrice * sqrtPrice / Math.pow(2, 128);
      const dec0 = pool.baseDecimals || 6;
      const dec1 = pool.quoteDecimals || 6;
      impliedPrice = rawPrice * Math.pow(10, dec0 - dec1);
    } else if (pool.xReserve && pool.yReserve) {
      const x = parseFloat(pool.xReserve);
      const y = parseFloat(pool.yReserve);
      impliedPrice = (x > 0 && y > 0) ? y / x : 1;
    }
    const deviation = Math.abs(impliedPrice - 1);
    if (!(impliedPrice > 0) || deviation > 0.005) {
      console.debug(`Stable sanity block: USDC/USDT px=${impliedPrice.toFixed(6)} deviation=${deviation.toFixed(4)}`);
      return {
        amountOut: 0,
        feeBps,
        slippageBps,
        priceUsed: impliedPrice,
        blocked: true,
        error: `Stable pair off-peg: px=${impliedPrice}`
      };
    }
  }

  // Calculate price based on pool type
  let price = 1;

  switch (poolType.toLowerCase()) {
    case 'whirlpool':
    case 'clmm':
      if (pool.sqrtPriceX64) {
        const sqrtPrice = parseFloat(pool.sqrtPriceX64);
        const rawPrice = sqrtPrice * sqrtPrice / Math.pow(2, 128);
        // Adjust for token decimals: price = raw_price * 10^(dec0 - dec1)
        const dec0 = pool.baseDecimals || 9;
        const dec1 = pool.quoteDecimals || 6;
        price = rawPrice * Math.pow(10, dec0 - dec1);
      }
      break;

    case 'dlmm':
      if (pool.bins && pool.bins.length > 0) {
        // Use active bin price
        const activeBin = pool.bins.find(b => b.active) || pool.bins[0];
        if (activeBin && activeBin.price) {
          price = activeBin.price;
        }
      }
      break;

    case 'cpmm':
      if (pool.xReserve && pool.yReserve) {
        const xReserve = parseFloat(pool.xReserve);
        const yReserve = parseFloat(pool.yReserve);
        if (xReserve > 0 && yReserve > 0) {
          price = direction === 'A2B' ? yReserve / xReserve : xReserve / yReserve;
        }
      }
      break;
  }
  // Add this check before line 686
  if (typeof pool === 'undefined') {
    // Try to get pools from a different variable name
    const availableVariables = Object.keys(global);
    const poolVariables = availableVariables.filter(v =>
      v.toLowerCase().includes('pool') &&
      Array.isArray(global[v])
    );

    if (poolVariables.length > 0) {
      console.warn(`Warning: 'pool' is undefined. Using '${poolVariables[0]}' instead.`);
      pool = global[poolVariables[0]];
    } else {
      console.error('Error: No pool array found. Please define pool variable.');
      // Exit or return based on your needs
      return;
    }
  }

  // Now this line should work
  console.log(`\n[7] POOL SUMMARY (All ${pool.length} Pools)`);


  // Apply fee and slippage
  const fee = amountIn * (feeBps / 10000);
  const amountAfterFee = amountIn - fee;
  const slippage = amountAfterFee * (slippageBps / 10000);
  const amountAfterSlippage = amountAfterFee - slippage;

  const amountOut = amountAfterSlippage * price;

  return {
    amountOut: Math.floor(amountOut),
    feeBps,
    slippageBps,
    priceUsed: price
  };
}



// =========================================================================
// 7. POOL SUMMARY (All Pools with Symbols)
// =========================================================================
console.log(`\n[7] POOL SUMMARY (All ${poolData, pool.length} Pools)`);
console.log('-'.repeat(60));
console.log(`  ${'Type'.padEnd(10)} ${'TVL'.padEnd(14)} ${'Pair'.padEnd(20)} ${'Fee'}`);
console.log(`  ${'-'.repeat(60)}`);

generatePoolSummary(poolData);

sortedByTVL.forEach((p, i) => {
  const pair = getPairSymbol(p.baseMint, p.quoteMint);
  const tvlStr = p.tvl >= 1000000
    ? (p.tvl / 1000000).toFixed(2) + 'M'
    : p.tvl >= 1000
      ? (p.tvl / 1000).toFixed(2) + 'K'
      : p.tvl.toFixed(2);
  const marker = p.tvl >= TVL_THRESHOLD ? '✓' : '✗';
  const fee = (p.feeBps || 0) + 'bps';
  console.log(`  ${marker} ${p.type.padEnd(10)} ${tvlStr.padEnd(14)} ${pair.padEnd(20)} ${fee}`);
});

// =========================================================================
// 8. RECOMMENDATIONS
// =========================================================================
console.log('\n' + '═'.repeat(70));
console.log('RECOMMENDATIONS');
console.log('═'.repeat(70));

const issues = [];

// Check CPMM
if (cpmmPools.length > 0) {
  const cpmmWithSol = cpmmPools.filter(p => p.baseMint === SOL || p.quoteMint === SOL);
  const cpmmWithUsdc = cpmmPools.filter(p => p.baseMint === USDC || p.quoteMint === USDC);
  const cpmmWithReserves = cpmmPools.filter(hasReserves);

  if (cpmmWithSol.length === 0 && cpmmWithUsdc.length === 0) {
    issues.push('CPMM pools have NO SOL or USDC pairs - fetch Raydium pools with SOL/USDC');
  } else if (cpmmWithReserves.length === 0) {
    issues.push('CPMM pools have no reserves - check _loader.js reserve extraction');
  }
}

// Check CLMM
if (clmmPools.length > 0) {
  const clmmWithSol = clmmPools.filter(p => p.baseMint === SOL || p.quoteMint === SOL);
  const clmmWithReserves = clmmPools.filter(hasReserves);
  if (clmmWithSol.length === 0) {
    issues.push('CLMM pools have no SOL pairs - fetch Raydium CLMM pools with SOL');
  } else if (clmmWithReserves.length === 0) {
    issues.push('CLMM pools have no reserves - check _loader.js reserve extraction');
  }
}

// Check DLMM
if (dlmmPools.length === 0) {
  issues.push('No DLMM pools in data - fetch from Meteora API');
} else {
  const dlmmWithSOL = dlmmPools.filter(p => p.baseMint === SOL || p.quoteMint === SOL);
  const dlmmWithUsdc = dlmmPools.filter(p => p.baseMint === USDC || p.quoteMint === USDC);
  const dlmmWithBins = dlmmPools.filter(hasBins);

  if (dlmmWithSOL.length === 0 && dlmmWithUsdc.length === 0) {
    issues.push('DLMM pools have NO SOL or USDC pairs - fetch Meteora DLMM pools with SOL/USDC');
  } else if (dlmmWithBins.length === 0) {
    issues.push('DLMM pools have no Bins ');
  }

}

// Check Whirlpool
if (whirlpoolPools.length === 0) {
  issues.push('No Whirlpool pools in data - fetch from Orca API');
}

if (issues.length === 0) {
  console.log('\n✓ Pool data looks complete for triangular arbitrage');
} else {
  console.log('\n🔴 Issues preventing cross-DEX routes:\n');
  for (const issue of issues) {
    console.log(`   • ${issue}`);
  }
  console.log('\n💡 Solution: Fetch additional pool data that includes:');
  console.log('   - Raydium CPMM: SOL/X and X/USDC pools');
  console.log('   - Raydium CLMM: SOL/X and X/USDC pools');
  console.log('   - Orca Whirlpool: SOL/X and X/USDC pools');
  console.log('   - Meteora DLMM: SOL/X and X/USDC pools');


  console.log('\n' + '═'.repeat(70));
}





// Simulate complete triangle arbitrage
async function simulateTriangle(triangle, inputAmount = this.config.DEFAULT_INPUT_AMOUNT) {
  const results = {
    triangle: triangle.path.join(' → '),
    inputAmount,
    swaps: [],
    totalOutput: 0,
    profit: 0,
    profitBps: 0,
    feasible: true
  };

  let currentAmount = inputAmount;

  // Leg 1: SOL → tokenB
  const swap1 = this.simulateSwap(triangle.pools[0], currentAmount, 'A2B');
  results.swaps.push({
    leg: 'SOL → ' + triangle.path[1],
    pool: triangle.pools[0].address?.slice(0, 8) + '...',
    type: triangle.pools[0].type,
    amountIn: currentAmount,
    amountOut: swap1.amountOut,
    feeBps: swap1.feeBps,
    slippageBps: swap1.slippageBps,
    price: swap1.priceUsed
  });
  currentAmount = swap1.amountOut;

  // Leg 2: tokenB → tokenC
  const swap2 = this.simulateSwap(triangle.pools[1], currentAmount, 'A2B');
  results.swaps.push({
    leg: triangle.path[1] + ' → ' + triangle.path[2],
    pool: triangle.pools[1].address?.slice(0, 8) + '...',
    type: triangle.pools[1].type,
    amountIn: currentAmount,
    amountOut: swap2.amountOut,
    feeBps: swap2.feeBps,
    slippageBps: swap2.slippageBps,
    price: swap2.priceUsed
  });
  currentAmount = swap2.amountOut;

  // Leg 3: tokenC → SOL
  const swap3 = this.simulateSwap(triangle.pools[2], currentAmount, 'A2B');
  results.swaps.push({
    leg: triangle.path[2] + ' → SOL',
    pool: triangle.pools[2].address?.slice(0, 8) + '...',
    type: triangle.pools[2].type,
    amountIn: currentAmount,
    amountOut: swap3.amountOut,
    feeBps: swap3.feeBps,
    slippageBps: swap3.slippageBps,
    price: swap3.priceUsed
  });

  results.totalOutput = swap3.amountOut;
  results.profit = results.totalOutput - inputAmount;
  results.profitBps = (results.profit / inputAmount) * 10000;

  // Check if profitable after minimum threshold
  results.feasible = results.profitBps >= this.config.MIN_PROFIT_BPS;

  return results;
}

// Batch process triangles
async function simulateAllTriangles(triangles) {
  console.log(`🤖 Simulating ${triangles.length} triangles...`);

  const results = [];
  const batchSize = 5;

  for (let i = 0; i < triangles.length; i += batchSize) {
    const batch = triangles.slice(i, i + batchSize);
    console.log(`  Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(triangles.length / batchSize)}`);

    const batchPromises = batch.map(triangle =>
      this.rateLimiter.enqueue(() => this.simulateTriangle(triangle))
    );

    const batchResults = await Promise.allSettled(batchPromises);

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.warn(`  Failed to simulate triangle ${i + j}:`, result.reason?.message);
      }
    }

    // Garbage collection hint
    if (global.gc) {
      global.gc();
    }

    await new Promise(r => setTimeout(r, 100));
  }

  return results;
}
function getBestPool(tokenPairs, mintA, mintB) {
  const key = `${mintA}-${mintB}`;
  const pools = tokenPairs.get(key) || [];

  if (pools.length === 0) return null;

  // Sort by liquidity descending, then fee ascending
  return pools.sort((a, b) => {
    const liqA = a.liquidityUSD || 0;
    const liqB = b.liquidityUSD || 0;
    const feeA = a.feeBps || 100;
    const feeB = b.feeBps || 100;

    if (liqB !== liqA) return liqB - liqA;
    return feeA - feeB;
  })[0];
}


// Export results
function exportResults(results, format = 'all') {

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const basePath = `./exports/arbitrage_${timestamp}`;

  if (!fs.existsSync('./exports')) {
    fs.mkdirSync('./exports', { recursive: true });
  }

  // Filter profitable triangles
  const profitable = results.filter(r => r.feasible);
  const sorted = profitable.sort((a, b) => b.profitBps - a.profitBps);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('📊 ARBITRAGE RESULTS');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`Total triangles simulated: ${results.length}`);
  console.log(`Profitable triangles: ${profitable.length}`);
  console.log(`Success rate: ${(profitable.length / results.length * 100).toFixed(1)}%`);
  console.log('');

  if (profitable.length > 0) {
    console.log('TOP PROFITABLE TRIANGLES:');
    console.log('┌───────┬────────────────────────────┬──────────────┬──────────────┬─────────────┐');
    console.log('│ Rank  │ Triangle                   │ Input (SOL)  │ Output (SOL) │ Profit (bps)│');
    console.log('├───────┼────────────────────────────┼──────────────┼──────────────┼─────────────┤');

    sorted.slice(0, 10).forEach((result, index) => {
      const inputSol = (result.inputAmount / 1e9).toFixed(4);
      const outputSol = (result.totalOutput / 1e9).toFixed(4);
      console.log(`│ ${(index + 1).toString().padEnd(5)} │ ${result.triangle.padEnd(26)} │ ${inputSol.padStart(12)} │ ${outputSol.padStart(12)} │ ${result.profitBps.toFixed(1).padStart(11)} │`);
    });
    console.log('└───────┴────────────────────────────┴──────────────┴──────────────┴─────────────┘');

    // Detailed view of top triangle
    if (sorted.length > 0) {
      console.log('\n🔍 DETAILS FOR TOP TRIANGLE:');
      const top = sorted[0];
      top.swaps.forEach((swap, i) => {
        console.log(`  Leg ${i + 1}: ${swap.leg}`);
        console.log(`    Pool: ${swap.pool} (${swap.type})`);
        const tokenIn = swap.leg.split('→')[0].trim();
        const tokenOut = swap.leg.split('→')[1].trim();
        console.log(`    Amount in: ${(swap.amountIn / 1e9).toFixed(6)} ${tokenIn}`);
        console.log(`    Amount out: ${(swap.amountOut / 1e9).toFixed(6)} ${tokenOut}`);
        console.log(`    Fee: ${swap.feeBps} bps, Slippage: ${swap.slippageBps.toFixed(1)} bps`);
        console.log(`    Price: ${swap.price.toFixed(6)}`);
      });
    }
  }

  // Export to files
  if (format === 'json' || format === 'all') {
    fs.writeFileSync(`${basePath}.json`, JSON.stringify({
      timestamp,
      totalSimulated: results.length,
      profitable: profitable.length,
      triangles: sorted
    }, null, 2));
    console.log(`\n💾 JSON exported to: ${basePath}.json`);
  }

  if (format === 'csv' || format === 'all') {
    let csv = 'Rank,Triangle,Input_SOL,Output_SOL,Profit_BPS,Pool1_Address,Pool1_Type,Pool2_Address,Pool2_Type,Pool3_Address,Pool3_Type\n';

    sorted.forEach((result, index) => {
      csv += `${index + 1},${result.triangle},${result.inputAmount / 1e9},${result.totalOutput / 1e9},${result.profitBps}`;
      result.swaps.forEach(swap => {
        csv += `,${swap.pool},${swap.type}`;
      });
      csv += '\n';
    });

    fs.writeFileSync(`${basePath}.csv`, csv);
    console.log(`📊 CSV exported to: ${basePath}.csv`);
  }

  return {
    total: results.length,
    profitable: profitable.length,
    topTriangles: sorted.slice(0, 10)
  };
}


// Run
const parsed = parseArgs(process.argv.slice(2));
const filePath = parsed.input || parsed.pos[0];
if (!filePath) {
  console.log('Usage: node _diagnose_pools.js  --input <json_file>');
  process.exit(1);
}

diagnose(filePath);

/*
 node tools/_diagnose_poolsBreakdown.js out/FETCH_raw.json
  node tools/_diagnose_trianglesBackup.js raw/fetch_safe.json

  raw/pools_latest.json
  node tools/_diagnose_poolsBackup.js raw/pools_latest.json
  node tools/enrichPools.mjs
  node tools/_diagnose_pools.js ./allPools/pools_enriched_live.json
  node scanner-fixed.js out/RICHed.json
*/
