/**
 * Unit tests for P2PKH payment transactions
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PrivateKey, Transaction } from '@bsv/sdk'
import { createP2PKHPayment, verifyP2PKHPayment } from '../../../src/transactions/payment.js'

describe('P2PKH Payments', () => {
  let privKey: PrivateKey
  let address: string
  let mockUtxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>

  beforeEach(() => {
    privKey = PrivateKey.fromRandom()
    address = privKey.toPublicKey().toAddress()
    
    // Mock UTXOs
    mockUtxos = [
      {
        txid: '0'.repeat(64),
        vout: 0,
        satoshis: 10000,
        script: '76a914' + '00'.repeat(20) + '88ac' // P2PKH script
      }
    ]
  })

  describe('createP2PKHPayment', () => {
    it('should create a valid P2PKH payment', async () => {
      const recipientAddress = PrivateKey.fromRandom().toPublicKey().toAddress()
      const amount = 5000

      const result = await createP2PKHPayment(
        privKey,
        recipientAddress,
        amount,
        address,
        mockUtxos
      )

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
      expect(result.beef).toBeDefined()
      expect(result.tx).toBeDefined()
      
      // Verify transaction structure
      const tx = Transaction.fromHex(result.tx)
      expect(tx.inputs.length).toBe(1)
      expect(tx.outputs.length).toBeGreaterThanOrEqual(1) // At least payment output
    })

    it('should throw error if no UTXOs provided', async () => {
      const recipientAddress = PrivateKey.fromRandom().toPublicKey().toAddress()

      await expect(
        createP2PKHPayment(privKey, recipientAddress, 5000, address, [])
      ).rejects.toThrow('UTXOs must be provided')
    })

    it('should support public key hex as recipient', async () => {
      const recipientPubKey = PrivateKey.fromRandom().toPublicKey().toString()
      const amount = 5000

      const result = await createP2PKHPayment(
        privKey,
        recipientPubKey,
        amount,
        address,
        mockUtxos
      )

      expect(result.txid).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should add change output when needed', async () => {
      const recipientAddress = PrivateKey.fromRandom().toPublicKey().toAddress()
      const amount = 1000 // Much less than input

      const result = await createP2PKHPayment(
        privKey,
        recipientAddress,
        amount,
        address,
        mockUtxos
      )

      const tx = Transaction.fromHex(result.tx)
      expect(tx.outputs.length).toBe(2) // Payment + change
    })
  })

  describe('verifyP2PKHPayment', () => {
    it('should verify a valid payment', async () => {
      const recipientAddress = PrivateKey.fromRandom().toPublicKey().toAddress()
      const amount = 5000

      const result = await createP2PKHPayment(
        privKey,
        recipientAddress,
        amount,
        address,
        mockUtxos
      )

      const isValid = verifyP2PKHPayment(result.beef, {
        address: recipientAddress,
        satoshis: amount
      })

      expect(isValid).toBe(true)
    })

    it('should reject invalid payment', () => {
      const fakeBEEF = '0100beef' + '00'.repeat(100)
      
      const isValid = verifyP2PKHPayment(fakeBEEF, {
        address: address,
        satoshis: 5000
      })

      expect(isValid).toBe(false)
    })
  })
})
