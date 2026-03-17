// Dashboard/stage1_market_collector.js

require('dotenv').config()

const fs = require('fs')
const path = require('path')
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js')
// Import your existing utilities
const { readGlobal, writeGlobal } = require('../../dist/helpers/disk-cache')

const { initialize } = require('@raydium-io/raydium-sdk-v2')
const { buildApiUrl, getDexConfig } = require('../libs/dexEndpoints')
const { KNOWN_TOKENS } = require('../libs/KNOWN_TOKENS')
const OUTPUT_FILE = path.join(__dirname, 'stage1_pools.json')
const RPC = process.env.RPC_URL || process.env.SOLANA_RPC || 'https://mainnet.helius-rpc.com/?api-key=2abdf423-a7a5-43a1-9912-438f00454906'
const connection = new Connection(RPC, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true
})
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const WSOL = 'So11111111111111111111111111111111111111112'

function normalizeDexName(rawDex) {
    const mapping = {
        'RAYDIUM_AMM': 'RAYDIUM_AMM',
        'RAYDIUM_AMM_V4': 'RAYDIUM_AMM',
        'RAYDIUM_CLMM': 'RAYDIUM_CLMM',
        'RAYDIUM_CPMM': 'RAYDIUM_CPMM',
        'ORCA_WHIRLPOOL': 'ORCA_WHIRLPOOL',
        'ORCA': 'ORCA_WHIRLPOOL',
        'METEORA_DLMM': 'METEORA_DLMM',
        'METEORA_DAMM_V1': 'METEORA_DAMM_V1',
        'METEORA_DAMM_V2': 'METEORA_DAMM_V2',
        'METEORA_DBC': 'METEORA_DBC'
    };

    const upper = String(rawDex || '').toUpperCase().trim();
    return mapping[upper] || upper;
}

// Use it when creating pools
const mappedPool = {
    market: normalizeDexName(rawDexType),
    // ... other fields
};

const WORKING_MARKETS = [
    'RAYDIUM_AMM',
    'RAYDIUM_CPMM',
    'RAYDIUM_CLMM',
    'ORCA_WHIRLPOOL',
    'METEORA_DLMM',
    'METEORA_DAMM_V1',
    'METEORA_DAMM_V2',
    'METEORA_DBC',
    'SUGAR',
    'BOOP_FUN'
]

const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD || 500000)
const MAX_POOLS_PER_MARKET = Number(process.env.MAX_POOLS_PER_MARKET || 20)
const PRE_NORMALIZE_CAP_PER_MARKET = Number(process.env.PRE_NORMALIZE_CAP_PER_MARKET || 50)
function extractFeeBps(pool, possibleFields = ['fee', 'feeRate', 'fee_bps', 'feeBps', 'tradeFeeRate']) {
    for (const field of possibleFields) {
        const val = pool[field];
        if (val !== undefined && val !== null) {
            const num = Number(val);
            if (Number.isFinite(num) && num > 0) {
                // If the value looks like basis points (typically between 1 and 10000), divide by 10000
                // Otherwise assume it's already a decimal
                return num >= 1 && num <= 10000 ? num / 10000 : num;
            }
        }
    }
    return null;
}
/*
//const initialize = DEFAULT_KNOWN_TOKEN_MINTS; // Or some other initialization
// Filter tokens that have symbols and are not WSOL
const DEFAULT_KNOWN_TOKEN_MINTS = (KNOWN_TOKENS ? Object.keys(KNOWN_TOKENS) : [])
    .filter((mint) => {
        try {
            const token = KNOWN_TOKENS[mint];
            return token?.symbol && token.symbol !== 'WSOL';
        } catch (err) {
            console.warn(`Error processing token ${mint}:`, err.message);
            return false;
        }
    });

const DEFAULT_SUGAR_TOKEN_MINTS = Array.from(new Set([
    ...DEFAULT_KNOWN_TOKEN_MINTS,
    'So11111111111111111111111111111111111111112',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',      // jlp
    'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',      // nvdax
    'METAewgxyPbgwsseH8T16a39CQ5VyVxZi9zXiDPY18m',      //meta
    '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',     // fartcoin
    'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',      // usds1
    'BLVxek8YMXUQhcKmMvrFTrzh5FXg8ec88Crp6otEaCMf',          //believe
    'Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk',      //useless
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',          //jup
    '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'      //popcat

]))

async function fetchDexScreenerMints(query, limit = 30) {
    try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`)
        if (!response.ok) return []
        const data = await response.json()
        const pairs = Array.isArray(data?.pairs) ? data.pairs : []
        const out = []
        for (const pair of pairs.slice(0, limit)) {
            const a = pair?.baseToken?.address
            const b = pair?.quoteToken?.address
            if (a) out.push(a)
            if (b) out.push(b)
        }
        return Array.from(new Set(out)).filter((mint) => {
            try {
                return new PublicKey(mint).toBase58() !== WSOL
            } catch (_e) {
                return false
            }
        })
    } catch (_e) {
        return []
    }
}
*/
const wsol = 'So11111111111111111111111111111111111111112'
const minLiquidity = 500000
const maxPools = 25
const wsolPairs = global.filter(pool => {
    if (!(pool?.mint_x && pool?.mint_y)) return false
    if (!(pool.mint_x === wsol || pool.mint_y === wsol)) return false
    const liq = toNumberOrNull(pool?.liquidity) ?? toNumberOrNull(pool?.tvl)
    return Number.isFinite(liq) && liq > minLiquidity
})

function toNumberOrNull(value) {
    if (value === null || value === undefined) return null
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
        const cleaned = value.replace(/[$,\s]/g, '')
        const n = Number(cleaned)
        return Number.isFinite(n) ? n : null
    }
    if (typeof value === 'object') {
        if (value?.usd !== undefined) return toNumberOrNull(value.usd)
        if (value?.value !== undefined) return toNumberOrNull(value.value)
    }
    return null
}


function getLiquidityUsd(pool) {
    return (
        toNumberOrNull(pool.liquidityUsd) ??
        toNumberOrNull(pool.tvlUsd) ??
        toNumberOrNull(pool.tvl) ??
        toNumberOrNull(pool.liquidity)
    )
}

function applyMarketLimits(pools, maxPerMarket, minLiquidityUsd) {
    const grouped = new Map()
    for (const pool of pools) {
        const key = String(pool.market || '').toUpperCase()
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key).push(pool)
    }

    const final = []
    for (const [market, rows] of grouped.entries()) {
        const filtered = rows.filter((pool) => {
            if (pool.isBondingCurve) return true
            const liq = getLiquidityUsd(pool)
            return Number.isFinite(liq) && liq > minLiquidityUsd
        })

        filtered.sort((a, b) => (getLiquidityUsd(b) || 0) - (getLiquidityUsd(a) || 0))
        final.push(...filtered.slice(0, maxPerMarket))
        console.log(`Kept ${Math.min(filtered.length, maxPerMarket)}/${rows.length} pools for ${market} after liquidity+cap filters`)
    }

    return final
}

/**
 * extractFeeData — returns { feeBps: <integer bps>, feeRate: <decimal> }
 *
 * RULES:
 *   feeBps  = integer basis points (e.g. 25 means 0.25%)
 *   feeRate = decimal fraction     (e.g. 0.0025 means 0.25%)
 *
 * Each DEX API returns fees in its own units — we normalize here.
 */
