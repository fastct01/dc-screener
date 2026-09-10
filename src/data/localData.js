/** Bundled datasets built by scripts/build-datasets.mjs (served from /data/*.json). */
import { pointInGeometry } from '../engine/geo.js';

let _dcs = null, _dams = null, _states = null;

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

export async function loadDatacenters() { return (_dcs ??= await getJson('/data/datacenters.json')); }
export async function loadDams() { return (_dams ??= await getJson('/data/dams.json')); }
export async function loadStates() { return (_states ??= await getJson('/data/us_states.json')); }

/** Returns {name, code} of the US state containing [lon,lat], or null. */
export async function stateAt(lon, lat) {
  const s = await loadStates();
  for (const f of s.features) if (pointInGeometry([lon, lat], f.geometry)) return { name: f.name, code: f.code };
  return null;
}
