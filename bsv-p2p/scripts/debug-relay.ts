import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const RELAY = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const KEY_FILE = join(homedir(), '.bsv-p2p', 'peer-key.json')

async function main() {
  // Load our persistent key
  const keyData = JSON.parse(readFileSync(KEY_FILE, 'utf-8'))
  const keyBytes = Uint8Array.from(keyData.privateKey)
  const privateKey = privateKeyFromProtobuf(keyBytes)
  
  console.log('Creating node with persistent key...')
  
  const node = await createLibp2p({
    privateKey,
    addresses: { 
      listen: [
        '/ip4/0.0.0.0/tcp/0',
        '/p2p-circuit'
      ]
    },
    transports: [
      tcp(),
      circuitRelayTransport({ discoverRelays: 1 })
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [bootstrap({ list: [RELAY] })],
    services: { identify: identify() }
  })

  // Log all events
  node.addEventListener('self:peer:update', (e) => {
    console.log('[self:peer:update] Multiaddrs:', node.getMultiaddrs().map(m => m.toString()))
  })

  await node.start()
  console.log('PeerId:', node.peerId.toString())
  console.log('Initial multiaddrs:', node.getMultiaddrs().map(m => m.toString()))

  // Wait and check
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const addrs = node.getMultiaddrs().map(m => m.toString())
    const relayAddrs = addrs.filter(a => a.includes('p2p-circuit'))
    console.log(`[${(i+1)*2}s] Relay addrs: ${relayAddrs.length > 0 ? relayAddrs.join(', ') : 'NONE'}`)
    
    if (relayAddrs.length > 0) {
      console.log('\n✅ Got relay reservation!')
      break
    }
  }
  
  const connections = node.getConnections()
  console.log('\nConnections:', connections.map(c => c.remotePeer.toString()))
  
  await node.stop()
}

main().catch(console.error)
