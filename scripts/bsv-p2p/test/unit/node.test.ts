import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { P2PNode, createP2PNode } from '../../src/daemon/node.js'
import { ServiceInfo } from '../../src/daemon/types.js'

describe('P2PNode', () => {
  describe('constructor', () => {
    it('should create a node with default config', () => {
      const node = new P2PNode()
      expect(node).toBeInstanceOf(P2PNode)
      expect(node.isStarted).toBe(false)
    })

    it('should create a node with custom config', () => {
      const node = new P2PNode({ port: 5001 })
      expect(node).toBeInstanceOf(P2PNode)
    })
  })

  describe('lifecycle', () => {
    let node: P2PNode

    beforeEach(() => {
      node = new P2PNode({ 
        port: 0,  // Random port
        bootstrapPeers: [],  // No bootstrap for tests
        enableMdns: false    // No mDNS for tests
      })
    })

    afterEach(async () => {
      if (node.isStarted) {
        await node.stop()
      }
    })

    it('should start and stop', async () => {
      expect(node.isStarted).toBe(false)
      
      await node.start()
      
      expect(node.isStarted).toBe(true)
      expect(node.peerId).toBeTruthy()
      expect(node.peerId.length).toBeGreaterThan(0)
      expect(node.multiaddrs.length).toBeGreaterThan(0)
      
      await node.stop()
      
      expect(node.isStarted).toBe(false)
    })

    it('should throw if started twice', async () => {
      await node.start()
      
      await expect(node.start()).rejects.toThrow('Node already started')
    })

    it('should generate a valid PeerId', async () => {
      await node.start()
      
      // PeerIds start with 12D3KooW or Qm
      expect(node.peerId).toMatch(/^(12D3KooW|Qm)/)
    })
  })

  describe('services', () => {
    let node: P2PNode

    beforeEach(async () => {
      node = new P2PNode({ 
        port: 0,
        bootstrapPeers: [],
        enableMdns: false
      })
      await node.start()
    })

    afterEach(async () => {
      await node.stop()
    })

    it('should register a service', () => {
      const service: ServiceInfo = {
        id: 'test-service',
        name: 'Test Service',
        description: 'A test service',
        price: 100,
        currency: 'bsv'
      }

      node.registerService(service)
      
      const services = node.getServices()
      expect(services).toHaveLength(1)
      expect(services[0]).toEqual(service)
    })

    it('should unregister a service', () => {
      const service: ServiceInfo = {
        id: 'test-service',
        name: 'Test Service',
        price: 100,
        currency: 'bsv'
      }

      node.registerService(service)
      expect(node.getServices()).toHaveLength(1)
      
      node.unregisterService('test-service')
      expect(node.getServices()).toHaveLength(0)
    })

    it('should replace service with same id', () => {
      const service1: ServiceInfo = {
        id: 'test-service',
        name: 'Test Service v1',
        price: 100,
        currency: 'bsv'
      }

      const service2: ServiceInfo = {
        id: 'test-service',
        name: 'Test Service v2',
        price: 200,
        currency: 'bsv'
      }

      node.registerService(service1)
      node.registerService(service2)
      
      const services = node.getServices()
      expect(services).toHaveLength(1)
      expect(services[0].name).toBe('Test Service v2')
      expect(services[0].price).toBe(200)
    })
  })

  describe('BSV identity', () => {
    let node: P2PNode

    beforeEach(async () => {
      node = new P2PNode({ 
        port: 0,
        bootstrapPeers: [],
        enableMdns: false
      })
      await node.start()
    })

    afterEach(async () => {
      await node.stop()
    })

    it('should set BSV identity key', () => {
      const testKey = '02abc123def456'
      node.setBsvIdentityKey(testKey)
      // Key is stored internally, no getter exposed yet
      // This test just ensures no errors
    })
  })
})

describe('createP2PNode helper', () => {
  it('should create and start a node', async () => {
    const node = await createP2PNode({
      port: 0,
      bootstrapPeers: [],
      enableMdns: false
    })
    
    expect(node.isStarted).toBe(true)
    expect(node.peerId).toBeTruthy()
    
    await node.stop()
  })
})
