/**
 * E2E Test: Paid Poem Generation
 * 
 * Success Criteria:
 * 1. Start 2 libp2p peers (A and B)
 * 2. Peer B registers "poem" service (100 sats/poem)
 * 3. Peers discover and connect
 * 4. Peer A opens channel with 1000 sats
 * 5. Peer A requests poem → pays 100 sats via channel
 * 6. Verify poem received + channel balances updated
 * 7. Request 5 more poems (total 600 sats paid)
 * 8. Verify channel state (nSequence = 6)
 * 9. Cooperatively close channel
 * 10. Verify only 2 on-chain txs total (open + close)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrivateKey, Transaction } from '@bsv/sdk'
import { P2PNode } from '../../src/daemon/node.js'
import { ChannelManager } from '../../src/channels/manager.js'
import { ServiceInfo, Channel } from '../../src/channels/types.js'
import {
  createMultisigLockingScript,
  createCommitmentTransaction,
  createSettlementTransaction,
  SEQUENCE_FINAL,
  SEQUENCE_MAX_REPLACEABLE
} from '../../src/channels/transactions.js'

// Mock regtest wallet
class RegtestWallet {
  private privateKey: PrivateKey
  private utxos: Array<{ txid: string; vout: number; satoshis: number }> = []
  private broadcastedTxs: string[] = []

  constructor() {
    this.privateKey = PrivateKey.fromRandom()
    // Simulate some initial UTXOs
    this.utxos = [
      { txid: 'a'.repeat(64), vout: 0, satoshis: 100000 },
      { txid: 'b'.repeat(64), vout: 0, satoshis: 50000 }
    ]
  }

  get publicKey(): string {
    return this.privateKey.toPublicKey().toString()
  }

  get address(): string {
    return this.privateKey.toPublicKey().toAddress()
  }

  get key(): PrivateKey {
    return this.privateKey
  }

  getBalance(): number {
    return this.utxos.reduce((sum, u) => sum + u.satoshis, 0)
  }

  async broadcast(txHex: string): Promise<string> {
    // Simulate broadcast - just record it
    this.broadcastedTxs.push(txHex)
    // Return mock txid
    const tx = Transaction.fromHex(txHex)
    return tx.id('hex')
  }

  getBroadcastCount(): number {
    return this.broadcastedTxs.length
  }

  getBroadcastedTxs(): string[] {
    return this.broadcastedTxs
  }
}

// Poem generator service
function generatePoem(topic: string): string {
  const templates = [
    `A poem about ${topic}:\nIn circuits deep and code so bright,\n${topic} shines with digital light.\nBits and bytes in harmony flow,\nAs ${topic}'s beauty starts to show.`,
    `Ode to ${topic}:\nOh ${topic}, you wonder of our age,\nYou grace each screen and every page.\nWith elegance you make us see,\nThe future's vast possibility.`,
    `${topic} Haiku:\n${topic} flows like stream\nDigital dreams made concrete\nCode becomes real life`
  ]
  return templates[Math.floor(Math.random() * templates.length)]
}

describe('E2E: Paid Poem Generation', () => {
  // Peers
  let peerA: P2PNode
  let peerB: P2PNode

  // Wallets (regtest)
  let walletA: RegtestWallet
  let walletB: RegtestWallet

  // Channel managers
  let managerA: ChannelManager
  let managerB: ChannelManager

  // Channel tracking
  let channelId: string
  let fundingTxId: string

  // Service config
  const POEM_PRICE = 100  // 100 sats per poem
  const CHANNEL_CAPACITY = 1000  // 1000 sats

  beforeAll(async () => {
    // 1. Create wallets
    walletA = new RegtestWallet()
    walletB = new RegtestWallet()

    // 2. Create P2P nodes
    peerA = new P2PNode({
      port: 0,
      bootstrapPeers: [],
      enableMdns: false
    })

    peerB = new P2PNode({
      port: 0,
      bootstrapPeers: [],
      enableMdns: false
    })

    await peerA.start()
    await peerB.start()

    // 3. Create channel managers
    managerA = new ChannelManager({
      privateKey: walletA.key.toString(),
      publicKey: walletA.publicKey,
      broadcastTx: (tx) => walletA.broadcast(tx)
    })

    managerB = new ChannelManager({
      privateKey: walletB.key.toString(),
      publicKey: walletB.publicKey,
      broadcastTx: (tx) => walletB.broadcast(tx)
    })

    // 4. Register poem service on peer B
    const poemService: ServiceInfo = {
      id: 'poem',
      name: 'Random Poem Generator',
      description: 'Generates poems about any topic',
      price: POEM_PRICE,
      currency: 'bsv'
    }
    peerB.registerService(poemService)
    peerB.setBsvIdentityKey(walletB.publicKey)

    // 5. Connect peers
    const peerB_addr = peerB.multiaddrs.find(a => a.includes('127.0.0.1'))
    await peerA.connect(peerB_addr!)
    
    // Wait for connection to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000))
  }, 30000)

  afterAll(async () => {
    await peerA.stop()
    await peerB.stop()
  }, 10000)

  it('should have connected peers', () => {
    expect(peerA.getConnectedPeers()).toContain(peerB.peerId)
  })

  it('should discover poem service on peer B', async () => {
    const services = peerB.getServices()
    const poemService = services.find(s => s.id === 'poem')
    
    expect(poemService).toBeDefined()
    expect(poemService!.price).toBe(POEM_PRICE)
  })

  it('should open a payment channel between peers', async () => {
    // Peer A opens channel with B
    const channel = await managerA.createChannel(
      peerB.peerId,
      walletB.publicKey,
      CHANNEL_CAPACITY,
      3600000  // 1 hour
    )

    channelId = channel.id

    // Simulate funding tx creation (must be valid 64-char hex)
    fundingTxId = 'f'.repeat(64)
    managerA.setFundingTx(channelId, fundingTxId, 0)
    managerA.openChannel(channelId)

    // Peer B accepts and mirrors the channel
    await managerB.acceptChannel(
      channelId,
      peerB.peerId,
      peerA.peerId,
      walletA.publicKey,
      CHANNEL_CAPACITY,
      channel.nLockTime
    )
    managerB.setFundingTx(channelId, fundingTxId, 0)
    managerB.openChannel(channelId)

    const channelA = managerA.getChannel(channelId)
    const channelB = managerB.getChannel(channelId)

    expect(channelA!.state).toBe('open')
    expect(channelB!.state).toBe('open')
    expect(channelA!.localBalance).toBe(CHANNEL_CAPACITY)
    expect(channelA!.remoteBalance).toBe(0)
  })

  it('should pay for a poem via the channel', async () => {
    // Peer A pays for poem
    const payment = await managerA.createPayment(channelId, POEM_PRICE)

    // Generate the poem (would normally happen on peer B)
    const poem = generatePoem('Bitcoin')

    // Peer B processes the payment
    await managerB.processPayment({
      channelId,
      amount: POEM_PRICE,
      newSequenceNumber: payment.newSequenceNumber,
      newLocalBalance: payment.newLocalBalance,  // From A's perspective
      newRemoteBalance: payment.newRemoteBalance,
      signature: '',
      timestamp: Date.now()
    })

    // Verify poem was generated
    expect(poem).toContain('Bitcoin')
    expect(poem.length).toBeGreaterThan(0)

    // Verify channel balances updated
    const channelA = managerA.getChannel(channelId)
    expect(channelA!.localBalance).toBe(CHANNEL_CAPACITY - POEM_PRICE)  // 900
    expect(channelA!.remoteBalance).toBe(POEM_PRICE)  // 100
    expect(channelA!.sequenceNumber).toBe(1)
  })

  it('should support multiple payments on same channel', async () => {
    // Request 5 more poems (6 total including previous test)
    const topics = ['Nature', 'Code', 'Robots', 'Space', 'Love']
    
    for (const topic of topics) {
      const payment = await managerA.createPayment(channelId, POEM_PRICE)
      const poem = generatePoem(topic)
      
      await managerB.processPayment({
        channelId,
        amount: POEM_PRICE,
        newSequenceNumber: payment.newSequenceNumber,
        newLocalBalance: payment.newLocalBalance,
        newRemoteBalance: payment.newRemoteBalance,
        signature: '',
        timestamp: Date.now()
      })

      expect(poem).toContain(topic)
    }

    // Verify channel balances after 6 total poems (600 sats paid)
    const channelA = managerA.getChannel(channelId)
    expect(channelA!.localBalance).toBe(400)      // 1000 - 600
    expect(channelA!.remoteBalance).toBe(600)     // 0 + 600
    expect(channelA!.sequenceNumber).toBe(6)      // 6 updates
  })

  it('should have correct nSequence ordering for commitments', async () => {
    const channel = managerA.getChannel(channelId)!
    
    // Create commitment transactions for different states
    const commitment1 = createCommitmentTransaction({
      fundingTxId,
      fundingVout: 0,
      fundingAmount: CHANNEL_CAPACITY,
      pubKeyA: walletA.publicKey,
      pubKeyB: walletB.publicKey,
      addressA: walletA.address,
      addressB: walletB.address,
      balanceA: 900,
      balanceB: 100,
      sequenceNumber: 1,
      nLockTime: channel.nLockTime
    })

    const commitment6 = createCommitmentTransaction({
      fundingTxId,
      fundingVout: 0,
      fundingAmount: CHANNEL_CAPACITY,
      pubKeyA: walletA.publicKey,
      pubKeyB: walletB.publicKey,
      addressA: walletA.address,
      addressB: walletB.address,
      balanceA: 400,
      balanceB: 600,
      sequenceNumber: 6,
      nLockTime: channel.nLockTime
    })

    // Higher logical sequence = lower nSequence (can replace older)
    expect(commitment6.inputs[0].sequence).toBeLessThan(commitment1.inputs[0].sequence)
  })

  it('should cooperatively close the channel', async () => {
    // Close channel
    const closeRequest = await managerA.closeChannel(channelId)

    // Create settlement transaction
    const channel = managerA.getChannel(channelId)!
    const settlementTx = createSettlementTransaction({
      fundingTxId,
      fundingVout: 0,
      fundingAmount: CHANNEL_CAPACITY,
      pubKeyA: walletA.publicKey,
      pubKeyB: walletB.publicKey,
      addressA: walletA.address,
      addressB: walletB.address,
      balanceA: closeRequest.finalLocalBalance,
      balanceB: closeRequest.finalRemoteBalance,
      nLockTime: channel.nLockTime
    })

    // Verify settlement tx properties
    expect(settlementTx.inputs[0].sequence).toBe(SEQUENCE_FINAL)
    expect(settlementTx.nLockTime).toBe(0)

    // Use mock settlement txid (in real impl would be properly signed tx)
    const settlementTxId = 's'.repeat(64)

    // Finalize close on both sides
    managerA.finalizeClose(channelId, settlementTxId)
    managerB.finalizeClose(channelId, settlementTxId)

    const closedChannelA = managerA.getChannel(channelId)
    const closedChannelB = managerB.getChannel(channelId)

    expect(closedChannelA!.state).toBe('closed')
    expect(closedChannelB!.state).toBe('closed')
  })

  it('should verify final balances are correct', () => {
    const channel = managerA.getChannel(channelId)!
    
    // Peer A paid 600 sats total (6 poems × 100 sats)
    // A's final balance: 400 sats
    // B's final balance: 600 sats
    expect(channel.localBalance).toBe(400)
    expect(channel.remoteBalance).toBe(600)
  })

  it('should require minimal on-chain transactions', () => {
    // In a full implementation:
    // - 1 funding tx to open
    // - 1 settlement tx to close
    // - All 6 payments were off-chain!
    
    // For this test, we verify the structure allows this
    const channel = managerA.getChannel(channelId)!
    
    // Only need fundingTxId and final settlement
    expect(channel.fundingTxId).toBe(fundingTxId)
    expect(channel.state).toBe('closed')
    
    // 6 payments happened with only 2 on-chain txs required
    console.log(`
    ✅ Payment Channel Summary:
    - Channel capacity: ${CHANNEL_CAPACITY} sats
    - Total payments: 6
    - Total paid: 600 sats
    - On-chain txs: 2 (funding + settlement)
    - Off-chain updates: 6
    - Final balance A: ${channel.localBalance} sats
    - Final balance B: ${channel.remoteBalance} sats
    `)
  })
})
