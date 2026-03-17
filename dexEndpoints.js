/**
 * CONSOLIDATED DEX ENDPOINTS - Single Source of Truth
 * ================================================================================
 * Unified structure that eliminates redundancy and simplifies maintenance
 * All DEX configs consolidated with shared field mappings and response formats
 * ================================================================================
 */

//const { RAYDIUM_AMM_POOLS } = require("../utilities/solana-price-query-v2");
const { URL } = require('url');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getTokenSymbol } = require('../libs/KNOWN_TOKENS.js');


// ========================================================================
// SHARED FIELD DEFINITIONS - Used across all DEXs
// ========================================================================
const SHARED_FIELDS = {
    // Core pool identification
    POOL_CORE: ['id', 'address', 'programId', 'type', 'version'],

    // Token information
    TOKEN_INFO: ['baseSymbol', 'quoteSymbol', 'baseMint', 'quoteMint', 'baseDecimals', 'quoteDecimals'],

    // Liquidity metrics (primary focus for filtering)
    LIQUIDITY_METRICS: ['tvl', 'liquidity', 'lpAmount', 'baseReserve', 'quoteReserve',
        'baseLiquidity', 'quoteLiquidity', 'stakedTvl', 'stakedLiquidity'],

    // Volume and trading metrics (enhanced for LP volatility analysis)
    VOLUME_METRICS: [
        // Standard intervals
        'volume1m', 'volume5m', 'volume15m', 'volume30m', 'volume1h',
        'volume2h', 'volume4h', 'volume6h', 'volume12h', 'volume24h',
        'volume7d', 'volume30d', 'volumeAll',
        // Fee metrics
        'volumeFee', 'volumeFee24h', 'volumeFee7d',
        // Transaction counts (for activity analysis)
        'txCount1h', 'txCount24h', 'txCount7d',
        // Price impact metrics
        'priceImpact', 'spread', 'slippage'
    ],
    VAULT: ['xVault', 'yVault', 'xVaultDecimals', 'yVaultDecimals', 'aVault', 'bVault'],

    // APR/APY metrics
    YIELD_METRICS: ['apr', 'apy', 'feeApr', 'feeApy', 'rewardApr', 'rewardApy',
        'totalApr', 'totalApy', 'farmApr', 'farmApy'],

    // Advanced metrics (enhanced for LP analysis)
    ADVANCED_METRICS: [
        'utilizationRate', 'baseUtilizationRate', 'quoteUtilizationRate',
        'activePositionCount', 'openOrderCount', 'liquidityPositionCount',
        // LP-specific metrics
        'lpProviderCount', 'avgLpSize', 'lpTurnoverRate', 'lpConcentration',
        // Volatility indicators
        'volatility1h', 'volatility24h', 'volatility7d',
        'impermanentLossRisk', 'liquidityStability', 'liquidityFlow',
        // Activity patterns
        'peakTradingHours', 'avgTradeSize', 'maxTradeSize', 'tradeFrequency'
    ],

    // Price information
    PRICE_INFO: ['price', 'tickSpacing', 'tickCurrentIndex', 'sqrtPrice']
};

// ========================================================================
// UNIFIED RESPONSE FORMAT - Standard structure for all DEXs
// ========================================================================
const UNIFIED_RESPONSE_FORMAT = {
    metadata: {
        dex: 'string',          // 'raydium', 'orca', 'meteora'
        poolType: 'string',     // 'ammV4', 'clmm', 'whirlpool', 'dlmm'
        timestamp: 'number',    // When data was fetched
        count: 'number'         // Total pools returned
    },
    pools: [{
        // Core identification
        id: 'string',
        address: 'string',
        programId: 'string',
        type: 'string',

        // Token information
        baseToken: {
            mint: 'string',
            symbol: 'string',
            decimals: 'number'
        },
        quoteToken: {
            mint: 'string',
            symbol: 'string',
            decimals: 'number'
        },
        vaults: {
            mint: 'string',
            symbol: 'string',
        },

        // Primary liquidity metrics (ALWAYS PRESENT)
        liquidity: {
            tvl: 'number',              // USD value - PRIMARY FILTER FIELD
            liquidityAmount: 'number',   // Token amount
            baseReserve: 'number',      // Base token reserve
            quoteReserve: 'number'      // Quote token reserve
        },

        // Trading metrics (if available)
        trading: {
            volume24h: 'number',
            volume7d: 'number',
            volumeFee: 'number'
        },

        // Yield metrics (if available)  
        yields: {
            apr: 'number',
            apy: 'number',
            totalApr: 'number'
        },

        // DEX-specific data (optional)
        dexSpecific: 'object'  // Additional fields specific to each DEX
    }]
};

