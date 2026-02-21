#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import { spawn, execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const program = new Command()

const API_PORT = 4003 // Daemon API port

function getDataDir(): string {
  const dir = join(homedir(), '.bsv-p2p')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getPidFile(): string {
  return join(getDataDir(), 'daemon.pid')
}

function getLogFile(): string {
  return join(getDataDir(), 'daemon.log')
}

function getConfigFile(): string {
  return join(getDataDir(), 'config.json')
}

function isDaemonRunning(): { running: boolean; pid?: number } {
  const pidFile = getPidFile()
  
  if (!existsSync(pidFile)) {
    return { running: false }
  }
  
  const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10)
  
  try {
    // Check if process is running
    process.kill(pid, 0)
    return { running: true, pid }
  } catch {
    // Process not running, clean up stale pid file
    unlinkSync(pidFile)
    return { running: false }
  }
}

async function apiCall(method: string, path: string, body?: any): Promise<any> {
  const url = `http://127.0.0.1:${API_PORT}${path}`
  
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    
    return await response.json()
  } catch (err: any) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error('Daemon not running. Start with: bsv-p2p daemon start')
    }
    throw err
  }
}

program
  .name('bsv-p2p')
  .description('BSV P2P daemon with payment channels for OpenClaw bots')
  .version('0.1.0')

// ============ DAEMON COMMANDS ============
const daemonCmd = program.command('daemon')
  .description('Manage the P2P daemon')

daemonCmd
  .command('start')
  .description('Start the P2P daemon')
  .option('-f, --foreground', 'Run in foreground (don\'t daemonize)')
  .option('-p, --port <port>', 'Port to listen on', '4001')
  .option('--skip-setup', 'Skip first-run setup wizard')
  .action(async (options) => {
    const status = isDaemonRunning()
    
    if (status.running) {
      console.log(chalk.yellow(`Daemon already running (PID: ${status.pid})`))
      return
    }
    
    // Check for first run
    const configFile = getConfigFile()
    const isFirstRun = !existsSync(configFile)
    
    if (isFirstRun && !options.skipSetup) {
      console.log(chalk.bold('\n🎉 Welcome to BSV P2P!\n'))
      console.log('It looks like this is your first time running bsv-p2p.')
      console.log('Let\'s get you set up.\n')
      
      // Offer to run setup wizard
      console.log(chalk.yellow('Run setup wizard? (recommended)'))
      console.log(chalk.gray('You can also run: bsv-p2p setup'))
      console.log()
      console.log(chalk.gray('Starting daemon without setup in 5 seconds...'))
      console.log(chalk.gray('Press Ctrl+C to cancel and run setup first'))
      
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    
    if (options.foreground) {
      // Run in foreground - just import and run the daemon
      console.log(chalk.gray('Starting daemon in foreground...'))
      const daemon = await import('../daemon/index.js')
    } else {
      // Daemonize
      const logFile = getLogFile()
      const out = require('fs').openSync(logFile, 'a')
      const err = require('fs').openSync(logFile, 'a')
      
      const child = spawn(process.execPath, [
        '--import', 'tsx',
        join(import.meta.dirname, '../daemon/index.ts')
      ], {
        detached: true,
        stdio: ['ignore', out, err],
        env: { ...process.env, BSV_P2P_PORT: options.port }
      })
      
      child.unref()
      
      // Wait a bit to see if it started
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      const newStatus = isDaemonRunning()
      if (newStatus.running) {
        console.log(chalk.green(`\n✓ Daemon started (PID: ${newStatus.pid})`))
        console.log(chalk.gray(`  Logs: ${logFile}`))
        
        if (isFirstRun) {
          console.log()
          console.log(chalk.bold('Next steps:'))
          console.log(chalk.gray('  • Run') + chalk.cyan(' bsv-p2p status') + chalk.gray(' to check your setup'))
          console.log(chalk.gray('  • Run') + chalk.cyan(' bsv-p2p doctor') + chalk.gray(' to diagnose any issues'))
          console.log(chalk.gray('  • Read the docs:') + chalk.cyan(' https://github.com/galt-tr/bsv-p2p'))
        }
        console.log()
      } else {
        console.log(chalk.red('\n✗ Failed to start daemon. Check logs:'))
        console.log(chalk.gray(`  tail -f ${logFile}`))
        console.log()
      }
    }
  })

daemonCmd
  .command('stop')
  .description('Stop the P2P daemon')
  .action(() => {
    const status = isDaemonRunning()
    
    if (!status.running) {
      console.log(chalk.yellow('Daemon is not running'))
      return
    }
    
    try {
      process.kill(status.pid!, 'SIGTERM')
      console.log(chalk.green(`Daemon stopped (PID: ${status.pid})`))
    } catch (err) {
      console.log(chalk.red(`Failed to stop daemon: ${err}`))
    }
  })

daemonCmd
  .command('status')
  .description('Check daemon status')
  .action(async () => {
    const status = isDaemonRunning()
    
    console.log(chalk.bold('\n🔌 BSV P2P Daemon Status\n'))
    
    if (status.running) {
      try {
        const daemonStatus = await apiCall('GET', '/status')
        console.log(`${chalk.green('●')} Running (PID: ${status.pid})`)
        console.log(`${chalk.gray('Peer ID:')} ${daemonStatus.peerId}`)
        console.log(`${chalk.gray('Relay:')} ${daemonStatus.relayAddress || 'not connected'}`)
        console.log(`${chalk.gray('Connected peers:')} ${daemonStatus.connectedPeers}`)
        console.log(`${chalk.gray('Data dir:')} ${getDataDir()}`)
      } catch (err: any) {
        console.log(`${chalk.green('●')} Running (PID: ${status.pid}) - ${chalk.red('API unreachable')}`)
      }
    } else {
      console.log(`${chalk.red('○')} Not running`)
      console.log(chalk.gray('Start with: bsv-p2p daemon start'))
    }
    console.log()
  })

daemonCmd
  .command('logs')
  .description('View daemon logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <n>', 'Number of lines to show', '50')
  .action((options) => {
    const logFile = getLogFile()
    
    if (!existsSync(logFile)) {
      console.log(chalk.yellow('No log file found'))
      return
    }
    
    if (options.follow) {
      const tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' })
      tail.on('exit', () => process.exit(0))
    } else {
      try {
        execSync(`tail -n ${options.lines} "${logFile}"`, { stdio: 'inherit' })
      } catch {
        // tail returns non-zero if file is empty
      }
    }
  })

// ============ PEERS COMMANDS ============
const peersCmd = program.command('peers')
  .description('Manage peer connections')

peersCmd
  .command('list')
  .description('List all known peers')
  .action(async () => {
    try {
      const result = await apiCall('GET', '/peers/tracked')

      if (result.peers.length === 0) {
        console.log(chalk.yellow('\nNo tracked peers yet'))
        return
      }

      console.log(chalk.bold(`\n📝 Known Peers (${result.peers.length})\n`))
      console.log(chalk.gray('Name'.padEnd(20) + 'PeerID'.padEnd(20) + 'Status'.padEnd(10) + 'Last Seen'.padEnd(25) + 'Msgs'))
      console.log(chalk.gray('-'.repeat(85)))

      result.peers.forEach((peer: any) => {
        const shortId = peer.peerId.substring(0, 16) + '...'
        const status = peer.isOnline ? chalk.green('online') : chalk.gray('offline')
        const lastSeen = peer.lastSeen ? new Date(peer.lastSeen).toLocaleString() : 'Never'
        const msgCount = peer.messagesReceived + peer.messagesSent

        console.log(
          peer.name.padEnd(20) +
          shortId.padEnd(20) +
          status.padEnd(19) +
          lastSeen.padEnd(25) +
          msgCount
        )
      })
      console.log()
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`))
    }
  })

peersCmd
  .command('connect <multiaddr>')
  .description('Connect to a peer by multiaddr')
  .action(async (multiaddr) => {
    console.log(chalk.yellow('Direct peer connection via CLI not yet implemented'))
    console.log(chalk.gray('Use the daemon API directly or wait for implementation'))
  })

peersCmd
  .command('info <peerId>')
  .description('Show detailed information about a tracked peer')
  .action(async (peerId) => {
    try {
      const peer = await apiCall('GET', `/peers/tracked/${peerId}`)

      console.log(chalk.bold('\n📋 Peer Details\n'))
      console.log(`${chalk.cyan('Name:')} ${peer.name}`)
      console.log(`${chalk.cyan('Peer ID:')} ${peer.peerId}`)
      console.log(`${chalk.cyan('Status:')} ${peer.isOnline ? chalk.green('Online') : chalk.gray('Offline')}`)
      console.log(`${chalk.cyan('First Seen:')} ${new Date(peer.firstSeen).toLocaleString()}`)
      console.log(`${chalk.cyan('Last Seen:')} ${peer.lastSeen ? new Date(peer.lastSeen).toLocaleString() : 'Never'}`)

      if (peer.lastConnected) {
        console.log(`${chalk.cyan('Last Connected:')} ${new Date(peer.lastConnected).toLocaleString()}`)
      }
      if (peer.lastDisconnected) {
        console.log(`${chalk.cyan('Last Disconnected:')} ${new Date(peer.lastDisconnected).toLocaleString()}`)
      }

      console.log(chalk.bold('\n📊 Statistics:'))
      console.log(`  Messages Sent: ${peer.messagesSent}`)
      console.log(`  Messages Received: ${peer.messagesReceived}`)
      console.log(`  Payments Sent: ${peer.paymentsSent} (${peer.totalSatsSent} sats)`)
      console.log(`  Payments Received: ${peer.paymentsReceived} (${peer.totalSatsReceived} sats)`)

      if (peer.services.length > 0) {
        console.log(chalk.bold('\n🛠  Services:'))
        peer.services.forEach((service: string) => console.log(`  - ${service}`))
      }

      if (peer.tags.length > 0) {
        console.log(chalk.bold('\n🏷  Tags:'))
        peer.tags.forEach((tag: string) => console.log(`  - ${tag}`))
      }

      if (peer.notes) {
        console.log(chalk.bold('\n📝 Notes:'))
        console.log(`  ${peer.notes}`)
      }

      console.log()
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`))
    }
  })

