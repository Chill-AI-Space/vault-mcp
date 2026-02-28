# Vault MCP

MCP server for credential isolation in LLM agents. Your bot uses passwords and API keys — but never sees them in its context window.

```
                    Claude Code
                        |
                   vault_login("github")
                        |
                   Vault MCP Server
                   /            \
         Encrypted Store     Chrome CDP
         (AES-256-GCM)      (fill form)
                                |
                          github.com ✓
                                |
                   → { status: "success", page_title: "Dashboard" }
                   (password never in LLM context)
```

## Quickstart

```bash
# 1. Clone and build
git clone https://github.com/chillai-space/vault-mcp.git
cd vault-mcp
npm install
npm run build

# 2. Add a credential
node dist/index.js add --site github --email you@example.com --url https://github.com/login

# 3. Register with Claude Code
claude mcp add -s user vault -- node ~/path/to/vault-mcp/dist/index.js

# 4. Use in Claude Code session
# "Log me into GitHub" → Claude calls vault_login("github")
# → Chrome fills the form, Claude gets { status: "success" }
# → Password never appears in conversation
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `vault_login(site_id)` | Log into a website via Chrome CDP. Returns only status. |
| `vault_api_request(service, url, ...)` | Make API request with stored credentials injected. |
| `vault_list()` | List all credentials (no secrets shown). |
| `vault_status(site_id)` | Check credential status, last used, audit count. |

## CLI Commands

```bash
vault-mcp add                        # Interactive: add credential
vault-mcp add --site X --email Y     # Semi-interactive (password prompted)
vault-mcp list                       # List credentials (no secrets)
vault-mcp remove <site_id>           # Remove credential
vault-mcp audit [site_id]            # View audit log
vault-mcp dashboard                  # Web UI on localhost:9900
vault-mcp serve                      # Start MCP server (stdio, for debugging)
```

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `VAULT_MASTER_KEY` | (auto-generated) | Master encryption key. If not set, a random key is generated at `~/.vault-mcp/.master-key` |
| `VAULT_CDP_URL` | `http://localhost:9222` | Chrome DevTools Protocol endpoint |

### Claude Code registration with env vars

```bash
claude mcp add -s user vault \
  -e VAULT_MASTER_KEY=my-secret-key \
  -e VAULT_CDP_URL=ws://localhost:9222 \
  -- node ~/path/to/vault-mcp/dist/index.js
```

## Storage

All data is stored in `~/.vault-mcp/`:

| File | Description |
|------|-------------|
| `credentials.json` | Encrypted credentials (AES-256-GCM) |
| `audit.jsonl` | Append-only audit log with SHA-256 hash chain |
| `.master-key` | Auto-generated master key (if no env var) |

## Testing

```bash
npm test          # Run all tests
npm run test:watch # Watch mode
```

### Manual verification

```bash
# 1. Add credential and verify isolation
vault-mcp add --site test --email test@test.com
vault-mcp list  # → password NOT shown

# 2. Test with MCP Inspector
npx @modelcontextprotocol/inspector dist/index.js
# → Call vault_list, vault_status — verify no secrets in responses

# 3. In Claude Code: vault_login → verify no password in conversation
```

## Security

See [SECURITY.md](SECURITY.md) for threat model and encryption details.

## License

MIT