// ========================================================================
// CONSOLIDATED DEX CONFIGURATIONS
// ========================================================================
const CONSOLIDATED_DEX_ENDPOINTS = {

    // ====================================================================
    // RAYDIUM - All pool types unified
    // ====================================================================
    raydium: {
        name: 'Raydium',
        baseUrl: 'https://api-v3.raydium.io',

        // All Raydium program IDs in one place
        programIds: {
            ammV4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
            clmm: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
            cpmm: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
            amm: '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h',
            launchLab: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',

            // Utility programs
            burnAndEarn: 'LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE',
            routing: 'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS',
            staking: 'EhhTKczWMGQt46ynNeRX1WfeagwwJd7ufHvCDjRxjo5Q',
            farmStaking: '9KEPoZmtHUrBbhWN1v1KWLMkkvwY6WLtAVUCPRtRjP4z',
            ecosystemFarm: 'FarmqiPv5eAj3j1GMdMCMUGXqPUvmquZtMy86QH6rzhG'
        },

        // API V2 Endpoints (Primary)
        api_v2: {
            base: 'https://api.raydium.io/v2',
            price: 'https://api.raydium.io/v2/main/price',
            pairs: 'https://api.raydium.io/v2/main/pairs',
            ammPools: 'https://api.raydium.io/v2/ammV3/ammPools',
            farmPools: 'https://api.raydium.io/v2/main/farm-pools',
            info: 'https://api.raydium.io/v2/main/info'
        },

        // API V3 Endpoints (Newer)
        api_v3: {
            base: 'https://api-v3.raydium.io',
            //poolsList: 'https://api-v3.raydium.io/pools/info/list',
            poolInfo: 'https://api-v3.raydium.io/pools/info/{poolAddress}',
            poolLine: 'https://api-v3.raydium.io/pools/line/{poolAddress}'
        },

        // CLMM Specific
        clmm: {
            type: 'Concentrated Liquidity Market Maker',
            description: 'Capital-efficient pools with concentrated liquidity',
            feeTiers: ['0.01%', '0.05%', '0.25%', '1%'],
            endpoints: {
                pools: 'https://api.raydium.io/v2/main/pairs',
                poolsV3: 'https://api-v3.raydium.io/pools/info/list'
            }
        },

        // CPMM Specific
        cpmm: {
            type: 'Constant Product Market Maker',
            description: 'New standard AMM with Token-2022 support',
            features: ['Token-2022 support', 'No OpenBook market ID required'],
            endpoints: {
                pools: 'https://api.raydium.io/v2/main/pairs'
            }
        },

        // AMM V4 Specific
        ammV4: {
            type: 'Legacy Constant Product AMM',
            description: 'Battle-tested AMM, most distributed on Solana',
            endpoints: {
                pools: 'https://api.raydium.io/v2/ammV3/ammPools',
                pairsEndpoint: 'https://api.raydium.io/v2/main/pairs',
                legacyPools: 'https://api.raydium.io/pools'
            }
        },

        // amm
        amm: {
            type: 'Stable Asset AMM',
            description: 'Optimized for pegged assets (e.g., stablecoins)',
            endpoints: {
                pools: 'https://api.raydium.io/v2/main/pairs'
            }
        },

        endpoint: {
            url: '/pools/info/list',
            method: 'GET',
            params: {
                poolType: 'all',
                poolSortField: 'liquidity',
                sortType: 'desc',
                pageSize: 1000,
                page: 1
            },
            availableFields: [
                ...SHARED_FIELDS.POOL_CORE,
                ...SHARED_FIELDS.TOKEN_INFO,
                ...SHARED_FIELDS.LIQUIDITY_METRICS,
                ...SHARED_FIELDS.VOLUME_METRICS,
                ...SHARED_FIELDS.YIELD_METRICS
            ],
            liquidityFields: ['tvl', 'liquidity'],
            fieldMapping: {
                'id': 'id',
                'programId': 'programId',
                'type': 'type',
                'mintA.address': 'baseToken.mint',
                'mintA.symbol': 'baseToken.symbol',
                'mintA.decimals': 'baseToken.decimals',
                'mintB.address': 'quoteToken.mint',
                'mintB.symbol': 'quoteToken.symbol',
                'mintB.decimals': 'quoteToken.decimals',
                'tvl': 'liquidity.tvl',
                'day.volume': 'trading.volume24h',
                'week.volume': 'trading.volume7d',
                'day.apr': 'yields.apr'
            },
            additionalEndpoints: {
                prices: '/mint/price',
                poolDetails: '/pools/info/ids'
            }
        },

        config: {
            enabled: true,
            timeout: 120000,
            rateLimit: 'Medium'
        },

        rateLimit: {
            requestsPerMinute: 60,
            burstLimit: 10
        }
    },

    // ====================================================================
    // ORCA - Whirlpool unified
    // ====================================================================
    orca: {
        name: 'Orca',
        baseUrl: 'https://https://api.orca.so/v2/solana/protocol/whirlpools',
        curl: 'https://api.orca.so/v2/solana/protocol/whirlpools',

        programIds: {
            whirlpool: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
            aquafarm: '82yxjeMsvaURa4MbZZ7WZZHfobirZYkH1zF8fmeGtyaQ'
        },

        api: {
            curl: 'https://api.orca.so/v2/solana/protocol/whirlpools',
            base: 'https://api.mainnet.orca.so/v1',
            whirlpools: 'https://api.mainnet.orca.so/v1/whirlpool/list',
            tokens: 'https://api.mainnet.orca.so/v1/token/list',
            curl: 'https://api.orca.so/v2/solana/protocol/whirlpools'
        },

        endpoint: {
            url: '/whirlpool/list',
            method: 'GET',
            availableFields: [
                ...SHARED_FIELDS.POOL_CORE,
                ...SHARED_FIELDS.TOKEN_INFO,
                ...SHARED_FIELDS.LIQUIDITY_METRICS,
                ...SHARED_FIELDS.PRICE_INFO
            ],
            liquidityFields: ['tvl', 'liquidity'],
            fieldMapping: {
                'address': 'id',
                'tokenA.mint': 'baseToken.mint',
                'tokenA.symbol': 'baseToken.symbol',
                'tokenA.decimals': 'baseToken.decimals',
                'tokenB.mint': 'quoteToken.mint',
                'tokenB.symbol': 'quoteToken.symbol',
                'tokenB.decimals': 'quoteToken.decimals',
                'feeTier': 'feeTier.feeTier',
                'tvl': 'liquidity.tvl',
                'liquidity': 'liquidity.liquidityAmount',
                'xReserve': 'xReserve.decimals',
                'yReserve': 'yReserve.decimals',
                'binSteps': 'binSteps.',
                'currentTickIndex': 'tickCurrentIndex',
                'tickCurrentIndex': 'tickCurrentIndex',
                'tickSpacing': 'tickSpacing',
                'sqrtPrice': 'sqrtPrice',
                'xVault': 'xVault.mint',
                'yVault': 'yVault.mint',
            }
        },

        config: {
            enabled: true,
            timeout: 60000,
            rateLimit: 'Medium'
        },

        rateLimit: {
            requestsPerMinute: 100,
            burstLimit: 20
        }
    },

    // ====================================================================
    // METEORA - DLMM unified  
    // ====================================================================
    meteora: {
        name: 'Meteora',
        baseUrl: 'https://dlmm-api.meteora.ag',

        programIds: {
            dlmm: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
            dammv1: 'METAmTMXwdb8gYzyCPfXXFmZZw4rUsXX58PNsDg7zjL',
            dammv2: 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',
            dynamicVaults: '24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi'
        },

        dlmm: {
            type: 'Dynamic Liquidity Market Maker',
            description: 'Bin-based AMM with dynamic fees',
            features: ['Bin-based liquidity', 'Dynamic fees', 'Zero slippage in bins'],
            endpoints: {
                DLMM: 'https://dlmm-api.meteora.ag/pair/all',
                AMM: 'https://amm-v2.meteora.ag/pool/list',
                DAMM_V1: 'https://damm-api.meteora.ag/pools',
                DAMM: 'https://damm-api.meteora.ag/pool-configs',
                DAMM_V2: 'https://dammv2-api.meteora.ag/pools',
                allPairs: 'https://dlmm-api.meteora.ag/pair/all',
                all: 'https://dlmm-api.meteora.ag/pair/all',
                pairInfo: 'https://dlmm-api.meteora.ag/pair/{pairAddress}',
                position: 'https://dlmm-api.meteora.ag/position/{positionAddress}',
                positionV2: 'https://dlmm-api.meteora.ag/position_v2/{positionAddress}',
                positionMetrics: 'https://dlmm-api.meteora.ag/position/{positionAddress}/metrics',
                stake: 'https://dlmm-api.meteora.ag/stake/{stakeAddress}',
                stakeMetrics: 'https://dlmm-api.meteora.ag/stake/{stakeAddress}/metrics',
                stakePosition: 'https://dlmm-api.meteora.ag/stake/{stakeAddress}/position'
            }
        },

        dammv2: {
            type: 'Dynamic AMM V2',
            description: 'Multi-token pools with dynamic weights',
            features: ['Multi-token pools', 'Dynamic weights', 'Auto-rebalancing'],
            endpoints: {
                globalMetrics: 'https://dammv2-api.meteora.ag/pools/global-metrics',
                pool: 'https://dammv2-api.meteora.ag/pools/{poolAddress}',
                metrics: 'https://dammv2-api.meteora.ag/pools/{poolAddress}/metrics',
                position: 'https://dammv2-api.meteora.ag/pools/{poolAddress}/position',
                vesting: 'https://dammv2-api.meteora.ag/pools/vesting/{address}'
            }
        },

        dammv1: {
            type: 'Dynamic AMM V1',
            description: 'Legacy multi-token pools',
            endpoints: {
                main: 'https://damm-api.meteora.ag/pools',
                globalMetrics: 'https://damm-api.meteora.ag/pools/global-metrics',
                pool: 'https://damm-api.meteora.ag/pools/{poolAddress}',
                metrics: 'https://damm-api.meteora.ag/pools/{poolAddress}/metrics',
                position: 'https://damm-api.meteora.ag/pools/{poolAddress}/position',
                vesting: 'https://damm-api.meteora.ag/pools/vesting/{address}',
                search: 'https://damm-api.meteora.ag/pools/search?query={query}',
                feeConfig: 'https://damm-api.meteora.ag/fee-config/{configAddress}'
            }
        },

        dynamicVaults: {
            type: 'Dynamic Vaults',
            description: 'Automated market-making vaults',
            endpoints: {
                vaultInfoV2: 'https://merv2-api.meteora.ag/vault_info/{vaultAddress}',
                vaultInfo: 'https://dynamic-vault-api.meteora.ag/vault_info/{vaultAddress}',
                vaultStateV2: 'https://merv2-api.meteora.ag/vault_state/{tokenMint}',
                vaultState: 'https://dynamic-vault-api.meteora.ag/vault_state/{tokenMint}'
            }//https://merv2-api.meteora.ag/vault_info/
        },

        general: {
            globalMetrics: 'https://gmetrics.meteora.ag/api/v1/pairs'
        },

        endpoint: {
            url: '/pair/all',
            method: 'GET',
            availableFields: [
                ...SHARED_FIELDS.POOL_CORE,
                ...SHARED_FIELDS.TOKEN_INFO,
                ...SHARED_FIELDS.LIQUIDITY_METRICS,
                ...SHARED_FIELDS.VOLUME_METRICS,
                ...SHARED_FIELDS.YIELD_METRICS
            ],
            liquidityFields: ['liquidity_usd', 'reserve_x', 'reserve_y'],
            fieldMapping: {
                'address': 'id',
                'name': 'type',
                'mint_x': 'baseToken.mint',
                'mint_y': 'quoteToken.mint',
                'liquidity_usd': 'liquidity.tvl',
                'reserve_x': 'liquidity.baseReserve',
                'reserve_y': 'liquidity.quoteReserve',
                'volume_24h': 'trading.volume24h',
                'fees_24h': 'trading.volumeFee'
            }
        },

        config: {
            enabled: true,
            timeout: 120000,
            rateLimit: 'Low'
        },

        rateLimit: {
            requestsPerMinute: 120,
            burstLimit: 30
        }
    }
};

