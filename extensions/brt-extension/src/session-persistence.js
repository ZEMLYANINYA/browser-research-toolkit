export function sessionStorageKey(tabId) {
  return `brt_session_${tabId}`;
}

export function createSessionPersistence(storageArea) {
  if (!storageArea) throw new TypeError('storageArea is required.');

  return Object.freeze({
    async load(tabId) {
      const key = sessionStorageKey(tabId);
      const stored = await storageArea.get(key);
      return stored?.[key] ?? null;
    },

    async save(tabId, session) {
      const key = sessionStorageKey(tabId);
      await storageArea.set({ [key]: session });
    },

    async remove(tabId) {
      await storageArea.remove(sessionStorageKey(tabId));
    }
  });
}
