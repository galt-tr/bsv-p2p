#!/usr/bin/env node

/**
 * CLI tool for managing P2P service discovery
 * 
 * Usage:
 *   service-manager register --id=<id> --name=<name> --price=<sats> [--description=<desc>]
 *   service-manager unregister <serviceId>
 *   service-manager list
 *   service-manager discover [--service=<serviceId>]
 *   service-manager stats
 */

import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const API_BASE = 'http://localhost:4002'

interface ServiceInfo {
  id: string
  name: string
  description?: string
  price: number
  currency: 'bsv' | 'mnee'
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  })
  
  const data = await response.json()
  
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`)
  }
  
  return data
}

async function registerService(args: Record<string, string>): Promise<void> {
  if (!args.id || !args.name || !args.price) {
    console.error('Usage: service-manager register --id=<id> --name=<name> --price=<sats> [--description=<desc>]')
    process.exit(1)
  }
  
  const service: ServiceInfo = {
    id: args.id,
    name: args.name,
    description: args.description,
    price: parseInt(args.price, 10),
    currency: (args.currency as 'bsv' | 'mnee') ?? 'bsv'
  }
  
  if (isNaN(service.price)) {
    console.error('Error: price must be a number')
    process.exit(1)
  }
  
  console.log('Registering service...')
  const result = await request('/services', {
    method: 'POST',
    body: JSON.stringify(service)
  })
  
  console.log('✅ Service registered!')
  console.log(JSON.stringify(result.service, null, 2))
  console.log('\nService will be announced via GossipSub every 5 minutes')
}

async function unregisterService(serviceId: string): Promise<void> {
  if (!serviceId) {
    console.error('Usage: service-manager unregister <serviceId>')
    process.exit(1)
  }
  
  console.log(`Unregistering service: ${serviceId}...`)
  const result = await request(`/services/${serviceId}`, {
    method: 'DELETE'
  })
  
  console.log('✅ Service unregistered!')
  console.log(result.message)
}

async function listServices(): Promise<void> {
  const result = await request('/services')
  
  if (result.services.length === 0) {
    console.log('No services registered')
    return
  }
  
  console.log(`\n📋 Registered Services (${result.count}):\n`)
  
  for (const service of result.services) {
    console.log(`ID:          ${service.id}`)
    console.log(`Name:        ${service.name}`)
    if (service.description) {
      console.log(`Description: ${service.description}`)
    }
    console.log(`Price:       ${service.price} ${service.currency.toUpperCase()}`)
    console.log('')
  }
}

async function discoverPeers(serviceFilter?: string): Promise<void> {
  const path = serviceFilter ? `/discover?service=${serviceFilter}` : '/discover'
  const result = await request(path)
  
  if (result.peers.length === 0) {
    console.log(serviceFilter 
      ? `No peers found offering service: ${serviceFilter}`
      : 'No peers discovered yet'
    )
    return
  }
  
  console.log(`\n🔍 Discovered Peers (${result.peers.length}):\n`)
  
  for (const peer of result.peers) {
    console.log(`Peer ID: ${peer.peerId}`)
    console.log(`Multiaddrs:`)
    for (const addr of peer.multiaddrs) {
      console.log(`  - ${addr}`)
    }
    
    if (peer.bsvIdentityKey) {
      console.log(`BSV Key: ${peer.bsvIdentityKey.substring(0, 20)}...`)
    }
    
    if (peer.services && peer.services.length > 0) {
      console.log(`Services:`)
      for (const service of peer.services) {
        console.log(`  - ${service.name} (${service.id})`)
        console.log(`    Price: ${service.price} ${service.currency.toUpperCase()}`)
        if (service.description) {
          console.log(`    ${service.description}`)
        }
      }
    }
    
    const lastSeenDate = new Date(peer.lastSeen)
    const minutesAgo = Math.floor((Date.now() - peer.lastSeen) / 60000)
    console.log(`Last seen: ${lastSeenDate.toISOString()} (${minutesAgo} minutes ago)`)
    console.log('')
  }
}

async function showStats(): Promise<void> {
  const result = await request('/discovery/stats')
  
  console.log('\n📊 Discovery Service Stats:\n')
  console.log(`Known Peers:        ${result.knownPeers}`)
  console.log(`Registered Services: ${result.registeredServices}`)
  console.log(`Status:             ${result.isRunning ? '✅ Running' : '❌ Stopped'}`)
  console.log('')
}

function parseArgs(args: string[]): { command: string; params: Record<string, string>; positional: string[] } {
  const command = args[0]
  const params: Record<string, string> = {}
  const positional: string[] = []
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=')
      params[key] = value ?? 'true'
    } else {
      positional.push(arg)
    }
  }
  
  return { command, params, positional }
}

async function main() {
  const args = process.argv.slice(2)
  
  if (args.length === 0) {
    console.log(`
BSV P2P Service Manager

Usage:
  service-manager register --id=<id> --name=<name> --price=<sats> [--description=<desc>]
  service-manager unregister <serviceId>
  service-manager list
  service-manager discover [--service=<serviceId>]
  service-manager stats

Examples:
  # Register a service
  service-manager register --id=code-review --name="Code Review" --price=1000 --description="AI code review"
  
  # List your services
  service-manager list
  
  # Find peers offering code review
  service-manager discover --service=code-review
  
  # Find all peers
  service-manager discover
  
  # Unregister a service
  service-manager unregister code-review
  
  # Show discovery stats
  service-manager stats
`)
    process.exit(0)
  }
  
  const { command, params, positional } = parseArgs(args)
  
  try {
    switch (command) {
      case 'register':
        await registerService(params)
        break
      
      case 'unregister':
        await unregisterService(positional[0])
        break
      
      case 'list':
        await listServices()
        break
      
      case 'discover':
        await discoverPeers(params.service)
        break
      
      case 'stats':
        await showStats()
        break
      
      default:
        console.error(`Unknown command: ${command}`)
        console.error('Run without arguments for usage help')
        process.exit(1)
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  }
}

main()
