import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { bootstrap } from '@libp2p/bootstrap';
import { mdns } from '@libp2p/mdns';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { multiaddr } from '@multiformats/multiaddr';
import { EventEmitter } from 'events';
import { DEFAULT_CONFIG, TOPICS } from './types.js';
import { GatewayClient } from './gateway.js';
import { ChannelMessageType, deserializeMessage, CHANNEL_PROTOCOL } from '../channels/protocol.js';
export class P2PNode extends EventEmitter {
    node = null;
    config;
    gatewayConfig;
    gateway;
    peers = new Map();
    services = [];
    bsvIdentityKey = null;
    announcementInterval = null;
    constructor(config = {}) {
        super();
        const { gateway, ...nodeConfig } = config;
        this.config = { ...DEFAULT_CONFIG, ...nodeConfig };
        this.gatewayConfig = gateway ?? {};
        this.gateway = new GatewayClient(this.gatewayConfig);
    }
    /**
     * Get the gateway client for external use
     */
    get gatewayClient() {
        return this.gateway;
    }
    /**
     * Configure the gateway client
     */
    configureGateway(config) {
        this.gateway.configure(config);
    }
    get peerId() {
        return this.node?.peerId.toString() ?? '';
    }
    get multiaddrs() {
        return this.node?.getMultiaddrs().map(ma => ma.toString()) ?? [];
    }
    get isStarted() {
        return this.node !== null;
    }
    async start() {
        if (this.node) {
            throw new Error('Node already started');
        }
        const peerDiscovery = [];
        // Add bootstrap peers if configured
        if (this.config.bootstrapPeers.length > 0) {
            peerDiscovery.push(bootstrap({
                list: this.config.bootstrapPeers
            }));
        }
        // Add mDNS for local discovery
        if (this.config.enableMdns) {
            peerDiscovery.push(mdns());
        }
        const listenAddr = multiaddr(`/ip4/0.0.0.0/tcp/${this.config.port}`);
        this.node = await createLibp2p({
            addresses: {
                listen: [listenAddr],
                announce: this.config.announceAddrs.map(a => multiaddr(a))
            },
            transports: [tcp()],
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()],
            peerDiscovery,
            services: {
                identify: identify(),
                ping: ping(),
                pubsub: gossipsub({
                    emitSelf: false,
                    allowPublishToZeroTopicPeers: true,
                    fallbackToFloodsub: false,
                    globalSignaturePolicy: 'StrictNoSign'
                })
            }
        });
        // Set up event handlers
        this.setupEventHandlers();
        // Subscribe to announcement topic
        await this.subscribeToTopics();
        // Set up protocol handlers for direct messages
        this.setupProtocolHandlers();
        // Start the node
        await this.node.start();
        console.log(`P2P node started with PeerId: ${this.peerId}`);
        console.log(`Listening on: ${this.multiaddrs.join(', ')}`);
    }
    async stop() {
        if (this.announcementInterval) {
            clearInterval(this.announcementInterval);
            this.announcementInterval = null;
        }
        if (this.node) {
            await this.node.stop();
            this.node = null;
        }
    }
    setupEventHandlers() {
        if (!this.node)
            return;
        // Peer discovery
        this.node.addEventListener('peer:discovery', (evt) => {
            const peerId = evt.detail.id.toString();
            console.log(`Discovered peer: ${peerId}`);
            this.emit('peer:discovered', { peerId, multiaddrs: [], protocols: [], lastSeen: Date.now() });
        });
        // Peer connection
        this.node.addEventListener('peer:connect', (evt) => {
            const peerId = evt.detail.toString();
            console.log(`Connected to peer: ${peerId}`);
            this.emit('peer:connected', peerId);
        });
        // Peer disconnection
        this.node.addEventListener('peer:disconnect', (evt) => {
            const peerId = evt.detail.toString();
            console.log(`Disconnected from peer: ${peerId}`);
            this.emit('peer:disconnected', peerId);
        });
    }
    async subscribeToTopics() {
        if (!this.node)
            return;
        const pubsub = this.node.services.pubsub;
        // Subscribe to announcement topic
        pubsub.subscribe(TOPICS.ANNOUNCE);
        // Handle incoming messages
        pubsub.addEventListener('message', (evt) => {
            const topic = evt.detail.topic;
            const data = evt.detail.data;
            try {
                const message = JSON.parse(new TextDecoder().decode(data));
                if (topic === TOPICS.ANNOUNCE) {
                    this.handleAnnouncement(message);
                }
            }
            catch (err) {
                console.error('Failed to parse pubsub message:', err);
            }
        });
    }
    handleAnnouncement(announcement) {
        // Don't process our own announcements
        if (announcement.peerId === this.peerId)
            return;
        // TODO: Verify signature
        // Update peer info
        const peerInfo = {
            peerId: announcement.peerId,
            multiaddrs: announcement.multiaddrs,
            protocols: [],
            bsvIdentityKey: announcement.bsvIdentityKey,
            services: announcement.services,
            lastSeen: announcement.timestamp
        };
        this.peers.set(announcement.peerId, peerInfo);
        this.emit('announcement:received', announcement);
        console.log(`Received announcement from ${announcement.peerId} with ${announcement.services.length} services`);
    }
    setupProtocolHandlers() {
        if (!this.node)
            return;
        // Handle incoming channel protocol streams
        this.node.handle(CHANNEL_PROTOCOL, async ({ stream, connection }) => {
            const peerId = connection.remotePeer.toString();
            console.log(`[Protocol] Incoming channel stream from ${peerId}`);
            try {
                // Read the incoming message
                const chunks = [];
                for await (const chunk of stream.source) {
                    chunks.push(chunk.subarray());
                }
                if (chunks.length === 0) {
                    console.log(`[Protocol] Empty stream from ${peerId}`);
                    return;
                }
                // Combine chunks and deserialize
                const data = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
                let offset = 0;
                for (const chunk of chunks) {
                    data.set(chunk, offset);
                    offset += chunk.length;
                }
                const message = deserializeMessage(data);
                console.log(`[Protocol] Received ${message.type} from ${peerId}`);
                // Emit the message for local handlers
                this.emit('channel:message', { peerId, message });
                // Wake the agent to handle the message
                await this.wakeAgentForChannelMessage(peerId, message);
            }
            catch (err) {
                console.error(`[Protocol] Error handling stream from ${peerId}:`, err);
            }
        });
        console.log(`[Protocol] Registered handler for ${CHANNEL_PROTOCOL}`);
    }
    /**
     * Wake the agent to handle an incoming channel message
     */
    async wakeAgentForChannelMessage(peerId, message) {
        if (!this.gateway.isEnabled) {
            console.log(`[Protocol] Gateway not enabled, message not forwarded to agent`);
            return;
        }
        // Format the message for the agent
        const text = this.formatChannelMessageForAgent(peerId, message);
        // For simple updates, use wake (main session system event)
        // For complex operations, could use runAgent for isolated handling
        const result = await this.gateway.wake(text, { mode: 'now' });
        if (!result.ok) {
            console.error(`[Protocol] Failed to wake agent: ${result.error}`);
        }
    }
    /**
     * Format a channel message for the agent to understand
     */
    formatChannelMessageForAgent(peerId, message) {
        const peerShort = peerId.substring(0, 16);
        switch (message.type) {
            case ChannelMessageType.OPEN_REQUEST:
                return `[P2P Channel] Peer ${peerShort}... requests to open payment channel.
Channel ID: ${message.channelId}
Proposed capacity: ${message.proposedCapacity} sats
Lock time: ${message.proposedLockTimeSeconds} seconds
Their pubkey: ${message.ourPubKey}
Their identity: ${message.identityKey}

Use bsv-p2p skill to accept or reject.`;
            case ChannelMessageType.OPEN_ACCEPT:
                return `[P2P Channel] Peer ${peerShort}... accepted channel open.
Channel ID: ${message.channelId}
Their pubkey: ${message.ourPubKey}
Lock time: ${message.agreedLockTime}

Channel setup can proceed.`;
            case ChannelMessageType.OPEN_REJECT:
                return `[P2P Channel] Peer ${peerShort}... rejected channel open.
Channel ID: ${message.channelId}
Reason: ${message.reason}`;
            case ChannelMessageType.FUNDING_CREATED:
                return `[P2P Channel] Peer ${peerShort}... created funding transaction.
Channel ID: ${message.channelId}
Funding TX: ${message.fundingTxId}

Sign the commitment to proceed.`;
            case ChannelMessageType.FUNDING_SIGNED:
                return `[P2P Channel] Peer ${peerShort}... signed the commitment.
Channel ID: ${message.channelId}

Channel is ready to activate.`;
            case ChannelMessageType.CHANNEL_READY:
                return `[P2P Channel] Channel ${message.channelId.substring(0, 16)}... is now ready.
Peer: ${peerShort}...

Payments can now be sent/received.`;
            case ChannelMessageType.UPDATE_REQUEST:
                const update = message;
                return `[P2P Payment] Peer ${peerShort}... sent payment.
Channel ID: ${message.channelId}
Amount: ${update.amount} sats
Memo: ${update.memo ?? '(none)'}
New balance: you=${update.newReceiverBalance} them=${update.newSenderBalance}

Acknowledge to accept payment.`;
            case ChannelMessageType.UPDATE_ACK:
                return `[P2P Payment] Peer ${peerShort}... acknowledged payment.
Channel ID: ${message.channelId}
Sequence: ${message.ackSequence}

Payment confirmed.`;
            case ChannelMessageType.UPDATE_REJECT:
                return `[P2P Payment] Peer ${peerShort}... rejected payment.
Channel ID: ${message.channelId}
Reason: ${message.reason}`;
            case ChannelMessageType.CLOSE_REQUEST:
                return `[P2P Channel] Peer ${peerShort}... requests channel close.
Channel ID: ${message.channelId}
Final sequence: ${message.finalSequence}

Sign settlement to close cooperatively.`;
            case ChannelMessageType.CLOSE_ACCEPT:
                return `[P2P Channel] Peer ${peerShort}... accepted close.
Channel ID: ${message.channelId}

Broadcast settlement to complete.`;
            case ChannelMessageType.CLOSE_COMPLETE:
                return `[P2P Channel] Channel closed.
Channel ID: ${message.channelId}
Settlement TX: ${message.settlementTxId}`;
            case ChannelMessageType.ERROR:
                const error = message;
                return `[P2P Error] Peer ${peerShort}... sent error.
Channel ID: ${message.channelId}
Code: ${error.errorCode}
Message: ${error.errorMessage}`;
            default:
                return `[P2P] Message from ${peerShort}...: ${message.type}
Channel ID: ${message.channelId}
Data: ${JSON.stringify(message).substring(0, 200)}`;
        }
    }
    /**
     * Send a channel message to a peer
     */
    async sendChannelMessage(peerId, message) {
        if (!this.node)
            throw new Error('Node not started');
        const connections = this.node.getConnections().filter(conn => conn.remotePeer.toString() === peerId);
        if (connections.length === 0) {
            throw new Error(`Not connected to peer ${peerId}`);
        }
        const stream = await connections[0].newStream(CHANNEL_PROTOCOL);
        try {
            const data = new TextEncoder().encode(JSON.stringify(message));
            // Write message using the sink
            await stream.sink([data]);
            console.log(`[Protocol] Sent ${message.type} to ${peerId}`);
        }
        finally {
            await stream.close();
        }
    }
    async announce() {
        if (!this.node)
            return;
        const announcement = {
            peerId: this.peerId,
            bsvIdentityKey: this.bsvIdentityKey ?? '',
            services: this.services,
            multiaddrs: this.multiaddrs,
            timestamp: Date.now(),
            signature: '' // TODO: Sign with BSV key
        };
        const data = new TextEncoder().encode(JSON.stringify(announcement));
        await this.node.services.pubsub.publish(TOPICS.ANNOUNCE, data);
        console.log('Published announcement');
    }
    startAnnouncing(intervalMs = 300000) {
        // Announce immediately
        this.announce().catch(console.error);
        // Then announce periodically
        this.announcementInterval = setInterval(() => {
            this.announce().catch(console.error);
        }, intervalMs);
    }
    setBsvIdentityKey(key) {
        this.bsvIdentityKey = key;
    }
    registerService(service) {
        // Remove existing service with same id
        this.services = this.services.filter(s => s.id !== service.id);
        this.services.push(service);
    }
    unregisterService(serviceId) {
        this.services = this.services.filter(s => s.id !== serviceId);
    }
    getServices() {
        return [...this.services];
    }
    getPeers() {
        return Array.from(this.peers.values());
    }
    getPeer(peerId) {
        return this.peers.get(peerId);
    }
    async connect(addr) {
        if (!this.node)
            throw new Error('Node not started');
        // Pass multiaddr with AbortController to work around libp2p bug
        const ma = multiaddr(addr);
        const controller = new AbortController();
        await this.node.dial(ma, { signal: controller.signal });
    }
    async disconnect(peerId) {
        if (!this.node)
            throw new Error('Node not started');
        const connections = this.node.getConnections().filter(conn => conn.remotePeer.toString() === peerId);
        for (const conn of connections) {
            await conn.close();
        }
    }
    getConnectedPeers() {
        if (!this.node)
            return [];
        return this.node.getConnections().map(conn => conn.remotePeer.toString());
    }
    async ping(peerId) {
        if (!this.node)
            throw new Error('Node not started');
        const peerIdObj = this.node.getConnections().find(conn => conn.remotePeer.toString() === peerId)?.remotePeer;
        if (!peerIdObj) {
            throw new Error(`Not connected to peer ${peerId}`);
        }
        const latency = await this.node.services.ping.ping(peerIdObj);
        return latency;
    }
    // Discovery methods
    async discoverPeers(options) {
        let peers = this.getPeers();
        if (options?.service) {
            peers = peers.filter(p => p.services?.some(s => s.id === options.service));
        }
        return peers;
    }
}
export async function createP2PNode(config) {
    const node = new P2PNode(config);
    await node.start();
    return node;
}
