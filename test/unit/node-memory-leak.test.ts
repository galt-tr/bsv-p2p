/**
 * Memory leak test for P2PNode
 * 
 * Tests that event listeners are properly cleaned up on stop()
 * to prevent memory leaks during restart cycles.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { P2PNode } from '../../src/daemon/node.js'

describe('P2PNode Memory Leak Prevention', () => {
  let node: P2PNode | null = null

  afterEach(async () => {
    if (node) {
      await node.stop()
      node = null
    }
  })

  it('should clean up event listeners on stop()', async () => {
    // Create and start node in ephemeral mode (no persistence)
    // Use random ports to avoid conflicts
    const randomPort = 40000 + Math.floor(Math.random() * 10000)
    node = new P2PNode({ 
      ephemeralKey: true,
      port: randomPort,
      enableMdns: false
    })
    await node.start()
    
    // Access internal event listeners count (this is a bit hacky but acceptable for testing)
    const listenersCount = (node as any).eventListeners?.length || 0
    
    expect(listenersCount).toBeGreaterThan(0)
    console.log(`Registered ${listenersCount} event listeners`)
    
    // Stop node
    await node.stop()
    
    // Verify listeners were cleaned up
    const remainingListeners = (node as any).eventListeners?.length || 0
    expect(remainingListeners).toBe(0)
  })

  it('should handle multiple start/stop cycles without accumulating listeners', async () => {
    const cycles = 10
    const listenerCounts: number[] = []
    
    for (let i = 0; i < cycles; i++) {
      const randomPort = 40000 + Math.floor(Math.random() * 10000)
      node = new P2PNode({ 
        ephemeralKey: true,
        port: randomPort,
        enableMdns: false
      })
      await node.start()
      
      const count = (node as any).eventListeners?.length || 0
      listenerCounts.push(count)
      console.log(`Cycle ${i + 1}: ${count} listeners`)
      
      await node.stop()
      node = null
    }
    
    // All cycles should have roughly the same number of listeners
    const firstCount = listenerCounts[0]
    const lastCount = listenerCounts[cycles - 1]
    
    // Allow some variance but they should be similar
    expect(Math.abs(lastCount - firstCount)).toBeLessThanOrEqual(2)
    
    console.log(`First cycle: ${firstCount} listeners, Last cycle: ${lastCount} listeners`)
  }, 60000) // 60s timeout for 10 cycles

  it('should not leave dangling intervals after stop()', async () => {
    const randomPort = 40000 + Math.floor(Math.random() * 10000)
    node = new P2PNode({ 
      ephemeralKey: true,
      port: randomPort,
      enableMdns: false
    })
    await node.start()
    
    // Check intervals are set (indirectly via properties)
    const hasAnnouncementInterval = (node as any).announcementInterval !== null
    const hasRelayInterval = (node as any).relayMaintenanceInterval !== null
    
    console.log(`Before stop: announcement=${hasAnnouncementInterval}, relay=${hasRelayInterval}`)
    
    await node.stop()
    
    // After stop, intervals should be cleared
    expect((node as any).announcementInterval).toBeNull()
    expect((node as any).relayMaintenanceInterval).toBeNull()
  })

  it('should clear all resources on stop()', async () => {
    const randomPort = 40000 + Math.floor(Math.random() * 10000)
    node = new P2PNode({ 
      ephemeralKey: true,
      port: randomPort,
      enableMdns: false
    })
    await node.start()
    
    // Verify resources are allocated
    expect((node as any).node).not.toBeNull()
    expect((node as any).discovery).toBeDefined()
    
    await node.stop()
    
    // Verify resources are freed
    expect((node as any).node).toBeNull()
    expect((node as any).discovery).toBeNull()
    expect((node as any).messageHandler).toBeNull()
    expect((node as any).eventListeners).toEqual([])
    expect((node as any).peers.size).toBe(0)
  })
})