// ========================================================================
// UTILITY FUNCTIONS 
// ========================================================================

/**
 * Get all available liquidity fields across all DEXs
 */
function getAllLiquidityFields() {
    return [...new Set([
        ...SHARED_FIELDS.LIQUIDITY_METRICS,
        'liquidity_usd', 'reserve_x', 'reserve_y', 'xReserve', 'yReserve'
    ])];
}

function getVaults() {
    return [...new Set([
        ...SHARED_FIELDS.VAULT,
        xVault = 'xVault' || 'xVault' || 'aVult' || 'xVaultDecimals',
        yVault = 'yVault' || 'yVault' || 'bVault' || 'yVaultDecimals'
    ])];
}

function getVaultProgramIds(dexName) {
    const config = getDexConfig(dexName);

    return config ? config.dexName : {

    };

};

/**
 * Get all available pool types across all DEXs
 */
function getAllPoolTypes() {
    return {
        raydium: ['CLMM', 'CPMM'],
        orca: ['WHIRLPOOL'],
        meteora: ['DLMM']
    };
}

/**
 * Get unified endpoint configuration for a specific DEX
 */
function getDexConfig(dexName) {
    return CONSOLIDATED_DEX_ENDPOINTS[dexName.toLowerCase()];
}

/**
 * Get all program IDs for a specific DEX  
 */
