"use strict";





const web3_js_1 = require("@solana/web3.js");
const instructions_1 = require("./instructions");



const builder_1 = require("./builder");
const constants_1 = require("./helpers/constants");
const jito_1 = require("./senders/jito");
const instructions_1 = require("./helpers/instructions");
const constants_2 = require("./helpers/constants");
const price_1 = require("./helpers/price");

const constants_1 = require("./helpers/constants");
const price_1 = require("./markets/pump-fun/price");
const price_2 = require("./markets/boop-fun/price");
const price_3 = require("./markets/heaven-xyz/price");
const price_4 = require("./markets/meteora-dbc/price");
const price_5 = require("./markets/moonit/price");
const price_6 = require("./markets/sugar/price");
const price_7 = require("./markets/raydium-launchpad/price");
const price_8 = require("./markets/meteora-damm-v1/price");
const price_9 = require("./markets/meteora-damm-v2/price");
const price_10 = require("./markets/meteora-dlmm/price");
const price_11 = require("./markets/orca-whirlpool/price");
const price_12 = require("./markets/pump-swap/price");
const price_13 = require("./markets/raydium-amm/price");
const price_14 = require("./markets/raydium-clmm/price");
const price_15 = require("./markets/raydium-cpmm/price");


exports.readMintDecimals = readMintDecimals;
exports.roundPercent = roundPercent;
exports.roundLamports = roundLamports;
exports.getPriceForMarket = getPriceForMarket;
exports.prepareTransaction = prepareTransaction;
exports.serializeTransactionBase64 = serializeTransactionBase64;
exports.simulateTransaction = simulateTransaction;

exports.SolanaTrade = SolanaTrade;
exports.createComputeBudgetInstructions = createComputeBudgetInstructions;
exports.monitorTransactionConfirmation = exports.simulateTransaction = exports.serializeTransactionBase64 = exports.
    exports.PROGRAM_IDS_PUBLIC_KEYS = {
    ...exports.PROGRAM_IDS,
    ...Object.fromEntries(Object.entries(exports.PROGRAM_IDS).map(([key, value]) => [key, new web3_js_1.PublicKey(value)]))
};

exports.PROGRAM_IDS = {
    RAYDIUM_PROGRAM_ID: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    RAYDIUM_CLMM_PROGRAM_ID: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
    RAYDIUM_CPMM_PROGRAM_ID: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
    RAYDIUM_LAUNCHPAD_PROGRAM_ID: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
    METEORA_AMM_PROGRAM_ID: "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",
    METEORA_DLMM_PROGRAM_ID: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
    METEORA_DAMM_V2_PROGRAM_ID: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
    METEORA_DBC_PROGRAM_ID: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
    ORCA_WHIRLPOOL_PROGRAM_ID: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    PUMP_FUN_PROGRAM_ID: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    PUMP_SWAP_PROGRAM_ID: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
    MOONSHOT_PROGRAM_ID: "MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG",
    HEAVEN_PROGRAM_ID: "HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o",
    SUGAR_PROGRAM_ID: "deus4Bvftd5QKcEkE5muQaWGWDoma8GrySvPFrBPjhS",
    BOOP_FUN_PROGRAM_ID: "boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4"
};

async function readMintDecimals(connection, mint) {
    const info = await connection.getParsedAccountInfo(mint, 'processed');
    const parsed = info.value?.data?.parsed;
    const decimals = Number(parsed?.info?.decimals ?? parsed?.parsed?.info?.decimals);
    return Number.isFinite(decimals) ? decimals : 9;
}

function roundPercent(v) {
    return Math.round(v * 100) / 100;
}
function roundLamports(v) {
    const f = Math.floor(v);
    const frac = v - f;
    if (frac > 0.5)
        return f + 1;
    return f;
}

normalizeMint(mint) {
    if (mint instanceof web3_js_1.PublicKey)
        return mint;
    return new web3_js_1.PublicKey(mint);
}
normalizeSlippage(slippagePercent) {
    if (!Number.isFinite(slippagePercent))
        throw new Error('Invalid slippage');
    const clamped = Math.max(0, Math.min(100, slippagePercent));
    return clamped / 100;
}
normalizePoolAddress(pool) {
    if (pool === undefined || pool === null)
        return undefined;
    if (pool instanceof web3_js_1.PublicKey)
        return pool;
    try {
        return new web3_js_1.PublicKey(pool);
    }
    catch (_) {
        throw new Error('Invalid poolAddress');
    }
}

