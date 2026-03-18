"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTransaction = buildTransaction;
const web3_js_1 = require("@solana/web3.js");
const instructions_1 = require("./helpers/instructions");
const constants_1 = require("./helpers/constants");
const client_1 = require("./markets/pump-fun/client");
const client_2 = require("./markets/pump-swap/client");
const client_3 = require("./markets/raydium-amm/client");
const client_4 = require("./markets/raydium-clmm/client");
const client_5 = require("./markets/raydium-cpmm/client");
const client_6 = require("./markets/raydium-launchpad/client");
const client_7 = require("./markets/meteora-dlmm/client");
const client_8 = require("./markets/meteora-damm-v1/client");
const client_9 = require("./markets/meteora-damm-v2/client");
const client_10 = require("./markets/meteora-dbc/client");
const client_11 = require("./markets/orca-whirlpool/client");
const client_12 = require("./markets/moonit/client");
const client_13 = require("./markets/heaven-xyz/client");
const client_14 = require("./markets/sugar/client");
const client_15 = require("./markets/boop-fun/client");
/**
 * Builds a Transaction with compute budget (priority fees), optional tip, and market buy/sell instructions.
 * Does not send the transaction.
 */
async function buildTransaction(params) {
    const { connection, market, direction, wallet, mint, amount, slippage, priorityFeeSol = 0.0001, additionalInstructions, } = params;
    if (slippage < 0 || slippage > 1) {
        throw new Error('slippage must be between 0 and 1');
    }
    const tx = new web3_js_1.Transaction();
    // Add compute budget instructions (priority fee)
    const budgetIx = (0, instructions_1.createComputeBudgetInstructions)(priorityFeeSol);
    budgetIx.forEach(ix => tx.add(ix));
    // Market-specific instructions
    const client = createMarketClient(connection, market);
    const invocation = createDirectionInvoker(client, direction);
    const marketInstructions = await invocation({
        mintAddress: mint,
        wallet: wallet.publicKey,
        solAmount: amount,
        tokenAmount: amount,
        slippage,
        poolAddress: params.poolAddress,
    });
    for (const ix of marketInstructions) {
        tx.add(ix);
    }
    // User provided additional instructions (placed immediately after market instructions)
    if (additionalInstructions && additionalInstructions.length > 0) {
        for (const ix of additionalInstructions) {
            tx.add(ix);
        }
    }
    tx.feePayer = wallet.publicKey;
    return tx;
}
function createMarketClient(connection, market) {
    switch (market) {
        case constants_1.markets.PUMP_FUN:
            return new client_1.PumpFunClient(connection);
        case constants_1.markets.PUMP_SWAP:
            return new client_2.PumpSwapClient(connection);
        case constants_1.markets.RAYDIUM_AMM:
            return new client_3.RaydiumAmmClient(connection);
        case constants_1.markets.RAYDIUM_CLMM:
            return new client_4.RaydiumClmmClient(connection);
        case constants_1.markets.RAYDIUM_CPMM:
            return new client_5.RaydiumCpmmClient(connection);
        case constants_1.markets.RAYDIUM_LAUNCHPAD:
            return new client_6.RaydiumLaunchpadClient(connection);
        case constants_1.markets.METEORA_DLMM:
            return new client_7.MeteoraDlmmClient(connection);
        case constants_1.markets.METEORA_DAMM_V1:
            return new client_8.MeteoraDammV1Client(connection);
        case constants_1.markets.METEORA_DAMM_V2:
            return new client_9.MeteoraDammV2Client(connection);
        case constants_1.markets.METEORA_DBC:
            return new client_10.MeteoraDbcClient(connection);
        case constants_1.markets.ORCA_WHIRLPOOL:
            return new client_11.OrcaWhirlpoolClient(connection);
        case constants_1.markets.MOONIT:
            return new client_12.MoonitClient(connection);
        case constants_1.markets.HEAVEN:
            return new client_13.HeavenClient(connection);
        case constants_1.markets.SUGAR:
            return new client_14.SugarClient(connection);
        case constants_1.markets.BOOP_FUN:
            return new client_15.BoopFunClient(connection);
        default:
            throw new Error(`Unsupported market: ${market}`);
    }
}
function createDirectionInvoker(client, direction) {
    if (direction === constants_1.swapDirection.BUY) {
        return async ({ mintAddress, wallet, solAmount, slippage, poolAddress }) => {
            return client.getBuyInstructions({ mintAddress, wallet, solAmount, slippage, poolAddress });
        };
    }
    if (direction === constants_1.swapDirection.SELL) {
        return async ({ mintAddress, wallet, tokenAmount, slippage, poolAddress }) => {
            return client.getSellInstructions({ mintAddress, wallet, tokenAmount, slippage, poolAddress });
        };
    }
    throw new Error(`Unsupported direction: ${direction}`);
}
//# sourceMappingURL=builder.js.map