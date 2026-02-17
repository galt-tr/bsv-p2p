import { describe, it, expect, beforeEach } from 'vitest'
import { ChannelManager } from '../../src/channels/manager.js'
import { Channel, ChannelPayment } from '../../src/channels/types.js'

describe('ChannelManager', () => {
  let manager: ChannelManager
  
  // Test keys (not real, just for testing)
  const testPrivateKey = '0000000000000000000000000000000000000000000000000000000000000001'
  const testPublicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
  const remotePubKey = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'

  beforeEach(() => {
    manager = new ChannelManager({
      privateKey: testPrivateKey,
      publicKey: testPublicKey
    })
  })

  describe('createChannel', () => {
    it('should create a new channel', async () => {
      const channel = await manager.createChannel(
        'remote-peer-id',
        remotePubKey,
        10000  // 10000 sats
      )

      expect(channel.id).toBeTruthy()
      expect(channel.state).toBe('pending')
      expect(channel.capacity).toBe(10000)
      expect(channel.localBalance).toBe(10000)  // Initiator has all funds
      expect(channel.remoteBalance).toBe(0)
      expect(channel.sequenceNumber).toBe(0)
      expect(channel.localPubKey).toBe(testPublicKey)
      expect(channel.remotePubKey).toBe(remotePubKey)
    })

    it('should reject channel below minimum capacity', async () => {
      await expect(
        manager.createChannel('remote', remotePubKey, 100)  // Below 1000 minimum
      ).rejects.toThrow('must be at least')
    })

    it('should reject channel above maximum capacity', async () => {
      await expect(
        manager.createChannel('remote', remotePubKey, 200_000_000)  // Above 1 BSV
      ).rejects.toThrow('cannot exceed')
    })

    it('should set nLockTime based on lifetime', async () => {
      const lifetimeMs = 2 * 60 * 60 * 1000  // 2 hours
      const before = Math.floor((Date.now() + lifetimeMs) / 1000)
      
      const channel = await manager.createChannel(
        'remote',
        remotePubKey,
        10000,
        lifetimeMs
      )
      
      const after = Math.floor((Date.now() + lifetimeMs) / 1000)
      
      expect(channel.nLockTime).toBeGreaterThanOrEqual(before)
      expect(channel.nLockTime).toBeLessThanOrEqual(after)
    })
  })

  describe('acceptChannel', () => {
    it('should accept a channel request', async () => {
      const channel = await manager.acceptChannel(
        'channel-123',
        'local-peer-id',
        'remote-peer-id',
        remotePubKey,
        10000,
        Math.floor(Date.now() / 1000) + 3600
      )

      expect(channel.id).toBe('channel-123')
      expect(channel.state).toBe('pending')
      expect(channel.capacity).toBe(10000)
      expect(channel.localBalance).toBe(0)  // Responder starts with 0
      expect(channel.remoteBalance).toBe(10000)  // Initiator has all
    })
  })

  describe('channel lifecycle', () => {
    let channel: Channel

    beforeEach(async () => {
      channel = await manager.createChannel('remote', remotePubKey, 10000)
    })

    it('should set funding transaction', () => {
      manager.setFundingTx(channel.id, 'txid123', 0)
      
      const updated = manager.getChannel(channel.id)
      expect(updated?.fundingTxId).toBe('txid123')
      expect(updated?.fundingOutputIndex).toBe(0)
    })

    it('should open channel after funding', () => {
      manager.setFundingTx(channel.id, 'txid123', 0)
      manager.openChannel(channel.id)
      
      const updated = manager.getChannel(channel.id)
      expect(updated?.state).toBe('open')
    })

    it('should throw when opening non-pending channel', () => {
      manager.openChannel(channel.id)
      
      expect(() => manager.openChannel(channel.id)).toThrow('Cannot open channel')
    })
  })

  describe('payments', () => {
    let channel: Channel

    beforeEach(async () => {
      channel = await manager.createChannel('remote', remotePubKey, 10000)
      manager.setFundingTx(channel.id, 'txid123', 0)
      manager.openChannel(channel.id)
    })

    it('should create outgoing payment', async () => {
      const payment = await manager.createPayment(channel.id, 1000)

      expect(payment.channelId).toBe(channel.id)
      expect(payment.amount).toBe(1000)
      expect(payment.newSequenceNumber).toBe(1)
      expect(payment.newLocalBalance).toBe(9000)
      expect(payment.newRemoteBalance).toBe(1000)

      const updated = manager.getChannel(channel.id)
      expect(updated?.localBalance).toBe(9000)
      expect(updated?.remoteBalance).toBe(1000)
      expect(updated?.sequenceNumber).toBe(1)
    })

    it('should reject payment exceeding balance', async () => {
      await expect(
        manager.createPayment(channel.id, 15000)
      ).rejects.toThrow('Insufficient balance')
    })

    it('should handle multiple payments', async () => {
      await manager.createPayment(channel.id, 1000)
      await manager.createPayment(channel.id, 2000)
      await manager.createPayment(channel.id, 500)

      const updated = manager.getChannel(channel.id)
      expect(updated?.localBalance).toBe(6500)  // 10000 - 3500
      expect(updated?.remoteBalance).toBe(3500)
      expect(updated?.sequenceNumber).toBe(3)
    })

    it('should process incoming payment', async () => {
      // Simulate receiving a payment from the remote party
      const incomingPayment: ChannelPayment = {
        channelId: channel.id,
        amount: 500,
        newSequenceNumber: 1,
        newLocalBalance: 500,  // From remote's perspective
        newRemoteBalance: 9500,  // From remote's perspective
        signature: '',
        timestamp: Date.now()
      }

      await manager.processPayment(incomingPayment)

      const updated = manager.getChannel(channel.id)
      // Our local = their remote, our remote = their local
      expect(updated?.localBalance).toBe(9500)
      expect(updated?.remoteBalance).toBe(500)
      expect(updated?.sequenceNumber).toBe(1)
    })

    it('should reject payment with wrong sequence', async () => {
      const badPayment: ChannelPayment = {
        channelId: channel.id,
        amount: 500,
        newSequenceNumber: 5,  // Wrong - should be 1
        newLocalBalance: 500,
        newRemoteBalance: 9500,
        signature: '',
        timestamp: Date.now()
      }

      await expect(
        manager.processPayment(badPayment)
      ).rejects.toThrow('Invalid sequence number')
    })
  })

  describe('channel close', () => {
    let channel: Channel

    beforeEach(async () => {
      channel = await manager.createChannel('remote', remotePubKey, 10000)
      manager.setFundingTx(channel.id, 'txid123', 0)
      manager.openChannel(channel.id)
      await manager.createPayment(channel.id, 3000)  // Send some payments
    })

    it('should initiate cooperative close', async () => {
      const closeRequest = await manager.closeChannel(channel.id)

      expect(closeRequest.channelId).toBe(channel.id)
      expect(closeRequest.type).toBe('cooperative')
      expect(closeRequest.finalSequenceNumber).toBe(1)
      expect(closeRequest.finalLocalBalance).toBe(7000)
      expect(closeRequest.finalRemoteBalance).toBe(3000)

      const updated = manager.getChannel(channel.id)
      expect(updated?.state).toBe('closing')
    })

    it('should finalize channel close', async () => {
      await manager.closeChannel(channel.id)
      manager.finalizeClose(channel.id, 'close-txid')

      const updated = manager.getChannel(channel.id)
      expect(updated?.state).toBe('closed')
    })
  })

  describe('queries', () => {
    beforeEach(async () => {
      // Create multiple channels
      const ch1 = await manager.createChannel('peer1', remotePubKey, 10000)
      const ch2 = await manager.createChannel('peer2', remotePubKey, 20000)
      const ch3 = await manager.createChannel('peer1', remotePubKey, 5000)

      // Open ch1 and ch2
      manager.openChannel(ch1.id)
      manager.openChannel(ch2.id)
      
      // Make some payments on ch1
      await manager.createPayment(ch1.id, 3000)
    })

    it('should get all channels', () => {
      const channels = manager.getAllChannels()
      expect(channels).toHaveLength(3)
    })

    it('should get channels by peer', () => {
      const channels = manager.getChannelsByPeer('peer1')
      expect(channels).toHaveLength(2)
    })

    it('should get open channels', () => {
      const channels = manager.getOpenChannels()
      expect(channels).toHaveLength(2)
    })

    it('should calculate total balance', () => {
      const total = manager.getTotalBalance()
      // ch1: 10000 - 3000 = 7000
      // ch2: 20000
      expect(total).toBe(27000)
    })
  })
})