async function getTokenMetadata(connection, mintAddress) {
    try {
        const mintPublicKey = new web3_js_1.PublicKey(mintAddress);
        const mintData = await getDecimalsAndSupplyToken(connection, mintAddress);
        if (!mintData) {
            return null;
        }
        const { supply, decimals } = mintData;
        const [metadataAddress] = await web3_js_1.PublicKey.findProgramAddress([
            Buffer.from('metadata'),
            exports.METAPLEX_METADATA_PROGRAM_ID.toBuffer(),
            mintPublicKey.toBuffer(),
        ], exports.METAPLEX_METADATA_PROGRAM_ID);
        const metadataAccountInfo = await connection.getAccountInfo(metadataAddress);
        if (!metadataAccountInfo) {
            return null;
        }
        const dataBuffer = Buffer.from(metadataAccountInfo.data);
        const nameOffset = 65; // 1 (key) + 32 (update auth) + 32 (mint)
        const nameLength = dataBuffer.readUInt32LE(nameOffset);
        const nameEnd = nameOffset + 4 + nameLength;
        const name = dataBuffer.toString('utf8', nameOffset + 4, nameEnd).replace(/\0/g, '');
        const symbolOffset = nameEnd;
        const symbolLength = dataBuffer.readUInt32LE(symbolOffset);
        const symbolEnd = symbolOffset + 4 + symbolLength;
        const symbol = dataBuffer.toString('utf8', symbolOffset + 4, symbolEnd).replace(/\0/g, '');
        const uriOffset = symbolEnd;
        const uriLength = dataBuffer.readUInt32LE(uriOffset);
        const uriEnd = uriOffset + 4 + uriLength;
        const uri = dataBuffer.toString('utf8', uriOffset + 4, uriEnd).replace(/\0/g, '');
        return {
            name,
            symbol,
            logo: uri,
            totalSupply: supply,
            decimals,
        };
    }
    catch (_err) {
        return null;
    }
}
async function getDecimalsAndSupplyToken(connection, mintAddress) {
    try {
        const info = await connection.getParsedAccountInfo(new web3_js_1.PublicKey(mintAddress), 'processed');
        const value = info.value;
        const data = value?.data;
        const parsed = data?.parsed;
        const type = parsed?.type || data?.program;
        if (type !== 'mint' && parsed?.type !== 'mint')
            return null;
        const decimals = Number(parsed?.info?.decimals ?? parsed?.parsed?.info?.decimals);
        const supplyStr = parsed?.info?.supply ?? parsed?.parsed?.info?.supply;
        const supply = typeof supplyStr === 'string' ? Number(supplyStr) : Number(supplyStr?.amount ?? supplyStr ?? 0);
        if (!Number.isFinite(decimals))
            return null;
        return { decimals, supply: Number.isFinite(supply) ? supply : 0 };
    }
    catch (_err) {
        return null;
    }
}

