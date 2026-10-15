import { canonical, emptyDoc, mergeDocs, normalizeDoc } from './doc.js';

const DOC_KEY = 'scorebook-doc-v1';
// The token has to live in this browser because GitHub Pages cannot hold a
// secret for us. It is stored apart from the stats file, never exported, and
// refused if it would be uploaded.
const SETTINGS_KEY = 'scorebook-settings-v1';
const SYNC_MS = 120000;

let doc = emptyDoc();
let settings = {
  owner: '',
  repo: '',
  branch: 'main',
  token: '',
  path: 'data/stats.json',
};
let syncState = {
  phase: 'unconfigured',
  error: '',
  lastSyncedAt: null,
  dirty: false,
  sha: null,
};
const listeners = new Set();
let timer = null;
let working = false;
let queued = false;
let attempts = 0;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getDoc() {
  return doc;
}

function getSync() {
  return { ...syncState };
}

function getSettingsPublic() {
  return {
    owner: settings.owner,
    repo: settings.repo,
    branch: settings.branch || 'main',
    path: 'data/stats.json',
    hasToken: Boolean(settings.token),
  };
}

function canSync() {
  return Boolean(settings.token && settings.owner && settings.repo);
}

function setSync(patch) {
  syncState = { ...syncState, ...patch };
  emit();
}

function loadDoc() {
  try {
    const raw = localStorage.getItem(DOC_KEY);
    if (raw) doc = normalizeDoc(JSON.parse(raw));
  } catch {
    setSync({ phase: 'error', error: 'Saved stats on this phone could not be read.' });
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    settings = {
      ...settings,
      owner: String(saved.owner || ''),
      repo: String(saved.repo || ''),
      branch: String(saved.branch || 'main'),
      token: String(saved.token || ''),
      path: 'data/stats.json',
    };
  } catch {
    settings = {
      owner: '',
      repo: '',
      branch: 'main',
      token: '',
      path: 'data/stats.json',
    };
  }
}

function saveDoc() {
  try {
    localStorage.setItem(DOC_KEY, canonical(doc));
    return true;
  } catch {
    setSync({
      phase: 'error',
      error: 'This browser blocked local saving. Use a normal tab, not private browsing.',
    });
    return false;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    setSync({
      phase: 'error',
      error: 'This browser blocked local saving. Use a normal tab, not private browsing.',
    });
  }
}

function docHasData(value) {
  return Boolean(value.runs.length || value.games.length || value.plateAppearances.length || value.tombstones.length);
}

