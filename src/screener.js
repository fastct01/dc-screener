/**
 * The screening pipeline: candidates → measurements (data adapters) → sub-scores (pure) → composite → design bundle.
 * Runs in the browser; every step appends to the candidate's evidence trail.
 */
import { gridCandidates, expandBbox, nearestPoint, nearestLine, countWithinKm } from './engine/geo.js';
import * as S from './engine/scoring.js';
import { designBundle } from './engine/calculators.js';
import { lookupProgram } from './engine/incentives.js';
import { loadDatacenters, loadDams, stateAt } from './data/localData.js';
import { fetchPowerWater } from './data/overpass.js';
import { fetchClimate } from './data/climate.js';
import { fetchFlood, fetchSeismic } from './data/hazards.js';
import { sampleSlopePct } from './globe.js';

const DC_RADIUS_KM = 50;
const ENVELOPE_KM = 40;

export async function runScreening(req, { terrainProvider, onProgress = () => {}, concurrency = 4 } = {}) {
  const generatedAt = new Date().toISOString();
  const candidates = req.points?.length ? req.points.map((p, i) => ({ id: p.id || `P${i + 1}`, lon: p.lon, lat: p.lat })) : gridCandidates(req.bbox, req.gridN).map((p, i) => ({ id: `G${i + 1}`, ...p }));
  candidates.forEach((c) => { c.evidence = []; c.measures = {}; c.sub = {}; });

  onProgress({ stage: 'Loading bundled datasets', pct: 2 });
  const [dcs, dams] = await Promise.all([loadDatacenters(), loadDams()]);

  onProgress({ stage: 'Querying OpenStreetMap power & water (Overpass)', pct: 6 });
  const envelope = expandBbox(req.bbox, ENVELOPE_KM);
  let osm;
  try { osm = await fetchPowerWater(envelope); }
  catch (e) { osm = { substations: [], plants: [], lines: [], water: [], rivers: [], fetchedAt: generatedAt, error: String(e.message || e) }; }

  // Per-candidate remote lookups with bounded concurrency
  let done = 0;
  const queue = [...candidates];
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      await measureCandidate(c, { req, osm, dcs, dams, terrainProvider });
      done++;
      onProgress({ stage: `Measuring candidates (${done}/${candidates.length})`, pct: 10 + Math.round((85 * done) / candidates.length) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));

  onProgress({ stage: 'Scoring & ranking', pct: 97 });
  for (const c of candidates) {
    c.composite = S.composite(c.sub, req.weights);
    c.design = designBundle({ itMw: req.itMw, kwPerRack: req.kwPerRack, tier: req.tier, usdPerKwh: req.usdPerKwh, utilization: req.utilization, freeCoolingFrac: c.measures.freeCoolingFrac || 0, aiFitOut: req.aiFitOut, coolingOverride: req.cooling === 'auto' ? null : req.cooling });
  }
  const ranked = S.rank(candidates);
  onProgress({ stage: 'Done', pct: 100 });
  return { ranked, osm, generatedAt, envelope };
}

