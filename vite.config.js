/**
 * Vite config + dev/preview server middlewares.
 *  /api/overpass  POST QL body  -> OSM Overpass (bbox-validated, cached in memory + .cache/, mirror rotation)
 *  /api/fema      ?lat&lon      -> FEMA NFHL flood-zone point query (cached)
 *  /api/usgs      ?lat&lon      -> USGS design-maps PGA (cached)
 *  /api/memo      POST json     -> Claude re-narrates a scored candidate (only if ANTHROPIC_API_KEY is set)
 *  /api/status    GET           -> which optional keys are configured
 * Pattern borrowed from gods-eye-view's proxy layer, trimmed to what the screener needs.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { defineConfig, loadEnv } from 'vite';
import cesium from 'vite-plugin-cesium';

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const CACHE_DIR = path.join(process.cwd(), '.cache');
const TTL = { overpass: 7 * 86400e3, fema: 30 * 86400e3, usgs: 365 * 86400e3 };
const MAX_BBOX_DEG = 3.0; // per axis — keeps Overpass queries bounded
const mem = new Map();

async function cacheGet(kind, key) {
  const k = `${kind}:${key}`;
  const m = mem.get(k);
  if (m && Date.now() - m.at < TTL[kind]) return m;
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(CACHE_DIR, kind, `${key}.json`), 'utf8'));
    if (Date.now() - raw.at < TTL[kind]) { mem.set(k, raw); return raw; }
  } catch {}
  return null;
}
async function cacheSet(kind, key, payload) {
  const entry = { at: Date.now(), payload };
  mem.set(`${kind}:${key}`, entry);
  try {
    await fsp.mkdir(path.join(CACHE_DIR, kind), { recursive: true });
    await fsp.writeFile(path.join(CACHE_DIR, kind, `${key}.json`), JSON.stringify(entry));
  } catch {}
  return entry;
}
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 24);

function send(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
}
function sendCached(res, entry, hit) {
  send(res, 200, entry.payload, { 'X-Cache': hit, 'X-Fetched-At': new Date(entry.at).toISOString() });
}
async function readBody(req, cap = 64 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > cap) throw new Error('BODY_TOO_LARGE'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
function parseLatLon(url) {
  const u = new URL(url, 'http://x');
  const lat = Number(u.searchParams.get('lat')), lon = Number(u.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
}

/** Reject Overpass QL that lacks a bbox filter or asks for more than MAX_BBOX_DEG per axis. */
function validateOverpass(body) {
  if (body.length > 20000) return 'query too large';
  const boxes = [...body.matchAll(/\((-?\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*)\)/g)];
  if (!boxes.length) return 'query must be bbox-bounded';
  for (const b of boxes) {
    const [s, w, n, e] = b.slice(1, 5).map(Number);
    if (n - s > MAX_BBOX_DEG || e - w > MAX_BBOX_DEG) return `bbox exceeds ${MAX_BBOX_DEG}° per axis`;
    if (n <= s || e <= w) return 'malformed bbox';
  }
  if (!/\[timeout:\d+\]/.test(body)) return 'missing timeout';
  return null;
}

