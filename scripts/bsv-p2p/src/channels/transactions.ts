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

import {
  PrivateKey,
  PublicKey,
  Transaction,
  Script,
  P2PKH,
  Hash,
  BigNumber,
  Signature,
  TransactionSignature
} from '@bsv/sdk'

// Constants for nSequence
export const SEQUENCE_FINAL = 0xFFFFFFFF
export const SEQUENCE_LOCKTIME_DISABLE_FLAG = (1 << 31)  // Bit 31 disables nLockTime
export const SEQUENCE_MAX_REPLACEABLE = 0xFFFFFFFE  // Max value that still allows replacement

/**
 * Create a 2-of-2 multisig locking script
 */
export function createMultisigLockingScript(pubKeyA: string, pubKeyB: string): Script {
  // Sort pubkeys lexicographically for deterministic ordering
  const keys = [pubKeyA, pubKeyB].sort()
  
  // OP_2 <pubkey1> <pubkey2> OP_2 OP_CHECKMULTISIG
  return new Script()
    .writeOpCode(0x52)  // OP_2
    .writeBin(Array.from(Buffer.from(keys[0], 'hex')))
    .writeBin(Array.from(Buffer.from(keys[1], 'hex')))
    .writeOpCode(0x52)  // OP_2
    .writeOpCode(0xae)  // OP_CHECKMULTISIG
}

/**
 * Create the unlocking script for a 2-of-2 multisig
 */
export function createMultisigUnlockingScript(sigA: string, sigB: string): Script {
  // OP_0 <sig1> <sig2> (OP_0 is dummy for CHECKMULTISIG bug)
  // Signatures must be in same order as pubkeys in locking script
  return new Script()
    .writeOpCode(0x00)  // OP_0 (dummy)
    .writeBin(Array.from(Buffer.from(sigA, 'hex')))
    .writeBin(Array.from(Buffer.from(sigB, 'hex')))
}

/**
 * Parameters for creating a funding transaction
 */
export interface FundingTxParams {
  /** UTXOs to spend for funding */
  inputs: Array<{
    txid: string
    vout: number
    satoshis: number
    scriptPubKey: string
    privateKey: PrivateKey
  }>
  /** Public key of party A (hex) */
  pubKeyA: string
  /** Public key of party B (hex) */
  pubKeyB: string
  /** Total channel capacity in satoshis */
  capacity: number
  /** Fee rate in satoshis per byte */
  feeRate?: number
}

/**
 * Create a funding transaction for the payment channel
 * This creates a 2-of-2 multisig output that both parties must sign to spend
 */
export function createFundingTransaction(params: FundingTxParams): Transaction {
  const { inputs, pubKeyA, pubKeyB, capacity, feeRate = 1 } = params
  
  const tx = new Transaction()
  
  // Add inputs
  let totalInput = 0
  for (const input of inputs) {
    tx.addInput({
      sourceTransaction: undefined,
      sourceTXID: input.txid,
      sourceOutputIndex: input.vout,
      sequence: SEQUENCE_FINAL
    })
    totalInput += input.satoshis
  }
  
  // Create multisig locking script
  const lockingScript = createMultisigLockingScript(pubKeyA, pubKeyB)
  
  // Add channel output
  tx.addOutput({
    lockingScript,
    satoshis: capacity
  })
  
  // Calculate fee and add change output if needed
  const estimatedSize = tx.toBinary().length + (inputs.length * 107)  // ~107 bytes per P2PKH sig
  const fee = Math.ceil(estimatedSize * feeRate)
  const change = totalInput - capacity - fee
  
  if (change < 0) {
    throw new Error(`Insufficient funds: need ${capacity + fee}, have ${totalInput}`)
  }
  
  if (change > 546) {  // Dust threshold
    // Add change output (would need change address in real implementation)
    // For now, we'll just absorb small change into fee
  }
  
  // Sign inputs
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]
    tx.inputs[i].unlockingScriptTemplate = new P2PKH().unlock(input.privateKey)
  }
  
  return tx
}

/**
 * Parameters for creating a commitment transaction
 */
export interface CommitmentTxParams {
  /** Funding transaction ID */
  fundingTxId: string
  /** Funding output index */
  fundingVout: number
  /** Funding amount (channel capacity) */
  fundingAmount: number
  /** Public key of party A */
  pubKeyA: string
  /** Public key of party B */
  pubKeyB: string
  /** Address of party A for their output */
  addressA: string
  /** Address of party B for their output */
  addressB: string
  /** Balance for party A */
  balanceA: number
  /** Balance for party B */
  balanceB: number
  /** Sequence number (lower = newer, can replace higher) */
  sequenceNumber: number
  /** nLockTime for the transaction */
  nLockTime: number
}

/**
 * Create a commitment transaction
 * This is the transaction that distributes channel funds to both parties
 * Uses nSequence for replacement and nLockTime for dispute window
 */
