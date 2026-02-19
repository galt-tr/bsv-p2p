import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { multiaddr } from '@multiformats/multiaddr'
import { generateKeyPair } from '@libp2p/crypto/keys'

const RELAY = '/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const DAEMON_PEER = '12D3KooWFmVoRboRt7QikBw749CyEwHgpEsnxJRfMWoqoTr8Gr4P'

async function main() {
  const privateKey = await generateKeyPair('Ed25519')
  
  const node = await createLibp2p({
    privateKey,
    addresses: { listen: ['/ip4/0.0.0.0/tcp/0'] },
    transports: [tcp(), circuitRelayTransport({ discoverRelays: 1 })],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [bootstrap({ list: [RELAY] })],
    services: { identify: identify() }
  })

  await node.start()
  console.log('Test node started:', node.peerId.toString())
  
  await new Promise<void>(resolve => {
    node.addEventListener('peer:connect', (e) => {
      if (e.detail.toString().includes('NhNQ9AhQ')) {
        console.log('Connected to relay')
        resolve()
      }
    })
  })
  
  await new Promise(r => setTimeout(r, 2000))
  
  console.log('\nTrying to dial DAEMON via relay...')
  const relayAddr = multiaddr(`${RELAY}/p2p-circuit/p2p/${DAEMON_PEER}`)
  console.log('Address:', relayAddr.toString())
  
  try {
    const conn = await node.dial(relayAddr)
    console.log('✅ SUCCESS! Connected to daemon!')
    console.log('Remote peer:', conn.remotePeer.toString())
  } catch (err: any) {
    console.log('❌ FAILED:', err.message)
  }
  
  await node.stop()
}

main()
