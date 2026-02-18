/**
 * 2-of-2 Multisig Script Template for Payment Channels
 * 
 * Uses @bsv/sdk for transaction building and signing.
 */

import {
  PrivateKey,
  PublicKey,
  Transaction,
  TransactionSignature,
  LockingScript,
  UnlockingScript,
  OP,
  Hash,
  P2PKH,
  Signature
} from '@bsv/sdk'

const { sha256 } = Hash

/**
 * Create a 2-of-2 multisig locking script
 * Format: OP_2 <pubkey1> <pubkey2> OP_2 OP_CHECKMULTISIG
 */
export function createMultisigLockingScript(pubKey1: PublicKey, pubKey2: PublicKey): LockingScript {
  const pub1DER = pubKey1.encode(true) // compressed
  const pub2DER = pubKey2.encode(true)
  
  return new LockingScript([
    { op: OP.OP_2 },
    { op: pub1DER.length, data: pub1DER },
    { op: pub2DER.length, data: pub2DER },
    { op: OP.OP_2 },
    { op: OP.OP_CHECKMULTISIG }
  ])
}

/**
 * Create the sighash preimage for a transaction input
 */
export function createSighashPreimage(
  tx: Transaction,
  inputIndex: number,
  lockingScript: LockingScript,
  sourceSatoshis: number,
  sigHashType: number = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
): number[] {
  const input = tx.inputs[inputIndex]
  const otherInputs = tx.inputs.filter((_, index) => index !== inputIndex)
  
  const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
  if (!sourceTXID) {
    throw new Error('sourceTXID or sourceTransaction is required')
  }
  
  return TransactionSignature.format({
    sourceTXID,
    sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis,
    transactionVersion: tx.version,
    otherInputs,
    inputIndex,
    outputs: tx.outputs,
    inputSequence: input.sequence ?? 0xffffffff,
    subscript: lockingScript,
    lockTime: tx.lockTime,
    scope: sigHashType
  })
}

/**
 * Sign a transaction input with a private key
 * Returns the signature in checksig format (DER + sighash type byte)
 */
export function signInput(
  tx: Transaction,
  inputIndex: number,
  privateKey: PrivateKey,
  lockingScript: LockingScript,
  sourceSatoshis: number,
  sigHashType: number = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
): number[] {
  const preimage = createSighashPreimage(tx, inputIndex, lockingScript, sourceSatoshis, sigHashType)
  const rawSignature = privateKey.sign(sha256(preimage))
  const txSig = new TransactionSignature(rawSignature.r, rawSignature.s, sigHashType)
  return txSig.toChecksigFormat()
}

/**
 * Create a 2-of-2 multisig unlocking script from two signatures
 * Format: OP_0 <sig1> <sig2>
 */
export function createMultisigUnlockingScript(sig1: number[], sig2: number[]): UnlockingScript {
  return new UnlockingScript([
    { op: OP.OP_0 },  // Required due to CHECKMULTISIG bug
    { op: sig1.length, data: sig1 },
    { op: sig2.length, data: sig2 }
  ])
}

/**
 * 2-of-2 Multisig unlocking script template
 * 
 * This is used when we have both private keys (e.g., for testing).
 * For real payment channels, each party signs separately.
 */
export function createMultisigUnlockTemplate(
  privateKey1: PrivateKey,
  privateKey2: PrivateKey,
  sourceSatoshis?: number,
  lockingScript?: LockingScript
) {
  return {
    sign: async (tx: Transaction, inputIndex: number): Promise<UnlockingScript> => {
      const input = tx.inputs[inputIndex]
      
      const satoshis = sourceSatoshis ?? 
        input.sourceTransaction?.outputs[input.sourceOutputIndex].satoshis
      if (satoshis === undefined) {
        throw new Error('sourceSatoshis or sourceTransaction required')
      }
      
      const script = lockingScript ?? 
        input.sourceTransaction?.outputs[input.sourceOutputIndex].lockingScript
      if (!script) {
        throw new Error('lockingScript or sourceTransaction required')
      }
      
      const sig1 = signInput(tx, inputIndex, privateKey1, script, satoshis)
      const sig2 = signInput(tx, inputIndex, privateKey2, script, satoshis)
      
      return createMultisigUnlockingScript(sig1, sig2)
    },
    estimateLength: async (): Promise<number> => {
      // OP_0 (1) + sig1 push (1) + sig1 (~73) + sig2 push (1) + sig2 (~73)
      return 149
    }
  }
}

/**
 * Sign a commitment transaction (for payment channels)
 * 
 * This creates a partial signature that can be sent to the counterparty.
 * The counterparty adds their signature to complete the unlock.
 */
export function signCommitment(
  tx: Transaction,
  inputIndex: number,
  privateKey: PrivateKey,
  multisigScript: LockingScript,
  sourceSatoshis: number
): { signature: number[], sigHashType: number } {
  const sigHashType = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
  const signature = signInput(tx, inputIndex, privateKey, multisigScript, sourceSatoshis, sigHashType)
  return { signature, sigHashType }
}