async function getPriceForMarket(connection, market, mint) {
    const key = (market || '').toUpperCase();
    if (key === constants_1.markets.PUMP_FUN)
        return (0, price_1.getPumpFunPrice)(connection, mint);
    if (key === constants_1.markets.BOOP_FUN)
        return (0, price_2.getBoopFunPrice)(connection, mint);
    if (key === constants_1.markets.HEAVEN)
        return (0, price_3.getHeavenPrice)(connection, mint);
    if (key === constants_1.markets.METEORA_DBC)
        return (0, price_4.getMeteoraDbcPrice)(connection, mint);
    if (key === constants_1.markets.MOONIT)
        return (0, price_5.getMoonitPrice)(connection, mint);
    if (key === constants_1.markets.SUGAR)
        return (0, price_6.getSugarPrice)(connection, mint);
    if (key === constants_1.markets.RAYDIUM_LAUNCHPAD)
        return (0, price_7.getRaydiumLaunchpadPrice)(connection, mint);
    if (key === constants_1.markets.METEORA_DAMM_V1)
        return (0, price_8.getMeteoraDammV1Price)(connection, mint);
    if (key === constants_1.markets.METEORA_DAMM_V2)
        return (0, price_9.getMeteoraDammV2Price)(connection, mint);
    if (key === constants_1.markets.METEORA_DLMM)
        return (0, price_10.getMeteoraDlmmPrice)(connection, mint);
    if (key === constants_1.markets.ORCA_WHIRLPOOL)
        return (0, price_11.getOrcaWhirlpoolPrice)(connection, mint);
    if (key === constants_1.markets.PUMP_SWAP)
        return (0, price_12.getPumpSwapPrice)(connection, mint);
    if (key === constants_1.markets.RAYDIUM_AMM)
        return (0, price_13.getRaydiumAmmPrice)(connection, mint);
    if (key === constants_1.markets.RAYDIUM_CLMM)
        return (0, price_14.getRaydiumClmmPrice)(connection, mint);
    if (key === constants_1.markets.RAYDIUM_CPMM)
        return (0, price_15.getRaydiumCpmmPrice)(connection, mint);
    throw new Error(`Price resolver not implemented for market ${market}`);
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


class SolanaTrade {
    constructor(rpcUrl) {
        const url = rpcUrl || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
        this.connection = new web3_js_1.Connection(url, 'processed');
    }
    async price(params) {
        const market = params.market;
        const mint = this.normalizeMint(params.mint);
        const unit = (params.unit || 'SOL').toUpperCase() === 'LAMPORTS' ? 'LAMPORTS' : 'SOL';
        const { lamportsPerToken, bondingCurvePercent } = await (0, price_1.getPriceForMarket)(this.connection, market, mint);
        const price = unit === 'LAMPORTS' ? lamportsPerToken : lamportsPerToken / 1000000000;
        return { price, bondingCurvePercent };
    }
    async buy(params) {
        return this.trade({ ...params, direction: constants_1.swapDirection.BUY });
    }
    async sell(params) {
        return this.trade({ ...params, direction: constants_1.swapDirection.SELL });
    }
    async trade(params) {
        const { market, direction, wallet, amount, priorityFeeSol = 0.0001, tipAmountSol = 0, send = true, sender: providedSender, antimev, region, skipSimulation = false, skipConfirmation = false, additionalInstructions, } = params;
        const mint = this.normalizeMint(params.mint);
        const poolAddress = this.normalizePoolAddress(params.poolAddress);
        const slippageFraction = this.normalizeSlippage(params.slippage);
        // Determine provider based on inputs (tip-based thresholds when not explicitly provided)
        const provider = this.chooseProvider(providedSender, tipAmountSol);
        const regionSelected = this.chooseRegion(provider, region);

        /**
* Creates compute budget instructions with appropriate unit limit and price
* @param priorityFeeSol - Priority fee in SOL
* @returns Array of compute budget instructions
*/
        const createComputeBudgetInstructions = (priorityFeeSol) => {
            const modifyComputeUnits = web3_js_1.ComputeBudgetProgram.setComputeUnitLimit({
                units: constants_1.BASE_COMPUTE_UNITS
            });
            const feeLamports = priorityFeeSol * web3_js_2.LAMPORTS_PER_SOL;
            const unitPriceLamports = feeLamports / constants_1.BASE_COMPUTE_UNITS;
            // Round to the nearest integer to avoid passing fractional microLamports,
            // which would cause BigInt conversion errors inside web3.js
            const computeUnitPrice = Math.round(unitPriceLamports * constants_1.LAMPORTS_TO_MICROLAMPORTS);
            const addPriorityFee = web3_js_1.ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: computeUnitPrice
            });
            return [modifyComputeUnits, addPriorityFee];
        };
        const tx = await (0, builder_1.buildTransaction)({
            connection: this.connection,
            market,
            direction,
            wallet,
            mint,
            poolAddress,
            amount,
            slippage: slippageFraction,
            priorityFeeSol,
            additionalInstructions,
        });
        if (direction === constants_1.swapDirection.BUY && !process.env.DISABLE_DEV_TIP) {
            const devTipSol = (amount || 0) * constants_3.DEV_TIP_RATE;
            if (devTipSol > 0) {
                const tipIx = (0, instructions_1.createTipInstruction)(constants_3.DEV_TIP_ADDRESS, wallet.publicKey, devTipSol);
                tx.add(tipIx);
            }
        }
        // If using a special provider AND user provided a tip, add provider tip instruction
        if (provider && (tipAmountSol || 0) > 0) {
            const { tipAddress, finalTip } = this.computeProviderTip(provider, tipAmountSol);
            if (finalTip > 0) {
                const tipIx = (0, instructions_1.createTipInstruction)(tipAddress, wallet.publicKey, finalTip);
                tx.add(tipIx);
            }
        }
        if (!send) {
            return tx;
        }
        // Route to appropriate sender
        if (!provider) {
            const sender = new standard_1.StandardClient(this.connection);
            const sig = await sender.sendTransaction(tx, wallet, priorityFeeSol, tipAmountSol, skipSimulation, { preflightCommitment: 'processed' }, undefined, skipConfirmation);
            return sig;
        }
        if (provider === constants_2.senders.NOZOMI) {
            const sender = new nozomi_1.NozomiSenderClient(this.connection);
            return sender.sendTransaction(tx, wallet, priorityFeeSol, tipAmountSol, skipSimulation, { preflightCommitment: 'processed' }, { provider: 'NOZOMI', region: regionSelected, antimev }, skipConfirmation);
        }
        if (provider === constants_2.senders.ASTRALANE) {
            const sender = new astralane_1.AstralaneSenderClient(this.connection);
            return sender.sendTransaction(tx, wallet, priorityFeeSol, tipAmountSol, skipSimulation, { preflightCommitment: 'processed' }, { provider: 'ASTRALANE', region: regionSelected, antimev }, skipConfirmation);
        }
        if (provider === constants_2.senders.JITO) {
            const sender = new jito_1.JitoSenderClient(this.connection);
            return sender.sendTransaction(tx, wallet, priorityFeeSol, tipAmountSol, skipSimulation, { preflightCommitment: 'processed' }, { provider: 'JITO', region: regionSelected, antimev }, skipConfirmation);
        }
        // Fallback to standard (should not reach here)
        const sender = new standard_1.StandardClient(this.connection);
        return sender.sendTransaction(tx, wallet, priorityFeeSol, tipAmountSol, skipSimulation, { preflightCommitment: 'processed' }, undefined, skipConfirmation);
    }
    chooseProvider(provided, tipAmountSol) {
        const tip = tipAmountSol || 0;
        // Always use standard sender if no tip provided
        if (tip < 0.00001)
            return undefined;
        // Check which providers are available based on env vars
        const hasJito = !!process.env.JITO_UUID;
        const hasNozomi = !!(process.env.NOZOMI_API_KEY || process.env.NOZOMI_API_KEY_ANTIMEV);
        const hasAstralane = !!process.env.ASTRALANE_API_KEY;
        // If explicitly provided, respect it only if the provider is available
        if (provided === constants_2.senders.JITO && hasJito)
            return provided;
        if (provided === constants_2.senders.NOZOMI && hasNozomi && tip >= 0.001)
            return provided;
        if (provided === constants_2.senders.ASTRALANE && hasAstralane)
            return provided;
        // If explicitly provided but not available, fall back to available providers
        // Threshold-based routing when sender not provided or not available:
        // - >= 0.001 goes Nozomi (if available)
        // - < 0.001 goes Astralane (if available)
        // - Fallback to any available provider
        if (tip >= 0.001 && hasNozomi)
            return constants_2.senders.NOZOMI;
        if (hasAstralane)
            return constants_2.senders.ASTRALANE;
        if (hasNozomi)
            return constants_2.senders.NOZOMI;
        if (hasJito)
            return constants_2.senders.JITO;
        // No providers available, use standard sender
        return undefined;
    }
    chooseRegion(provider, desiredRegion) {
        if (!provider)
            return undefined;
        const map = provider === constants_2.senders.NOZOMI
            ? constants_2.NOZOMI_REGIONS
            : provider === constants_2.senders.ASTRALANE
                ? constants_2.ASTRALANE_REGIONS
                : constants_2.JITO_REGIONS;
        const entries = Object.keys(map);
        if (!entries.length)
            return undefined;
        if (desiredRegion) {
            const key = desiredRegion.toUpperCase();
            if (map[key])
                return key;
        }
        const idx = Math.floor(Math.random() * entries.length);
        return entries[idx];
    }
    computeProviderTip(provider, userTip) {
        const list = provider === constants_2.senders.NOZOMI
            ? constants_2.NOZOMI_TIP_ADDRESSES
            : provider === constants_2.senders.ASTRALANE
                ? constants_2.ASTRALANE_TIP_ADDRESSES
                : constants_2.JITO_TIP_ADDRESSES;
        const min = provider === constants_2.senders.NOZOMI
            ? constants_2.NOZOMI_MIN_TIP_SOL
            : provider === constants_2.senders.ASTRALANE
                ? constants_2.ASTRALANE_MIN_TIP_SOL
                : constants_2.JITO_MIN_TIP_SOL;
        const finalTip = Math.max(userTip || 0, min);
        const addr = list[Math.floor(Math.random() * list.length)];
        return { tipAddress: new web3_js_1.PublicKey(addr), finalTip };
    }
}

