import { P2PNode } from './src/daemon/node.js'

async function tryConnect() {
  const node = new P2PNode({ port: 4002, enableMdns: false })
  await node.start()
  console.log('My PeerId:', node.peerId)
  console.log('My addrs:', node.multiaddrs)
  
  // Wait for bootstrap connections
  console.log('Waiting for bootstrap peers...')
  await new Promise(r => setTimeout(r, 5000))
  
  const targetPeerId = '12D3KooWHSFYZedZip1t3B4GiyEHf8z7uJizGiTH7Aj9qVhrW376'
  
  // Try direct first
  console.log('Trying direct connection...')
  try {
    await node.connect(`/ip4/192.168.1.166/tcp/4001/p2p/${targetPeerId}`)
    console.log('✅ Direct connection succeeded!')
  } catch (err: any) {
    console.log('Direct failed:', err.message)
    
    // Try via relay
    console.log('Trying via relay...')
    const relays = ['QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN', 'QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa']
    for (const relay of relays) {
      try {
        const relayAddr = `/p2p/${relay}/p2p-circuit/p2p/${targetPeerId}`
        console.log(`Trying relay: ${relayAddr}`)
        await node.connect(relayAddr)
        console.log('✅ Relay connection succeeded!')
        break
      } catch (e: any) {
        console.log(`Relay ${relay} failed:`, e.message)
      }
    }
  }
  
  console.log('Connected peers:', node.getConnectedPeers())
  await node.stop()
  process.exit(0)
}

tryConnect().catch(console.error)
