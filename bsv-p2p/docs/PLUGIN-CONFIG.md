# BSV P2P Plugin Configuration Reference

This document describes all configuration options for the BSV P2P OpenClaw plugin.

## Configuration Location

Plugin configuration is stored in your OpenClaw config file (`~/.openclaw/openclaw.json` by default):

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          // Plugin-specific settings here
        }
      }
    }
  }
}
```

## Configuration Schema

### `enabled` (boolean, required)

Enable or disable the plugin.

- **Default:** `false`
- **Example:** `true`

```json5
{
  "bsv-p2p": {
    "enabled": true
  }
}
```

When `enabled: false`, the plugin is installed but not loaded. Use this to temporarily disable P2P functionality without uninstalling.

---

### `config.port` (number, optional)

Local TCP port for libp2p to listen on.

- **Default:** `4001`
- **Range:** 1024-65535 (ports below 1024 require root)
- **Example:** `4002`

```json5
{
  "config": {
    "port": 4002
  }
}
```

**Use cases:**
- **`4001`** (default): Standard P2P port
- **`null`**: Relay-only mode (no direct listening, only relay connections)
- **Custom port**: If 4001 is already in use

**Note:** If you're behind NAT/firewall, direct connections won't work anyway. Consider relay-only mode (`port: null`).

---

### `config.relayAddress` (string, optional)

Circuit relay server address for NAT traversal.

- **Default:** `/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk`
- **Format:** libp2p multiaddr
- **Example:** `/ip4/YOUR_RELAY_IP/tcp/4001/p2p/YOUR_RELAY_PEER_ID`

```json5
{
  "config": {
    "relayAddress": "/ip4/203.0.113.42/tcp/4001/p2p/12D3KooWCustomRelay..."
  }
}
```

**Use cases:**
- **Default relay:** Use the public relay server (recommended for most users)
- **Private relay:** Run your own relay server for better privacy/control
- **No relay:** Set to `null` if you only want direct connections (not recommended)

See [NAT Traversal Guide](./NAT-TRAVERSAL.md) for details on how relay connections work.

---

### `config.walletPath` (string, optional)

Path to the SQLite wallet database.

- **Default:** `~/.bsv-p2p/wallet.db`
- **Example:** `~/.bsv-p2p/wallet-testnet.db`

```json5
{
  "config": {
    "walletPath": "~/.bsv-p2p/wallet-mainnet.db"
  }
}
```

**Use cases:**
- **Default path:** Use the same wallet as the standalone daemon (migration)
- **Separate wallet:** Use a different wallet for the plugin vs daemon
- **Network-specific:** `wallet-testnet.db`, `wallet-mainnet.db`, `wallet-regtest.db`

**Security note:** The wallet database contains your BSV private keys. Keep it secure and backed up.

---

### `config.autoAcceptChannelsBelowSats` (number, optional)

Automatically accept incoming payment channel requests below this amount.

- **Default:** `10000` (10k satoshis)
- **Range:** 0 to any positive integer
- **Example:** `100000` (100k sats)

```json5
{
  "config": {
    "autoAcceptChannelsBelowSats": 50000
  }
}
```

**How it works:**
- When another peer requests to open a channel with you, the plugin automatically accepts if their proposed capacity is ≤ this value
- Channels above this threshold require manual approval
- Set to `0` to require manual approval for all channels

**Use cases:**
- **Small services:** `10000` (10k sats ~= $1 at $10k/BSV) for low-risk services
- **High-value services:** `1000000` (1M sats) if you trust your peers
- **Manual approval:** `0` if you want to review every channel request

---

### `config.bootstrapPeers` (array of strings, optional)

List of peer multiaddrs to connect to on startup.

- **Default:** `[]` (empty, only use relay discovery)
- **Format:** Array of libp2p multiaddrs
- **Example:**

```json5
{
  "config": {
    "bootstrapPeers": [
      "/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWPeer1.../p2p-circuit/p2p/12D3KooWPeer2...",
      "/dns4/relay.example.com/tcp/4001/p2p/12D3KooWPeer3..."
    ]
  }
}
```

**Use cases:**
- **Known peers:** Connect to specific bots on startup
- **Private network:** Only connect to trusted peers
- **Testing:** Connect to test peers for development

**Note:** With the default relay, you don't need bootstrap peers. Other bots will discover you automatically via the relay.

---

### `config.healthCheckIntervalMs` (number, optional)

Interval for internal health checks and connection maintenance.

- **Default:** `30000` (30 seconds)
- **Range:** 5000-300000 (5 seconds to 5 minutes)
- **Example:** `60000` (1 minute)

```json5
{
  "config": {
    "healthCheckIntervalMs": 60000
  }
}
```

**What it checks:**
- Relay connection status
- Peer connection health
- Payment channel states
- Wallet database accessibility

**Use cases:**
- **Default:** `30000` (good balance)
- **Resource-constrained:** `60000` or higher to reduce overhead
- **High-reliability:** `10000` for faster failure detection

---

### `config.enableMdns` (boolean, optional)

Enable mDNS for local peer discovery.

- **Default:** `false`
- **Example:** `true`

```json5
{
  "config": {
    "enableMdns": true
  }
}
```

**How it works:**
- mDNS broadcasts your peer ID on the local network
- Other peers on the same LAN can discover you without a relay

**Use cases:**
- **Local development:** Multiple bots on the same machine/network
- **Private network:** Bots within a corporate LAN
- **Production:** Usually `false` (rely on relay for WAN connectivity)

---

### `config.announceAddrs` (array of strings, optional)

Addresses to announce to other peers (overrides auto-detected addresses).

- **Default:** `[]` (auto-detect)
- **Format:** Array of libp2p multiaddrs
- **Example:**

```json5
{
  "config": {
    "announceAddrs": [
      "/ip4/203.0.113.42/tcp/4001",
      "/ip6/2001:db8::1/tcp/4001"
    ]
  }
}
```

**Use cases:**
- **Public IP:** Announce your public IP if behind NAT with port forwarding
- **Custom domain:** Announce DNS-based address
- **Testing:** Override auto-detection for specific scenarios

**Note:** Most users don't need this. Relay connections work without manual address announcement.

---

## Example Configurations

### Minimal (Recommended for Most Users)

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true
      }
    }
  }
}
```

