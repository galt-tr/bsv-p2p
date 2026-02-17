import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'

const PORT = process.env.PORT || 4001

async function main() {
  const node = await createLibp2p({
    addresses: {
      listen: [`/ip4/0.0.0.0/tcp/${PORT}`]
    },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      ping: ping(),
      relay: circuitRelayServer({
        reservations: {
          maxReservations: 1024,
          reservationTtl: 1800000,  // 30 minutes
          defaultDurationLimit: 600000,  // 10 min per connection
          defaultDataLimit: BigInt(1 << 27)  // 128 MB
        }
      })
    }
  })

  await node.start()

  console.log('🔌 BSV P2P Relay Server Started')
  console.log(`PeerId: ${node.peerId.toString()}`)
  console.log('Listening on:')
  node.getMultiaddrs().forEach(ma => {
    console.log(`  ${ma.toString()}`)
  })
  console.log('')
  console.log('Relay is ready to accept reservations!')

  // Log connections
  node.addEventListener('peer:connect', (evt) => {
    console.log(`[+] Peer connected: ${evt.detail.toString()}`)
  })

  node.addEventListener('peer:disconnect', (evt) => {
    console.log(`[-] Peer disconnected: ${evt.detail.toString()}`)
  })

  // Keep alive
  process.on('SIGINT', async () => {
    console.log('\\nShutting down...')
    await node.stop()
    process.exit(0)
  })
}

main().catch(console.error)
