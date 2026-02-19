/**
 * User-friendly error messages for common failures.
 * Every error includes: what happened, why, and what to do about it.
 */

export interface FriendlyError {
  code: string
  message: string
  cause?: string
  fix: string
  docs?: string
}

const errors: Record<string, (detail?: string) => FriendlyError> = {
  RELAY_CONNECTION_FAILED: (detail) => ({
    code: 'RELAY_CONNECTION_FAILED',
    message: 'Could not connect to the relay server.',
    cause: detail || 'The relay server at 167.172.134.84:4001 is unreachable.',
    fix: [
      'Check your internet connection',
      'Verify the relay server is reachable: ping 167.172.134.84',
      'Check if port 4001 is blocked by your firewall',
      'Try restarting the daemon',
    ].join('\n  • '),
    docs: 'docs/NAT-TRAVERSAL.md',
  }),

  RELAY_NO_RESERVATION: (detail) => ({
    code: 'RELAY_NO_RESERVATION',
    message: 'Connected to relay but could not get a reservation.',
    cause: detail || 'The relay may be at capacity or rejecting new reservations.',
    fix: [
      'Wait 30 seconds and the daemon will retry automatically',
      'Check relay server status',
      'If persistent, the relay may need to be restarted (contact admin)',
    ].join('\n  • '),
  }),

  RELAY_RECONNECTION_FAILED: (detail) => ({
    code: 'RELAY_RECONNECTION_FAILED',
    message: 'Lost connection to relay and could not reconnect.',
    cause: detail || 'Network interruption or relay server restart.',
    fix: [
      'The daemon will keep retrying automatically',
      'Check your network connection',
      'If this persists, restart the daemon: bsv-p2p daemon restart',
    ].join('\n  • '),
  }),

  PORT_IN_USE: (detail) => ({
    code: 'PORT_IN_USE',
    message: `Port ${detail || '4001'} is already in use.`,
    cause: 'Another process (possibly another daemon instance) is using this port.',
    fix: [
      `Find what's using the port: lsof -i :${detail || '4001'}`,
      'Stop the other process, or change the port in ~/.bsv-p2p/config.json',
      'Check if the daemon is already running: bsv-p2p daemon status',
    ].join('\n  • '),
  }),

  CONFIG_NOT_FOUND: () => ({
    code: 'CONFIG_NOT_FOUND',
    message: 'No configuration file found.',
    cause: 'The daemon has not been initialized yet.',
    fix: [
      'Run initialization: npx tsx scripts/init.ts',
      'Or create ~/.bsv-p2p/config.json manually (see docs/GETTING-STARTED.md)',
    ].join('\n  • '),
    docs: 'docs/GETTING-STARTED.md',
  }),

  CONFIG_INVALID: (detail) => ({
    code: 'CONFIG_INVALID',
    message: 'Configuration file is invalid.',
    cause: detail || 'The config file has missing or malformed fields.',
    fix: [
      'Check ~/.bsv-p2p/config.json for syntax errors',
      'Ensure bsvPrivateKey and bsvPublicKey are present',
      'Re-run initialization: npx tsx scripts/init.ts',
    ].join('\n  • '),
  }),

  PEER_NOT_FOUND: (detail) => ({
    code: 'PEER_NOT_FOUND',
    message: `Could not find or connect to peer ${detail ? detail.slice(0, 20) + '...' : '(unknown)'}.`,
    cause: 'The peer may be offline, or the Peer ID may be incorrect.',
    fix: [
      'Verify the Peer ID is correct',
      'Ensure the remote peer has their daemon running',
      'Both peers must be connected to the relay server',
      'Check your relay connection: bsv-p2p status',
    ].join('\n  • '),
  }),

  CHANNEL_REJECTED: (detail) => ({
    code: 'CHANNEL_REJECTED',
    message: 'The remote peer rejected your payment channel.',
    cause: detail || 'The channel capacity may exceed their auto-accept limit.',
    fix: [
      'Try a smaller channel capacity',
      'Contact the peer operator to increase their autoAcceptChannelsBelowSats',
      'The peer may have manual approval configured — wait for them to accept',
    ].join('\n  • '),
    docs: 'docs/PAYMENT-CHANNELS-GUIDE.md',
  }),

  INSUFFICIENT_FUNDS: (detail) => ({
    code: 'INSUFFICIENT_FUNDS',
    message: 'Not enough BSV to complete this transaction.',
    cause: detail || 'Your wallet balance is below the required amount.',
    fix: [
      'Check your balance: bsv-p2p status',
      'Fund your wallet with BSV',
      'If opening a channel, reduce the capacity amount',
    ].join('\n  • '),
  }),

  CHANNEL_NOT_FOUND: (detail) => ({
    code: 'CHANNEL_NOT_FOUND',
    message: `Payment channel ${detail || '(unknown)'} not found.`,
    cause: 'The channel ID may be incorrect or the channel was already closed.',
    fix: [
      'List your channels: bsv-p2p channels list',
      'Verify the channel ID',
      'The channel may have been closed by the remote peer',
    ].join('\n  • '),
  }),

  GATEWAY_NOT_CONFIGURED: () => ({
    code: 'GATEWAY_NOT_CONFIGURED',
    message: 'OpenClaw gateway integration is not configured.',
    cause: 'OPENCLAW_GATEWAY_URL or OPENCLAW_HOOKS_TOKEN environment variables are not set.',
    fix: [
      'Set OPENCLAW_GATEWAY_URL (usually http://127.0.0.1:18789)',
      'Set OPENCLAW_HOOKS_TOKEN (find in your openclaw config: hooks.token)',
      'Or pass them in ~/.bsv-p2p/config.json',
    ].join('\n  • '),
    docs: 'docs/GETTING-STARTED.md#openclaw-gateway-integration',
  }),

  GATEWAY_WAKE_FAILED: (detail) => ({
    code: 'GATEWAY_WAKE_FAILED',
    message: 'Failed to wake the OpenClaw agent.',
    cause: detail || 'The gateway may not be running or the token may be invalid.',
    fix: [
      'Check if the OpenClaw gateway is running: openclaw gateway status',
      'Verify your hooks token is correct',
      'Check gateway URL (default: http://127.0.0.1:18789)',
    ].join('\n  • '),
  }),
}

/**
 * Get a user-friendly error message for a known error code.
 */
export function friendlyError(code: string, detail?: string): FriendlyError {
  const factory = errors[code]
  if (!factory) {
    return {
      code: 'UNKNOWN_ERROR',
      message: detail || 'An unexpected error occurred.',
      fix: 'Check the daemon logs for details. If this persists, please report it at https://github.com/galt-tr/bsv-p2p/issues',
    }
  }
  return factory(detail)
}

/**
 * Format a FriendlyError for console output.
 */
export function formatError(err: FriendlyError): string {
  const lines = [
    `\n❌ ${err.message}`,
    ``,
    `  Why: ${err.cause || 'Unknown'}`,
    ``,
    `  Fix:`,
    `  • ${err.fix}`,
  ]
  if (err.docs) {
    lines.push(``, `  📖 See: ${err.docs}`)
  }
  lines.push(``)
  return lines.join('\n')
}
