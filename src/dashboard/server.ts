import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { EncryptedStore } from '../store/encrypted-store.js';
import type { AuditLogger } from '../audit/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedHtml: string | null = null;

async function getHtml(): Promise<string> {
  if (cachedHtml) return cachedHtml;
  // In production (dist/), the HTML is next to this JS file
  // In dev, it's in src/dashboard/
  for (const dir of [__dirname, join(__dirname, '..', '..', 'src', 'dashboard')]) {
    try {
      cachedHtml = await readFile(join(dir, 'index.html'), 'utf-8');
      return cachedHtml;
    } catch { /* try next */ }
  }
  return '<html><body>Dashboard HTML not found</body></html>';
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

export function startDashboard(store: EncryptedStore, audit: AuditLogger, port = 9900) {
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    // CORS for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    try {
      // Serve HTML
      if (path === '/' && method === 'GET') {
        const html = await getHtml();
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
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
        const { siteId, serviceType, email, password, apiKey, loginUrl, selectors, headerName, headerPrefix } = data;

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

      // 404
      json(res, { error: 'Not found' }, 404);

    } catch (err) {
      console.error('Dashboard error:', err);
      json(res, { error: 'Internal server error' }, 500);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  Vault MCP Dashboard: http://localhost:${port}\n`);
    console.log('  Press Ctrl+C to stop\n');
  });
}