function extractFeeData(pool, dexType) {
    const dex = String(dexType || '').toUpperCase();

    // 1. ORCA WHIRLPOOL
    //    API field `feeRate` is in hundred-thousandths: 3000 = 0.30% = 30 bps
    //    But our raw extractor already divided by 10000, so pool.feeRate is a decimal.
    //    We also stored the raw value as pool._rawFeeRate for correct conversion.
    if (dex === 'ORCA_WHIRLPOOL') {
        const rawFee = pool._rawFeeRate || pool.tickSpacing; // original API value
        let feeBps;
        if (rawFee && rawFee > 1) {
            feeBps = Math.round(rawFee / 100); // 3000 → 30 bps
        } else if (pool.feeBps && pool.feeBps >= 1) {
            feeBps = Math.round(pool.feeBps);
        } else {
            // Fallback: derive from tickSpacing
            const tickToFee = { 1: 1, 2: 2, 8: 4, 16: 8, 64: 30, 128: 64, 256: 128 };
            feeBps = tickToFee[pool.tickSpacing] || 30; // default 0.30%
        }
        return {
            feeBps,
            feeRate: feeBps / 10000,
            tickSpacing: pool.tickSpacing
        };
    }

    // 2. RAYDIUM CLMM
    //    feeRate from API is in millionths: 25000 = 25 bps = 0.25%
    //    tickSpacing mapping is reliable fallback
    if (dex === 'RAYDIUM_CLMM') {
        let feeBps;
        if (pool._rawFeeRate && pool._rawFeeRate > 100) {
            // Raw API value in millionths: 25000 → 25 bps
            feeBps = Math.round(pool._rawFeeRate / 1000);
        } else if (pool.tickSpacing !== undefined) {
            const tickToFee = { 1: 1, 2: 2, 5: 5, 10: 10, 25: 25, 50: 50, 100: 100 };
            feeBps = tickToFee[pool.tickSpacing] || 10;
        } else if (pool.feeBps && pool.feeBps >= 1) {
            feeBps = Math.round(pool.feeBps);
        } else {
            feeBps = 25; // default
        }
        return {
            feeBps,
            feeRate: feeBps / 10000,
            tickSpacing: pool.tickSpacing
        };
    }

    // 3. RAYDIUM CPMM
    //    tradeFeeRate from configInfo is in millionths: 2500 = 25 bps
    if (dex === 'RAYDIUM_CPMM') {
        let feeBps;
        if (pool._rawTradeFeeRate && pool._rawTradeFeeRate > 100) {
            feeBps = Math.round(pool._rawTradeFeeRate / 1000);
        } else if (pool.feeBps && pool.feeBps >= 1) {
            feeBps = Math.round(pool.feeBps);
        } else {
            feeBps = 25; // CPMM default
        }
        return {
            feeBps,
            feeRate: feeBps / 10000,
        };
    }

    // 4. RAYDIUM AMM
    //    API `fee` field can be bps (25) or decimal (0.0025)
    if (dex === 'RAYDIUM_AMM') {
        let feeBps = 25; // default
        const rawFee = pool._rawFee || pool.fee;
        if (rawFee !== undefined && rawFee !== null) {
            const num = Number(rawFee);
            if (num >= 1) feeBps = Math.round(num); // already bps
            else if (num > 0) feeBps = Math.round(num * 10000); // was decimal
        }
        return {
            feeBps,
            feeRate: feeBps / 10000,
        };
    }

    // 5. METEORA DLMM
    //    fee_bps from API is already in bps. binStep alone is NOT the fee.
    //    Base fee = baseFactor * binStep / 10000, but fee_bps is simpler.
    if (dex === 'METEORA_DLMM') {
        let feeBps;
        if (pool._rawFeeBps && pool._rawFeeBps >= 1) {
            feeBps = Math.round(pool._rawFeeBps);
        } else if (pool.feeBps && pool.feeBps >= 1) {
            feeBps = Math.round(pool.feeBps);
        } else if (pool.binStep !== undefined) {
            // Rough approximation: most DLMM pools use baseFactor=1
            feeBps = Math.max(1, Math.min(pool.binStep, 100));
        } else {
            feeBps = 10; // conservative default
        }
        return {
            feeBps,
            feeRate: feeBps / 10000,
            binStep: pool.binStep
        };
    }

    // 6. METEORA DAMM V1 & V2
    //    fee_rate from API is in ten-thousandths: 2500 = 25 bps
    if (dex === 'METEORA_DAMM_V1' || dex === 'METEORA_DAMM_V2') {
        let feeBps = 25;
        const raw = pool._rawFeeRate || pool.fee_rate;
        if (raw !== undefined && raw !== null) {
            const num = Number(raw);
            if (num >= 100) feeBps = Math.round(num / 100); // ten-thousandths → bps
            else if (num >= 1) feeBps = Math.round(num); // already bps
            else if (num > 0) feeBps = Math.round(num * 10000); // decimal
        }
        return {
            feeBps,
            feeRate: feeBps / 10000,
        };
    }

    // 7. METEORA DBC — dynamic fees, we can't know offline
    if (dex === 'METEORA_DBC') {
        return {
            feeBps: pool.feeBps || 50, // placeholder — actual fee computed on-chain
            feeRate: (pool.feeBps || 50) / 10000,
        };
    }

    // 8. EVERYTHING ELSE — detect units
    let feeBps = 25;
    const candidates = [pool.feeBps, pool.fee_bps, pool.fee, pool.feeRate, pool.fee_rate];
    for (const val of candidates) {
        if (val === undefined || val === null) continue;
        const num = Number(val);
        if (!Number.isFinite(num) || num <= 0) continue;
        if (num >= 1 && num <= 10000) { feeBps = Math.round(num); break; } // bps
        if (num > 0 && num < 1) { feeBps = Math.round(num * 10000); break; } // decimal
    }
    return { feeBps, feeRate: feeBps / 10000 };
}

// Update your normalizePool function
function normalizePool(pool) {
    if (!pool) return null

    try {
        // Extract fee data based on DEX type
        const dexType = pool.market || 'UNKNOWN';
        const feeData = extractFeeData(pool, dexType);

        const normalized = {
            market: dexType,
            address: pool.address || `${pool.mintA}-${pool.mintB}`, // Generate address if none
            mintA: pool.mintA,
            mintB: pool.mintB,
            mintLP: pool.mintLP || null,

            // FEE DATA - CRITICAL ADDITION
            feeBps: feeData.feeBps,
            feeRate: feeData.feeRate,

            // DEX-specific parameters
            ...(dexType === 'RAYDIUM_CLMM' || dexType === 'ORCA_WHIRLPOOL' ? {
                tickSpacing: feeData.tickSpacing || pool.tickSpacing
            } : {}),

            ...(dexType === 'METEORA_DLMM' ? {
                binStep: feeData.binStep || pool.binStep
            } : {}),

            tvl: pool.tvl || pool.marketCap || pool.liquidity || null,
            volume24h: pool.volume24h || null,
            liquidity: pool.liquidity || null,
            isBondingCurve: pool.isBondingCurve || false,
            programId: pool.programId || null,
            price: pool.price || null,
            bondingCurvePercent: pool.bondingCurvePercent || null,
            collectedAt: new Date().toISOString(),
            source: pool.source || 'unknown'
        }

        return normalized

    } catch (err) {
        console.warn('Error normalizing pool:', err.message, pool)
        return null
    }
}