peersCmd
  .command('name <peerId> <name>')
  .description('Set human-readable name for a peer')
  .action(async (peerId, name) => {
    try {
      await apiCall('PUT', `/peers/tracked/${peerId}/name`, { name })
      console.log(chalk.green(`✅ Updated name for ${peerId.substring(0, 16)}... to "${name}"`))
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`))
    }
  })

peersCmd
  .command('note <peerId> <note>')
  .description('Set notes for a peer')
  .action(async (peerId, note) => {
    try {
      await apiCall('PUT', `/peers/tracked/${peerId}/notes`, { notes: note })
      console.log(chalk.green(`✅ Updated notes for ${peerId.substring(0, 16)}...`))
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`))
    }
  })

peersCmd
  .command('tag <peerId> [tags...]')
  .description('Set tags for a peer')
  .action(async (peerId, tags) => {
    try {
      await apiCall('PUT', `/peers/tracked/${peerId}/tags`, { tags })
      console.log(chalk.green(`✅ Updated tags for ${peerId.substring(0, 16)}...: ${tags.join(', ')}`))
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`))
    }
  })

peersCmd
  .command('remove <peerId>')
  .description('Remove peer from registry')
  .action(async (peerId) => {
    try {
      await apiCall('DELETE', `/peers/tracked/${peerId}`)
      console.log(chalk.green(`✅ Removed ${peerId.substring(0, 16)}... from registry`))
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`))
    }
  })

