/**
 * OS Keychain Integration for Secure Private Key Storage
 * 
 * Stores BSV private keys in platform-native keychains:
 * - macOS: Keychain Access
 * - Linux: Secret Service (GNOME Keyring, KWallet)
 * - Windows: Credential Manager
 * 
 * This is significantly more secure than plaintext config files.
 */

import { Keyring } from '@napi-rs/keyring'

export interface KeychainConfig {
  service?: string
  account?: string
}

/**
 * KeychainManager wraps the OS keychain for storing BSV keys.
 * 
 * Keys stored:
 * - bsv-private-key: BSV wallet private key (hex)
 * - bsv-public-key: BSV wallet public key (hex)
 * - bsv-identity-key: libp2p identity private key (hex)
 */
export class KeychainManager {
  private readonly service: string
  private readonly account: string

  constructor(config: KeychainConfig = {}) {
    this.service = config.service ?? 'bsv-p2p'
    this.account = config.account ?? 'default'
  }

  /**
   * Store BSV private key in OS keychain
   */
  async setPrivateKey(privateKey: string): Promise<void> {
    const keyring = new Keyring(this.service, `${this.account}:bsv-private-key`)
    await keyring.setPassword(privateKey)
  }

  /**
   * Retrieve BSV private key from OS keychain
   * 
   * @returns Private key (hex) or null if not found
   */
  async getPrivateKey(): Promise<string | null> {
    try {
      const keyring = new Keyring(this.service, `${this.account}:bsv-private-key`)
      return await keyring.getPassword()
    } catch (error: any) {
      // Key not found or keychain unavailable
      return null
    }
  }

  /**
   * Store BSV public key in OS keychain
   */
  async setPublicKey(publicKey: string): Promise<void> {
    const keyring = new Keyring(this.service, `${this.account}:bsv-public-key`)
    await keyring.setPassword(publicKey)
  }

  /**
   * Retrieve BSV public key from OS keychain
   */
  async getPublicKey(): Promise<string | null> {
    try {
      const keyring = new Keyring(this.service, `${this.account}:bsv-public-key`)
      return await keyring.getPassword()
    } catch (error: any) {
      return null
    }
  }

  /**
   * Store libp2p identity key in OS keychain
   */
  async setIdentityKey(identityKey: string): Promise<void> {
    const keyring = new Keyring(this.service, `${this.account}:bsv-identity-key`)
    await keyring.setPassword(identityKey)
  }

  /**
   * Retrieve libp2p identity key from OS keychain
   */
  async getIdentityKey(): Promise<string | null> {
    try {
      const keyring = new Keyring(this.service, `${this.account}:bsv-identity-key`)
      return await keyring.getPassword()
    } catch (error: any) {
      return null
    }
  }

  /**
   * Delete BSV private key from OS keychain
   */
  async deletePrivateKey(): Promise<void> {
    try {
      const keyring = new Keyring(this.service, `${this.account}:bsv-private-key`)
      await keyring.deletePassword()
    } catch {
      // Ignore if already deleted
    }
  }

  /**
   * Delete BSV public key from OS keychain
   */
  async deletePublicKey(): Promise<void> {
    try {
      const keyring = new Keyring(this.service, `${this.account}:bsv-public-key`)
      await keyring.deletePassword()
    } catch {
      // Ignore if already deleted
    }
  }

  /**
   * Delete libp2p identity key from OS keychain
   */
  async deleteIdentityKey(): Promise<void> {
    try {
      const keyring = new Keyring(this.service, `${this.account}:bsv-identity-key`)
      await keyring.deletePassword()
    } catch {
      // Ignore if already deleted
    }
  }

  /**
   * Delete all BSV keys from OS keychain
   */
  async deleteAllKeys(): Promise<void> {
    await this.deletePrivateKey()
    await this.deletePublicKey()
    await this.deleteIdentityKey()
  }

  /**
   * Check if keychain is available on this system
   * 
   * @returns true if keychain can be accessed
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Try to read/write a test value
      const testKeyring = new Keyring(this.service, 'test')
      await testKeyring.setPassword('test-value')
      const value = await testKeyring.getPassword()
      await testKeyring.deletePassword()
      return value === 'test-value'
    } catch {
      return false
    }
  }

  /**
   * Get keychain status for all keys
   * 
   * @returns Object with key presence flags
   */
  async getStatus(): Promise<{
    available: boolean
    hasPrivateKey: boolean
    hasPublicKey: boolean
    hasIdentityKey: boolean
  }> {
    const available = await this.isAvailable()
    
    if (!available) {
      return {
        available: false,
        hasPrivateKey: false,
        hasPublicKey: false,
        hasIdentityKey: false
      }
    }

    const [privateKey, publicKey, identityKey] = await Promise.all([
      this.getPrivateKey(),
      this.getPublicKey(),
      this.getIdentityKey()
    ])

    return {
      available: true,
      hasPrivateKey: privateKey !== null,
      hasPublicKey: publicKey !== null,
      hasIdentityKey: identityKey !== null
    }
  }
}

/**
 * Create a default KeychainManager instance
 */
export function createKeychainManager(config?: KeychainConfig): KeychainManager {
  return new KeychainManager(config)
}
