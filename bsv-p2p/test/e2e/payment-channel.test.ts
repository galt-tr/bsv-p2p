/**
 * E2E Test: Payment Channel Flow
 * 
 * Tests the full lifecycle:
 * 1. Alice opens a channel with Bob
 * 2. Alice pays Bob multiple times
 * 3. Bob pays Alice once
 * 4. Channel is closed cooperatively
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ChannelManager } from '../../src/channels/manager.js'
import { ChannelProtocol } from '../../src/channels/protocol.js'
import { MessageHandler } from '../../src/protocol/handler.js'
import { MessageType, Message, ChannelOpenMessage } from '../../src/protocol/messages.js'
import { EventEmitter } from 'events'

// Mock libp2p node for testing without network
class MockLibp2pNode extends EventEmitter {
  private handlers = new Map<string, Function>()
  private otherNode: MockLibp2pNode | null = null
  public peerId: string
  
  constructor(peerId: string) {
    super()
    this.peerId = peerId
  }
  
  connect(other: MockLibp2pNode) {
    this.otherNode = other
    other.otherNode = this
  }
  
  handle(protocol: string, handler: Function) {
    this.handlers.set(protocol, handler)
  }
  
  getConnections() {
    if (!this.otherNode) return []
    return [{
      remotePeer: { toString: () => this.otherNode!.peerId },
      newStream: async (protocol: string) => {
        // Return a mock stream that delivers to the other node
        const chunks: Uint8Array[] = []
        return {
          send: (data: Uint8Array) => chunks.push(data),
          sendCloseWrite: async () => {
            // Deliver accumulated data to other node's handler
            const handler = this.otherNode!.handlers.get(protocol)
            if (handler && chunks.length > 0) {
              const mockStream = this.createMockIncomingStream(chunks)
              await handler({ stream: mockStream, connection: { remotePeer: { toString: () => this.peerId } } })
            }
          }
        }
      }
    }]
  }
  
  async dial() {
    return this.getConnections()[0]
  }
  
  private createMockIncomingStream(chunks: Uint8Array[]) {
    // Create async iterable that yields length-prefixed data
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) {
          yield chunk
        }
      }
    }
  }
}

// Mock message handler that delivers messages directly
class DirectMessageHandler extends MessageHandler {
  private other: DirectMessageHandler | null = null
  
  constructor(peerId: string) {
    // @ts-ignore - using minimal mock
    super({ node: new MockLibp2pNode(peerId), peerId, relayAddr: '' })
    this.peerId = peerId
  }
  
  private peerId: string
  
  connect(other: DirectMessageHandler) {
    this.other = other
    other.other = this
  }
  
  register() {
    // No-op for mock
  }
  
  async send(toPeerId: string, message: Message): Promise<void> {
    if (!this.other) throw new Error('Not connected')
    // Deliver directly to other handler
    setTimeout(() => {
      this.other!.emit('message', message, this.peerId)
      this.other!.emit(message.type, message, this.peerId)
    }, 10)
  }
}

describe('Payment Channel E2E', () => {
  // Test keys (regtest - NOT real funds)
  const ALICE_PRIVKEY = '0000000000000000000000000000000000000000000000000000000000000001'
  const ALICE_PUBKEY = '0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798'
  const BOB_PRIVKEY = '0000000000000000000000000000000000000000000000000000000000000002'
  const BOB_PUBKEY = '02C6047F9441ED7D6D3045406E95C07CD85C778E4B8CEF3CA7ABAC09B95C709EE5'
  
  let aliceManager: ChannelManager
  let bobManager: ChannelManager
  let aliceMessages: DirectMessageHandler
  let bobMessages: DirectMessageHandler
  let aliceProtocol: ChannelProtocol
  let bobProtocol: ChannelProtocol
  
  beforeAll(() => {
    // Create channel managers
    aliceManager = new ChannelManager({
      privateKey: ALICE_PRIVKEY,
      publicKey: ALICE_PUBKEY
    })
    
    bobManager = new ChannelManager({
      privateKey: BOB_PRIVKEY,
      publicKey: BOB_PUBKEY
    })
    
    // Create message handlers
    aliceMessages = new DirectMessageHandler('alice-peer-id')
    bobMessages = new DirectMessageHandler('bob-peer-id')
    aliceMessages.connect(bobMessages)
    
    // Create channel protocols
    aliceProtocol = new ChannelProtocol({
      channelManager: aliceManager,
      messageHandler: aliceMessages,
      peerId: 'alice-peer-id',
      onChannelReady: (ch) => console.log(`Alice: Channel ${ch.id.substring(0, 8)} ready`)
    })
    
    bobProtocol = new ChannelProtocol({
      channelManager: bobManager,
      messageHandler: bobMessages,
      peerId: 'bob-peer-id',
      autoAcceptMaxCapacity: 100000, // Auto-accept up to 100k sats
      onChannelReady: (ch) => console.log(`Bob: Channel ${ch.id.substring(0, 8)} ready`),
      onPaidRequest: async (req) => {
        // Simple echo service
        if (req.service === 'echo') {
          return { success: true, result: req.params }
        }
        // Poem service
        if (req.service === 'poem') {
          const topic = req.params.topic || 'payment channels'
          return {
            success: true,
            result: {
              poem: `Roses are red, violets are blue,
${topic} are neat, and so are you!`
            }
          }
        }
        return { success: false, error: 'Unknown service' }
      }
    })
  })
  
  afterAll(() => {
    // Cleanup
  })
  
  it('should open a channel from Alice to Bob', async () => {
    const capacity = 10000 // 10k sats
    
    const channel = await aliceProtocol.openChannel(
      'bob-peer-id',
      BOB_PUBKEY,
      capacity,
      5000 // 5 second timeout
    )
    
    expect(channel).toBeDefined()
    expect(channel.state).toBe('open')
    expect(channel.capacity).toBe(capacity)
    expect(channel.localBalance).toBe(capacity) // Alice funded it
    expect(channel.remoteBalance).toBe(0)
    
    // Check Bob also has the channel
    const bobChannel = bobManager.getChannel(channel.id)
    expect(bobChannel).toBeDefined()
    expect(bobChannel!.state).toBe('open')
    expect(bobChannel!.localBalance).toBe(0) // Bob starts with 0
    expect(bobChannel!.remoteBalance).toBe(capacity)
    
    console.log(`✅ Channel opened: ${channel.id.substring(0, 8)}...`)
  })
  
  it('should allow Alice to pay Bob', async () => {
    const channels = aliceManager.getOpenChannels()
    expect(channels.length).toBeGreaterThan(0)
    
    const channel = channels[0]
    const amount = 100 // 100 sats
    
    const payment = await aliceProtocol.pay(channel.id, amount)
    
    expect(payment.amount).toBe(amount)
    expect(payment.newSequenceNumber).toBe(1)
    
    // Check Alice's balance decreased
    const aliceChannel = aliceManager.getChannel(channel.id)!
    expect(aliceChannel.localBalance).toBe(channel.capacity - amount)
    expect(aliceChannel.remoteBalance).toBe(amount)
    
    // Wait for Bob to process
    await new Promise(r => setTimeout(r, 50))
    
    // Check Bob's balance increased
    const bobChannel = bobManager.getChannel(channel.id)!
    expect(bobChannel.localBalance).toBe(amount)
    expect(bobChannel.remoteBalance).toBe(channel.capacity - amount)
    
    console.log(`✅ Payment 1: Alice → Bob: ${amount} sats`)
  })
  
  it('should handle multiple payments', async () => {
    const channel = aliceManager.getOpenChannels()[0]
    const amounts = [200, 300, 150]
    
    for (const amount of amounts) {
      await aliceProtocol.pay(channel.id, amount)
      await new Promise(r => setTimeout(r, 20))
    }
    
    const totalPaid = 100 + 200 + 300 + 150 // Including first payment
    
    // Check final balances
    const aliceChannel = aliceManager.getChannel(channel.id)!
    expect(aliceChannel.localBalance).toBe(channel.capacity - totalPaid)
    expect(aliceChannel.sequenceNumber).toBe(4) // 4 payments
    
    console.log(`✅ Multiple payments complete. Total paid: ${totalPaid} sats`)
  })
  
  it('should handle paid service requests', async () => {
    const channel = aliceManager.getOpenChannels()[0]
    const preBal = aliceManager.getChannel(channel.id)!.localBalance
    
    const result = await aliceProtocol.paidRequest(
      channel.id,
      'poem',
      { topic: 'Bitcoin' },
      50, // Pay 50 sats for poem
      5000
    )
    
    expect(result.success).toBe(true)
    expect(result.paymentAccepted).toBe(true)
    expect(result.result.poem).toContain('Bitcoin')
    
    // Check balance decreased
    const postBal = aliceManager.getChannel(channel.id)!.localBalance
    expect(postBal).toBe(preBal - 50)
    
    console.log(`✅ Paid service: Got poem for 50 sats`)
    console.log(`   "${result.result.poem}"`)
  })
  
  it('should close channel cooperatively', async () => {
    const channel = aliceManager.getOpenChannels()[0]
    
    await aliceProtocol.closeChannel(channel.id)
    
    // Wait for close to propagate
    await new Promise(r => setTimeout(r, 50))
    
    // Check both sides show channel closed
    const aliceChannel = aliceManager.getChannel(channel.id)!
    expect(aliceChannel.state).toBe('closed')
    
    const bobChannel = bobManager.getChannel(channel.id)!
    expect(bobChannel.state).toBe('closed')
    
    console.log(`✅ Channel closed cooperatively`)
    console.log(`   Final balances: Alice=${aliceChannel.localBalance}, Bob=${bobChannel.localBalance}`)
  })
  
  it('should reject insufficient balance', async () => {
    // Open a new channel with small capacity
    const channel = await aliceProtocol.openChannel(
      'bob-peer-id',
      BOB_PUBKEY,
      1000, // 1k sats
      5000
    )
    
    await expect(
      aliceProtocol.pay(channel.id, 2000) // Try to pay more than capacity
    ).rejects.toThrow(/Insufficient balance/)
    
    console.log(`✅ Correctly rejected payment exceeding balance`)
  })
})
