#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import { spawn, execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const program = new Command()

const API_PORT = 4002 // Daemon API port

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
  .description('List connected peers')
  .action(async () => {
    try {
      const result = await apiCall('GET', '/peers')
      
      if (result.peers.length === 0) {
        console.log(chalk.yellow('\nNo connected peers'))
        console.log(chalk.gray('Connect to peers with: bsv-p2p peers connect <multiaddr>\n'))
        return
      }
      
      console.log(chalk.bold(`\n👥 Connected Peers (${result.peers.length})\n`))
      result.peers.forEach((peer: any, i: number) => {
        console.log(`${chalk.cyan((i + 1) + '.')} ${peer.peerId}`)
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
program
  .command('config')
  .description('View or update configuration')
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
      console.log(chalk.green('Configuration updated'))
    }
    
    console.log(chalk.bold('\n⚙️  Configuration\n'))
    console.log(JSON.stringify(config, null, 2))
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
