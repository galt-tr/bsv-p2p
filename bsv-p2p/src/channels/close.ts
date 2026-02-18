/**
 * Cooperative Channel Close Protocol
 * 
 * Flow:
 * 1. Initiator creates closing tx with final balances
 * 2. Initiator signs and sends CLOSE_REQUEST with tx hex + signature
 * 3. Responder verifies tx, signs, sends CLOSE_ACCEPT with their signature
 * 4. Initiator assembles both signatures and broadcasts
 * 5. Both parties mark channel as closed
 */

import { PrivateKey, PublicKey, Transaction, P2PKH, Hash } from '@bsv/sdk'
import { 
  createMultisigLockingScript, 
  signCommitment,
  createMultisigUnlockingScript,
  verifySignature
} from './multisig.js'
import { fetchTransaction, broadcastTransaction } from './bsv-services.js'

const { hash160 } = Hash

export interface CloseRequest {
  channelId: string
  fundingTxId: string
  fundingVout: number
  capacity: number
  initiatorBalance: number
  responderBalance: number
  fee: number
  // The unsigned closing tx (for responder to verify and sign)
  closingTxHex: string
  // Initiator's signature
  initiatorSignature: string
  initiatorPubKey: string
  responderPubKey: string
}

export interface CloseAccept {
  channelId: string
  // Responder's signature
  responderSignature: string
}

/**
 * Create a closing transaction and sign it (initiator side)
 */
export async function createCloseRequest(params: {
  channelId: string
  fundingTxId: string
  fundingVout: number
  capacity: number
  localBalance: number
  remoteBalance: number
  localPrivateKey: PrivateKey
  localPubKey: PublicKey
  remotePubKey: PublicKey
  fee?: number
}): Promise<CloseRequest> {
  const {
    channelId,
    fundingTxId,
    fundingVout,
    capacity,
    localBalance,
    remoteBalance,
    localPrivateKey,
    localPubKey,
    remotePubKey,
    fee = 200
  } = params

  // Fetch funding transaction
  const fundingTxInfo = await fetchTransaction(fundingTxId)
  const fundingTx = Transaction.fromHex(fundingTxInfo.hex)

  // Create multisig script (must match funding tx)
  const multisigScript = createMultisigLockingScript(localPubKey, remotePubKey)

  // Calculate final amounts after fee split
  const halfFee = Math.floor(fee / 2)
  const initiatorFinal = localBalance - halfFee
  const responderFinal = remoteBalance - halfFee

  // Create closing transaction
  const closeTx = new Transaction()

  // Input: the funding tx output (no unlocking script yet)
  closeTx.addInput({
    sourceTXID: fundingTxId,
    sourceOutputIndex: fundingVout,
    sourceTransaction: fundingTx,
    sequence: 0xffffffff
  })

  // Outputs in deterministic order (initiator first, then responder)
  const p2pkh = new P2PKH()

  if (initiatorFinal > 546) {
    closeTx.addOutput({
      satoshis: initiatorFinal,
      lockingScript: p2pkh.lock(hash160(localPubKey.encode(true)))
    })
  }

  if (responderFinal > 546) {
    closeTx.addOutput({
      satoshis: responderFinal,
      lockingScript: p2pkh.lock(hash160(remotePubKey.encode(true)))
    })
  }

  // Sign our half
  const { signature } = signCommitment(
    closeTx,
    0,
    localPrivateKey,
    multisigScript,
    capacity
  )

  // Create the request - include a serializable version of the tx
  // We'll recreate the tx on the responder side from the parameters
  return {
    channelId,
    fundingTxId,
    fundingVout,
    capacity,
    initiatorBalance: localBalance,
    responderBalance: remoteBalance,
    fee,
    closingTxHex: '', // Will be reconstructed by responder
    initiatorSignature: Buffer.from(signature).toString('hex'),
    initiatorPubKey: localPubKey.toString(),
    responderPubKey: remotePubKey.toString()
  }
}

/**
 * Verify and sign a close request (responder side)
 */
