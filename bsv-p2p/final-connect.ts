import { P2PNode } from './src/daemon/node.js'

const RELAY = '12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk'
const TARGET = '12D3KooWDG6xCHg7ocsP7genHLwaR7TJdQDDkjek63cx4YME54AV'

async function main() {
  const node = new P2PNode({ 
    port: 4007, 
    enableMdns: false,
    bootstrapPeers: [`/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}`]
  })
  await node.start()
  console.log('PeerId:', node.peerId)
  
  // Wait for relay connection + reservation
  console.log('Waiting for relay reservation...')
  await new Promise(r => setTimeout(r, 10000))
  
  console.log('My relay addresses:')
  node.multiaddrs.filter(a => a.includes('p2p-circuit')).forEach(a => console.log(' ', a))
  
  // Try relay connection
  const relayAddr = `/ip4/167.172.134.84/tcp/4001/p2p/${RELAY}/p2p-circuit/p2p/${TARGET}`
  console.log(`\nConnecting to ${TARGET.slice(0,16)}... via relay`)
  
  try {
    await Promise.race([
      node.connect(relayAddr),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 20s')), 20000))
    ])
    console.log('\n🎉 CONNECTED VIA RELAY!')
    console.log('All peers:', node.getConnectedPeers())
  } catch (e: any) {
    console.log('❌', e.message)
  }
  
  await node.stop()
  process.exit(0)
}
main()
