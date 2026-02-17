/**
 * Test pubsub v2 - peers connect to each other via relay circuit first
 */

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { multiaddr } from '@multiformats/multiaddr'

const RELAY = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TOPIC = '/openclaw/messages/v1'

async function createNode(name: string) {
  const privateKey = await generateKeyPair('Ed25519')
  
  const node = await createLibp2p({
    privateKey,
    addresses: { 
      listen: ['/ip4/0.0.0.0/tcp/0', '/p2p-circuit'] 
    },
    transports: [
      tcp(),
      circuitRelayTransport({ discoverRelays: 1 })
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [bootstrap({ list: [RELAY] })],
    services: { 
      identify: identify(),
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true,
        runOnLimitedConnection: true  // Important! Allow gossip over relay
      })
    }
  })

  await node.start()
  console.log(`[${name}] Started: ${node.peerId.toString()}`)
  
  // Wait for relay connection
  await new Promise<void>(resolve => {
    node.addEventListener('peer:connect', (e) => {
      if (e.detail.toString().includes('NhNQ9AhQ')) {
        console.log(`[${name}] Connected to relay`)
        resolve()
      }
    })
  })
  
  // Wait for relay reservation
  await new Promise(r => setTimeout(r, 3000))
  const addrs = node.getMultiaddrs().map(m => m.toString())
  const relayAddrs = addrs.filter(a => a.includes('p2p-circuit'))
  console.log(`[${name}] Relay addrs: ${relayAddrs.length > 0 ? 'YES' : 'NO'}`)
  
  return node
}

async function main() {
  console.log('=== Testing Pubsub via Relay (v2 - with peer connection) ===\n')
  
  // Create two peers
  const alice = await createNode('Alice')
  const bob = await createNode('Bob')
  
  // Alice connects to Bob via relay circuit
  const bobPeerId = bob.peerId.toString()
  const relayCircuitAddr = multiaddr(`${RELAY}/p2p-circuit/p2p/${bobPeerId}`)
  
  console.log(`\n[Alice] Connecting to Bob via relay...`)
  try {
    await alice.dial(relayCircuitAddr)
    console.log(`[Alice] ✅ Connected to Bob!`)
  } catch (err: any) {
    console.log(`[Alice] ❌ Failed to connect: ${err.message}`)
    // Continue anyway - maybe gossip will work
  }
  
  await new Promise(r => setTimeout(r, 2000))
  
  // Check connections
  const aliceConns = alice.getConnections().map(c => c.remotePeer.toString().substring(0, 16))
  const bobConns = bob.getConnections().map(c => c.remotePeer.toString().substring(0, 16))
  console.log(`[Alice] Connections: ${aliceConns.join(', ')}`)
  console.log(`[Bob] Connections: ${bobConns.join(', ')}`)
  
  // Subscribe to topic
  const alicePubsub = alice.services.pubsub as any
  const bobPubsub = bob.services.pubsub as any
  
  // Bob subscribes and listens
  bobPubsub.subscribe(TOPIC)
  bobPubsub.addEventListener('message', (evt: any) => {
    if (evt.detail.topic === TOPIC) {
      const msg = JSON.parse(new TextDecoder().decode(evt.detail.data))
      console.log(`\n[Bob] 📥 RECEIVED:`, msg.content)
      
      if (msg.to === bob.peerId.toString()) {
        console.log(`[Bob] ✅ Message is for me!`)
      }
    }
  })
  
  // Alice subscribes
  alicePubsub.subscribe(TOPIC)
  alicePubsub.addEventListener('message', (evt: any) => {
    if (evt.detail.topic === TOPIC) {
      const msg = JSON.parse(new TextDecoder().decode(evt.detail.data))
      if (msg.to === alice.peerId.toString()) {
        console.log(`\n[Alice] 📥 RECEIVED reply:`, msg.content)
      }
    }
  })
  
  console.log(`\n[Both] Subscribed to ${TOPIC}`)
  
  // Check gossipsub peers
  await new Promise(r => setTimeout(r, 2000))
  const aliceGossipPeers = alicePubsub.getPeers()
  const bobGossipPeers = bobPubsub.getPeers()
  console.log(`[Alice] Gossip peers: ${aliceGossipPeers.length}`)
  console.log(`[Bob] Gossip peers: ${bobGossipPeers.length}`)
  
  // Alice sends message to Bob
  const message = {
    type: 'text',
    id: `${Date.now()}`,
    from: alice.peerId.toString(),
    to: bob.peerId.toString(),
    content: 'Hello Bob! This is Alice via pubsub!',
    timestamp: Date.now()
  }
  
  console.log(`\n[Alice] 📤 Publishing message...`)
  const result = await alicePubsub.publish(TOPIC, new TextEncoder().encode(JSON.stringify(message)))
  console.log(`[Alice] Publish result - recipients: ${result.recipients.length}`)
  
  // Wait for message
  await new Promise(r => setTimeout(r, 3000))
  
  console.log('\n=== Test Complete ===')
  
  await alice.stop()
  await bob.stop()
}

main().catch(console.error)
