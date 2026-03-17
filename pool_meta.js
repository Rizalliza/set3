#!/usr/bin/env node

/**
 * fix_data_pool_ALIGNED.js
 * 
 * Normalize pools into EXACT meta pool shapes required by engine
 * 
 * KEY PRINCIPLES:
 * - Outputs META pools (structure + vaults, NO reserve amounts)
 * - Reserves should come from LIVE enrichment, not stale JSON
 * - Preserves vault addresses for live fetching
 * 
 * Usage:
 *   node fix_pool_meta.js --in output/metaOutput.json --out output/meta_pools_vault.json
 * 
 * Output matches sampleShape.json META POOL format:
 * {
 *   poolAddress: "...",
 *   dex: "meteora",
 *   poolType: "dlmm",
 *   baseToken: { mint, symbol, decimals },
 *   quoteToken: { mint, symbol, decimals },
 *   fee: 0.00002,
 *   vaults: { xVault: "...", yVault: "..." },
 *   raw: { ... }
 * }
 * 
 * node fix_pool_meta.js \
  --in _tryout_raw2.json \
  --out _tryout_enrich.json
 */

const fs = require('fs');
const path = require('path');
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const { PublicKey, Connection } = require('@solana/web3.js');
const { loadAndEnrichPools } = require('./_reservesFetcher.js');
const poolManager = require('./PoolManager.js')
const manager = new poolManager({ strict: false });
const KNOWN_DECIMALS = {
    'So11111111111111111111111111111111111111112': 9,  // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6,  // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6,  // USDT
};


// ============================================================================
// HELPERS
// ============================================================================

function isBase58(s) {
    return typeof s === 'string' && BASE58_RE.test(s);
}

function asString(v) {
    if (v === undefined || v === null) return null;
    return String(v);
}

function parseNumber(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(String(v));
    return Number.isFinite(n) ? n : null;
}

function normalizeSymbol(sym) {
    return (sym || '').toString().trim().toUpperCase();
}

function pick(obj, ...paths) {
    for (const p of paths) {
        if (!p) continue;
        const parts = p.split('.');
        let cur = obj;
        for (const part of parts) {
            if (!cur || typeof cur !== 'object' || !(part in cur)) {
                cur = undefined;
                break;
            }
            cur = cur[part];
        }
        if (cur !== undefined && cur !== null) return cur;
    }
    return undefined;
}

function argValue(flag) {
    const idx = process.argv.indexOf(flag);
    return idx === -1 ? null : (process.argv[idx + 1] || null);
}

function hasFlag(flag) {
    return process.argv.includes(flag);
}

// ============================================================================
// POOL TYPE DETECTION
// ============================================================================
async function connection() {
    const poolPubkey = new PublicKey(poolAddress);
    this.rpcCallCount++; // Track RPC call
    const accountInfo = await this.connection.getAccountInfo(poolPubkey);

    if (!accountInfo || !accountInfo.data) {
        console.log(`[Enhanced] No account data found for pool: ${poolAddress}`);
        this.errorCount++; // Track error
        return { reserveA: null, reserveB: null };
    }
}

function detectPoolType(raw) {
    const dex = (raw.dex || '').toString().toLowerCase();
    const t = (raw.poolType || raw.type || '').toString().toLowerCase();

    // Explicit type
    if (t.includes('dlmm') || t.includes('bin')) return 'dlmm';
    if (t.includes('whirlpool')) return 'whirlpool';

    // IMPORTANT: Orca concentrated pools are Whirlpools (not Raydium CLMM)
    // Some upstream sources label them "clmm"; normalize them to "whirlpool" here.
    if (dex === 'orca') return 'whirlpool';

    if (t.includes('clmm') || t.includes('concentrated')) return 'clmm';
    if (t.includes('cpmm') || t.includes('amm') || t.includes('constant')) return 'cpmm';

    // DEX-based defaults
    if (dex === 'meteora') return 'dlmm';
    if (dex === 'raydium') return t.includes('clmm') ? 'clmm' : 'cpmm';

    return 'cpmm';
}

// ============================================================================
// FEE PARSING
// ============================================================================

