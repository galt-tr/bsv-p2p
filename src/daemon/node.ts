import { createLibp2p, Libp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { bootstrap } from '@libp2p/bootstrap'
import { mdns } from '@libp2p/mdns'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { autoNAT } from '@libp2p/autonat'
import { dcutr } from '@libp2p/dcutr'
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { uPnPNAT } from '@libp2p/upnp-nat'
import { multiaddr } from '@multiformats/multiaddr'
import { peerIdFromString } from '@libp2p/peer-id'
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { EventEmitter } from 'events'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import * as lp from 'it-length-prefixed'
import { pipe } from 'it-pipe'
import { LRUCache } from 'lru-cache'
import { 
  P2PNodeConfig, 
  PeerInfo, 
  PeerAnnouncement,
  ServiceInfo,
  DEFAULT_CONFIG,
  TOPICS,
  PROTOCOLS
} from './types.js'
import { GatewayClient, GatewayConfig } from './gateway.js'
import { MessageHandler, formatMessageForAgent, Message, MessageType, TextMessage, RequestMessage, PaidRequestMessage, MESSAGE_PROTOCOL } from '../protocol/index.js'
import { DiscoveryService } from './discovery.js'
import { StatusBroadcaster } from './status-broadcaster.js'

const KEY_FILE = join(homedir(), '.bsv-p2p', 'peer-key.json')
const RELAY_ADDR = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWAcdYkneggrQd3eWBMdcjqHiTNSV81HABRcgrvXywcnDs'

/**
 * Load existing private key or generate a new one
 * @param ephemeral If true, always generate a new key without persistence (for testing)
 */
async function loadOrGenerateKey(ephemeral: boolean = false): Promise<ReturnType<typeof privateKeyFromProtobuf>> {
  // For ephemeral mode (tests), just generate without persistence
  if (ephemeral) {
    const privateKey = await generateKeyPair('Ed25519')
    console.log('[Key] Generated ephemeral peer key (not persisted)')
    return privateKey
  }
  
  const configDir = join(homedir(), '.bsv-p2p')
  
  // Ensure config directory exists
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
  
  // Try to load existing key
  if (existsSync(KEY_FILE)) {
    try {
      const keyData = JSON.parse(readFileSync(KEY_FILE, 'utf-8'))
      const keyBytes = Uint8Array.from(keyData.privateKey)
      const privateKey = privateKeyFromProtobuf(keyBytes)
      console.log('[Key] Loaded existing peer key')
      return privateKey
    } catch (err) {
      console.error('[Key] Failed to load existing key, generating new one:', err)
    }
  }
  
  // Generate new key
  const privateKey = await generateKeyPair('Ed25519')
  const keyBytes = privateKeyToProtobuf(privateKey)
  
  // Save to disk
  const keyData = {
    privateKey: Array.from(keyBytes),
    createdAt: new Date().toISOString()
  }
  writeFileSync(KEY_FILE, JSON.stringify(keyData, null, 2))
  console.log('[Key] Generated and saved new peer key')
  
  return privateKey
}

export class P2PNode extends EventEmitter {
  private node: Libp2p | null = null
  private config: Required<Omit<P2PNodeConfig, 'gateway'>>
  private gatewayConfig: GatewayConfig
  private gateway: GatewayClient
  private peers: LRUCache<string, PeerInfo>
  private services: ServiceInfo[] = []
  private bsvIdentityKey: string | null = null
  private announcementInterval: NodeJS.Timeout | null = null
  private messageHandler: MessageHandler | null = null
  private discovery: DiscoveryService | null = null
  private statusBroadcaster: StatusBroadcaster | null = null
  private nodeName: string | undefined
  private statusBroadcastIntervalMs: number
  // Track all registered event listeners for cleanup
  private eventListeners: Array<{ target: any; event: string; handler: any }> = []

  constructor(config: P2PNodeConfig = {}) {
    super()
    const { gateway, ...nodeConfig } = config
    this.config = { ...DEFAULT_CONFIG, ...nodeConfig }
    this.gatewayConfig = gateway ?? {}
    this.gateway = new GatewayClient(this.gatewayConfig)
    this.nodeName = config.name
    this.statusBroadcastIntervalMs = config.statusBroadcastIntervalMs ?? 60000

    // Initialize bounded peer storage with LRU cache
    this.peers = new LRUCache<string, PeerInfo>({
      max: 1000,                          // Max 1000 peers
      ttl: 1000 * 60 * 60,                // 1 hour TTL
      dispose: (peer, peerId) => {
        console.log(`[P2PNode] Evicted peer from cache: ${peerId.substring(0, 16)}...`)
      }
    })
  }
  
  /**
   * Get the gateway client for external use
   */
  get gatewayClient(): GatewayClient {
    return this.gateway
  }
  
  /**
   * Get the message handler for sending P2P messages
   */
  get messages(): MessageHandler | null {
    return this.messageHandler
  }
  
  /**
   * Configure the gateway client
   */
  configureGateway(config: GatewayConfig): void {
    this.gateway.configure(config)
  }

  get peerId(): string {
    return this.node?.peerId.toString() ?? ''
  }

  get multiaddrs(): string[] {
    return this.node?.getMultiaddrs().map(ma => ma.toString()) ?? []
  }

  get isStarted(): boolean {
    return this.node !== null
  }

  /**
   * Get all current connections
   */
  getConnections(): any[] {
    if (!this.node) return []
    return this.node.getConnections()
  }

  // Connection maintenance interval (NOT reservation refresh)
  private relayMaintenanceInterval: NodeJS.Timeout | null = null
  private static readonly RELAY_PEER_ID = '12D3KooWAcdYkneggrQd3eWBMdcjqHiTNSV81HABRcgrvXywcnDs'

  /**
   * Dial the relay server to establish connection (which enables reservation).
   * 
   * IMPORTANT: Do NOT close this connection! The reservation is only valid
   * while the connection is maintained. See circuit-v2 spec.
   */
  async dialRelay(relayAddr: string): Promise<void> {
    if (!this.node) throw new Error('Node not started')
    
    const ma = multiaddr(relayAddr)
    console.log(`[Relay] Dialing relay: ${relayAddr}`)
    
    try {
      await this.node.dial(ma)
      console.log(`[Relay] Connected to relay`)
      
      // Explicitly request a 'configured' reservation on our relay.
      // 'discovered' relays are skipped when we already have enough relays from IPFS bootstrap,
      // but 'configured' relays always get a reservation attempt.
      const relayPeerId = peerIdFromString(P2PNode.RELAY_PEER_ID)
      try {
        const transport = (this.node as any).components?.transportManager?.getTransports?.()
        if (transport) {
          for (const t of transport) {
            if (t.reservationStore) {
              console.log(`[Relay] Explicitly requesting configured reservation...`)
              await t.reservationStore.addRelay(relayPeerId, 'configured')
              console.log(`[Relay] ✅ Configured reservation acquired!`)
              break
            }
          }
        }
      } catch (resErr: any) {
        console.log(`[Relay] Reservation request: ${resErr.message}`)
      }
    } catch (err: any) {
      console.error(`[Relay] Failed to dial relay: ${err.message}`)
      throw err
    }
  }

  /**
   * Check if we have a valid relay reservation.
   * Note: This checks for the presence of relay addresses in our multiaddrs.
   * The actual reservation validity depends on maintaining the connection.
   */
  hasRelayReservation(): boolean {
    const addrs = this.multiaddrs
    return addrs.some(a => a.includes('p2p-circuit') && a.includes('167.172.134.84'))
  }

  /**
   * Get our relay circuit address if we have one.
   */
  getRelayAddress(): string | null {
    return this.multiaddrs.find(a => 
      a.includes('p2p-circuit') && 
      a.includes('167.172.134.84')
    ) || null
  }

  /**
   * Check if we're connected to the relay server.
   * Connection = reservation (per circuit-v2 spec).
   */
  isConnectedToRelay(): boolean {
    if (!this.node) return false
    const connections = this.node.getConnections()
    return connections.some(c => c.remotePeer.toString() === P2PNode.RELAY_PEER_ID)
  }

  /**
   * Wait for relay reservation to be established (relay address appears in multiaddrs).
   */
  private async waitForReservation(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now()
    const checkInterval = 500
    
    console.log(`[Relay] Waiting for reservation (timeout: ${timeoutMs}ms)...`)
    
    while (Date.now() - startTime < timeoutMs) {
      const relayAddr = this.getRelayAddress()
      if (relayAddr) {
        console.log(`[Relay] ✅ Reservation acquired: ${relayAddr}`)
        return true
      }
      
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      if (elapsed > 0 && elapsed % 5 === 0) {
        console.log(`[Relay] Still waiting for reservation... (${elapsed}s)`)
      }
      
      await new Promise(r => setTimeout(r, checkInterval))
    }
    
    console.error(`[Relay] ❌ Timeout waiting for reservation`)
    return false
  }

  /**
   * Maintain connection to relay server.
   * 
   * This is the KEY to keeping reservations valid. Per circuit-v2 spec:
   * "The reservation remains valid until its expiration, as long as there 
   * is an active connection from the peer to the relay. If the peer 
   * disconnects, the reservation is no longer valid."
   * 
   * We do NOT "refresh" reservations by closing/reopening connections.
   * We simply maintain the connection, and libp2p handles reservation refresh.
   */
  startRelayConnectionMaintenance(intervalMs: number = 10_000): void {
    console.log(`[Relay] Starting connection maintenance (check every ${intervalMs/1000}s)`)
    
    const maintainConnection = async () => {
      if (!this.node) return
      
      const isConnected = this.isConnectedToRelay()
      
      if (!isConnected) {
        console.warn(`[Relay] ⚠️ Connection lost! Reconnecting...`)
        try {
          await this.dialRelay(RELAY_ADDR)
          // Wait a bit for reservation to be re-established
          await new Promise(r => setTimeout(r, 2000))
          
          if (this.hasRelayReservation()) {
            console.log(`[Relay] ✅ Reconnected and reservation restored`)
          } else {
            console.warn(`[Relay] ⚠️ Reconnected but no reservation yet`)
          }
        } catch (err: any) {
          console.error(`[Relay] ❌ Reconnection failed: ${err.message}`)
        }
      }
      // If connected, do nothing - libp2p handles reservation refresh
    }
    
    // Check immediately
    maintainConnection()
    
    // Then check periodically
    this.relayMaintenanceInterval = setInterval(maintainConnection, intervalMs)
  }

  /**
   * Stop connection maintenance
   */
  stopRelayConnectionMaintenance(): void {
    if (this.relayMaintenanceInterval) {
      clearInterval(this.relayMaintenanceInterval)
      this.relayMaintenanceInterval = null
      console.log(`[Relay] Stopped connection maintenance`)
    }
  }

  // Legacy aliases for backward compatibility
  startReservationRefresh(intervalMs?: number): void {
    this.startRelayConnectionMaintenance(intervalMs)
  }
  
  stopReservationRefresh(): void {
    this.stopRelayConnectionMaintenance()
  }

  async start(): Promise<void> {
    if (this.node) {
      throw new Error('Node already started')
    }

    // Load or generate peer key (ephemeral for tests)
    const privateKey = await loadOrGenerateKey(this.config.ephemeralKey)

    const peerDiscovery = []
    
    // Add bootstrap peers if configured
    if (this.config.bootstrapPeers.length > 0) {
      peerDiscovery.push(bootstrap({
        list: this.config.bootstrapPeers
      }))
    }

    // Add mDNS for local discovery
    if (this.config.enableMdns) {
      peerDiscovery.push(mdns())
    }

    this.node = await createLibp2p({
      privateKey,
      addresses: {
        listen: [
          `/ip4/0.0.0.0/tcp/${this.config.port}`,
          `/ip4/0.0.0.0/tcp/${this.config.port + 1}/ws`,  // WebSocket on port+1
          '/p2p-circuit'  // Listen via relay for incoming connections
        ],
        // Only include announce if non-empty, otherwise let libp2p auto-discover relay addresses
        ...(this.config.announceAddrs.length > 0 ? { announce: this.config.announceAddrs } : {})
      },
      transports: [
        tcp(),
        webSockets(),
        circuitRelayTransport({
          // Default options - libp2p handles relay discovery and reservation automatically
          // when we dial a relay peer and have '/p2p-circuit' in our listen addresses
          reservationCompletionTimeout: 10_000
        })
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: peerDiscovery as any,
      connectionManager: {
        // Connection pool limits to prevent resource exhaustion
        // See docs/STABILITY-PERFORMANCE-AUDIT.md Issue #4
        maxConnections: 100,           // Max total connections (prevents FD exhaustion)
        pollInterval: 2000,            // Check connection count every 2s
        autoDialInterval: 10000,       // Try to maintain connections
        inboundConnectionThreshold: 5  // Max concurrent inbound connections
      },
      services: {
        identify: identify(),
        pubsub: gossipsub({
          emitSelf: false,
          allowPublishToZeroTopicPeers: true
        }) as any
        // Enable GossipSub for service discovery
        // ping and NAT services still disabled to avoid relay issues
      }
    })

    // Set up event handlers
    this.setupEventHandlers()

    // Set up protocol handlers for direct messages
    this.setupProtocolHandlers()

    // Start the node
    await this.node.start()

    // Initialize message handler
    this.messageHandler = new MessageHandler({
      node: this.node,
      peerId: this.peerId,
      relayAddr: RELAY_ADDR,
      onMessage: (msg, peerId) => this.handleIncomingMessage(msg, peerId)
    })
    this.messageHandler.register()

    // Initialize discovery service
    const pubsub = this.node.services.pubsub as any
    if (pubsub) {
      this.discovery = new DiscoveryService(this.peerId, {
        announceIntervalMs: 300000,  // 5 minutes
        staleTimeoutMs: 900000,      // 15 minutes
        cleanupIntervalMs: 60000     // 1 minute
      })

      // Forward discovery events (track handlers for cleanup)
      const peerDiscoveredHandler = (peer: PeerInfo) => {
        this.peers.set(peer.peerId, peer)
        this.emit('peer:discovered', peer)
        console.log(`[Discovery] New peer: ${peer.peerId.substring(0, 16)}... with ${peer.services?.length || 0} services`)
      }
      this.discovery.on('peer:discovered', peerDiscoveredHandler)
      this.eventListeners.push({ target: this.discovery, event: 'peer:discovered', handler: peerDiscoveredHandler })

      const peerUpdatedHandler = (peer: PeerInfo) => {
        this.peers.set(peer.peerId, peer)
        this.emit('peer:updated', peer)
      }
      this.discovery.on('peer:updated', peerUpdatedHandler)
      this.eventListeners.push({ target: this.discovery, event: 'peer:updated', handler: peerUpdatedHandler })

      const peerStaleHandler = (peerId: string) => {
        this.peers.delete(peerId)
        this.emit('peer:stale', peerId)
      }
      this.discovery.on('peer:stale', peerStaleHandler)
      this.eventListeners.push({ target: this.discovery, event: 'peer:stale', handler: peerStaleHandler })

      const announcementHandler = (announcement: PeerAnnouncement) => {
        this.emit('announcement:received', announcement)
      }
      this.discovery.on('announcement', announcementHandler)
      this.eventListeners.push({ target: this.discovery, event: 'announcement', handler: announcementHandler })

      await this.discovery.start(pubsub, this.multiaddrs)
      console.log('[Discovery] Service initialized')
    } else {
      console.warn('[Discovery] PubSub not available, discovery disabled')
    }

    // Initialize status broadcaster
    if (pubsub) {
      this.statusBroadcaster = new StatusBroadcaster(
        this.peerId,
        this.nodeName,
        () => this.multiaddrs,
        () => this.services.map(s => s.id),
        () => this.getConnectedPeers(),
        { broadcastIntervalMs: this.statusBroadcastIntervalMs }
      )

      // Forward status-received events from broadcaster to node
      const statusHandler = (status: any) => {
        this.emit('node-status', status)
      }
      this.statusBroadcaster.on('status-received', statusHandler)
      this.eventListeners.push({ target: this.statusBroadcaster, event: 'status-received', handler: statusHandler })

      await this.statusBroadcaster.start(pubsub)
      console.log('[StatusBroadcaster] Service initialized')
    }

    console.log(`P2P node started with PeerId: ${this.peerId}`)
    console.log(`Listening on: ${this.multiaddrs.join(', ')}`)
  }

  async stop(): Promise<void> {
    console.log('[Node] Stopping P2P node and cleaning up resources...')
    
    // Clear announcement interval
    if (this.announcementInterval) {
      clearInterval(this.announcementInterval)
      this.announcementInterval = null
    }
    
    // Stop relay maintenance (clears its interval)
    this.stopRelayConnectionMaintenance()
    
    // Remove all tracked event listeners
    console.log(`[Node] Removing ${this.eventListeners.length} event listeners...`)
    for (const { target, event, handler } of this.eventListeners) {
      try {
        if (target && typeof target.removeEventListener === 'function') {
          target.removeEventListener(event, handler)
        } else if (target && typeof target.removeListener === 'function') {
          target.removeListener(event, handler)
        } else if (target && typeof target.off === 'function') {
          target.off(event, handler)
        }
      } catch (err) {
        console.warn(`[Node] Failed to remove listener for ${event}:`, err)
      }
    }
    this.eventListeners = []
    
    // Stop discovery service
    if (this.discovery) {
      await this.discovery.stop()
      this.discovery = null
    }

    // Stop status broadcaster
    if (this.statusBroadcaster) {
      await this.statusBroadcaster.stop()
      this.statusBroadcaster = null
    }
    
    // Clear message handler
    if (this.messageHandler) {
      this.messageHandler = null
    }
    
    // Stop libp2p node
    if (this.node) {
      await this.node.stop()
      this.node = null
    }
    
    // Clear peers map
    this.peers.clear()
    
    console.log('[Node] P2P node stopped successfully')
  }

  private setupEventHandlers(): void {
    if (!this.node) return

    // Helper to register and track event listeners
    const addTrackedListener = (target: any, event: string, handler: any) => {
      target.addEventListener(event, handler)
      this.eventListeners.push({ target, event, handler })
    }

    // Peer discovery
    const peerDiscoveryHandler = (evt: any) => {
      const peerId = evt.detail.id.toString()
      console.log(`Discovered peer: ${peerId}`)
      this.emit('peer:discovered', { peerId, multiaddrs: [], protocols: [], lastSeen: Date.now() })
    }
    addTrackedListener(this.node, 'peer:discovery', peerDiscoveryHandler)

    // Peer connection
    const peerConnectHandler = (evt: any) => {
      const peerId = evt.detail.toString()
      console.log(`Connected to peer: ${peerId}`)
      this.emit('peer:connected', peerId)
      
      // Log when we connect to relay
      if (peerId === P2PNode.RELAY_PEER_ID) {
        console.log(`[Relay] 🔌 Connected to relay server`)
      }
    }
    addTrackedListener(this.node, 'peer:connect', peerConnectHandler)

    // Peer disconnection - CRITICAL for relay health
    const peerDisconnectHandler = (evt: any) => {
      const peerId = evt.detail.toString()
      console.log(`Disconnected from peer: ${peerId}`)
      this.emit('peer:disconnected', peerId)
      
      // If relay disconnected, trigger immediate reconnection
      // Don't wait for the maintenance loop - this is time-critical
      if (peerId === P2PNode.RELAY_PEER_ID) {
        console.warn(`[Relay] ⚠️ DISCONNECTED from relay server! Reservation is now INVALID.`)
        
        // Immediate reconnection attempt (don't block the event handler)
        setImmediate(async () => {
          console.log(`[Relay] Attempting immediate reconnection...`)
          try {
            await this.dialRelay(RELAY_ADDR)
            // Wait for reservation
            const success = await this.waitForReservation(10_000)
            if (success) {
              console.log(`[Relay] ✅ Reconnected and reservation restored`)
            } else {
              console.error(`[Relay] ⚠️ Reconnected but reservation not restored`)
            }
          } catch (err: any) {
            console.error(`[Relay] ❌ Immediate reconnection failed: ${err.message}`)
            // The maintenance loop will retry
          }
        })
      }
    }
    addTrackedListener(this.node, 'peer:disconnect', peerDisconnectHandler)
    
    // Listen for address changes (can indicate reservation changes)
    const selfPeerUpdateHandler = (evt: any) => {
      const addrs = this.multiaddrs
      const relayAddrs = addrs.filter(a => a.includes('p2p-circuit'))
      console.log(`[Node] Address update: ${addrs.length} addrs, ${relayAddrs.length} relay`)
    }
    addTrackedListener(this.node, 'self:peer:update', selfPeerUpdateHandler)
  }

  private async subscribeToTopics(): Promise<void> {
    if (!this.node) return

    const pubsub = this.node.services.pubsub as any
    if (!pubsub) {
      console.log('[PubSub] Not available, skipping topic subscriptions')
      return
    }

    // Subscribe to announcement topic
    pubsub.subscribe(TOPICS.ANNOUNCE)
    
    // Handle incoming messages
    const messageHandler = (evt: any) => {
      const topic = evt.detail.topic
      const data = evt.detail.data
      
      try {
        const message = JSON.parse(new TextDecoder().decode(data))
        
        if (topic === TOPICS.ANNOUNCE) {
          this.handleAnnouncement(message as PeerAnnouncement)
        }
      } catch (err) {
        console.error('Failed to parse pubsub message:', err)
      }
    }
    
    pubsub.addEventListener('message', messageHandler)
    this.eventListeners.push({ target: pubsub, event: 'message', handler: messageHandler })
  }

  private handleAnnouncement(announcement: PeerAnnouncement): void {
    // Don't process our own announcements
    if (announcement.peerId === this.peerId) return

    // TODO: Verify signature
    
    // Update peer info
    const peerInfo: PeerInfo = {
      peerId: announcement.peerId,
      multiaddrs: announcement.multiaddrs,
      protocols: [],
      bsvIdentityKey: announcement.bsvIdentityKey,
      services: announcement.services,
      lastSeen: announcement.timestamp
    }

    this.peers.set(announcement.peerId, peerInfo)
    this.emit('announcement:received', announcement)
    console.log(`Received announcement from ${announcement.peerId} with ${announcement.services.length} services`)
  }

  private setupProtocolHandlers(): void {
    if (!this.node) return

    // Handle ping protocol for connection testing
    // Handler signature varies by libp2p version - accept both formats
    this.node.handle('/openclaw/ping/1.0.0', async (data: any) => {
      console.log(`[Ping] Handler called, data type:`, data?.constructor?.name)
      
      // Handle both v2 ({ stream, connection }) and v3 (stream directly) signatures
      const stream = data.stream || data
      console.log(`[Ping] Stream type:`, stream?.constructor?.name, 'status:', stream?.status)

      try {
        // Use length-prefixed encoding for proper message framing over circuit relay
        let pingData: any = null
        
        await pipe(
          stream,
          (source: any) => lp.decode(source),
          async (source: any) => {
            for await (const chunk of source) {
              const bytes = chunk instanceof Uint8Array ? chunk : chunk.subarray()
              const msg = new TextDecoder().decode(bytes)
              console.log(`[Ping] Received: ${msg}`)
              pingData = JSON.parse(msg)
              break // Only expect one message
            }
          }
        )
        
        if (!pingData) {
          console.log(`[Ping] No data received`)
          return
        }
        
        // Build pong response
        const pong = JSON.stringify({ 
          type: 'pong', 
          timestamp: Date.now(),
          from: this.peerId,
          inResponseTo: pingData.ts || pingData.timestamp
        })
        
        console.log(`[Ping] Sending pong: ${pong}`)
        
        // Send response with length prefix
        const encoded = new TextEncoder().encode(pong)
        await pipe(
          [encoded],
          (source: any) => lp.encode(source),
          async (source: any) => {
            for await (const chunk of source) {
              stream.send(chunk)
            }
          }
        )
        
        console.log(`[Ping] Sent pong`)
        
        // Close write side
        await stream.sendCloseWrite?.()
        
      } catch (err) {
        console.error(`[Ping] Error handling ping:`, err)
      }
    }, { runOnLimitedConnection: true })

    console.log(`[Protocol] Registered handler for /openclaw/ping/1.0.0`)
  }

  /**
   * Handle incoming P2P message and wake agent
   */
  private async handleIncomingMessage(msg: Message, peerId: string): Promise<void> {
    console.log(`[Message] Handling ${msg.type} from ${peerId.substring(0, 16)}...`)
    
    // Emit event for external listeners
    this.emit('message', { msg, peerId })
    this.emit(`message:${msg.type}`, { msg, peerId })
    
    // Notify agent if gateway is enabled
    if (!this.gateway.isEnabled) {
      console.log(`[Message] Gateway not enabled, not waking agent`)
      return
    }
    
    // Format message for agent
    const text = formatMessageForAgent(msg, peerId)
    
    // Use /hooks/agent with a stable session key — all P2P messages go to one
    // dedicated session rather than spawning a new one each time. This keeps
    // conversation context between messages and avoids session sprawl.
    // TTL of 120s prevents runaway turns on trivial messages.
    const result = await this.gateway.runAgent(text, {
      name: 'P2P',
      sessionKey: 'p2p-messages',
      wakeMode: 'now',
      deliver: true,   // deliver response to chat so human sees bot activity
      timeoutSeconds: 120  // 2 min TTL — enough to read, think, and reply
    })
    
    if (!result.ok) {
      // Fall back to wake if agent endpoint fails
      console.warn(`[Message] Agent run failed (${result.error}), falling back to wake`)
      const wakeResult = await this.gateway.wake(text, { mode: 'now' })
      if (!wakeResult.ok) {
        console.error(`[Message] Wake fallback also failed: ${wakeResult.error}`)
      }
    } else {
      console.log(`[Message] Agent turn started for ${msg.type} from ${peerId.substring(0, 16)}`)
    }
  }

  /**
   * Dial a peer using their multiaddr
   */
  async dial(multiaddr: string): Promise<void> {
    if (!this.node) {
      throw new Error('Node not started')
    }
    const { multiaddr: ma } = await import('@multiformats/multiaddr')
    const addr = ma(multiaddr)
    await this.node.dial(addr)
  }

  /**
   * Send a text message to another peer
   */
  async sendMessage(toPeerId: string, content: string): Promise<void> {
    if (!this.messageHandler) {
      throw new Error('Message handler not initialized')
    }
    await this.messageHandler.sendText(toPeerId, content)
  }

  /**
   * Send a payment with BEEF to another peer
   */
  async sendPayment(toPeerId: string, opts: {
    txid: string, vout: number, amount: number, toAddress: string, beef?: string, memo?: string
  }): Promise<void> {
    if (!this.messageHandler) throw new Error('Message handler not initialized')
    await this.messageHandler.sendPayment(toPeerId, opts)
  }

  /**
   * Send a service request to another peer
   */
  async sendRequest(
    toPeerId: string, 
    service: string, 
    params: Record<string, any>,
    timeoutMs?: number
  ): Promise<any> {
    if (!this.messageHandler) {
      throw new Error('Message handler not initialized')
    }
    const response = await this.messageHandler.request(toPeerId, service, params, timeoutMs)
    return response
  }

  // Legacy announcement methods (now handled by DiscoveryService)
  async announce(): Promise<void> {
    if (this.discovery) {
      // Discovery service handles announcements automatically
      console.log('[P2PNode] Announcements handled by DiscoveryService')
    }
  }

  startAnnouncing(intervalMs: number = 300000): void {
    // Discovery service starts announcing automatically in start()
    console.log('[P2PNode] Discovery service handles announcements automatically')
  }

  setBsvIdentityKey(key: string): void {
    this.bsvIdentityKey = key
    if (this.discovery) {
      this.discovery.setBsvIdentityKey(key)
    }
  }

  setNodeName(name: string): void {
    this.nodeName = name
    if (this.statusBroadcaster) {
      this.statusBroadcaster.setNodeName(name)
    }
  }

  getNodeName(): string {
    return this.nodeName || this.peerId.substring(0, 8)
  }

  async broadcastStatus(): Promise<void> {
    if (this.statusBroadcaster) {
      await this.statusBroadcaster.broadcast()
    } else {
      console.warn('[P2PNode] Status broadcaster not initialized')
    }
  }

  getStatusBroadcaster(): StatusBroadcaster | null {
    return this.statusBroadcaster
  }

  registerService(service: ServiceInfo): void {
    // Remove existing service with same id
    this.services = this.services.filter(s => s.id !== service.id)
    this.services.push(service)
    
    if (this.discovery) {
      this.discovery.registerService(service)
    }
  }

  unregisterService(serviceId: string): void {
    this.services = this.services.filter(s => s.id !== serviceId)
    
    if (this.discovery) {
      this.discovery.unregisterService(serviceId)
    }
  }

  getServices(): ServiceInfo[] {
    if (this.discovery) {
      return this.discovery.getServices()
    }
    return [...this.services]
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values())
  }

  getPeer(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId)
  }

  async connect(addr: string): Promise<void> {
    if (!this.node) throw new Error('Node not started')
    
    // Pass multiaddr with AbortController to work around libp2p bug
    const ma = multiaddr(addr)
    const controller = new AbortController()
    await this.node.dial(ma, { signal: controller.signal })
  }

  async disconnect(peerId: string): Promise<void> {
    if (!this.node) throw new Error('Node not started')
    
    const connections = this.node.getConnections().filter(
      conn => conn.remotePeer.toString() === peerId
    )
    
    for (const conn of connections) {
      await conn.close()
    }
  }

  getConnectedPeers(): string[] {
    if (!this.node) return []
    return this.node.getConnections().map(conn => conn.remotePeer.toString())
  }

  async ping(peerId: string): Promise<number> {
    if (!this.node) throw new Error('Node not started')

    const peerIdObj = this.node.getConnections().find(
      conn => conn.remotePeer.toString() === peerId
    )?.remotePeer

    if (!peerIdObj) {
      throw new Error(`Not connected to peer ${peerId}`)
    }

    // Ping service is not enabled to avoid relay issues
    // Return 0 as a placeholder
    return 0
  }

  // Discovery methods
  async discoverPeers(options?: { service?: string }): Promise<PeerInfo[]> {
    if (this.discovery && options?.service) {
      return this.discovery.discoverService(options.service)
    }
    
    return this.getPeers()
  }
  
  /**
   * Get discovery service statistics
   */
  getDiscoveryStats(): {
    knownPeers: number
    registeredServices: number
    isRunning: boolean
  } | null {
    return this.discovery?.getStats() ?? null
  }
}

export async function createP2PNode(config?: P2PNodeConfig): Promise<P2PNode> {
  const node = new P2PNode(config)
  await node.start()
  return node
}