peersCmd
  .command('online')
  .description('Show only online peers')
  .action(async () => {
    try {
      const result = await apiCall('GET', '/peers/tracked')
      const onlinePeers = result.peers.filter((p: any) => p.isOnline)

      if (onlinePeers.length === 0) {
        console.log(chalk.yellow('\nNo online peers'))
        return
      }

      console.log(chalk.bold(`\n🟢 Online Peers (${onlinePeers.length})\n`))
      onlinePeers.forEach((peer: any) => {
        const shortId = peer.peerId.substring(0, 16) + '...'
        console.log(`${chalk.cyan('•')} ${peer.name} (${shortId})`)
      })
      console.log()
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`))
    }
  })

// ============ CHANNELS COMMANDS ============
const channelsCmd = program.command('channels')
  .description('Manage payment channels')

channelsCmd
  .command('list')
  .description('List all payment channels')
  .option('-s, --state <state>', 'Filter by state (pending, open, closing, closed)')
  .action(async (options) => {
    try {
      const result = await apiCall('GET', '/channels')
      let channels = result.channels || []
      
      if (options.state) {
        channels = channels.filter((c: any) => c.state === options.state)
      }
      
      if (channels.length === 0) {
        console.log(chalk.yellow('\nNo channels found'))
        console.log(chalk.gray('Open a channel with: bsv-p2p channels open <peerId> <satoshis>\n'))
        return
      }
      
      console.log(chalk.bold(`\n💰 Payment Channels (${channels.length})\n`))
      channels.forEach((ch: any) => {
        const stateColor = ch.state === 'open' ? 'green' : ch.state === 'pending' ? 'yellow' : 'gray'
        console.log(chalk.bold(`ID: ${ch.id.substring(0, 16)}...`))
        console.log(`  ${chalk.gray('State:')} ${chalk[stateColor](ch.state)}`)
        console.log(`  ${chalk.gray('Peer:')} ${ch.remotePeerId.substring(0, 32)}...`)
        console.log(`  ${chalk.gray('Capacity:')} ${ch.capacity} sats`)
        console.log(`  ${chalk.gray('Local balance:')} ${ch.localBalance} sats`)
        console.log(`  ${chalk.gray('Remote balance:')} ${ch.remoteBalance} sats`)
        console.log(`  ${chalk.gray('Sequence:')} ${ch.sequenceNumber}`)
        console.log()
      })
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`))
    }
  })

channelsCmd
  .command('open <peerId> <satoshis>')
  .description('Open a payment channel with a peer')
  .option('-k, --pubkey <pubkey>', 'Remote peer BSV public key')
  .action(async (peerId, satoshis, options) => {
    try {
      const capacity = parseInt(satoshis, 10)
      
      if (!options.pubkey) {
        console.error(chalk.red('Error: --pubkey required'))
        console.log(chalk.gray('Usage: bsv-p2p channels open <peerId> <satoshis> --pubkey <remotePubKey>'))
        return
      }
      
      console.log(chalk.gray(`Opening channel with ${peerId.substring(0, 32)}...`))
      console.log(chalk.gray(`Capacity: ${capacity} satoshis`))
      
      const result = await apiCall('POST', '/channel/open', {
        peerId,
        remotePubKey: options.pubkey,
        capacity
      })
      
      console.log(chalk.green(`\n✓ Channel opened`))
      console.log(`  ${chalk.gray('Channel ID:')} ${result.channelId}`)
      console.log(`  ${chalk.gray('State:')} ${result.state}`)
      console.log(`  ${chalk.gray('Capacity:')} ${result.capacity} sats`)
      console.log()
    } catch (err: any) {
      console.error(chalk.red(`\nError: ${err.message}`))
    }
  })

channelsCmd
  .command('close <channelId>')
  .description('Close a payment channel')
  .option('-f, --force', 'Force close (unilateral)')
  .action(async (channelId, options) => {
    try {
      console.log(chalk.gray(`Closing channel ${channelId.substring(0, 16)}...`))
      
      const result = await apiCall('POST', '/channel/close', {
        channelId,
        force: options.force || false
      })
      
      console.log(chalk.green(`\n✓ Channel close initiated`))
      console.log(`  ${chalk.gray('Type:')} ${options.force ? 'force' : 'cooperative'}`)
      if (result.txid) {
        console.log(`  ${chalk.gray('TX ID:')} ${result.txid}`)
      }
      console.log()
    } catch (err: any) {
      console.error(chalk.red(`\nError: ${err.message}`))
    }
  })

channelsCmd
  .command('info <channelId>')
  .description('Show detailed channel information')
  .action(async (channelId) => {
    try {
      const result = await apiCall('GET', '/channels')
      const channel = result.channels.find((c: any) => c.id.startsWith(channelId))
      
      if (!channel) {
        console.error(chalk.red(`Channel not found: ${channelId}`))
        return
      }
      
      console.log(chalk.bold(`\n💰 Channel Details\n`))
      console.log(`${chalk.gray('ID:')} ${channel.id}`)
      console.log(`${chalk.gray('State:')} ${channel.state}`)
      console.log(`${chalk.gray('Local peer:')} ${channel.localPeerId}`)
      console.log(`${chalk.gray('Remote peer:')} ${channel.remotePeerId}`)
      console.log(`${chalk.gray('Capacity:')} ${channel.capacity} sats`)
      console.log(`${chalk.gray('Local balance:')} ${channel.localBalance} sats`)
      console.log(`${chalk.gray('Remote balance:')} ${channel.remoteBalance} sats`)
      console.log(`${chalk.gray('Sequence number:')} ${channel.sequenceNumber}`)
      console.log(`${chalk.gray('nLockTime:')} ${channel.nLockTime} (${new Date(channel.nLockTime * 1000).toLocaleString()})`)
      console.log(`${chalk.gray('Created:')} ${new Date(channel.createdAt).toLocaleString()}`)
      console.log(`${chalk.gray('Updated:')} ${new Date(channel.updatedAt).toLocaleString()}`)
      console.log()
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`))
    }
  })

channelsCmd
  .command('balance')
  .description('Show total balance across all channels')
  .action(async () => {
    try {
      const result = await apiCall('GET', '/channels')
      const channels = result.channels || []
      
      const openChannels = channels.filter((c: any) => c.state === 'open')
      const totalCapacity = channels.reduce((sum: number, c: any) => sum + c.capacity, 0)
      const totalLocal = channels.reduce((sum: number, c: any) => sum + c.localBalance, 0)
      const totalRemote = channels.reduce((sum: number, c: any) => sum + c.remoteBalance, 0)
      
      console.log(chalk.bold('\n💰 Channel Balances\n'))
      console.log(`${chalk.gray('Total channels:')} ${channels.length} (${openChannels.length} open)`)
      console.log(`${chalk.gray('Total capacity:')} ${totalCapacity} sats`)
      console.log(`${chalk.gray('Total local balance:')} ${totalLocal} sats`)
      console.log(`${chalk.gray('Total remote balance:')} ${totalRemote} sats`)
      console.log()
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`))
    }
  })

// ============ SERVICES COMMANDS ============
const servicesCmd = program.command('services')
  .description('Discover and manage services')

