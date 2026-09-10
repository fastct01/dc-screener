/**
 * Build compact runtime datasets from the provenance copies under data/.
 *  - data/datacenters/datacenters.geojsonl (OSM, ODbL)  -> public/data/datacenters.json  [{id,name,operator,lon,lat}]
 *  - data/dams/dams.geojsonl (OSM/OpenInfraMap, ODbL)   -> public/data/dams.json         [{id,name,lon,lat}]
 *  - data/natural_earth/ne_110m_admin_1_states_provinces.geojson (public domain) -> public/data/us_states.json
 * Centroids are the bbox center of the feature geometry — good enough for distance screening at km scale.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'data');

function walk(coords, acc) {
  if (typeof coords[0] === 'number') {
    acc.minX = Math.min(acc.minX, coords[0]); acc.maxX = Math.max(acc.maxX, coords[0]);
    acc.minY = Math.min(acc.minY, coords[1]); acc.maxY = Math.max(acc.maxY, coords[1]);
    return;
  }
  for (const c of coords) walk(c, acc);
}
function centroid(geometry) {
  if (!geometry) return null;
  const acc = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  if (geometry.type === 'GeometryCollection') geometry.geometries.forEach((g) => walk(g.coordinates, acc));
  else walk(geometry.coordinates, acc);
  if (!Number.isFinite(acc.minX)) return null;
  return [Number(((acc.minX + acc.maxX) / 2).toFixed(5)), Number(((acc.minY + acc.maxY) / 2).toFixed(5))];
}
function clean(v) { return typeof v === 'string' && v.trim() ? v.trim() : undefined; }
/** Best-effort OSM element type + positive id from geometry type and sign (osm2pgsql exports use negative ids for relations). */
function osmRef(id, geometry) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return `relation/${Math.abs(n)}`;
  const g = geometry?.type;
  return `${g === 'Point' ? 'node' : g === 'MultiPolygon' || g === 'MultiLineString' ? 'relation' : 'way'}/${n}`;
}

async function readJsonl(file) {
  const text = await fs.readFile(file, 'utf8');
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  await fs.mkdir(out, { recursive: true });

  const dcs = await readJsonl(path.join(root, 'data/datacenters/datacenters.geojsonl'));
  const dcOut = [];
  for (const f of dcs) {
    const c = centroid(f.geometry); if (!c) continue;
    const t = f.properties?.tags || {};
    dcOut.push({
      id: f.properties?.osm_id ?? f.id,
      ref: osmRef(f.properties?.osm_id ?? f.id, f.geometry),
      name: clean(t.name) || clean(t.operator) || 'Data center',
      operator: clean(t.operator) || clean(t['operator:short']),
      cap: clean(t['capacity:it_load']) || clean(t.it_load) || clean(t.capacity),
      web: clean(t.website) || clean(t['contact:website']),
      addr: [clean(t['addr:city']), clean(t['addr:state']), clean(t['addr:country'])].filter(Boolean).join(', ') || undefined,
      lon: c[0], lat: c[1],
    });
  }
  await fs.writeFile(path.join(out, 'datacenters.json'), JSON.stringify({
    source: 'OpenStreetMap contributors (ODbL 1.0), snapshot bundled via gods-eye-view', count: dcOut.length, features: dcOut,
  }));

  const dams = await readJsonl(path.join(root, 'data/dams/dams.geojsonl'));
  const damOut = [];
  for (const f of dams) {
    const c = centroid(f.geometry); if (!c) continue;
    const t = f.properties?.tags || f.properties || {};
    damOut.push({ id: f.id, ref: osmRef(f.id, f.geometry), name: clean(t.name) || 'Dam', op: clean(t.operator), lon: c[0], lat: c[1] });
  }
  await fs.writeFile(path.join(out, 'dams.json'), JSON.stringify({
    source: 'OpenStreetMap / Open Infrastructure Map (ODbL 1.0)', count: damOut.length, features: damOut,
  }));

  const ne = JSON.parse(await fs.readFile(path.join(root, 'data/natural_earth/ne_110m_admin_1_states_provinces.geojson'), 'utf8'));
  const states = ne.features.filter((f) => f.properties?.iso_a2 === 'US').map((f) => ({
    name: f.properties.name, code: f.properties.iso_3166_2, geometry: f.geometry,
  }));
  await fs.writeFile(path.join(out, 'us_states.json'), JSON.stringify({ source: 'Natural Earth 110m admin-1 (public domain)', count: states.length, features: states }));

  console.log(`datacenters: ${dcOut.length}, dams: ${damOut.length}, us_states: ${states.length} -> ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
