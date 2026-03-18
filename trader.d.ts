import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { PriceUnit } from './helpers/price';
export declare class SolanaTrade {
    private readonly connection;
    constructor(rpcUrl?: string);
    price(params: {
        market: string;
        mint: PublicKey | string;
        unit?: PriceUnit;
    }): Promise<{
        price: number;
        bondingCurvePercent: number | null;
    }>;
    buy(params: {
        market: string;
        wallet: Keypair;
        mint: PublicKey | string;
        amount: number;
        slippage: number;
        priorityFeeSol?: number;
        tipAmountSol?: number;
        poolAddress?: PublicKey | string;
        send?: boolean;
        sender?: 'ASTRALANE' | 'NOZOMI' | 'JITO';
        antimev?: boolean;
        region?: string;
        skipSimulation?: boolean;
        skipConfirmation?: boolean;
        additionalInstructions?: TransactionInstruction[];
    }): Promise<string | Transaction>;
    sell(params: {
        market: string;
        wallet: Keypair;
        mint: PublicKey | string;
        amount: number;
        slippage: number;
        priorityFeeSol?: number;
        tipAmountSol?: number;
        poolAddress?: PublicKey | string;
        send?: boolean;
        sender?: 'ASTRALANE' | 'NOZOMI' | 'JITO';
        antimev?: boolean;
        region?: string;
        skipSimulation?: boolean;
        skipConfirmation?: boolean;
        additionalInstructions?: TransactionInstruction[];
    }): Promise<string | Transaction>;
    private trade;
    private normalizeMint;
    private normalizeSlippage;
    private normalizePoolAddress;
    private chooseProvider;
    private chooseRegion;
    private computeProviderTip;
}
//# sourceMappingURL=trader.d.ts.map