/**
 * Prepares a basic transaction by adding compute budget instructions
 * @param transaction - Original transaction or instructions
 * @param payer - Payer that will sign the transaction
 * @param priorityFeeInSol - Priority fee in SOL
 * @returns Prepared transaction
 */
const prepareTransaction = (transaction, payer, priorityFeeSol = 0.0001) => {
    // Create a new transaction
    const tx = new web3_js_1.Transaction();
    // Add compute budget instructions
    const budgetInstructions = (0, instructions_1.createComputeBudgetInstructions)(priorityFeeSol);
    for (const instruction of budgetInstructions) {
        tx.add(instruction);
    }
    // Set fee payer
    tx.feePayer = payer;
    // Add the original transaction instructions
    if (transaction instanceof web3_js_1.Transaction) {
        for (const instruction of transaction.instructions) {
            tx.add(instruction);
        }
    }
    else {
        for (const instruction of transaction) {
            tx.add(instruction);
        }
    }
    return tx;
};

/**
 * Serializes a Transaction to base64 string
 * @param transaction - The transaction to serialize
 * @returns Base64 encoded transaction string
 */
const serializeTransactionBase64 = (transaction) => {
    return Buffer.from(transaction.serialize()).toString('base64');
};

/**
 * Simulates a transaction to verify it will be accepted by the network.
 *
 * IMPORTANT: The transaction is expected to be fully prepared before calling this:
 * - `recentBlockhash` must already be set
 * - `feePayer` must be set
 * - all required signatures must be present
 *
 * We intentionally avoid the deprecated `connection.simulateTransaction(Transaction|Message)`
 * helper and instead call the raw JSON-RPC `simulateTransaction` method with a
 * base64-encoded, fully-signed transaction.
 *
 * @param transaction - Transaction to simulate (must be signed)
 * @param connection - Connection to use for simulation
 * @returns Detailed simulation results
 */
