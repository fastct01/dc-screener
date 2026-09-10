/**
 * Deterministic multi-criteria site scoring. Every sub-score is a pure function of measured inputs,
 * returns 0–100 (or null when the input is unavailable), and carries a human-readable `basis` string
 * so the memo can cite exactly how the number was produced. Weights are user-configurable.
 *
 * Nothing here calls a network or an LLM.
 */

export const CRITERIA = [
  { key: 'substation',   label: 'Substation proximity',   weight: 30, group: 'Power' },
  { key: 'transmission', label: 'Transmission line',      weight: 10, group: 'Power' },
  { key: 'generation',   label: 'Generation proximity',   weight: 5,  group: 'Power' },
  { key: 'cluster',      label: 'DC ecosystem / fiber proxy', weight: 10, group: 'Connectivity' },
  { key: 'water',        label: 'Water proximity',        weight: 10, group: 'Water' },
  { key: 'climate',      label: 'Free-cooling climate',   weight: 12, group: 'Climate' },
  { key: 'flood',        label: 'Flood hazard',           weight: 8,  group: 'Hazard' },
  { key: 'seismic',      label: 'Seismic hazard',         weight: 5,  group: 'Hazard' },
  { key: 'slope',        label: 'Terrain slope',          weight: 5,  group: 'Land' },
  { key: 'incentives',   label: 'State DC tax incentives', weight: 5, group: 'Policy' },
];

