// test-rpc.js
const { Connection, PublicKey } = require('@solana/web3.js');

async function testRPC() {
    const RPC_URL = process.env.RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=41e3524e-1e5a-480a-9d18-bab84c198869';

    console.log('Testing RPC:', RPC_URL.replace(/\?api-key=.*/, '?api-key=***'));

    const connection = new Connection(RPC_URL, 'confirmed');

    try {
        // Test 1: Get version
        const version = await connection.getVersion();
        console.log('✅ RPC Version:', version);

        // Test 2: Get slot
        const slot = await connection.getSlot();
        console.log('✅ Current slot:', slot);

        // Test 3: Get balance of a known account
        const solanaTokenAccount = new PublicKey('So11111111111111111111111111111111111111112');
        const balance = await connection.getBalance(solanaTokenAccount);
        console.log('✅ SOL mint account exists, balance:', balance);

        // Test 4: Get recent performance
        const perf = await connection.getRecentPerformanceSamples(1);
        console.log('✅ Performance samples:', perf.length);

        // Test 5: Check if RPC has specific features
        const genesisHash = await connection.getGenesisHash();
        console.log('✅ Genesis hash:', genesisHash.slice(0, 16) + '...');

        return true;

    } catch (error) {
        console.error('❌ RPC Test failed:', error.message);
        return false;
    }
}

// Also test with a different RPC
async function testAlternativeRPCs() {
    const rpcs = [
        'https://api.mainnet-beta.solana.com',
        'https://solana-mainnet.rpc.extrnode.com',
        'https://rpc.ankr.com/solana',
        'https://solana-api.projectserum.com'
    ];

    console.log('\n🔍 Testing alternative RPCs...');

    for (const rpc of rpcs) {
        try {
            const connection = new Connection(rpc, 'confirmed');
            const slot = await connection.getSlot();
            console.log(`  ${rpc.split('/')[2]}: ✅ Slot ${slot}`);
        } catch (error) {
            console.log(`  ${rpc.split('/')[2]}: ❌ ${error.message}`);
        }
    }
}

testRPC().then(success => {
    if (!success) {
        testAlternativeRPCs();
    }
});

// In your main function, replace the connection creation with:


/*

# 1. Test your RPC
node diagnostic/test-rpc.js

# 2. Check pool health (create a new file with the health check code)
node diagnostic/pool-health-check.js pools.json

# 3. Run with filtered pools
node src/arbitrage/logQuote.js pools.json --filtered

*/