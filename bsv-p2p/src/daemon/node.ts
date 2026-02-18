import { createLibp2p, Libp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
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
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { EventEmitter } from 'events'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import * as lp from 'it-length-prefixed'
import { pipe } from 'it-pipe'
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
import { ChannelMessage, ChannelMessageType, deserializeMessage, CHANNEL_PROTOCOL } from '../channels/wire.js'
import { MessageHandler, formatMessageForAgent, Message, MessageType, TextMessage, RequestMessage, PaidRequestMessage, MESSAGE_PROTOCOL } from '../protocol/index.js'

const KEY_FILE = join(homedir(), '.bsv-p2p', 'peer-key.json')
const RELAY_ADDR = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'

/**
 * Load existing private key or generate a new one
 */
async function loadOrGenerateKey(): Promise<ReturnType<typeof privateKeyFromProtobuf>> {
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
  private peers: Map<string, PeerInfo> = new Map()
  private services: ServiceInfo[] = []
  private bsvIdentityKey: string | null = null
  private announcementInterval: NodeJS.Timeout | null = null
  private messageHandler: MessageHandler | null = null

  constructor(config: P2PNodeConfig = {}) {
    super()
    const { gateway, ...nodeConfig } = config
    this.config = { ...DEFAULT_CONFIG, ...nodeConfig }
    this.gatewayConfig = gateway ?? {}
    this.gateway = new GatewayClient(this.gatewayConfig)
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
  private static readonly RELAY_PEER_ID = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'

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
      console.log(`[Relay] Connected to relay - reservation will be established automatically`)
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

    // Load or generate persistent peer key
    const privateKey = await loadOrGenerateKey()

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
          '/p2p-circuit'  // Listen via relay for incoming connections
        ],
        // Only include announce if non-empty, otherwise let libp2p auto-discover relay addresses
        ...(this.config.announceAddrs.length > 0 ? { announce: this.config.announceAddrs } : {})
      },
      transports: [
        tcp(),
        circuitRelayTransport({
          // Default options - libp2p handles relay discovery and reservation automatically
          // when we dial a relay peer and have '/p2p-circuit' in our listen addresses
          reservationCompletionTimeout: 10_000
        })
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery,
      services: {
        identify: identify()
        // Minimal services only - matches working relay test
        // ping, gossipsub, and NAT services disabled - they interfere with relay reservations
      }
    })

    // Set up event handlers
    this.setupEventHandlers()

    // Subscribe to announcement topic
    await this.subscribeToTopics()
    
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

    console.log(`P2P node started with PeerId: ${this.peerId}`)
    console.log(`Listening on: ${this.multiaddrs.join(', ')}`)
  }

  async stop(): Promise<void> {
    if (this.announcementInterval) {
      clearInterval(this.announcementInterval)
      this.announcementInterval = null
    }
    
    this.stopRelayConnectionMaintenance()

    if (this.node) {
      await this.node.stop()
      this.node = null
    }
  }

  private setupEventHandlers(): void {
    if (!this.node) return

    // Peer discovery
    this.node.addEventListener('peer:discovery', (evt) => {
      const peerId = evt.detail.id.toString()
      console.log(`Discovered peer: ${peerId}`)
      this.emit('peer:discovered', { peerId, multiaddrs: [], protocols: [], lastSeen: Date.now() })
    })

    // Peer connection
    this.node.addEventListener('peer:connect', (evt) => {
      const peerId = evt.detail.toString()
      console.log(`Connected to peer: ${peerId}`)
      this.emit('peer:connected', peerId)
      
      // Log when we connect to relay
      if (peerId === P2PNode.RELAY_PEER_ID) {
        console.log(`[Relay] 🔌 Connected to relay server`)
      }
    })

    // Peer disconnection - CRITICAL for relay health
    this.node.addEventListener('peer:disconnect', (evt) => {
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
    })
    
    // Listen for address changes (can indicate reservation changes)
    this.node.addEventListener('self:peer:update', (evt) => {
      const addrs = this.multiaddrs
      const relayAddrs = addrs.filter(a => a.includes('p2p-circuit'))
      console.log(`[Node] Address update: ${addrs.length} addrs, ${relayAddrs.length} relay`)
    })
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
    pubsub.addEventListener('message', (evt: any) => {
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
    })
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

    // Handle incoming channel protocol streams
    // Handler signature varies by libp2p version - accept both formats
    this.node.handle(CHANNEL_PROTOCOL, async (data: any) => {
      // Handle both v2 ({ stream, connection }) and v3 (stream directly) signatures
      const stream = data.stream || data
      console.log(`[Protocol] Incoming channel stream, type:`, stream?.constructor?.name)

      try {
        // Read the incoming message using v3 API (stream is async iterable)
        const chunks: Uint8Array[] = []
        for await (const chunk of stream) {
          chunks.push(chunk instanceof Uint8Array ? chunk : chunk.subarray())
        }
        
        if (chunks.length === 0) {
          console.log(`[Protocol] Empty stream`)
          return
        }

        // Combine chunks and deserialize
        const combinedData = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0))
        let offset = 0
        for (const chunk of chunks) {
          combinedData.set(chunk, offset)
          offset += chunk.length
        }

        const message = deserializeMessage(combinedData)
        console.log(`[Protocol] Received ${message.type}`)
        
        // Emit the message for local handlers (peerId unknown in v3 handler)
        this.emit('channel:message', { peerId: 'unknown', message })
        
        // Wake the agent to handle the message
        await this.wakeAgentForChannelMessage('unknown', message)

      } catch (err) {
        console.error(`[Protocol] Error handling stream:`, err)
      }
    }, { runOnLimitedConnection: true })

    console.log(`[Protocol] Registered handler for ${CHANNEL_PROTOCOL}`)

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
    
    // Wake agent if gateway is enabled
    if (!this.gateway.isEnabled) {
      console.log(`[Message] Gateway not enabled, not waking agent`)
      return
    }
    
    // Format message for agent
    const text = formatMessageForAgent(msg, peerId)
    
    // Wake the agent
    const result = await this.gateway.wake(text, { mode: 'now' })
    
    if (!result.ok) {
      console.error(`[Message] Failed to wake agent: ${result.error}`)
    } else {
      console.log(`[Message] Agent woken for ${msg.type}`)
    }
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

  /**
   * Wake the agent to handle an incoming channel message
   */
  private async wakeAgentForChannelMessage(peerId: string, message: ChannelMessage): Promise<void> {
    if (!this.gateway.isEnabled) {
      console.log(`[Protocol] Gateway not enabled, message not forwarded to agent`)
      return
    }

    // Format the message for the agent
    const text = this.formatChannelMessageForAgent(peerId, message)
    
    // For simple updates, use wake (main session system event)
    // For complex operations, could use runAgent for isolated handling
    const result = await this.gateway.wake(text, { mode: 'now' })
    
    if (!result.ok) {
      console.error(`[Protocol] Failed to wake agent: ${result.error}`)
    }
  }

  /**
   * Format a channel message for the agent to understand
   */
  private formatChannelMessageForAgent(peerId: string, message: ChannelMessage): string {
    const peerShort = peerId.substring(0, 16)
    
    switch (message.type) {
      case ChannelMessageType.OPEN_REQUEST:
        return `[P2P Channel] Peer ${peerShort}... requests to open payment channel.
Channel ID: ${message.channelId}
Proposed capacity: ${(message as any).proposedCapacity} sats
Lock time: ${(message as any).proposedLockTimeSeconds} seconds
Their pubkey: ${(message as any).ourPubKey}
Their identity: ${(message as any).identityKey}

Use bsv-p2p skill to accept or reject.`

      case ChannelMessageType.OPEN_ACCEPT:
        return `[P2P Channel] Peer ${peerShort}... accepted channel open.
Channel ID: ${message.channelId}
Their pubkey: ${(message as any).ourPubKey}
Lock time: ${(message as any).agreedLockTime}

Channel setup can proceed.`

      case ChannelMessageType.OPEN_REJECT:
        return `[P2P Channel] Peer ${peerShort}... rejected channel open.
Channel ID: ${message.channelId}
Reason: ${(message as any).reason}`

      case ChannelMessageType.FUNDING_CREATED:
        return `[P2P Channel] Peer ${peerShort}... created funding transaction.
Channel ID: ${message.channelId}
Funding TX: ${(message as any).fundingTxId}

Sign the commitment to proceed.`

      case ChannelMessageType.FUNDING_SIGNED:
        return `[P2P Channel] Peer ${peerShort}... signed the commitment.
Channel ID: ${message.channelId}

Channel is ready to activate.`

      case ChannelMessageType.CHANNEL_READY:
        return `[P2P Channel] Channel ${message.channelId.substring(0, 16)}... is now ready.
Peer: ${peerShort}...

Payments can now be sent/received.`

      case ChannelMessageType.UPDATE_REQUEST:
        const update = message as any
        return `[P2P Payment] Peer ${peerShort}... sent payment.
Channel ID: ${message.channelId}
Amount: ${update.amount} sats
Memo: ${update.memo ?? '(none)'}
New balance: you=${update.newReceiverBalance} them=${update.newSenderBalance}

Acknowledge to accept payment.`

      case ChannelMessageType.UPDATE_ACK:
        return `[P2P Payment] Peer ${peerShort}... acknowledged payment.
Channel ID: ${message.channelId}
Sequence: ${(message as any).ackSequence}

Payment confirmed.`

      case ChannelMessageType.UPDATE_REJECT:
        return `[P2P Payment] Peer ${peerShort}... rejected payment.
Channel ID: ${message.channelId}
Reason: ${(message as any).reason}`

      case ChannelMessageType.CLOSE_REQUEST:
        return `[P2P Channel] Peer ${peerShort}... requests channel close.
Channel ID: ${message.channelId}
Final sequence: ${(message as any).finalSequence}

Sign settlement to close cooperatively.`

      case ChannelMessageType.CLOSE_ACCEPT:
        return `[P2P Channel] Peer ${peerShort}... accepted close.
Channel ID: ${message.channelId}

Broadcast settlement to complete.`

      case ChannelMessageType.CLOSE_COMPLETE:
        return `[P2P Channel] Channel closed.
Channel ID: ${message.channelId}
Settlement TX: ${(message as any).settlementTxId}`

      case ChannelMessageType.ERROR:
        const error = message as any
        return `[P2P Error] Peer ${peerShort}... sent error.
Channel ID: ${message.channelId}
Code: ${error.errorCode}
Message: ${error.errorMessage}`

      default:
        return `[P2P] Message from ${peerShort}...: ${message.type}
Channel ID: ${message.channelId}
Data: ${JSON.stringify(message).substring(0, 200)}`
    }
  }

  /**
   * Send a channel message to a peer
   */
  async sendChannelMessage(peerId: string, message: ChannelMessage): Promise<void> {
    if (!this.node) throw new Error('Node not started')

    const connections = this.node.getConnections().filter(
      conn => conn.remotePeer.toString() === peerId
    )

    if (connections.length === 0) {
      throw new Error(`Not connected to peer ${peerId}`)
    }

    const stream = await connections[0].newStream(CHANNEL_PROTOCOL)
    
    try {
      const data = new TextEncoder().encode(JSON.stringify(message))
      
      // Write message using the sink
      await stream.sink([data])
      
      console.log(`[Protocol] Sent ${message.type} to ${peerId}`)
      
    } finally {
      await stream.close()
    }
  }

  async announce(): Promise<void> {
    if (!this.node) return

    const pubsub = this.node.services.pubsub as any
    if (!pubsub) {
      // PubSub not available, skip announcement
      return
    }

    const announcement: PeerAnnouncement = {
      peerId: this.peerId,
      bsvIdentityKey: this.bsvIdentityKey ?? '',
      services: this.services,
      multiaddrs: this.multiaddrs,
      timestamp: Date.now(),
      signature: '' // TODO: Sign with BSV key
    }

    const data = new TextEncoder().encode(JSON.stringify(announcement))
    await pubsub.publish(TOPICS.ANNOUNCE, data)
    console.log('Published announcement')
  }

  startAnnouncing(intervalMs: number = 300000): void {
    // Announce immediately
    this.announce().catch(console.error)
    
    // Then announce periodically
    this.announcementInterval = setInterval(() => {
      this.announce().catch(console.error)
    }, intervalMs)
  }

  setBsvIdentityKey(key: string): void {
    this.bsvIdentityKey = key
  }

  registerService(service: ServiceInfo): void {
    // Remove existing service with same id
    this.services = this.services.filter(s => s.id !== service.id)
    this.services.push(service)
  }

  unregisterService(serviceId: string): void {
    this.services = this.services.filter(s => s.id !== serviceId)
  }

  getServices(): ServiceInfo[] {
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

    const latency = await this.node.services.ping.ping(peerIdObj)
    return latency
  }

  // Discovery methods
  async discoverPeers(options?: { service?: string }): Promise<PeerInfo[]> {
    let peers = this.getPeers()
    
    if (options?.service) {
      peers = peers.filter(p => 
        p.services?.some(s => s.id === options.service)
      )
    }
    
    return peers
  }
}

export async function createP2PNode(config?: P2PNodeConfig): Promise<P2PNode> {
  const node = new P2PNode(config)
  await node.start()
  return node
}
