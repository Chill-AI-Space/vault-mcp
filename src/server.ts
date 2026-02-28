import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { EncryptedStore } from './store/encrypted-store.js';
import { AuditLogger } from './audit/logger.js';
import { vaultLogin } from './tools/vault-login.js';
import { vaultApiRequest } from './tools/vault-api.js';
import { vaultList } from './tools/vault-list.js';
import { vaultStatus } from './tools/vault-status.js';
import { vaultAdd } from './tools/vault-add.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'vault-mcp',
    version: '0.1.0',
  });

  const store = new EncryptedStore();
  const audit = new AuditLogger();

  // Initialize store and audit on first tool call
  let initialized = false;
  async function ensureInit() {
    if (!initialized) {
      await store.init();
      await audit.init();
      initialized = true;
    }
  }

  server.tool(
    'vault_login',
    'Log into a website using stored credentials. The bot never sees the password — Vault fills the login form via Chrome DevTools Protocol.',
    {
      site_id: z.string().describe('The site identifier (e.g. "github", "jira")'),
    },
    async ({ site_id }) => {
      await ensureInit();
      const result = await vaultLogin(store, audit, site_id);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'vault_api_request',
    'Make an API request with stored credentials. The API key is injected into headers automatically — the bot never sees it.',
    {
      service: z.string().describe('The service identifier (e.g. "openai", "stripe")'),
      url: z.string().describe('The API endpoint URL'),
      method: z.string().optional().describe('HTTP method (default: GET)'),
      body: z.string().optional().describe('Request body (JSON string)'),
      headers: z.record(z.string()).optional().describe('Additional headers'),
    },
    async ({ service, url, method, body, headers }) => {
      await ensureInit();
      const result = await vaultApiRequest(store, audit, service, url, method, body, headers);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'vault_list',
    'List all available credentials in the vault. Returns only site IDs and types — no secrets.',
    {},
    async () => {
      await ensureInit();
      const result = await vaultList(store);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'vault_status',
    'Check the status of a specific credential: active/inactive, last used, audit count.',
    {
      site_id: z.string().describe('The site identifier to check'),
    },
    async ({ site_id }) => {
      await ensureInit();
      const result = await vaultStatus(store, audit, site_id);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'vault_add',
    'Securely add a new credential to the vault. Opens a browser form where the user enters their password directly — the password NEVER passes through the AI agent. IMPORTANT: Never ask the user to type passwords in chat. Always use this tool instead.',
    {
      site_id: z.string().optional().describe('Pre-fill the site identifier (e.g. "github")'),
      service_type: z.enum(['web_login', 'api_key']).optional().describe('Type of credential (default: web_login)'),
    },
    async ({ site_id, service_type }) => {
      await ensureInit();
      const result = await vaultAdd(store, audit, site_id, service_type);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  return server;
}
