# BSV P2P Operator Guide

This guide is for operators who want to run their own relay servers, monitor network health, and manage production deployments of BSV P2P infrastructure.

## Table of Contents

1. [Overview](#overview)
2. [Running Your Own Relay Server](#running-your-own-relay-server)
3. [Monitoring and Health Checks](#monitoring-and-health-checks)
4. [Backup and Recovery](#backup-and-recovery)
5. [Security Hardening](#security-hardening)
6. [Production Deployment](#production-deployment)
7. [Troubleshooting](#troubleshooting)

---

## Overview

**When to run your own infrastructure:**

✅ **Private P2P network** - Corporate/internal bot network  
✅ **High reliability** - SLA requirements, no third-party dependencies  
✅ **Custom relay logic** - Special routing, access controls, monitoring  
✅ **Regulatory compliance** - Data sovereignty, audit requirements

**Default setup (no infrastructure needed):**

For most users, the public relay server is sufficient:
- Address: `/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk`
- No cost, no setup
- NAT traversal for all peers

---

## Running Your Own Relay Server

### Prerequisites

- Linux server with public IP
- Node.js v22+
- Open ports: 4001 (TCP), 4002 (WebSocket, optional)
- 1GB RAM minimum, 2GB+ recommended

### Installation

```bash
# Clone the repository
git clone https://github.com/galt-tr/bsv-p2p.git
cd bsv-p2p

# Install dependencies
npm install

# Build
npm run build
```

### Configuration

Create `~/.bsv-p2p/relay-config.json`:

```json
{
  "mode": "relay",
  "listen": [
    "/ip4/0.0.0.0/tcp/4001",
    "/ip4/0.0.0.0/tcp/4002/ws"
  ],
  "announce": [
    "/ip4/YOUR_PUBLIC_IP/tcp/4001",
    "/dns4/relay.yourdomain.com/tcp/4001"
  ],
  "relay": {
    "enabled": true,
    "hop": {
      "enabled": true,
      "active": true
    },
    "advertise": {
      "enabled": true,
      "ttl": 30000
    },
    "reservations": {
      "max": 1000,
      "ttl": 3600000
    }
  },
  "connectionManager": {
    "maxConnections": 500,
    "minConnections": 10
  },
  "gossipSub": {
    "enabled": true,
    "topics": ["/openclaw/v1/announce"]
  }
}
```

### Start the Relay

**Development mode:**

```bash
node dist/relay/index.js --config ~/.bsv-p2p/relay-config.json
```

**Production (systemd):**

Create `/etc/systemd/system/bsv-p2p-relay.service`:

```ini
[Unit]
Description=BSV P2P Relay Server
After=network.target

[Service]
Type=simple
User=bsvrelay
WorkingDirectory=/opt/bsv-p2p
ExecStart=/usr/bin/node dist/relay/index.js --config /etc/bsv-p2p/relay-config.json
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/bsv-p2p

[Install]
WantedBy=multi-user.target
```

**Enable and start:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable bsv-p2p-relay
sudo systemctl start bsv-p2p-relay
sudo systemctl status bsv-p2p-relay
```

### Firewall Configuration

```bash
# Allow libp2p TCP
sudo firewall-cmd --permanent --add-port=4001/tcp

# Allow libp2p WebSocket (optional)
sudo firewall-cmd --permanent --add-port=4002/tcp

# Reload
sudo firewall-cmd --reload
```

**iptables:**

```bash
sudo iptables -A INPUT -p tcp --dport 4001 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 4002 -j ACCEPT
sudo iptables-save > /etc/iptables/rules.v4
```

### Verify Relay is Working

```bash
# Get your relay peer ID
curl http://localhost:4003/status  # Local admin port
# Returns: {"peerId": "12D3KooW...", "reservations": 0, "connections": 0}

# Test connection from another peer
node dist/cli/ping.js /ip4/YOUR_IP/tcp/4001/p2p/YOUR_RELAY_PEER_ID
```

### Configure Bots to Use Your Relay

Update bot configs to point to your relay:

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "config": {
          "relayAddress": "/ip4/YOUR_IP/tcp/4001/p2p/YOUR_RELAY_PEER_ID"
        }
      }
    }
  }
}
```

---

## Monitoring and Health Checks

### Metrics to Monitor

1. **Relay reservation count** - Active peers using your relay
2. **Connection count** - Total connected peers
3. **Bandwidth usage** - Data relayed
4. **Error rate** - Connection failures, timeouts
5. **CPU/Memory** - Resource usage

### Health Check Script

Create `/opt/bsv-p2p/health-check.sh`:

```bash
#!/bin/bash

# Check relay is responding
STATUS=$(curl -s http://localhost:4003/status || echo "DOWN")

if [[ "$STATUS" == "DOWN" ]]; then
  echo "CRITICAL: Relay not responding"
  exit 2
fi

# Parse metrics
RESERVATIONS=$(echo "$STATUS" | jq -r '.reservations')
CONNECTIONS=$(echo "$STATUS" | jq -r '.connections')

if [[ "$CONNECTIONS" -lt 1 ]]; then
  echo "WARNING: No connections"
  exit 1
fi

echo "OK: $CONNECTIONS connections, $RESERVATIONS reservations"
exit 0
```

**Run periodically:**

```bash
# Add to cron (every 5 minutes)
*/5 * * * * /opt/bsv-p2p/health-check.sh >> /var/log/bsv-p2p/health.log 2>&1
```

### Prometheus Integration

Export metrics for Prometheus:

```javascript
// src/relay/metrics.ts
import promClient from 'prom-client';

const register = new promClient.Registry();

const reservations = new promClient.Gauge({
  name: 'bsv_p2p_reservations',
  help: 'Number of active relay reservations',
  registers: [register]
});

const connections = new promClient.Gauge({
  name: 'bsv_p2p_connections',
  help: 'Number of connected peers',
  registers: [register]
});

// Expose metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

**Grafana dashboard (example queries):**

```promql
# Active reservations
bsv_p2p_reservations

# Connection rate
rate(bsv_p2p_connections[5m])

# Error rate
rate(bsv_p2p_errors_total[5m])
```

### Log Aggregation

**Forward logs to centralized logging:**

```bash
# Syslog
sudo journalctl -u bsv-p2p-relay -f | nc syslog.example.com 514

# Or use Vector/Fluentd/Filebeat
```

**Log format (JSON):**

```json
{
  "timestamp": "2026-02-19T19:00:00Z",
  "level": "info",
  "event": "reservation_created",
  "peerId": "12D3KooW...",
  "ttl": 3600
}
```

---

## Backup and Recovery

### What to Backup

1. **Wallet database** (`~/.bsv-p2p/wallet.db`) - BSV keys and channel state
2. **Configuration** (`~/.bsv-p2p/config.json`) - Node settings
3. **Peer identity** (optional) - libp2p private key (ephemeral, can regenerate)

### Wallet Backup Strategy

**Automated backup (every 6 hours):**

```bash
#!/bin/bash
# /opt/bsv-p2p/backup-wallet.sh

WALLET_PATH=~/.bsv-p2p/wallet.db
BACKUP_DIR=~/.bsv-p2p/backups
DATE=$(date +%Y%m%d-%H%M%S)

# Create backup
cp "$WALLET_PATH" "$BACKUP_DIR/wallet-$DATE.db"

# Compress
gzip "$BACKUP_DIR/wallet-$DATE.db"

# Retain last 30 days
find "$BACKUP_DIR" -name "wallet-*.db.gz" -mtime +30 -delete

echo "Backup created: wallet-$DATE.db.gz"
```

**Add to cron:**

```bash
0 */6 * * * /opt/bsv-p2p/backup-wallet.sh
```

**Off-site backup:**

```bash
# Sync to S3
aws s3 sync ~/.bsv-p2p/backups/ s3://my-bucket/bsv-p2p-backups/

# Or rsync to remote server
rsync -avz ~/.bsv-p2p/backups/ backup-server:/backups/bsv-p2p/
```

### Wallet Recovery

**From backup:**

```bash
# Stop the node
systemctl --user stop bsv-p2p

# Restore wallet
cp ~/.bsv-p2p/backups/wallet-20260219-120000.db.gz /tmp/
gunzip /tmp/wallet-20260219-120000.db.gz
cp /tmp/wallet-20260219-120000.db ~/.bsv-p2p/wallet.db

# Verify integrity
sqlite3 ~/.bsv-p2p/wallet.db "PRAGMA integrity_check;"

# Restart
systemctl --user start bsv-p2p
```

### Disaster Recovery Plan

**Scenario: Server failure, need to restore on new machine**

1. **Install BSV P2P** on new server
2. **Restore wallet database** from backup
3. **Update relay address** in bot configs (if relay peer ID changed)
4. **Verify open channels** - Check channel state survived
5. **Test connectivity** - Ping from known peers

**RTO (Recovery Time Objective):** 15 minutes  
**RPO (Recovery Point Objective):** 6 hours (backup interval)

---

## Security Hardening

### Wallet Security

**1. Encrypt wallet at rest:**

```bash
# Create encrypted volume for wallet
sudo cryptsetup luksFormat /dev/sdb1
sudo cryptsetup open /dev/sdb1 bsv-wallet
sudo mkfs.ext4 /dev/mapper/bsv-wallet
sudo mount /dev/mapper/bsv-wallet /mnt/bsv-wallet

# Move wallet
mv ~/.bsv-p2p/wallet.db /mnt/bsv-wallet/
ln -s /mnt/bsv-wallet/wallet.db ~/.bsv-p2p/wallet.db
```

**2. Restrict file permissions:**

```bash
chmod 600 ~/.bsv-p2p/wallet.db
chown $(whoami):$(whoami) ~/.bsv-p2p/wallet.db
```

**3. Use OS keychain (Task #100):**

```json5
{
  "wallet": {
    "keyStorage": "keychain",  // vs "file"
    "keychain": {
      "service": "bsv-p2p",
      "account": "main-wallet"
    }
  }
}
```

### Network Security

**1. Rate limiting:**

```json
{
  "relay": {
    "rateLimit": {
      "connectionsPerMinute": 10,
      "reservationsPerHour": 5
    }
  }
}
```

**2. Access control:**

```json
{
  "relay": {
    "allowlist": [
      "12D3KooWTrustedPeer1...",
      "12D3KooWTrustedPeer2..."
    ],
    "blockTrustedlist": [
      "12D3KooWBannedPeer..."
    ]
  }
}
```

**3. DDoS protection:**

```bash
# iptables rate limiting
sudo iptables -A INPUT -p tcp --dport 4001 -m state --state NEW -m recent --set
sudo iptables -A INPUT -p tcp --dport 4001 -m state --state NEW -m recent --update --seconds 60 --hitcount 20 -j DROP
```

### Application Security

**1. Run as non-root user:**

```bash
# Create dedicated user
sudo useradd -r -s /bin/false bsvrelay

# Set ownership
sudo chown -R bsvrelay:bsvrelay /opt/bsv-p2p
sudo chown -R bsvrelay:bsvrelay /var/lib/bsv-p2p
```

**2. Chroot/container:**

```bash
# Docker deployment
docker run -d \
  --name bsv-p2p-relay \
  --restart unless-stopped \
  -p 4001:4001 \
  -v /etc/bsv-p2p:/config \
  -v /var/lib/bsv-p2p:/data \
  bsv-p2p:latest relay --config /config/relay.json
```

**3. Regular updates:**

```bash
# Automated security updates (Ubuntu)
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

---

## Production Deployment

### Architecture

**Single-region deployment:**

```
┌─────────────────────────────────┐
│  Load Balancer (optional)       │
│  relay.yourdomain.com           │
└────────┬────────────────────────┘
         │
    ┌────┴────┐
    │ Relay 1 │  (Primary)
    └─────────┘
```

**Multi-region deployment:**

```
┌─────────────┐     ┌─────────────┐
│  Relay US   │────▶│  Relay EU   │
│  (Primary)  │     │  (Secondary)│
└──────┬──────┘     └──────┬──────┘
       │                   │
       └───────┬───────────┘
               │
        ┌──────┴──────┐
        │  Relay Asia │
        │  (Tertiary) │
        └─────────────┘
```

### High Availability

**Relay redundancy:**

```json
{
  "bootstrapPeers": [
    "/dns4/relay1.example.com/tcp/4001/p2p/...",
    "/dns4/relay2.example.com/tcp/4001/p2p/...",
    "/dns4/relay3.example.com/tcp/4001/p2p/..."
  ]
}
```

Bots automatically failover to available relays.

**Health monitoring:**

```bash
# Healthcheck endpoint
curl https://relay.example.com/health
# {"status": "healthy", "uptime": 86400, "peers": 42}
```

### Capacity Planning

**Relay server sizing:**

| Peers | CPU | RAM | Bandwidth |
|-------|-----|-----|-----------|
| 10 | 1 core | 512MB | 10 Mbps |
| 100 | 2 cores | 2GB | 100 Mbps |
| 500 | 4 cores | 8GB | 500 Mbps |
| 1000+ | 8+ cores | 16GB+ | 1+ Gbps |

**Storage:**

- Minimal (ephemeral relay): 1GB
- With logs: 10GB per month
- With metrics: 50GB per month

---

## Troubleshooting

### Relay Not Accepting Connections

**Symptoms:**
- Peers can't acquire reservations
- `curl http://localhost:4003/status` shows 0 connections

**Diagnosis:**

```bash
# Check process is running
ps aux | grep node

# Check port is listening
sudo netstat -tlnp | grep 4001

# Check firewall
sudo iptables -L -n | grep 4001

# Check logs
sudo journalctl -u bsv-p2p-relay -n 100
```

**Fix:**
- Verify public IP in config matches actual IP
- Check firewall rules
- Verify ports not blocked by cloud provider (security groups, etc.)

### High Memory Usage

**Symptoms:**
- Relay using > 2GB RAM
- OOM killer terminating process

**Diagnosis:**

```bash
# Check current usage
ps aux | grep node | awk '{print $6}'  # RSS in KB

# Heap dump
node --heap-prof dist/relay/index.js

# Analyze
node --prof-process isolate-*.log
```

**Fix:**
- Reduce `maxConnections` in config
- Increase server RAM
- Enable heap snapshots for memory leak detection

### Connection Storms

**Symptoms:**
- Sudden spike in connections
- Relay becomes unresponsive

**Diagnosis:**

```bash
# Check connection rate
sudo journalctl -u bsv-p2p-relay --since "5 minutes ago" | grep "connection" | wc -l
```

**Fix:**
- Enable rate limiting (see Security Hardening)
- Block offending peers
- Scale horizontally (add more relays)

---

## Next Steps

- **[Bot Developer Guide](./BOT-DEVELOPER-GUIDE.md)** - Building services on P2P
- **[Plugin Installation](./PLUGIN-INSTALL.md)** - Setting up bots
- **[API Reference](./API.md)** - Complete API documentation

## Support

- **GitHub Issues:** https://github.com/galt-tr/bsv-p2p/issues
- **Operator Forum:** https://github.com/galt-tr/bsv-p2p/discussions/categories/operators
- **Security Issues:** security@example.com (private disclosure)
