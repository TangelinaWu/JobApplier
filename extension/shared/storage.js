// Storage wrappers for chrome.storage.local
// profileSchema.js must be loaded before this file.

const StorageKeys = {
  PROFILE: "profile",
  APP_LOG: "appLog",
};

async function getProfile() {
  const result = await chrome.storage.local.get(StorageKeys.PROFILE);
  return { ...PROFILE_DEFAULTS, ...(result[StorageKeys.PROFILE] || {}) };
}

async function saveProfile(partial) {
  const existing = await getProfile();
  await chrome.storage.local.set({
    [StorageKeys.PROFILE]: { ...existing, ...partial },
  });
}

async function getAppLog() {
  const result = await chrome.storage.local.get(StorageKeys.APP_LOG);
  return result[StorageKeys.APP_LOG] || [];
}

async function appendAppLog(entry) {
  const log = await getAppLog();
  log.unshift({ ...entry, timestamp: Date.now() });
  // Keep last 500 entries
  if (log.length > 500) log.length = 500;
  await chrome.storage.local.set({ [StorageKeys.APP_LOG]: log });
}
