/**
 * Simple P2PKH payment transactions
 */

import { Transaction, P2PKH, PrivateKey, PublicKey, Script } from '@bsv/sdk'
import type { TxResult } from './types.js'

/**
 * Create a P2PKH payment transaction
 * 
 * @param fromPrivKey - Private key to spend from
 * @param toAddress - Recipient address or public key hex
 * @param satoshis - Amount to send
 * @param changeAddress - Change address (defaults to fromPrivKey address)
 * @param utxos - UTXOs to spend (must be provided)
 * @returns Transaction result with BEEF
 */
export async function createP2PKHPayment(
  fromPrivKey: PrivateKey,
  toAddress: string,
  satoshis: number,
  changeAddress?: string,
  utxos?: Array<{ txid: string; vout: number; satoshis: number; script: string }>
): Promise<TxResult> {
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
  
  // Add payment output
  let recipientScript: Script
  if (toAddress.length === 66 || toAddress.length === 130) {
    // Public key hex
    const pubKey = PublicKey.fromString(toAddress)
    recipientScript = new P2PKH().lock(pubKey.toAddress())
  } else {
    // Address
    recipientScript = new P2PKH().lock(toAddress)
  }
  
  tx.addOutput({
    lockingScript: recipientScript,
    satoshis
  })
  
  // Add change output if needed
  const fee = tx.inputs.length * 150 + tx.outputs.length * 35 + 10 // Rough estimate
  const change = totalInput - satoshis - fee
  
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
  
  // Generate BEEF
  const beef = tx.toBEEF()
  
  return {
    txid: tx.id('hex'),
    beef: Array.from(beef).map(b => b.toString(16).padStart(2, '0')).join(''),
    tx: tx.toHex()
  }
}

/**
 * Verify a P2PKH payment
 * 
 * @param beef - BEEF transaction
 * @param expectedOutput - Expected output (address and amount)
 * @returns True if valid
 */
export function verifyP2PKHPayment(
  beef: string,
  expectedOutput: { address: string; satoshis: number }
): boolean {
  try {
    const tx = Transaction.fromBEEF(Buffer.from(beef, 'hex'))
    
    // Find output matching expected
    const found = tx.outputs.some(output => {
      const script = new P2PKH().lock(expectedOutput.address)
      return output.lockingScript.toHex() === script.toHex() &&
             output.satoshis === expectedOutput.satoshis
    })
    
    return found
  } catch {
    return false
  }
}
