function nowIso() {
  return new Date().toISOString();
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

function emptyDoc() {
  return {
    version: 1,
    updatedAt: null,
    runs: [],
    games: [],
    stints: [],
    plateAppearances: [],
    tombstones: [],
  };
}

function copyRow(row) {
  if (!row || typeof row !== 'object') return null;
  return { ...row };
}

function applyTombstones(doc) {
  const dead = {
    game: new Set(),
    pa: new Set(),
    stint: new Set(),
    run: new Set(),
  };
  for (const mark of doc.tombstones) {
    if (dead[mark.type]) dead[mark.type].add(mark.id);
  }
  return {
    ...doc,
    runs: doc.runs.filter((run) => run?.id && !dead.run.has(run.id)),
    games: doc.games.filter((game) => game?.id && !dead.game.has(game.id)),
    stints: doc.stints.filter((stint) => stint?.id && !dead.stint.has(stint.id) && !dead.game.has(stint.gameId)),
    plateAppearances: doc.plateAppearances.filter((pa) => pa?.id && !dead.pa.has(pa.id) && !dead.game.has(pa.gameId)),
  };
}

function normalizeDoc(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('That file is not a scorebook.');
  }
  if (raw.version !== 1) throw new Error('That scorebook file is from a different version.');
  const arrays = ['runs', 'games', 'stints', 'plateAppearances', 'tombstones'];
  const doc = {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
  for (const key of arrays) {
    if (!Array.isArray(raw[key])) throw new Error('That scorebook file is missing data.');
    doc[key] = raw[key].map(copyRow).filter(Boolean);
  }
  return applyTombstones(doc);
}

function byId(list) {
  return [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function canonical(doc) {
  return JSON.stringify({
    version: 1,
    updatedAt: doc.updatedAt,
    runs: byId(doc.runs),
    games: byId(doc.games),
    stints: byId(doc.stints),
    plateAppearances: byId(doc.plateAppearances),
    tombstones: [...doc.tombstones].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)),
  });
}

function later(a, b) {
  return String(a || '') > String(b || '');
}

function mergeById(left, right) {
  const map = new Map();
  for (const item of [...left, ...right]) {
    if (!item?.id) continue;
    const prev = map.get(item.id);
    if (!prev || later(item.updatedAt, prev.updatedAt)) map.set(item.id, { ...item });
  }
  return [...map.values()];
}

function mergeTombstones(left, right) {
  const map = new Map();
  for (const item of [...left, ...right]) {
    if (!item?.id || !item?.type) continue;
    const key = `${item.type}:${item.id}`;
    const prev = map.get(key);
    if (!prev || later(item.deletedAt, prev.deletedAt)) map.set(key, { ...item });
  }
  return [...map.values()];
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

function mergeDocs(left, right) {
  const merged = {
    version: 1,
    updatedAt: maxIso(left?.updatedAt, right?.updatedAt),
    runs: mergeById(left?.runs || [], right?.runs || []),
    games: mergeById(left?.games || [], right?.games || []),
    stints: mergeById(left?.stints || [], right?.stints || []),
    plateAppearances: mergeById(left?.plateAppearances || [], right?.plateAppearances || []),
    tombstones: mergeTombstones(left?.tombstones || [], right?.tombstones || []),
  };
  return applyTombstones(merged);
}

export {
  applyTombstones,
  canonical,
  emptyDoc,
  mergeDocs,
  newId,
  normalizeDoc,
  nowIso,
};
