/**
 * unifiedQuoteEngine.js - Clean Quote Engine Using Working Price Functions
 * 
 * Integrates with your existing dist/helpers/price.js getPriceForMarket()
 * Replaces all the broken quote functions in logQuote.js, batchFetcher4.js, quoteTest.js
 */

'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');

// Import the WORKING price function from your compiled dist folder
const { getPriceForMarket } = require('../dist/helpers/price');

// Token decimals lookup
const TOKEN_DECIMALS = {
    'So11111111111111111111111111111111111111112': 9,  // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6, // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6, // USDT
    'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': 9, // jitoSOL
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 9, // mSOL
    '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': 9, // stSOL
};

function getDecimals(mint) {
    return TOKEN_DECIMALS[mint] || 9;
}

/**
 * SINGLE SOURCE OF TRUTH FOR QUOTES
 * 
 * Uses getPriceForMarket() which internally routes to:
 * - getMeteoraDlmmPrice() for METEORA_DLMM
 * - getOrcaWhirlpoolPrice() for ORCA_WHIRLPOOL
 * - getRaydiumClmmPrice() for RAYDIUM_CLMM
 * - getRaydiumCpmmPrice() for RAYDIUM_CPMM
 * - etc.
 */
async function getQuote(connection, market, poolAddress, inputMint, outputMint, amountIn) {
    try {
        const SOL_MINT = 'So11111111111111111111111111111111111111112';

        // Determine which token to price (the non-SOL one)
        const tokenToPrice = inputMint.toBase58() === SOL_MINT ? outputMint : inputMint;
        const isSOLtoToken = inputMint.toBase58() === SOL_MINT;

        // Get price using the WORKING price function
        const priceResult = await getPriceForMarket(connection, market, tokenToPrice);

        if (!priceResult || !priceResult.lamportsPerToken) {
            return { amountOut: new BN(0), feeBps: 25 };
        }

        const lamportsPerToken = priceResult.lamportsPerToken;

        // Calculate output amount based on direction
        let amountOut;

        if (isSOLtoToken) {
            // Buying token with SOL: amountOut = amountIn / lamportsPerToken
            // Example: 1 SOL (1e9 lamports) / 50000 lamportsPerToken = 20,000 tokens
            const tokensPerLamport = 1 / lamportsPerToken;
            const tokenDecimals = getDecimals(outputMint.toBase58());

            // Scale to token decimals
            const multiplier = Math.pow(10, tokenDecimals);
            amountOut = amountIn.muln(Math.floor(tokensPerLamport * multiplier)).divn(multiplier);

        } else {
            // Selling token for SOL: amountOut = amountIn * lamportsPerToken
            // Example: 20,000 tokens * 50000 lamportsPerToken = 1e9 lamports (1 SOL)
            const tokenDecimals = getDecimals(inputMint.toBase58());
            const multiplier = Math.pow(10, tokenDecimals);

            // Normalize token amount to whole units, apply price, return lamports
            const tokenAmount = amountIn.toNumber() / multiplier;
            amountOut = new BN(Math.floor(tokenAmount * lamportsPerToken));
        }

        // Get fee from market type (these are the actual fees from the DEXes)
        let feeBps = 25; // default
        if (market.includes('METEORA_DLMM')) feeBps = 1;   // Ultra-low fee
        if (market.includes('RAYDIUM_CLMM')) feeBps = 25;  // 0.25%
        if (market.includes('RAYDIUM_CPMM')) feeBps = 25;  // 0.25%
        if (market.includes('ORCA_WHIRLPOOL')) feeBps = 30; // 0.30%
        if (market.includes('RAYDIUM_AMM')) feeBps = 25;   // 0.25%

        return {
            amountOut: amountOut.gt(new BN(0)) ? amountOut : new BN(0),
            feeBps
        };

    } catch (error) {
        console.warn(`Quote failed for ${market}: ${error.message}`);
        return { amountOut: new BN(0), feeBps: 25 };
    }
}

/**
 * Batch quote multiple pools efficiently
 */
async function batchQuote(connection, pools, testAmountLamports) {
    const results = [];

    console.log(`📊 Quoting ${pools.length} pools with unified engine...`);

    for (let i = 0; i < pools.length; i++) {
        const pool = pools[i];

        if (i % 10 === 0) {
            process.stdout.write(`\r  Progress: ${i}/${pools.length}`);
        }

        try {
            const inputMint = new PublicKey(pool.inputMint);
            const outputMint = new PublicKey(pool.outputMint);
            const poolAddress = new PublicKey(pool.address);

            const quote = await getQuote(
                connection,
                pool.market,
                poolAddress,
                inputMint,
                outputMint,
                testAmountLamports
            );

            if (quote.amountOut.gt(new BN(0))) {
                results.push({
                    ...pool,
                    quote
                });
            }

        } catch (error) {
            // Skip failed quotes
        }

        // Rate limiting
        if (i % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    console.log(`\n✅ Got ${results.length} valid quotes`);
    return results;
}

/**
 * Quote a single triangle path (3 legs)
 */
async function quoteTriangle(connection, leg1, leg2, leg3, amountInLamports) {
    try {
        // Leg 1: SOL -> Token X
        const q1 = await getQuote(
            connection,
            leg1.market,
            new PublicKey(leg1.address),
            new PublicKey(leg1.inputMint),
            new PublicKey(leg1.outputMint),
            amountInLamports
        );

        if (!q1 || q1.amountOut.isZero()) return null;

        // Leg 2: Token X -> Token Y
        const q2 = await getQuote(
            connection,
            leg2.market,
            new PublicKey(leg2.address),
            new PublicKey(leg2.inputMint),
            new PublicKey(leg2.outputMint),
            q1.amountOut
        );

        if (!q2 || q2.amountOut.isZero()) return null;

        // Leg 3: Token Y -> SOL
        const q3 = await getQuote(
            connection,
            leg3.market,
            new PublicKey(leg3.address),
            new PublicKey(leg3.inputMint),
            new PublicKey(leg3.outputMint),
            q2.amountOut
        );

        if (!q3 || q3.amountOut.isZero()) return null;

        // Calculate profit
        const profitLamports = q3.amountOut.sub(amountInLamports);
        const profitBps = amountInLamports.isZero()
            ? 0
            : profitLamports.muln(10000).div(amountInLamports).toNumber();

        const totalFees = q1.feeBps + q2.feeBps + q3.feeBps;

        return {
            leg1: { ...leg1, amountOut: q1.amountOut, feeBps: q1.feeBps },
            leg2: { ...leg2, amountOut: q2.amountOut, feeBps: q2.feeBps },
            leg3: { ...leg3, amountOut: q3.amountOut, feeBps: q3.feeBps },
            amountIn: amountInLamports.toString(),
            amountOut: q3.amountOut.toString(),
            profitLamports: profitLamports.toString(),
            profitBps,
            profitSOL: (profitLamports.toNumber() / 1e9).toFixed(6),
            totalFees,
            profitable: profitBps > 0
        };

    } catch (error) {
        console.warn(`Triangle quote failed: ${error.message}`);
        return null;
    }
}

module.exports = {
    getQuote,
    batchQuote,
    quoteTriangle,
    getDecimals
};


//. node unifiedQuoteEngine.js  --market RAYDIUM_CPMM METEORA_DLMM --inputMint So11111111111111111111111111111111111111112 --outputMint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --mint 58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2