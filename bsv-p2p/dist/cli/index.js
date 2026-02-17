#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
const program = new Command();
function getDataDir() {
    const dir = join(homedir(), '.bsv-p2p');
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}
function getPidFile() {
    return join(getDataDir(), 'daemon.pid');
}
function getLogFile() {
    return join(getDataDir(), 'daemon.log');
}
function getConfigFile() {
    return join(getDataDir(), 'config.json');
}
function isDaemonRunning() {
    const pidFile = getPidFile();
    if (!existsSync(pidFile)) {
        return { running: false };
    }
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    try {
        // Check if process is running
        process.kill(pid, 0);
        return { running: true, pid };
    }
    catch {
        // Process not running, clean up stale pid file
        unlinkSync(pidFile);
        return { running: false };
    }
}
program
    .name('bsv-p2p')
    .description('BSV P2P daemon with payment channels for OpenClaw bots')
    .version('0.1.0');
// ============ DAEMON COMMANDS ============
const daemonCmd = program.command('daemon')
    .description('Manage the P2P daemon');
daemonCmd
    .command('start')
    .description('Start the P2P daemon')
    .option('-f, --foreground', 'Run in foreground (don\'t daemonize)')
    .option('-p, --port <port>', 'Port to listen on', '4001')
    .action(async (options) => {
    const status = isDaemonRunning();
    if (status.running) {
        console.log(chalk.yellow(`Daemon already running (PID: ${status.pid})`));
        return;
    }
    if (options.foreground) {
        // Run in foreground - just import and run the daemon
        console.log(chalk.gray('Starting daemon in foreground...'));
        const daemon = await import('../daemon/index.js');
    }
    else {
        // Daemonize
        const logFile = getLogFile();
        const out = require('fs').openSync(logFile, 'a');
        const err = require('fs').openSync(logFile, 'a');
        const child = spawn(process.execPath, [
            '--import', 'tsx',
            join(import.meta.dirname, '../daemon/index.ts')
        ], {
            detached: true,
            stdio: ['ignore', out, err],
            env: { ...process.env, BSV_P2P_PORT: options.port }
        });
        child.unref();
        // Wait a bit to see if it started
        await new Promise(resolve => setTimeout(resolve, 2000));
        const newStatus = isDaemonRunning();
        if (newStatus.running) {
            console.log(chalk.green(`Daemon started (PID: ${newStatus.pid})`));
            console.log(chalk.gray(`Logs: ${logFile}`));
        }
        else {
            console.log(chalk.red('Failed to start daemon. Check logs:'));
            console.log(chalk.gray(`  tail -f ${logFile}`));
        }
    }
});
daemonCmd
    .command('stop')
    .description('Stop the P2P daemon')
    .action(() => {
    const status = isDaemonRunning();
    if (!status.running) {
        console.log(chalk.yellow('Daemon is not running'));
        return;
    }
    try {
        process.kill(status.pid, 'SIGTERM');
        console.log(chalk.green(`Daemon stopped (PID: ${status.pid})`));
    }
    catch (err) {
        console.log(chalk.red(`Failed to stop daemon: ${err}`));
    }
});
daemonCmd
    .command('status')
    .description('Check daemon status')
    .action(() => {
    const status = isDaemonRunning();
    console.log(chalk.bold('\n🔌 BSV P2P Daemon Status\n'));
    if (status.running) {
        console.log(`${chalk.green('●')} Running (PID: ${status.pid})`);
        console.log(`${chalk.gray('Data dir:')} ${getDataDir()}`);
        console.log(`${chalk.gray('Logs:')} ${getLogFile()}`);
    }
    else {
        console.log(`${chalk.red('○')} Not running`);
        console.log(chalk.gray('Start with: bsv-p2p daemon start'));
    }
    console.log();
});
daemonCmd
    .command('logs')
    .description('View daemon logs')
    .option('-f, --follow', 'Follow log output')
    .option('-n, --lines <n>', 'Number of lines to show', '50')
    .action((options) => {
    const logFile = getLogFile();
    if (!existsSync(logFile)) {
        console.log(chalk.yellow('No log file found'));
        return;
    }
    if (options.follow) {
        const tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' });
        tail.on('exit', () => process.exit(0));
    }
    else {
        try {
            execSync(`tail -n ${options.lines} "${logFile}"`, { stdio: 'inherit' });
        }
        catch {
            // tail returns non-zero if file is empty
        }
    }
});
// ============ PEERS COMMANDS ============
const peersCmd = program.command('peers')
    .description('Manage peer connections');
peersCmd
    .command('list')
    .description('List known peers')
    .action(() => {
    // TODO: Connect to daemon and get peer list
    console.log(chalk.yellow('Not yet implemented - daemon IPC required'));
});
peersCmd
    .command('connect <multiaddr>')
    .description('Connect to a peer')
    .action((multiaddr) => {
    console.log(chalk.yellow('Not yet implemented - daemon IPC required'));
});
// ============ CHANNELS COMMANDS ============
const channelsCmd = program.command('channels')
    .description('Manage payment channels');
channelsCmd
    .command('list')
    .description('List all payment channels')
    .action(() => {
    console.log(chalk.yellow('Not yet implemented'));
});
channelsCmd
    .command('open <peerId> <satoshis>')
    .description('Open a payment channel with a peer')
    .action((peerId, satoshis) => {
    console.log(chalk.yellow('Not yet implemented'));
});
channelsCmd
    .command('close <channelId>')
    .description('Close a payment channel')
    .action((channelId) => {
    console.log(chalk.yellow('Not yet implemented'));
});
// ============ CONFIG COMMAND ============
program
    .command('config')
    .description('View or update configuration')
    .option('--port <port>', 'Set daemon port')
    .option('--bsv-key <key>', 'Set BSV identity key')
    .action((options) => {
    const configFile = getConfigFile();
    let config = {};
    if (existsSync(configFile)) {
        config = JSON.parse(readFileSync(configFile, 'utf-8'));
    }
    let changed = false;
    if (options.port) {
        config.port = parseInt(options.port, 10);
        changed = true;
    }
    if (options.bsvKey) {
        config.bsvIdentityKey = options.bsvKey;
        changed = true;
    }
    if (changed) {
        writeFileSync(configFile, JSON.stringify(config, null, 2));
        console.log(chalk.green('Configuration updated'));
    }
    console.log(chalk.bold('\n⚙️  Configuration\n'));
    console.log(JSON.stringify(config, null, 2));
    console.log();
});
program.parse();
