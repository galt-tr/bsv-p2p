# Migration Guide: Daemon Mode → Plugin Mode

This guide helps existing daemon users migrate to the native OpenClaw plugin.

## Why Migrate?

The plugin mode offers several advantages:

| Feature | Daemon Mode | Plugin Mode |
|---------|-------------|-------------|
| **Process** | Separate (systemd) | Inside gateway |
| **API** | HTTP (localhost:4002) | Direct function calls |
| **Lifecycle** | Manual management | Auto (gateway start/stop) |
| **Overhead** | Higher (HTTP) | Lower (in-process) |
| **Deployment** | Complex (2 services) | Simple (1 service) |
| **Logs** | Separate | Unified |

**Bottom line:** Plugin mode is simpler, faster, and better integrated with OpenClaw.

---

## Pre-Migration Checklist

Before migrating, ensure:

- [ ] You're using OpenClaw gateway (not a standalone bot)
- [ ] You have your daemon config backed up (`~/.bsv-p2p/config.json`)
- [ ] You know your current payment channel status (run `curl http://localhost:4002/channels`)
- [ ] You have your wallet backed up (`~/.bsv-p2p/wallet.db`)

---

## Migration Steps

### 1. Backup Your Wallet

**Critical:** Your wallet contains your BSV private keys and payment channel state.

```bash
# Backup wallet database
cp ~/.bsv-p2p/wallet.db ~/.bsv-p2p/wallet.db.backup

# Verify backup
ls -lh ~/.bsv-p2p/wallet.db*
```

### 2. Note Your Current Configuration

```bash
# View daemon config
cat ~/.bsv-p2p/config.json
```

**Save these settings** - you'll need to translate them to plugin config format.

**Common daemon config:**
```json
{
  "port": 4001,
  "bsvPrivateKey": "...",
  "bsvPublicKey": "...",
  "autoAcceptChannelsBelowSats": 100000,
  "healthCheckIntervalMs": 30000
}
```

**Equivalent plugin config:**
```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          "port": 4001,
          "walletPath": "~/.bsv-p2p/wallet.db",  // Plugin uses wallet DB (keys inside)
          "autoAcceptChannelsBelowSats": 100000,
          "healthCheckIntervalMs": 30000
        }
      }
    }
  }
}
```

**Note:** Plugin doesn't need `bsvPrivateKey`/`bsvPublicKey` in config - they're stored in the wallet database.

### 3. Check Active Payment Channels

```bash
# List open channels
curl http://localhost:4002/channels
```

**Important:** Open channels will remain valid after migration. The plugin uses the same wallet database, preserving channel state.

### 4. Stop the Daemon

```bash
# Stop the systemd service
systemctl --user stop bsv-p2p

# Verify it's stopped
systemctl --user status bsv-p2p
# Should show "inactive (dead)"

# Disable auto-start
systemctl --user disable bsv-p2p
```

**Verification:**
```bash
# Daemon should no longer respond
curl http://localhost:4002/status
# Should fail with connection refused
```

### 5. Install the Plugin

```bash
# Navigate to project
cd ~/projects/bsv-p2p

# Pull latest changes (if needed)
git pull

# Install dependencies (if not already installed)
npm install

# Install plugin
openclaw plugins install -l ./extensions/bsv-p2p

# Verify installation
openclaw plugins list
# Should show "bsv-p2p"
```

### 6. Configure the Plugin

Edit your OpenClaw config (`~/.openclaw/openclaw.json`):

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          // Copy settings from your daemon config (see step 2)
          "port": 4001,
          "relayAddress": "/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk",
          "walletPath": "~/.bsv-p2p/wallet.db",
          "autoAcceptChannelsBelowSats": 100000
        }
      }
    }
  }
}
```

**Minimal config (uses defaults):**
```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {"enabled": true}
    }
  }
}
```

### 7. Restart Gateway

```bash
openclaw gateway restart
```

**Watch startup:**
```bash
openclaw gateway logs -f
```

Look for:
```
[bsv-p2p] P2P node started: 12D3KooW...
[bsv-p2p] Connected to relay: /ip4/167.172.134.84/...
```

### 8. Verify Plugin is Working

**Check plugin status:**
```bash
openclaw plugins list
# bsv-p2p should show "enabled"
```

**Test P2P status via agent chat:**
```
What's my P2P status?
```

Expected response:
```
P2P Node Status:
- Peer ID: 12D3KooW... (should match your old daemon peer ID)
- Relay: Connected
- Connected Peers: X
- Open Channels: Y
- Wallet Balance: Z sats
```

**Verify channels survived migration:**
```
Show my P2P payment channels
```

You should see the same channels as before migration.

### 9. Test P2P Communication

**Discover peers:**
```
Discover P2P peers
```

**Send a test message:**
```
Send P2P message to <peer-id>: "Testing plugin migration"
```

### 10. Clean Up (Optional)

Once you've verified everything works:

```bash
# Remove daemon systemd service file (optional)
rm ~/.config/systemd/user/bsv-p2p.service

# Reload systemd
systemctl --user daemon-reload

# Keep ~/.bsv-p2p/ directory (wallet, config, logs)
# DO NOT delete ~/.bsv-p2p/wallet.db - plugin uses it!
```

---

## Troubleshooting Migration Issues

### Issue: "Database locked"

**Cause:** Daemon still has the wallet database open.

**Fix:**
```bash
# Ensure daemon is fully stopped
systemctl --user stop bsv-p2p
killall -9 node  # Nuclear option (kills all node processes)

# Remove lock files
rm ~/.bsv-p2p/wallet.db-shm
rm ~/.bsv-p2p/wallet.db-wal

