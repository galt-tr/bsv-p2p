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
import { PublicKey, Transaction, Script, P2PKH, Hash, BigNumber, Signature, TransactionSignature } from '@bsv/sdk';
// Constants for nSequence
export const SEQUENCE_FINAL = 0xFFFFFFFF;
export const SEQUENCE_LOCKTIME_DISABLE_FLAG = (1 << 31); // Bit 31 disables nLockTime
export const SEQUENCE_MAX_REPLACEABLE = 0xFFFFFFFE; // Max value that still allows replacement
/**
 * Create a 2-of-2 multisig locking script
 */
export function createMultisigLockingScript(pubKeyA, pubKeyB) {
    // Sort pubkeys lexicographically for deterministic ordering
    const keys = [pubKeyA, pubKeyB].sort();
    // OP_2 <pubkey1> <pubkey2> OP_2 OP_CHECKMULTISIG
    return new Script()
        .writeOpCode(0x52) // OP_2
        .writeBin(Buffer.from(keys[0], 'hex'))
        .writeBin(Buffer.from(keys[1], 'hex'))
        .writeOpCode(0x52) // OP_2
        .writeOpCode(0xae); // OP_CHECKMULTISIG
}
/**
 * Create the unlocking script for a 2-of-2 multisig
 */
export function createMultisigUnlockingScript(sigA, sigB) {
    // OP_0 <sig1> <sig2> (OP_0 is dummy for CHECKMULTISIG bug)
    // Signatures must be in same order as pubkeys in locking script
    return new Script()
        .writeOpCode(0x00) // OP_0 (dummy)
        .writeBin(Buffer.from(sigA, 'hex'))
        .writeBin(Buffer.from(sigB, 'hex'));
}
/**
 * Create a funding transaction for the payment channel
 * This creates a 2-of-2 multisig output that both parties must sign to spend
 */
export function createFundingTransaction(params) {
    const { inputs, pubKeyA, pubKeyB, capacity, feeRate = 1 } = params;
    const tx = new Transaction();
    // Add inputs
    let totalInput = 0;
    for (const input of inputs) {
        tx.addInput({
            sourceTransaction: undefined,
            sourceTXID: input.txid,
            sourceOutputIndex: input.vout,
            sequence: SEQUENCE_FINAL
        });
        totalInput += input.satoshis;
    }
    // Create multisig locking script
    const lockingScript = createMultisigLockingScript(pubKeyA, pubKeyB);
    // Add channel output
    tx.addOutput({
        lockingScript,
        satoshis: capacity
    });
    // Calculate fee and add change output if needed
    const estimatedSize = tx.toBinary().length + (inputs.length * 107); // ~107 bytes per P2PKH sig
    const fee = Math.ceil(estimatedSize * feeRate);
    const change = totalInput - capacity - fee;
    if (change < 0) {
        throw new Error(`Insufficient funds: need ${capacity + fee}, have ${totalInput}`);
    }
    if (change > 546) { // Dust threshold
        // Add change output (would need change address in real implementation)
        // For now, we'll just absorb small change into fee
    }
    // Sign inputs
    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        tx.inputs[i].unlockingScriptTemplate = new P2PKH().unlock(input.privateKey);
    }
    tx.sign();
    return tx;
}
/**
 * Create a commitment transaction
 * This is the transaction that distributes channel funds to both parties
 * Uses nSequence for replacement and nLockTime for dispute window
 */
export function createCommitmentTransaction(params) {
    const { fundingTxId, fundingVout, fundingAmount, pubKeyA, pubKeyB, addressA, addressB, balanceA, balanceB, sequenceNumber, nLockTime } = params;
    // Validate balances
    if (balanceA + balanceB > fundingAmount) {
        throw new Error('Balances exceed funding amount');
    }
    const tx = new Transaction();
    tx.version = 2;
    tx.nLockTime = nLockTime;
    // Input spending the funding output
    // Use sequenceNumber for RBF-style replacement (lower sequence = newer)
    // We invert so higher logical sequence = lower nSequence
    const nSequence = SEQUENCE_MAX_REPLACEABLE - sequenceNumber;
    tx.addInput({
        sourceTransaction: undefined,
        sourceTXID: fundingTxId,
        sourceOutputIndex: fundingVout,
        sequence: nSequence
    });
    // Calculate fee (simple estimate)
    const fee = 500; // ~500 sats for a 2-in-2-out tx
    const totalOut = balanceA + balanceB - fee;
    // Distribute fee proportionally
    const feeA = Math.floor(fee * balanceA / (balanceA + balanceB));
    const feeB = fee - feeA;
    // Add outputs for both parties (if balance > dust)
    if (balanceA - feeA > 546) {
        tx.addOutput({
            lockingScript: new P2PKH().lock(addressA),
            satoshis: balanceA - feeA
        });
    }
    if (balanceB - feeB > 546) {
        tx.addOutput({
            lockingScript: new P2PKH().lock(addressB),
            satoshis: balanceB - feeB
        });
    }
    return tx;
}
/**
 * Sign a commitment transaction
 * Returns the signature that can be sent to the counterparty
 */
export function signCommitmentTransaction(tx, privateKey, fundingScript, fundingAmount) {
    // Create signature for input 0 (the funding input)
    const sigHashType = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID;
    const preimage = tx.signaturePreimage(0, // input index
    fundingScript, BigNumber.fromNumber(fundingAmount), sigHashType);
    const hash = Hash.sha256(preimage);
    const sig = privateKey.sign(hash);
    // Append sighash type
    const sigWithType = Buffer.concat([
        sig.toDER(),
        Buffer.from([sigHashType])
    ]);
    return sigWithType.toString('hex');
}
/**
 * Create a settlement transaction for cooperative close
 * This is like a commitment tx but with SEQUENCE_FINAL (no replacement possible)
 */
export function createSettlementTransaction(params) {
    const tx = createCommitmentTransaction({
        ...params,
        sequenceNumber: 0 // Will be converted to SEQUENCE_FINAL
    });
    // Override to use final sequence (no replacement)
    tx.inputs[0].sequence = SEQUENCE_FINAL;
    // Settlement can be broadcast immediately (no locktime needed)
    tx.nLockTime = 0;
    return tx;
}
/**
 * Verify a signature on a commitment transaction
 */
export function verifyCommitmentSignature(tx, signature, publicKey, fundingScript, fundingAmount) {
    try {
        const sigBuffer = Buffer.from(signature, 'hex');
        const sigHashType = sigBuffer[sigBuffer.length - 1];
        const sigDER = sigBuffer.slice(0, -1);
        const preimage = tx.signaturePreimage(0, fundingScript, BigNumber.fromNumber(fundingAmount), sigHashType);
        const hash = Hash.sha256(preimage);
        const pubKey = PublicKey.fromString(publicKey);
        const sig = Signature.fromDER(sigDER);
        return pubKey.verify(hash, sig);
    }
    catch {
        return false;
    }
}
/**
 * Calculate the sighash for a commitment transaction
 * Used for creating signatures
 */
export function getCommitmentSighash(tx, fundingScript, fundingAmount) {
    const sigHashType = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID;
    const preimage = tx.signaturePreimage(0, fundingScript, BigNumber.fromNumber(fundingAmount), sigHashType);
    return Hash.sha256(preimage);
}
