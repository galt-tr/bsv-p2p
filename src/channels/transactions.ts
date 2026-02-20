/**
 * Payment Channel Transactions
 * 
 * Builds the BSV transactions needed for payment channels:
 * 1. Funding TX: Creates 2-of-2 multisig output
 * 2. Commitment TX: Spends funding, distributes to both parties
 * 3. Settlement TX: Final cooperative close
 * 
 * Uses nSequence for off-chain replacement ordering.
 * Uses nLockTime for dispute window on force-close.
 */

import { 
  Transaction, 
  PrivateKey, 
  PublicKey, 
  Script,
  Hash,
  P2PKH,
  OpCode
} from '@bsv/sdk'
import { Channel, ChannelConfig, DEFAULT_CHANNEL_CONFIG } from './types.js'

// Maximum nSequence value (final, no replacement)
const SEQUENCE_FINAL = 0xffffffff
// Starting nSequence for commitments (decrements for each update)
const SEQUENCE_START = 0xfffffffe

/**
 * Build a 2-of-2 multisig locking script
 * 
 * Pubkeys are sorted lexicographically for determinism.
 */
export function buildMultisigScript(pubKey1: string, pubKey2: string): Script {
  // Sort pubkeys for deterministic ordering
  const sorted = [pubKey1, pubKey2].sort()
  
  return new Script()
    .writeNumber(2)                          // OP_2
    .writeBuffer(Buffer.from(sorted[0], 'hex'))  // pubkey1
    .writeBuffer(Buffer.from(sorted[1], 'hex'))  // pubkey2
    .writeNumber(2)                          // OP_2
    .writeOpCode(OpCode.OP_CHECKMULTISIG)
}

/**
 * Build unlocking script for 2-of-2 multisig
 */
export function buildMultisigUnlock(sig1: Buffer, sig2: Buffer): Script {
  // Order doesn't matter for CHECKMULTISIG, but we include OP_0 for the bug
  return new Script()
    .writeOpCode(OpCode.OP_0)  // CHECKMULTISIG bug requires extra item
    .writeBuffer(sig1)
    .writeBuffer(sig2)
}

export interface FundingTxParams {
  /** Initiator's public key */
  localPubKey: string
  /** Remote party's public key */
  remotePubKey: string
  /** Amount to lock in channel */
  amountSats: number
  /** UTXOs to spend */
  inputs: Array<{
    txid: string
    vout: number
    script: string
    satoshis: number
  }>
  /** Change address */
  changeAddress: string
  /** Fee rate in sat/byte */
  feeRate?: number
}

/**
 * Build a funding transaction
 * 
 * Creates a 2-of-2 multisig output that both parties control.
 * This TX is NOT broadcast until both parties have signed a refund.
 */
export function buildFundingTx(params: FundingTxParams): Transaction {
  const { localPubKey, remotePubKey, amountSats, inputs, changeAddress, feeRate = 1 } = params
  
  const tx = new Transaction()
  
  // Add inputs
  let totalIn = 0
  for (const input of inputs) {
    tx.addInput({
      sourceTXID: input.txid,
      sourceOutputIndex: input.vout,
      unlockingScript: new Script(), // Will be signed later
      sequence: SEQUENCE_FINAL
    })
    totalIn += input.satoshis
  }
  
  // Create 2-of-2 multisig output
  const multisigScript = buildMultisigScript(localPubKey, remotePubKey)
  tx.addOutput({
    lockingScript: multisigScript,
    satoshis: amountSats
  })
  
  // Calculate fee (rough estimate: 150 bytes per input + 34 per output)
  const estSize = inputs.length * 150 + 2 * 34 + 10
  const fee = estSize * feeRate
  
  // Add change output
  const change = totalIn - amountSats - fee
  if (change > 546) {  // Dust threshold
    const changeScript = new P2PKH().lock(changeAddress)
    tx.addOutput({
      lockingScript: changeScript,
      satoshis: change
    })
  }
  
  return tx
}

