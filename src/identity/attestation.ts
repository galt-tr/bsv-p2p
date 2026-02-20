/**
 * BSV Identity Key Attestation
 * 
 * Links a libp2p PeerId (Ed25519) to a BSV identity key (secp256k1)
 * via a signed attestation that can be verified by other peers.
 * 
 * The attestation proves that the holder of the libp2p private key
 * also controls the BSV identity key, enabling payment channels.
 */

import { PrivateKey, PublicKey, Signature, Hash } from '@bsv/sdk'
import { createEd25519PeerId } from '@libp2p/peer-id-factory'
import { unmarshalPrivateKey } from '@libp2p/crypto/keys'
import type { PeerId } from '@libp2p/interface'

export interface IdentityAttestation {
  /** The libp2p peer ID (base58) */
  peerId: string
  
  /** The BSV identity public key (hex) */
  bsvIdentityKey: string
  
  /** Timestamp of attestation creation */
  timestamp: number
  
  /** Signature of (peerId + bsvIdentityKey + timestamp) signed by BSV private key */
  signature: string
  
  /** Version of attestation format */
  version: number
}

const ATTESTATION_VERSION = 1

/**
 * Create an identity attestation linking a libp2p PeerId to a BSV identity key
 */
export function createAttestation(
  peerId: PeerId,
  bsvPrivateKey: PrivateKey
): IdentityAttestation {
  const bsvPublicKey = bsvPrivateKey.toPublicKey()
  const timestamp = Date.now()
  
  // Message to sign: peerId + bsvPublicKey + timestamp
  const message = `${peerId.toString()}:${bsvPublicKey.toString()}:${timestamp}`
  const messageHash = Hash.sha256(Buffer.from(message, 'utf8'))
  
  // Sign with BSV private key
  const rawSig = bsvPrivateKey.sign(messageHash)
  const signature = new Signature(rawSig.r, rawSig.s)
  
  return {
    peerId: peerId.toString(),
    bsvIdentityKey: bsvPublicKey.toString(),
    timestamp,
    signature: signature.toDER().toString('hex'),
    version: ATTESTATION_VERSION
  }
}

/**
 * Verify an identity attestation
 */
export function verifyAttestation(attestation: IdentityAttestation): {
  valid: boolean
  error?: string
} {
  try {
    // Check version
    if (attestation.version !== ATTESTATION_VERSION) {
      return { valid: false, error: `Unsupported version: ${attestation.version}` }
    }
    
    // Check timestamp (allow 1 hour clock skew, reject if older than 24 hours)
    const now = Date.now()
    const age = now - attestation.timestamp
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours
    const maxSkew = 60 * 60 * 1000 // 1 hour
    
    if (attestation.timestamp > now + maxSkew) {
      return { valid: false, error: 'Attestation timestamp in future' }
    }
    
    if (age > maxAge) {
      return { valid: false, error: 'Attestation expired (older than 24 hours)' }
    }
    
    // Reconstruct message
    const message = `${attestation.peerId}:${attestation.bsvIdentityKey}:${attestation.timestamp}`
    const messageHash = Hash.sha256(Buffer.from(message, 'utf8'))
    
    // Parse signature and public key
    const signature = Signature.fromDER(Buffer.from(attestation.signature, 'hex'))
    const publicKey = PublicKey.fromString(attestation.bsvIdentityKey)
    
    // Verify signature - correct API is publicKey.verify(hash, sig)
    const valid = publicKey.verify(messageHash, signature)
    
    if (!valid) {
      return { valid: false, error: 'Invalid signature' }
    }
    
    return { valid: true }
  } catch (err: any) {
    return { valid: false, error: `Verification failed: ${err.message}` }
  }
}

/**
 * Extract BSV identity key from a verified attestation
 */
export function extractBsvKey(attestation: IdentityAttestation): string | null {
  const verification = verifyAttestation(attestation)
  if (!verification.valid) {
    return null
  }
  return attestation.bsvIdentityKey
}

/**
 * Serialize attestation to JSON
 */
export function serializeAttestation(attestation: IdentityAttestation): string {
  return JSON.stringify(attestation)
}

/**
 * Deserialize attestation from JSON
 */
export function deserializeAttestation(json: string): IdentityAttestation {
  return JSON.parse(json) as IdentityAttestation
}

/**
 * Create a compact string representation for peer announcements
 * Format: version:peerId:bsvKey:timestamp:signature
 */
export function toCompactString(attestation: IdentityAttestation): string {
  return [
    attestation.version,
    attestation.peerId,
    attestation.bsvIdentityKey,
    attestation.timestamp,
    attestation.signature
  ].join(':')
}

/**
 * Parse compact string representation
 */
export function fromCompactString(compact: string): IdentityAttestation | null {
  try {
    const parts = compact.split(':')
    if (parts.length !== 5) {
      return null
    }
    
    return {
      version: parseInt(parts[0], 10),
      peerId: parts[1],
      bsvIdentityKey: parts[2],
      timestamp: parseInt(parts[3], 10),
      signature: parts[4]
    }
  } catch {
    return null
  }
}
