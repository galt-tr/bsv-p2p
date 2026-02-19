# Native OpenClaw Plugin Integration Research

**Author:** Researcher Agent  
**Date:** 2026-02-19  
**Task:** #95 - P2P: Native OpenClaw plugin integration

## Executive Summary

The current BSV P2P implementation runs as a **separate daemon process** (systemd service) that OpenClaw agents interact with via HTTP API (port 4002). This research examines migrating to a **native plugin architecture** where the P2P node runs **inside the OpenClaw gateway process**, eliminating the separate daemon and HTTP overhead.

**Recommendation:** Implement native plugin integration in **Phase 1** (minimal viable plugin) while keeping the standalone daemon mode as a **fallback option** for non-OpenClaw deployments.

---

## 1. Current Architecture

### How It Works Now

```
┌─────────────────┐          HTTP           ┌─────────────────┐
│  OpenClaw Agent │ ──────────────────────> │  bsv-p2p daemon │
│   (Chat/Tools)  │      localhost:4002     │  (systemd svc)  │
└─────────────────┘                         └─────────────────┘
         │                                           │
         │                                           │
         v                                           v
  Tool calls via                              libp2p Network
  fetch() to daemon                           BSV Blockchain
```

**Components:**

- **Daemon:** `src/daemon/index.ts` - Runs Node.js HTTP server on port 4002
- **P2PNode:** `src/daemon/node.ts` - Manages libp2p connections, peers, relay
- **ChannelManager:** `src/channels/manager.ts` - Payment channel state machine
- **Wallet:** `src/wallet/index.ts` - BSV key management (SQLite)
- **Skill:** `src/skill/index.ts` - Registers 5 agent tools that curl the daemon

**Daemon Lifecycle:**

1. Installed via `bsv-p2p daemon start`
2. Runs as systemd user service (`~/.config/systemd/user/bsv-p2p.service`)
3. Auto-starts on boot
4. Listens on HTTP port 4002
5. Gateway integration: notifies OpenClaw of incoming P2P messages via `POST /hooks/wake`

**Agent Tools (5):**

- `p2p_discover` - Find peers and services
- `p2p_send` - Send direct message to peer
- `p2p_request` - Request paid service (partially implemented)
- `p2p_status` - Check daemon health
- `p2p_channels` - List payment channels

---

## 2. OpenClaw Plugin Architecture

### How Plugins Work

OpenClaw plugins are **TypeScript modules loaded in-process** via jiti. They run **inside the gateway** and share its lifecycle.

**Plugin Capabilities:**

1. **Agent Tools** - Register tools that agents can invoke (like `p2p_discover`)
2. **Gateway RPC Methods** - Expose internal API methods
3. **Background Services** - Long-running services (start/stop with gateway)
4. **CLI Commands** - Add custom `openclaw` subcommands
5. **Messaging Channels** - Register new chat surfaces (WhatsApp, Telegram, etc.)
6. **Provider Auth** - OAuth flows for model providers
7. **Hooks** - Event-driven automation bundled with the plugin

### Plugin Structure

```
my-plugin/
├── openclaw.plugin.json    # Manifest (required)
├── index.ts                # Main entry (exports register function or object)
├── README.md
└── (optional: skills/, hooks/, etc.)
```

**Minimal Plugin Example:**

```typescript
// index.ts
export default function register(api: OpenClawPluginApi) {
  // Register background service
  api.registerService({
    id: 'my-service',
    start: async () => {
      console.log('Service started');
    },
    stop: async () => {
      console.log('Service stopped');
    }
  });

  // Register agent tool
  api.registerTool({
    name: 'my_tool',
    description: 'Does something useful',
    parameters: { type: 'object', properties: { ... } },
    async execute(context, params) {
      return { content: [{ type: 'text', text: 'Result!' }] };
    }
  });
}
```

**Manifest (openclaw.plugin.json):**

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Short summary",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

### Plugin Lifecycle

