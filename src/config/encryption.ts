/**
 * Config file encryption module
 * 
 * Implements AES-256-GCM encryption with scrypt KDF for secure config storage
 * when OS keychain is unavailable (e.g., headless Linux, Docker)
 */

import { scrypt, randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { promisify } from 'util'

const scryptAsync = promisify(scrypt)

// Encryption parameters
// Note: N=16384 (2^14) is a balance between security and performance
// For production, consider N=32768 or higher if memory allows
const SCRYPT_N = 16384  // CPU/memory cost parameter (2^14)
const SCRYPT_R = 8      // Block size
const SCRYPT_P = 1      // Parallelization
const KEY_LENGTH = 32   // 256 bits for AES-256
const IV_LENGTH = 16    // 128 bits for GCM
const SALT_LENGTH = 32  // 256 bits

/**
 * Encrypted config file structure
 */
export interface EncryptedConfig {
  version: number          // Format version (for future compatibility)
  algorithm: string        // 'aes-256-gcm'
  salt: string            // Hex-encoded salt for KDF
  iv: string              // Hex-encoded initialization vector
  authTag: string         // Hex-encoded authentication tag (GCM)
  ciphertext: string      // Hex-encoded encrypted data
}

/**
 * Encrypt config data with AES-256-GCM
 * 
 * @param data - JSON string to encrypt
 * @param passphrase - User passphrase for encryption
 * @returns Encrypted config structure
 */
export async function encryptConfig(data: string, passphrase: string): Promise<EncryptedConfig> {
  // Generate random salt and IV
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  
  // Derive encryption key from passphrase using scrypt
  const key = await scryptAsync(passphrase, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  }) as Buffer
  
  // Encrypt data
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final()
  ])
  
  // Get authentication tag (for GCM authenticated encryption)
  const authTag = cipher.getAuthTag()
  
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted.toString('hex')
  }
}

/**
 * Decrypt config data with AES-256-GCM
 * 
 * @param config - Encrypted config structure
 * @param passphrase - User passphrase for decryption
 * @returns Decrypted JSON string
 * @throws Error if passphrase is wrong or data is corrupted
 */
export async function decryptConfig(config: EncryptedConfig, passphrase: string): Promise<string> {
  // Verify format version
  if (config.version !== 1) {
    throw new Error(`Unsupported encrypted config version: ${config.version}`)
  }
  
  if (config.algorithm !== 'aes-256-gcm') {
    throw new Error(`Unsupported encryption algorithm: ${config.algorithm}`)
  }
  
  // Derive decryption key from passphrase using same parameters
  const key = await scryptAsync(
    passphrase,
    Buffer.from(config.salt, 'hex'),
    KEY_LENGTH,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }
  ) as Buffer
  
  try {
    // Decrypt data
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(config.iv, 'hex')
    )
    
    // Set authentication tag for verification
    decipher.setAuthTag(Buffer.from(config.authTag, 'hex'))
    
    const decrypted = decipher.update(config.ciphertext, 'hex', 'utf8') + decipher.final('utf8')
    
    return decrypted
  } catch (err: any) {
    if (err.message.includes('auth')) {
      throw new Error('Decryption failed: wrong passphrase or corrupted data')
    }
    throw err
  }
}

/**
 * Test if a passphrase can decrypt an encrypted config
 * 
 * @param config - Encrypted config structure
 * @param passphrase - Passphrase to test
 * @returns True if passphrase is correct
 */
export async function testPassphrase(config: EncryptedConfig, passphrase: string): Promise<boolean> {
  try {
    await decryptConfig(config, passphrase)
    return true
  } catch {
    return false
  }
}
