#!/usr/bin/env npx tsx
/**
 * Initialize BSV P2P - generates keys and config
 * 
 * Usage: npx tsx scripts/init.ts [--config-dir <path>]
 * 
 * Options:
 *   --config-dir <path>  Config directory (default: ~/.bsv-p2p)
 */

import { PrivateKey } from '@bsv/sdk'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

function getConfigDir(): string {
  const args = process.argv.slice(2)
  const idx = args.indexOf('--config-dir')
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1]
  }
  return join(homedir(), '.bsv-p2p')
}

const CONFIG_DIR = getConfigDir()
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

interface Config {
  port: number
  enableMdns: boolean
  bsvPrivateKey?: string
  bsvPublicKey?: string
  autoAcceptChannelsBelowSats: number
  healthCheckIntervalMs: number
  relayReservationTimeoutMs: number
}

const DEFAULT_CONFIG: Config = {
  port: 4001,
  enableMdns: false,
  autoAcceptChannelsBelowSats: 100000, // Auto-accept up to 100k sats
  healthCheckIntervalMs: 30000,
  relayReservationTimeoutMs: 30000
}

function loadConfig(): Config {
  if (existsSync(CONFIG_FILE)) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) }
    } catch {
      return DEFAULT_CONFIG
    }
  }
  return DEFAULT_CONFIG
}

function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║           BSV P2P Payment Channels - Init                ║
╚══════════════════════════════════════════════════════════╝
`)

  // Check if already initialized
  const existingConfig = loadConfig()
  if (existingConfig.bsvPrivateKey) {
    console.log('⚠️  Already initialized!')
    console.log(`   Private Key: ${existingConfig.bsvPrivateKey.substring(0, 16)}...`)
    console.log(`   Public Key:  ${existingConfig.bsvPublicKey?.substring(0, 16)}...`)
    console.log('')
    console.log('To reinitialize, delete ~/.bsv-p2p/config.json first.')
    console.log('')
    process.exit(0)
  }

  // Generate new BSV keypair
  console.log('🔑 Generating BSV keypair...')
  const privateKey = PrivateKey.fromRandom()
  const publicKey = privateKey.toPublicKey()
  
  const privKeyHex = privateKey.toString()
  const pubKeyHex = publicKey.toString()
  const address = publicKey.toAddress()

  console.log('')
  console.log('✅ Keys generated!')
  console.log('')
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  ⚠️  SAVE YOUR PRIVATE KEY - IT CANNOT BE RECOVERED!    ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`Private Key (hex): ${privKeyHex}`)
  console.log(`Public Key (hex):  ${pubKeyHex}`)
  console.log(`Address:           ${address}`)
  console.log('')

  // Save to config (merge with existing)
  const config: Config = {
    ...existingConfig,
    bsvPrivateKey: privKeyHex,
    bsvPublicKey: pubKeyHex
  }
  
  saveConfig(config)
  console.log(`✅ Config saved to: ${CONFIG_FILE}`)
  console.log('')

  // Show next steps
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║                      Next Steps                          ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('1. Start the daemon:')
  console.log('   npx tsx src/daemon/index.ts')
  console.log('')
  console.log('2. Note your PeerId from the logs')
  console.log('')
  console.log('3. Test connection to another peer:')
  console.log('   npx tsx scripts/test-connection.ts <their-peer-id>')
  console.log('')
  console.log('4. Send a message:')
  console.log('   npx tsx send-message.ts <their-peer-id> "Hello!"')
  console.log('')

  // Show config summary
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║                    Configuration                         ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`Port:                    ${config.port}`)
  console.log(`Auto-accept channels:    up to ${config.autoAcceptChannelsBelowSats} sats`)
  console.log(`Health check interval:   ${config.healthCheckIntervalMs}ms`)
  console.log('')
  console.log('Edit ~/.bsv-p2p/config.json to customize.')
  console.log('')
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