1. **Discovery:** Gateway scans `~/.openclaw/extensions/`, bundled extensions, and `plugins.load.paths`
2. **Config Validation:** Validates plugin manifest + JSON schema **without executing code**
3. **Load:** Gateway loads plugin module via jiti (if enabled)
4. **Registration:** Plugin's `register()` function is called with `OpenClawPluginApi`
5. **Start:** Background services start with gateway
6. **Stop:** Services gracefully stop on gateway shutdown

**Config Location:**

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          // Plugin-specific config here
        }
      }
    }
  }
}
```

---

## 3. Migration Plan: Standalone Daemon → Native Plugin

### Phase 1: Minimal Viable Plugin (MVP)

**Goal:** Run P2PNode inside the gateway process.

**Changes Required:**

1. **Create plugin entry point:** `extensions/bsv-p2p/index.ts`

```typescript
import { P2PNode } from '../../src/daemon/node.js';
import { ChannelManager } from '../../src/channels/manager.js';
import { Wallet } from '../../src/wallet/index.js';

export default function register(api: OpenClawPluginApi) {
  let p2pNode: P2PNode | null = null;
  let channelManager: ChannelManager | null = null;
  let wallet: Wallet | null = null;

  // Background service: P2P node lifecycle
  api.registerService({
    id: 'bsv-p2p-node',
    async start() {
      const cfg = api.config.plugins?.entries?.['bsv-p2p']?.config || {};
      
      // Initialize wallet
      wallet = new Wallet(cfg.walletPath || '~/.bsv-p2p/wallet.db');
      
      // Initialize P2P node
      p2pNode = new P2PNode({
        port: cfg.port || 4001,
        bootstrapPeers: cfg.bootstrapPeers || [],
        wallet,
        ...cfg
      });
      
      // Initialize channel manager
      channelManager = new ChannelManager(wallet);
      p2pNode.registerChannelManager(channelManager);
      
      // Start listening
      await p2pNode.start();
      
      api.logger.info(`P2P node started: ${p2pNode.getPeerId()}`);
      
      // Handle incoming messages
      p2pNode.on('message', (msg) => {
        // TODO: Route to appropriate handler
        api.logger.debug('Received P2P message', msg);
      });
    },
    
    async stop() {
      if (p2pNode) {
        await p2pNode.stop();
        p2pNode = null;
      }
      if (channelManager) {
        await channelManager.shutdown();
        channelManager = null;
      }
      if (wallet) {
        wallet.close();
        wallet = null;
      }
      api.logger.info('P2P node stopped');
    }
  });

  // Agent tools (no HTTP, direct function calls)
  api.registerTool({
    name: 'p2p_discover',
    description: 'Discover available peers and services on the P2P network',
    parameters: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Optional: filter by service name'
        }
      }
    },
    async execute(context, params) {
      if (!p2pNode) {
        return { content: [{ type: 'text', text: 'P2P node not running' }], isError: true };
      }
      
      const peers = await p2pNode.discoverPeers(params.service);
      
      const peerList = peers.map(peer => {
        let info = `Peer: ${peer.peerId}`;
        if (peer.services?.length) {
          info += '\nServices:\n' + peer.services.map(s => 
            `  - ${s.name}: ${s.description} (${s.pricing?.baseSatoshis || 0} sats)`
          ).join('\n');
        }
        return info;
      }).join('\n\n');
      
      return {
        content: [{ type: 'text', text: `Found ${peers.length} peer(s):\n\n${peerList}` }]
      };
    }
  });

  // ... register other tools (p2p_send, p2p_request, p2p_channels, p2p_status)
}
```

2. **Create manifest:** `extensions/bsv-p2p/openclaw.plugin.json`

```json
{
  "id": "bsv-p2p",
  "name": "BSV P2P Payment Channels",
  "description": "Peer-to-peer payments and messaging using BSV and libp2p",
  "version": "1.0.0",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "port": { "type": "number", "default": 4001 },
      "bootstrapPeers": { "type": "array", "items": { "type": "string" } },
      "walletPath": { "type": "string" },
      "relayAddress": { "type": "string" },
      "autoAcceptChannelsBelowSats": { "type": "number" }
    }
  },
  "uiHints": {
    "port": { "label": "P2P Port", "placeholder": "4001" },
    "relayAddress": { "label": "Relay Server", "placeholder": "/ip4/.../p2p/..." },
    "walletPath": { "label": "Wallet Database Path", "placeholder": "~/.bsv-p2p/wallet.db" }
  }
}
```

3. **Install plugin:**

```bash
cd ~/projects/bsv-p2p
openclaw plugins install -l ./extensions/bsv-p2p
openclaw gateway restart
```

4. **Configure:**

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          "port": 4001,
          "relayAddress": "/ip4/167.172.134.84/tcp/4001/p2p/12D3KooWNhNQ9AhQSsg5SaXkDqC4SADDSPhgqEaFBFDZKakyBnkk",
          "bootstrapPeers": [],
          "autoAcceptChannelsBelowSats": 10000
        }
      }
    }
  }
}
```