const popularTokens = [
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', //'cbBTC',
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', //'BONK',
    'J1toso1uCk3RLmjorhTtrVwY9HJ7XxfVPEgD1tqr43z', //'JITOSOL',
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', //'mSOL',
    'bSo13r4TkiE4xumDGjLMqMpzR8vKE9UXWsXYQjtNJXe', //'bSOL',
    '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', //'stETH',
    'LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp', //'LST',
    'RChsv3Z1NefW9Zq6UkhV6U8Tq7bG1FHy3JCn9JDE9j9', //'RAY',
    '7BgBvy9rXoHnRxqr7NhcNhcC8y5v1L2Qy1Q9L9P1mJw9',// 'PYTH',
    'orcaEKTdK7LKz57vaAYr9QeDsVE4gxw94VzC4b6YQ4U', //'ORCA',
    'MNDEFzGvMt87ueuHvVU9VcTgsAP4d4c8hQe6c1kM9s1',// 'MNDE',
    'KMNoG2D33pSTo9q3zTjK1Aj7qZ1kX2o5C7hY9eX4zP2', //'KMNO',
    '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4', //'PENGU',
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', //'JUP',
    'HZ1J1NiSHqEzZ9g2xQS4JqJr1HG7bXaqCCY72qMWZ7pJ', //'USDS',
    'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdWBhqvooch', //'JUPSOL'
]

