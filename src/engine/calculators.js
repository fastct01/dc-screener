/**
 * Deterministic sizing, PUE/WUE and TCO calculators seeded from the benchmarks in plan.md
 * (JLL 2026, Uptime 2024/2025, Epoch AI 2026, Schneider). Every output carries the assumption it used.
 * All money in USD; MW are IT MW unless named otherwise.
 */

export const COOLING = {
  air:       { label: 'Air (CRAH/CRAC)',            maxKwRack: 30,  basePue: 1.45, econGain: 0.20, wue: 1.8, capexAdder: 0.00 },
  rdhx:      { label: 'Rear-door heat exchanger',   maxKwRack: 50,  basePue: 1.35, econGain: 0.18, wue: 1.2, capexAdder: 0.05 },
  dlc:       { label: 'Direct-to-chip liquid (DLC)', maxKwRack: 150, basePue: 1.15, econGain: 0.07, wue: 0.4, capexAdder: 0.25 },
  immersion: { label: 'Immersion',                  maxKwRack: 250, basePue: 1.08, econGain: 0.04, wue: 0.2, capexAdder: 0.30 },
};

export const TIERS = {
  1: { label: 'Tier I',   redundancy: 'N',                                   capexPerMw: 8.0,  multiplier: 0.85 },
  2: { label: 'Tier II',  redundancy: 'N+1 capacity components',            capexPerMw: 9.0,  multiplier: 0.90 },
  3: { label: 'Tier III', redundancy: 'Concurrently maintainable: N+1 supply/gen, 2N UPS & distribution', capexPerMw: 11.3, multiplier: 1.00 },
  4: { label: 'Tier IV',  redundancy: 'Fault tolerant: 2N / 2(N+1)',        capexPerMw: 13.5, multiplier: 1.20 },
};

/** Regional shell-and-core multipliers vs. US (plan.md: Singapore ~$16M, UK/DE ~$14M, US ~$12M, India ~$6.5M per MW). */
export const REGION_MULTIPLIER = { US: 1.0, UK: 1.17, DE: 1.17, SG: 1.33, IN: 0.54 };

export function recommendCooling(kwPerRack) {
  if (kwPerRack <= 30) return 'air';
  if (kwPerRack <= 50) return 'rdhx';
  if (kwPerRack <= 150) return 'dlc';
  return 'immersion';
}

/** PUE estimate: cooling base PUE less an economizer credit proportional to effective free-cooling fraction. */
export function estimatePue(coolingKey, freeCoolingFrac = 0) {
  const c = COOLING[coolingKey] || COOLING.air;
  const f = Math.max(0, Math.min(1, freeCoolingFrac || 0));
  const pue = c.basePue - c.econGain * f;
  return {
    pue: Math.round(pue * 100) / 100,
    basis: `${c.label}: base PUE ${c.basePue} − ${c.econGain} × ${(100 * f).toFixed(0)}% effective free-cooling. Benchmarks: industry avg 1.54 (Uptime 2025), best-in-class hyperscale 1.08–1.20, DLC 1.03–1.10.`,
  };
}

export function sizePower({ itMw, pue, utilization = 0.85 }) {
  const facilityMw = itMw * pue;
  const annualMwh = facilityMw * 8760 * utilization;
  return {
    facilityMw: r2(facilityMw), annualMwh: Math.round(annualMwh),
    basis: `Facility MW = IT ${itMw} MW × PUE ${pue}; annual MWh = facility MW × 8,760 h × ${(utilization * 100).toFixed(0)}% utilization.`,
  };
}

export function estimateCapex({ itMw, tier = 3, coolingKey = 'air', region = 'US', aiFitOut = false }) {
  const t = TIERS[tier] || TIERS[3];
  const c = COOLING[coolingKey] || COOLING.air;
  const regionMult = REGION_MULTIPLIER[region] ?? 1.0;
  const perMw = t.capexPerMw * (1 + c.capexAdder) * regionMult;
  const shell = perMw * itMw;
  const fitOut = aiFitOut ? 25 * itMw : 0;
  return {
    perMwUsdM: r2(perMw), shellUsdM: r1(shell), fitOutUsdM: r1(fitOut), totalUsdM: r1(shell + fitOut),
    basis: `${t.label} base $${t.capexPerMw}M/MW (JLL 2026 global shell-and-core avg $11.3M/MW) × (1 + ${c.capexAdder} cooling adder for ${c.label}) × ${regionMult} region${aiFitOut ? ' + $25M/MW AI tenant fit-out (JLL)' : ''}. Excludes land, GPUs/servers, and interconnection fees.`,
  };
}

