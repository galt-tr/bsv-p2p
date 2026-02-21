/**
 * Node status broadcaster for heartbeat and discovery
 *
 * Broadcasts NodeStatusMessage to the node-status topic periodically
 * to enable automatic peer discovery with human-readable names.
 */

import { EventEmitter } from 'events'
import { NodeStatusMessage, TOPICS } from './types.js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface StatusBroadcasterConfig {
  broadcastIntervalMs: number       // How often to broadcast status (default: 60 seconds)
}

const DEFAULT_STATUS_CONFIG: StatusBroadcasterConfig = {
  broadcastIntervalMs: 60000    // 1 minute
}

export class StatusBroadcaster extends EventEmitter {
  private config: StatusBroadcasterConfig
  private peerId: string
  private nodeName: string
  private pubsub: any = null
  private getMultiaddrs: () => string[]
  private getServices: () => string[]
  private getConnectedPeers: () => string[]

  private broadcastInterval: NodeJS.Timeout | null = null
  private isStarted: boolean = false
  private startTime: number = Date.now()
  private lastBroadcast: number | null = null

  constructor(
    peerId: string,
    nodeName: string | undefined,
    getMultiaddrs: () => string[],
    getServices: () => string[],
    getConnectedPeers: () => string[],
    config: Partial<StatusBroadcasterConfig> = {}
  ) {
    super()
    this.peerId = peerId
    this.nodeName = nodeName || peerId.substring(0, 8)
    this.config = { ...DEFAULT_STATUS_CONFIG, ...config }
    this.getMultiaddrs = getMultiaddrs
    this.getServices = getServices
    this.getConnectedPeers = getConnectedPeers
  }

  /**
   * Get the package version
   */
  private getVersion(): string {
    try {
      const packagePath = join(__dirname, '..', '..', 'package.json')
      const packageData = JSON.parse(readFileSync(packagePath, 'utf-8'))
      return packageData.version || 'unknown'
    } catch {
      return 'unknown'
    }
  }

  /**
   * Start the status broadcaster
   */
  async start(pubsub: any): Promise<void> {
    if (this.isStarted) {
      throw new Error('Status broadcaster already started')
    }

    if (!pubsub) {
      throw new Error('PubSub service required for status broadcasting')
    }

    this.pubsub = pubsub
    this.isStarted = true
    this.startTime = Date.now()

    // Subscribe to node status topic
    this.pubsub.subscribe(TOPICS.NODE_STATUS)
    console.log(`[StatusBroadcaster] Subscribed to ${TOPICS.NODE_STATUS}`)

    // Handle incoming status messages
    this.pubsub.addEventListener('message', (evt: any) => {
      if (evt.detail.topic === TOPICS.NODE_STATUS) {
        this.handleStatusMessage(evt.detail.data)
      }
    })

    // Broadcast immediately on start
    await this.broadcast()

    // Start periodic broadcasts
    this.broadcastInterval = setInterval(() => {
      this.broadcast().catch(err =>
        console.error('[StatusBroadcaster] Broadcast failed:', err)
      )
    }, this.config.broadcastIntervalMs)

    console.log(`[StatusBroadcaster] Broadcasting every ${this.config.broadcastIntervalMs}ms`)
  }

  /**
   * Stop the status broadcaster
   */
  async stop(): Promise<void> {
    if (!this.isStarted) return

    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval)
      this.broadcastInterval = null
    }

    if (this.pubsub) {
      this.pubsub.unsubscribe(TOPICS.NODE_STATUS)
    }

    this.isStarted = false
    console.log('[StatusBroadcaster] Stopped')
  }

  /**
   * Update the node name
   */
  setNodeName(name: string): void {
    this.nodeName = name
  }

  /**
   * Get the last broadcast timestamp
   */
  getLastBroadcast(): number | null {
    return this.lastBroadcast
  }

  /**
   * Handle incoming status message
   */
  private handleStatusMessage(data: Uint8Array): void {
    try {
      const decoded = new TextDecoder().decode(data)
      const status: NodeStatusMessage = JSON.parse(decoded)

      // Don't process our own status broadcasts
      if (status.peerId === this.peerId) {
        return
      }

      // Emit the status for the P2PNode to handle
      this.emit('status-received', status)
    } catch (err: any) {
      console.error(`[StatusBroadcaster] Failed to parse status message: ${err.message}`)
    }
  }

  /**
   * Broadcast our node status
   */
  async broadcast(): Promise<void> {
    if (!this.pubsub || !this.isStarted) return

    const uptime = Math.floor((Date.now() - this.startTime) / 1000)
    const connectedPeers = this.getConnectedPeers()

    const status: NodeStatusMessage = {
      peerId: this.peerId,
      name: this.nodeName,
      multiaddrs: this.getMultiaddrs(),
      services: this.getServices(),
      version: this.getVersion(),
      uptime,
      connectedPeers: connectedPeers.length,
      timestamp: Date.now()
    }

    const data = new TextEncoder().encode(JSON.stringify(status))

    try {
      await this.pubsub.publish(TOPICS.NODE_STATUS, data)
      this.lastBroadcast = Date.now()
      console.log(`[StatusBroadcaster] Published status: name=${this.nodeName}, peers=${connectedPeers.length}, uptime=${uptime}s`)
      this.emit('broadcast', status)
    } catch (err: any) {
      console.error(`[StatusBroadcaster] Publish failed: ${err.message}`)
      throw err
    }
  }
}