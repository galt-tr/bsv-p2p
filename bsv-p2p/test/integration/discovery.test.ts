import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { P2PNode } from '../../src/daemon/node.js'
import { ServiceInfo, PeerAnnouncement } from '../../src/daemon/types.js'

describe('Peer Discovery', () => {
  let nodeA: P2PNode
  let nodeB: P2PNode

  beforeAll(async () => {
    // Create two nodes on different ports with ephemeral keys (for test isolation)
    nodeA = new P2PNode({
      port: 0,  // Random port
      bootstrapPeers: [],
      enableMdns: false,
      ephemeralKey: true
    })

    nodeB = new P2PNode({
      port: 0,  // Random port
      bootstrapPeers: [],
      enableMdns: false,
      ephemeralKey: true
    })

    await nodeA.start()
    await nodeB.start()
  }, 30000)

  afterAll(async () => {
    await nodeA.stop()
    await nodeB.stop()
  }, 10000)

  it('should have different PeerIds', () => {
    expect(nodeA.peerId).not.toBe(nodeB.peerId)
    expect(nodeA.peerId).toMatch(/^12D3KooW/)
    expect(nodeB.peerId).toMatch(/^12D3KooW/)
  })

  it('should have valid multiaddrs', () => {
    expect(nodeA.multiaddrs.length).toBeGreaterThan(0)
    expect(nodeB.multiaddrs.length).toBeGreaterThan(0)
    
    const hasValidAddr = nodeA.multiaddrs.some(a => 
      a.includes('/tcp/') && a.includes('/p2p/')
    )
    expect(hasValidAddr).toBe(true)
  })

  it('should connect peers directly', async () => {
    // Get nodeB's multiaddr - use the 127.0.0.1 one for reliability
    const nodeB_addr = nodeB.multiaddrs.find(a => a.includes('127.0.0.1'))
    expect(nodeB_addr).toBeTruthy()

    // Connect nodeA to nodeB
    await nodeA.connect(nodeB_addr!)

    // Wait for connection to establish
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Check connected peers
    const connectedA = nodeA.getConnectedPeers()
    expect(connectedA).toContain(nodeB.peerId)
  }, 15000)

  it.skip('should ping connected peer', async () => {
    // Skipped: ping service disabled in production config to avoid relay interference
    const latency = await nodeA.ping(nodeB.peerId)
    
    expect(typeof latency).toBe('number')
    expect(latency).toBeGreaterThanOrEqual(0)  // Can be 0 for local connections
    expect(latency).toBeLessThan(5000)
  }, 15000)

  it('should register and list services', () => {
    const service: ServiceInfo = {
      id: 'poem',
      name: 'Poem Generator',
      description: 'Generates random poems',
      price: 100,
      currency: 'bsv'
    }
    
    nodeB.registerService(service)
    nodeB.setBsvIdentityKey('02testkey123')
    
    const services = nodeB.getServices()
    expect(services).toHaveLength(1)
    expect(services[0].id).toBe('poem')
  })

  it('should disconnect from peer', async () => {
    // Disconnect nodeA from nodeB
    await nodeA.disconnect(nodeB.peerId)

    // Wait for disconnection
    await new Promise(resolve => setTimeout(resolve, 1000))

    const connectedA = nodeA.getConnectedPeers()
    expect(connectedA).not.toContain(nodeB.peerId)
  }, 15000)
})