function parseFeeRate(raw) {
    // Try explicit fee first
    const direct = pick(raw, 'fee', 'feeRate', 'feePct');
    if (direct !== undefined) {
        const n = parseNumber(direct);
        if (n === null) return 0.003;

        if (n > 1) return n / 10000;       // basis points
        if (n > 0.05) return n / 100;      // percent
        return n;                           // fraction
    }

    // Meteora DLMM: base_fee_percentage in basis points
    const meteoraBps = pick(raw, 'raw.base_fee_percentage', 'base_fee_percentage');
    if (meteoraBps !== undefined) {
        const n = parseNumber(meteoraBps);
        if (n !== null) {
            if (n >= 0 && n <= 1) return n / 10000;
            if (n > 1 && n <= 100) return n / 100;
        }
    }

    return 0.003;  // Default 0.3%
}

// ============================================================================
// VAULT EXTRACTION
// ============================================================================

function extractVaults(raw, poolType) {
    let xVault = null;
    let yVault = null;

    const baseMint = asString(pick(raw, 'baseMint', 'baseToken.mint', 'raw.mint_x', 'mint_x'));
    const quoteMint = asString(pick(raw, 'quoteMint', 'quoteToken.mint', 'raw.mint_y', 'mint_y'));

    // First: if upstream already provided canonical vaults, prefer them.
    // (Also accept reserveXVault/reserveYVault aliases.)
    const canonicalX = asString(pick(raw, 'vaults.xVault', 'reserveXVault', 'xVault'));
    const canonicalY = asString(pick(raw, 'vaults.yVault', 'reserveYVault', 'yVault'));

    // Guardrail: canonical vaults must not equal either mint (common bad upstream bug).
    const canonicalLooksLikeMint =
        (canonicalX && (canonicalX === baseMint || canonicalX === quoteMint)) ||
        (canonicalY && (canonicalY === baseMint || canonicalY === quoteMint));

    if (
        canonicalX &&
        canonicalY &&
        !canonicalLooksLikeMint &&
        isBase58(canonicalX) &&
        isBase58(canonicalY)
    ) {
        return { xVault: canonicalX, yVault: canonicalY };
    }

    if (poolType === 'dlmm') {
        // Meteora DLMM: reserve_x, reserve_y
        xVault = asString(pick(raw, 'raw.reserve_x', 'reserve_x', 'reserveXVault'));
        yVault = asString(pick(raw, 'raw.reserve_y', 'reserve_y', 'reserveYVault'));
    } else if (poolType === 'whirlpool') {
        // Orca Whirlpool: token_vault_a, token_vault_b
        // (Some sources incorrectly put mints into vaults.xVault/yVault; never accept those.)
        xVault = asString(pick(raw, 'raw.token_vault_a', 'token_vault_a', 'vaultA'));
        yVault = asString(pick(raw, 'raw.token_vault_b', 'token_vault_b', 'vaultB'));
    } else if (poolType === 'clmm') {
        // Raydium CLMM: vault_a, vault_b
        xVault = asString(pick(raw, 'raw.vault_a', 'vault_a', 'vaultA'));
        yVault = asString(pick(raw, 'raw.vault_b', 'vault_b', 'vaultB'));
    } else if (poolType === 'cpmm') {
        // Raydium CPMM: vault_x, vault_y
        xVault = asString(pick(raw, 'raw.vault_x', 'vault_x', 'vaultX', 'mint_x', 'base_vault'));
        yVault = asString(pick(raw, 'raw.vault_y', 'vault_y', 'mint_y', 'vaultY', 'quote_vault'));
    }

    // Validate
    if (xVault && !isBase58(xVault)) xVault = null;
    if (yVault && !isBase58(yVault)) yVault = null;

    // Extra guardrail: never accept mints as vaults.
    if (xVault && (xVault === baseMint || xVault === quoteMint)) xVault = null;
    if (yVault && (yVault === baseMint || yVault === quoteMint)) yVault = null;

    return { xVault, yVault };
}

// ============================================================================
// NORMALIZE POOL TO META SHAPE
// ============================================================================

