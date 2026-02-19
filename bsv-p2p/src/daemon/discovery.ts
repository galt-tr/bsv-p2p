/**
 * GossipSub-based service discovery
 * 
 * Per architecture plan Part 4:
 * - Subscribe to /openclaw/v1/announce topic
 * - Publish PeerAnnouncement every 5 minutes
 * - Listen for announcements and update peer store
 * - Cleanup stale peers (not seen in 15 minutes)
 */

import { EventEmitter } from 'events'
import { PeerAnnouncement, ServiceInfo, PeerInfo, TOPICS } from './types.js'

export interface DiscoveryConfig {
  announceIntervalMs: number       // How often to announce (default: 5 minutes)
  staleTimeoutMs: number           // When to remove stale peers (default: 15 minutes)
  cleanupIntervalMs: number        // How often to cleanup (default: 1 minute)
}

const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  announceIntervalMs: 300000,    // 5 minutes
  staleTimeoutMs: 900000,        // 15 minutes
  cleanupIntervalMs: 60000       // 1 minute
}

export class DiscoveryService extends EventEmitter {
  private config: DiscoveryConfig
  private peerId: string
  private bsvIdentityKey: string | null = null
  private services: ServiceInfo[] = []
  private peers: Map<string, PeerInfo> = new Map()
  private multiaddrs: string[] = []
  private pubsub: any = null
  
  private announceInterval: NodeJS.Timeout | null = null
  private cleanupInterval: NodeJS.Timeout | null = null
  private isStarted: boolean = false

