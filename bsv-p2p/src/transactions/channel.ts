/**
 * Payment channel transactions
 * - Funding (2-of-2 multisig)
 * - Commitment (state updates)
 * - Close (cooperative settlement)
 */

import { Transaction, P2PKH, PrivateKey, PublicKey, Script, LockingScript, UnlockingScript, OP } from '@bsv/sdk'
import type { ChannelFundingResult, CommitmentTxResult, TxResult } from './types.js'

/**
 * Create a 2-of-2 multisig locking script
 */
function create2of2MultisigScript(pubKey1: PublicKey, pubKey2: PublicKey): Script {
  // Sort public keys for deterministic ordering
  const keys = [pubKey1, pubKey2].sort((a, b) => 
    a.toString().localeCompare(b.toString())
  )
  
  return new Script([
    { op: OP.OP_2 },
    { op: keys[0].encode(true).length, data: keys[0].encode(true) },
    { op: keys[1].encode(true).length, data: keys[1].encode(true) },
    { op: OP.OP_2 },
    { op: OP.OP_CHECKMULTISIG }
  ])
}

/**
 * Create channel funding transaction
 * 
 * @param fromPrivKey - Funder's private key
 * @param capacity - Channel capacity in satoshis
 * @param myPubKey - Funder's public key (for 2-of-2)
 * @param peerPubKey - Peer's public key (for 2-of-2)
 * @param utxos - UTXOs to fund from
 * @param changeAddress - Change address
 * @returns Funding transaction with multisig output
 */
export async function createChannelFunding(
  fromPrivKey: PrivateKey,
  capacity: number,
  myPubKey: PublicKey,
  peerPubKey: PublicKey,
  utxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>,
  changeAddress?: string
): Promise<ChannelFundingResult> {
  if (!utxos || utxos.length === 0) {
    throw new Error('UTXOs must be provided')
  }

  const tx = new Transaction()
  
  // Add inputs
  let totalInput = 0
  for (const utxo of utxos) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(fromPrivKey),
      sequence: 0xffffffff
    })
    totalInput += utxo.satoshis
  }
  
  // Create 2-of-2 multisig output
  const multisigScript = create2of2MultisigScript(myPubKey, peerPubKey)
  
  tx.addOutput({
    lockingScript: new LockingScript(multisigScript.toASM()),
    satoshis: capacity
  })
  
  // Add change output if needed
  const fee = tx.inputs.length * 150 + tx.outputs.length * 35 + 10
  const change = totalInput - capacity - fee
  
  if (change > 0) {
    const changeAddr = changeAddress || fromPrivKey.toPublicKey().toAddress()
    tx.addOutput({
      lockingScript: new P2PKH().lock(changeAddr),
      satoshis: change
    })
  }
  
  // Sign
  await tx.sign()
  await tx.fee()
  
  const txid = tx.id('hex')
  const vout = 0 // Multisig is always first output
  
  return {
    txid,
    vout,
    satoshis: capacity,
    script: multisigScript.toHex(),
    redeemScript: multisigScript.toHex()
  }
}

/**
 * Create a commitment transaction (channel state update)
 * 
 * This spends from the funding transaction and distributes balances
 * according to the current channel state.
 * 
 * @param fundingTxid - Funding transaction ID
 * @param fundingVout - Funding output index
 * @param fundingScript - Funding multisig script
 * @param myBalance - My balance in the channel
 * @param peerBalance - Peer's balance in the channel
 * @param myAddress - My payout address
 * @param peerAddress - Peer's payout address
 * @param myPrivKey - My private key (to sign)
 * @param nSequence - Sequence number (for nLockTime revocation)
 * @param nLockTime - Lock time (Unix timestamp)
 * @returns Commitment transaction (unsigned by peer)
 */
export async function createChannelCommitment(
  fundingTxid: string,
  fundingVout: number,
  fundingScript: string,
  myBalance: number,
  peerBalance: number,
  myAddress: string,
  peerAddress: string,
  myPrivKey: PrivateKey,
  nSequence: number,
  nLockTime: number
): Promise<CommitmentTxResult> {
  const tx = new Transaction()
  
  // Set nLockTime
  tx.lockTime = nLockTime
  
  // Add funding input (will need 2 signatures)
  tx.addInput({
    sourceTXID: fundingTxid,
    sourceOutputIndex: fundingVout,
    unlockingScript: new UnlockingScript([]), // Will be filled with sigs
    sequence: nSequence
  })
  
  // Add outputs for each party (if balance > 0)
  if (myBalance > 0) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(myAddress),
      satoshis: myBalance
    })
  }
  
  if (peerBalance > 0) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(peerAddress),
      satoshis: peerBalance
    })
  }
  
  // Create signature hash for multisig input
  const sigHash = tx.sighash(0, LockingScript.fromHex(fundingScript))
  const signature = myPrivKey.sign(sigHash)
  
  return {
    tx: tx.toHex(),
    signature: signature.toHex(),
    txid: tx.id('hex')
  }
}

/**
 * Complete and broadcast a commitment transaction with both signatures
 * 
 * @param commitmentTx - Commitment transaction hex
 * @param fundingScript - Funding multisig script
 * @param mySignature - My signature
 * @param peerSignature - Peer's signature
 * @returns Transaction result with BEEF
 */
export async function finalizeChannelCommitment(
  commitmentTx: string,
  fundingScript: string,
  mySignature: string,
  peerSignature: string
): Promise<TxResult> {
  const tx = Transaction.fromHex(commitmentTx)
  
  // Build unlocking script: OP_0 <sig1> <sig2> <redeemScript>
  // Signatures must be in same order as public keys in the script
  const unlockingScript = new UnlockingScript([
    { op: OP.OP_0 },
    { op: Buffer.from(mySignature, 'hex').length, data: Buffer.from(mySignature, 'hex') },
    { op: Buffer.from(peerSignature, 'hex').length, data: Buffer.from(peerSignature, 'hex') },
    { op: Buffer.from(fundingScript, 'hex').length, data: Buffer.from(fundingScript, 'hex') }
  ])
  
  tx.inputs[0].unlockingScript = unlockingScript
  
  // Generate BEEF
  const beef = tx.toBEEF()
  
  return {
    txid: tx.id('hex'),
    beef: Array.from(beef).map(b => b.toString(16).padStart(2, '0')).join(''),
    tx: tx.toHex()
  }
}

/**
 * Create cooperative channel close transaction
 * 
 * This is the same as a commitment transaction but typically uses
 * nSequence = 0xffffffff to make it immediately valid.
 * 
 * @param fundingTxid - Funding transaction ID
 * @param fundingVout - Funding output index
 * @param fundingScript - Funding multisig script
 * @param myBalance - Final balance for me
 * @param peerBalance - Final balance for peer
 * @param myAddress - My payout address
 * @param peerAddress - Peer's payout address
 * @param myPrivKey - My private key
 * @returns Close transaction (needs peer signature)
 */
export async function createChannelClose(
  fundingTxid: string,
  fundingVout: number,
  fundingScript: string,
  myBalance: number,
  peerBalance: number,
  myAddress: string,
  peerAddress: string,
  myPrivKey: PrivateKey
): Promise<CommitmentTxResult> {
  // Cooperative close uses max sequence and no locktime
  return createChannelCommitment(
    fundingTxid,
    fundingVout,
    fundingScript,
    myBalance,
    peerBalance,
    myAddress,
    peerAddress,
    myPrivKey,
    0xffffffff,
    0
  )
}
