/**
 * Transaction builder with fluent API
 */

import { Transaction, P2PKH, PrivateKey, PublicKey, Script, LockingScript, OP } from '@bsv/sdk'
import type { TxResult } from './types.js'

/**
 * Output type for builder
 */
interface BuilderOutput {
  lockingScript: LockingScript
  satoshis: number
}

/**
 * Input type for builder
 */
interface BuilderInput {
  txid: string
  vout: number
  satoshis: number
  script: string
}

/**
 * Transaction builder with fluent API
 * 
 * Example:
 * ```ts
 * const tx = await new TransactionBuilder(privKey, utxos)
 *   .addP2PKHOutput(address, 1000)
 *   .addDataOutput('Hello, World!')
 *   .setDescription('My payment')
 *   .build()
 * ```
 */
export class TransactionBuilder {
  private privKey: PrivateKey
  private utxos: BuilderInput[]
  private outputs: BuilderOutput[] = []
  private changeAddress?: string
  private lockTime: number = 0
  private sequence: number = 0xffffffff
  private description: string = ''

  constructor(
    privKey: PrivateKey,
    utxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>
  ) {
    this.privKey = privKey
    this.utxos = utxos
    
    if (!utxos || utxos.length === 0) {
      throw new Error('UTXOs must be provided')
    }
  }

  /**
   * Add a P2PKH output
   */
  addP2PKHOutput(address: string, satoshis: number): this {
    this.outputs.push({
      lockingScript: new P2PKH().lock(address),
      satoshis
    })
    return this
  }

  /**
   * Add a public key output
   */
  addPubKeyOutput(pubKey: PublicKey | string, satoshis: number): this {
    const pk = typeof pubKey === 'string' ? PublicKey.fromString(pubKey) : pubKey
    const address = pk.toAddress()
    return this.addP2PKHOutput(address, satoshis)
  }

  /**
   * Add a multisig output (m-of-n)
   */
  addMultisigOutput(
    pubKeys: Array<PublicKey | string>,
    required: number,
    satoshis: number
  ): this {
    if (required > pubKeys.length) {
      throw new Error('Required signatures cannot exceed number of public keys')
    }
    
    // Convert all to PublicKey instances and sort
    const keys = pubKeys
      .map(pk => typeof pk === 'string' ? PublicKey.fromString(pk) : pk)
      .sort((a, b) => a.toString().localeCompare(b.toString()))
    
    // Build m-of-n multisig script
    const scriptOps = [
      { op: OP[`OP_${required}` as keyof typeof OP] as number },
      ...keys.map(pk => ({
        op: pk.encode(true).length,
        data: pk.encode(true)
      })),
      { op: OP[`OP_${keys.length}` as keyof typeof OP] as number },
      { op: OP.OP_CHECKMULTISIG }
    ]
    
    const script = new Script(scriptOps)
    
    this.outputs.push({
      lockingScript: new LockingScript(script.toASM()),
      satoshis
    })
    return this
  }

  /**
   * Add an OP_RETURN data output
   */
  addDataOutput(data: Buffer | string): this {
    const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    
    const script = new Script([
      { op: OP.OP_FALSE },
      { op: OP.OP_RETURN },
      { op: dataBuffer.length, data: dataBuffer }
    ])
    
    this.outputs.push({
      lockingScript: new LockingScript(script.toASM()),
      satoshis: 0
    })
    return this
  }

  /**
   * Add multiple data chunks in one OP_RETURN output
   */
  addMultiDataOutput(dataChunks: Array<Buffer | string>): this {
    const buffers = dataChunks.map(chunk => 
      typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    )
    
    const scriptOps = [
      { op: OP.OP_FALSE },
      { op: OP.OP_RETURN },
      ...buffers.map(buf => ({ op: buf.length, data: buf }))
    ]
    
    const script = new Script(scriptOps)
    
    this.outputs.push({
      lockingScript: new LockingScript(script.toASM()),
      satoshis: 0
    })
    return this
  }

  /**
   * Set change address (defaults to source address)
   */
  setChangeAddress(address: string): this {
    this.changeAddress = address
    return this
  }

  /**
   * Set transaction lock time
   */
  setLockTime(lockTime: number): this {
    this.lockTime = lockTime
    return this
  }

  /**
   * Set input sequence number
   */
  setSequence(sequence: number): this {
    this.sequence = sequence
    return this
  }

  /**
   * Set transaction description (metadata)
   */
  setDescription(description: string): this {
    this.description = description
    return this
  }

  /**
   * Build the transaction
   */
  async build(): Promise<TxResult> {
    const tx = new Transaction()
    
    // Set lock time if specified
    if (this.lockTime > 0) {
      tx.lockTime = this.lockTime
    }
    
    // Add inputs
    let totalInput = 0
    for (const utxo of this.utxos) {
      tx.addInput({
        sourceTXID: utxo.txid,
        sourceOutputIndex: utxo.vout,
        unlockingScriptTemplate: new P2PKH().unlock(this.privKey),
        sequence: this.sequence
      })
      totalInput += utxo.satoshis
    }
    
    // Add outputs
    let totalOutput = 0
    for (const output of this.outputs) {
      tx.addOutput(output)
      totalOutput += output.satoshis
    }
    
    // Calculate fee and change
    const estimatedSize = tx.inputs.length * 150 + (this.outputs.length + 1) * 35 + 10
    const fee = estimatedSize // 1 sat/byte
    const change = totalInput - totalOutput - fee
    
    // Add change output if needed
    if (change > 0) {
      const changeAddr = this.changeAddress || this.privKey.toPublicKey().toAddress()
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
   * Build and broadcast the transaction
   * Note: Broadcasting requires a configured BSV node
   */
  async buildAndBroadcast(): Promise<{ txid: string }> {
    const result = await this.build()
    
    // TODO: Implement broadcasting via WhatsOnChain or configured node
    // For now, just return the txid
    console.warn('Broadcasting not yet implemented, returning txid only')
    
    return { txid: result.txid }
  }
}