function normalizeToMetaPool(raw) {
    // Pool address
    const poolAddress = asString(pick(raw, 'poolAddress', 'address', 'id', 'raw.address'));
    if (!poolAddress || !isBase58(poolAddress)) return null;

    // DEX and type
    const dex = (pick(raw, 'dex', 'raw.dex') || 'unknown').toString().toLowerCase();
    const poolType = detectPoolType(raw);

    // Token mints
    const baseMint = asString(pick(raw, 'baseMint', 'baseToken.mint', 'raw.mint_x', 'mint_x'));
    const quoteMint = asString(pick(raw, 'quoteMint', 'quoteToken.mint', 'raw.mint_y', 'mint_y'));

    if (!baseMint || !quoteMint || !isBase58(baseMint) || !isBase58(quoteMint)) {
        return null;
    }

    // Decimals
    let baseDecimals = parseNumber(pick(raw, 'baseDecimals', 'baseToken.decimals', 'raw.decimals_x'));
    let quoteDecimals = parseNumber(pick(raw, 'quoteDecimals', 'quoteToken.decimals', 'raw.decimals_y'));

    // Override with known decimals
    if (KNOWN_DECIMALS[baseMint] !== undefined) baseDecimals = KNOWN_DECIMALS[baseMint];
    if (KNOWN_DECIMALS[quoteMint] !== undefined) quoteDecimals = KNOWN_DECIMALS[quoteMint];

    // Default if missing
    baseDecimals = baseDecimals ?? 9;
    quoteDecimals = quoteDecimals ?? 6;

    // Symbols
    const baseSymbol = normalizeSymbol(pick(raw, 'baseToken.symbol', 'baseSymbol', 'symbolA', 'raw.mint_x_symbol'));
    const quoteSymbol = normalizeSymbol(pick(raw, 'quoteToken.symbol', 'quoteSymbol', 'symbolB', 'raw.mint_y_symbol'));

    // Fee
    const fee = parseFeeRate(raw);

    // Vaults (CRITICAL!)
    const { xVault, yVault } = extractVaults(raw, poolType);

    // If vaults missing, reject meta pool here (keeps output clean and prevents runtime fails)
    if (!xVault || !yVault) return null;

    // Build META pool (ONLY REQUIRED FIELDS, NO RESERVES!)
    // Keep it review-friendly and small.
    const metaPool = {
        poolAddress,
        dex,
        poolType,
        type: poolType,

        baseToken: {
            mint: baseMint,
            symbol: baseSymbol || 'UNKNOWN',
            decimals: baseDecimals
        },
        quoteToken: {
            mint: quoteMint,
            symbol: quoteSymbol || 'UNKNOWN',
            decimals: quoteDecimals
        },

        fee,
        feeRate: fee,

        vaults: {
            xVault,
            yVault
        },

        // Minimal raw: only what our normalizers/SDK may need.
        raw: {
            address: poolAddress,
            mint_x: baseMint,
            mint_y: quoteMint,

            // IMPORTANT: keep these null in meta pools (per your requirement).
            // Live reserve extraction should use `vaults.xVault/vaults.yVault`.
            reserve_x: null,
            reserve_y: null,

            // Optional params used by certain pool types
            token_vault_a: asString(pick(raw, 'raw.token_vault_a', 'token_vault_a')) || null,
            token_vault_b: asString(pick(raw, 'raw.token_vault_b', 'token_vault_b')) || null,
            vault_a: asString(pick(raw, 'raw.vault_a', 'vault_a')) || null,
            vault_b: asString(pick(raw, 'raw.vault_b', 'vault_b')) || null,
            vault_x: asString(pick(raw, 'raw.vault_x', 'vault_x')) || null,
            vault_y: asString(pick(raw, 'raw.vault_y', 'vault_y')) || null,

            bin_step: pick(raw, 'raw.bin_step', 'bin_step') ?? null,
            tickSpacing: pick(raw, 'raw.tickSpacing', 'tickSpacing') ?? null
        }
    };

    return metaPool;
}