function getDexProgramIds(dexName) {
    const config = getDexConfig(dexName);
    return config ? config.programIds : {};
}

/**
 * Build complete API URL for a DEX
 */
function buildApiUrl(dexName, params = {}) {
    const config = getDexConfig(dexName);
    if (!config) throw new Error(`Unknown DEX: ${dexName}`);

    const url = new URL(config.baseUrl + config.endpoint.url);

    // Always set poolType to 'all'
    url.searchParams.set('poolType', 'all');

    // Add default params from endpoint config
    if (config.endpoint.params) {
        Object.entries(config.endpoint.params).forEach(([key, value]) => {
            url.searchParams.set(key, value);
        });
    }

    // Add custom params (overrides defaults if same key)
    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });

    return url.toString();
}

/**
 * ✅ FIXED: Download and store pools by type (removed duplicate declarations)
 */
async function downloadAndStorePools(dexName, endpointUrl, minLiquidity = 1_000_000) {
    try {
        logger.info('PoolDownload', `📥 Downloading pools from ${dexName}...`);

        // Fetch pool data
        const { data } = await axios.get(endpointUrl, { timeout: 120000 });

        if (!data || !Array.isArray(data)) {
            logger.warn('PoolDownload', `Invalid data format from ${dexName}`);
            return;
        }

        // Get DEX config to determine pool types
        const dexConfig = getDexConfig(dexName);
        const programIds = dexConfig?.programIds || {};

        // Group pools by type
        const poolsByType = {};

        for (const pool of data) {
            // Determine pool type from programId
            let currentPoolType = 'unknown';

            if (pool.programId) {
                for (const [typeName, programId] of Object.entries(programIds)) {
                    if (pool.programId === programId) {
                        currentPoolType = typeName;
                        break;
                    }
                }
            }

            // Filter by minimum liquidity
            const liquidityValue = pool.tvl || pool.liquidity || pool.liquidity_usd || 0;
            if (liquidityValue < minLiquidity) continue;

            // Add to appropriate pool type group
            if (!poolsByType[currentPoolType]) {
                poolsByType[currentPoolType] = [];
            }
            poolsByType[currentPoolType].push(pool);
        }

        // Save each pool type to separate file
        let totalSaved = 0;
        for (const [poolTypeName, pools] of Object.entries(poolsByType)) {
            if (pools.length === 0) continue;

            const outPath = path.join(__dirname, `../CURATED/${dexName}/poolType_${poolTypeName}.json`);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, JSON.stringify(pools, null, 2));

            logger.info('PoolDownload', `✅ Saved ${pools.length} ${poolTypeName} pools to ${outPath}`);
            totalSaved += pools.length;
        }

        logger.info('PoolDownload', `✅ Finished downloading ${totalSaved} pools from ${dexName}`);
        return totalSaved;

    } catch (error) {
        logger.error('PoolDownload', `Failed to download ${dexName} pools: ${error.message}`);
        throw error;
    }
}

