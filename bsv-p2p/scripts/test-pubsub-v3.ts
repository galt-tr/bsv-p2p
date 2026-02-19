/**
 * Test pubsub v3 - wait for topic subscription propagation
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
    addresses: { listen: ['/ip4/0.0.0.0/tcp/0', '/p2p-circuit'] },
    transports: [tcp(), circuitRelayTransport({ discoverRelays: 1 })],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [bootstrap({ list: [RELAY] })],
    services: { 
      identify: identify(),
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true,
        runOnLimitedConnection: true,
        scoreParams: { IPColocationFactorWeight: 0 },  // Disable IP scoring
        directPeers: []  // No direct peers
      })
    }
  })

  await node.start()
  console.log(`[${name}] PeerId: ${node.peerId.toString()}`)
  
  await new Promise<void>(resolve => {
    node.addEventListener('peer:connect', (e) => {
      if (e.detail.toString().includes('NhNQ9AhQ')) {
        console.log(`[${name}] Connected to relay`)
        resolve()
      }
    })
  })
  
  await new Promise(r => setTimeout(r, 3000))
  return node
}

async function main() {
  console.log('=== Testing Pubsub v3 ===\n')
  
  const alice = await createNode('Alice')
  const bob = await createNode('Bob')
  
  // Connect Alice to Bob via relay
  const bobPeerId = bob.peerId.toString()
  try {
    await alice.dial(multiaddr(`${RELAY}/p2p-circuit/p2p/${bobPeerId}`))
    console.log(`[Alice] Connected to Bob via relay ✅`)
  } catch (err: any) {
    console.log(`[Alice] Failed: ${err.message}`)
  }
  
  const alicePubsub = alice.services.pubsub as any
  const bobPubsub = bob.services.pubsub as any
  
  // Subscribe both
  alicePubsub.subscribe(TOPIC)
  bobPubsub.subscribe(TOPIC)
  console.log(`\nBoth subscribed to ${TOPIC}`)
  
  // Set up listener on Bob BEFORE any messages
  let received = false
  bobPubsub.addEventListener('message', (evt: any) => {
    const msg = JSON.parse(new TextDecoder().decode(evt.detail.data))
    console.log(`\n[Bob] 📥 GOT MESSAGE: "${msg.content}"`)
    received = true
  })
  
  // Wait for subscription propagation
  console.log('Waiting for gossip mesh to form...')
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000))
    
    const aliceTopicPeers = alicePubsub.getSubscribers(TOPIC)
    const bobTopicPeers = bobPubsub.getSubscribers(TOPIC)
    
    console.log(`[${i+1}s] Alice sees ${aliceTopicPeers.length} peer(s) on topic, Bob sees ${bobTopicPeers.length}`)
    
    if (aliceTopicPeers.length > 0 && bobTopicPeers.length > 0) {
      console.log('✅ Mesh formed!')
      break
    }
  }
  
  // Send message
  const message = {
    from: alice.peerId.toString(),
    to: bob.peerId.toString(),
    content: 'Hello Bob via GossipSub!',
    ts: Date.now()
  }
  
  console.log(`\n[Alice] 📤 Publishing...`)
  const result = await alicePubsub.publish(TOPIC, new TextEncoder().encode(JSON.stringify(message)))
  console.log(`[Alice] Recipients: ${result.recipients.length}`)
  
  // Wait for delivery
  await new Promise(r => setTimeout(r, 3000))
  
  console.log(`\nMessage received: ${received ? '✅ YES' : '❌ NO'}`)
  
  await alice.stop()
  await bob.stop()
}

main().catch(console.error)
