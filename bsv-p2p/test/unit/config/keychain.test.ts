/**
 * Unit tests for KeychainManager
 * 
 * Tests OS keychain integration for secure key storage.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { KeychainManager } from '../../../src/config/keychain.js'

describe('KeychainManager', () => {
  let keychain: KeychainManager
  const testPrivateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  const testPublicKey = '02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
  const testIdentityKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

  beforeAll(() => {
    // Use a test-specific keychain to avoid conflicts
    keychain = new KeychainManager({ service: 'bsv-p2p-test', account: 'test' })
  })

  afterAll(async () => {
    // Clean up test keys
    await keychain.deleteAllKeys()
  })

  describe('Keychain Availability', () => {
    it('should detect if keychain is available', async () => {
      const available = await keychain.isAvailable()
      // This may be true or false depending on the system
      expect(typeof available).toBe('boolean')
    })

    it('should return status for all keys', async () => {
      const status = await keychain.getStatus()
      expect(status).toHaveProperty('available')
      expect(status).toHaveProperty('hasPrivateKey')
      expect(status).toHaveProperty('hasPublicKey')
      expect(status).toHaveProperty('hasIdentityKey')
    })
  })

  describe('Private Key Storage', () => {
    it('should store and retrieve private key', async () => {
      const available = await keychain.isAvailable()
      if (!available) {
        console.log('Keychain not available, skipping test')
        return
      }

      await keychain.setPrivateKey(testPrivateKey)
      const retrieved = await keychain.getPrivateKey()
      expect(retrieved).toBe(testPrivateKey)
    })

    it('should return null for non-existent private key', async () => {
      await keychain.deletePrivateKey()
      const retrieved = await keychain.getPrivateKey()
      expect(retrieved).toBeNull()
    })

    it('should delete private key', async () => {
      const available = await keychain.isAvailable()
      if (!available) {
        console.log('Keychain not available, skipping test')
        return
      }

      await keychain.setPrivateKey(testPrivateKey)
      await keychain.deletePrivateKey()
      const retrieved = await keychain.getPrivateKey()
      expect(retrieved).toBeNull()
    })
  })

  describe('Public Key Storage', () => {
    it('should store and retrieve public key', async () => {
      const available = await keychain.isAvailable()
      if (!available) {
        console.log('Keychain not available, skipping test')
        return
      }

      await keychain.setPublicKey(testPublicKey)
      const retrieved = await keychain.getPublicKey()
      expect(retrieved).toBe(testPublicKey)
    })

    it('should return null for non-existent public key', async () => {
      await keychain.deletePublicKey()
      const retrieved = await keychain.getPublicKey()
      expect(retrieved).toBeNull()
    })
  })

  describe('Identity Key Storage', () => {
    it('should store and retrieve identity key', async () => {
      const available = await keychain.isAvailable()
      if (!available) {
        console.log('Keychain not available, skipping test')
        return
      }

      await keychain.setIdentityKey(testIdentityKey)
      const retrieved = await keychain.getIdentityKey()
      expect(retrieved).toBe(testIdentityKey)
    })

    it('should return null for non-existent identity key', async () => {
      await keychain.deleteIdentityKey()
      const retrieved = await keychain.getIdentityKey()
      expect(retrieved).toBeNull()
    })
  })

  describe('Multiple Keys Management', () => {
    it('should store and retrieve all keys', async () => {
      const available = await keychain.isAvailable()
      if (!available) {
        console.log('Keychain not available, skipping test')
        return
      }

      await keychain.setPrivateKey(testPrivateKey)
      await keychain.setPublicKey(testPublicKey)
      await keychain.setIdentityKey(testIdentityKey)

      const [privateKey, publicKey, identityKey] = await Promise.all([
        keychain.getPrivateKey(),
        keychain.getPublicKey(),
        keychain.getIdentityKey()
      ])

      expect(privateKey).toBe(testPrivateKey)
      expect(publicKey).toBe(testPublicKey)
      expect(identityKey).toBe(testIdentityKey)
    })

    it('should delete all keys', async () => {
      const available = await keychain.isAvailable()
      if (!available) {
        console.log('Keychain not available, skipping test')
        return
      }

      await keychain.setPrivateKey(testPrivateKey)
      await keychain.setPublicKey(testPublicKey)
      await keychain.setIdentityKey(testIdentityKey)

      await keychain.deleteAllKeys()

      const [privateKey, publicKey, identityKey] = await Promise.all([
        keychain.getPrivateKey(),
        keychain.getPublicKey(),
        keychain.getIdentityKey()
      ])

      expect(privateKey).toBeNull()
      expect(publicKey).toBeNull()
      expect(identityKey).toBeNull()
    })

    it('should reflect key presence in status', async () => {
      const available = await keychain.isAvailable()
      if (!available) {
        console.log('Keychain not available, skipping test')
        return
      }

      // Start clean
      await keychain.deleteAllKeys()

      // Store only private key
      await keychain.setPrivateKey(testPrivateKey)

      const status = await keychain.getStatus()
      expect(status.available).toBe(true)
      expect(status.hasPrivateKey).toBe(true)
      expect(status.hasPublicKey).toBe(false)
      expect(status.hasIdentityKey).toBe(false)

      // Clean up
      await keychain.deleteAllKeys()
    })
  })

  describe('Service and Account Separation', () => {
    it('should isolate keys by service name', async () => {
      const available = await keychain.isAvailable()
      if (!available) {
        console.log('Keychain not available, skipping test')
        return
      }

      const keychain1 = new KeychainManager({ service: 'bsv-p2p-test1', account: 'test' })
      const keychain2 = new KeychainManager({ service: 'bsv-p2p-test2', account: 'test' })

      await keychain1.setPrivateKey('key1')
      await keychain2.setPrivateKey('key2')

      const key1 = await keychain1.getPrivateKey()
      const key2 = await keychain2.getPrivateKey()

      expect(key1).toBe('key1')
      expect(key2).toBe('key2')

      // Clean up
      await keychain1.deleteAllKeys()
      await keychain2.deleteAllKeys()
    })

    it('should isolate keys by account name', async () => {
      const available = await keychain.isAvailable()
      if (!available) {
        console.log('Keychain not available, skipping test')
        return
      }

      const keychain1 = new KeychainManager({ service: 'bsv-p2p-test', account: 'account1' })
      const keychain2 = new KeychainManager({ service: 'bsv-p2p-test', account: 'account2' })

      await keychain1.setPrivateKey('key1')
      await keychain2.setPrivateKey('key2')

      const key1 = await keychain1.getPrivateKey()
      const key2 = await keychain2.getPrivateKey()

      expect(key1).toBe('key1')
      expect(key2).toBe('key2')

      // Clean up
      await keychain1.deleteAllKeys()
      await keychain2.deleteAllKeys()
    })
  })
})