  constructor(peerId: string, config: Partial<DiscoveryConfig> = {}) {
    super()
    this.peerId = peerId
    this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config }
  }

  /**
   * Start the discovery service
   */
  async start(pubsub: any, multiaddrs: string[]): Promise<void> {
    if (this.isStarted) {
      throw new Error('Discovery service already started')
    }

    if (!pubsub) {
      throw new Error('PubSub service required for discovery')
    }

    this.pubsub = pubsub
    this.multiaddrs = multiaddrs
    this.isStarted = true

    // Subscribe to announcement topic
    this.pubsub.subscribe(TOPICS.ANNOUNCE)
    console.log(`[Discovery] Subscribed to ${TOPICS.ANNOUNCE}`)

    // Handle incoming announcements
    this.pubsub.addEventListener('message', (evt: any) => {
      if (evt.detail.topic === TOPICS.ANNOUNCE) {
        this.handleAnnouncement(evt.detail.data)
      }
    })

    // Start periodic announcements
    await this.announce()
    this.announceInterval = setInterval(() => {
      this.announce().catch(err => 
        console.error('[Discovery] Announcement failed:', err)
      )
    }, this.config.announceIntervalMs)
    
    console.log(`[Discovery] Announcing every ${this.config.announceIntervalMs}ms`)

    // Start peer cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupStalePeers()
    }, this.config.cleanupIntervalMs)
    
    console.log(`[Discovery] Started (cleanup every ${this.config.cleanupIntervalMs}ms)`)
  }

  /**
   * Stop the discovery service
   */
  async stop(): Promise<void> {
    if (!this.isStarted) return

    if (this.announceInterval) {
      clearInterval(this.announceInterval)
      this.announceInterval = null
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    if (this.pubsub) {
      this.pubsub.unsubscribe(TOPICS.ANNOUNCE)
    }

    this.isStarted = false
    console.log('[Discovery] Stopped')
  }

  /**
   * Announce our presence and services
   */
  private async announce(): Promise<void> {
    if (!this.pubsub || !this.isStarted) return

    const announcement: PeerAnnouncement = {
      peerId: this.peerId,
      bsvIdentityKey: this.bsvIdentityKey ?? '',
      services: this.services,
      multiaddrs: this.multiaddrs,
      timestamp: Date.now(),
      signature: '' // TODO: Sign with BSV key
    }

    const data = new TextEncoder().encode(JSON.stringify(announcement))
    
    try {
      await this.pubsub.publish(TOPICS.ANNOUNCE, data)
      console.log(`[Discovery] Published announcement (${this.services.length} services)`)
      this.emit('announced', announcement)
    } catch (err: any) {
      console.error(`[Discovery] Publish failed: ${err.message}`)
      throw err
    }
  }

  /**
   * Handle incoming peer announcement
   */
  private handleAnnouncement(data: Uint8Array): void {
    try {
      const decoded = new TextDecoder().decode(data)
      const announcement: PeerAnnouncement = JSON.parse(decoded)

      // Don't process our own announcements
      if (announcement.peerId === this.peerId) {
        return
      }

      // TODO: Verify signature with BSV key

      // Update peer info
      const peerInfo: PeerInfo = {
        peerId: announcement.peerId,
        multiaddrs: announcement.multiaddrs,
        protocols: [],
        bsvIdentityKey: announcement.bsvIdentityKey,
        services: announcement.services,
        lastSeen: announcement.timestamp
      }

      const isNew = !this.peers.has(announcement.peerId)
      this.peers.set(announcement.peerId, peerInfo)

      if (isNew) {
        console.log(`[Discovery] New peer: ${announcement.peerId.substring(0, 16)}... (${announcement.services.length} services)`)
        this.emit('peer:discovered', peerInfo)
      } else {
        this.emit('peer:updated', peerInfo)
      }

      this.emit('announcement', announcement)

    } catch (err: any) {
      console.error(`[Discovery] Failed to parse announcement: ${err.message}`)
    }
  }

  /**
   * Remove peers that haven't announced in a while
   */
  private cleanupStalePeers(): void {
    const now = Date.now()
    const staleThreshold = now - this.config.staleTimeoutMs
    
    let removed = 0
    for (const [peerId, peer] of this.peers.entries()) {
      if (peer.lastSeen < staleThreshold) {
        this.peers.delete(peerId)
        removed++
        console.log(`[Discovery] Removed stale peer: ${peerId.substring(0, 16)}...`)
        this.emit('peer:stale', peerId)
      }
    }

    if (removed > 0) {
      console.log(`[Discovery] Cleaned up ${removed} stale peer(s)`)
    }
  }

  /**
   * Register a service to announce
   */
  registerService(service: ServiceInfo): void {
    // Remove existing service with same id
    this.services = this.services.filter(s => s.id !== service.id)
    this.services.push(service)
    
    console.log(`[Discovery] Registered service: ${service.id}`)
    
    // Re-announce immediately
    if (this.isStarted) {
      this.announce().catch(err => 
        console.error('[Discovery] Re-announcement failed:', err)
      )
    }
  }

  /**
   * Unregister a service
   */
  unregisterService(serviceId: string): void {
    const before = this.services.length
    this.services = this.services.filter(s => s.id !== serviceId)
    
    if (this.services.length < before) {
      console.log(`[Discovery] Unregistered service: ${serviceId}`)
      
      // Re-announce immediately
      if (this.isStarted) {
        this.announce().catch(err => 
          console.error('[Discovery] Re-announcement failed:', err)
        )
      }
    }
  }

  /**
   * Set BSV identity key for signing announcements
   */
  setBsvIdentityKey(key: string): void {
    this.bsvIdentityKey = key
    console.log(`[Discovery] BSV identity key set`)
  }

  /**
   * Update our multiaddrs (e.g., when relay reservation changes)
   */
  updateMultiaddrs(multiaddrs: string[]): void {
    this.multiaddrs = multiaddrs
  }

  /**
   * Get all discovered peers
   */
  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values())
  }

  /**
   * Get a specific peer
   */
  getPeer(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId)
  }

  /**
   * Discover peers offering a specific service
   */
  discoverService(serviceId: string): PeerInfo[] {
    return this.getPeers().filter(peer => 
      peer.services?.some(s => s.id === serviceId)
    )
  }

  /**
   * Get our announced services
   */
  getServices(): ServiceInfo[] {
    return [...this.services]
  }

  /**
   * Get statistics
   */
  getStats(): {
    knownPeers: number
    registeredServices: number
    isRunning: boolean
  } {
    return {
      knownPeers: this.peers.size,
      registeredServices: this.services.length,
      isRunning: this.isStarted
    }
  }
}