export function defaultWeights() {
  return Object.fromEntries(CRITERIA.map((c) => [c.key, c.weight]));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Linear falloff: 100 at <= nearKm, 0 at >= farKm. */
const falloff = (km, nearKm, farKm) => (km <= nearKm ? 100 : km >= farKm ? 0 : 100 * (1 - (km - nearKm) / (farKm - nearKm)));
const r1 = (v) => Math.round(v * 10) / 10;

/** Parse an OSM `voltage` tag ("230000;115000", "138 kV") into the max value in kV, or null. */
export function parseVoltageKv(tag) {
  if (tag == null) return null;
  const s = String(tag).toLowerCase();
  const nums = [...s.matchAll(/[\d.]+/g)].map((m) => Number(m[0])).filter(Number.isFinite);
  if (!nums.length) return null;
  const max = Math.max(...nums);
  if (s.includes('kv')) return max;
  return max >= 1000 ? max / 1000 : max; // OSM convention is volts; tolerate kV entered bare
}

export function scoreSubstation({ km, kv }) {
  if (km == null) return { score: 0, basis: 'No substation found in the search envelope' };
  let score = falloff(km, 2, 30);
  let note = '';
  if (kv != null) {
    if (kv >= 230) { note = `${kv} kV (transmission-class)`; }
    else if (kv >= 100) { score *= 0.9; note = `${kv} kV (sub-transmission)`; }
    else { score *= 0.6; note = `${kv} kV (distribution-class, derated)`; }
  } else { score *= 0.85; note = 'voltage untagged (derated)'; }
  return { score: r1(score), basis: `${r1(km)} km to nearest substation; ${note}. 100 at ≤2 km → 0 at 30 km.` };
}

export function scoreTransmission({ km, kv }) {
  if (km == null) return { score: 0, basis: 'No power line found in the search envelope' };
  let score = falloff(km, 1, 20);
  let note;
  if (kv == null) { score *= 0.8; note = 'voltage untagged (derated)'; }
  else if (kv >= 230) note = `${kv} kV`;
  else if (kv >= 100) { score *= 0.85; note = `${kv} kV`; }
  else { score *= 0.5; note = `${kv} kV (distribution, derated)`; }
  return { score: r1(score), basis: `${r1(km)} km to nearest line; ${note}. 100 at ≤1 km → 0 at 20 km.` };
}

export function scoreGeneration({ km, name, kind }) {
  if (km == null) return { score: 0, basis: 'No power plant or dam found in the search envelope' };
  return { score: r1(falloff(km, 5, 100)), basis: `${r1(km)} km to ${kind || 'generation'}${name ? ` (${name})` : ''}. 100 at ≤5 km → 0 at 100 km.` };
}

export function scoreCluster({ count, radiusKm }) {
  if (count == null) return { score: null, basis: 'Existing data-center dataset unavailable' };
  const score = count === 0 ? 10 : count <= 2 ? 40 : count <= 5 ? 65 : count <= 15 ? 85 : 100;
  return { score, basis: `${count} mapped data center(s) within ${radiusKm} km (OSM). Proxy for fiber/ecosystem: 0→10, 1–2→40, 3–5→65, 6–15→85, >15→100.` };
}

export function scoreWater({ km, name, kind }) {
  if (km == null) return { score: 0, basis: 'No mapped water body or river in the search envelope' };
  return { score: r1(falloff(km, 2, 30)), basis: `${r1(km)} km to ${kind || 'water'}${name ? ` (${name})` : ''}. 100 at ≤2 km → 0 at 30 km. Water *stress* (WRI Aqueduct) not assessed in v0.1.` };
}

/**
 * Climate from hourly dry-bulb temps: fraction of hours ≤ 18 °C = full free-cooling (air-side economizer)
 * potential; 18–24 °C partial. p99 above 38 °C derates for chiller/generator sizing.
 */
export function scoreClimate({ freeHours, partialHours, totalHours, p99C }) {
  if (!totalHours) return { score: null, basis: 'Hourly climate data unavailable' };
  const frac = (freeHours + 0.5 * partialHours) / totalHours;
  let score = 100 * clamp(frac, 0, 1);
  let note = '';
  if (p99C != null && p99C > 38) { score *= 0.9; note = ` p99 dry-bulb ${r1(p99C)} °C > 38 °C (derated 10%).`; }
  return { score: r1(score), basis: `${freeHours} h ≤18 °C (full economizer) + ${partialHours} h 18–24 °C (partial, half credit) of ${totalHours} h → ${(100 * frac).toFixed(1)}% effective free-cooling.${note}` };
}

export function scoreFlood({ zone, subtype, covered }) {
  if (!covered) return { score: null, basis: 'Outside FEMA NFHL coverage or query failed' };
  if (!zone) return { score: 100, basis: 'No FEMA flood hazard polygon at point (outside mapped SFHA)' };
  const z = String(zone).toUpperCase();
  const sub = String(subtype || '').toUpperCase();
  if (z === 'X' || z === 'C' || z === 'B' || z === 'D') {
    if (sub.includes('0.2')) return { score: 60, basis: `FEMA zone ${z} (${subtype}) — 0.2% annual-chance (500-yr) floodplain` };
    return { score: 100, basis: `FEMA zone ${z}${subtype ? ` (${subtype})` : ''} — minimal flood hazard` };
  }
  if (z.startsWith('V')) return { score: 0, basis: `FEMA zone ${z} — coastal high-hazard (1% annual chance + wave action)` };
  if (z.startsWith('A')) return { score: 10, basis: `FEMA zone ${z}${subtype ? ` (${subtype})` : ''} — 1% annual-chance (100-yr) floodplain` };
  return { score: 50, basis: `FEMA zone ${z} — unclassified in scoring table` };
}

export function scoreSeismic({ pga }) {
  if (pga == null) return { score: null, basis: 'USGS design PGA unavailable (outside US coverage or query failed)' };
  const score = pga <= 0.05 ? 100 : pga <= 0.15 ? 75 : pga <= 0.3 ? 45 : pga <= 0.5 ? 20 : 5;
  return { score, basis: `USGS ASCE 7-22 design PGA ${pga.toFixed(3)} g (Site Class D, Risk Cat III). ≤0.05→100, ≤0.15→75, ≤0.3→45, ≤0.5→20, else 5.` };
}

export function scoreSlope({ slopePct }) {
  if (slopePct == null) return { score: null, basis: 'Terrain sampling unavailable' };
  const score = slopePct <= 2 ? 100 : slopePct <= 5 ? 85 : slopePct <= 10 ? 60 : slopePct <= 15 ? 30 : 5;
  return { score, basis: `Max local slope ${slopePct.toFixed(1)}% from a 3×3 terrain sample at 250 m spacing. ≤2→100, ≤5→85, ≤10→60, ≤15→30, else 5.` };
}

export function scoreIncentives({ state, hasProgram, programNote }) {
  if (!state) return { score: null, basis: 'Not inside a US state polygon (incentive table is US-only in v0.1)' };
  if (hasProgram) return { score: 100, basis: `${state}: ${programNote || 'data-center sales/use tax exemption on record'} (seed table — verify with NCSL/state statute)` };
  return { score: 30, basis: `${state}: no data-center tax program in seed table (verify with NCSL/state statute)` };
}

/**
 * Weighted composite over the sub-scores that are available (score !== null). Unavailable criteria are
 * excluded and the denominator renormalised, and `coverage` reports what share of total weight was scored.
 */
export function composite(subScores, weights) {
  let num = 0, den = 0, total = 0;
  for (const c of CRITERIA) {
    const w = Number(weights?.[c.key] ?? c.weight) || 0;
    total += w;
    const s = subScores[c.key]?.score;
    if (s == null) continue;
    num += w * s; den += w;
  }
  return { score: den ? Math.round((num / den) * 10) / 10 : 0, coverage: total ? Math.round((den / total) * 100) : 0 };
}

/** Rank candidates by composite score, then by coverage. Adds `rank` in place and returns the sorted array. */
export function rank(candidates) {
  const sorted = [...candidates].sort((a, b) => (b.composite.score - a.composite.score) || (b.composite.coverage - a.composite.coverage));
  sorted.forEach((c, i) => { c.rank = i + 1; });
  return sorted;
}
