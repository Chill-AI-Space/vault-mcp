import { EncryptedStore } from '../store/encrypted-store.js';

export async function vaultList(store: EncryptedStore) {
  const credentials = store.listCredentials();
  return {
    credentials: credentials.map((c) => ({
      siteId: c.siteId,
      serviceType: c.serviceType,
      active: c.active,
    })),
  };
}