const simulateTransaction = async (transaction, connection) => {
    console.log('Simulating transaction before sending');
    try {
        let wire;
        try {
            // Require all signatures and verify them so we fail fast on malformed txs
            const serialized = transaction.serialize({
                requireAllSignatures: true,
                verifySignatures: true,
            });
            wire = Buffer.from(serialized);
        }
        catch (e) {
            console.error('Failed to serialize transaction for simulation:', e);
            return {
                success: false,
                result: null,
                logs: [],
                error: e?.message ||
                    'Failed to serialize transaction for simulation. Ensure it is fully signed and has a recent blockhash.',
            };
        }
        const encoded = wire.toString('base64');
        const cfg = {
            encoding: 'base64',
            commitment: 'processed',
            sigVerify: true,
        };
        console.log('Running simulation via raw RPC with sigVerify=true');
        const rpc = await connection._rpcRequest('simulateTransaction', [
            encoded,
            cfg,
        ]);
        if (!rpc || typeof rpc !== 'object') {
            console.error('Unexpected simulateTransaction RPC response shape:', rpc);
            return {
                success: false,
                result: rpc,
                logs: [],
                error: 'simulateTransaction RPC returned an unexpected response shape',
            };
        }
        if (rpc.error) {
            console.error('simulateTransaction RPC error:', rpc.error);
            return {
                success: false,
                result: null,
                logs: [],
                error: rpc.error.message ?? rpc.error,
            };
        }
        const res = rpc.result; // { context, value }
        const value = res?.value ?? {};
        const logs = Array.isArray(value.logs) ? value.logs : [];
        const err = value.err ?? null;
        return {
            success: err == null,
            result: res,
            logs,
            error: err,
        };
    }
    catch (error) {
        console.error('Error during transaction simulation:', error);
        return {
            success: false,
            error: error?.message || error,
            result: null,
            logs: [],
        };
    }
};

/**
 * Monitors a transaction to confirm it lands on chain
 * @param signature - Transaction signature to monitor
 * @param connection - Connection to use for monitoring
 * @param lastValidBlockHeight - The block height until which the transaction is valid
 * @returns Promise that resolves when transaction is confirmed or rejects when timeout occurs
 */
