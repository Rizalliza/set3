"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolanaTrade = void 0;
const web3_js_1 = require("@solana/web3.js");
const builder_1 = require("./builder");
const constants_1 = require("./helpers/constants");
const standard_1 = require("./senders/standard");
const nozomi_1 = require("./senders/nozomi");
const astralane_1 = require("./senders/astralane");
const jito_1 = require("./senders/jito");
const instructions_1 = require("./helpers/instructions");
const constants_2 = require("./helpers/constants");
const constants_3 = require("./helpers/constants");
const price_1 = require("./helpers/price");
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
exports.SolanaTrade = SolanaTrade;
//# sourceMappingURL=trader.js.map