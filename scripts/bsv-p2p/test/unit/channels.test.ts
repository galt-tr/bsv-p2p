import { describe, it, expect, beforeEach } from 'vitest'
import { ChannelManager } from '../../src/channels/manager.js'
import { Channel, ChannelPayment } from '../../src/channels/types.js'

describe('ChannelManager', () => {
  let manager: ChannelManager
  let remoteManager: ChannelManager
  
  // Test keys (deterministic for testing)
  const testPrivateKey = '0000000000000000000000000000000000000000000000000000000000000001'
  const testPublicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
  const testAddress = '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH'
  
  const remotePrivateKey = '0000000000000000000000000000000000000000000000000000000000000002'
  const remotePubKey = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
  const remoteAddress = '1cMh228HTCiwS8ZsaakH8A8wze1JR5ZsP'

  beforeEach(() => {
    manager = new ChannelManager({
      privateKey: testPrivateKey,
      publicKey: testPublicKey,
      address: testAddress
    })
    
    // Create a remote manager for two-party tests
    remoteManager = new ChannelManager({
      privateKey: remotePrivateKey,
      publicKey: remotePubKey,
      address: remoteAddress
    })
  })

  describe('createChannel', () => {
    it('should create a new channel', async () => {
      const channel = await manager.createChannel(
        'remote-peer-id',
        remotePubKey,
        remoteAddress,
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
      expect(channel.localAddress).toBe(testAddress)
      expect(channel.remoteAddress).toBe(remoteAddress)
      expect(channel.fundingScript).toBeTruthy()  // Should have cached script
    })

    it('should reject channel below minimum capacity', async () => {
      await expect(
        manager.createChannel('remote', remotePubKey, remoteAddress, 100)  // Below 1000 minimum
      ).rejects.toThrow('must be at least')
    })

    it('should reject channel above maximum capacity', async () => {
      await expect(
        manager.createChannel('remote', remotePubKey, remoteAddress, 200_000_000)  // Above 1 BSV
      ).rejects.toThrow('cannot exceed')
    })

    it('should set nLockTime based on lifetime', async () => {
      const lifetimeMs = 2 * 60 * 60 * 1000  // 2 hours
      const before = Math.floor((Date.now() + lifetimeMs) / 1000)
      
      const channel = await manager.createChannel(
        'remote',
        remotePubKey,
        remoteAddress,
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
        remoteAddress,
        10000,
        Math.floor(Date.now() / 1000) + 3600
      )

      expect(channel.id).toBe('channel-123')
      expect(channel.state).toBe('pending')
      expect(channel.capacity).toBe(10000)
      expect(channel.localBalance).toBe(0)  // Responder starts with 0
      expect(channel.remoteBalance).toBe(10000)  // Initiator has all
      expect(channel.fundingScript).toBeTruthy()
    })
  })

  describe('channel lifecycle', () => {
    let channel: Channel

    beforeEach(async () => {
      channel = await manager.createChannel('remote', remotePubKey, remoteAddress, 10000)
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

  describe('payments with real signatures', () => {
    let channel: Channel

    beforeEach(async () => {
      channel = await manager.createChannel('remote', remotePubKey, remoteAddress, 10000)
      manager.setFundingTx(channel.id, 'a'.repeat(64), 0)  // Fake but valid-length txid
      manager.openChannel(channel.id)
    })

    it('should create outgoing payment with real signature', async () => {
      const payment = await manager.createPayment(channel.id, 1000)

      expect(payment.channelId).toBe(channel.id)
      expect(payment.amount).toBe(1000)
      expect(payment.newSequenceNumber).toBe(1)
      expect(payment.newLocalBalance).toBe(9000)
      expect(payment.newRemoteBalance).toBe(1000)
      expect(payment.signature).toBeTruthy()
      expect(payment.signature.length).toBeGreaterThan(100)  // Real DER signature

      const updated = manager.getChannel(channel.id)
      expect(updated?.localBalance).toBe(9000)
      expect(updated?.remoteBalance).toBe(1000)
      expect(updated?.sequenceNumber).toBe(1)
      expect(updated?.latestCommitmentTx).toBeTruthy()
      expect(updated?.latestLocalSignature).toBe(payment.signature)
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
  })

  describe('two-party payment flow', () => {
    let localChannel: Channel
    let remoteChannel: Channel
    const fundingTxId = 'b'.repeat(64)

    beforeEach(async () => {
      // Local party initiates channel
      localChannel = await manager.createChannel('remote-peer', remotePubKey, remoteAddress, 10000)
      manager.setFundingTx(localChannel.id, fundingTxId, 0)
      
      // Remote party accepts with same channel ID
      remoteChannel = await remoteManager.acceptChannel(
        localChannel.id,
        'remote-peer',
        'local-peer',
        testPublicKey,
        testAddress,
        10000,
        localChannel.nLockTime
      )
      remoteManager.setFundingTx(remoteChannel.id, fundingTxId, 0)
      
      // Both open
      manager.openChannel(localChannel.id)
      remoteManager.openChannel(remoteChannel.id)
    })

    it('should verify payment signatures between parties', async () => {
      // Local sends payment to remote
      const payment = await manager.createPayment(localChannel.id, 1000)
      
      // Remote processes and verifies the signature
      await remoteManager.processPayment(payment)
      
      const updatedRemote = remoteManager.getChannel(remoteChannel.id)
      expect(updatedRemote?.localBalance).toBe(1000)  // Remote received 1000
      expect(updatedRemote?.remoteBalance).toBe(9000)  // Local has 9000
      expect(updatedRemote?.latestRemoteSignature).toBe(payment.signature)
    })

    it('should reject payment with invalid signature', async () => {
      const payment = await manager.createPayment(localChannel.id, 1000)
      
      // Tamper with signature
      payment.signature = 'ff' + payment.signature.slice(2)
      
      await expect(
        remoteManager.processPayment(payment)
      ).rejects.toThrow('Invalid payment signature')
    })

    it('should handle bidirectional payments', async () => {
      // Local sends 1000 to remote
      const payment1 = await manager.createPayment(localChannel.id, 1000)
      await remoteManager.processPayment(payment1)
      
      // Remote sends 500 back to local
      const payment2 = await remoteManager.createPayment(remoteChannel.id, 500)
      await manager.processPayment(payment2)
      
      // Check final balances
      const localFinal = manager.getChannel(localChannel.id)
      const remoteFinal = remoteManager.getChannel(remoteChannel.id)
      
      // Local: started 10000, sent 1000, received 500 = 9500
      expect(localFinal?.localBalance).toBe(9500)
      expect(localFinal?.remoteBalance).toBe(500)
      
      // Remote: started 0, received 1000, sent 500 = 500
      expect(remoteFinal?.localBalance).toBe(500)
      expect(remoteFinal?.remoteBalance).toBe(9500)
    })
  })

  describe('channel close with signatures', () => {
    let channel: Channel

    beforeEach(async () => {
      channel = await manager.createChannel('remote', remotePubKey, remoteAddress, 10000)
      manager.setFundingTx(channel.id, 'c'.repeat(64), 0)
      manager.openChannel(channel.id)
      await manager.createPayment(channel.id, 3000)  // Send some payments
    })

    it('should initiate cooperative close with real signature', async () => {
      const closeRequest = await manager.closeChannel(channel.id)

      expect(closeRequest.channelId).toBe(channel.id)
      expect(closeRequest.type).toBe('cooperative')
      expect(closeRequest.finalSequenceNumber).toBe(1)
      expect(closeRequest.finalLocalBalance).toBe(7000)
      expect(closeRequest.finalRemoteBalance).toBe(3000)
      expect(closeRequest.signature).toBeTruthy()
      expect(closeRequest.signature.length).toBeGreaterThan(100)

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
      const ch1 = await manager.createChannel('peer1', remotePubKey, remoteAddress, 10000)
      const ch2 = await manager.createChannel('peer2', remotePubKey, remoteAddress, 20000)
      const ch3 = await manager.createChannel('peer1', remotePubKey, remoteAddress, 5000)

      // Set funding and open ch1 and ch2
      manager.setFundingTx(ch1.id, 'd'.repeat(64), 0)
      manager.setFundingTx(ch2.id, 'e'.repeat(64), 0)
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

  describe('getLatestCommitment', () => {
    it('should return null for channel without commitment', async () => {
      const channel = await manager.createChannel('remote', remotePubKey, remoteAddress, 10000)
      const commitment = manager.getLatestCommitment(channel.id)
      expect(commitment).toBeNull()
    })

    it('should return commitment after two-party exchange', async () => {
      // Set up two-party channel
      const localChannel = await manager.createChannel('remote', remotePubKey, remoteAddress, 10000)
      manager.setFundingTx(localChannel.id, 'f'.repeat(64), 0)
      
      const remoteChannel = await remoteManager.acceptChannel(
        localChannel.id, 'remote', 'local', testPublicKey, testAddress, 10000, localChannel.nLockTime
      )
      remoteManager.setFundingTx(remoteChannel.id, 'f'.repeat(64), 0)
      
      manager.openChannel(localChannel.id)
      remoteManager.openChannel(remoteChannel.id)
      
      // Exchange payment
      const payment = await manager.createPayment(localChannel.id, 1000)
      await remoteManager.processPayment(payment)
      
      // Remote now has both signatures
      const commitment = remoteManager.getLatestCommitment(remoteChannel.id)
      expect(commitment).not.toBeNull()
      expect(commitment?.sequenceNumber).toBe(1)
      expect(commitment?.localBalance).toBe(1000)
      expect(commitment?.remoteBalance).toBe(9000)
      expect(commitment?.localSignature).toBeTruthy()
      expect(commitment?.remoteSignature).toBeTruthy()
    })
  })
})