const TOKENS_DECIMALS = {
    "So11111111111111111111111111111111111111112": {
        "decimals": 9,
        "symbol": "SOL"
    },
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": {
        "decimals": 6,
        "symbol": "USDC"
    },
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": {
        "decimals": 6,
        "symbol": "USDT"
    },
    "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": {
        "decimals": 8,
        "symbol": "WETH"
    },
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So": {
        "decimals": 9,
        "symbol": "mSOL"
    },
    "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn": {
        "decimals": 9,
        "symbol": "jitoSOL"
    },
    "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": {
        "decimals": 9,
        "symbol": "stSOL"
    },
    "ZA4vqAcejc8TwDbgqd4gMmr1FpubUwzSGmhLYhgLaHE": {
        "decimals": 6,
        "symbol": null
    },
    "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN": {
        "decimals": 6,
        "symbol": "TRUMP"
    },
    "ApJEJEnXSwCoWKynr54whxDgcQWdQ8iGJ2tkDpnmpump": {
        "decimals": 6,
        "symbol": null
    },
    "E1XGEP1nk3BLxpnkWfqVnpVTA13RYzpY6Na1XD2Kpump": {
        "decimals": 6,
        "symbol": "QUASAR"
    },
    "62ZiwfjUj8rihfYyBUTL4P1ftzCkvLqT7ivqtSBwpump": {
        "decimals": 6,
        "symbol": null
    },
    "C2RLcU3jB7mjzGSi9wb7emTWmRcXagSyMH68jLiVpump": {
        "decimals": 6,
        "symbol": null
    },
    "FNrwxRPRTtrRtFjogkJXxgY6mB5S71kgiEvjj4UgwV3K": {
        "decimals": 6,
        "symbol": null
    },
    "Eeuqq5Jgp6BfbkQZUXJBhWgozpYuP9Ej71FAsfZ3tRRM": {
        "decimals": 6,
        "symbol": null
    },
    "GMvCfcZg8YvkkQmwDaAzCtHDrrEtgE74nQpQ7xNabonk": {
        "decimals": 6,
        "symbol": "1"
    },
    "Ax8PSfCXxmxb8C8kYTzN5CPpTe6PyeZfFf8rrXNCjupx": {
        "decimals": 6,
        "symbol": "MM"
    },
    "CboMcTUYUcy9E6B3yGdFn6aEsGUnYV6yWeoeukw6pump": {
        "decimals": 6,
        "symbol": "Butthole"
    },
    "A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump": {
        "decimals": 6,
        "symbol": "FWOG"
    },
    "5evN2exivZXJfLaA1KhHfiJKWfwH8znqyH36w1SFz89Y": {
        "decimals": 6,
        "symbol": "MIRAI"
    },
    "sCLN9rN7hZGWgLm4xurniAb7L1SLS1if4HHh37ypump": {
        "decimals": 6,
        "symbol": null
    },
    "H7ASztrWPx5E7NgVZxELRAwiNGkUmwsZtWutXpYFpump": {
        "decimals": 6,
        "symbol": null
    },
    "HZAc3jo6TEJhx2meJBbcmL32o2iKehuu5ZA4bSnUbonk": {
        "decimals": 6,
        "symbol": null
    },
    "ExocdWVMKbZBsMo21M6c6SCj7n4k4s7vmUVz3mGvpump": {
        "decimals": 6,
        "symbol": "∅"
    },
    "4pyktCdWhXgWRsMe7zPboVJaA75g5XrwTU73My1Upump": {
        "decimals": 6,
        "symbol": null
    },
    "DWEsJwPRrFscjH8krbMryHo6UNQ3tAd7kK3SPVcYTiHH": {
        "decimals": 8,
        "symbol": null
    },
    "6fuzUuqHtCs33ZStcsVGqEpWAkRrywmCjG6Vy1CNpump": {
        "decimals": 6,
        "symbol": null
    },
    "B89Hd5Juz7JP2dxCZXFJWk4tMTcbw7feDhuWGb3kq5qE": {
        "decimals": 9,
        "symbol": "NC"
    },
    "EfF6MSk2L5gFM6THaND7L9vM65bgjKP7sFYCY933pump": {
        "decimals": 6,
        "symbol": null
    },
    "GAkYTCw6Kt2dsyifBbGycrT8YoMCVRR23UrsNDqGBAGS": {
        "decimals": 9,
        "symbol": null
    },
    "ARGkjEeWbMaJetqZbfrw7mLnDwouZCcxSE27EwEQbonk": {
        "decimals": 6,
        "symbol": null
    },
    "3iQL8BFS2vE7mww4ehAqQHAsbmRNCrPxizWAT2Zfyr9y": {
        "decimals": 9,
        "symbol": "VIRTUAL"
    },
    "7eLz7uTp7NX9PuRvEzV3atQTy3H57Bre78kTcufhvirt": {
        "decimals": 6,
        "symbol": null
    },
    "BSqHQohsYwhZRD9djeUvfDT9GuwDAqbrRZvjSyiVpump": {
        "decimals": 6,
        "symbol": null
    },
    "2HAa2vQ5p6intfVcVPajKfG9faDsf6DX6h8am4KK7MgD": {
        "decimals": 9,
        "symbol": null
    },
    "2RBko3xoz56aH69isQMUpzZd9NYHahhwC23A5F3Spkin": {
        "decimals": 6,
        "symbol": "PKIN"
    },
    "6bq8kCaBGPiqjpwV2dACjT4S7aaynA5ZoQ61U3t4pump": {
        "decimals": 6,
        "symbol": "GTA"
    },
    "FtUEW73K6vEYHfbkfpdBZfWpxgQar2HipGdbutEhpump": {
        "decimals": 6,
        "symbol": "titcoin"
    },
    "GoLDDDNBPD72mSCYbC75GoFZ1e97Uczakp8yNi7JHrK4": {
        "decimals": 9,
        "symbol": "GOLD"
    },
    "Fudr9tLFYnd2HNqygB2wi1n69cnE5wKaxXHqyz98bonk": {
        "decimals": 6,
        "symbol": null
    },
    "Ai4CL1SAxVRigxQFwBH8S2JkuL7EqrdiGwTC7JpCpump": {
        "decimals": 6,
        "symbol": "AWR"
    },
    "4uCRv65cB7gqt4uErxjYKmjbV3QLoGqHqTqJ7Ngkpump": {
        "decimals": 6,
        "symbol": "WHAT"
    },
    "DUuqTfp6CxceXiuaqeHoSwH2NoYegPBav8NmcE1azHQU": {
        "decimals": 6,
        "symbol": null
    },
    "Av6qVigkb7USQyPXJkUvAEm4f599WTRvd75PUWBA9eNm": {
        "decimals": 9,
        "symbol": "COST"
    },
    "DEf93bSt8dx58gDFCcz4CwbjYZzjwaRBYAciJYLfdCA9": {
        "decimals": 6,
        "symbol": "KWEEN"
    },
    "7b36cKRYFZsMp3vLByVwfVQxW2ndcYth5rhPnyypump": {
        "decimals": 6,
        "symbol": "PINO"
    },
    "A18GrBLPSWUGg1pp3tg9oJU2KBQrkkKiyykL21b4u22i": {
        "decimals": 8,
        "symbol": "ORBIO"
    },
    "4QQZnjXnmzNT8YgMrUPDjGTdLtLbdpvq4o5Bu2NGTgFe": {
        "decimals": 9,
        "symbol": null
    },
    "33zBJtwaRdfW9asbsF3JE1hiY4MaxbHtPSZn2jCYEEZY": {
        "decimals": 6,
        "symbol": null
    },
    "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL": {
        "decimals": 6,
        "symbol": "MET"
    },
    "CnGb7hJsGdsFyQP2uXNWrUgT5K1tovBA3mNnUZcTpump": {
        "decimals": 6,
        "symbol": "flork"
    },
    "Gb9jGTUrGLvqHacsKDXbxsbEr6pqZb71J661WkBFpump": {
        "decimals": 6,
        "symbol": "JUJU"
    },
    "9m9xsyqRChGRor95fXLGEG9J7xxEnHTZgXkPKC3pump": {
        "decimals": 6,
        "symbol": null
    },
    "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump": {
        "decimals": 6,
        "symbol": "FARTCOIN"
    },
    "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij": {
        "decimals": 8,
        "symbol": "cBTC"
    },
    "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh": {
        "decimals": 8,
        "symbol": "WBTC"
    },
    "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4": {
        "decimals": 6,
        "symbol": "JLP"
    },
    "BLVxek8YMXUQhcKmMvrFTrzh5FXg8ec88Crp6otEaCMf": {
        "decimals": 9,
        "symbol": "BELIEVE"
    },
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": {
        "decimals": 5,
        "symbol": "BONK"
    },
    "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": {
        "decimals": 6,
        "symbol": "RAY"
    },
    "ZBCNpuD7YMXzTHB2fhGkGi78MNsHGLRXUhRewNRm9RU": {
        "decimals": 6,
        "symbol": "ZBCN"
    },
    "pepo1CFNU2RXf7yXX7HNXazXwxsq8WrPvDHpHriwoLY": {
        "decimals": 6,
        "symbol": "PEPO"
    },
    "yso11zxLbHA3wBJ9HAtVu6wnesqz9A2qxnhxanasZ4N": {
        "decimals": 9,
        "symbol": null
    },
    "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta": {
        "decimals": 6,
        "symbol": "LOYAL"
    },
    "Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump": {
        "decimals": 6,
        "symbol": "neet"
    },
    "CvB1ztJvpYQPvdPBePtRzjL4aQidjydtUz61NWgcgQtP": {
        "decimals": 6,
        "symbol": "EPCT"
    },
    "WLFinEv6ypjkczcS83FZqFpgFZYwQXutRbxGe7oC16g": {
        "decimals": 6,
        "symbol": "WLFI"
    },
    "G4uJcvo5UAJ3fU1gj96e5DjBJU2RDDPx9Txzbjw6Y3LA": {
        "decimals": 9,
        "symbol": "CAESAR"
    },
    "XLnpFRQ3rSWupCRjuQfx74mgVoT3ezVJKE1CogRZxhH": {
        "decimals": 6,
        "symbol": "XLAB"
    },
    "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk": {
        "decimals": 6,
        "symbol": "USELESS"
    },
    "HZqjjeso24PDVdLsVJQyVb8kDnbo7HhXfY1Jane66o9C": {
        "decimals": 9,
        "symbol": "CDR"
    },
    "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv": {
        "decimals": 6,
        "symbol": "PENGU"
    },
    "METAwkXcqyXKy1AtsSgJ8JiUHwGCafnZL38n3vYmeta": {
        "decimals": 6,
        "symbol": "META"
    },
    "LFNTYraetVioAPnGJht4yNg2aUZFXR776cMeN9VMjXp": {
        "decimals": 6,
        "symbol": "LFNTY"
    },

    "J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr": {
        "decimals": 8,
        "symbol": "SPX"
    },
    "myrcAs6bpP2g5oGHZ3qpgrfZQAFkbo9KUHdqYDXMjGv": {
        "decimals": 6,
        "symbol": "MYRC"
    },
    "SCSuPPNUSypLBsV4darsrYNg4ANPgaGhKhsA3GmMyjz": {
        "decimals": 5,
        "symbol": "SCS"
    },
    "2oQNkePakuPbHzrVVkQ875WHeewLHCd2cAwfwiLQbonk": {
        "decimals": 6,
        "symbol": "AOL"
    },
    "Cy1GS2FqefgaMbi45UunrUzin1rfEmTUYnomddzBpump": {
        "decimals": 6,
        "symbol": "MOBY"
    },
    "HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz": {
        "decimals": 6,
        "symbol": "sHYUSD"
    },
    "vQoYWru2pbUdcVkUrRH74ktQDJgVjRcDvsoDbUzM5n9": {
        "decimals": 4,
        "symbol": "REKT"
    },
    "Ee4ooSk6GMC34T1Gbh8rRY2XLyuk2FsyiWtq3jrHUcPR": {
        "decimals": 9,
        "symbol": "VNX"
    },
    "H5b4iYiZYycr7fmQ1dMj7hdfLGAEPcDH261K4hugpump": {
        "decimals": 6,
        "symbol": "MONEROCHAN"
    },
    "AyrQpt5xsVYiN4BqgZdd2tZJAWswT9yLUZmP1jKqpump": {
        "decimals": 6,
        "symbol": "jobcoin"
    },
    "STREAMribRwybYpMmSYoCsQUdr6MZNXEqHgm7p1gu9M": {
        "decimals": 6,
        "symbol": "STREAM"
    },
    "GEuuznWpn6iuQAJxLKQDVGXPtrqXHNWTk3gZqqvJpump": {
        "decimals": 6,
        "symbol": "ACE"
    },
    "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj": {
        "decimals": 6,
        "symbol": "syrupUSDC"
    },
    "PRVT6TB7uss3FrUd2D9xs2zqDBsa3GbMJMwCQsgmeta": {
        "decimals": 6,
        "symbol": "UMBRA"
    },
    "31k88G5Mq7ptbRDf3AM13HAq6wRQHXHikR8hik7wPygk": {
        "decimals": 9,
        "symbol": "GP"
    },
    "9wK8yN6iz1ie5kEJkvZCTxyN1x5sTdNfx8yeMY8Ebonk": {
        "decimals": 6,
        "symbol": "Hosico"
    },
    "69LjZUUzxj3Cb3Fxeo1X4QpYEQTboApkhXTysPpbpump": {
        "decimals": 6,
        "symbol": "CODEC"
    },
    "CxiR3c9AGqMtE7bg82sLnzpLinXN3kXfcoYeYtGApFoG": {
        "decimals": 6,
        "symbol": "FOG"
    },
    "BktHEAc2WS8TQi2vmavn1rA4L1WJuwF3Vkk3DnwwARti": {
        "decimals": 9,
        "symbol": null
    },
    "Ex5DaKYMCN6QWFA4n67TmMwsH8MJV68RX6YXTmVM532C": {
        "decimals": 9,
        "symbol": "USDv"
    },
    "zBTCug3er3tLyffELcvDNrKkCymbPWysGcWihESYfLg": {
        "decimals": 8,
        "symbol": "zBTC"
    },
    "BivtZFQ5mVdjMM3DQ8vxzvhKKiVs27fz1YUF8bRFdKKc": {
        "decimals": 9,
        "symbol": "FLAME"
    },
    "GDfnEsia2WLAW5t8yx2X5j2mkfA74i5kwGdDuZHt7XmG": {
        "decimals": 9,
        "symbol": "CROWN"
    },
    "CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp": {
        "decimals": 6,
        "symbol": "CARDS"
    },
    "CaAkNuMqWc87arZ7Aw8wp82K34SxtAf2J6uR7VW47cmU": {
        "decimals": 9,
        "symbol": null
    },
    "Eg2ymQ2aQqjMcibnmTt8erC6Tvk9PVpJZCxvVPJz2agu": {
        "decimals": 6,
        "symbol": "PUMPCADE"
    },
    "5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2": {
        "decimals": 6,
        "symbol": "TROLL"
    },
    "9v6BKHg8WWKBPTGqLFQz87RxyaHHDygx8SnZEbBFmns2": {
        "decimals": 9,
        "symbol": "SKATE"
    },
    "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr": {
        "decimals": 9,
        "symbol": "POPCAT"
    },
    "CB9dDufT3ZuQXqqSfa1c5kY935TEreyBw9XJXxHKpump": {
        "decimals": 6,
        "symbol": "USDUC"
    },
    "JDzPbXboQYWVmdxXS3LbvjM52RtsV1QaSv2AzoCiai2o": {
        "decimals": 6,
        "symbol": "FO"
    },
    "FeR8VBqNRSUD5NtXAj2n3j1dAHkZHfyDktKuLXD4pump": {
        "decimals": 6,
        "symbol": "jellyjelly"
    },
    "E7NgL19JbN8BhUDgWjkH8MtnbhJoaGaWJqosxZZepump": {
        "decimals": 6,
        "symbol": "PAYAI"
    },
    "CLoUDKc4Ane7HeQcPpE3YHnznRxhMimJ4MyaUqyHFzAu": {
        "decimals": 9,
        "symbol": "CLOUD"
    },
    "C29ebrgYjYoJPMGPnPSGY1q3mMGk4iDSqnQeQQA7moon": {

        "JxxWsvm9jHt4ah7DT9NuLyVLYZcZLUdPD93PcPQ71Ka": {
            "decimals": 9,
            "symbol": "mockJUP"
        },
        "CRAMvzDsSpXYsFpcoDr6vFLJMBeftez1E7277xwPpump": {
            "decimals": 6,
            "symbol": "PEPECAT"
        },
        "DYeTA4ZQhEwoJ5imjq1Q3zgwfTgkh4WmdfFHAq3jLrv3": {
            "decimals": 6,
            "symbol": "USDAI"
        }
    },
}
/**
 * Helper function to fetch pools for a specific type (used by downloadAndStorePools)
 */
