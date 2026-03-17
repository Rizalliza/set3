// testPriceFunctions.js
const { Connection, PublicKey } = require('@solana/web3.js');

// Test each price function
async function testPriceFunctions() {
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

    console.log('🧪 Testing price functions...\n');

    // Test METEORA_DLMM
    try {
        const { getMeteoraDlmmPrice } = require('./dist/markets/meteora-dlmm/price.js');
        console.log('🔍 Testing METEORA_DLMM price for USDC:');
        const result = await getMeteoraDlmmPrice(connection, USDC_MINT);
        console.log('   Result:', result);
        if (result && result.lamportsPerToken) {
            const USDCperSOL = 1e9 / result.lamportsPerToken;
            console.log(`   SOL price: $${USDCperSOL.toFixed(2)}`);
        }
    } catch (error) {
        console.log('   ❌ Error:', error.message);
    }

    console.log('\n---\n');

    // Test RAYDIUM_CPMM
    try {
        const { getRaydiumCpmmPrice } = require('./dist/markets/raydium-cpmm/price.js');
        console.log('🔍 Testing RAYDIUM_CPMM price for USDC:');
        const result = await getRaydiumCpmmPrice(connection, USDC_MINT);
        console.log('   Result:', result);
        if (result && result.lamportsPerToken) {
            const USDCperSOL = 1e9 / result.lamportsPerToken;
            console.log(`   SOL price: $${USDCperSOL.toFixed(2)}`);
        }
    } catch (error) {
        console.log('   ❌ Error:', error.message);
    }
}

testPriceFunctions();

//. node testPrice.js

//. node priceDirect.js

//. node priceSOLUSD.js