servicesCmd
  .command('list')
  .description('List available services')
  .option('-s, --service <name>', 'Filter by service name')
  .action(async (options) => {
    try {
      const query = options.service ? `?service=${options.service}` : ''
      const result = await apiCall('GET', `/discover${query}`)
      
      if (result.peers.length === 0) {
        console.log(chalk.yellow('\nNo services found'))
        return
      }
      
      console.log(chalk.bold(`\n🔍 Discovered Services (${result.peers.length} peers)\n`))
      result.peers.forEach((peer: any, i: number) => {
        console.log(`${chalk.cyan((i + 1) + '.')} ${peer.peerId}`)
        if (peer.services) {
          peer.services.forEach((svc: any) => {
            console.log(`    ${svc.id}: ${svc.name} (${svc.pricing?.baseSatoshis || 0} sats)`)
          })
        }
      })
      console.log()
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`))
    }
  })

// ============ SEND COMMAND ============
program
  .command('send <peerId> <message>')
  .description('Send a direct message to a peer')
  .action(async (peerId, message) => {
    try {
      console.log(chalk.gray(`Sending message to ${peerId.substring(0, 32)}...`))
      
      const result = await apiCall('POST', '/send', { peerId, message })
      
      console.log(chalk.green('\n✓ Message sent'))
      console.log(`  ${chalk.gray('From:')} ${result.from}`)
      console.log()
    } catch (err: any) {
      console.error(chalk.red(`\nError: ${err.message}`))
    }
  })

// ============ REQUEST COMMAND ============
program
  .command('request <peerId> <service>')
  .description('Request a paid service from a peer')
  .option('-d, --data <json>', 'Service input data (JSON)', '{}')
  .option('-c, --channel <channelId>', 'Use specific channel for payment')
  .option('-m, --max-payment <sats>', 'Maximum payment willing to make', '1000')
  .action(async (peerId, service, options) => {
    try {
      const input = JSON.parse(options.data)
      const maxPayment = parseInt(options.maxPayment, 10)
      
      console.log(chalk.gray(`Requesting service "${service}" from ${peerId.substring(0, 32)}...`))
      console.log(chalk.gray(`Max payment: ${maxPayment} sats`))
      
      console.log(chalk.yellow('\nPaid service requests not yet fully implemented'))
      console.log(chalk.gray('This requires channel payment integration'))
      console.log(chalk.gray('Use the daemon API directly or wait for implementation'))
    } catch (err: any) {
      console.error(chalk.red(`\nError: ${err.message}`))
    }
  })

// ============ CONFIG COMMAND ============
const configCmd = program.command('config')
  .description('Manage configuration')

configCmd
  .command('show')
  .description('View current configuration')
  .action(() => {
    const configFile = getConfigFile()
    
    let config: Record<string, any> = {}
    if (existsSync(configFile)) {
      config = JSON.parse(readFileSync(configFile, 'utf-8'))
    }
    
    console.log(chalk.bold('\n⚙️  Configuration\n'))
    console.log(JSON.stringify(config, null, 2))
    console.log()
  })

configCmd
  .command('set')
  .description('Update configuration values')
  .option('--port <port>', 'Set daemon port')
  .option('--bsv-key <key>', 'Set BSV identity key')
  .action((options) => {
    const configFile = getConfigFile()
    
    let config: Record<string, any> = {}
    if (existsSync(configFile)) {
      config = JSON.parse(readFileSync(configFile, 'utf-8'))
    }
    
    let changed = false
    
    if (options.port) {
      config.port = parseInt(options.port, 10)
      changed = true
    }
    
    if (options.bsvKey) {
      config.bsvIdentityKey = options.bsvKey
      changed = true
    }
    
    if (changed) {
      writeFileSync(configFile, JSON.stringify(config, null, 2))
      console.log(chalk.green('✓ Configuration updated'))
    } else {
      console.log(chalk.yellow('No changes made'))
    }
    
    console.log(chalk.bold('\n⚙️  Configuration\n'))
    console.log(JSON.stringify(config, null, 2))
    console.log()
  })

configCmd
  .command('encrypt')
  .description('Encrypt config file with passphrase')
  .option('-i, --input <file>', 'Input config file', join(getDataDir(), 'config.json'))
  .option('-o, --output <file>', 'Output encrypted file', join(getDataDir(), 'config.encrypted.json'))
  .action(async (options) => {
    const { encryptConfig } = await import('../config/encryption.js')
    const readline = await import('readline/promises')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    
    try {
      if (!existsSync(options.input)) {
        console.log(chalk.red(`Error: Input file not found: ${options.input}`))
        process.exit(1)
      }
      
      // Read plaintext config
      const plaintext = readFileSync(options.input, 'utf-8')
      
      // Prompt for passphrase (with confirmation)
      console.log(chalk.bold('\n🔐 Encrypt Configuration\n'))
      const passphrase1 = await rl.question('Enter passphrase: ')
      const passphrase2 = await rl.question('Confirm passphrase: ')
      
      if (passphrase1 !== passphrase2) {
        console.log(chalk.red('\n✗ Passphrases do not match'))
        process.exit(1)
      }
      
      if (passphrase1.length < 8) {
        console.log(chalk.red('\n✗ Passphrase must be at least 8 characters'))
        process.exit(1)
      }
      
      // Encrypt
      console.log(chalk.gray('\nEncrypting...'))
      const encrypted = await encryptConfig(plaintext, passphrase1)
      
      // Write encrypted file
      writeFileSync(options.output, JSON.stringify(encrypted, null, 2))
      
      console.log(chalk.green(`\n✓ Config encrypted and saved to ${options.output}`))
      console.log(chalk.yellow('\n⚠️  IMPORTANT: Keep your passphrase safe!'))
      console.log(chalk.gray('Without it, you cannot decrypt your config.'))
      console.log()
    } finally {
      rl.close()
    }
  })

configCmd
  .command('decrypt')
  .description('Decrypt encrypted config file')
  .option('-i, --input <file>', 'Input encrypted file', join(getDataDir(), 'config.encrypted.json'))
  .option('-o, --output <file>', 'Output plaintext file', join(getDataDir(), 'config.decrypted.json'))
  .action(async (options) => {
    const { decryptConfig } = await import('../config/encryption.js')
    const readline = await import('readline/promises')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    
    try {
      if (!existsSync(options.input)) {
        console.log(chalk.red(`Error: Input file not found: ${options.input}`))
        process.exit(1)
      }
      
      // Read encrypted config
      const data = readFileSync(options.input, 'utf-8')
      const encrypted = JSON.parse(data)
      
      // Prompt for passphrase
      console.log(chalk.bold('\n🔓 Decrypt Configuration\n'))
      const passphrase = await rl.question('Enter passphrase: ')
      
      // Decrypt
      console.log(chalk.gray('\nDecrypting...'))
      try {
        const plaintext = await decryptConfig(encrypted, passphrase)
        
        // Write decrypted file
        writeFileSync(options.output, plaintext)
        
        console.log(chalk.green(`\n✓ Config decrypted and saved to ${options.output}`))
        console.log(chalk.yellow('\n⚠️  WARNING: Decrypted file contains sensitive data in plaintext'))
        console.log()
      } catch (error: any) {
        console.log(chalk.red(`\n✗ Decryption failed: ${error.message}`))
        console.log(chalk.gray('Check your passphrase and try again'))
        process.exit(1)
      }
    } finally {
      rl.close()
    }
  })

configCmd
  .command('migrate-to-keychain')
  .description('Migrate keys from config file to OS keychain')
  .action(async () => {
    const { KeychainManager } = await import('../config/keychain.js')
    const configPath = getConfigFile()
    
    console.log(chalk.bold('\n🔐 Migrate Keys to OS Keychain\n'))
    
    // Check if config file exists
    if (!existsSync(configPath)) {
      console.log(chalk.red('No config file found'))
      return
    }
    
    // Read config
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    
    // Check for keys
    const hasKeys = config.bsvPrivateKey || config.bsvPublicKey || config.bsvIdentityKey
    if (!hasKeys) {
      console.log(chalk.yellow('No keys found in config file'))
      return
    }
    
    // Initialize keychain
    const keychain = new KeychainManager()
    
    // Check if keychain is available
    const available = await keychain.isAvailable()
    if (!available) {
      console.log(chalk.red('OS keychain not available on this system'))
      console.log(chalk.gray('Keychain requires:'))
      console.log(chalk.gray('  - macOS: Keychain Access'))
      console.log(chalk.gray('  - Linux: libsecret (install: apt install libsecret-1-0)'))
      console.log(chalk.gray('  - Windows: Credential Manager'))
      return
    }
    
    // Migrate keys
    console.log(chalk.gray('Migrating keys...'))
    
    try {
      if (config.bsvPrivateKey) {
        await keychain.setPrivateKey(config.bsvPrivateKey)
        console.log(chalk.green('✓ Private key migrated'))
      }
      if (config.bsvPublicKey) {
        await keychain.setPublicKey(config.bsvPublicKey)
        console.log(chalk.green('✓ Public key migrated'))
      }
      if (config.bsvIdentityKey) {
        await keychain.setIdentityKey(config.bsvIdentityKey)
        console.log(chalk.green('✓ Identity key migrated'))
      }
      
      console.log(chalk.green('\n✓ All keys migrated to OS keychain'))
      console.log(chalk.yellow('\n⚠️  IMPORTANT:'))
      console.log(chalk.gray('Remove keys from config.json for better security:'))
      console.log(chalk.cyan(`  nano ${configPath}`))
      console.log(chalk.gray('Delete the bsvPrivateKey, bsvPublicKey, and bsvIdentityKey fields'))
    } catch (error: any) {
      console.log(chalk.red(`\n✗ Migration failed: ${error.message}`))
    }
    
    console.log()
  })

configCmd
  .command('check-security')
  .description('Audit configuration security')
  .action(async () => {
    const { KeychainManager } = await import('../config/keychain.js')
    const { statSync } = await import('fs')
    
    console.log(chalk.bold('\n🔍 Security Audit\n'))
    console.log(chalk.bold('━'.repeat(50)))
    console.log()
    
    // Check 1: Key storage method
    console.log(chalk.bold('Key Storage Method:'))
    const keychain = new KeychainManager()
    const keychainPrivKey = await keychain.getPrivateKey()
    const keychainPubKey = await keychain.getPublicKey()
    const keychainIdKey = await keychain.getIdentityKey()
    
    if (keychainPrivKey || keychainPubKey || keychainIdKey) {
      console.log(`  ${chalk.green('✓')} Keys stored in OS keychain ${chalk.gray('(secure)')}`)
    } else {
      const configPath = getConfigFile()
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        if (config.bsvPrivateKey || config.bsvPublicKey || config.bsvIdentityKey) {
          console.log(`  ${chalk.red('✗')} CRITICAL: Keys in plaintext config file`)
          console.log(`     ${chalk.gray('Fix:')} ${chalk.cyan('bsv-p2p config migrate-to-keychain')}`)
        }
      }
      
      if (process.env.BSV_PRIVATE_KEY || process.env.BSV_PUBLIC_KEY || process.env.BSV_IDENTITY_KEY) {
        console.log(`  ${chalk.yellow('⚠')} WARNING: Keys in environment variables`)
        console.log(`     ${chalk.gray('Better:')} Use OS keychain`)
      }
      
      const encryptedPath = join(getDataDir(), 'config.encrypted.json')
      if (existsSync(encryptedPath)) {
        console.log(`  ${chalk.cyan('ℹ')} Encrypted config file found`)
        console.log(`     ${chalk.gray('Good:')} Better than plaintext`)
      }
    }
    console.log()
    
    // Check 2: File permissions
    console.log(chalk.bold('File Permissions:'))
    const configPath = getConfigFile()
    if (existsSync(configPath)) {
      const stats = statSync(configPath)
      const mode = (stats.mode & parseInt('777', 8)).toString(8)
      
      if (mode === '600') {
        console.log(`  ${chalk.green('✓')} Config: 0600 ${chalk.gray('(owner only)')}`)
      } else {
        console.log(`  ${chalk.yellow('⚠')} Config: 0${mode} ${chalk.gray('(should be 0600)')}`)
        console.log(`     ${chalk.gray('Fix:')} ${chalk.cyan(`chmod 600 ${configPath}`)}`)
      }
    }
    console.log()
    
    // Check 3: Git repository
    console.log(chalk.bold('Version Control:'))
    const gitDir = join(getDataDir(), '.git')
    if (existsSync(gitDir)) {
      console.log(`  ${chalk.red('✗')} CRITICAL: Data dir is a git repository`)
      console.log(`     ${chalk.gray('Risk:')} Keys may be in commit history`)
      console.log(`     ${chalk.gray('Fix:')} Remove .git or use .gitignore`)
    } else {
      console.log(`  ${chalk.green('✓')} Not in git repository`)
    }
    console.log()
    
    // Check 4: Backup recommendations
    console.log(chalk.bold('📋 Backup Checklist:'))
    console.log(`  ${chalk.gray('□')} Export key to secure offline storage`)
    console.log(`     ${chalk.cyan('bsv-p2p config export-key --output ~/backup.key')}`)
    console.log(`  ${chalk.gray('□')} DO NOT store in cloud (Dropbox, Drive, etc.)`)
    console.log(`  ${chalk.gray('□')} Encrypt external backups`)
    console.log(`  ${chalk.gray('□')} Test recovery process`)
    
    console.log(chalk.bold('\n' + '━'.repeat(50)))
    console.log()
  })

configCmd
  .command('export-key')
  .description('Export private key for backup')
  .option('-o, --output <file>', 'Output file', join(getDataDir(), 'private-key-backup.txt'))
  .option('--show', 'Display key in terminal (insecure)')
  .action(async (options) => {
    const { KeychainManager } = await import('../config/keychain.js')
    
    console.log(chalk.bold('\n🔑 Export Private Key\n'))
    
    // Try to get key from keychain first
    const keychain = new KeychainManager()
    let privateKey = await keychain.getPrivateKey()
    
    // Fallback to config file
    if (!privateKey) {
      const configPath = getConfigFile()
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        privateKey = config.bsvPrivateKey
      }
    }
    
    // Fallback to env var
    if (!privateKey) {
      privateKey = process.env.BSV_PRIVATE_KEY
    }
    
    if (!privateKey) {
      console.log(chalk.red('No private key found'))
      console.log(chalk.gray('Run setup first: bsv-p2p setup'))
      return
    }
    
    if (options.show) {
      console.log(chalk.yellow('⚠️  WARNING: Displaying private key in terminal'))
      console.log(chalk.gray('Anyone with access to your screen can see it\n'))
      console.log(chalk.bold('Private Key:'))
      console.log(privateKey)
      console.log()
    } else {
      writeFileSync(options.output, privateKey)
      console.log(chalk.green(`✓ Private key exported to ${options.output}`))
      console.log(chalk.yellow('\n⚠️  SECURITY WARNING:'))
      console.log(chalk.gray('  - Store this file in a secure location'))
      console.log(chalk.gray('  - Never commit to version control'))
      console.log(chalk.gray('  - Encrypt with: gpg -c ' + options.output))
      console.log(chalk.gray('  - Delete after secure storage'))
      console.log()
    }
  })

configCmd
  .command('import-key')
  .description('Import private key from backup')
  .option('-i, --input <file>', 'Input file containing private key')
  .option('--key <hex>', 'Private key as hex string')
  .action(async (options) => {
    const { KeychainManager } = await import('../config/keychain.js')
    
    console.log(chalk.bold('\n🔐 Import Private Key\n'))
    
    // Get key from input
    let privateKey: string | undefined
    
    if (options.key) {
      privateKey = options.key
    } else if (options.input) {
      if (!existsSync(options.input)) {
        console.log(chalk.red(`File not found: ${options.input}`))
        return
      }
      privateKey = readFileSync(options.input, 'utf-8').trim()
    } else {
      console.log(chalk.red('Error: Provide --input <file> or --key <hex>'))
      return
    }
    
    // Validate key format (basic check)
    if (!privateKey.match(/^[0-9a-f]{64}$/i)) {
      console.log(chalk.red('Invalid private key format'))
      console.log(chalk.gray('Expected: 64-character hex string'))
      return
    }
    
    // Try to store in keychain
    const keychain = new KeychainManager()
    const available = await keychain.isAvailable()
    
    if (available) {
      try {
        await keychain.setPrivateKey(privateKey)
        console.log(chalk.green('✓ Private key imported to OS keychain'))
      } catch (error: any) {
        console.log(chalk.red(`Failed to store in keychain: ${error.message}`))
        console.log(chalk.gray('Falling back to config file...'))
        
        // Fallback: write to config file
        const configPath = getConfigFile()
        let config: Record<string, any> = {}
        if (existsSync(configPath)) {
          config = JSON.parse(readFileSync(configPath, 'utf-8'))
        }
        config.bsvPrivateKey = privateKey
        writeFileSync(configPath, JSON.stringify(config, null, 2))
        console.log(chalk.green('✓ Private key saved to config file'))
        console.log(chalk.yellow('⚠️  WARNING: Key is in plaintext'))
      }
    } else {
      // No keychain available, write to config file
      const configPath = getConfigFile()
      let config: Record<string, any> = {}
      if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, 'utf-8'))
      }
      config.bsvPrivateKey = privateKey
      writeFileSync(configPath, JSON.stringify(config, null, 2))
      console.log(chalk.green('✓ Private key saved to config file'))
      console.log(chalk.yellow('⚠️  WARNING: OS keychain not available'))
      console.log(chalk.gray('Key is stored in plaintext'))
    }
    
    console.log()
  })

// ============ SETUP COMMAND ============
program
  .command('setup')
  .description('First-run setup wizard')
  .action(async () => {
    console.log(chalk.bold('\n🎉 Welcome to BSV P2P!\n'))
    console.log('BSV P2P enables peer-to-peer communication and payment channels')
    console.log('between AI agents using Bitcoin SV.')
    console.log()
    console.log(chalk.bold('━'.repeat(60)))
    console.log()
    
    // Step 1: Check if already set up
    const configFile = getConfigFile()
    const dataDir = getDataDir()
    const alreadySetup = existsSync(configFile)
    
    if (alreadySetup) {
      console.log(chalk.yellow('⚠ Configuration already exists'))
      console.log(chalk.gray(`  Location: ${configFile}`))
      console.log()
      console.log('To reconfigure, delete the config file and run setup again.')
      console.log()
      return
    }
    
    console.log(chalk.bold('Step 1: Data Directory'))
    console.log(`Your P2P data will be stored in: ${chalk.cyan(dataDir)}`)
    console.log()
    
    // Step 2: Generate config
    console.log(chalk.bold('Step 2: Generating Configuration'))
    const config = {
      port: 4001,
      apiPort: 4002,
      enableRelay: true,
      bootstrapPeers: [],
      created: new Date().toISOString()
    }
    
    writeFileSync(configFile, JSON.stringify(config, null, 2))
    console.log(chalk.green('✓') + ' Configuration created')
    console.log()
    
    // Step 3: Identity
    console.log(chalk.bold('Step 3: Identity'))
    console.log('Starting the daemon will automatically generate:')
    console.log(chalk.gray('  • libp2p Peer ID (Ed25519)'))
    console.log(chalk.gray('  • BSV identity key (secp256k1) - optional'))
    console.log()
    
    // Step 4: Test connectivity (if daemon running)
    const daemonStatus = isDaemonRunning()
    if (daemonStatus.running) {
      console.log(chalk.bold('Step 4: Testing Connectivity'))
      try {
        const info = await apiCall('GET', '/status')
        console.log(chalk.green('✓') + ' Daemon is running')
        console.log(`  ${chalk.gray('Peer ID:')} ${info.peerId}`)
        
        if (info.relayAddress) {
          console.log(chalk.green('✓') + ' Connected to relay')
          console.log(`  ${chalk.gray('Relay:')} ${info.relayAddress}`)
        } else {
          console.log(chalk.yellow('⚠') + ' Not connected to relay')
          console.log(chalk.gray('  The daemon will attempt to connect automatically'))
        }
      } catch (err: any) {
        console.log(chalk.yellow('⚠') + ' Daemon API unreachable')
        console.log(chalk.gray(`  Error: ${err.message}`))
      }
      console.log()
    } else {
      console.log(chalk.bold('Step 4: Starting the Daemon'))
      console.log('Run: ' + chalk.cyan('bsv-p2p daemon start'))
      console.log()
    }
    
    // Step 5: OpenClaw integration
    console.log(chalk.bold('Step 5: OpenClaw Integration'))
    const hasOpenClaw = existsSync(join(homedir(), '.openclaw'))
    if (hasOpenClaw) {
      console.log(chalk.green('✓') + ' OpenClaw detected')
      
      const skillsDir = join(homedir(), '.openclaw', 'skills', 'bsv-p2p')
      if (existsSync(skillsDir)) {
        console.log(chalk.green('✓') + ' Skill already registered')
      } else {
        console.log(chalk.yellow('⚠') + ' Skill not registered')
        console.log(chalk.gray('  Link this directory to OpenClaw skills:'))
        console.log(chalk.gray(`  ln -s ${process.cwd()} ${skillsDir}`))
      }
    } else {
      console.log(chalk.gray('○ OpenClaw not detected'))
      console.log(chalk.gray('  Install OpenClaw to use P2P in your AI agent'))
      console.log(chalk.gray('  https://openclaw.ai'))
    }
    console.log()
    
    // Step 6: Next steps
    console.log(chalk.bold('━'.repeat(60)))
    console.log()
    console.log(chalk.bold.green('✓ Setup Complete!'))
    console.log()
    console.log(chalk.bold('Next steps:'))
    console.log()
    console.log('  1. Start the daemon:')
    console.log('     ' + chalk.cyan('bsv-p2p daemon start'))
    console.log()
    console.log('  2. Check status:')
    console.log('     ' + chalk.cyan('bsv-p2p status'))
    console.log()
    console.log('  3. Run health checks:')
    console.log('     ' + chalk.cyan('bsv-p2p doctor'))
    console.log()
    console.log('  4. Connect to peers:')
    console.log('     ' + chalk.cyan('bsv-p2p peers connect <multiaddr>'))
    console.log()
    console.log('  5. Open a payment channel:')
    console.log('     ' + chalk.cyan('bsv-p2p channels open <peerId> <satoshis> --pubkey <key>'))
    console.log()
    console.log(chalk.gray('For more help, visit: https://github.com/galt-tr/bsv-p2p'))
    console.log()
  })

// ============ STATUS COMMAND ============
program
  .command('status')
  .description('Show comprehensive system status')
  .action(async () => {
    const daemonStatus = isDaemonRunning()
    
    console.log(chalk.bold('\n🔌 BSV P2P System Status\n'))
    console.log(chalk.bold('━'.repeat(50)))
    
    // Daemon
    console.log(chalk.bold('\nDaemon:'))
    if (daemonStatus.running) {
      console.log(`  ${chalk.green('●')} Running (PID: ${daemonStatus.pid})`)
      
      try {
        const info = await apiCall('GET', '/status')
        console.log(`  ${chalk.gray('Uptime:')} ${Math.floor((Date.now() - info.startTime) / 1000)}s`)
        console.log(`  ${chalk.gray('Peer ID:')} ${info.peerId || 'unknown'}`)
      } catch {
        console.log(`  ${chalk.yellow('⚠')} API unreachable`)
      }
    } else {
      console.log(`  ${chalk.red('○')} Not running`)
    }
    
    // Network
    console.log(chalk.bold('\nNetwork:'))
    if (daemonStatus.running) {
      try {
        const info = await apiCall('GET', '/status')
        const peers = await apiCall('GET', '/peers')
        console.log(`  ${chalk.gray('Relay:')} ${info.relayAddress || 'disconnected'}`)
        if (info.relayReservation) {
          console.log(`  ${chalk.gray('Reservation:')} ${chalk.green('active')}`)
        }
        console.log(`  ${chalk.gray('Connected peers:')} ${peers.peers?.length || 0}`)
      } catch {
        console.log(`  ${chalk.yellow('⚠')} Status unavailable`)
      }
    } else {
      console.log(`  ${chalk.gray('Status:')} daemon not running`)
    }
    
    // Channels
    console.log(chalk.bold('\nPayment Channels:'))
    if (daemonStatus.running) {
      try {
        const result = await apiCall('GET', '/channels')
        const channels = result.channels || []
        const openChannels = channels.filter((c: any) => c.state === 'open')
        const totalCapacity = channels.reduce((sum: number, c: any) => sum + c.capacity, 0)
        const localBalance = channels.reduce((sum: number, c: any) => sum + c.localBalance, 0)
        
        console.log(`  ${chalk.gray('Total channels:')} ${channels.length} (${openChannels.length} open)`)
        console.log(`  ${chalk.gray('Total capacity:')} ${totalCapacity} sats`)
        console.log(`  ${chalk.gray('Local balance:')} ${localBalance} sats`)
      } catch {
        console.log(`  ${chalk.yellow('⚠')} Status unavailable`)
      }
    } else {
      console.log(`  ${chalk.gray('Status:')} daemon not running`)
    }
    
    // BSV Wallet (placeholder)
    console.log(chalk.bold('\nBSV Wallet:'))
    console.log(`  ${chalk.gray('Status:')} ${chalk.yellow('not integrated')}`)
    
    // OpenClaw Integration
    console.log(chalk.bold('\nOpenClaw Integration:'))
    const hasOpenClaw = existsSync(join(homedir(), '.openclaw'))
    if (hasOpenClaw) {
      console.log(`  ${chalk.green('✓')} OpenClaw detected`)
      // Check if skill is registered
      const skillsDir = join(homedir(), '.openclaw', 'skills', 'bsv-p2p')
      if (existsSync(skillsDir)) {
        console.log(`  ${chalk.green('✓')} Skill registered`)
      } else {
        console.log(`  ${chalk.yellow('⚠')} Skill not registered`)
      }
    } else {
      console.log(`  ${chalk.gray('○')} OpenClaw not detected`)
    }
    
    console.log(chalk.bold('\n' + '━'.repeat(50)))
    console.log()
  })

// ============ DOCTOR COMMAND ============
program
  .command('doctor')
  .description('Diagnose system health and configuration')
  .action(async () => {
    console.log(chalk.bold('\n🩺 BSV P2P Health Check\n'))
    console.log(chalk.bold('━'.repeat(50)))
    
    const checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message: string }> = []
    
    // Check 1: Node.js version
    const nodeVersion = process.version
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10)
    if (majorVersion >= 22) {
      checks.push({ name: 'Node.js version', status: 'pass', message: `${nodeVersion} (compatible)` })
    } else {
      checks.push({ name: 'Node.js version', status: 'warn', message: `${nodeVersion} (recommend v22+)` })
    }
    
    // Check 2: Config file
    const configFile = getConfigFile()
    if (existsSync(configFile)) {
      try {
        JSON.parse(readFileSync(configFile, 'utf-8'))
        checks.push({ name: 'Config file', status: 'pass', message: 'valid' })
      } catch {
        checks.push({ name: 'Config file', status: 'fail', message: 'invalid JSON' })
      }
    } else {
      checks.push({ name: 'Config file', status: 'warn', message: 'not created (will use defaults)' })
    }
    
    // Check 3: Data directory
    const dataDir = getDataDir()
    if (existsSync(dataDir)) {
      checks.push({ name: 'Data directory', status: 'pass', message: dataDir })
    } else {
      checks.push({ name: 'Data directory', status: 'fail', message: 'not found' })
    }
    
    // Check 4: Daemon status
    const daemonStatus = isDaemonRunning()
    if (daemonStatus.running) {
      checks.push({ name: 'Daemon', status: 'pass', message: `running (PID ${daemonStatus.pid})` })
      
      // Check 5: API reachable
      try {
        await apiCall('GET', '/status')
        checks.push({ name: 'API endpoint', status: 'pass', message: `port ${API_PORT}` })
      } catch (err: any) {
        checks.push({ name: 'API endpoint', status: 'fail', message: err.message })
      }
      
      // Check 6: Relay connection
      try {
        const info = await apiCall('GET', '/status')
        if (info.relayAddress) {
          checks.push({ name: 'Relay connection', status: 'pass', message: info.relayAddress })
        } else {
          checks.push({ name: 'Relay connection', status: 'warn', message: 'not connected' })
        }
      } catch {
        checks.push({ name: 'Relay connection', status: 'warn', message: 'status unavailable' })
      }
    } else {
      checks.push({ name: 'Daemon', status: 'warn', message: 'not running' })
    }
    
    // Check 7: Port conflicts
    try {
      const response = await fetch(`http://127.0.0.1:${API_PORT}/status`)
      if (daemonStatus.running) {
        checks.push({ name: 'Port check', status: 'pass', message: `${API_PORT} available` })
      } else {
        checks.push({ name: 'Port check', status: 'warn', message: `${API_PORT} in use by another process` })
      }
    } catch {
      if (!daemonStatus.running) {
        checks.push({ name: 'Port check', status: 'pass', message: `${API_PORT} available` })
      }
    }
    
    // Check 8: OpenClaw integration
    const hasOpenClaw = existsSync(join(homedir(), '.openclaw'))
    if (hasOpenClaw) {
      checks.push({ name: 'OpenClaw', status: 'pass', message: 'detected' })
      
      const skillsDir = join(homedir(), '.openclaw', 'skills', 'bsv-p2p')
      if (existsSync(skillsDir)) {
        checks.push({ name: 'OpenClaw skill', status: 'pass', message: 'registered' })
      } else {
        checks.push({ name: 'OpenClaw skill', status: 'warn', message: 'not registered' })
      }
    } else {
      checks.push({ name: 'OpenClaw', status: 'warn', message: 'not detected' })
    }
    
    // Check 9: BSV keys
    if (existsSync(configFile)) {
      try {
        const config = JSON.parse(readFileSync(configFile, 'utf-8'))
        if (config.bsvIdentityKey) {
          checks.push({ name: 'BSV identity key', status: 'pass', message: 'configured' })
        } else {
          checks.push({ name: 'BSV identity key', status: 'warn', message: 'not set' })
        }
      } catch {
        checks.push({ name: 'BSV identity key', status: 'warn', message: 'config unreadable' })
      }
    } else {
      checks.push({ name: 'BSV identity key', status: 'warn', message: 'no config file' })
    }
    
    // Print results
    console.log()
    let passCount = 0
    let warnCount = 0
    let failCount = 0
    
    checks.forEach(check => {
      let icon = ''
      let color: typeof chalk.green = chalk.gray
      
      if (check.status === 'pass') {
        icon = '✓'
        color = chalk.green
        passCount++
      } else if (check.status === 'warn') {
        icon = '⚠'
        color = chalk.yellow
        warnCount++
      } else {
        icon = '✗'
        color = chalk.red
        failCount++
      }
      
      console.log(`  ${color(icon)} ${chalk.bold(check.name)}: ${check.message}`)
    })
    
    console.log(chalk.bold('\n' + '━'.repeat(50)))
    console.log()
    console.log(`${chalk.green('✓')} ${passCount} passed  ${chalk.yellow('⚠')} ${warnCount} warnings  ${chalk.red('✗')} ${failCount} failed`)
    console.log()
    
    if (failCount > 0) {
      console.log(chalk.red('Some checks failed. Review the issues above.'))
    } else if (warnCount > 0) {
      console.log(chalk.yellow('System is functional but some warnings need attention.'))
    } else {
      console.log(chalk.green('All checks passed! System is healthy.'))
    }
    console.log()
  })

program.parse()
