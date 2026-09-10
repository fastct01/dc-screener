import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, pointToSegmentKm, pointToPolylineKm, gridCandidates, bboxFromCenter, pointInGeometry, countWithinKm } from '../src/engine/geo.js';
import { parseVoltageKv, scoreSubstation, scoreFlood, scoreSeismic, scoreClimate, composite, rank, defaultWeights, CRITERIA } from '../src/engine/scoring.js';
import { recommendCooling, estimatePue, sizePower, estimateCapex, designBundle, pueSavings } from '../src/engine/calculators.js';

test('haversine: Dallas → Austin ≈ 293 km', () => {
  const km = haversineKm([-96.797, 32.777], [-97.743, 30.267]);
  assert.ok(Math.abs(km - 293) < 4, `got ${km}`);
});

test('point-to-segment: 1° south of an E-W segment is ~110.6 km', () => {
  const d = pointToSegmentKm([0, 0], [-1, 1], [1, 1]);
  assert.ok(Math.abs(d - 110.574) < 0.5, `got ${d}`);
  // beyond the endpoint, distance goes to the endpoint
  const d2 = pointToSegmentKm([3, 1], [-1, 1], [1, 1]);
  assert.ok(Math.abs(d2 - 2 * 111.32) < 1, `got ${d2}`);
  assert.equal(pointToPolylineKm([0, 0], [[0, 0]]), 0);
});

test('grid candidates are cell centres', () => {
  const pts = gridCandidates({ w: 0, s: 0, e: 2, n: 2 }, 2);
  assert.deepEqual(pts.map((p) => [p.lon, p.lat]), [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5], [1.5, 1.5]]);
  const b = bboxFromCenter(-97, 31, 50);
  assert.ok(Math.abs(haversineKm([b.w, 31], [b.e, 31]) - 100) < 0.5);
});

test('point in polygon with hole', () => {
  const geom = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  assert.equal(pointInGeometry([1, 1], geom), true);
  assert.equal(pointInGeometry([5, 5], geom), false);
  assert.equal(pointInGeometry([11, 5], geom), false);
  assert.equal(countWithinKm([0, 0], [{ p: [0, 0.1] }, { p: [5, 5] }], (i) => i.p, 50), 1);
});

test('voltage tag parsing', () => {
  assert.equal(parseVoltageKv('230000;115000'), 230);
  assert.equal(parseVoltageKv('138 kV'), 138);
  assert.equal(parseVoltageKv('345'), 345);
  assert.equal(parseVoltageKv(undefined), null);
});

test('substation score falls off and derates by voltage', () => {
  assert.equal(scoreSubstation({ km: 1, kv: 345 }).score, 100);
  assert.equal(scoreSubstation({ km: 16, kv: 345 }).score, 50);
  assert.equal(scoreSubstation({ km: 1, kv: 12 }).score, 60);
  assert.equal(scoreSubstation({ km: null }).score, 0);
});

test('flood + seismic + climate tables', () => {
  assert.equal(scoreFlood({ covered: true, zone: 'AE' }).score, 10);
  assert.equal(scoreFlood({ covered: true, zone: 'X', subtype: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD' }).score, 60);
  assert.equal(scoreFlood({ covered: false }).score, null);
  assert.equal(scoreSeismic({ pga: 0.1 }).score, 75);
  const c = scoreClimate({ freeHours: 4380, partialHours: 0, totalHours: 8760, p99C: 30 });
  assert.equal(c.score, 50);
});

test('composite renormalises over available criteria and ranks', () => {
  const w = defaultWeights();
  const all100 = Object.fromEntries(CRITERIA.map((c) => [c.key, { score: 100 }]));
  assert.deepEqual(composite(all100, w), { score: 100, coverage: 100 });
  const partial = { ...all100, flood: { score: null }, seismic: { score: null } };
  const r = composite(partial, w);
  assert.equal(r.score, 100);
  assert.equal(r.coverage, 87);
  const ranked = rank([{ id: 'a', composite: { score: 40, coverage: 90 } }, { id: 'b', composite: { score: 70, coverage: 90 } }]);
  assert.deepEqual(ranked.map((c) => c.id), ['b', 'a']);
  assert.equal(ranked[0].rank, 1);
});

test('calculators: cooling choice, PUE, power, capex, TCO bundle', () => {
  assert.equal(recommendCooling(20), 'air');
  assert.equal(recommendCooling(132), 'dlc');
  assert.equal(recommendCooling(240), 'immersion');
  assert.equal(estimatePue('air', 0).pue, 1.45);
  assert.equal(estimatePue('air', 1).pue, 1.25);
  const p = sizePower({ itMw: 100, pue: 1.2, utilization: 1 });
  assert.equal(p.facilityMw, 120);
  assert.equal(p.annualMwh, 1051200);
  const cap = estimateCapex({ itMw: 100, tier: 3, coolingKey: 'air', region: 'US' });
  assert.equal(cap.totalUsdM, 1130);
  // plan.md: PUE 1.20 vs 1.54 on 50 MW IT ≈ $10M/yr — at $0.07/kWh & 85% util this is ~$8.9M; sanity-band it
  const s = pueSavings({ itMw: 50, pueA: 1.54, pueB: 1.2, usdPerKwh: 0.08, utilization: 0.85 });
  assert.ok(s.annualUsdM > 8 && s.annualUsdM < 12, `got ${s.annualUsdM}`);
  const b = designBundle({ itMw: 50, kwPerRack: 130, tier: 3, freeCoolingFrac: 0.5 });
  assert.equal(b.cooling.key, 'dlc');
  assert.equal(b.racks, 385);
  assert.ok(b.pue.pue > 1.1 && b.pue.pue < 1.16);
  assert.ok(b.capex.totalUsdM > 600);
});