// Market-specific pool fetching using YOUR existing code patterns
const MARKET_STRATEGIES = {
    // Use SDK to find pools for popular token


    'ORCA_WHIRLPOOL': async () => {
        console.log('Fetching Orca Whirlpool pools...')


        try {
            let global = readGlobal('orca_whirlpool')


            if (!global) {
                console.log('Cache miss, fetching from Orca API...')
                const url = 'https://api.mainnet.orca.so/v1/whirlpool/list'
                const res = await fetch(url, { method: 'GET' })

                if (!res.ok) {
                    throw new Error(`Orca API failed: ${res.status}`)
                }

                const json = await res.json()
                const items = Array.isArray(json) ? json : json?.whirlpools || json?.pools || json?.data || []

                writeGlobal('orca_whirlpool', items)
                global = items

                console.log(`Fetched ${items.length} pools from Orca API`)
            } else {
                console.log(`Using cached Orca pools: ${global.length} pools`)
            }

            return global.map(pool => ({
                market: 'ORCA_WHIRLPOOL',
                address: pool?.address || pool?.whirlpoolAddress || pool?.poolAddress,
                mintA: pool?.tokenA?.mint || pool?.tokenMintA || pool?.mintA,
                mintB: pool?.tokenB?.mint || pool?.tokenMintB || pool?.mintB,
                _rawFeeRate: pool?.feeRate || null, // preserve raw API value for extractFeeData
                feeBps: pool?.feeRate ? Math.round(pool.feeRate / 100) : null, // feeRate=3000 → 30 bps
                baseSymbol: pool.symbol,
                quoteSymbol: pool.symbol,
                feeRate: pool?.feeRate ? pool.feeRate / 1000000 : null, // decimal: 3000 → 0.003
                tickSpacing: pool?.tickSpacing,
                liquidity: pool?.liquidity,
                tvl: pool?.tvl || pool?.tvlUsd,
                volume24h: pool?.volume24h,
                source: 'orca_api'
            })).filter(pool => pool.address && pool.mintA && pool.mintB)

        } catch (err) {
            console.log('Error fetching Orca pools:', err.message)
            return []
        }
    },

    'RAYDIUM_AMM': async () => {
        console.log('Fetching Raydium AMM pools...')
        try {
            const primaryUrl = getDexConfig('raydium')?.ammV4?.endpoints?.pools || 'https://api.raydium.io/v2/ammV3/ammPools'
            const res = await fetch(primaryUrl)

            if (!res.ok) {
                throw new Error(`Raydium AMM API failed: ${res.status}`)
            }

            const json = await res.json()
            const pools = Array.isArray(json)
                ? json
                : (Array.isArray(json?.official) ? json.official : (Array.isArray(json?.data) ? json.data : []))

            const mapped = pools.map((pool) => ({
                market: 'RAYDIUM_AMM',
                address: pool?.ammId || pool?.id || pool?.lpMint || pool?.address,
                mintA: pool?.baseMint || pool?.mintA || pool?.coinMint,
                mintB: pool?.quoteMint || pool?.mintB || pool?.pcMint,
                _rawFee: pool?.fee,
                feeBps: toNumberOrNull(pool?.fee) !== null ? (Number(pool.fee) >= 1 ? Math.round(Number(pool.fee)) : Math.round(Number(pool.fee) * 10000)) : 25,
                feeRate: toNumberOrNull(pool?.fee) !== null ? (Number(pool.fee) >= 1 ? Number(pool.fee) / 10000 : Number(pool.fee)) : 0.0025,
                tvl: toNumberOrNull(pool?.liquidity) ?? toNumberOrNull(pool?.tvl),
                liquidity: toNumberOrNull(pool?.liquidity) ?? toNumberOrNull(pool?.tvl),
                volume24h: toNumberOrNull(pool?.volume24h || pool?.volume_24h),
                source: 'raydium_amm_api'
            })).filter((pool) => pool.address && pool.mintA && pool.mintB)

            return mapped
        } catch (primaryErr) {
            console.log('Raydium AMM primary API failed, trying pairs fallback:', primaryErr.message)

            try {
                const fallbackUrl = getDexConfig('raydium')?.ammV4?.endpoints?.pairsEndpoint || 'https://api.raydium.io/v2/main/pairs'
                limit = 20;
                const res = await fetch(fallbackUrl)

                if (!res.ok) {
                    throw new Error(`Raydium AMM fallback API failed: ${res.status}`)
                }

                const json = await res.json()
                const pools = Array.isArray(json) ? json : (Array.isArray(json?.official) ? json.official : [])
                const ammV4ProgramId = getDexConfig('raydium')?.programIds?.ammV4 || '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'

                const mapped = pools
                    .filter((pool) => !pool?.programId || pool?.programId === ammV4ProgramId)
                    .map((pool) => {
                        const rawFee = pool?.fee
                        let feeBps = 25
                        if (rawFee !== undefined && rawFee !== null) {
                            const num = Number(rawFee)
                            if (num >= 1) feeBps = Math.round(num)
                            else if (num > 0) feeBps = Math.round(num * 10000)
                        }
                        return {
                            market: 'RAYDIUM_AMM',
                            address: pool?.ammId || pool?.id || pool?.lpMint,
                            mintA: pool?.baseMint || pool?.mintA,
                            mintB: pool?.quoteMint || pool?.mintB,
                            feeBps,
                            _rawFee: rawFee,
                            feeRate: feeBps / 10000,
                            tvl: toNumberOrNull(pool?.liquidity),
                            liquidity: toNumberOrNull(pool?.liquidity),
                            volume24h: toNumberOrNull(pool?.volume24h || pool?.volume_24h),
                            source: 'raydium_pairs_fallback'
                        }
                    })
                    .filter((pool) => pool.address && pool.mintA && pool.mintB)

                const wsol = 'So11111111111111111111111111111111111111112'
                const minLiquidity = 500000
                const maxPools = 25
                const wsolPairs = global.filter(pool => {
                    if (!(pool?.mint_x && pool?.mint_y)) return false
                    if (!(pool.mint_x === wsol || pool.mint_y === wsol)) return false
                    const liq = toNumberOrNull(pool?.liquidity) ?? toNumberOrNull(pool?.tvl)
                    return Number.isFinite(liq) && liq > minLiquidity
                })



                return mapped
            } catch (fallbackErr) {
                console.log('Raydium AMM fallback also failed:', fallbackErr.message)
                return []
            }
        }
    },

    'RAYDIUM_CPMM': async () => {
        console.log('Fetching Raydium CPMM pools...')

        try {
            // Use Raydium V3 API: CPMM pools have type=Standard and config!=null
            const url = 'https://api-v3.raydium.io/pools?type=Standard&sortBy=liquidity&order=desc&limit=50'
            const res = await fetch(url)

            if (!res.ok) {
                throw new Error(`Raydium CPMM API failed: ${res.status}`)
            }

            const json = await res.json()
            const pools = json.data || []

            // Filter for CPMM (Standard pools WITH config) vs AMM (Standard pools WITHOUT config)
            const cpmmPools = pools.filter(p => p.config != null)
            console.log(`Fetched ${cpmmPools.length} CPMM pools from Raydium API (filtered from ${pools.length} Standard pools)`)

            const wsol = 'So11111111111111111111111111111111111111112'
            const wsolPools = cpmmPools.filter(p => {
                const mA = p.mintA?.address || p.mintA
                const mB = p.mintB?.address || p.mintB
                return mA === wsol || mB === wsol
            })

            console.log(`Found ${wsolPools.length} CPMM pools with WSOL`)

            return wsolPools.map(pool => {
                // tradeFeeRate from API is in millionths (e.g. 2500 = 25 bps)
                const rawTradeFee = pool.feeRate || pool.config?.tradeFeeRate || 0
                let feeBps = 25 // default
                if (rawTradeFee > 100) {
                    feeBps = Math.round(rawTradeFee / 1000) // millionths → bps
                } else if (rawTradeFee >= 1) {
                    feeBps = Math.round(rawTradeFee) // already bps
                }

                return {
                    market: 'RAYDIUM_CPMM',
                    address: pool.id,
                    mintA: pool.mintA?.address || pool.mintA,
                    mintB: pool.mintB?.address || pool.mintB,
                    feeBps,
                    _rawTradeFeeRate: rawTradeFee,
                    feeRate: feeBps / 10000,
                    liquidity: pool.liquidity,
                    tvl: pool.tvl,
                    volume24h: pool.volume24h,
                    source: 'raydium_cpmm_api'
                }
            }).filter(pool => pool.address && pool.mintA && pool.mintB)

        } catch (e) {
            console.log('Raydium CPMM API failed:', e.message)

            // Fallback: use SDK to find CPMM pools for popular tokens
            try {
                const { Raydium } = require('@raydium-io/raydium-sdk-v2')
                const dummyOwner = new PublicKey('11111111111111111111111111111111')
                const raydium = await Raydium.load({
                    connection,
                    owner: dummyOwner,
                    disableLoadToken: true
                })

                const wsol = 'So11111111111111111111111111111111111111112'
                const foundPools = []

                for (const token of popularTokens.slice(0, 15)) {
                    try {
                        const resp = await raydium.api.fetchPoolByMints({ mint1: token, mint2: wsol })
                        const list = Array.isArray(resp) ? resp : resp?.data || resp?.items || []
                        const cpmmList = list.filter(p => p?.type === 'Standard' && p?.config != null)

                        for (const pool of cpmmList) {
                            if (!foundPools.some(p => p.address === pool.id)) {
                                const rawTradeFee = pool.feeRate || 0
                                let feeBps = 25
                                if (rawTradeFee > 100) feeBps = Math.round(rawTradeFee / 1000)
                                else if (rawTradeFee >= 1) feeBps = Math.round(rawTradeFee)

                                foundPools.push({
                                    market: 'RAYDIUM_CPMM',
                                    address: pool.id,
                                    mintA: pool.mintA?.address || pool.mintA,
                                    mintB: pool.mintB?.address || pool.mintB,
                                    feeBps,
                                    _rawTradeFeeRate: rawTradeFee,
                                    feeRate: feeBps / 10000,
                                    liquidity: pool.liquidity,
                                    source: 'raydium_cpmm_sdk_fallback'
                                })
                            }
                        }
                    } catch (_) { /* skip token */ }
                }

                console.log(`Found ${foundPools.length} CPMM pools via SDK fallback`)
                return foundPools
            } catch (sdkErr) {
                console.log('CPMM SDK fallback also failed:', sdkErr.message)
                return []
            }
        }
    },

    'RAYDIUM_CLMM': async () => {
        console.log('Fetching Raydium CLMM pools...')

        try {
            // Try API first
            const url = 'https://api-v3.raydium.io/pools?type=Concentrated&sortBy=liquidity&order=desc&limit=50'
            const res = await fetch(url)

            if (!res.ok) {
                throw new Error(`Raydium CLMM API failed: ${res.status}`)
            }
            const wsol = 'So11111111111111111111111111111111111111112'
            const minLiquidity = 500000
            const maxPools = 25

            const wsolPairs = global.filter(pool => {
                if (!(pool?.mint_x && pool?.mint_y)) return false
                if (!(pool.mint_x === wsol || pool.mint_y === wsol)) return false
                const liq = toNumberOrNull(pool?.liquidity) ?? toNumberOrNull(pool?.tvl)
                return Number.isFinite(liq) && liq > minLiquidity
            })

            const data = await res.json()
            const pools = data.data || []

            console.log(`Fetched ${pools.length} CLMM pools from Raydium API`)

            return pools.map(pool => {
                // feeRate from API is in millionths: 25000 = 25 bps
                const rawFeeRate = pool.feeRate || 0
                let feeBps = 10 // default
                if (rawFeeRate > 100) feeBps = Math.round(rawFeeRate / 1000)
                else if (pool.tickSpacing !== undefined) {
                    const tickToFee = { 1: 1, 2: 2, 5: 5, 10: 10, 25: 25, 50: 50, 100: 100 }
                    feeBps = tickToFee[pool.tickSpacing] || 10
                }

                return {
                    market: 'RAYDIUM_CLMM',
                    address: pool.id,
                    mintA: pool.mintA,
                    mintB: pool.mintB,
                    feeBps,
                    _rawFeeRate: rawFeeRate,
                    feeRate: feeBps / 10000,
                    tickSpacing: pool.tickSpacing,
                    liquidity: pool.liquidity,
                    tvl: pool.tvl,
                    volume24h: pool.volume24h,
                    source: 'raydium_clmm_api'
                }
            }).filter(pool => pool.address && pool.mintA && pool.mintB)

        } catch (apiErr) {
            console.log('Raydium API failed, trying SDK method...')

            try {
                // Fallback to SDK method
                const { Raydium } = require('@raydium-io/raydium-sdk-v2')
                const dummyOwner = new PublicKey('11111111111111111111111111111111')

                const raydium = await Raydium.load({
                    connection,
                    owner: dummyOwner,
                    disableLoadToken: true
                })
                const foundPools = []
                const wsol = 'So11111111111111111111111111111111111111112'

                for (const token of popularTokens) {
                    try {
                        const resp = await raydium.api.fetchPoolByMints({
                            mint1: token,
                            mint2: wsol
                        })

                        const list = Array.isArray(resp) ? resp : resp?.data || resp?.items || []
                        const clmmPools = list.filter(p => p?.type === 'Concentrated')

                        for (const pool of clmmPools) {
                            if (!foundPools.some(p => p.address === pool.id)) {
                                const rawFeeRate = pool.feeRate || 0
                                let feeBps = 10
                                if (rawFeeRate > 100) feeBps = Math.round(rawFeeRate / 1000)
                                else if (pool.tickSpacing) {
                                    const tickToFee = { 1: 1, 2: 2, 5: 5, 10: 10, 25: 25, 50: 50, 100: 100 }
                                    feeBps = tickToFee[pool.tickSpacing] || 10
                                }

                                foundPools.push({
                                    market: 'RAYDIUM_CLMM',
                                    address: pool.id,
                                    mintA: pool.mintA?.address || pool.mintA,
                                    mintB: pool.mintB?.address || pool.mintB,
                                    feeBps,
                                    _rawFeeRate: rawFeeRate,
                                    feeRate: feeBps / 10000,
                                    tickSpacing: pool.tickSpacing,
                                    liquidity: pool.liquidity,
                                    source: 'raydium_sdk_fallback'
                                })

                            }
                            const wsol = 'So11111111111111111111111111111111111111112'
                            const minLiquidity = 500000
                            const maxPools = 25
                            const wsolPairs = global.filter(pool => {
                                if (!(pool?.mint_x && pool?.mint_y)) return false
                                if (!(pool.mint_x === wsol || pool.mint_y === wsol)) return false
                                const liq = toNumberOrNull(pool?.liquidity) ?? toNumberOrNull(pool?.tvl)
                                return Number.isFinite(liq) && liq > minLiquidity
                            })
                        }
                    } catch (err) {
                        // Skip this token
                    }

                }

                console.log(`Found ${foundPools.length} CLMM pools via SDK fallback`)
                return foundPools

            }
            catch (sdkErr) {
                console.log('SDK fallback also failed:', sdkErr.message)
                return []
            }
        }
    },


    'METEORA_DLMM': async () => {
        console.log('Fetching Meteora DLMM pools...')

        try {
            // Use YOUR existing pattern from pool-utils.js
            const { readGlobal, writeGlobal } = require('../../dist/helpers/disk-cache')

            // Check cache first (like YOUR code does)
            let global = readGlobal('dlmm')

            if (!global) {
                console.log('Cache miss, fetching from Meteora DLMM API...')
                const url = 'https://dlmm-api.meteora.ag/pair/all'
                const res = await fetch(url)

                if (!res.ok) {
                    throw new Error(`Meteora DLMM API failed: ${res.status}`)
                }

                const json = await res.json()
                const items = Array.isArray(json) ? json : json?.data || json?.rows || []

                writeGlobal('dlmm', items)
                global = items

                console.log(`Fetched ${items.length} DLMM pools from API`)
            } else {
                console.log(`Using cached DLMM pools: ${global.length} pools`)
            }

            const wsol = 'So11111111111111111111111111111111111111112'
            const minLiquidity = 500000
            const maxPools = 25

            const wsolPairs = global.filter(pool => {
                if (!(pool?.mint_x && pool?.mint_y)) return false
                if (!(pool.mint_x === wsol || pool.mint_y === wsol)) return false
                const liq = toNumberOrNull(pool?.liquidity) ?? toNumberOrNull(pool?.tvl)
                return Number.isFinite(liq) && liq > minLiquidity
            })

            const limited = wsolPairs.slice(0, maxPools)
            console.log(`Found ${wsolPairs.length} DLMM pools with WSOL and liquidity > ${minLiquidity}, returning ${limited.length}`)

            return limited.map(pool => {
                // fee_bps from API is already in bps
                const rawFeeBps = pool.fee_bps || pool.base_fee_bps || 0
                let feeBps = 10 // default
                if (rawFeeBps >= 1) {
                    feeBps = Math.round(rawFeeBps)
                } else if (pool.bin_step !== undefined) {
                    // Approximate: most DLMM pools have baseFactor ~1
                    feeBps = Math.max(1, Math.min(pool.bin_step, 100))
                }

                return {
                    market: 'METEORA_DLMM',
                    address: pool.address,
                    mintA: pool.mint_x,
                    mintB: pool.mint_y,
                    feeBps,
                    _rawFeeBps: rawFeeBps,
                    feeRate: feeBps / 10000,
                    mintLP: pool.lp_mint,
                    binStep: pool.bin_step,
                    liquidity: pool.liquidity,
                    tvl: pool.tvl,
                    volume24h: pool.volume24h,
                    reserveX: pool.reserve_x_amount,
                    reserveY: pool.reserve_y_amount,
                    activeBin: pool.active_bin,
                    source: 'meteora_dlmm_api'
                }
            }).filter(pool => pool.address && pool.mintA && pool.mintB)

        } catch (err) {
            console.log('Error fetching Meteora DLMM pools:', err.message)

            // Fallback: Try to get pools on-chain (like YOUR fallback in pool-utils.js)
            try {
                console.log('Trying on-chain fallback...')
                const dlmm = require('@meteora-ag/dlmm').default

                // Get all LB pairs on-chain
                const allPairs = await dlmm.getLbPairs(connection)
                console.log(`Found ${allPairs.length} DLMM pairs on-chain`)

                const wsol = new PublicKey('So11111111111111111111111111111111111111112')
                const wsolPairs = []

                for (const pair of allPairs.slice(0, 20)) { // Limit to first 20
                    try {
                        const info = pair.account
                        const mintX = info?.tokenXMint
                        const mintY = info?.tokenYMint

                        if (mintX && mintY &&
                            (mintX.equals(wsol) || mintY.equals(wsol))) {

                            wsolPairs.push({
                                market: 'METEORA_DLMM',
                                address: pair.publicKey.toString(),
                                mintA: mintX.toString(),
                                mintB: mintY.toString(),
                                binStep: info?.binStep,
                                feeBps: info?.feeParameter?.baseFactor
                                    ? Math.round((info.feeParameter.baseFactor * (info.binStep || 1)) / 100)
                                    : Math.max(1, Math.min(info?.binStep || 10, 100)),
                                feeRate: null, // will be computed by normalizePool
                                source: 'on_chain'
                            })
                        }
                    } catch (err) {
                        // Skip this pair
                    }
                    const wsol = 'So11111111111111111111111111111111111111112'
                    const minLiquidity = 500000
                    const maxPools = 25
                    const wsolPairs = global.filter(pool => {
                        if (!(pool?.mint_x && pool?.mint_y)) return false
                        if (!(pool.mint_x === wsol || pool.mint_y === wsol)) return false
                        const liq = toNumberOrNull(pool?.liquidity) ?? toNumberOrNull(pool?.tvl)
                        return Number.isFinite(liq) && liq > minLiquidity
                    })
                }

                console.log(`Found ${wsolPairs.length} WSOL pairs on-chain`)
                return wsolPairs

            } catch (onChainErr) {
                console.log('On-chain fallback also failed:', onChainErr.message)
                return []
            }
        }
    },


    'METEORA_DAMM_V1': async () => {
        console.log('Fetching Meteora DAMM V1 pools...')

        try {
            // Use YOUR existing pattern from pool-utils.js
            const { readGlobal, writeGlobal } = require('../../dist/helpers/disk-cache')

            // Check cache first (like YOUR code does)
            let global = readGlobal('damm_v1')

            if (!global) {
                console.log('Cache miss, fetching from Meteora DAMM V1 API...')

                // Use YOUR exact API endpoint from pool-utils.js
                const base = 'https://damm-api.meteora.ag/pools/search'
                const qs = `page=0&size=50&pool_type=dynamic`
                const url = `${base}?${qs}`

                const res = await fetch(url, { method: 'GET' })

                if (!res.ok) {
                    throw new Error(`Meteora DAMM V1 API failed: ${res.status}`)
                }

                const json = await res.json()
                const items = Array.isArray(json?.data) ? json.data : []

                writeGlobal('damm_v1', items)
                global = items

                console.log(`Fetched ${items.length} DAMM V1 pools from API`)
            } else {
                console.log(`Using cached DAMM V1 pools: ${global.length} pools`)
            }

            // Filter for WSOL pairs (like YOUR trading code expects)
            const wsol = 'So11111111111111111111111111111111111111112'
            const wsolPairs = global.filter(pool => {
                const mints = pool?.pool_token_mints || []
                return mints.length === 2 && mints.includes(wsol)
            })

            console.log(`Found ${wsolPairs.length} DAMM V1 pools with WSOL`)

            return wsolPairs.map(pool => {
                // fee_rate from API is in ten-thousandths: 2500 = 25 bps
                const rawFeeRate = pool.fee_rate || 0
                let feeBps = 25 // default
                if (rawFeeRate >= 100) feeBps = Math.round(rawFeeRate / 100)
                else if (rawFeeRate >= 1) feeBps = Math.round(rawFeeRate)

                return {
                    market: 'METEORA_DAMM_V1',
                    address: pool.pool_address,
                    mintA: pool.pool_token_mints?.[0] || '',
                    mintB: pool.pool_token_mints?.[1] || '',
                    mintLP: pool.lp_mint || pool.lpMint || null,
                    feeBps,
                    _rawFeeRate: rawFeeRate,
                    feeRate: feeBps / 10000,
                    tvl: pool.pool_tvl,
                    volume24h: pool.volume_24h || pool.volume24h,
                    poolType: pool.pool_type,
                    tokenUsdAmounts: pool.pool_token_usd_amounts,
                    tokenReserves: pool.pool_token_reserves,
                    source: 'meteora_damm_v1_api'
                }
            }).filter(pool => pool.address && pool.mintA && pool.mintB)

        } catch (err) {
            console.log('Error fetching Meteora DAMM V1 pools:', err.message)

            // Fallback: Try the old endpoint you had
            try {
                console.log('Trying alternative API endpoint...')
                const url = 'https://amm-api.meteora.ag/pairs'
                const res = await fetch(url)

                if (!res.ok) {
                    throw new Error(`Alternative API failed: ${res.status}`)
                }

                const data = await res.json()
                const pools = Array.isArray(data) ? data : data.data || []

                // Filter for dynamic pools (DAMM V1)
                const dammPools = pools.filter(pool =>
                    pool.pool_type === 'dynamic' || pool.type === 'dynamic'
                )

                console.log(`Found ${dammPools.length} DAMM V1 pools from alternative API`)

                return dammPools.map(pool => {
                    const rawFee = pool.fee || 0
                    let feeBps = 25
                    if (rawFee >= 100) feeBps = Math.round(rawFee / 100)
                    else if (rawFee >= 1) feeBps = Math.round(rawFee)
                    else if (rawFee > 0) feeBps = Math.round(rawFee * 10000)

                    return {
                        market: 'METEORA_DAMM_V1',
                        address: pool.address,
                        mintA: pool.mintA,
                        mintB: pool.mintB,
                        mintLP: pool.lpMint,
                        feeBps,
                        feeRate: feeBps / 10000,
                        tvl: pool.tvl,
                        volume24h: pool.volume24h,
                        source: 'meteora_amm_api'
                    }
                }).filter(pool => pool.address && pool.mintA && pool.mintB)

            } catch (fallbackErr) {
                console.log('Fallback also failed:', fallbackErr.message)
                return []
            }
        }
    },

    'METEORA_DBC': async () => {
        console.log('Fetching Meteora DBC pools...')

        try {
            const { DynamicBondingCurveClient } = require('@meteora-ag/dynamic-bonding-curve-sdk')
            const { getTokenMetadata } = require('../../dist/helpers/token-metadata')

            const client = new DynamicBondingCurveClient(connection, 'processed')
            const candidateMints = Array.from(new Set([
                ...DEFAULT_KNOWN_TOKEN_MINTS,
                ...(await fetchDexScreenerMints('meteora', 20))
            ])).slice(0, 20)

            const pools = []
            for (const tokenMint of candidateMints) {
                try {
                    const baseMint = new PublicKey(tokenMint)
                    const programAccount = await client.state.getPoolByBaseMint(baseMint)
                    if (!programAccount) continue

                    const poolAddress = programAccount.publicKey
                    const virtualPool = programAccount.account ?? await client.state.getPool(poolAddress)
                    if (!virtualPool) continue
                    const poolConfig = await client.state.getPoolConfig(virtualPool.config)

                    const quoteMint = poolConfig?.quoteMint?.toBase58?.() ?? String(poolConfig?.quoteMint)
                    if (quoteMint !== WSOL) continue

                    const meta = await getTokenMetadata(connection, tokenMint)
                    pools.push({
                        market: 'METEORA_DBC',
                        address: poolAddress.toString(),
                        mintA: tokenMint,
                        mintB: WSOL,
                        feeRate: null,
                        tvl: null,
                        liquidity: null,
                        decimals: Number(meta?.decimals ?? KNOWN_TOKENS[tokenMint]?.decimals ?? 6),
                        symbol: meta?.symbol || KNOWN_TOKENS[tokenMint]?.symbol || 'UNKNOWN',
                        name: meta?.name || KNOWN_TOKENS[tokenMint]?.name || 'Unknown Token',
                        source: 'meteora_dbc_sdk'
                    })
                } catch (_e) {
                }
            }

            if (pools.length > 0) {
                console.log(`Found ${pools.length} Meteora DBC pools`)
                return pools
            }

            const response = await fetch('https://api.dexscreener.com/latest/dex/search?q=meteora%20dbc')
            const data = await response.json()
            const pairs = Array.isArray(data?.pairs) ? data.pairs : []

            const fallbackPools = pairs
                .filter((pair) => {
                    const chainId = String(pair?.chainId || '').toLowerCase()
                    const dex = String(pair?.dexId || '').toLowerCase()
                    const url = String(pair?.url || '').toLowerCase()
                    const symbol = String(pair?.baseToken?.symbol || '').toLowerCase()
                    const name = String(pair?.baseToken?.name || '').toLowerCase()
                    return chainId === 'solana' && (
                        dex.includes('meteora') ||
                        url.includes('meteora') ||
                        symbol.includes('dbc') ||
                        name.includes('dbc')
                    )
                })
                .map((pair) => ({
                    market: 'METEORA_DBC',
                    address: pair?.pairAddress || pair?.baseToken?.address,
                    mintA: pair?.baseToken?.address,
                    mintB: pair?.quoteToken?.address,
                    feeRate: null,
                    tvl: toNumberOrNull(pair?.liquidity?.usd),
                    liquidity: toNumberOrNull(pair?.liquidity?.usd),
                    volume24h: toNumberOrNull(pair?.volume?.h24),
                    symbol: pair?.baseToken?.symbol || 'UNKNOWN',
                    name: pair?.baseToken?.name || 'Unknown Token',
                    source: 'meteora_dbc_dexscreener'
                }))
                .filter((pool) => pool.address && pool.mintA && pool.mintB)

            console.log(`Found ${fallbackPools.length} Meteora DBC pools from fallback`)
            return fallbackPools
        } catch (err) {
            console.log('Error fetching Meteora DBC pools:', err.message)
            return []
        }
    },

    'METEORA_DAMM_V2': async () => {
        console.log('Fetching Meteora DAMM V2 pools...')

        try {
            const { readGlobal, writeGlobal } = require('../../dist/helpers/disk-cache')
            let global = readGlobal('damm_v2')

            if (!global) {
                console.log('Cache miss, fetching from Meteora DAMM V2 API...')

                const base = 'https://damm-api.meteora.ag/pools/search'
                const qs = `page=0&size=20&pool_type=dynamic`
                const url = `${base}?${qs}`
                const res = await fetch(url, { method: 'GET' })

                if (!res.ok) {
                    throw new Error(`Meteora DAMM V2 API failed: ${res.status}`)
                }

                const json = await res.json()
                const items = Array.isArray(json?.data) ? json.data : []

                writeGlobal('damm_v2', items)
                global = items

                console.log(`Fetched ${items.length} DAMM V2 pools from API`)
            } else {
                console.log(`Using cached DAMM V2 pools: ${global.length} pools`)
            }

            const wsol = 'So11111111111111111111111111111111111111112'
            const pools = (Array.isArray(global) ? global : []).map((pool) => {
                const mints = Array.isArray(pool?.pool_token_mints) ? pool.pool_token_mints : []
                const rawFeeRate = toNumberOrNull(pool?.fee_rate) || 0
                let feeBps = 25
                if (rawFeeRate >= 100) feeBps = Math.round(rawFeeRate / 100)
                else if (rawFeeRate >= 1) feeBps = Math.round(rawFeeRate)
                else if (rawFeeRate > 0) feeBps = Math.round(rawFeeRate * 10000)

                return {
                    market: 'METEORA_DAMM_V2',
                    address: pool?.pool_address || pool?.address || null,
                    mintA: mints[0] || null,
                    mintB: mints[1] || null,
                    mintLP: pool?.lp_mint || pool?.lpMint || null,
                    feeBps,
                    _rawFeeRate: rawFeeRate,
                    feeRate: feeBps / 10000,
                    tvl: toNumberOrNull(pool?.pool_tvl),
                    liquidity: toNumberOrNull(pool?.pool_tvl),
                    volume24h: toNumberOrNull(pool?.volume_24h || pool?.volume24h),
                    source: 'meteora_damm_v2_api'
                }
            }).filter((pool) =>
                pool.address && pool.mintA && pool.mintB && (pool.mintA === wsol || pool.mintB === wsol)
            )

            return pools
        } catch (err) {
            console.log('Error fetching Meteora DAMM V2 pools:', err.message)
            return []
        }
    },

    'SUGAR': async () => {
        console.log('Fetching Sugar bonding curves...')

        try {
            const { SugarMoneyProgram, SugarMoneyProgramConfig } = require('sugar-money/program')
            const { AnchorProvider, Wallet } = require('@coral-xyz/anchor')
            const { getTokenMetadata } = require('../../dist/helpers/token-metadata')

            const apiMints = await fetchDexScreenerMints('sugar', 80)
            const knownSugarTokens = Array.from(new Set([
                ...DEFAULT_SUGAR_TOKEN_MINTS,
                ...apiMints
            ])).slice(0, 80)

            console.log(`Checking ${knownSugarTokens.length} Sugar token candidates...`)

            const sugarCurves = []
            const dummyOwner = new PublicKey('11111111111111111111111111111111')
            const provider = new AnchorProvider(connection, new Wallet({ publicKey: dummyOwner }), { commitment: 'processed' })
            const cluster = 'production'
            const config = new SugarMoneyProgramConfig(cluster)
            const program = new SugarMoneyProgram(provider, cluster, config)

            for (const tokenMint of knownSugarTokens) {
                try {
                    const mint = new PublicKey(tokenMint)
                    const [curvePda] = program.getBondingCurveAccounts(mint)
                    const curveKey = curvePda.publicKey ?? curvePda
                    const curveAccount = await connection.getAccountInfo(curveKey)
                    const decimals = meta?.decimals ?? 6;
                    if (!curveAccount) continue

                    let completionPercent = null
                    try {
                        completionPercent = await program.getCompletionPercent(curveKey)
                    } catch (_e) {
                    }

                    const meta = await getTokenMetadata(connection, tokenMint)
                    sugarCurves.push({
                        market: 'SUGAR',
                        address: curveKey.toString(),
                        mintA: tokenMint,
                        mintB: WSOL,
                        isBondingCurve: true,
                        symbol: meta?.symbol || KNOWN_TOKENS[tokenMint]?.symbol || 'UNKNOWN',
                        name: meta?.name || KNOWN_TOKENS[tokenMint]?.name || 'Unknown Token',
                        decimals: Number(meta?.decimals ?? KNOWN_TOKENS[tokenMint]?.decimals ?? 6),
                        slippage: this.toBpsFromFraction(slippage),
                        curveCompletion: completionPercent,
                        curvePda: curveKey.toString(),
                        mintLP: pool?.lp_mint || pool?.lpMint || null,
                        feeRate: toNumberOrNull(pool?.fee_rate) !== null ? toNumberOrNull(pool?.fee_rate) / 10000 : null,
                        tvl: toNumberOrNull(pool?.pool_tvl),
                        liquidity: toNumberOrNull(pool?.pool_tvl),
                        volume24h: toNumberOrNull(pool?.volume_24h || pool?.volume24h),
                        source: 'sugar_sdk'
                    })
                } catch (_e) {
                }
            }

            if (sugarCurves.length > 0) {
                console.log(`Found ${sugarCurves.length} Sugar bonding curves`)
                return sugarCurves
            }

            const response = await fetch('https://api.dexscreener.com/latest/dex/search?q=sugar')
            const data = await response.json()
            const pairs = Array.isArray(data?.pairs) ? data.pairs : []

            return pairs
                .filter((pair) => {
                    const dex = String(pair?.dexId || '').toLowerCase()
                    const url = String(pair?.url || '').toLowerCase()
                    const symbol = String(pair?.baseToken?.symbol || '').toLowerCase()
                    const name = String(pair?.baseToken?.name || '').toLowerCase()
                    const chainId = String(pair?.chainId || '').toLowerCase()
                    return chainId === 'solana' && (
                        dex.includes('sugar') ||
                        url.includes('sugar') ||
                        symbol.includes('sugar') ||
                        name.includes('sugar')
                    )
                })
                .map((pair) => ({
                    market: 'SUGAR',
                    address: pair?.pairAddress || pair?.baseToken?.address,
                    mintA: pair?.baseToken?.address,
                    mintB: pair?.quoteToken?.address,
                    isBondingCurve: true,
                    symbol: pair?.baseToken?.symbol,
                    name: pair?.baseToken?.name,
                    priceUSD: pair?.priceUsd,
                    liquidityUSD: pair?.liquidity?.usd,
                    volume24hUSD: pair?.volume?.h24,
                    dexUrl: pair?.url,
                    source: 'dexscreener'
                }))
                .filter((p) => p.address && p.mintA && p.mintB)
        } catch (err) {
            console.log('Error with Sugar discovery:', err.message)
            return []
        }
    },

    'BOOP_FUN': async () => {
        console.log('Fetching BoopFun bonding curves...')

        return [
            {
                market: 'BOOP_FUN',
                address: '8xSUcWL8uVDwZapEZb4WgcyCqBETKioBgsaSrTZW2T46',
                mintA: 'QdyjMr627PR7NtWdcEcgFmDm5haBVUWEcj4jdM4boop',
                mintB: WSOL,
                mintLP: null,
                feeRate: null,
                tvl: null,
                volume24h: null,
                liquidity: pool.tvll,
                isBondingCurve: true,
                programId: 'boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4',
                price: null,
                bondingCurvePercent: 100,
                source: 'boop_on_chain'
            },
            {
                market: 'BOOP_FUN',
                address: '4JQmn8nkAik4Y8oi7aXBCmdvLPEhjiAymBcuvyDSVTHz',
                mintA: 'K5RpMc7AjwaUZBieDTnsWGrkJbCLJvFXWVsHpo5boop',
                mintB: WSOL,
                mintLP: null,
                feeRate: null,
                tvl: null,
                volume24h: null,
                liquidity: pool.tvl,
                isBondingCurve: true,
                programId: null,
                price: null,
                bondingCurvePercent: 100,
                source: 'boop_on_chain'
            },
            {
                market: 'BOOP_FUN',
                address: 'C28bJJJQrqfkgmnq9nwV3Viyjm7CXCAA9ouyy15BQESV',
                mintA: '14E5km7LLUnhSVauyMFhD5NogXQpStuw2uMddow3boop',
                mintB: WSOL,
                mintLP: null,
                feeRate: null,
                tvl: pool.tvl,
                volume24h: null,
                liquidity: null,
                isBondingCurve: true,
                programId: null,
                price: null,
                bondingCurvePercent: 100,
                source: 'boop_on_chain'
            }
        ]
    },
}