async function measureCandidate(c, { req, osm, dcs, dams, terrainProvider }) {
  const p = [c.lon, c.lat];
  const m = c.measures;
  const ev = (source, observation, ref, fetchedAt) => c.evidence.push({ source, observation, ref, fetchedAt });

  // --- Power (OSM) ---
  const sub = nearestPoint(p, osm.substations, (s) => s.p);
  m.substationKm = sub ? +sub.km.toFixed(2) : null; m.substationKv = sub?.item.kv ?? null; m.substationName = sub?.item.name || null;
  c.sub.substation = S.scoreSubstation({ km: m.substationKm, kv: m.substationKv });
  ev('OSM power=substation', sub ? `${m.substationKm} km, ${m.substationKv ?? '?'} kV${sub.item.name ? `, "${sub.item.name}"` : ''}` : `none within ${ENVELOPE_KM} km envelope${osm.error ? ` (Overpass error: ${osm.error})` : ''}`, sub?.item.ref, osm.fetchedAt);

  const line = nearestLine(p, osm.lines, (l) => l.line);
  m.lineKm = line ? +line.km.toFixed(2) : null; m.lineKv = line?.item.kv ?? null;
  c.sub.transmission = S.scoreTransmission({ km: m.lineKm, kv: m.lineKv });
  ev('OSM power=line', line ? `${m.lineKm} km, ${m.lineKv ?? '?'} kV` : 'none in envelope', line?.item.ref, osm.fetchedAt);

  const plant = nearestPoint(p, osm.plants, (s) => s.p);
  const dam = nearestPoint(p, dams.features, (d) => [d.lon, d.lat]);
  let gen = null;
  if (plant && (!dam || plant.km <= dam.km)) gen = { km: plant.km, name: plant.item.name, kind: `power plant${plant.item.source ? ` (${plant.item.source})` : ''}`, ref: plant.item.ref, src: 'OSM power=plant' };
  else if (dam) gen = { km: dam.km, name: dam.item.name, kind: 'dam (hydro proxy)', ref: `dam/${dam.item.id}`, src: 'OSM/OpenInfraMap dams (bundled)' };
  m.generationKm = gen ? +gen.km.toFixed(2) : null; m.generationName = gen?.name || null;
  c.sub.generation = S.scoreGeneration({ km: m.generationKm, name: gen?.name, kind: gen?.kind });
  ev(gen?.src || 'OSM power=plant', gen ? `${m.generationKm} km to ${gen.kind}${gen.name ? ` "${gen.name}"` : ''}` : 'none in envelope', gen?.ref, osm.fetchedAt);

  // --- Ecosystem (bundled OSM data centers) ---
  m.dcCount = countWithinKm(p, dcs.features, (d) => [d.lon, d.lat], DC_RADIUS_KM);
  const nearestDc = nearestPoint(p, dcs.features, (d) => [d.lon, d.lat]);
  m.nearestDcKm = nearestDc ? +nearestDc.km.toFixed(1) : null; m.nearestDcName = nearestDc?.item.name || null;
  c.sub.cluster = S.scoreCluster({ count: m.dcCount, radiusKm: DC_RADIUS_KM });
  ev('OSM telecom=data_center (bundled snapshot)', `${m.dcCount} within ${DC_RADIUS_KM} km; nearest ${m.nearestDcKm ?? '?'} km${nearestDc ? ` "${nearestDc.item.name}"` : ''}`, nearestDc ? `osm/${nearestDc.item.id}` : null, 'bundled');

  // --- Water (OSM) ---
  const wb = nearestPoint(p, osm.water, (w) => w.p);
  const rv = nearestLine(p, osm.rivers, (r) => r.line);
  let water = null;
  if (wb && (!rv || wb.km <= rv.km)) water = { km: wb.km, name: wb.item.name, kind: wb.item.kind, ref: wb.item.ref };
  else if (rv) water = { km: rv.km, name: rv.item.name, kind: 'river', ref: rv.item.ref };
  m.waterKm = water ? +water.km.toFixed(2) : null; m.waterName = water?.name || null;
  c.sub.water = S.scoreWater({ km: m.waterKm, name: water?.name, kind: water?.kind });
  ev('OSM natural=water / waterway=river', water ? `${m.waterKm} km to ${water.kind}${water.name ? ` "${water.name}"` : ''}` : 'none in envelope', water?.ref, osm.fetchedAt);

  // --- Remote per-point lookups in parallel ---
  const [climate, flood, seismic, slope, state] = await Promise.all([
    fetchClimate(c.lat, c.lon).catch((e) => ({ error: String(e.message || e) })),
    fetchFlood(c.lat, c.lon).catch((e) => ({ covered: false, error: String(e.message || e) })),
    fetchSeismic(c.lat, c.lon).catch((e) => ({ pga: null, error: String(e.message || e) })),
    terrainProvider ? sampleSlopePct(terrainProvider, c.lon, c.lat).catch(() => null) : Promise.resolve(null),
    stateAt(c.lon, c.lat).catch(() => null),
  ]);

  if (climate.totalHours) {
    Object.assign(m, { freeCoolingFrac: +climate.freeCoolingFrac.toFixed(4), freeHours: climate.freeHours, partialHours: climate.partialHours, hotHours: climate.hotHours, meanC: climate.meanC, p99C: climate.p99C, meanWetBulbC: climate.meanWetBulbC, climateYear: climate.year });
    c.sub.climate = S.scoreClimate(climate);
    ev(climate.source, `${climate.year}: mean ${climate.meanC} °C, p99 ${climate.p99C} °C, ${climate.freeHours} h ≤18 °C, ${climate.partialHours} h 18–24 °C, ${climate.hotHours} h ≥32 °C, mean wet-bulb ${climate.meanWetBulbC} °C`, `archive-api.open-meteo.com ${c.lat},${c.lon}`, climate.fetchedAt);
  } else {
    m.freeCoolingFrac = null;
    c.sub.climate = S.scoreClimate({ totalHours: 0 });
    ev('Open-Meteo', `unavailable: ${climate.error || 'no data'}`, null, null);
  }

  m.floodCovered = !!flood.covered; m.floodZone = flood.covered ? (flood.zone || null) : null; m.floodSubtype = flood.subtype || null;
  c.sub.flood = S.scoreFlood(flood);
  ev(flood.source || 'FEMA NFHL', flood.covered ? (flood.zone ? `zone ${flood.zone}${flood.subtype ? ` (${flood.subtype})` : ''}, SFHA=${flood.sfha}` : 'no flood-hazard polygon at point') : `unavailable: ${flood.error || 'no coverage'}`, 'NFHL MapServer/28', flood.fetchedAt);

  m.pga = seismic.pga ?? null; m.sdc = seismic.sdc ?? null;
  c.sub.seismic = S.scoreSeismic({ pga: m.pga });
  ev(seismic.source || 'USGS Design Maps', m.pga != null ? `PGA ${m.pga} g, Ss ${seismic.ss}, S1 ${seismic.s1}${seismic.sdc ? `, SDC ${seismic.sdc}` : ''}` : `unavailable: ${seismic.error || 'outside coverage'}`, 'asce7-22.json', seismic.fetchedAt);

  m.slopePct = slope?.slopePct ?? null; m.elevationM = slope?.elevationM ?? null;
  c.sub.slope = S.scoreSlope({ slopePct: m.slopePct });
  ev('Re:Earth terrain (Cesium sampleTerrainMostDetailed)', slope ? `max slope ${slope.slopePct}% over 3×3 @ 250 m; elevation ${slope.elevationM} m (ellipsoidal)` : 'terrain sample unavailable', null, new Date().toISOString());

  c.state = state?.name || null; c.stateCode = state?.code || null;
  const prog = lookupProgram(state?.code);
  c.sub.incentives = S.scoreIncentives({ state: state?.name, hasProgram: prog.hasProgram, programNote: prog.note });
  ev('Natural Earth admin-1 + seed incentive table', state ? `${state.name} (${state.code}): ${prog.hasProgram ? prog.note : 'no program in seed table'}` : 'not inside a US state polygon', null, 'bundled');
}
