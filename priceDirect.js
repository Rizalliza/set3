// priceDirect.js - Use direct market price functions

'use strict';

require('dotenv').config();

const { Connection, PublicKey } = require('@solana/web3.js');
const { getPriceForMarket } = require('./dist/helpers/price.js');
const fs = require('fs');
const path = require('path');
const BN = require('bn.js');

// ✅ CORRECT IMPORTS - Use consistent relative paths
const markets = require('../dist/markets'); // Import FIRST

// Individual client imports (optional - if you need them separately)
const meteoraDbcClient = require('../../dist/markets/meteora-dbc/client.js');
const meteoraDlmmClient = require('../../dist/markets/meteora-dlmm/client.js');
const meteoraDammV1Client = require('../../dist/markets/meteora-damm-v1/client.js');
const meteoraDammV2Client = require('../../dist/markets/meteora-damm-v2/client.js');
const orcaWhirlpoolClient = require('../../dist/markets/orca-whirlpool/client.js');
const raydiumCpmmClient = require('../../dist/markets/raydium-cpmm/client.js');
const raydiumClmmClient = require('../../dist/markets/raydium-clmm/client.js');
const raydiumAmmClient = require('../../dist/markets/raydium-amm/client.js');
const sugarClient = require('../../dist/markets/sugar/client.js');

const boopFunClient = require('../../dist/markets/boop-fun/client.js');

// Price function imports

const { getRaydiumClmmPrice } = require('../../dist/markets/raydium-clmm/price.js');
const { getRaydiumCpmmPrice } = require('../../dist/markets/raydium-cpmm/price.js');
const { getMeteoraDlmmPrice } = require('../../dist/markets/meteora-dlmm/price.js');
const { getMeteoraDammV1Price } = require('../../dist/markets/meteora-damm-v1/price.js');
const { getMeteoraDammV2Price } = require('../../dist/markets/meteora-damm-v2/price.js');
const { getMeteoraDbcPrice } = require('../../dist/markets/meteora-dbc/price.js');
const { getOrcaWhirlpoolPrice } = require('../../dist/markets/orca-whirlpool/price.js');
const { getSugarPrice } = require('../../dist/markets/sugar/price.js');
const { getBoopFunPrice } = require('../../dist/markets/boop-fun/price.js');

// ✅ Your own unified quote function
const { getQuoteFixed } = require('../../src/arbitrage/batchFetcher4.js');

// ─────────────────────────────────────────────────────────────────────────────
// SETUP - Define variables BEFORE using them
// ─────────────────────────────────────────────────────────────────────────────

const connection = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');

// Define your constants
const POOL = new PublicKey('7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5');
const MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const WALLET = new PublicKey(process.env.SOLFLARE_KEYPAIR || '11111111111111111111111111111111');

const ONE_SOL = new BN(1_000_000_000);

// Define variables that were missing
const mintAddress = MINT; // Use the defined constant
const wallet = WALLET; // Use the defined constant
const solAmount = 1.0; // Example value
const slippage = 0.01; // 1%
const poolAddress = POOL; // Use the defined constant
const tokenAmount = 1000; // Example value

// ─────────────────────────────────────────────────────────────────────────────
// Helper function to get appropriate client based on pool
// ─────────────────────────────────────────────────────────────────────────────

function getClientForPool(poolAddress) {
    const poolStr = poolAddress.toString();

    // Determine which DEX the pool belongs to
    if (poolStr.includes('DLMM') || poolStr.startsWith('MET')) {
        return require('../../dist/markets/meteora-dlmm/client.js').client;
    } else if (poolStr.includes('WHIRLPOOL') || poolStr.startsWith('ORCA')) {
        return require('../../dist/markets/orca-whirlpool/client.js').client;
    } else if (poolStr.includes('CLMM') || poolStr.startsWith('RAY')) {
        return require('../../dist/markets/raydium-clmm/client.js').client;
    } else if (poolStr.includes('CPMM')) {
        return require('../../dist/markets/raydium-cpmm/client.js').client;
    } else if (poolStr.includes('AMM')) {
        return require('../../dist/markets/raydium-amm/client.js').client;
    }
    throw new Error(`Unknown pool type: ${poolStr}`);
}