**Benefits:**

- ✅ No separate daemon process (one less thing to manage)
- ✅ No HTTP overhead (direct function calls)
- ✅ Shares gateway lifecycle (starts/stops together)
- ✅ Unified logging
- ✅ Access to gateway hooks for incoming messages
- ✅ Simpler deployment

**Challenges:**

- ⚠️ libp2p runs in same process as gateway (memory/CPU shared)
- ⚠️ Crash in P2P node could crash gateway (requires robust error handling)
- ⚠️ Need to refactor daemon HTTP API handlers into plugin tools

---

### Phase 2: Advanced Integration

**Gateway Hooks for Incoming P2P Messages:**

Currently, the daemon notifies OpenClaw of incoming P2P messages via `POST /hooks/wake`. With native integration, we can **trigger hooks directly**.

**Implementation:**

```typescript
// In plugin service start()
p2pNode.on('message', async (msg) => {
  // Trigger gateway hook
  await api.hooks.trigger('p2p-message', {
    peerId: msg.from,
    message: msg.data,
    timestamp: Date.now()
  });
});

// In plugin hook handler (hooks/p2p-message/handler.ts)
export async function handler(event: HookEvent) {
  const { peerId, message } = event.data;
  
  // Route to appropriate agent session
  await api.sessions.send({
    sessionKey: 'agent-session-key',
    message: `P2P message from ${peerId}: ${message}`
  });
}
```

**CLI Integration:**

Plugins can register their own CLI commands:

```typescript
api.registerCli(({ program }) => {
  program
    .command('p2p')
    .description('Manage P2P network')
    .action(() => {
      // Show status
    });
    
  program
    .command('p2p peers')
    .description('List connected peers')
    .action(async () => {
      const status = await api.rpc.call('bsv-p2p.peers');
      console.log(status);
    });
}, { commands: ['p2p'] });
```

This replaces the separate `bsv-p2p` CLI with `openclaw p2p`.

---

## 4. Architectural Tradeoffs

### Option A: Native Plugin (Recommended)

**Pros:**

- ✅ Simpler architecture (no separate process)
- ✅ No HTTP overhead
- ✅ Unified lifecycle (starts/stops with gateway)
- ✅ Direct access to gateway hooks and sessions
- ✅ Easier debugging (one process, unified logs)
- ✅ Better resource sharing (memory, connections)

**Cons:**

- ⚠️ Gateway crash affects P2P node (and vice versa)
- ⚠️ Memory/CPU contention in same process
- ⚠️ Can't use P2P without OpenClaw gateway
- ⚠️ Harder to isolate P2P-specific issues

**Best For:** OpenClaw-first deployments where agents are the primary users.

---

### Option B: Standalone Daemon (Current)

**Pros:**

- ✅ Process isolation (crash safety)
- ✅ Works without OpenClaw
- ✅ Easier to profile/monitor separately
- ✅ Can run on different machine

**Cons:**

- ⚠️ Extra process to manage (systemd service)
- ⚠️ HTTP overhead on every tool call
- ⚠️ Two separate configs (daemon + skill)
- ⚠️ More complex deployment
- ⚠️ Gateway hooks require HTTP webhook

**Best For:** Non-OpenClaw bots, standalone P2P services, multi-machine deployments.

---

