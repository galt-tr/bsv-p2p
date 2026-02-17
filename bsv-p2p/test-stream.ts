import { P2PNode } from './src/daemon/node.js'
import { multiaddr } from '@multiformats/multiaddr'

const RELAY = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TARGET = '12D3KooWEaP93ASxzXWJanh11xZ4UneyooPxDmQ9k6L8Rb8s9Dg4'

async function main() {
  const node = new P2PNode({ 
    port: 4005, 
    enableMdns: false,
    bootstrapPeers: [`/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}`]
  })
  await node.start()
  
  await new Promise(r => setTimeout(r, 3000))
  
  const relayAddr = `/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}/p2p-circuit/p2p/${TARGET}`
  await node.connect(relayAddr)
  console.log('Connected!')
  
  const stream = await node['node'].dialProtocol(
    multiaddr(relayAddr),
    '/openclaw/ping/1.0.0',
    { runOnLimitedConnection: true }
  )
  
  // Check for readable/writable stream interface
  console.log('Has readable:', 'readable' in stream)
  console.log('Has writable:', 'writable' in stream)
  console.log('Has write:', typeof stream.write)
  console.log('Has read:', typeof stream.read)
  console.log('Has Symbol.asyncIterator:', Symbol.asyncIterator in stream)
  
  // Try to write
  const encoder = new TextEncoder()
  const msg = encoder.encode('{"type":"ping"}')
  console.log('Trying write...')
  stream.write(msg)
  console.log('Write succeeded!')
  
  await node.stop()
  process.exit(0)
}

main().catch(console.error)
