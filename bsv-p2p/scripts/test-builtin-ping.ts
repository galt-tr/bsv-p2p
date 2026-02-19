import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { multiaddr } from '@multiformats/multiaddr'
import { generateKeyPair } from '@libp2p/crypto/keys'

const RELAY = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TARGET_PEER = process.argv[2]

if (!TARGET_PEER) {
  console.log('Usage: npx tsx test-builtin-ping.ts <peerId>')
  process.exit(1)
}

async function main() {
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
      ping: ping()
    }
  })

  await node.start()
  console.log('Started:', node.peerId.toString())

  // Wait for relay connection
  await new Promise<void>(resolve => {
    node.addEventListener('peer:connect', (e) => {
      if (e.detail.toString().includes('NhNQ9AhQ')) {
        console.log('Connected to relay')
        resolve()
      }
    })
  })
  
  await new Promise(r => setTimeout(r, 2000))

  // Dial target via relay
  const relayAddr = multiaddr(`${RELAY}/p2p-circuit/p2p/${TARGET_PEER}`)
  console.log('Dialing:', relayAddr.toString())
  
  try {
    const latency = await node.services.ping.ping(multiaddr(`/p2p/${TARGET_PEER}`))
    console.log('✅ Ping successful! Latency:', latency, 'ms')
  } catch (err: any) {
    console.error('❌ Ping failed:', err.message)
    
    // Try dialing first, then ping
    console.log('\nTrying dial then ping...')
    try {
      await node.dial(relayAddr)
      console.log('Dial succeeded')
      const latency = await node.services.ping.ping(multiaddr(`/p2p/${TARGET_PEER}`))
      console.log('✅ Ping successful! Latency:', latency, 'ms')
    } catch (err2: any) {
      console.error('❌ Also failed:', err2.message)
    }
  }
  
  await node.stop()
}

main()