function compactMetaPool(p) {
    // Minimal meta shape (per sampleShape.json philosophy)
    return {
        poolAddress: p.poolAddress,
        dex: p.dex,
        poolType: p.poolType,
        type: p.type,
        baseToken: p.baseToken,
        quoteToken: p.quoteToken,
        fee: p.fee,
        feeRate: p.feeRate,
        vaults: p.vaults,
        raw: {
            address: p.poolAddress,
            mint_x: p.baseToken?.mint ?? null,
            mint_y: p.quoteToken?.mint ?? null,
            reserve_x: null,
            reserve_y: null,
            bin_step: p.raw?.bin_step ?? null,
            tickSpacing: p.raw?.tickSpacing ?? null
        }
    };
}

async function exampleUsage(poolDataPath) {
    // Load raw pools from JSON file
    let rawPools;
    try {
        const content = fs.readFileSync(poolDataPath, 'utf8');
        rawPools = JSON.parse(content);
    } catch (err) {
        console.error(`❌ Failed to read pool data file: ${err.message}`);
        process.exit(1);
    }

    // Normalize and enrich pools
    const enrichedPools = await loadAndEnrichPools({
        rawPools,
        connection: new Connection('https://api.mainnet-beta.solana.com'),
        poolManager: manager,
        log: true
    });

    // Process a single pool for demonstration
    const samplePool = enrichedPools[0];
    const result = manager.processPool(samplePool);

    if (result.valid) {
        const pool = result.pool;
        // pool is now in exact engine shape!
        console.log('Valid:', result.valid);
        console.log('Errors:', result.errors);
        console.log('Pool:', result.pool);
    }
}

// ============================================================================
// MAIN
// ============================================================================

