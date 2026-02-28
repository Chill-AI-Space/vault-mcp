import { EncryptedStore } from '../store/encrypted-store.js';
import { AuditLogger } from '../audit/logger.js';

export async function vaultStatus(
  store: EncryptedStore,
  audit: AuditLogger,
  siteId: string,
) {
  const credentials = store.listCredentials();
  const cred = credentials.find((c) => c.siteId === siteId);

  if (!cred) {
    return { error: `Credential not found: ${siteId}` };
  }

  const entries = await audit.getEntries(siteId);
  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;

  return {
    siteId: cred.siteId,
    serviceType: cred.serviceType,
    active: cred.active,
    createdAt: cred.createdAt,
    updatedAt: cred.updatedAt,
    auditCount: entries.length,
    lastUsed: lastEntry
      ? { timestamp: lastEntry.timestamp, action: lastEntry.action, result: lastEntry.result }
      : null,
  };
}
