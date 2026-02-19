import { P2PNode } from './src/daemon/node.js'

const TARGET = '12D3KooWDG6xCHg7ocsP7genHLwaR7TJdQDDkjek63cx4YME54AV'

async function tryConnect() {
  const node = new P2PNode({ port: 4003, enableMdns: false })
  await node.start()
  console.log('My PeerId:', node.peerId)
  
  // Wait for bootstrap connections
  console.log('Waiting for bootstrap peers...')
  await new Promise(r => setTimeout(r, 8000))
  console.log('Connected to:', node.getConnectedPeers().length, 'peers')
  
  // Try relay addresses through each bootstrap peer
  const relays = [
    'QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    'QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa', 
    'QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
    'QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt'
  ]
  
  for (const relay of relays) {
    const relayAddr = `/p2p/${relay}/p2p-circuit/p2p/${TARGET}`
    console.log(`\nTrying relay: ${relay.slice(0,12)}...`)
    try {
      await Promise.race([
        node.connect(relayAddr),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ])
      console.log('✅ Connected via relay!')
      console.log('Connected peers:', node.getConnectedPeers())
      break
    } catch (e: any) {
      console.log('❌ Failed:', e.message?.slice(0, 60))
    }
  }
  
  await node.stop()
  process.exit(0)
}

tryConnect().catch(console.error)
