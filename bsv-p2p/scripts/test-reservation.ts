import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { bootstrap } from '@libp2p/bootstrap'

const RELAY = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'

async function main() {
  console.log('Creating minimal node with circuit relay...')
  
  const node = await createLibp2p({
    addresses: {
      listen: [
        '/ip4/0.0.0.0/tcp/4009',
        '/p2p-circuit'  // This should request relay reservations
      ]
    },
    transports: [
      tcp(),
      circuitRelayTransport({
        reservationCompletionTimeout: 10000
      })
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      bootstrap({ list: [RELAY] })
    ],
    services: {
      identify: identify()
    }
  })

  await node.start()
  console.log('PeerId:', node.peerId.toString())
  
  // Wait and check addresses periodically
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const addrs = node.getMultiaddrs().map(m => m.toString())
    const relayAddrs = addrs.filter(a => a.includes('p2p-circuit'))
    console.log(`\n[${(i+1)*3}s] Relay addresses: ${relayAddrs.length}`)
    if (relayAddrs.length > 0) {
      relayAddrs.forEach(a => console.log('  ', a))
      break
    }
    console.log('  (waiting...)')
  }
  
  await node.stop()
}

main().catch(console.error)
