/**
 * BSV Transaction Creation for Payment Channels
 *
 * Implements the transaction structures needed for payment channels:
 * - Funding Transaction: 2-of-2 multisig output
 * - Commitment Transaction: Spends funding, distributes to both parties
 * - Settlement Transaction: Final cooperative close
 *
 * Based on BRC research and nLockTime/nSequence semantics.
 */
import { PrivateKey, Transaction, Script } from '@bsv/sdk';
export declare const SEQUENCE_FINAL = 4294967295;
export declare const SEQUENCE_LOCKTIME_DISABLE_FLAG: number;
export declare const SEQUENCE_MAX_REPLACEABLE = 4294967294;
/**
 * Create a 2-of-2 multisig locking script
 */
export declare function createMultisigLockingScript(pubKeyA: string, pubKeyB: string): Script;
/**
 * Create the unlocking script for a 2-of-2 multisig
 */
export declare function createMultisigUnlockingScript(sigA: string, sigB: string): Script;
/**
 * Parameters for creating a funding transaction
 */
export interface FundingTxParams {
    /** UTXOs to spend for funding */
    inputs: Array<{
        txid: string;
        vout: number;
        satoshis: number;
        scriptPubKey: string;
        privateKey: PrivateKey;
    }>;
    /** Public key of party A (hex) */
    pubKeyA: string;
    /** Public key of party B (hex) */
    pubKeyB: string;
    /** Total channel capacity in satoshis */
    capacity: number;
    /** Fee rate in satoshis per byte */
    feeRate?: number;
}
/**
 * Create a funding transaction for the payment channel
 * This creates a 2-of-2 multisig output that both parties must sign to spend
 */
export declare function createFundingTransaction(params: FundingTxParams): Transaction;
/**
 * Parameters for creating a commitment transaction
 */
export interface CommitmentTxParams {
    /** Funding transaction ID */
    fundingTxId: string;
    /** Funding output index */
    fundingVout: number;
    /** Funding amount (channel capacity) */
    fundingAmount: number;
    /** Public key of party A */
    pubKeyA: string;
    /** Public key of party B */
    pubKeyB: string;
    /** Address of party A for their output */
    addressA: string;
    /** Address of party B for their output */
    addressB: string;
    /** Balance for party A */
    balanceA: number;
    /** Balance for party B */
    balanceB: number;
    /** Sequence number (lower = newer, can replace higher) */
    sequenceNumber: number;
    /** nLockTime for the transaction */
    nLockTime: number;
}
/**
 * Create a commitment transaction
 * This is the transaction that distributes channel funds to both parties
 * Uses nSequence for replacement and nLockTime for dispute window
 */
export declare function createCommitmentTransaction(params: CommitmentTxParams): Transaction;
/**
 * Sign a commitment transaction
 * Returns the signature that can be sent to the counterparty
 */
export declare function signCommitmentTransaction(tx: Transaction, privateKey: PrivateKey, fundingScript: Script, fundingAmount: number): string;
/**
 * Create a settlement transaction for cooperative close
 * This is like a commitment tx but with SEQUENCE_FINAL (no replacement possible)
 */
export declare function createSettlementTransaction(params: Omit<CommitmentTxParams, 'sequenceNumber'>): Transaction;
/**
 * Verify a signature on a commitment transaction
 */
export declare function verifyCommitmentSignature(tx: Transaction, signature: string, publicKey: string, fundingScript: Script, fundingAmount: number): boolean;
/**
 * Calculate the sighash for a commitment transaction
 * Used for creating signatures
 */
export declare function getCommitmentSighash(tx: Transaction, fundingScript: Script, fundingAmount: number): Buffer;
