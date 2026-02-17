// test-relay.ts - run with: npx tsx test-relay.ts
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { bootstrap } from '@libp2p/bootstrap'

const RELAY = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'

async function main() {
  const node = await createLibp2p({
    addresses: { listen: ['/ip4/0.0.0.0/tcp/4001', '/p2p-circuit'] },
    transports: [tcp(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [bootstrap({ list: [RELAY] })],
    services: { identify: identify() }
  })

  await node.start()
  console.log('PeerId:', node.peerId.toString())

  // Wait for relay addresses
  await new Promise(r => setTimeout(r, 5000))

  const addrs = node.getMultiaddrs().map(m => m.toString())
  console.log('\nAll addresses:')
  addrs.forEach(a => console.log('  ', a))

  const relayAddrs = addrs.filter(a => a.includes('p2p-circuit'))
  console.log(`\n✅ Relay addresses: ${relayAddrs.length}`)

  // Keep running
  console.log('\nDaemon running... Ctrl+C to stop')
  await new Promise(() => {})
}

main()