### Option C: Hybrid (Both Modes)

Keep both architectures and let users choose:

```json5
{
  "plugins": {
    "entries": {
      "bsv-p2p": {
        "enabled": true,
        "config": {
          "mode": "native",  // or "daemon"
          "daemonUrl": "http://localhost:4002"  // only for daemon mode
        }
      }
    }
  }
}
```

**Pros:**

- ✅ Best of both worlds
- ✅ Flexibility for different use cases
- ✅ Gradual migration path

**Cons:**

- ⚠️ More code to maintain (two code paths)
- ⚠️ More testing surface
- ⚠️ Potential config confusion

**Recommendation:** Start with **native plugin only** (Option A). If demand for standalone daemon persists, add hybrid mode later.

---

## 5. Implementation Checklist

### Phase 1: Native Plugin MVP

- [ ] Create `extensions/bsv-p2p/index.ts` with plugin register function
- [ ] Create `extensions/bsv-p2p/openclaw.plugin.json` manifest
- [ ] Refactor daemon HTTP handlers into plugin tools (no HTTP, direct calls)
- [ ] Register P2PNode as background service (start/stop with gateway)
- [ ] Register 5 agent tools: `p2p_discover`, `p2p_send`, `p2p_request`, `p2p_status`, `p2p_channels`
- [ ] Handle incoming P2P messages via gateway hook system
- [ ] Add error boundaries (prevent P2P crashes from killing gateway)
- [ ] Update `README.md` with plugin installation instructions
- [ ] Add plugin config examples to docs
- [ ] Test with multi-agent setup (2+ agents with payment channels)

### Phase 2: Advanced Features

- [ ] Register CLI commands (`openclaw p2p ...` instead of `bsv-p2p ...`)
- [ ] Add Gateway RPC methods (`api.rpc.call('bsv-p2p.peers')`)
- [ ] Implement hook handlers for incoming P2P events
- [ ] Add auto-reply commands (e.g., `/p2p status` without LLM)
- [ ] Support multiple P2P identities (one per agent session)
- [ ] Add plugin health checks (`openclaw plugins doctor`)
- [ ] Publish to npm as `@openclaw/bsv-p2p` (optional)

---

## 6. Security & Safety Considerations

### Process Isolation

**Risk:** Native plugin means P2P code runs in the same process as gateway. A bug in libp2p or payment channels could crash the entire gateway.

**Mitigation:**

1. **Error boundaries:** Wrap all P2P operations in try/catch
2. **Service restart:** If P2P service crashes, attempt auto-restart (max 3 retries)
3. **Health checks:** Periodically verify P2P node is responsive
4. **Resource limits:** Monitor memory/CPU usage, disable if exceeds threshold

```typescript
api.registerService({
  id: 'bsv-p2p-node',
  async start() {
    try {
      // ... P2P node setup
    } catch (err) {
      api.logger.error('P2P node failed to start', err);
      // Don't crash gateway
      throw err;  // Gateway will log but continue
    }
  }
});
```

### Private Key Management

**Current:** BSV private keys stored in plaintext at `~/.bsv-p2p/config.json`

**Plugin Integration:** Keys should remain in wallet DB (`~/.bsv-p2p/wallet.db`), not in OpenClaw config.

**Recommendation:** Task #100 (security audit) should implement OS keychain integration. This applies to both daemon and plugin modes.

### Network Exposure

**Risk:** libp2p opens TCP port 4001. Misconfiguration could expose node to internet.

**Mitigation:**

1. Default to relay-only mode (no direct listening port)
2. Document firewall rules clearly
3. Add config validation (reject unsafe port bindings)

---

## 7. Testing Strategy

### Unit Tests

- All existing tests should pass (no changes to core P2P logic)
- Add plugin-specific tests: `test/plugin/integration.test.ts`

### Integration Tests

1. **Gateway lifecycle:** Start/stop gateway, verify P2P node starts/stops
2. **Tool invocation:** Call `p2p_discover`, verify results without HTTP
3. **Cross-agent messaging:** Agent A sends message to Agent B via `p2p_send`
4. **Payment channel flow:** Open channel, send payment, close channel (all via tools)
5. **Error handling:** Crash P2P node, verify gateway stays alive

