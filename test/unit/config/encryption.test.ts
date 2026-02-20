/**
 * Unit tests for config encryption module
 */

import { describe, it, expect } from 'vitest'
import { encryptConfig, decryptConfig, testPassphrase } from '../../../src/config/encryption.js'

describe('Config Encryption', () => {
  const testData = JSON.stringify({
    bsvPrivateKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    port: 4001,
    apiPort: 4002
  })
  const passphrase = 'test-passphrase-12345'

  describe('encryptConfig', () => {
    it('should encrypt config data', async () => {
      const encrypted = await encryptConfig(testData, passphrase)
      
      expect(encrypted.version).toBe(1)
      expect(encrypted.algorithm).toBe('aes-256-gcm')
      expect(encrypted.salt).toMatch(/^[a-f0-9]{64}$/)
      expect(encrypted.iv).toMatch(/^[a-f0-9]{32}$/)
      expect(encrypted.authTag).toMatch(/^[a-f0-9]{32}$/)
      expect(encrypted.ciphertext).toMatch(/^[a-f0-9]+$/)
    })

    it('should produce different ciphertext each time (random salt/IV)', async () => {
      const encrypted1 = await encryptConfig(testData, passphrase)
      const encrypted2 = await encryptConfig(testData, passphrase)
      
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext)
      expect(encrypted1.salt).not.toBe(encrypted2.salt)
      expect(encrypted1.iv).not.toBe(encrypted2.iv)
    })

    it('should handle empty data', async () => {
      const encrypted = await encryptConfig('', passphrase)
      expect(encrypted.ciphertext).toBeDefined()
      
      const decrypted = await decryptConfig(encrypted, passphrase)
      expect(decrypted).toBe('')
    })

    it('should handle large data', async () => {
      const largeData = JSON.stringify({ data: 'x'.repeat(10000) })
      const encrypted = await encryptConfig(largeData, passphrase)
      
      // Ciphertext should be hex-encoded (2 chars per byte)
      // It should be at least as long as the plaintext
      expect(encrypted.ciphertext.length).toBeGreaterThanOrEqual(largeData.length)
      
      // Verify we can decrypt it
      const decrypted = await decryptConfig(encrypted, passphrase)
      expect(decrypted).toBe(largeData)
    })
  })

  describe('decryptConfig', () => {
    it('should decrypt config data with correct passphrase', async () => {
      const encrypted = await encryptConfig(testData, passphrase)
      const decrypted = await decryptConfig(encrypted, passphrase)
      
      expect(decrypted).toBe(testData)
      
      // Verify it's valid JSON
      const parsed = JSON.parse(decrypted)
      expect(parsed.bsvPrivateKey).toBe('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
      expect(parsed.port).toBe(4001)
    })

    it('should fail with wrong passphrase', async () => {
      const encrypted = await encryptConfig(testData, passphrase)
      
      await expect(
        decryptConfig(encrypted, 'wrong-passphrase')
      ).rejects.toThrow('wrong passphrase')
    })

    it('should fail with corrupted ciphertext', async () => {
      const encrypted = await encryptConfig(testData, passphrase)
      encrypted.ciphertext = encrypted.ciphertext.slice(0, -2) + 'ff'
      
      await expect(
        decryptConfig(encrypted, passphrase)
      ).rejects.toThrow()
    })

    it('should fail with corrupted auth tag', async () => {
      const encrypted = await encryptConfig(testData, passphrase)
      encrypted.authTag = encrypted.authTag.slice(0, -2) + 'ff'
      
      await expect(
        decryptConfig(encrypted, passphrase)
      ).rejects.toThrow('wrong passphrase')
    })

    it('should fail with unsupported version', async () => {
      const encrypted = await encryptConfig(testData, passphrase)
      encrypted.version = 999
      
      await expect(
        decryptConfig(encrypted, passphrase)
      ).rejects.toThrow('Unsupported encrypted config version: 999')
    })

    it('should fail with unsupported algorithm', async () => {
      const encrypted = await encryptConfig(testData, passphrase)
      encrypted.algorithm = 'aes-128-cbc'
      
      await expect(
        decryptConfig(encrypted, passphrase)
      ).rejects.toThrow('Unsupported encryption algorithm')
    })
  })

  describe('testPassphrase', () => {
    it('should return true for correct passphrase', async () => {
      const encrypted = await encryptConfig(testData, passphrase)
      const result = await testPassphrase(encrypted, passphrase)
      
      expect(result).toBe(true)
    })

    it('should return false for wrong passphrase', async () => {
      const encrypted = await encryptConfig(testData, passphrase)
      const result = await testPassphrase(encrypted, 'wrong-passphrase')
      
      expect(result).toBe(false)
    })

    it('should return false for corrupted data', async () => {
      const encrypted = await encryptConfig(testData, passphrase)
      encrypted.ciphertext = 'corrupted'
      const result = await testPassphrase(encrypted, passphrase)
      
      expect(result).toBe(false)
    })
  })

  describe('Round-trip encryption', () => {
    it('should preserve data through encrypt/decrypt cycle', async () => {
      const testCases = [
        JSON.stringify({ simple: 'value' }),
        JSON.stringify({ nested: { deep: { value: 123 } } }),
        JSON.stringify({ array: [1, 2, 3, 'test'] }),
        JSON.stringify({ unicode: '你好世界 🚀' }),
        JSON.stringify({ special: 'line\nbreak\ttab' })
      ]

      for (const testCase of testCases) {
        const encrypted = await encryptConfig(testCase, passphrase)
        const decrypted = await decryptConfig(encrypted, passphrase)
        expect(decrypted).toBe(testCase)
      }
    })

    it('should work with different passphrases', async () => {
      const passphrases = [
        'short',
        'medium-length-passphrase',
        'very-long-passphrase-with-lots-of-characters-1234567890',
        'unicode-密码-🔐',
        'special-chars-!@#$%^&*()'
      ]

      for (const pass of passphrases) {
        const encrypted = await encryptConfig(testData, pass)
        const decrypted = await decryptConfig(encrypted, pass)
        expect(decrypted).toBe(testData)
      }
    })
  })

  describe('Security properties', () => {
    it('should use unique salt for each encryption', async () => {
      const salts = new Set<string>()
      
      for (let i = 0; i < 10; i++) {
        const encrypted = await encryptConfig(testData, passphrase)
        expect(salts.has(encrypted.salt)).toBe(false)
        salts.add(encrypted.salt)
      }
    })

    it('should use unique IV for each encryption', async () => {
      const ivs = new Set<string>()
      
      for (let i = 0; i < 10; i++) {
        const encrypted = await encryptConfig(testData, passphrase)
        expect(ivs.has(encrypted.iv)).toBe(false)
        ivs.add(encrypted.iv)
      }
    })

    it('should not leak plaintext in ciphertext', async () => {
      const encrypted = await encryptConfig(testData, passphrase)
      
      // Ciphertext should not contain any plaintext keywords
      expect(encrypted.ciphertext).not.toContain('bsvPrivateKey')
      expect(encrypted.ciphertext).not.toContain('port')
      expect(encrypted.ciphertext).not.toContain('4001')
    })
  })
})
