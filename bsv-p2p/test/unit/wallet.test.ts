/**
 * Wallet Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Wallet } from '../../src/wallet/index.js'

// Test private key (not real, just for testing)
const TEST_PRIVATE_KEY = '0000000000000000000000000000000000000000000000000000000000000001'

describe('Wallet', () => {
  let wallet: Wallet

  beforeEach(() => {
    wallet = new Wallet({
      privateKey: TEST_PRIVATE_KEY,
      dbPath: ':memory:'  // In-memory for tests
    })
  })

  describe('initialization', () => {
    it('should derive address from private key', () => {
      const address = wallet.getAddress()
      expect(address).toBeTruthy()
      expect(address.startsWith('1')).toBe(true)  // Mainnet P2PKH
    })

    it('should derive public key', () => {
      const pubKey = wallet.getPublicKey()
      expect(pubKey).toBeTruthy()
      expect(pubKey.length).toBeGreaterThan(0)
    })

    it('should start with zero balance', () => {
      expect(wallet.getBalance()).toBe(0)
    })

    it('should start with no UTXOs', () => {
      expect(wallet.getUTXOs()).toHaveLength(0)
    })
  })

  describe('recordPayment', () => {
    it('should record a payment as UTXO', () => {
      wallet.recordPayment(
        'abc123',
        0,
        10000,
        '76a914...',
        'peer123',
        'test payment'
      )

      const utxos = wallet.getUTXOs()
      expect(utxos).toHaveLength(1)
      expect(utxos[0].txid).toBe('abc123')
      expect(utxos[0].vout).toBe(0)
      expect(utxos[0].satoshis).toBe(10000)
      expect(utxos[0].fromPeerId).toBe('peer123')
      expect(utxos[0].memo).toBe('test payment')
    })

    it('should update balance after recording payment', () => {
      wallet.recordPayment('tx1', 0, 5000, '')
      wallet.recordPayment('tx2', 0, 3000, '')
      
      expect(wallet.getBalance()).toBe(8000)
    })

    it('should handle duplicate UTXOs (same txid:vout)', () => {
      wallet.recordPayment('tx1', 0, 5000, '')
      wallet.recordPayment('tx1', 0, 5000, '')  // Same UTXO
      
      expect(wallet.getUTXOs()).toHaveLength(1)
      expect(wallet.getBalance()).toBe(5000)
    })
  })

  describe('address encoding', () => {
    it('should generate valid mainnet address', () => {
      const address = wallet.getAddress()
      
      // Valid base58 check
      expect(address).toMatch(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/)
      
      // Reasonable length
      expect(address.length).toBeGreaterThanOrEqual(25)
      expect(address.length).toBeLessThanOrEqual(35)
    })
  })
})