Uses all defaults: relay-based connectivity, auto-accept small channels, standard ports.

---

### Relay-Only Mode (Behind NAT)

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          "port": null,  // No direct listening
          "relayAddress": "/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk"
        }
      }
    }
  }
}
```

**Best for:** Bots behind NAT/firewall with no port forwarding.

---

### High-Security Mode

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          "autoAcceptChannelsBelowSats": 0,  // Manual approval only
          "bootstrapPeers": [
            // Only connect to trusted peers
            "/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWTrustedPeer..."
          ],
          "walletPath": "~/.bsv-p2p/wallet-mainnet.db"
        }
      }
    }
  }
}
```

**Best for:** Production deployments handling real funds.

---

### Local Development (Multiple Bots on Same Machine)

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          "port": 4001,  // Bot 1
          // Bot 2 uses port 4002, etc.
          "walletPath": "~/.bsv-p2p/wallet-bot1.db",
          "enableMdns": true
        }
      }
    }
  }
}
```

**Best for:** Testing multi-bot interactions locally.

**Note:** Each bot needs a unique port and wallet path.

---

### Testnet Configuration

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          "walletPath": "~/.bsv-p2p/wallet-testnet.db",
          "relayAddress": "/ip4/YOUR_TESTNET_RELAY/tcp/4001/p2p/...",
          "autoAcceptChannelsBelowSats": 1000000  // Higher threshold on testnet
        }
      }
    }
  }
}
```

**Best for:** Testing with testnet BSV (no real money at risk).

---

### Custom Relay Server

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          "relayAddress": "/ip4/YOUR_SERVER_IP/tcp/4001/p2p/YOUR_RELAY_PEER_ID"
        }
      }
    }
  }
}
```

**Best for:** Private P2P networks, corporate deployments.

See [NAT Traversal Guide](./NAT-TRAVERSAL.md) for relay server setup.

---

## Security Recommendations

### 1. Wallet Security

- **Backup your wallet:** `~/.bsv-p2p/wallet.db` contains your private keys
- **Restrict permissions:**
  ```bash
  chmod 600 ~/.bsv-p2p/wallet.db
  ```
- **Separate wallets:** Use different wallets for testnet vs mainnet
- **Key rotation:** Task #100 will add OS keychain integration

### 2. Network Security

- **Firewall:** Only open port 4001 if you need direct connections
- **Private relay:** Run your own relay for sensitive deployments
- **Channel limits:** Set `autoAcceptChannelsBelowSats` conservatively

### 3. Testing Before Production

- **Start with testnet:** Test with testnet BSV first
- **Small channels:** Keep channel capacities low until proven
- **Monitor logs:** Watch for suspicious activity in gateway logs

---

## Troubleshooting Config Issues

### Invalid JSON Syntax

**Symptom:** Gateway fails to start, shows JSON parse error

**Solution:** Validate your JSON:
```bash
cat ~/.openclaw/openclaw.json | jq .
```

Fix any syntax errors (missing commas, quotes, brackets).

---

### Config Not Applied

**Symptom:** Changes to config don't take effect

**Solution:**
1. Restart gateway:
   ```bash
   openclaw gateway restart
   ```

2. Verify config is correct:
   ```bash
   cat ~/.openclaw/openclaw.json | jq .plugins.entries."bsv-p2p"
   ```

3. Check gateway logs for config errors:
   ```bash
   openclaw gateway logs | grep -i config
   ```

---

### Port Already in Use

**Symptom:** P2P node fails to start, logs show "EADDRINUSE"

**Solution:**
1. Change port:
   ```json5
   {"config": {"port": 4002}}
   ```

2. Or use relay-only mode:
   ```json5
   {"config": {"port": null}}
   ```

---

### Wallet Database Locked

**Symptom:** Logs show "database is locked"

**Solution:**
1. Stop any running daemon:
   ```bash
   systemctl --user stop bsv-p2p
   ```

2. Use a different wallet path:
   ```json5
   {"config": {"walletPath": "~/.bsv-p2p/wallet-plugin.db"}}
   ```

---

## Next Steps

- **[Installation Guide](./PLUGIN-INSTALL.md)** - How to install the plugin
- **[Payment Channels Guide](./PAYMENT-CHANNELS-GUIDE.md)** - Using payment channels
- **[NAT Traversal](./NAT-TRAVERSAL.md)** - Understanding relay connections
- **[Plugin README](../extensions/bsv-p2p/README.md)** - Plugin architecture

## Support

- **Issues:** https://github.com/galt-tr/bsv-p2p/issues
- **Config examples:** `examples/plugin-configs/`
- **OpenClaw docs:** https://openclaw.com/docs/plugins
