import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceHourly, stullWetBulb } from '../src/data/climate.js';
import { normaliseElements, buildPowerWaterQuery } from '../src/data/overpass.js';

test('climate reducer counts economizer hours', () => {
  const temps = [10, 15, 18, 20, 24, 30, 33, null];
  const r = reduceHourly(temps, temps.map(() => 50));
  assert.equal(r.totalHours, 7);
  assert.equal(r.freeHours, 3);
  assert.equal(r.partialHours, 2);
  assert.equal(r.hotHours, 1);
  assert.equal(r.freeCoolingFrac, 4 / 7);
  assert.ok(Math.abs(stullWetBulb(20, 50) - 13.7) < 0.3);
});

test('overpass normaliser buckets features and keeps refs', () => {
  const out = normaliseElements([
    { type: 'node', id: 1, lat: 1, lon: 2, tags: { power: 'substation', voltage: '345000' } },
    { type: 'way', id: 2, center: { lat: 1, lon: 2 }, tags: { power: 'plant', 'plant:source': 'gas' } },
    { type: 'way', id: 3, geometry: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }], tags: { power: 'line', voltage: '138000;69000' } },
    { type: 'way', id: 4, geometry: [{ lat: 0, lon: 0 }], tags: { waterway: 'river', name: 'Brazos' } },
    { type: 'relation', id: 5, center: { lat: 3, lon: 3 }, tags: { natural: 'water', water: 'reservoir' } },
  ]);
  assert.equal(out.substations[0].kv, 345);
  assert.equal(out.substations[0].ref, 'node/1');
  assert.equal(out.plants[0].source, 'gas');
  assert.equal(out.lines[0].kv, 138);
  assert.equal(out.rivers[0].name, 'Brazos');
  assert.equal(out.water[0].kind, 'reservoir');
  assert.match(buildPowerWaterQuery({ s: 30, w: -98, n: 31, e: -97 }), /30\.00000,-98\.00000,31\.00000,-97\.00000/);
});