async function collectPools() {
    console.log('Collecting pools from native DEXes...\n')

    const allPools = []

    // Strategy 1: Use market-specific APIs/SDKs
    for (const market of WORKING_MARKETS) {
        console.log(`\n=== ${market} ===`)

        const strategy = MARKET_STRATEGIES[market]
        if (!strategy) {
            console.log(`No strategy for ${market}`)
            continue
        }

        try {
            const pools = await strategy()
            const safePools = Array.isArray(pools) ? pools : []
            const cappedPools = safePools
                .slice()
                .sort((a, b) => (getLiquidityUsd(b) || 0) - (getLiquidityUsd(a) || 0))
                .slice(0, PRE_NORMALIZE_CAP_PER_MARKET)

            console.log(`Collected ${safePools.length} pools from ${market}`)
            console.log(`Using ${cappedPools.length}/${safePools.length} pools from ${market} before normalize`)
            for (const pool of cappedPools) {
                allPools.push(pool)
            }
        } catch (err) {
            console.log(`Error collecting from ${market}:`, err.message)
        }
    }

    // Strategy 2: If API methods return few pools, try price check discovery
    if (allPools.length < 10) {
        console.log('\nFew pools found via APIs, trying price check discovery...')
        const priceCheckPools = await discoverPoolsViaPriceCheck()
        allPools.push(...priceCheckPools)
    }

    return allPools
}