async function fetchPoolsForType(dexName, poolTypeName) {
    // Define configuration in a more structured way
    const dexConfigs = {
        raydium: {
            poolTypeName: ['cpmm', 'clmm', 'amm'],
            programIds: {
                ammV4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
                clmm: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
                cpmm: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
                amm: '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h',
            },
            apiUrl: 'https://api-v3.raydium.io/'
        },
        orca: {
            poolTypeName: ['whirlpool'],
            programIds: {
                whirlpool: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'
            },
            apiUrl: 'https://api.orca.so/v2/solana/protocol/whirlpools'
        },
        meteora: {
            poolTypeName: ['dlmm', 'dammv1', 'dammv2', 'dynamicVaults'],
            programIds: {
                dlmm: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
                dammv1: 'METAmTMXwdb8gYzyCPfXXFmZZw4rUsXX58PNsDg7zjL',
                dammv2: 'cpamdpZCGKUyJxQXB4dcpGPiikHawvSWAd6mEn1sGG',
                dynamicVaults: '24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi'
            },
            apiUrl: 'https://dlmm-api.meteora.ag'
        }
    };

    // Normalize input names to lowercase
    const normalizedDexName = dexName.toLowerCase();
    const normalizedPoolType = poolTypeName.toLowerCase();

    // Get the configuration for the requested DEX
    const config = dexConfigs[normalizedDexName];

    // Return empty array if DEX not found or pool type not supported
    if (!config || !config.poolTypeName.includes(normalizedPoolType)) {
        const poolTypes = {
            raydium: {
                poolTypeName: ['cpmm', 'clmm', 'amm'],
            },
            orca: {
                poolTypeName: ['whirlpool'],
                meteora: {
                    poolTypeName: ['dlmm', 'dammv1', 'dammv2', 'dynamicVaults'],
                },
            },
        }
        return poolTypes;
    }
    const programId = config.programIds[normalizedPoolType];
    const apiUrl = `${config.apiUrl}/pools?programId=${programId}`;

    let allPools = [];
    try {
        const response = await axios.get(apiUrl);

    } catch (error) {
        console.error('Error in processing pools:', error);
        // Handle or rethrow error as needed
    }

}

