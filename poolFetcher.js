'use strict';
/**
 * poolFetcher.js — Fetches pools from ALL DEXes, prioritizing LOW FEES.
 *
 * The market collector sorts by liquidity → misses 1bps CLMM pools.
 * This fetcher sorts by fee FIRST, then liquidity. Gets the cheap legs.
 *
 * Outputs stage1_pools.json shape that triangleRunner.js reads directly.
 *
 * Usage:
 *   node poolFetcher.js [--output pools.json]
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

const HUBS = new Set([WSOL, USDC, USDT]);

// Tokens we want to find pools for — both SOL-paired and USDC-paired
const TARGETS = {
    jitoSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
    mSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    bSOL: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',
    RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    FARTCOIN: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
    TRUMP: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN',
    WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    POPCAT: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    JLP: '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
    cBTC: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
    WETH: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    WBTC: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    USD1: 'USD1tt1S6tqWQq9TdrCXw7m8jK8YEmukPqtxgBNEmuB',
    USDS: 'USDSwr9AiSQN6kYypYCtYbXgNjRjKDfB4cqhfGsBuas',
    META: 'METADDFL6wWMWEoKTFJwcThTbUmtarRJZjRpzUvkxhr',
};

const ALL_MINTS = new Set([...Object.values(TARGETS), ...HUBS]);

// Per-DEX cap. Tiered: keeps BOTH cheap and deep pools.
const MAX_PER_DEX = 40;

// Tiered selection: don't just take cheapest — take best from each fee bracket
function tieredSelect(pools, max) {
    // Bracket 1: 1-2bps (cheapest legs), Bracket 2: 3-10bps (SOL/USDC 4bps lives here), Bracket 3: 11-50bps (deep liq)
    const b1 = pools.filter(p => (p.feeBps || 0) <= 2).sort((a, b) => b.liquidity - a.liquidity);
    const b2 = pools.filter(p => (p.feeBps || 0) > 2 && (p.feeBps || 0) <= 10).sort((a, b) => b.liquidity - a.liquidity);
    const b3 = pools.filter(p => (p.feeBps || 0) > 10 && (p.feeBps || 0) <= 50).sort((a, b) => b.liquidity - a.liquidity);
    // Allocate: 40% cheap, 35% medium, 25% deep
    const n1 = Math.min(b1.length, Math.ceil(max * 0.4));
    const n2 = Math.min(b2.length, Math.ceil(max * 0.35));
    const n3 = Math.min(b3.length, max - n1 - n2);
    const selected = [...b1.slice(0, n1), ...b2.slice(0, n2), ...b3.slice(0, n3)];
    // Fill remainder from largest pools across all brackets
    if (selected.length < max) {
        const used = new Set(selected.map(p => p.address));
        const rest = pools.filter(p => !used.has(p.address) && (p.feeBps || 0) <= 50)
            .sort((a, b) => b.liquidity - a.liquidity);
        selected.push(...rest.slice(0, max - selected.length));
    }
    return selected.slice(0, max);
}

const OUTPUT = process.argv.find(a => a.startsWith('--output='))?.split('=')[1]
    || process.argv[process.argv.indexOf('--output') + 1]
    || 'diagnostic/stage1_pools.json';

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════
async function fetchJson(url, label) {
    try {
        const res = await fetch(url);
        if (!res.ok) { console.log(`  ❌ ${label}: ${res.status}`); return null; }
        return await res.json();
    } catch (e) { console.log(`  ❌ ${label}: ${e.message}`); return null; }
}

function normalize(pool, market) {
    return {
        market,
        address: pool.address || pool.poolAddress || pool.ammId || pool.id,
        mintA: pool.mintA || pool.baseMint || pool.tokenMintA || pool.tokenA?.mint,
        mintB: pool.mintB || pool.quoteMint || pool.tokenMintB || pool.tokenB?.mint,
        feeBps: pool.feeBps ?? null,
        feeRate: pool.feeRate ?? null,
        liquidity: Number(pool.liquidity || pool.tvl || 0),
        tvl: pool.tvl || pool.liquidity || null,
        source: pool.source || market.toLowerCase(),
        collectedAt: new Date().toISOString(),
    };
}

function isRelevant(pool) {
    const a = pool.mintA, b = pool.mintB;
    if (!a || !b) return false;
    // SOL-paired: either mint is SOL
    if (a === WSOL || b === WSOL) return true;
    // Hub-paired target: one side is target, other is hub (USDC/USDT)
    if ((ALL_MINTS.has(a) && HUBS.has(b)) || (ALL_MINTS.has(b) && HUBS.has(a))) return true;
    // Target-target: both are targets (e.g. jitoSOL/mSOL)
    if (ALL_MINTS.has(a) && ALL_MINTS.has(b)) return true;
    return false;
}

// ════════════════════════════════════════════════════════════════════════
// ORCA
// ════════════════════════════════════════════════════════════════════════
// Orca fee tiers by tickSpacing (fallback when feeRate=0)
const ORCA_TS_TO_BPS = { 1: 1, 2: 2, 4: 4, 8: 5, 16: 16, 32: 30, 64: 30, 128: 100, 256: 200 };

async function fetchOrca() {
    console.log('\n🐋 ORCA WHIRLPOOL');
    const json = await fetchJson('https://api.mainnet.orca.so/v1/whirlpool/list', 'Orca API');
    if (!json) return [];
    const pools = Array.isArray(json) ? json : json?.whirlpools || json?.pools || json?.data || [];
    console.log(`  Fetched ${pools.length} total pools`);

    const mapped = pools.map(p => {
        const ts = Number(p.tickSpacing || 0);
        // tickSpacing is the DEFINITIVE fee tier on Orca — always present, never wrong
        // feeRate from API is unreliable (often missing or 0)
        let feeBps = ORCA_TS_TO_BPS[ts] || 0;
        if (feeBps === 0 && ts > 0) feeBps = Math.max(1, Math.round(ts / 2));

        return normalize({
            address: p.address || p.whirlpoolAddress,
            mintA: p.tokenA?.mint || p.tokenMintA,
            mintB: p.tokenB?.mint || p.tokenMintB,
            feeBps,
            feeRate: feeBps / 10000,
            liquidity: p.liquidity || p.tvl,
            tvl: p.tvl,
            source: 'orca_api',
        }, 'ORCA_WHIRLPOOL');
    }).filter(p => isRelevant(p) && p.feeBps > 0);

    // Tiered: keep cheap AND deep pools
    const capped = tieredSelect(mapped, MAX_PER_DEX);
    console.log(`  Relevant: ${mapped.length} → selected ${capped.length} (tiered: cheap+deep)`);
    return capped;
}

// ════════════════════════════════════════════════════════════════════════
// RAYDIUM — AMM + CLMM + CPMM via multiple endpoints
// ════════════════════════════════════════════════════════════════════════
async function fetchRaydiumAMM() {
    console.log('\n📡 RAYDIUM AMM');
    const json = await fetchJson('https://api.raydium.io/v2/ammV3/ammPools', 'Raydium AMM');
    if (!json) return [];
    const pools = Array.isArray(json) ? json : (json.official || json.data || []);
    console.log(`  Fetched ${pools.length} pools`);

    return pools.map(p => normalize({
        address: p.ammId || p.id || p.address,
        mintA: p.baseMint || p.coinMint,
        mintB: p.quoteMint || p.pcMint,
        feeBps: 25,
        feeRate: 0.0025,
        liquidity: p.liquidity || p.tvl,
        source: 'raydium_amm',
    }, 'RAYDIUM_AMM')).filter(isRelevant)
        .sort((a, b) => (b.liquidity - a.liquidity))
        .slice(0, MAX_PER_DEX);
}

async function fetchRaydiumCLMM() {
    console.log('\n📡 RAYDIUM CLMM');

    // From dexEndpoints.js: api-v3 with poolType filter + V2 pairs fallback
    for (const [url, label] of [
        ['https://api-v3.raydium.io/pools/info/list?poolType=concentrated&poolSortField=liquidity&sortType=desc&pageSize=500&page=1', 'V3 concentrated'],
        ['https://api-v3.raydium.io/pools/info/list?poolType=all&poolSortField=liquidity&sortType=desc&pageSize=500&page=1', 'V3 all'],
        ['https://api.raydium.io/v2/main/pairs', 'V2 pairs'],
    ]) {
        const json = await fetchJson(url, label);
        if (!json) continue;

        let pools = [];
        if (json.data?.data) pools = json.data.data;       // V3 nested
        else if (json.data && Array.isArray(json.data)) pools = json.data;
        else if (Array.isArray(json)) pools = json;
        if (pools.length === 0) continue;

        console.log(`  Fetched ${pools.length} pools via ${label}`);

        const mapped = pools.map(p => {
            // V3 API nests fee in multiple places depending on pool type
            const rawFee = p.feeRate
                || p.ammConfig?.tradeFeeRate
                || p.config?.tradeFeeRate
                || p.fee
                || p.lpFeeRate
                || 0;
            let feeBps = 25; // safe default for Raydium
            if (rawFee > 10000) feeBps = Math.round(rawFee / 10000);       // millionths (100000 = 1%)
            else if (rawFee > 100) feeBps = Math.round(rawFee / 100);      // hundred-thousandths
            else if (rawFee > 1 && rawFee <= 100) feeBps = Math.round(rawFee);  // already bps
            else if (rawFee > 0 && rawFee <= 1) feeBps = Math.round(rawFee * 10000);  // decimal (0.0025 = 25bps)
            // If still 0, use type-based default
            if (feeBps === 0) {
                const type = (p.type || '').toLowerCase();
                feeBps = type.includes('concentrated') || type.includes('clmm') ? 1 : 25;
            }

            // V3 uses mintA.address, V2 uses baseMint
            const mintA = p.mintA?.address || p.baseMint || p.mint_a;
            const mintB = p.mintB?.address || p.quoteMint || p.mint_b;
            const type = (p.type || '').toLowerCase();
            const market = type.includes('concentrated') || type.includes('clmm') ? 'RAYDIUM_CLMM'
                : type.includes('standard') || type.includes('cpmm') ? 'RAYDIUM_CPMM'
                    : 'RAYDIUM_AMM';

            return normalize({
                address: p.id || p.poolAddress || p.address, mintA, mintB,
                feeBps, feeRate: feeBps / 10000, liquidity: p.tvl || p.liquidity, source: type || 'raydium',
            }, market);
        }).filter(isRelevant);

        console.log(`  Relevant: ${mapped.length}`);
        return tieredSelect(mapped, MAX_PER_DEX);
    }

    console.log('  ❌ All Raydium CLMM endpoints failed');
    return [];
}

async function fetchRaydiumCPMM() {
    console.log('\n📡 RAYDIUM CPMM');
    for (const [url, label] of [
        ['https://api-v3.raydium.io/pools/info/list?poolType=standard&poolSortField=liquidity&sortType=desc&pageSize=500&page=1', 'V3 standard'],
    ]) {
        const json = await fetchJson(url, label);
        if (!json) continue;
        let pools = [];
        if (json.data?.data) pools = json.data.data;
        else if (json.data && Array.isArray(json.data)) pools = json.data;
        else if (Array.isArray(json)) pools = json;
        if (pools.length === 0) continue;
        console.log(`  Fetched ${pools.length} CPMM pools via ${label}`);

        return pools.map(p => normalize({
            address: p.id || p.poolAddress || p.address,
            mintA: p.mintA?.address || p.mintA,
            mintB: p.mintB?.address || p.mintB,
            feeBps: 25, feeRate: 0.0025,
            liquidity: p.tvl || p.liquidity,
            source: 'raydium_cpmm',
        }, 'RAYDIUM_CPMM')).filter(isRelevant)
            .sort((a, b) => b.liquidity - a.liquidity)
            .slice(0, MAX_PER_DEX);
    }
    console.log('  ❌ CPMM endpoints failed');
    return [];
}

// ════════════════════════════════════════════════════════════════════════
// METEORA — DLMM
// ════════════════════════════════════════════════════════════════════════
async function fetchMeteoraDLMM() {
    console.log('\n🌀 METEORA DLMM');
    const json = await fetchJson('https://dlmm-api.meteora.ag/pair/all', 'Meteora DLMM');
    if (!json) return [];
    const pools = Array.isArray(json) ? json : json.data || [];
    console.log(`  Fetched ${pools.length} DLMM pools`);

    const mapped = pools.map(p => {
        const feeBps = p.base_fee_percentage ? Math.round(Number(p.base_fee_percentage) * 100) : (p.fee_bps || 10);
        return normalize({
            address: p.address || p.pair_address,
            mintA: p.mint_x || p.tokenXMint,
            mintB: p.mint_y || p.tokenYMint,
            feeBps,
            feeRate: feeBps / 10000,
            liquidity: p.liquidity || p.tvl,
            binStep: p.bin_step,
            source: 'meteora_dlmm',
        }, 'METEORA_DLMM');
    }).filter(isRelevant);

    const capped = tieredSelect(mapped, MAX_PER_DEX);
    console.log(`  Relevant: ${mapped.length} → selected ${capped.length} (tiered)`);
    return capped;
}

// ════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════
async function fetchAllPools() {
    console.log('═'.repeat(65));
    console.log('  POOL FETCHER — low-fee priority');
    console.log('═'.repeat(65));
    console.log(`  Targets: ${Object.keys(TARGETS).join(', ')}`);
    console.log(`  Hubs: WSOL, USDC, USDT`);

    const all = [];

    // Fetch from each DEX
    const [orca, ammPools, clmmPools, cpmmPools, dlmm] = await Promise.all([
        fetchOrca(),
        fetchRaydiumAMM(),
        fetchRaydiumCLMM(),
        fetchRaydiumCPMM(),
        fetchMeteoraDLMM(),
    ]);

    all.push(...orca, ...ammPools, ...clmmPools, ...cpmmPools, ...dlmm);

    // Deduplicate by address
    const seen = new Set();
    const unique = [];
    for (const p of all) {
        if (!p.address || seen.has(p.address)) continue;
        seen.add(p.address);
        unique.push(p);
    }

    // Sort: lowest fee first, then highest liquidity
    unique.sort((a, b) => {
        if ((a.feeBps || 0) !== (b.feeBps || 0)) return (a.feeBps || 0) - (b.feeBps || 0);
        return (b.liquidity || 0) - (a.liquidity || 0);
    });

    // Summary
    const solPaired = unique.filter(p => p.mintA === WSOL || p.mintB === WSOL);
    const bcPools = unique.filter(p => p.mintA !== WSOL && p.mintB !== WSOL);

    console.log('\n' + '═'.repeat(65));
    console.log(`  TOTAL: ${unique.length} pools (${solPaired.length} SOL-paired, ${bcPools.length} token-token)`);
    console.log('═'.repeat(65));

    // Fee distribution
    const feeGroups = {};
    unique.forEach(p => {
        const key = `${p.market}:${p.feeBps || '?'}bps`;
        feeGroups[key] = (feeGroups[key] || 0) + 1;
    });
    console.log('\n  Fee distribution:');
    Object.entries(feeGroups).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => {
        console.log(`    ${k.padEnd(30)} ${v} pools`);
    });

    // Show SOL-paired top 20
    console.log('\n  SOL-paired pools (top 20 by fee then liq):');
    solPaired.slice(0, 20).forEach(p => {
        const other = p.mintA === WSOL ? p.mintB : p.mintA;
        const sym = Object.entries(TARGETS).find(([, m]) => m === other)?.[0] || other.slice(0, 8);
        console.log(`    ${sym.padEnd(10)} ${p.market.padEnd(16)} fee=${String(p.feeBps || 0).padStart(3)}bps  liq=$${(p.liquidity / 1e6).toFixed(1)}M`);
    });

    // Show BC pools top 20
    console.log('\n  Token-token pools (top 20 by fee then liq):');
    bcPools.slice(0, 20).forEach(p => {
        const symA = Object.entries({ ...TARGETS, USDC, USDT }).find(([, m]) => m === p.mintA)?.[0] || p.mintA.slice(0, 8);
        const symB = Object.entries({ ...TARGETS, USDC, USDT }).find(([, m]) => m === p.mintB)?.[0] || p.mintB.slice(0, 8);
        console.log(`    ${symA.padEnd(8)}/${symB.padEnd(8)} ${p.market.padEnd(16)} fee=${String(p.feeBps || 0).padStart(3)}bps  liq=$${(p.liquidity / 1e6).toFixed(1)}M`);
    });

    // Save
    const dir = path.dirname(OUTPUT);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(unique, null, 2));
    console.log(`\n💾 Saved ${unique.length} pools to ${OUTPUT}`);

    return unique;
}

// ════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════
if (require.main === module) {
    fetchAllPools()
        .then(pools => {
            console.log(`\n✅ Done. ${pools.length} pools fetched.`);
            process.exit(0);
        })
        .catch(err => {
            console.error(`\n❌ ${err.message}`);
            process.exit(1);
        });
}

module.exports = { fetchAllPools, TARGETS, HUBS, ALL_MINTS };

/*
node poolFetcher.js --output pools.json
node diagnostic/enrichRoute.js --input dashboard/stage1_pools.json --topn 10 --verbose

node triangleRunner.js dashboard/stage1_pools_enriched.json --amount 2 --topn 15

# Then run as before
# Step 1: Fetch pools
node poolFetcher.js --output dashboard/stage1_pools.json

# Step 2: Run triangles (on the FULL pool file)
node triangleRunner.js dashboard/stage1_pools.json --amount 2 --topn 15

# Step 3 (optional, diagnostic only): Enrich the results
node diagnostic/enrichRoute.js --input exports/arbitrage_*.json

*/