function main() {
    const inPath = argValue('--in') || './output/raw_pools.json';
    const outPath = argValue('--out') || inPath.replace(/\.json$/i, '_meta.json');

    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║   🔧 fix_meta_pool - Create Meta Pools                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log(`📂 Input:  ${inPath}`);
    console.log(`📂 Output: ${outPath}\n`);

    // Read input
    let input;
    try {
        const content = fs.readFileSync(inPath, 'utf8');
        input = JSON.parse(content);
    } catch (err) {
        console.error(`❌ Failed to read input file: ${err.message}`);
        process.exit(1);
    }

    // Ensure array
    if (!Array.isArray(input)) {
        console.error('❌ Input must be an array of pools');
        process.exit(1);
    }

    console.log(`📊 Processing ${input.length} pools...\n`);

    // Normalize all pools
    const metaPools = [];
    const stats = {
        total: input.length,
        valid: 0,
        missingAddress: 0,
        missingTokens: 0,
        missingVaults: 0,
        byType: {}
    };

    for (const rawPool of input) {
        const meta = normalizeToMetaPool(rawPool);

        if (!meta) {
            if (!meta?.poolAddress) stats.missingAddress++;
            else if (!meta?.baseMint || !meta?.quoteMint) stats.missingTokens++;
            continue;
        }

        // Track stats
        stats.valid++;
        stats.byType[meta.poolType] = (stats.byType[meta.poolType] || 0) + 1;

        if (!meta.vaults.xVault || !meta.vaults.yVault) {
            stats.missingVaults++;
        }

        metaPools.push(meta);
    }

    // Write output
    try {
        const dir = path.dirname(outPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(outPath, JSON.stringify(metaPools, null, 2));
    } catch (err) {
        console.error(`❌ Failed to write output: ${err.message}`);
        process.exit(1);
    }

    // Print summary
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║   ✅ Processing Complete                                       ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log(`📊 Results:`);
    console.log(`   Input pools:      ${stats.total}`);
    console.log(`   Valid meta pools: ${stats.valid}`);
    console.log(`   Rejected:         ${stats.total - stats.valid}`);
    console.log(`   Missing vaults:   ${stats.missingVaults}\n`);

    console.log(`   By type:`);
    Object.entries(stats.byType).forEach(([type, count]) => {
        console.log(`     ${type}: ${count}`);
    });

    console.log(`\n💾 Saved to: ${outPath}`);

    if (stats.missingVaults > 0) {
        console.log(`\n⚠️  WARNING: ${stats.missingVaults} pools missing vault addresses!`);
        console.log(`   These pools cannot be enriched with live reserves.`);
    }

    console.log('\n✅ Done! These meta pools are ready for live enrichment.\n');
}

if (require.main === module) {
    main();
}

module.exports = { normalizeToMetaPool, compactMetaPool, poolManager };

/*
 node diagnostic/pool_meta.js \
--in pool_list.json \
--out vaultsEnriched_pools.json

// node fix_pool_data3.js output/FINAL_reserves_pool_array.json output/FINAL_reserves_pool_array_fixed.json --strip-reserves


// node fix_data_pool.js output/FINAL_reserves_pool_array.json output/FINAL_reserves_pool_array_fixed.json --strip-reserves

*/

// ============================================================================
// UNUSED: RESERVE ENRICHMENT (FROM LIVE VAULTS)
// ============================================================================
/*
const { Connection } = require('@solana/web3.js');
const { getMultipleAccountInfos } = require('./utils/solana');
const { parseSplTokenAccountAmount } = require('./utils/splTokenAccount');
const D = require('decimal.js');



// ============================================================================
// USAGE EXAMPLE FOR RUNNING TRIANGULAR ARBITRAGE
// ============================================================================

/**
 * Usage:
 * node fix_pool_meta.js \
  --in output/raw_pools.json \
  --out output/meta_pools.json
 *   node runTriangularNewEngine.js /absolute/path/to/pools.json
 
/*
const { PublicKey } = require('@solana/web3.js');
const { loadAndEnrichPools } = require('./reservesFetcher_NewEngine');
const PoolManager = require('./utils/PoolManager.js');

const manager = new PoolManager({ strict: false });

async function exampleUsage(poolDataPath) {
  // Load raw pools from JSON file
  let rawPools;
  try {
    const content = fs.readFileSync(poolDataPath, 'utf8');
    rawPools = JSON.parse(content);
  } catch (err) {
    console.error(`❌ Failed to read pool data file: ${err.message}`);
    process.exit(1);
  }

  // Normalize and enrich pools
  const enrichedPools = await loadAndEnrichPools({
    rawPools,
    connection: new Connection('https://api.mainnet-beta.solana.com'),
    poolManager: manager,
    log: true
  });

  // Process a single pool for demonstration
  const samplePool = enrichedPools[0];
  const result = manager.processPool(samplePool);

  if (result.valid) {
    const pool = result.pool;
    // pool is now in exact engine shape!
    console.log('Valid:', result.valid);
    console.log('Errors:', result.errors);
    console.log('Pool:', result.pool);
  }
}

// Uncomment to run example usage
// exampleUsage('/absolute/path/to/pools.json');

// ============================================================================
// UNUSED: LOAD AND ENRICH POOLS FROM FILE
// ============================================================================

async function enrichFreshReserves(pools, connection, { wantFresh = true, log = false } = {}) {
  if (!wantFresh || !connection) {
    for (const pool of pools) {
      pool.reserveSource = (pool.xReserve && pool.yReserve) ? 'cache' : 'none';
      pool.hasReserves = !!(pool.xReserve && pool.yReserve && D(pool.xReserve).gt(0) && D(pool.yReserve).gt(0));
      pool.isMathReady = (pool.type === 'cpmm' || pool.type === 'dlmm') ? pool.hasReserves : true;
    }
    return pools;
  }

  const pubkeys = [];
  const vaultKeyToPools = new Map();

  for (const pool of pools) {
    if (!pool.vaults) continue;
    const xVault = pool.vaults.xVault;
    const yVault = pool.vaults.yVault;
    if (!isBase58(xVault) || !isBase58(yVault)) continue;

    try {
      const x = new PublicKey(xVault);
      const y = new PublicKey(yVault);
      pubkeys.push(x, y);
      const xAddr = x.toBase58();
      const yAddr = y.toBase58();
      if (!vaultKeyToPools.has(xAddr)) vaultKeyToPools.set(xAddr, []);
      if (!vaultKeyToPools.has(yAddr)) vaultKeyToPools.set(yAddr, []);
      vaultKeyToPools.get(xAddr).push({ pool, side: 'x' });
      vaultKeyToPools.get(yAddr).push({ pool, side: 'y' });
    } catch {
      // ignore bad pubkeys
    }
  }

  if (pubkeys.length === 0) return pools;

  let infos = [];
  try {
    infos = await getMultipleAccountInfos(connection, pubkeys, 99);
  } catch (e) {
    if (log) console.warn('[enrichFreshReserves] getMultipleAccountsInfo failed:', e?.message || e);
    return pools;
  }

  for (let i = 0; i < pubkeys.length; i++) {
    const pk = pubkeys[i];
    const info = infos[i];
    if (!info?.data) continue;
    const amt = parseSplTokenAccountAmount(info.data);
    if (amt === null) continue;

    const addr = pk.toBase58();
    const targets = vaultKeyToPools.get(addr) || [];
    for (const t of targets) {
      if (t.side === 'x') t.pool.xReserve = amt.toString();
      if (t.side === 'y') t.pool.yReserve = amt.toString();
      t.pool.reserveSource = 'fresh';
    }
  }

  for (const pool of pools) {
    if (!pool.reserveSource) pool.reserveSource = (pool.xReserve && pool.yReserve) ? 'cache' : 'none';
    pool.hasReserves = !!(pool.xReserve && pool.yReserve && D(pool.xReserve).gt(0) && D(pool.yReserve).gt(0));
    pool.isMathReady = (pool.type === 'cpmm' || pool.type === 'dlmm') ? pool.hasReserves : true;
  }

  return pools;
}   

=======================

async function enrichPoolsWithReserves_NewEngine({
    pools,
    connection,
    log = false
}) {
    const pubkeys = [];
    const vaultKeyToPools = new Map();

    for (const pool of pools) {
        if (!pool.vaults) continue;
        const xVault = pool.vaults.xVault;
        const yVault = pool.vaults.yVault;
        if (!isBase58(xVault) || !isBase58(yVault)) continue;

        try {
            const x = new (require('@solana/web3.js').PublicKey)(xVault);
            const y = new (require('@solana/web3.js').PublicKey)(yVault);
            pubkeys.push(x, y);
            const xAddr = x.toBase58();
            const yAddr = y.toBase58();
            if (!vaultKeyToPools.has(xAddr)) vaultKeyToPools.set(xAddr, []);
            if (!vaultKeyToPools.has(yAddr)) vaultKeyToPools.set(yAddr, []);
            vaultKeyToPools.get(xAddr).push({ pool, side: 'x' });
            vaultKeyToPools.get(yAddr).push({ pool, side: 'y' });
        } catch {
            // ignore bad pubkeys
        }

        if (pubkeys.length === 0) return pools;
        let infos = [];
        try {
            infos = await getMultipleAccountInfos(connection, pubkeys, 99);
        } catch (e) {
            if (log) console.warn('[enrichPoolsWithReserves] getMultipleAccountsInfo failed:', e?.message || e);
            return pools;
        }

        for (let i = 0; i < pubkeys.length; i++) {
            const pk = pubkeys[i];
            const info = infos[i];
            if (!info?.data) continue;
            const amt = parseSplTokenAccountAmount(info.data);
            if (amt === null) continue;

            const addr = pk.toBase58();
            const targets = vaultKeyToPools.get(addr) || [];
            for (const t of targets) {
                if (t.side === 'x') t.pool.xReserve = amt.toString();
                if (t.side === 'y') t.pool.yReserve = amt.toString();
                t.pool.reserveSource = 'fresh';
            }
        }

        for (const pool of pools) {
            const xRes = pool.xReserve ? new D(pool.xReserve) : null;
            const yRes = pool.yReserve ? new D(pool.yReserve) : null;
            pool.liquidityX = xRes ? xRes.toString() : null;
            pool.liquidityY = yRes ? yRes.toString() : null;
            pool.hasReserves = xRes !== null && yRes !== null;
            pool.isMathReady = pool.hasReserves;
        }

        return pools;
    }
}
  */