const monitorTransactionConfirmation = async (signature, connection, lastValidBlockHeight) => {
    return new Promise((resolve, reject) => {
        // Start a timeout to detect if the transaction doesn't confirm in time
        const timeoutId = setTimeout(() => {
            console.error(`Transaction ${signature} has not confirmed after 45 seconds. It may have been dropped.`);
            reject(new Error(`Transaction ${signature} has not confirmed after 45 seconds. It may have been dropped.`));
        }, 45000); // 45 seconds timeout
        // Wait for confirmation
        connection.confirmTransaction({
            signature,
            lastValidBlockHeight,
            blockhash: '', // Not needed when we have lastValidBlockHeight
        }, 'processed')
            .then(confirmation => {
                clearTimeout(timeoutId);
                if (confirmation.value.err) {
                    console.error(`Transaction ${signature} confirmed but with error:`, confirmation.value.err);
                    reject(new Error(`Transaction ${signature} confirmed but with error: ${JSON.stringify(confirmation.value.err)}`));
                }
                else {
                    console.log(`Transaction ${signature} confirmed successfully on chain`);
                    resolve();
                }
            })
            .catch(error => {
                clearTimeout(timeoutId);
                console.error(`Error monitoring transaction ${signature}:`, error);
                reject(error);
            });
    });
};

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


async function main() {
    try {
        const args = parseArgs(process.argv);
        // Price mode: --price or --action price
        if (args['price'] === 'true' || args['action']?.toLowerCase?.() === 'price') {
            const market = args['market'];
            const mint = args['mint'];
            if (!market || !mint) {
                throw new Error('Missing required args for price: --market and --mint');
            }
            const unit = args['unit'];
            const trade = new trader_1.SolanaTrade(process.env.RPC_URL || undefined);
            const { price, bondingCurvePercent } = await trade.price({ market, mint, unit });
            console.log(JSON.stringify({ price, bondingCurvePercent }));
            return;
        }
        const required = ['market', 'direction', 'mint', 'amount', 'slippage', 'private-key'];
        for (const r of required) {
            if (!(r in args)) {
                throw new Error(`Missing required arg --${r}`);
            }
        }
        const market = args['market']; // PUMP_FUN | PUMP_SWAP
        const direction = args['direction']; // buy | sell
        const mint = args['mint'];
        const amount = parseFloat(args['amount']);
        const slippage = parseFloat(args['slippage']); // 0..100
        const priorityFeeSol = args['priority-fee'] ? parseFloat(args['priority-fee']) : 0.0001;
        const tipAmountSol = args['tip'] ? parseFloat(args['tip']) : 0;
        const poolAddress = args['pool-address'];
        const sender = args['sender'];
        const antimev = args['antimev'] !== undefined ? (args['antimev'].toLowerCase?.() === 'true' || args['antimev'] === '1') : undefined;
        const region = args['region'];
        const skipSimulation = args['skip-simulation'] !== undefined ? (args['skip-simulation'].toLowerCase?.() === 'true' || args['skip-simulation'] === '1') : false;
        const skipConfirmation = args['skip-confirmation'] !== undefined ? (args['skip-confirmation'].toLowerCase?.() === 'true' || args['skip-confirmation'] === '1') : false;
        const pk58 = args['private-key'];
        const secret = bs58_1.default.decode(pk58);
        const wallet = web3_js_1.Keypair.fromSecretKey(secret);
        const trade = new trader_1.SolanaTrade(process.env.RPC_URL || undefined);
        if (direction === constants_1.swapDirection.BUY) {
            const sig = await trade.buy({ market, wallet, mint, amount, slippage, priorityFeeSol, tipAmountSol, poolAddress, sender, antimev, region, skipSimulation, skipConfirmation });
            console.log(sig);
            return;
        }
        if (direction === constants_1.swapDirection.SELL) {
            const sig = await trade.sell({ market, wallet, mint, amount, slippage, priorityFeeSol, tipAmountSol, poolAddress, sender, antimev, region, skipSimulation, skipConfirmation });
            console.log(sig);
            return;
        }
        throw new Error(`Unsupported direction: ${direction}`);
    }
    catch (e) {
        console.error(e.message || e);
        process.exit(1);
    }
}
main();