async function overpassUpstream(body) {
  let lastErr;
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const r = await fetch(mirror, { method: 'POST', body: `data=${encodeURIComponent(body)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'dc-site-screener/0.1 (local dev)' }, signal: AbortSignal.timeout(150e3) });
      const text = await r.text();
      if (r.status === 429 || r.status === 504 || /rate_limited|Too many requests|runtime error/i.test(text.slice(0, 2000))) { lastErr = new Error(`${mirror}: ${r.status}`); continue; }
      if (!r.ok) { lastErr = new Error(`${mirror}: HTTP ${r.status}`); continue; }
      const json = JSON.parse(text);
      if (!Array.isArray(json.elements)) { lastErr = new Error(`${mirror}: no elements`); continue; }
      return json;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all Overpass mirrors failed');
}

function registerApi(server, env) {
  const anthropicKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';

  server.middlewares.use('/api/status', (req, res) => send(res, 200, { anthropic: !!anthropicKey, eia: !!(env.EIA_API_KEY || process.env.EIA_API_KEY) }));

  server.middlewares.use('/api/overpass', async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    let body;
    try { body = await readBody(req); } catch { return send(res, 413, { error: 'body too large' }); }
    const bad = validateOverpass(body);
    if (bad) return send(res, 400, { error: bad });
    const key = sha(body.replace(/\s+/g, ' ').trim());
    const hit = await cacheGet('overpass', key);
    if (hit) return sendCached(res, hit, 'HIT');
    try {
      const json = await overpassUpstream(body);
      sendCached(res, await cacheSet('overpass', key, json), 'MISS');
    } catch (e) { send(res, 502, { error: String(e?.message || e) }); }
  });

  server.middlewares.use('/api/fema', async (req, res) => {
    const p = parseLatLon(req.url); if (!p) return send(res, 400, { error: 'lat/lon required' });
    const key = `${p.lat}_${p.lon}`;
    const hit = await cacheGet('fema', key); if (hit) return sendCached(res, hit, 'HIT');
    const u = new URL('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query');
    u.search = new URLSearchParams({ geometry: `${p.lon},${p.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF', returnGeometry: 'false', f: 'json' }).toString();
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30e3) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'FEMA error');
      const feats = (j.features || []).map((f) => f.attributes);
      // Prefer the SFHA polygon if several overlap; else the first.
      const pick = feats.find((a) => a.SFHA_TF === 'T') || feats[0] || null;
      const payload = { covered: true, zone: pick?.FLD_ZONE || null, subtype: pick?.ZONE_SUBTY || null, sfha: pick?.SFHA_TF === 'T', matches: feats.length };
      sendCached(res, await cacheSet('fema', key, payload), 'MISS');
    } catch (e) { send(res, 200, { covered: false, error: String(e?.message || e) }); }
  });

  server.middlewares.use('/api/usgs', async (req, res) => {
    const p = parseLatLon(req.url); if (!p) return send(res, 400, { error: 'lat/lon required' });
    const key = `${p.lat}_${p.lon}`;
    const hit = await cacheGet('usgs', key); if (hit) return sendCached(res, hit, 'HIT');
    const u = new URL('https://earthquake.usgs.gov/ws/designmaps/asce7-22.json');
    u.search = new URLSearchParams({ latitude: String(p.lat), longitude: String(p.lon), riskCategory: 'III', siteClass: 'D', title: 'screen' }).toString();
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30e3) });
      const j = await r.json();
      const d = j?.response?.data;
      if (!d) throw new Error(j?.response?.metadata?.status || 'no data');
      const payload = { pga: d.pga ?? d.pgam ?? null, ss: d.ss ?? null, s1: d.s1 ?? null, sdc: d.sdc ?? null };
      sendCached(res, await cacheSet('usgs', key, payload), 'MISS');
    } catch (e) { send(res, 200, { pga: null, error: String(e?.message || e) }); }
  });

  server.middlewares.use('/api/memo', async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    if (!anthropicKey) return send(res, 503, { error: 'ANTHROPIC_API_KEY not configured (see .env.example)' });
    let body;
    try { body = JSON.parse(await readBody(req, 512 * 1024)); } catch { return send(res, 400, { error: 'invalid JSON' }); }
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: anthropicKey });
      const response = await client.messages.create({
        model: 'claude-opus-5',
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: [
          'You are a data-center site-selection analyst writing a feasibility memo for a development lead.',
          'You will receive a JSON object with a deterministically scored candidate site: sub-scores with their basis strings, calculator outputs with assumptions, and an evidence trail.',
          'Rules: (1) Every number you state must appear verbatim in the JSON; never compute, round differently, extrapolate, or invent. (2) Cite evidence rows as [E#]. (3) Call out unscored criteria and caveats explicitly. (4) Be concrete and decision-oriented: lead with a recommendation (advance / hold / drop) and the 3 facts that drive it. (5) Markdown, under 600 words, no tables.',
        ].join(' '),
        messages: [{ role: 'user', content: `Candidate JSON:\n\`\`\`json\n${JSON.stringify(body).slice(0, 200000)}\n\`\`\`` }],
      });
      if (response.stop_reason === 'refusal') return send(res, 200, { error: 'model declined', category: response.stop_details?.category || null });
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      send(res, 200, { markdown: text, model: response.model, usage: response.usage });
    } catch (e) { send(res, 502, { error: String(e?.message || e) }); }
  });
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      cesium(),
      {
        name: 'dc-screener-api',
        configureServer(server) { registerApi(server, env); },
        configurePreviewServer(server) { registerApi(server, env); },
      },
    ],
    server: { port: 5180, strictPort: false },
    preview: { port: 5180 },
    build: { chunkSizeWarningLimit: 4000 },
  };
});
