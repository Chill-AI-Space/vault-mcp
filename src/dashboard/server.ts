import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { EncryptedStore } from '../store/encrypted-store.js';
import type { AuditLogger } from '../audit/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const htmlCache: Record<string, string> = {};

async function loadHtml(name: string): Promise<string> {
  if (htmlCache[name]) return htmlCache[name];
  for (const dir of [__dirname, join(__dirname, '..', '..', 'src', 'dashboard')]) {
    try {
      htmlCache[name] = await readFile(join(dir, name), 'utf-8');
      return htmlCache[name];
    } catch { /* try next */ }
  }
  return `<html><body>${name} not found</body></html>`;
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

// --- Pending credential callbacks (for vault_add MCP tool) ---

type PendingCallback = (siteId: string) => void;
const pendingCallbacks = new Map<string, PendingCallback>();

export function onCredentialAdded(token: string): Promise<string> {
  return new Promise((resolve) => {
    pendingCallbacks.set(token, resolve);
    // Timeout after 5 minutes
    setTimeout(() => {
      if (pendingCallbacks.has(token)) {
        pendingCallbacks.delete(token);
        resolve('__timeout__');
      }
    }, 5 * 60 * 1000);
  });
}

// --- Singleton server ---

let serverInstance: Server | null = null;
let serverStore: EncryptedStore | null = null;
let serverAudit: AuditLogger | null = null;

export function ensureDashboardRunning(store: EncryptedStore, audit: AuditLogger, port = 9900): Promise<void> {
  serverStore = store;
  serverAudit = audit;
  if (serverInstance) return Promise.resolve();

  return new Promise((resolve) => {
    serverInstance = createHttpServer(handleRequest);
    serverInstance.listen(port, '127.0.0.1', () => {
      console.error(`[vault-mcp] Dashboard running at http://localhost:${port}`);
      resolve();
    });
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const store = serverStore!;
  const audit = serverAudit!;
  const url = new URL(req.url || '/', `http://localhost:9900`);
  const path = url.pathname;
  const method = req.method || 'GET';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    // Main dashboard
    if (path === '/' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(await loadHtml('index.html'));
      return;
    }

    // Focused add-credential page (for vault_add MCP tool)
    if (path === '/add' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(await loadHtml('add.html'));
      return;
    }

    // API: List credentials
    if (path === '/api/credentials' && method === 'GET') {
      json(res, store.listCredentials());
      return;
    }

    // API: Add credential
    if (path === '/api/credentials' && method === 'POST') {
      const raw = await parseBody(req);
      const data = JSON.parse(raw);
      const { siteId, serviceType, email, password, apiKey, loginUrl, selectors, headerName, headerPrefix, token } = data;

      let plainData;
      let finalSelectors;
      if (serviceType === 'api_key') {
        plainData = { apiKey, headers: { [headerName || 'Authorization']: (headerPrefix || 'Bearer ') + apiKey } };
      } else {
        plainData = { email, password };
        finalSelectors = selectors;
      }
      const meta = await store.addCredential(siteId, serviceType, plainData, loginUrl, finalSelectors);
      await audit.log('credential.created', siteId, 'success', undefined, 'via dashboard');

      // Notify waiting vault_add tool if token present
      if (token && pendingCallbacks.has(token)) {
        const cb = pendingCallbacks.get(token)!;
        pendingCallbacks.delete(token);
        cb(siteId);
      }

      json(res, meta, 201);
      return;
    }

    // API: Toggle / update credential
    const credMatch = path.match(/^\/api\/credentials\/(.+)$/);
    if (credMatch && method === 'PATCH') {
      const siteId = decodeURIComponent(credMatch[1]);
      const raw = await parseBody(req);
      const { active } = JSON.parse(raw);
      if (typeof active === 'boolean') {
        const ok = await store.toggleActive(siteId, active);
        if (ok) {
          await audit.log('credential.toggled', siteId, 'success', undefined, `active=${active}`);
          json(res, { ok: true });
        } else {
          json(res, { error: 'Not found' }, 404);
        }
      } else {
        json(res, { error: 'Invalid request' }, 400);
      }
      return;
    }

    // API: Remove credential
    if (credMatch && method === 'DELETE') {
      const siteId = decodeURIComponent(credMatch[1]);
      const ok = await store.removeCredential(siteId);
      if (ok) {
        await audit.log('credential.removed', siteId, 'success', undefined, 'via dashboard');
        json(res, { ok: true });
      } else {
        json(res, { error: 'Not found' }, 404);
      }
      return;
    }

    // API: Audit log
    if (path === '/api/audit' && method === 'GET') {
      const siteId = url.searchParams.get('siteId') || undefined;
      const entries = await audit.getEntries(siteId);
      const chain = await audit.verifyChain();
      json(res, { entries, chain });
      return;
    }

    json(res, { error: 'Not found' }, 404);

  } catch (err) {
    console.error('Dashboard error:', err);
    json(res, { error: 'Internal server error' }, 500);
  }
}

// Legacy standalone mode (for CLI `vault-mcp dashboard`)
export function startDashboard(store: EncryptedStore, audit: AuditLogger, port = 9900) {
  ensureDashboardRunning(store, audit, port).then(() => {
    console.log(`\n  Vault MCP Dashboard: http://localhost:${port}\n`);
    console.log('  Press Ctrl+C to stop\n');
  });
}
