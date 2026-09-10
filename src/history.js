/** Screening library: every completed run is stored in IndexedDB (request + full result) so it can be reopened later. */
const DB = 'dc-screener', STORE = 'screenings';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore(STORE, { keyPath: 'id' }); s.createIndex('savedAt', 'savedAt'); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode); const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out?.result ?? out); };
    t.onerror = () => { db.close(); reject(t.error); };
  }));
}

export function summarize(request, result) {
  const top = result.ranked[0];
  const b = request.bbox;
  return {
    itMw: request.itMw, count: result.ranked.length, points: request.points?.length || 0, gridN: request.gridN,
    topScore: top?.composite.score ?? null, topId: top?.id ?? null, state: top?.stateCode?.replace('US-', '') ?? null,
    lat: b ? +((b.n + b.s) / 2).toFixed(3) : null, lon: b ? +((b.e + b.w) / 2).toFixed(3) : null,
  };
}

/** Store a run. Pass an existing `id` to overwrite that entry (e.g. to attach a name); `name` is optional. */
export async function saveRun(request, result, { id, name } = {}) {
  id = id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const entry = { id, name: name || null, savedAt: result.generatedAt || new Date().toISOString(), summary: summarize(request, result), request, result };
  await tx('readwrite', (s) => s.put(entry));
  return id;
}
export async function renameRun(id, name) {
  const entry = await getRun(id); if (!entry) return false;
  entry.name = name || null;
  await tx('readwrite', (s) => s.put(entry));
  return true;
}
/** Newest first, summaries only (full payloads stay on disk until opened). */
export async function listRuns() {
  const all = await tx('readonly', (s) => s.getAll());
  return all.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1)).map(({ id, name, savedAt, summary }) => ({ id, name: name || null, savedAt, summary }));
}
export function getRun(id) { return tx('readonly', (s) => s.get(id)); }
export function deleteRun(id) { return tx('readwrite', (s) => s.delete(id)); }
export function clearRuns() { return tx('readwrite', (s) => s.clear()); }