async function downloadAndStorePools(dexName, apiUrl, poolTypeName, tokens, minLiquidity) {
    try {

        // Fetch pool data with proper type validation
        const validPoolTypes = ['CLMM', 'CPMM', 'WHIRLPOOL', 'DLMM', 'AMM', 'DAMMV1', 'DAMMV2', 'DYNAMICVAULTS', 'ALL'];
        const defaultPoolType = validPoolTypes.includes(poolTypeName) ? poolType : 'ALL';
        const poolData = await fetchPoolsForType(
            dexName,
            defaultPoolType,
            getTokenSymbol(TOKENS_DECIMALS),
            minLiquidity);

        // Filter tokens with proper grouping and null checks
        const filteredTokens = (tokens || []).filter(token =>
            token &&
            ['ORCA', 'METEORA', 'RAYDIUM'].includes(token.dexName) &&
            !token.isNative &&
            !token.isDerived &&
            token.chainId === 1 // Verify this is correct for your use case
        );

        console.log('Filtered Tokens:', {
            count: filteredTokens.length,
            names: filteredTokens.map(t => t.name),
            symbols: filteredTokens.map(t => t.symbol)
        });


    } catch (error) {
        console.error(error);
    }

    if (!getVaultProgramIds) return [];
    try {
        const response = await axios.get(apiUrl);
        const pools = response.data;

        try {
            const liquidity = getAllLiquidityFields()
                .filter(liquidityField => liquidityField >= minLiquidity)
                .map((liquidityField) => {
                    liquidityField.split('_').reduce((acc, field) => acc[field], pools);
                });

            const vaultProgramIds = getVaultProgramIds();
            const { data } = await axios.get(apiUrl, { timeout: 60000 });
            console.log(`${dexName.length}, ${poolTypeName}`)
            console.log(pools);
            console.log(pools.length);

            if (Array.isArray(data)) {

                const unifiedResponseFormat = data.map((pool) => ({
                    ...pool,
                    liquidity: liquidity.reduce((acc, field) => acc + parseFloat(field), 0),
                    vaultProgramId: vaultProgramIds.find(id => id === pool.vaultProgramId),
                    dexName: dexName.toUpperCase(),
                    poolTypeName: poolTypeName.toUpperCase()
                }));
                return unifiedResponseFormat, liquidity;

            }
        } catch (error) {
            logger.error(`Error downloading and storing pools for ${dexName}:`, error);
            throw new Error(`Error downloading and storing pools for ${dexName}: ${error.message}`);
        }
    } catch (error) {
        console.error(`Error fetching pools from ${apiUrl}:`, error);
        throw new Error(`Error fetching pools from ${apiUrl}: ${error.message}`);
    }
}
function isValidToken(token) {
    const MAINNET_CHAIN_ID = 1;
    const validDexes = new Set(['ORCA', 'METEORA', 'RAYDIUM']);
    return validDexes.has(token.dexName) &&
        !token.isNative &&
        !token.isDerived &&
        token.chainId === 1;
}
// ========================================================================
// EXPORTS
// ========================================================================
module.exports = {
    CONSOLIDATED_DEX_ENDPOINTS,
    SHARED_FIELDS,
    UNIFIED_RESPONSE_FORMAT,
    getTokenSymbol,
    getVaultProgramIds,
    getAllLiquidityFields,
    getAllPoolTypes,
    getDexConfig,
    getDexProgramIds,
    buildApiUrl,
    downloadAndStorePools,
    fetchPoolsForType,
    getVaults,
    isValidToken
};