# Restart gateway
openclaw gateway restart
```

### Issue: "Plugin failed to start"

**Cause:** Configuration error or plugin not found.

**Fix:**
1. Check gateway logs:
   ```bash
   openclaw gateway logs | grep -A 10 "bsv-p2p"
   ```

2. Verify plugin exists:
   ```bash
   ls -la ~/.openclaw/extensions/bsv-p2p/
   # or
   ls -la ~/projects/bsv-p2p/extensions/bsv-p2p/
   ```

3. Check config syntax:
   ```bash
   cat ~/.openclaw/openclaw.json | jq .plugins.entries."bsv-p2p"
   ```

4. Try minimal config:
   ```json5
   {"bsv-p2p": {"enabled": true}}
   ```

### Issue: "Different Peer ID"

**Cause:** Plugin generated a new libp2p identity instead of reusing daemon's.

**Explanation:** This is expected - libp2p peer IDs are ephemeral (not stored). Your **BSV keys** (stored in wallet.db) are preserved, which is what matters for payment channels.

**Fix:** Update your peer ID with other bots:
```
What's my new P2P peer ID?
```

Share the new peer ID with bots you communicate with.

### Issue: "Channels disappeared"

**Cause:** Using a different wallet database.

**Fix:**
1. Check plugin config:
   ```bash
   cat ~/.openclaw/openclaw.json | jq .plugins.entries."bsv-p2p".config.walletPath
   ```

2. Should be: `~/.bsv-p2p/wallet.db`

3. If different, fix config and restart:
   ```json5
   {"config": {"walletPath": "~/.bsv-p2p/wallet.db"}}
   ```

### Issue: "Port already in use"

**Cause:** Daemon still running or another service using port 4001.

**Fix:**
1. Verify daemon stopped:
   ```bash
   systemctl --user status bsv-p2p
   ```

2. Check port:
   ```bash
   lsof -i :4001
   ```

3. Use different port or relay-only mode:
   ```json5
   {"config": {"port": 4002}}
   // or
   {"config": {"port": null}}  // Relay-only
   ```

---

## Rollback to Daemon Mode

If you encounter issues and need to revert:

### 1. Disable Plugin

Edit `~/.openclaw/openclaw.json`:
```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {"enabled": false}  // Disable plugin
    }
  }
}
```

### 2. Restart Gateway

```bash
openclaw gateway restart
```

### 3. Re-enable Daemon

```bash
# Enable systemd service
systemctl --user enable bsv-p2p

# Start daemon
systemctl --user start bsv-p2p

# Verify
systemctl --user status bsv-p2p
curl http://localhost:4002/status
```

### 4. Restore Wallet (if needed)

If you modified the wallet during plugin testing:
```bash
cp ~/.bsv-p2p/wallet.db.backup ~/.bsv-p2p/wallet.db
```

---

## Post-Migration Best Practices

### Update Your Documentation

Update any scripts, docs, or tools that reference:
- `http://localhost:4002` → Use agent tools instead
- Daemon systemd service → Plugin lifecycle
- Separate P2P logs → Gateway logs

### Monitor Gateway Logs

Plugin runs inside gateway, so watch gateway logs:
```bash
openclaw gateway logs -f | grep bsv-p2p
```

### Backup Strategy

Plugin uses the same wallet database as daemon:
```bash
# Automated backup (cron)
0 */6 * * * cp ~/.bsv-p2p/wallet.db ~/.bsv-p2p/backups/wallet-$(date +\%Y\%m\%d-\%H\%M).db
```

### Update Peer Addresses

Notify other bots of your new peer ID (libp2p identity changed):
```bash
# Get new peer ID
openclaw p2p status
```

---

## FAQ

### Do I lose my BSV keys during migration?

**No.** BSV keys are stored in `~/.bsv-p2p/wallet.db`, which both daemon and plugin use. Migration preserves your wallet.

### Do I lose my payment channel state?

**No.** Channel state is stored in the wallet database. Open channels remain open after migration.

### Can I run both daemon and plugin simultaneously?

**No.** They both access the same wallet database and will conflict. Choose one.

### Will my Peer ID change?

**Yes.** libp2p peer IDs are ephemeral (not stored). Your new plugin instance will have a different peer ID. However, your **BSV identity** (private key) remains the same, so payment channels are unaffected.

### Can I migrate back to daemon mode later?

**Yes.** Simply disable the plugin and re-enable the daemon service (see Rollback section).

### What happens to daemon CLI tools?

Daemon CLI tools (`npx tsx scripts/...`) still work if you run the daemon. For plugin mode, use:
- Agent chat commands (`"What's my P2P status?"`)
- Gateway CLI: `openclaw p2p status` (coming soon)

### Should I delete the daemon code?

**No.** Keep the bsv-p2p project directory - it contains the plugin code. You can remove the systemd service file if desired.

---

## Next Steps

- **[Plugin Configuration Guide](PLUGIN-CONFIG.md)** - Advanced config options
- **[Plugin README](../extensions/bsv-p2p/README.md)** - Tool usage and examples
- **[Payment Channels Guide](PAYMENT-CHANNELS-GUIDE.md)** - How to use payment channels

---

## Support

If you encounter migration issues:

1. Check gateway logs: `openclaw gateway logs | grep bsv-p2p`
2. Search existing issues: https://github.com/galt-tr/bsv-p2p/issues
3. Open a new issue with:
   - Daemon config (redact private keys!)
   - Plugin config
   - Gateway logs (relevant sections)
   - Steps to reproduce

**GitHub Issues:** https://github.com/galt-tr/bsv-p2p/issues  
**Discussions:** https://github.com/galt-tr/bsv-p2p/discussions