export async function signCloseRequest(
  request: CloseRequest,
  responderPrivateKey: PrivateKey
): Promise<CloseAccept> {
  const {
    channelId,
    fundingTxId,
    fundingVout,
    capacity,
    initiatorBalance,
    responderBalance,
    fee,
    initiatorSignature,
    initiatorPubKey,
    responderPubKey
  } = request

  // Parse keys
  const initPubKey = PublicKey.fromString(initiatorPubKey)
  const respPubKey = PublicKey.fromString(responderPubKey)

  // Verify responder pubkey matches our key
  if (respPubKey.toString() !== responderPrivateKey.toPublicKey().toString()) {
    throw new Error('Responder pubkey mismatch')
  }

  // Fetch funding transaction
  const fundingTxInfo = await fetchTransaction(fundingTxId)
  const fundingTx = Transaction.fromHex(fundingTxInfo.hex)

  // Recreate the multisig script
  const multisigScript = createMultisigLockingScript(initPubKey, respPubKey)

  // Calculate final amounts
  const halfFee = Math.floor(fee / 2)
  const initiatorFinal = initiatorBalance - halfFee
  const responderFinal = responderBalance - halfFee

  // Recreate the exact same closing transaction
  const closeTx = new Transaction()

  closeTx.addInput({
    sourceTXID: fundingTxId,
    sourceOutputIndex: fundingVout,
    sourceTransaction: fundingTx,
    sequence: 0xffffffff
  })

  const p2pkh = new P2PKH()

  if (initiatorFinal > 546) {
    closeTx.addOutput({
      satoshis: initiatorFinal,
      lockingScript: p2pkh.lock(hash160(initPubKey.encode(true)))
    })
  }

  if (responderFinal > 546) {
    closeTx.addOutput({
      satoshis: responderFinal,
      lockingScript: p2pkh.lock(hash160(respPubKey.encode(true)))
    })
  }

  // Verify initiator's signature
  const initSigBytes = Array.from(Buffer.from(initiatorSignature, 'hex'))
  const validInitSig = verifySignature(
    closeTx,
    0,
    initPubKey,
    initSigBytes,
    multisigScript,
    capacity
  )

  if (!validInitSig) {
    throw new Error('Invalid initiator signature')
  }

  // Sign our half
  const { signature } = signCommitment(
    closeTx,
    0,
    responderPrivateKey,
    multisigScript,
    capacity
  )

  return {
    channelId,
    responderSignature: Buffer.from(signature).toString('hex')
  }
}

/**
 * Assemble signatures and broadcast closing transaction
 */
export async function broadcastClose(
  request: CloseRequest,
  accept: CloseAccept
): Promise<string> {
  const {
    fundingTxId,
    fundingVout,
    capacity,
    initiatorBalance,
    responderBalance,
    fee,
    initiatorSignature,
    initiatorPubKey,
    responderPubKey
  } = request

  const { responderSignature } = accept

  // Parse keys
  const initPubKey = PublicKey.fromString(initiatorPubKey)
  const respPubKey = PublicKey.fromString(responderPubKey)

  // Fetch funding transaction
  const fundingTxInfo = await fetchTransaction(fundingTxId)
  const fundingTx = Transaction.fromHex(fundingTxInfo.hex)

  // Calculate final amounts
  const halfFee = Math.floor(fee / 2)
  const initiatorFinal = initiatorBalance - halfFee
  const responderFinal = responderBalance - halfFee

  // Create the closing transaction with unlocking script
  const initSig = Array.from(Buffer.from(initiatorSignature, 'hex'))
  const respSig = Array.from(Buffer.from(responderSignature, 'hex'))

  // Signatures must be in same order as pubkeys in multisig
  const unlockingScript = createMultisigUnlockingScript(initSig, respSig)

  const closeTx = new Transaction()

  closeTx.addInput({
    sourceTXID: fundingTxId,
    sourceOutputIndex: fundingVout,
    sourceTransaction: fundingTx,
    unlockingScript,
    sequence: 0xffffffff
  })

  const p2pkh = new P2PKH()

  if (initiatorFinal > 546) {
    closeTx.addOutput({
      satoshis: initiatorFinal,
      lockingScript: p2pkh.lock(hash160(initPubKey.encode(true)))
    })
  }

  if (responderFinal > 546) {
    closeTx.addOutput({
      satoshis: responderFinal,
      lockingScript: p2pkh.lock(hash160(respPubKey.encode(true)))
    })
  }

  // Broadcast
  const txid = await broadcastTransaction(closeTx.toHex())
  return txid.trim()
}
