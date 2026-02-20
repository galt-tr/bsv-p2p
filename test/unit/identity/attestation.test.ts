import { describe, it, expect } from 'vitest'
import {
  createAttestation,
  verifyAttestation,
  extractBsvKey,
  serializeAttestation,
  deserializeAttestation,
  toCompactString,
  fromCompactString
} from '../../../src/identity/attestation.js'
import { PrivateKey } from '@bsv/sdk'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'

async function createTestPeerId() {
  const privateKey = await generateKeyPair('Ed25519')
  return peerIdFromPrivateKey(privateKey)
}

describe('Identity Attestation', () => {
  describe('Attestation Creation', () => {
    it('should create a valid attestation', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const attestation = createAttestation(peerId, bsvKey)
      
      expect(attestation.peerId).toBe(peerId.toString())
      expect(attestation.bsvIdentityKey).toBe(bsvKey.toPublicKey().toString())
      expect(attestation.timestamp).toBeGreaterThan(0)
      expect(attestation.signature).toBeTruthy()
      expect(attestation.version).toBe(1)
    })

    it('should create different attestations for different keys', async () => {
      const peerId = await createTestPeerId()
      const bsvKey1 = PrivateKey.fromRandom()
      const bsvKey2 = PrivateKey.fromRandom()
      
      const attestation1 = createAttestation(peerId, bsvKey1)
      const attestation2 = createAttestation(peerId, bsvKey2)
      
      expect(attestation1.signature).not.toBe(attestation2.signature)
      expect(attestation1.bsvIdentityKey).not.toBe(attestation2.bsvIdentityKey)
    })

    it('should include timestamp in attestation', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const before = Date.now()
      const attestation = createAttestation(peerId, bsvKey)
      const after = Date.now()
      
      expect(attestation.timestamp).toBeGreaterThanOrEqual(before)
      expect(attestation.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('Attestation Verification', () => {
    it('should verify a valid attestation', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const attestation = createAttestation(peerId, bsvKey)
      const result = verifyAttestation(attestation)
      
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should reject attestation with wrong signature', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const attestation = createAttestation(peerId, bsvKey)
      
      // Tamper with signature
      attestation.signature = 'invalid_signature_hex'
      
      const result = verifyAttestation(attestation)
      expect(result.valid).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('should reject attestation with tampered peerId', async () => {
      const peerId1 = await createTestPeerId()
      const peerId2 = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const attestation = createAttestation(peerId1, bsvKey)
      
      // Tamper with peerId
      attestation.peerId = peerId2.toString()
      
      const result = verifyAttestation(attestation)
      expect(result.valid).toBe(false)
    })

    it('should reject attestation with tampered bsvIdentityKey', async () => {
      const peerId = await createTestPeerId()
      const bsvKey1 = PrivateKey.fromRandom()
      const bsvKey2 = PrivateKey.fromRandom()
      
      const attestation = createAttestation(peerId, bsvKey1)
      
      // Tamper with bsvIdentityKey
      attestation.bsvIdentityKey = bsvKey2.toPublicKey().toString()
      
      const result = verifyAttestation(attestation)
      expect(result.valid).toBe(false)
    })

    it('should reject attestation with future timestamp', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const attestation = createAttestation(peerId, bsvKey)
      
      // Set timestamp 2 hours in future
      attestation.timestamp = Date.now() + 2 * 60 * 60 * 1000
      
      const result = verifyAttestation(attestation)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('future')
    })

    it('should reject expired attestation', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const attestation = createAttestation(peerId, bsvKey)
      
      // Set timestamp 25 hours in past (older than 24h max)
      attestation.timestamp = Date.now() - 25 * 60 * 60 * 1000
      
      const result = verifyAttestation(attestation)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('expired')
    })

    it('should reject unsupported version', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const attestation = createAttestation(peerId, bsvKey)
      attestation.version = 999
      
      const result = verifyAttestation(attestation)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('version')
    })
  })

  describe('Key Extraction', () => {
    it('should extract BSV key from valid attestation', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const attestation = createAttestation(peerId, bsvKey)
      const extracted = extractBsvKey(attestation)
      
      expect(extracted).toBe(bsvKey.toPublicKey().toString())
    })

    it('should return null for invalid attestation', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const attestation = createAttestation(peerId, bsvKey)
      attestation.signature = 'invalid'
      
      const extracted = extractBsvKey(attestation)
      expect(extracted).toBeNull()
    })
  })

  describe('Serialization', () => {
    it('should serialize and deserialize attestation', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const original = createAttestation(peerId, bsvKey)
      const json = serializeAttestation(original)
      const restored = deserializeAttestation(json)
      
      expect(restored.peerId).toBe(original.peerId)
      expect(restored.bsvIdentityKey).toBe(original.bsvIdentityKey)
      expect(restored.timestamp).toBe(original.timestamp)
      expect(restored.signature).toBe(original.signature)
      expect(restored.version).toBe(original.version)
    })

    it('should maintain validity after serialization', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const original = createAttestation(peerId, bsvKey)
      const json = serializeAttestation(original)
      const restored = deserializeAttestation(json)
      
      const result = verifyAttestation(restored)
      expect(result.valid).toBe(true)
    })
  })

  describe('Compact String Format', () => {
    it('should convert to compact string', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const attestation = createAttestation(peerId, bsvKey)
      const compact = toCompactString(attestation)
      
      expect(compact).toContain(':')
      expect(compact.split(':')).toHaveLength(5)
    })

    it('should parse compact string', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const original = createAttestation(peerId, bsvKey)
      const compact = toCompactString(original)
      const parsed = fromCompactString(compact)
      
      expect(parsed).not.toBeNull()
      expect(parsed!.peerId).toBe(original.peerId)
      expect(parsed!.bsvIdentityKey).toBe(original.bsvIdentityKey)
      expect(parsed!.timestamp).toBe(original.timestamp)
      expect(parsed!.signature).toBe(original.signature)
      expect(parsed!.version).toBe(original.version)
    })

    it('should maintain validity after compact conversion', async () => {
      const peerId = await createTestPeerId()
      const bsvKey = PrivateKey.fromRandom()
      
      const original = createAttestation(peerId, bsvKey)
      const compact = toCompactString(original)
      const parsed = fromCompactString(compact)
      
      expect(parsed).not.toBeNull()
      const result = verifyAttestation(parsed!)
      expect(result.valid).toBe(true)
    })

    it('should return null for invalid compact string', () => {
      const parsed = fromCompactString('invalid:format')
      expect(parsed).toBeNull()
    })
  })
})
