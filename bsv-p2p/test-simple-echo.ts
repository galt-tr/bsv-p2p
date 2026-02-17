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

const RELAY = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TARGET_PEER = process.argv[2]

if (!TARGET_PEER) {
  console.log('Usage: npx tsx test-simple-echo.ts <peerId>')
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

  const relayAddr = multiaddr(`${RELAY}/p2p-circuit/p2p/${TARGET_PEER}`)
  console.log('Dialing:', relayAddr.toString())
  
  try {
    const conn = await node.dial(relayAddr)
    console.log('✅ Connected!')
    
    const stream = await conn.newStream('/openclaw/ping/1.0.0', {
      runOnLimitedConnection: true
    })
    console.log('Stream opened, status:', stream.status)
    
    const pingMsg = JSON.stringify({ type: 'ping', ts: Date.now(), from: node.peerId.toString() })
    const encoded = new TextEncoder().encode(pingMsg)
    console.log('Sending:', pingMsg)
    
    // Simple approach: encode, send, then read response
    // Encode with length prefix
    const lpEncoded: Uint8Array[] = []
    for await (const chunk of lp.encode([encoded])) {
      lpEncoded.push(chunk)
    }
    
    // Send all chunks
    for (const chunk of lpEncoded) {
      stream.send(chunk)
    }
    console.log('📤 Sent message')
    
    // Signal we're done writing
    await stream.sendCloseWrite?.()
    console.log('Closed write side')
    
    // Read response with timeout
    console.log('Waiting for response...')
    const timeout = setTimeout(() => {
      console.log('⏰ Timeout')
      stream.abort?.(new Error('Timeout'))
    }, 10000)
    
    try {
      let response = ''
      for await (const chunk of lp.decode(stream)) {
        const data = chunk instanceof Uint8Array ? chunk : chunk.subarray()
        response = new TextDecoder().decode(data)
        console.log('📥 Response:', response)
        break
      }
      clearTimeout(timeout)
      
      if (!response) {
        console.log('❌ No response')
      }
    } catch (readErr: any) {
      clearTimeout(timeout)
      console.log('❌ Read error:', readErr.message)
    }
    
  } catch (err: any) {
    console.error('❌ Error:', err.message)
  }
  
  await node.stop()
}

main()
