import { P2PNode } from './src/daemon/node.js'

async function main() {
  const n = new P2PNode({ 
    port: 4010, 
    enableMdns: false, 
    bootstrapPeers: ['/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'] 
  })
  await n.start()
  console.log('PeerId:', n.peerId)
  await new Promise(r => setTimeout(r, 6000))
  const addrs = n.multiaddrs
  const relayAddrs = addrs.filter(a => a.includes('circuit'))
  console.log(`\n✅ Relay addresses: ${relayAddrs.length}`)
  relayAddrs.forEach(a => console.log(' ', a))
  await n.stop()
  process.exit(0)
}
main()
