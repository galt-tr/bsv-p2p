/**
 * Tests for BSV Services
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PrivateKey, PublicKey } from '@bsv/sdk'
import * as bsvServices from '../../src/channels/bsv-services'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch as any

describe('BSV Services', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })
  
  afterEach(() => {
    vi.restoreAllMocks()
  })
  
  describe('fetchTransaction', () => {
    it('should fetch transaction hex and info', async () => {
      // Mock WoC responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '0100000001...' // hex
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            txid: 'abc123',
            blockheight: 800000,
            blockhash: 'blockhash123'
          })
        })
      
      const result = await bsvServices.fetchTransaction('abc123')
      
      expect(result.txid).toBe('abc123')
      expect(result.hex).toBe('0100000001...')
      expect(result.blockHeight).toBe(800000)
      expect(result.blockHash).toBe('blockhash123')
    })
    
    it('should handle unconfirmed transactions', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '0100000001...'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            txid: 'abc123'
            // No blockheight = unconfirmed
          })
        })
      
      const result = await bsvServices.fetchTransaction('abc123')
      
      expect(result.blockHeight).toBeUndefined()
    })
  })
  
  describe('broadcastTransaction', () => {
    it('should broadcast and return txid', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '"abc123"'
      })
      
      const txid = await bsvServices.broadcastTransaction('0100000001...')
      
      expect(txid).toBe('abc123')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.whatsonchain.com/v1/bsv/main/tx/raw',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ txhex: '0100000001...' })
        })
      )
    })
    
    it('should throw on broadcast failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Transaction rejected'
      })
      
      await expect(bsvServices.broadcastTransaction('invalid'))
        .rejects.toThrow('Broadcast failed')
    })
  })
  
  describe('verifyMerkleRoot', () => {
    it('should verify valid merkle root', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          merkleRoot: 'abc123'
        })
      })
      
      const valid = await bsvServices.verifyMerkleRoot('abc123', 800000)
      
      expect(valid).toBe(true)
    })
    
    it('should reject invalid merkle root', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          merkleRoot: 'different'
        })
      })
      
      const valid = await bsvServices.verifyMerkleRoot('abc123', 800000)
      
      expect(valid).toBe(false)
    })
    
    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found'
      })
      
      const valid = await bsvServices.verifyMerkleRoot('abc123', 800000)
      
      expect(valid).toBe(false)
    })
  })
  
  describe('getCurrentHeight', () => {
    it('should fetch height from ChainTracks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => 800000
      })
      
      const height = await bsvServices.getCurrentHeight()
      
      expect(height).toBe(800000)
    })
    
    it('should fallback to WoC on ChainTracks failure', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Error'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ blocks: 800001 })
        })
      
      const height = await bsvServices.getCurrentHeight()
      
      expect(height).toBe(800001)
    })
  })
  
  describe('BRC-42 Key Derivation', () => {
    it('should derive channel keys deterministically', () => {
      const masterKey = PrivateKey.fromRandom()
      const counterpartyPubKey = PrivateKey.fromRandom().toPublicKey()
      const channelId = 'test-channel-123'
      
      // Derive twice, should be same
      const key1 = bsvServices.deriveChannelKey(masterKey, counterpartyPubKey, channelId)
      const key2 = bsvServices.deriveChannelKey(masterKey, counterpartyPubKey, channelId)
      
      expect(key1.toHex()).toBe(key2.toHex())
    })
    
    it('should derive different keys for different channels', () => {
      const masterKey = PrivateKey.fromRandom()
      const counterpartyPubKey = PrivateKey.fromRandom().toPublicKey()
      
      const key1 = bsvServices.deriveChannelKey(masterKey, counterpartyPubKey, 'channel-1')
      const key2 = bsvServices.deriveChannelKey(masterKey, counterpartyPubKey, 'channel-2')
      
      expect(key1.toHex()).not.toBe(key2.toHex())
    })
    
    it('should derive different keys for different counterparties', () => {
      const masterKey = PrivateKey.fromRandom()
      const counterparty1 = PrivateKey.fromRandom().toPublicKey()
      const counterparty2 = PrivateKey.fromRandom().toPublicKey()
      const channelId = 'same-channel'
      
      const key1 = bsvServices.deriveChannelKey(masterKey, counterparty1, channelId)
      const key2 = bsvServices.deriveChannelKey(masterKey, counterparty2, channelId)
      
      expect(key1.toHex()).not.toBe(key2.toHex())
    })
    
    it('should enable derived public key calculation', () => {
      const aliceMaster = PrivateKey.fromRandom()
      const bobMaster = PrivateKey.fromRandom()
      const channelId = 'shared-channel'
      
      // Alice derives her channel key using Bob's public key
      const aliceChannelKey = aliceMaster.deriveChild(bobMaster.toPublicKey(), `channel:${channelId}`)
      
      // Bob can derive Alice's channel PUBLIC key using her public key and his private key
      const aliceChannelPubKeyFromBob = aliceMaster.toPublicKey().deriveChild(
        bobMaster, 
        `channel:${channelId}`
      )
      
      // Should match!
      expect(aliceChannelKey.toPublicKey().encode(true))
        .toEqual(aliceChannelPubKeyFromBob.encode(true))
    })
  })
})