export function createCommitmentTransaction(params: CommitmentTxParams): Transaction {
  const {
    fundingTxId,
    fundingVout,
    fundingAmount,
    pubKeyA,
    pubKeyB,
    addressA,
    addressB,
    balanceA,
    balanceB,
    sequenceNumber,
    nLockTime
  } = params
  
  // Validate balances
  if (balanceA + balanceB > fundingAmount) {
    throw new Error('Balances exceed funding amount')
  }
  
  const tx = new Transaction()
  tx.version = 2
  tx.lockTime = nLockTime
  
  // Input spending the funding output
  // Use sequenceNumber for RBF-style replacement (lower sequence = newer)
  // We invert so higher logical sequence = lower nSequence
  const nSequence = SEQUENCE_MAX_REPLACEABLE - sequenceNumber
  
  tx.addInput({
    sourceTransaction: undefined,
    sourceTXID: fundingTxId,
    sourceOutputIndex: fundingVout,
    sequence: nSequence
  })
  
  // Calculate fee (simple estimate)
  const fee = 500  // ~500 sats for a 2-in-2-out tx
  const totalOut = balanceA + balanceB - fee
  
  // Distribute fee proportionally
  const feeA = balanceA > 0 && balanceB > 0 
    ? Math.floor(fee * balanceA / (balanceA + balanceB))
    : (balanceA > 0 ? fee : 0)
  const feeB = fee - feeA
  
  // Build outputs array and sort by address for deterministic ordering
  // This ensures both parties build identical transactions
  const outputs: Array<{ address: string; satoshis: number }> = []
  
  if (balanceA - feeA > 546) {
    outputs.push({ address: addressA, satoshis: balanceA - feeA })
  }
  
  if (balanceB - feeB > 546) {
    outputs.push({ address: addressB, satoshis: balanceB - feeB })
  }
  
  // Sort by address lexicographically for determinism
  outputs.sort((a, b) => a.address.localeCompare(b.address))
  
  // Add sorted outputs to transaction
  for (const out of outputs) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(out.address),
      satoshis: out.satoshis
    })
  }
  
  return tx
}

/**
 * Sign a commitment transaction
 * Returns the signature that can be sent to the counterparty
 */
export function signCommitmentTransaction(
  tx: Transaction,
  privateKey: PrivateKey,
  fundingScript: Script,
  fundingAmount: number
): string {
  const scope = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
  
  // Get the sighash preimage
  const preimage = TransactionSignature.format({
    sourceTXID: tx.inputs[0].sourceTXID!,
    sourceOutputIndex: tx.inputs[0].sourceOutputIndex,
    sourceSatoshis: fundingAmount,
    transactionVersion: tx.version,
    otherInputs: [],  // Only one input
    outputs: tx.outputs,
    inputIndex: 0,
    subscript: fundingScript,
    inputSequence: tx.inputs[0].sequence!,
    lockTime: tx.lockTime,
    scope
  })
  
  // Hash the preimage
  const hash = Hash.hash256(preimage)
  
  // Sign with private key
  const sig = privateKey.sign(hash)
  
  // Create TransactionSignature with scope
  const txSig = new TransactionSignature(sig.r, sig.s, scope)
  
  // Return in checksig format (DER + sighash byte)
  return Buffer.from(txSig.toChecksigFormat()).toString('hex')
}

/**
 * Create a settlement transaction for cooperative close
 * This is like a commitment tx but with SEQUENCE_FINAL (no replacement possible)
 */
export function createSettlementTransaction(params: Omit<CommitmentTxParams, 'sequenceNumber'>): Transaction {
  const tx = createCommitmentTransaction({
    ...params,
    sequenceNumber: 0  // Will be converted to SEQUENCE_FINAL
  })
  
  // Override to use final sequence (no replacement)
  tx.inputs[0].sequence = SEQUENCE_FINAL
  
  // Settlement can be broadcast immediately (no locktime needed)
  tx.lockTime = 0
  
  return tx
}

/**
 * Verify a signature on a commitment transaction
 */
export function verifyCommitmentSignature(
  tx: Transaction,
  signature: string,
  publicKey: string,
  fundingScript: Script,
  fundingAmount: number
): boolean {
  try {
    const sigBytes = Array.from(Buffer.from(signature, 'hex'))
    const txSig = TransactionSignature.fromChecksigFormat(sigBytes)
    const scope = txSig.scope
    
    // Get the sighash preimage
    const preimage = TransactionSignature.format({
      sourceTXID: tx.inputs[0].sourceTXID!,
      sourceOutputIndex: tx.inputs[0].sourceOutputIndex,
      sourceSatoshis: fundingAmount,
      transactionVersion: tx.version,
      otherInputs: [],
      outputs: tx.outputs,
      inputIndex: 0,
      subscript: fundingScript,
      inputSequence: tx.inputs[0].sequence!,
      lockTime: tx.lockTime,
      scope
    })
    
    // Hash the preimage
    const hash = Hash.hash256(preimage)
    
    // Verify with public key
    const pubKey = PublicKey.fromString(publicKey)
    return pubKey.verify(hash, txSig)
  } catch (e) {
    console.error('Signature verification failed:', e)
    return false
  }
}

/**
 * Get the commitment sighash for a transaction
 * Used for creating signatures
 */
export function getCommitmentSighash(
  tx: Transaction,
  fundingScript: Script,
  fundingAmount: number
): number[] {
  const scope = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
  
  const preimage = TransactionSignature.format({
    sourceTXID: tx.inputs[0].sourceTXID!,
    sourceOutputIndex: tx.inputs[0].sourceOutputIndex,
    sourceSatoshis: fundingAmount,
    transactionVersion: tx.version,
    otherInputs: [],
    outputs: tx.outputs,
    inputIndex: 0,
    subscript: fundingScript,
    inputSequence: tx.inputs[0].sequence!,
    lockTime: tx.lockTime,
    scope
  })
  
  return Hash.hash256(preimage)
}