// node dexEndpoint.js download raydium 1000000

(async () => {
    // Ensure this is inside an async function
    await downloadAndStorePools(dexName, buildApiUrl(dexName), getTokenSymbol(TOKENS_DECIMALS), minLiquidity);
    const args = process.argv.slice(5);
    const dexName = args[1] || 'raydium' || 'orca' || 'meteora';
    const minLiquidity = parseInt(args[2], 10) || 1_000_000;
    const poolTypes = (args[3] || 'cpmm' || 'clmm' || 'amm' || 'whirlpool' || 'dlmm' || 'dammv1' || 'dammv2' || 'dynamicvaults' || 'all', false);


    const endpointUrl = args[4] || buildApiUrl(dexName);
    const tokens = args[5] || getTokenSymbol(TOKENS_DECIMALS);


    console.log(Object.keys(poolTypes));
    console.log(` $endpoints.js download ${dexName.dexName} ${poolTypes.poolTypeName} ${minLiquidity.toString}`);
    console.log(`${endpointUrl.apiUrl}`)
    console.log(`${tokens}`);
    console.log(`${poolTypes}`);
    console.log(`${minLiquidity}`);
    console.log(`${Object.entries(poolTypes).length}`);
    const poolData = await fetchPoolsForType(dexName, 'CLMM' || 'CPMM' || 'WHIRLPOOL' || 'DLMM' || 'ALL');
    console.log(poolData);

    const filteredTokens = tokens.filter(token =>
        (token.dexName === 'ORCA' || token.dexName === 'METEORA' || token.dexName === 'RAYDIUM') &&
        token.isNative !== true &&
        token.isDerived !== true &&
        token.chainId === 1 // Consider using a named constant for chainId
    );

    // Fix typo in filteredTokens.length
    console.log('Filtered tokens count:', filteredTokens.length);
    console.log('Total tokens count:', tokens.length);

    // Consider more organized debugging:
    console.log('Token overview:', {
        names: tokens.map(t => t.name),
        symbols: tokens.map(t => t.symbol),
        addresses: tokens.map(t => t.address),
        decimals: tokens.map(t => t.decimals),
        derivedValues: {
            USD: tokens.map(t => t.derivedUSD),
            USDT: tokens.map(t => t.derivedUSDT),
            SOL: tokens.map(t => t.derivedSOL)
        }
    });


})

// For the chainId comparison, consider using a named constant:

// result.poolFeeRate = feeAmount / parseFloat

//. node libs/dexEndpoints.js orca 1_000_000 whirlpool TOKENS_DECIMALS