function contentsUrl() {
  const path = settings.path.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}/contents/${path}`;
}

function headers() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${settings.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

async function githubError(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body.message || '';
  } catch {
    detail = '';
  }
  if (response.status === 401) return 'GitHub rejected the token.';
  if (response.status === 403) return 'GitHub refused the update. The token needs Contents read and write on this repo.';
  if (response.status === 404) return 'That repository was not found, or the token cannot see it.';
  return detail || `GitHub returned ${response.status}.`;
}

async function fetchRemote() {
  const response = await fetch(`${contentsUrl()}?ref=${encodeURIComponent(settings.branch)}`, {
    headers: headers(),
    cache: 'no-store',
  });
  if (response.status === 404) return { missing: true, sha: null, doc: null };
  if (!response.ok) throw new Error(await githubError(response));
  const body = await response.json();
  let parsed;
  try {
    parsed = normalizeDoc(JSON.parse(base64ToUtf8(body.content || '')));
  } catch {
    throw new Error('The stats file on GitHub is not a valid scorebook.');
  }
  return { missing: false, sha: body.sha, doc: parsed };
}

function rememberRemote(remote, dirty) {
  syncState = {
    ...syncState,
    sha: remote.sha,
    dirty,
    phase: dirty ? 'pending' : 'synced',
    error: '',
    lastSyncedAt: dirty ? syncState.lastSyncedAt : new Date().toISOString(),
  };
}

async function pushOnce(keepalive) {
  const remote = await fetchRemote();
  let next = doc;
  if (!remote.missing) next = mergeDocs(doc, remote.doc);
  const remoteSame = !remote.missing && canonical(next) === canonical(remote.doc);
  const localChanged = canonical(next) !== canonical(doc);
  doc = next;
  saveDoc();
  if (remote.missing && !docHasData(next)) {
    rememberRemote({ sha: null }, false);
    emit();
    return;
  }
  if (remoteSame) {
    rememberRemote(remote, false);
    emit();
    return;
  }
  const bodyJson = canonical(next);
  if (settings.token && bodyJson.includes(settings.token)) {
    throw new Error('Sync stopped because the stats file would have included the token.');
  }
  const payload = JSON.stringify({
    message: `Update scorebook stats (${new Date().toISOString()})`,
    content: utf8ToBase64(bodyJson),
    branch: settings.branch,
    sha: remote.sha || undefined,
  });
  const init = { method: 'PUT', headers: headers(), body: payload };
  if (keepalive && payload.length < 60000) init.keepalive = true;
  const response = await fetch(contentsUrl(), init);
  if (response.status === 409) {
    const error = new Error('conflict');
    error.conflict = true;
    throw error;
  }
  if (!response.ok) throw new Error(await githubError(response));
  const saved = await response.json();
  if (localChanged) emit();
  syncState = {
    ...syncState,
    sha: saved.content?.sha || null,
    dirty: false,
    phase: 'synced',
    error: '',
    lastSyncedAt: new Date().toISOString(),
  };
  emit();
}

async function flush(options = {}) {
  if (!canSync()) {
    setSync({ phase: 'unconfigured', error: '' });
    return;
  }
  if (working) {
    queued = true;
    return;
  }
  working = true;
  setSync({ phase: 'syncing', error: '' });
  try {
    await pushOnce(Boolean(options.keepalive));
    attempts = 0;
  } catch (error) {
    if (error.conflict && attempts < 3) {
      attempts += 1;
      working = false;
      await flush(options);
      return;
    }
    const offline = error instanceof TypeError;
    setSync({
      phase: 'error',
      dirty: true,
      error: offline ? 'Could not reach GitHub. Stats are still saved on this phone.' : error.message,
    });
  } finally {
    working = false;
    if (queued) {
      queued = false;
      await flush();
    }
  }
}

async function pull() {
  if (!canSync()) {
    setSync({ phase: 'unconfigured', error: '' });
    return;
  }
  setSync({ phase: 'syncing', error: '' });
  try {
    const remote = await fetchRemote();
    if (remote.missing) {
      syncState = { ...syncState, sha: null, phase: 'pending', error: '' };
      if (docHasData(doc)) await flush();
      else setSync({ phase: 'synced', dirty: false, error: '' });
      return;
    }
    const merged = mergeDocs(doc, remote.doc);
    const remoteChanged = canonical(merged) !== canonical(remote.doc);
    doc = merged;
    saveDoc();
    syncState = {
      ...syncState,
      sha: remote.sha,
      dirty: remoteChanged,
      phase: remoteChanged ? 'pending' : 'synced',
      error: '',
      lastSyncedAt: remoteChanged ? syncState.lastSyncedAt : new Date().toISOString(),
    };
    emit();
    if (remoteChanged) await flush();
  } catch (error) {
    const offline = error instanceof TypeError;
    setSync({
      phase: 'error',
      error: offline ? 'Could not reach GitHub. Showing stats saved on this phone.' : error.message,
    });
  }
}

function commit(next, when = 'soon') {
  doc = next;
  const saved = saveDoc();
  syncState = { ...syncState, dirty: true, error: saved ? syncState.error : syncState.error };
  emit();
  if (when === 'now') flush();
}

function schedule() {
  if (timer) return;
  timer = setInterval(() => {
    if (syncState.dirty) flush();
  }, SYNC_MS);
}

function bindLifecycle() {
  schedule();
  window.addEventListener('online', () => flush());
  window.addEventListener('pagehide', () => flush({ keepalive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush({ keepalive: true });
  });
}

async function boot() {
  loadSettings();
  loadDoc();
  bindLifecycle();
  if (!canSync()) {
    setSync({ phase: 'unconfigured', error: '' });
    return;
  }
  await Promise.race([
    pull(),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
}

function updateSettings({ owner, repo, branch, token, clearToken }) {
  const clean = (value) => String(value || '').trim();
  settings = {
    ...settings,
    owner: clean(owner),
    repo: clean(repo),
    branch: clean(branch) || 'main',
    path: 'data/stats.json',
  };
  if (clearToken) settings.token = '';
  else if (token && token.trim()) settings.token = token.trim().replace(/^Bearer\s+/i, '');
  saveSettings();
  emit();
}

function exportDoc() {
  return canonical(doc);
}

function importDoc(text) {
  const parsed = normalizeDoc(JSON.parse(String(text).replace(/^\uFEFF/, '')));
  doc = mergeDocs(doc, parsed);
  saveDoc();
  syncState = { ...syncState, dirty: true };
  emit();
  flush();
}

export {
  boot,
  commit,
  exportDoc,
  flush,
  getDoc,
  getSettingsPublic,
  getSync,
  importDoc,
  pull,
  subscribe,
  updateSettings,
};