async function runCollector() {
    console.log('Starting DEX pool collection...')
    console.log(`RPC: ${RPC}`)
    console.log(`Working markets: ${WORKING_MARKETS.length}\n`)

    let pools = []

    try {
        const rawPools = await collectPools()

        // Normalize and filter - NOW WITH FEE EXTRACTION
        for (const pool of rawPools) {
            const normalized = normalizePool(pool)
            if (normalized) {
                pools.push(normalized)
            }
        }

    } catch (error) {
        console.error('Error during collection:', error)
        pools = []
    }

    console.log('\n' + '='.repeat(50))
    console.log('Total pools collected:', pools.length)

    if (pools.length > 0) {
        // Remove duplicates by address
        const uniquePools = []
        const seenAddresses = new Set()

        for (const pool of pools) {
            const address = pool.address
            if (address && !seenAddresses.has(address)) {
                seenAddresses.add(address)
                uniquePools.push(pool)
            }
        }

        console.log('Unique pools:', uniquePools.length)

        const limitedPools = applyMarketLimits(
            uniquePools,
            MAX_POOLS_PER_MARKET,
            MIN_LIQUIDITY_USD
        )

        console.log('Pools after cap/liquidity filters:', limitedPools.length)

        // Save
        fs.writeFileSync(
            OUTPUT_FILE,
            JSON.stringify(limitedPools, null, 2)
        )

        console.log('Saved to:', OUTPUT_FILE)

        // Summary
        const summary = {}
        limitedPools.forEach(pool => {
            summary[pool.market] = (summary[pool.market] || 0) + 1
        })

        // DEBUG: Show fee distribution
        console.log('\nFee distribution by DEX:');
        const feeStats = {};
        limitedPools.forEach(p => {
            const key = `${p.market}:${p.feeBps}`;
            feeStats[key] = (feeStats[key] || 0) + 1;
        });

        Object.entries(feeStats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .forEach(([key, count]) => {
                console.log(`  ${key.padEnd(30)}: ${count} pools`);
            });

        return limitedPools
    }

    return []
}
module.exports = { collectPools, normalizePool, WORKING_MARKETS, MARKET_STRATEGIES };


if (require.main === module) {
    // You can test individual markets like this: // testMarketCollection('ORCA_WHIRLPOOL').then(() => process.exit(0))

    runCollector().then(() => {
        console.log('\n' + '='.repeat(50));
        console.log('Collection complete!');
        process.exit(0)
    }).catch(error => {
        console.error('Collection failed:', error);
        process.exit(1)
    })
}


// , testMarketCollection 
//. node Dashboard/stage1_market_collector.js


/*
node Dashboard/stage1_market_collector.js
node Dashboard/stage1_market_collector.js --mode extract --output candidates_SOL.json
node _all-trianglesArb.js candidates_SOL.json --mode quote --topn 20 --amount 10

console.log('\n' + '='.repeat(100));
console.log('PROFIT RANKING (Sorted by Net Profit BPS)');
console.log('='.repeat(100));

console.log(
  'Rank'.padEnd(6) +
  'Symbol'.padEnd(10) +
  'Net Profit'.padEnd(15) +
  'Buy@SOL'.padEnd(15) +
  'Sell@SOL'.padEnd(15) +
  'Spread'.padEnd(12) +
  'Markets'.padEnd(10) +
  'Action'
);

console.log('-'.repeat(100));

rankings.forEach((rank, index) => {
  const profitColor = rank.netProfitBps > 0 ? '\x1b[32m' : '\x1b[31m'; // Green for profit, red for loss
  const resetColor = '\x1b[0m';
  
  console.log(
    `${profitColor}` +
    `${(index + 1).toString().padEnd(6)}` +
    `${(rank.symbol || 'UNKNOWN').padEnd(10)}` +
    `${rank.netProfitBps.toFixed(2).padEnd(15)}` +
    `${toSolFromLamports(rank.bestBuyLamports).toFixed(9).padEnd(15)}` +
    `${toSolFromLamports(rank.bestSellLamports).toFixed(9).padEnd(15)}` +
    `${rank.priceDiffBps.toFixed(2).padEnd(12)}` +
    `${rank.marketCount.toString().padEnd(10)}` +
    `${rank.actionable ? '✓' : '✗'}` +
    `${resetColor}`
  );
});

console.log('-'.repeat(100));



    // Helper functions
            const fetchDexScreenerMints = async (query, limit = 20) => {
                try {
                    const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${query}`)
                    const data = await response.json()
                    const pairs = Array.isArray(data?.pairs) ? data.pairs : []
                    return pairs
                        .slice(0, limit)
                        .map(pair => pair?.baseToken?.address)
                        .filter(Boolean)
                } catch (err) {
                    console.log(`DexScreener fetch failed for ${query}:`, err.message)
                    return []
                }
            }


// Alternative: Use your existing price functions to discover pools
async function discoverPoolsViaPriceCheck() {
    console.log('\nDiscovering pools via price checks...')

    const { SolanaTrade } = require('../dist/index.js')
    const trade = new SolanaTrade(RPC)

    const testTokens = [
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
        'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
    ]

    const discoveredPools = []

    for (const market of WORKING_MARKETS) {
        console.log(`\nChecking ${market}...`)

        for (const token of testTokens) {
            try {
                const result = await trade.price({
                    market: market,
                    mint: token,
                    unit: 'SOL'
                })

                // If price check succeeds, there's a pool for this token
                discoveredPools.push({
                    market: market,
                    mintA: token,
                    mintB: WSOL,
                    price: result.price,
                    bondingCurvePercent: result.bondingCurvePercent,
                    source: 'price_check'
                })

                console.log(`✓ ${market} has pool for ${token.substring(0, 8)}...`)

            } catch (err) {
                // No pool for this token-market pair
            }
        }
    }

    return discoveredPools
}

*/