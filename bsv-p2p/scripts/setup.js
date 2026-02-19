#!/usr/bin/env node
/**
 * BSV P2P Setup Script
 * Cross-platform Node.js setup for bsv-p2p
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(color, symbol, message) {
  console.log(`${color}${symbol}${colors.reset} ${message}`);
}

function header() {
  console.log(colors.blue);
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   BSV P2P Payment Channels - Setup        ║');
  console.log('║   One-command setup for OpenClaw bots     ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(colors.reset);
}

function checkNodeVersion() {
  log(colors.blue, '→', 'Checking Node.js version...');
  const version = process.version.slice(1).split('.')[0];
  if (parseInt(version) < 20) {
    log(colors.red, '✗', `Node.js ${version} detected. Version >= 20 required.`);
    process.exit(1);
  }
  log(colors.green, '✓', `Node.js ${process.version} found`);
}

function installDependencies() {
  log(colors.blue, '→', 'Installing dependencies...');
  try {
    execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
    log(colors.green, '✓', 'Dependencies installed');
  } catch (error) {
    log(colors.red, '✗', 'Failed to install dependencies');
    process.exit(1);
  }
}

function buildProject() {
  log(colors.blue, '→', 'Building project...');
  try {
    execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
    log(colors.green, '✓', 'Project built successfully');
  } catch (error) {
    log(colors.red, '✗', 'Build failed');
    process.exit(1);
  }
}

async function initializeIdentity() {
  log(colors.blue, '→', 'Initializing BSV identity...');
  
  const bsvDir = path.join(process.env.HOME || process.env.USERPROFILE, '.bsv-p2p');
  const peerIdPath = path.join(bsvDir, 'peer-id.json');
  
  if (fs.existsSync(peerIdPath)) {
    log(colors.yellow, '⚠', `BSV identity already exists at ${bsvDir}`);
    log(colors.green, '✓', 'Using existing identity');
    return;
  }
  
  // Create directory
  fs.mkdirSync(bsvDir, { recursive: true });
  
  // Generate identity (would need actual implementation with libp2p and @bsv/sdk)
  log(colors.yellow, 'ℹ', 'Identity generation requires libp2p and BSV SDK');
  log(colors.yellow, 'ℹ', 'Run: node scripts/init-identity.js (to be implemented)');
}

function checkOpenClaw() {
  log(colors.blue, '→', 'Checking OpenClaw integration...');
  
  const openclawConfig = path.join(
    process.env.HOME || process.env.USERPROFILE,
    '.openclaw',
    'config.json'
  );
  
  if (fs.existsSync(openclawConfig)) {
    log(colors.green, '✓', 'OpenClaw detected');
    log(colors.yellow, '⚠', 'Manual gateway configuration needed (add bsv-p2p to hooks)');
  } else {
    log(colors.yellow, '⚠', 'OpenClaw not detected (optional)');
  }
}

function summary() {
  console.log('');
  console.log(colors.green + '╔════════════════════════════════════════════╗' + colors.reset);
  console.log(colors.green + '║         Setup Complete!                    ║' + colors.reset);
  console.log(colors.green + '╚════════════════════════════════════════════╝' + colors.reset);
  console.log('');
  console.log(colors.blue + 'Next steps:' + colors.reset);
  console.log(`  1. Start the daemon:    ${colors.green}npm run daemon${colors.reset}`);
  console.log(`  2. Test CLI:            ${colors.green}npm run cli -- --help${colors.reset}`);
  console.log(`  3. View your peer ID:   ${colors.green}cat ~/.bsv-p2p/peer-id.json${colors.reset}`);
  console.log('');
  console.log(colors.blue + 'Documentation:' + colors.reset);
  console.log('  • README.md     - Getting started guide');
  console.log('  • SKILL.md      - OpenClaw skill integration');
  console.log('  • docs/         - Full documentation');
  console.log('');
  console.log(colors.yellow + 'Note:' + colors.reset + ' For OpenClaw integration, add \'bsv-p2p\' to your gateway hooks.');
  console.log('');
}

// Main execution
async function main() {
  try {
    header();
    checkNodeVersion();
    installDependencies();
    buildProject();
    await initializeIdentity();
    checkOpenClaw();
    summary();
  } catch (error) {
    console.error(colors.red + 'Setup failed:' + colors.reset, error.message);
    process.exit(1);
  }
}

main();
