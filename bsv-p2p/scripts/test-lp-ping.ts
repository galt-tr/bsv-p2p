import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { multiaddr } from '@multiformats/multiaddr'
import { generateKeyPair } from '@libp2p/crypto/keys'
import * as lp from 'it-length-prefixed'
import { pipe } from 'it-pipe'
import { Uint8ArrayList } from 'uint8arraylist'

const RELAY = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TARGET_PEER = process.argv[2]

if (!TARGET_PEER) {
  console.log('Usage: npx tsx test-lp-ping.ts <peerId>')
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
    services: { identify: identify() }
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
    const conn = await node.dial(relayAddr)
    console.log('✅ Connected to peer!')
    
    // Open ping stream
    const stream = await conn.newStream('/openclaw/ping/1.0.0')
    console.log('Stream opened')
    
    const pingMsg = JSON.stringify({ type: 'ping', ts: Date.now(), from: node.peerId.toString() })
    console.log('Sending (length-prefixed):', pingMsg)
    
    // Use length-prefixed pipe for proper message framing
    const response = await pipe(
      [new TextEncoder().encode(pingMsg)],
      lp.encode,
      stream,
      lp.decode,
      async function* (source) {
        for await (const chunk of source) {
          yield chunk
        }
      },
      async (source) => {
        for await (const msg of source) {
          const data = msg instanceof Uint8Array ? msg : msg.subarray()
          return new TextDecoder().decode(data)
        }
        return null
      }
    )
    
    console.log('📥 Response:', response)
    
  } catch (err) {
    console.error('❌ Error:', err)
  }
  
  await node.stop()
}

main()
