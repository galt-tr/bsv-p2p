/**
 * Data output transactions (OP_RETURN)
 */

import { Transaction, P2PKH, PrivateKey, Script, LockingScript, OP } from '@bsv/sdk'
import type { TxResult } from './types.js'

/**
 * Create a transaction with OP_RETURN data output
 * 
 * @param fromPrivKey - Private key to spend from
 * @param data - Data to embed (Buffer or string)
 * @param utxos - UTXOs to spend
 * @param changeAddress - Change address
 * @returns Transaction with OP_RETURN output
 */
export async function createDataOutput(
  fromPrivKey: PrivateKey,
  data: Buffer | string,
  utxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>,
  changeAddress?: string
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
  
  // Create OP_RETURN output
  const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  
  const opReturnScript = new Script([
    { op: OP.OP_FALSE },
    { op: OP.OP_RETURN },
    { op: dataBuffer.length, data: dataBuffer }
  ])
  
  tx.addOutput({
    lockingScript: new LockingScript(opReturnScript.toASM()),
    satoshis: 0
  })
  
  // Add change output
  const fee = tx.inputs.length * 150 + tx.outputs.length * 35 + dataBuffer.length + 10
  const change = totalInput - fee
  
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
 * Extract data from OP_RETURN outputs
 * 
 * @param txHex - Transaction hex
 * @returns Array of data buffers from OP_RETURN outputs
 */
export function extractDataOutputs(txHex: string): Buffer[] {
  const tx = Transaction.fromHex(txHex)
  const dataOutputs: Buffer[] = []
  
  for (const output of tx.outputs) {
    const script = output.lockingScript
    const asm = script.toASM()
    
    // Check if it's OP_RETURN
    if (asm.startsWith('OP_FALSE OP_RETURN')) {
      // Parse the data chunks
      const chunks = script.chunks
      // Skip OP_FALSE and OP_RETURN
      for (let i = 2; i < chunks.length; i++) {
        const chunk = chunks[i]
        if (chunk.data) {
          dataOutputs.push(Buffer.from(chunk.data))
        }
      }
    }
  }
  
  return dataOutputs
}

/**
 * Create multi-output OP_RETURN transaction (multiple data chunks)
 * 
 * @param fromPrivKey - Private key to spend from
 * @param dataChunks - Array of data chunks
 * @param utxos - UTXOs to spend
 * @param changeAddress - Change address
 * @returns Transaction with multi-chunk OP_RETURN
 */
export async function createMultiDataOutput(
  fromPrivKey: PrivateKey,
  dataChunks: Array<Buffer | string>,
  utxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>,
  changeAddress?: string
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
  
  // Convert all chunks to buffers
  const buffers = dataChunks.map(chunk => 
    typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
  )
  
  // Create OP_RETURN with multiple data pushes
  const scriptOps = [
    { op: OP.OP_FALSE },
    { op: OP.OP_RETURN },
    ...buffers.map(buf => ({ op: buf.length, data: buf }))
  ]
  
  const opReturnScript = new Script(scriptOps)
  
  tx.addOutput({
    lockingScript: new LockingScript(opReturnScript.toASM()),
    satoshis: 0
  })
  
  // Calculate total data size
  const totalDataSize = buffers.reduce((sum, buf) => sum + buf.length, 0)
  
  // Add change output
  const fee = tx.inputs.length * 150 + tx.outputs.length * 35 + totalDataSize + 10
  const change = totalInput - fee
  
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