### E2E Test

Replicate the existing E2E test (task #19: paid poem generation) but using plugin tools instead of HTTP API.

---

## 8. Migration Path for Existing Users

**For users currently running the daemon:**

1. Stop the systemd service: `bsv-p2p daemon stop`
2. Disable auto-start: `systemctl --user disable bsv-p2p`
3. Install plugin: `openclaw plugins install ~/projects/bsv-p2p/extensions/bsv-p2p`
4. Configure plugin in `openclaw.json` (copy settings from `~/.bsv-p2p/config.json`)
5. Restart gateway: `openclaw gateway restart`
6. Verify: `openclaw p2p status`

**Data migration:** Wallet DB and peer data remain at `~/.bsv-p2p/` (no migration needed).

**Rollback:** If plugin has issues, re-enable daemon service and use skill-based tools.

---

## 9. Documentation Updates Required

### New Docs

- `docs/PLUGIN-INSTALL.md` - Plugin installation guide
- `docs/PLUGIN-CONFIG.md` - Plugin configuration reference
- `extensions/bsv-p2p/README.md` - Plugin-specific docs

### Update Existing Docs

- `README.md` - Add plugin installation as primary method
- `docs/GETTING-STARTED.md` - Use plugin setup instead of daemon
- `docs/DAEMON.md` - Mark as legacy/optional
- `SKILL.md` - Update to reference plugin tools (no HTTP)

---

## 10. Recommendations

### Primary Recommendation: **Implement Native Plugin Integration**

**Reasoning:**

1. **Simpler for users:** One less daemon to manage, unified lifecycle
2. **Better performance:** No HTTP overhead, direct function calls
3. **Tighter integration:** Native hook support, unified logging, shared config
4. **Cleaner architecture:** Plugin tools are the natural fit for agent capabilities

### Implementation Plan:

1. **Week 1:** Build Phase 1 MVP (native plugin with 5 tools)
2. **Week 2:** Test with multi-agent setup, fix edge cases
3. **Week 3:** Add Phase 2 features (CLI, RPC, hooks)
4. **Week 4:** Write documentation, publish to npm (optional)

### Keep Daemon Mode?

**Yes, as fallback option** (hybrid mode), but only if:

- Users request it for non-OpenClaw bots
- Multi-machine deployments become common

Otherwise, **deprecate daemon mode** after 6 months of plugin stability.

---

## 11. Next Steps

### Immediate Actions

1. **Create follow-up tasks** on Mission Control board:
   - Task: "P2P: Implement native plugin entry point"
   - Task: "P2P: Refactor daemon HTTP handlers to plugin tools"
   - Task: "P2P: Add plugin error boundaries and health checks"
   - Task: "P2P: Write plugin installation docs"
   - Task: "P2P: E2E test with plugin tools"

2. **Assign to Coder:** Plugin implementation work (TypeScript, refactoring)

3. **Assign to Writer:** Documentation updates (plugin guide, migration)

### Long-Term Considerations

- **npm publication:** Publish as `@openclaw/bsv-p2p` for easy install
- **Control UI:** Add P2P status to Mission Control dashboard
- **Multi-agent support:** Each agent gets their own P2P identity (separate peer IDs)

---

## References

- [OpenClaw Plugin Documentation](/home/dylan/.npm-global/lib/node_modules/openclaw/docs/tools/plugin.md)
- [Plugin Manifest Schema](/home/dylan/.npm-global/lib/node_modules/openclaw/docs/plugins/manifest.md)
- [Plugin SDK Refactor Plan](/home/dylan/.npm-global/lib/node_modules/openclaw/docs/refactor/plugin-sdk.md)
- [BSV P2P Architecture Plan](~/projects/bsv-p2p/docs/ARCHITECTURE.md)
- [Current Daemon Implementation](~/projects/bsv-p2p/src/daemon/index.ts)
- [Current Skill Integration](~/projects/bsv-p2p/src/skill/index.ts)

---

**End of Research Document**
