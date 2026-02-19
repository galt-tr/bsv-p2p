/**
 * Unit tests for data output transactions
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PrivateKey, Transaction } from '@bsv/sdk'
import {
  createDataOutput,
  extractDataOutputs,
  createMultiDataOutput
} from '../../../src/transactions/data.js'

describe('Data Output Transactions', () => {
  let privKey: PrivateKey
  let address: string
  let mockUtxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>

  beforeEach(() => {
    privKey = PrivateKey.fromRandom()
    address = privKey.toPublicKey().toAddress()
    
    mockUtxos = [
      {
        txid: '0'.repeat(64),
        vout: 0,
        satoshis: 10000,
        script: '76a914' + '00'.repeat(20) + '88ac'
      }
    ]
  })

  describe('createDataOutput', () => {
    it('should create OP_RETURN transaction with string data', async () => {
      const data = 'Hello, BSV!'

      const result = await createDataOutput(
        privKey,
        data,
        mockUtxos,
        address
      )

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
      expect(result.beef).toBeDefined()
      expect(result.tx).toBeDefined()
      
      // Verify OP_RETURN output
      const tx = Transaction.fromHex(result.tx)
      const opReturnOutput = tx.outputs.find(out => 
        out.lockingScript.toASM().includes('OP_RETURN')
      )
      expect(opReturnOutput).toBeDefined()
      expect(opReturnOutput!.satoshis).toBe(0)
    })

    it('should create OP_RETURN transaction with Buffer data', async () => {
      const data = Buffer.from('Binary data', 'utf8')

      const result = await createDataOutput(
        privKey,
        data,
        mockUtxos,
        address
      )

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should throw error if no UTXOs provided', async () => {
      await expect(
        createDataOutput(privKey, 'test', [], address)
      ).rejects.toThrow('UTXOs must be provided')
    })

    it('should include change output', async () => {
      const data = 'Small data'

      const result = await createDataOutput(
        privKey,
        data,
        mockUtxos,
        address
      )

      const tx = Transaction.fromHex(result.tx)
      // Should have OP_RETURN + change
      expect(tx.outputs.length).toBe(2)
    })
  })

  describe('extractDataOutputs', () => {
    it('should extract data from OP_RETURN outputs', async () => {
      const data = 'Test message'

      const result = await createDataOutput(
        privKey,
        data,
        mockUtxos,
        address
      )

      const extracted = extractDataOutputs(result.tx)
      expect(extracted.length).toBeGreaterThan(0)
      expect(extracted[0].toString('utf8')).toBe(data)
    })

    it('should return empty array if no OP_RETURN outputs', () => {
      // Create a simple transaction without OP_RETURN
      const tx = new Transaction()
      const txHex = tx.toHex()

      const extracted = extractDataOutputs(txHex)
      expect(extracted.length).toBe(0)
    })
  })

  describe('createMultiDataOutput', () => {
    it('should create OP_RETURN with multiple data chunks', async () => {
      const chunks = ['chunk1', 'chunk2', 'chunk3']

      const result = await createMultiDataOutput(
        privKey,
        chunks,
        mockUtxos,
        address
      )

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
      
      // Extract and verify
      const extracted = extractDataOutputs(result.tx)
      expect(extracted.length).toBe(3)
      expect(extracted[0].toString('utf8')).toBe('chunk1')
      expect(extracted[1].toString('utf8')).toBe('chunk2')
      expect(extracted[2].toString('utf8')).toBe('chunk3')
    })

    it('should support mixed string and Buffer chunks', async () => {
      const chunks = [
        'string chunk',
        Buffer.from('buffer chunk', 'utf8')
      ]

      const result = await createMultiDataOutput(
        privKey,
        chunks,
        mockUtxos,
        address
      )

      const extracted = extractDataOutputs(result.tx)
      expect(extracted.length).toBe(2)
    })

    it('should throw error if no UTXOs provided', async () => {
      await expect(
        createMultiDataOutput(privKey, ['test'], [], address)
      ).rejects.toThrow('UTXOs must be provided')
    })
  })
})
