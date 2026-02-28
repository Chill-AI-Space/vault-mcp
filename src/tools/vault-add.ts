import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { EncryptedStore } from '../store/encrypted-store.js';
import { AuditLogger } from '../audit/logger.js';
import { ensureDashboardRunning, onCredentialAdded } from '../dashboard/server.js';

export async function vaultAdd(
  store: EncryptedStore,
  audit: AuditLogger,
  siteId?: string,
  serviceType?: string,
) {
  const token = randomUUID();
  const port = 9900;

  // Start dashboard server if not already running
  await ensureDashboardRunning(store, audit, port);

  // Build URL with prefill params
  const params = new URLSearchParams({ token });
  if (siteId) params.set('site', siteId);
  if (serviceType) params.set('type', serviceType);
  const url = `http://localhost:${port}/add?${params}`;

  // Open browser
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} "${url}"`);

  // Wait for the user to submit the form (max 5 min)
  const result = await onCredentialAdded(token);

  if (result === '__timeout__') {
    return {
      status: 'timeout',
      message: 'Credential form was not submitted within 5 minutes. Try again with vault_add.',
    };
  }

  return {
    status: 'success',
    site_id: result,
    message: `Credential "${result}" has been securely added to the vault. You can now use vault_login or vault_api_request with it.`,
  };
}
