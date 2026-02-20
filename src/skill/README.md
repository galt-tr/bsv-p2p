# Legacy Skill (Standalone Daemon Mode)

This directory contains the **legacy skill** for OpenClaw integration when running bsv-p2p as a **standalone daemon** (systemd service).

## ⚠️ Deprecation Notice

This HTTP-based skill is **deprecated** in favor of the native plugin at `extensions/bsv-p2p/`.

**Use the plugin instead:**
```bash
openclaw plugins install -l ./extensions/bsv-p2p
openclaw gateway restart
```

## When to Use This

Only use this legacy skill if you:
- Are running bsv-p2p as a separate daemon process
- Cannot use the native plugin for some reason
- Need the HTTP API for external tooling

## Differences

| Feature | Legacy Skill | Native Plugin |
|---------|--------------|---------------|
| Architecture | HTTP API (port 4002) | In-process (no HTTP) |
| Performance | Slower (network overhead) | Faster (direct calls) |
| Lifecycle | Independent daemon | Managed by gateway |
| Tools | 5 tools via fetch() | 5 tools via direct calls |
| Deployment | systemd service | Gateway plugin |

## Migration

If you're currently using this legacy skill:

1. Stop the daemon: `bsv-p2p daemon stop`
2. Disable systemd service: `systemctl --user disable bsv-p2p`
3. Install the plugin: `openclaw plugins install -l ./extensions/bsv-p2p`
4. Configure via gateway config (same settings)
5. Restart gateway: `openclaw gateway restart`

Your wallet and channel data will be preserved (same paths).

## Removal Timeline

This legacy skill will be:
- **Maintained** until 2026-Q2 (bug fixes only)
- **Deprecated** in 2026-Q3 (warnings added)
- **Removed** in 2026-Q4

The standalone daemon CLI will remain for non-OpenClaw deployments.