/**
 * Verify a signature against a transaction
 */
export function verifySignature(
  tx: Transaction,
  inputIndex: number,
  publicKey: PublicKey,
  signature: number[],
  lockingScript: LockingScript,
  sourceSatoshis: number
): boolean {
  // Extract sighash type from last byte
  const sigHashType = signature[signature.length - 1]
  
  // Create preimage
  const preimage = createSighashPreimage(tx, inputIndex, lockingScript, sourceSatoshis, sigHashType)
  const sighash = sha256(preimage)
  
  // Parse DER signature (remove sighash type byte)
  const derSig = signature.slice(0, -1)
  
  // Verify - reconstruct the signature object
  try {
    const sig = Signature.fromDER(derSig)
    return publicKey.verify(sighash, sig)
  } catch (err) {
    return false
  }
}

/**
 * Create a funding transaction for a payment channel
 */
export interface FundingTxParams {
  /** UTXO to spend (must be P2PKH) */
  utxo: {
    txid: string
    vout: number
    satoshis: number
    scriptPubKey: string
  }
  /** Private key to sign the UTXO */
  privateKey: PrivateKey
  /** Our public key for the multisig */
  localPubKey: PublicKey
  /** Remote party's public key for the multisig */
  remotePubKey: PublicKey
  /** Channel capacity in satoshis */
  capacity: number
  /** Fee in satoshis */
  fee?: number
}

export async function createFundingTransaction(params: FundingTxParams): Promise<Transaction> {
  const { utxo, privateKey, localPubKey, remotePubKey, capacity, fee = 200 } = params
  
  // Create multisig locking script
  const multisigScript = createMultisigLockingScript(localPubKey, remotePubKey)
  
  // Create the funding transaction
  const tx = new Transaction()
  
  // Add input (spending from P2PKH)
  const p2pkh = new P2PKH()
  
  // Create a minimal source tx for the SDK
  const sourceTx = new Transaction()
  sourceTx.outputs = Array(utxo.vout + 1).fill(null)
  sourceTx.outputs[utxo.vout] = {
    satoshis: utxo.satoshis,
    lockingScript: LockingScript.fromHex(utxo.scriptPubKey)
  }
  
  tx.addInput({
    sourceTXID: utxo.txid,
    sourceOutputIndex: utxo.vout,
    sourceTransaction: sourceTx,
    unlockingScriptTemplate: p2pkh.unlock(privateKey),
    sequence: 0xffffffff
  })
  
  // Add multisig output (the channel)
  tx.addOutput({
    satoshis: capacity,
    lockingScript: multisigScript
  })
  
  // Add change output if needed
  const change = utxo.satoshis - capacity - fee
  if (change > 546) { // Dust limit
    tx.addOutput({
      satoshis: change,
      lockingScript: p2pkh.lock(privateKey.toPublicKey().toHash())
    })
  }
  
  // Sign
  await tx.sign()
  
  return tx
}

/**
 * Create a commitment transaction (state update)
 */
export interface CommitmentTxParams {
  /** Funding transaction */
  fundingTx: Transaction
  /** Output index of the multisig in the funding tx */
  fundingVout: number
  /** Multisig locking script */
  multisigScript: LockingScript
  /** Capacity of the channel */
  capacity: number
  /** Local balance */
  localBalance: number
  /** Remote balance */
  remoteBalance: number
  /** Local public key (for output) */
  localPubKey: PublicKey
  /** Remote public key (for output) */
  remotePubKey: PublicKey
  /** nLockTime for the commitment */
  lockTime: number
  /** nSequence (for RBF/revocation) */
  sequence: number
  /** Fee in satoshis */
  fee?: number
}

export function createCommitmentTransaction(params: CommitmentTxParams): Transaction {
  const {
    fundingTx,
    fundingVout,
    multisigScript,
    capacity,
    localBalance,
    remoteBalance,
    localPubKey,
    remotePubKey,
    lockTime,
    sequence,
    fee = 200
  } = params
  
  // Verify balances
  if (localBalance + remoteBalance + fee > capacity) {
    throw new Error('Balances + fee exceed capacity')
  }
  
  const tx = new Transaction()
  
  // Add input spending the funding tx
  tx.addInput({
    sourceTXID: fundingTx.id('hex'),
    sourceOutputIndex: fundingVout,
    sourceTransaction: fundingTx,
    sequence,
    // unlockingScript will be set after both parties sign
    unlockingScript: new UnlockingScript([])
  })
  
  tx.lockTime = lockTime
  
  // Add outputs for each party (if non-zero)
  const p2pkh = new P2PKH()
  
  if (localBalance > 0) {
    tx.addOutput({
      satoshis: localBalance,
      lockingScript: p2pkh.lock(localPubKey.toHash())
    })
  }
  
  if (remoteBalance > 0) {
    tx.addOutput({
      satoshis: remoteBalance,
      lockingScript: p2pkh.lock(remotePubKey.toHash())
    })
  }
  
  return tx
}