export function estimateOpex({ annualMwh, usdPerKwh = 0.07, itMw, wue, pue, utilization = 0.85, waterUsdPerM3 = 1.0 }) {
  const energyUsdM = (annualMwh * 1000 * usdPerKwh) / 1e6;
  const itKwh = itMw * 1000 * 8760 * utilization;
  const waterL = (wue || 0) * itKwh;
  const waterUsdM = (waterL / 1000) * waterUsdPerM3 / 1e6;
  const maintUsdM = itMw * 0.15; // ~$150k/MW/yr facility maintenance + staffing placeholder
  return {
    energyUsdM: r1(energyUsdM), waterMegaL: r1(waterL / 1e6), waterUsdM: r2(waterUsdM), maintUsdM: r1(maintUsdM),
    totalUsdM: r1(energyUsdM + waterUsdM + maintUsdM),
    basis: `Energy = ${annualMwh.toLocaleString()} MWh × $${usdPerKwh}/kWh; water = WUE ${wue} L/kWh × IT kWh × $${waterUsdPerM3}/m³; maintenance placeholder $0.15M/IT-MW/yr. PUE ${pue}. Excludes IT hardware refresh.`,
  };
}

export function pueSavings({ itMw, pueA, pueB, usdPerKwh = 0.07, utilization = 0.85 }) {
  const dMwh = itMw * (pueA - pueB) * 8760 * utilization;
  return { annualUsdM: r1((dMwh * 1000 * usdPerKwh) / 1e6), basis: `PUE ${pueA} → ${pueB} on ${itMw} MW IT saves ${Math.round(dMwh).toLocaleString()} MWh/yr at $${usdPerKwh}/kWh.` };
}

/** Full deterministic design + TCO bundle for one candidate. */
export function designBundle({ itMw, kwPerRack, tier = 3, region = 'US', usdPerKwh = 0.07, utilization = 0.85, freeCoolingFrac = 0, aiFitOut = false, coolingOverride = null }) {
  const coolingKey = coolingOverride || recommendCooling(kwPerRack);
  const cooling = COOLING[coolingKey];
  const t = TIERS[tier] || TIERS[3];
  const pue = estimatePue(coolingKey, freeCoolingFrac);
  const power = sizePower({ itMw, pue: pue.pue, utilization });
  const capex = estimateCapex({ itMw, tier, coolingKey, region, aiFitOut });
  const opex = estimateOpex({ annualMwh: power.annualMwh, usdPerKwh, itMw, wue: cooling.wue, pue: pue.pue, utilization });
  const racks = Math.ceil((itMw * 1000) / kwPerRack);
  const vsIndustry = pueSavings({ itMw, pueA: 1.54, pueB: pue.pue, usdPerKwh, utilization });
  return {
    cooling: { key: coolingKey, label: cooling.label, maxKwRack: cooling.maxKwRack, basis: `${kwPerRack} kW/rack → ${cooling.label} (air ≤30, RDHx ≤50, DLC ≤150, immersion above). Air cooling fails above ~50–100 kW/rack.` },
    tier: { level: tier, label: t.label, redundancy: t.redundancy },
    racks, pue, power, capex, opex, wue: { value: cooling.wue, basis: `Typical WUE for ${cooling.label} (L/kWh). Industry avg 1.8–1.9, best-in-class 0.3–0.7.` },
    vsIndustry,
    interconnection: { basis: 'Interconnection queue timing NOT assessed (no free feed). LBNL Queued Up 2025: avg 55 months in queue for projects energised in 2024; 5–7 yrs in constrained markets.' },
  };
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
