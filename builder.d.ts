import { Transaction } from '@solana/web3.js';
import { BuildTransactionParams } from './interfaces/transaction-builder';
/**
 * Builds a Transaction with compute budget (priority fees), optional tip, and market buy/sell instructions.
 * Does not send the transaction.
 */
export declare function buildTransaction(params: BuildTransactionParams): Promise<Transaction>;
//# sourceMappingURL=builder.d.ts.map