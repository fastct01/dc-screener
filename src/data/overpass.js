/**
 * OSM power + water features for a bbox via the dev-server /api/overpass proxy (cached, mirror-rotating).
 * Returns normalised arrays; every feature keeps its OSM id so the memo can cite it.
 */
import { parseVoltageKv } from '../engine/scoring.js';

export function buildPowerWaterQuery(bbox) {
  const b = `${bbox.s.toFixed(5)},${bbox.w.toFixed(5)},${bbox.n.toFixed(5)},${bbox.e.toFixed(5)}`;
  return `[out:json][timeout:120];
(
  node["power"="substation"](${b});
  way["power"="substation"](${b});
  relation["power"="substation"](${b});
  node["power"="plant"](${b});
  way["power"="plant"](${b});
  relation["power"="plant"](${b});
  way["natural"="water"]["name"](${b});
  relation["natural"="water"]["name"](${b});
);
out center tags;
(
  way["power"="line"](${b});
  way["waterway"="river"](${b});
);
out geom tags;`;
}

export async function fetchPowerWater(bbox) {
  const query = buildPowerWaterQuery(bbox);
  const r = await fetch('/api/overpass', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: query });
  if (!r.ok) {
    let msg = `Overpass HTTP ${r.status}`;
    try { msg += `: ${(await r.json()).error}` } catch {}
    throw new Error(msg);
  }
  const fetchedAt = r.headers.get('x-fetched-at') || new Date().toISOString();
  const json = await r.json();
  return { ...normaliseElements(json.elements || []), fetchedAt, cache: r.headers.get('x-cache') || 'MISS' };
}

export function normaliseElements(elements) {
  const substations = [], plants = [], lines = [], water = [], rivers = [];
  for (const el of elements) {
    const t = el.tags || {};
    const center = el.type === 'node' ? [el.lon, el.lat] : el.center ? [el.center.lon, el.center.lat] : null;
    const ref = `${el.type}/${el.id}`;
    if (t.power === 'substation') {
      if (!center) continue;
      substations.push({ ref, p: center, name: t.name, kv: parseVoltageKv(t.voltage), sub: t.substation });
    } else if (t.power === 'plant') {
      if (!center) continue;
      plants.push({ ref, p: center, name: t.name, source: t['plant:source'], output: t['plant:output:electricity'] });
    } else if (t.power === 'line') {
      if (!el.geometry) continue;
      lines.push({ ref, line: el.geometry.map((g) => [g.lon, g.lat]), name: t.name, kv: parseVoltageKv(t.voltage) });
    } else if (t.waterway === 'river') {
      if (!el.geometry) continue;
      rivers.push({ ref, line: el.geometry.map((g) => [g.lon, g.lat]), name: t.name });
    } else if (t.natural === 'water') {
      if (!center) continue;
      water.push({ ref, p: center, name: t.name, kind: t.water || 'water' });
    }
  }
  return { substations, plants, lines, water, rivers };
}
