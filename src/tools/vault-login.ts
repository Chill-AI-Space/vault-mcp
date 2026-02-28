import { EncryptedStore } from '../store/encrypted-store.js';
import { AuditLogger } from '../audit/logger.js';
import { CdpBridge } from '../browser/cdp-bridge.js';

export async function vaultLogin(
  store: EncryptedStore,
  audit: AuditLogger,
  siteId: string,
) {
  const cred = await store.getCredential(siteId);

  if (!cred) {
    await audit.log('credential.used', siteId, 'failure', 'claude', 'Credential not found');
    return { status: 'failure', message: `Credential not found: ${siteId}` };
  }

  if (!cred.metadata.active) {
    await audit.log('credential.used', siteId, 'failure', 'claude', 'Credential is inactive');
    return { status: 'failure', message: `Credential is inactive: ${siteId}` };
  }

  if (cred.metadata.serviceType !== 'web_login') {
    await audit.log('credential.used', siteId, 'failure', 'claude', 'Not a web_login credential');
    return { status: 'failure', message: `${siteId} is not a web_login credential. Use vault_api_request instead.` };
  }

  if (!cred.metadata.loginUrl || !cred.metadata.selectors) {
    await audit.log('credential.used', siteId, 'failure', 'claude', 'Missing login URL or selectors');
    return { status: 'failure', message: `${siteId} is missing loginUrl or selectors configuration` };
  }

  const bridge = new CdpBridge();
  const recipe = {
    loginUrl: cred.metadata.loginUrl,
    emailSelector: cred.metadata.selectors.email,
    passwordSelector: cred.metadata.selectors.password,
    submitSelector: cred.metadata.selectors.submit,
  };

  const result = await bridge.performLogin(recipe, cred.data.email || '', cred.data.password || '');

  await audit.log(
    'credential.used',
    siteId,
    result.success ? 'success' : 'failure',
    'claude',
    result.message,
  );

  // NEVER return credentials — only status
  return {
    status: result.success ? 'success' : 'failure',
    page_title: result.pageTitle,
    message: result.message,
  };
}