export interface CommitmentTxParams {
  /** Funding transaction ID */
  fundingTxId: string
  /** Funding output index */
  fundingVout: number
  /** Total channel capacity */
  capacitySats: number
  /** Commitment sequence (higher = newer) */
  seq: number
  /** Local party's balance */
  localBalanceSats: number
  /** Remote party's balance */
  remoteBalanceSats: number
  /** Local party's pubkey */
  localPubKey: string
  /** Remote party's pubkey */
  remotePubKey: string
  /** Local party's address for their output */
  localAddress: string
  /** Remote party's address for their output */
  remoteAddress: string
  /** nLockTime for force-close (current block + dispute window) */
  lockTime?: number
}

/**
 * Build a commitment transaction
 * 
 * This spends the funding output and pays each party their balance.
 * nSequence decreases with each update (newer commitments replace older).
 * 
 * Important: This TX should NOT be broadcast unless force-closing.
 * For cooperative close, use buildSettlementTx instead.
 */
export function buildCommitmentTx(params: CommitmentTxParams): Transaction {
  const { 
    fundingTxId, 
    fundingVout, 
    capacitySats,
    seq,
    localBalanceSats, 
    remoteBalanceSats,
    localAddress,
    remoteAddress,
    lockTime = 0
  } = params
  
  // Validate balances
  if (localBalanceSats + remoteBalanceSats !== capacitySats) {
    throw new Error(`Balances don't sum to capacity: ${localBalanceSats} + ${remoteBalanceSats} != ${capacitySats}`)
  }
  
  const tx = new Transaction()
  tx.version = 2
  tx.lockTime = lockTime
  
  // nSequence: start high, decrease for each update
  // This ensures newer commitments can replace older ones (BIP 125)
  const nSequence = SEQUENCE_START - seq
  
  // Add funding input
  tx.addInput({
    sourceTXID: fundingTxId,
    sourceOutputIndex: fundingVout,
    unlockingScript: new Script(), // Will be signed by both parties
    sequence: nSequence
  })
  
  // Add outputs for each party (skip if balance is dust)
  if (localBalanceSats > 546) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(localAddress),
      satoshis: localBalanceSats
    })
  }
  
  if (remoteBalanceSats > 546) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(remoteAddress),
      satoshis: remoteBalanceSats
    })
  }
  
  return tx
}

/**
 * Build a settlement transaction (cooperative close)
 * 
 * Same as commitment TX but with SEQUENCE_FINAL (no replacement).
 * Both parties sign and broadcast this to close the channel.
 */
export function buildSettlementTx(params: Omit<CommitmentTxParams, 'seq'>): Transaction {
  const tx = buildCommitmentTx({ ...params, seq: 0 })
  
  // Set final sequence (not replaceable)
  tx.inputs[0].sequence = SEQUENCE_FINAL
  tx.lockTime = 0
  
  return tx
}

/**
 * Create signature for a commitment transaction
 */
export function signCommitment(
  tx: Transaction,
  fundingScript: Script,
  fundingSats: number,
  privateKey: PrivateKey,
  inputIndex: number = 0
): Buffer {
  // For 2-of-2 multisig, we sign with SIGHASH_ALL
  const sigHashType = 0x41 // SIGHASH_ALL | SIGHASH_FORKID
  
  const sig = tx.sign(
    privateKey,
    sigHashType,
    inputIndex,
    fundingScript,
    BigInt(fundingSats)
  )
  
  return Buffer.from(sig.toChecksigFormat())
}

/**
 * Verify a commitment signature
 */
export function verifyCommitmentSig(
  tx: Transaction,
  fundingScript: Script,
  fundingSats: number,
  signature: Buffer,
  publicKey: PublicKey,
  inputIndex: number = 0
): boolean {
  const sigHashType = 0x41
  
  // Compute the sighash
  const preimage = tx.signaturePreimage(
    sigHashType,
    inputIndex,
    fundingScript,
    BigInt(fundingSats)
  )
  
  const hash = Hash.sha256(preimage)
  
  // Verify signature (strip sighash byte)
  const sigWithoutHashType = signature.slice(0, -1)
  
  try {
    return publicKey.verify(
      Array.from(hash),
      // @ts-ignore - SDK types
      { r: sigWithoutHashType.slice(0, 32), s: sigWithoutHashType.slice(32) }
    )
  } catch {
    return false
  }
}
