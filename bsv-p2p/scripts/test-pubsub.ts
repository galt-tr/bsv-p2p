/**
 * Test pubsub messaging between two peers via relay
 * No direct dial needed - just subscribe to same topic
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

const RELAY = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TOPIC = '/openclaw/messages/v1'

async function createNode(name: string) {
  const privateKey = await generateKeyPair('Ed25519')
  
  const node = await createLibp2p({
    privateKey,
    addresses: { listen: ['/ip4/0.0.0.0/tcp/0'] },
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
        emitSelf: false,  // Don't receive own messages
        allowPublishToZeroTopicPeers: true  // Allow publishing even if no peers yet
      })
    }
  })

  await node.start()
  console.log(`[${name}] Started: ${node.peerId.toString().substring(0, 16)}...`)
  
  // Wait for relay connection
  await new Promise<void>(resolve => {
    node.addEventListener('peer:connect', (e) => {
      if (e.detail.toString().includes('NhNQ9AhQ')) {
        console.log(`[${name}] Connected to relay`)
        resolve()
      }
    })
  })
  
  return node
}

async function main() {
  console.log('=== Testing Pubsub Messaging via Relay ===\n')
  
  // Create two peers
  const alice = await createNode('Alice')
  const bob = await createNode('Bob')
  
  await new Promise(r => setTimeout(r, 2000))
  
  // Subscribe to topic
  const alicePubsub = alice.services.pubsub as any
  const bobPubsub = bob.services.pubsub as any
  
  // Bob subscribes and listens
  bobPubsub.subscribe(TOPIC)
  bobPubsub.addEventListener('message', (evt: any) => {
    if (evt.detail.topic === TOPIC) {
      const msg = JSON.parse(new TextDecoder().decode(evt.detail.data))
      console.log(`[Bob] 📥 Received:`, msg)
      
      // Check if message is for us
      if (msg.to === bob.peerId.toString()) {
        console.log(`[Bob] ✅ Message is for me!`)
        
        // Send reply
        const reply = {
          type: 'reply',
          from: bob.peerId.toString(),
          to: msg.from,
          content: `Hello ${msg.from.substring(0, 8)}! Got your message.`,
          replyTo: msg.id
        }
        bobPubsub.publish(TOPIC, new TextEncoder().encode(JSON.stringify(reply)))
        console.log(`[Bob] 📤 Sent reply`)
      }
    }
  })
  console.log('[Bob] Subscribed to topic')
  
  // Alice subscribes and listens for replies
  alicePubsub.subscribe(TOPIC)
  alicePubsub.addEventListener('message', (evt: any) => {
    if (evt.detail.topic === TOPIC) {
      const msg = JSON.parse(new TextDecoder().decode(evt.detail.data))
      if (msg.to === alice.peerId.toString()) {
        console.log(`[Alice] 📥 Received reply:`, msg.content)
      }
    }
  })
  console.log('[Alice] Subscribed to topic')
  
  // Wait for subscriptions to propagate
  await new Promise(r => setTimeout(r, 3000))
  
  // Alice sends message to Bob
  const message = {
    type: 'text',
    id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
    from: alice.peerId.toString(),
    to: bob.peerId.toString(),
    content: 'Hello Bob! This is Alice via pubsub!',
    timestamp: Date.now()
  }
  
  console.log(`\n[Alice] 📤 Sending to Bob via pubsub...`)
  await alicePubsub.publish(TOPIC, new TextEncoder().encode(JSON.stringify(message)))
  
  // Wait for message exchange
  await new Promise(r => setTimeout(r, 5000))
  
  console.log('\n=== Test Complete ===')
  
  await alice.stop()
  await bob.stop()
}

main().catch(console.error)
