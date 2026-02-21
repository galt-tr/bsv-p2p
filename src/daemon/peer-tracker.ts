import * as fs from 'fs'
import * as path from 'path'

interface TrackedPeer {
  peerId: string
  name: string
  lastSeen: number
  firstSeen: number
  lastConnected: number
  lastDisconnected: number
  isOnline: boolean
  messagesSent: number
  messagesReceived: number
  paymentsSent: number
  paymentsReceived: number
  totalSatsSent: number
  totalSatsReceived: number
  services: string[]
  multiaddrs: string[]
  notes: string
  tags: string[]
}

export class PeerTracker {
  private peers: Map<string, TrackedPeer>
  private dataFile: string
  private saveTimer: NodeJS.Timeout | null = null
  private isDirty = false

  constructor(dataDir: string) {
    this.dataFile = path.join(dataDir, 'peers.json')
    this.peers = new Map()
    this.load()

    if (this.peers.size === 0) {
      this.preseedMoneo()
    }
  }

  private preseedMoneo() {
    const moneoPeerId = '12D3KooWEaP93ASxzXWJanh11xZ4UneyooPxDmQ9k6L8Rb8s9Dg4'
    this.trackPeer(moneoPeerId)
    this.updateName(moneoPeerId, 'Moneo')
    this.setTags(moneoPeerId, ['friend', 'openclaw-bot'])
  }

  private load() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const data = fs.readFileSync(this.dataFile, 'utf-8')
        const parsed = JSON.parse(data)
        if (Array.isArray(parsed)) {
          for (const peer of parsed) {
            this.peers.set(peer.peerId, peer)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load peers.json:', error)
    }
  }

  private scheduleSave() {
    this.isDirty = true
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      this.save()
    }, 500)
  }

  save() {
    if (!this.isDirty && this.saveTimer === null) {
      return
    }

    try {
      const dir = path.dirname(this.dataFile)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      const data = JSON.stringify(this.toJSON(), null, 2)
      fs.writeFileSync(this.dataFile, data, 'utf-8')
      this.isDirty = false

      if (this.saveTimer) {
        clearTimeout(this.saveTimer)
        this.saveTimer = null
      }
    } catch (error) {
      console.error('Failed to save peers.json:', error)
    }
  }

  trackPeer(peerId: string): TrackedPeer {
    if (!this.peers.has(peerId)) {
      const now = Date.now()
      const peer: TrackedPeer = {
        peerId,
        name: peerId.slice(0, 8) + '...',
        lastSeen: now,
        firstSeen: now,
        lastConnected: 0,
        lastDisconnected: 0,
        isOnline: false,
        messagesSent: 0,
        messagesReceived: 0,
        paymentsSent: 0,
        paymentsReceived: 0,
        totalSatsSent: 0,
        totalSatsReceived: 0,
        services: [],
        multiaddrs: [],
        notes: '',
        tags: []
      }
      this.peers.set(peerId, peer)
      this.scheduleSave()
    }
    return this.peers.get(peerId)!
  }

  updateName(peerId: string, name: string) {
    const peer = this.trackPeer(peerId)
    peer.name = name
    this.scheduleSave()
  }

  recordMessageReceived(peerId: string) {
    const peer = this.trackPeer(peerId)
    peer.lastSeen = Date.now()
    peer.messagesReceived++
    this.scheduleSave()
  }

  recordMessageSent(peerId: string) {
    const peer = this.trackPeer(peerId)
    peer.messagesSent++
    this.scheduleSave()
  }

  recordPaymentSent(peerId: string, sats: number) {
    const peer = this.trackPeer(peerId)
    peer.paymentsSent++
    peer.totalSatsSent += sats
    this.scheduleSave()
  }

  recordPaymentReceived(peerId: string, sats: number) {
    const peer = this.trackPeer(peerId)
    peer.paymentsReceived++
    peer.totalSatsReceived += sats
    peer.lastSeen = Date.now()
    this.scheduleSave()
  }

  recordConnected(peerId: string) {
    const peer = this.trackPeer(peerId)
    peer.isOnline = true
    peer.lastConnected = Date.now()
    this.scheduleSave()
  }

  recordDisconnected(peerId: string) {
    const peer = this.trackPeer(peerId)
    peer.isOnline = false
    peer.lastDisconnected = Date.now()
    this.scheduleSave()
  }

  updateMultiaddrs(peerId: string, addrs: string[]) {
    const peer = this.trackPeer(peerId)
    peer.multiaddrs = addrs
    this.scheduleSave()
  }

  updateServices(peerId: string, services: string[]) {
    const peer = this.trackPeer(peerId)
    peer.services = services
    this.scheduleSave()
  }

  setNotes(peerId: string, notes: string) {
    const peer = this.trackPeer(peerId)
    peer.notes = notes
    this.scheduleSave()
  }

  setTags(peerId: string, tags: string[]) {
    const peer = this.trackPeer(peerId)
    peer.tags = tags
    this.scheduleSave()
  }

  getPeer(peerId: string): TrackedPeer | undefined {
    return this.peers.get(peerId)
  }

  getAllPeers(): TrackedPeer[] {
    return Array.from(this.peers.values())
  }

  getOnlinePeers(): TrackedPeer[] {
    return Array.from(this.peers.values()).filter(p => p.isOnline)
  }

  searchPeers(query: string): TrackedPeer[] {
    const q = query.toLowerCase()
    return Array.from(this.peers.values()).filter(peer => {
      return peer.name.toLowerCase().includes(q) ||
        peer.peerId.toLowerCase().includes(q) ||
        peer.notes.toLowerCase().includes(q) ||
        peer.tags.some(tag => tag.toLowerCase().includes(q))
    })
  }

  removePeer(peerId: string) {
    if (this.peers.delete(peerId)) {
      this.scheduleSave()
    }
  }

  markAllOffline() {
    for (const peer of this.peers.values()) {
      peer.isOnline = false
    }
    this.scheduleSave()
  }

  toJSON() {
    return Array.from(this.peers.values())
  }
}