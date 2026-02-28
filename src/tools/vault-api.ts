import { EncryptedStore } from '../store/encrypted-store.js';
import { AuditLogger } from '../audit/logger.js';

export async function vaultApiRequest(
  store: EncryptedStore,
  audit: AuditLogger,
  service: string,
  url: string,
  method: string = 'GET',
  body?: string,
  headers?: Record<string, string>,
) {
  const cred = await store.getCredential(service);

  if (!cred) {
    await audit.log('credential.used', service, 'failure', 'claude', 'Credential not found');
    return { status: 'failure', message: `Credential not found: ${service}` };
  }

  if (!cred.metadata.active) {
    await audit.log('credential.used', service, 'failure', 'claude', 'Credential is inactive');
    return { status: 'failure', message: `Credential is inactive: ${service}` };
  }

  if (cred.metadata.serviceType !== 'api_key') {
    await audit.log('credential.used', service, 'failure', 'claude', 'Not an api_key credential');
    return { status: 'failure', message: `${service} is not an api_key credential. Use vault_login instead.` };
  }

  // Merge stored headers (containing API key) with provided headers
  const storedHeaders = cred.data.headers || {};
  const mergedHeaders: Record<string, string> = {
    ...storedHeaders,
    ...(headers || {}),
  };

  // Collect secrets to sanitize from response
  const secrets: string[] = [];
  if (cred.data.apiKey) secrets.push(cred.data.apiKey);
  for (const val of Object.values(storedHeaders)) {
    secrets.push(val);
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: mergedHeaders,
    };
    if (body && method !== 'GET') {
      fetchOptions.body = body;
    }

    const response = await fetch(url, fetchOptions);
    let responseBody = await response.text();

    // Sanitize: strip any credential values from response
    for (const secret of secrets) {
      if (secret && responseBody.includes(secret)) {
        responseBody = responseBody.replaceAll(secret, '***');
      }
    }

    await audit.log('credential.used', service, 'success', 'claude', `${method} ${url} → ${response.status}`);

    return {
      status: 'success',
      httpStatus: response.status,
      body: responseBody,
    };
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    // Sanitize error messages
    for (const secret of secrets) {
      if (secret && message.includes(secret)) {
        message = message.replaceAll(secret, '***');
      }
    }

    await audit.log('credential.used', service, 'failure', 'claude', message);

    return {
      status: 'failure',
      message,
    };
  }
}