// ─────────────────────────────────────────────────────────────────────────────
// Example usage of markets - NOW variables are defined
// ─────────────────────────────────────────────────────────────────────────────

async function exampleMarketCalls() {
    try {
        // Buy instructions examples
        console.log('Testing buy instructions...');

        // These will work now because variables are defined
        const buyResult1 = await markets.METEORA_DAMM_V1.getBuyInstructions({
            mintAddress, wallet, solAmount, slippage, poolAddress
        });
        console.log('METEORA_DAMM_V1 buy instructions:', buyResult1.length);

        const buyResult2 = await markets.ORCA_WHIRLPOOL.getBuyInstructions({
            mintAddress, wallet, solAmount, slippage, poolAddress
        });
        console.log('ORCA_WHIRLPOOL buy instructions:', buyResult2.length);

        // Sell instructions examples
        console.log('Testing sell instructions...');

        const sellResult1 = await markets.METEORA_DLMM.getSellInstructions({
            mintAddress, wallet, tokenAmount, slippage, poolAddress
        });
        console.log('METEORA_DLMM sell instructions:', sellResult1.length);

    } catch (error) {
        console.error('Error in market calls:', error.message);
    }
}

async function getDirectPrice(market, mint) {
    const connection = new Connection('https://api.mainnet-beta.solana.com');

    console.log(`🔍 Getting price for ${market} ${mint}`);

    try {
        const result = await getPriceForMarket(connection, market, mint);

        if (!result) {
            console.log('❌ No price returned');
            return null;
        }

        console.log(`📊 Result:`, result);

        // Convert lamports to SOL price
        if (result.lamportsPerToken) {
            const priceInSOL = result.lamportsPerToken / 1e9;
            const priceInUSD = priceInSOL * 96.48; // Current SOL price

            console.log(`\n💰 Price:`);
            console.log(`   ${priceInSOL.toFixed(9)} SOL per token`);
            console.log(`   $${priceInUSD.toFixed(6)} USD per token`);

            if (result.bondingCurvePercent !== null) {
                console.log(`   Bonding curve: ${result.bondingCurvePercent}%`);
            }

            return { priceInSOL, priceInUSD };
        }

        return result;

    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// For arbitrage, you might want to try all markets
// ─────────────────────────────────────────────────────────────────────────────

async function findBestPrice(mintAddress, amount, isBuy) {
    try {
        const clients = markets.getAllClients();
        const prices = [];

        for (const [name, client] of Object.entries(clients)) {
            try {
                const price = isBuy
                    ? await client.getBuyPrice({ mintAddress, amount })
                    : await client.getSellPrice({ mintAddress, amount });

                prices.push({ dex: name, price });
            } catch (error) {
                console.log(`Failed to get price from ${name}:`, error.message);
            }
        }

        // Return best price
        return prices.length > 0 ? prices.sort((a, b) => b.price - a.price)[0] : null;
    } catch (error) {
        console.error('Error in findBestPrice:', error);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main execution
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    console.log('Starting market tests...');

    // Test example market calls
    await exampleMarketCalls();
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.log('Usage: node priceDirect.js <market> <mint>');
        console.log('Example: node priceDirect.js METEORA_DLMM So11111111111111111111111111111111111111112');
        console.log('Example: node priceDirect.js RAYDIUM_CPMM EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        return;
    }

    const market = args[0];
    const mint = args[1];

    await getDirectPrice(market, mint);

    // Test findBestPrice
    const bestPrice = await findBestPrice(MINT, ONE_SOL, true);
    if (bestPrice) {
        console.log(`Best price found: ${bestPrice.dex} - ${bestPrice.price}`);
    }

    // Test getClientForPool
    try {
        const client = getClientForPool(POOL);
        console.log('Client for pool found:', client.constructor.name);
    } catch (error) {
        console.log('Could not determine client for pool:', error.message);
    }
}

// Only run if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────




module.exports = {
    getClientForPool,
    findBestPrice,
    exampleMarketCalls,
    // Export the markets object if needed
    markets
};

//   node priceDirect.js METEORA_DLMM So11111111111111111111111111111111111111112

/*

cat /Users/qistina/Desktop/dist/markets/@pump-fun/pump-sdk/package.json

# Navigate to pump-sdk directory
cd /node_modules/@pump-fun/pump-sdk
npm install
npm link


*/