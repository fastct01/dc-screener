/**
 * Deterministic feasibility memo (Markdown). Every quantitative sentence points at an evidence row so a
 * reviewer can trace it to a source layer and a fetch timestamp. An LLM may later re-narrate this — but it
 * only ever receives this structured object, never raw freedom to invent numbers.
 */
import { CRITERIA } from './scoring.js';

const f1 = (v) => (v == null ? 'n/a' : Number(v).toFixed(1));

export function candidateMemo(c, req, ctx = {}) {
  const lines = [];
  lines.push(`# Site feasibility memo — Candidate ${c.id}`);
  lines.push('');
  lines.push(`**Location:** ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}${c.state ? ` (${c.state})` : ''}  `);
  lines.push(`**Rank:** ${c.rank} of ${ctx.total ?? '?'} · **Composite score:** ${c.composite.score}/100 · **Data coverage:** ${c.composite.coverage}% of weight scored  `);
  lines.push(`**Requirement:** ${req.itMw} MW IT · ${req.kwPerRack} kW/rack · ${c.design.tier.label} · generated ${ctx.generatedAt || new Date().toISOString()}`);
  lines.push('');
  lines.push('> Screening-grade assessment from public datasets. Not engineering-of-record. Interconnection queue position, utility capacity studies, parcel title, zoning and water-stress were **not** assessed in this version.');
  lines.push('');
  lines.push('## Scorecard');
  lines.push('');
  lines.push('| Criterion | Weight | Score | Basis |');
  lines.push('|---|---|---|---|');
  for (const cr of CRITERIA) {
    const s = c.sub[cr.key];
    lines.push(`| ${cr.label} | ${req.weights?.[cr.key] ?? cr.weight} | ${s?.score == null ? '—' : s.score} | ${s?.basis || ''} |`);
  }
  lines.push('');
  lines.push('## Recommended architecture (deterministic)');
  lines.push('');
  const d = c.design;
  lines.push(`- **Cooling:** ${d.cooling.label}. ${d.cooling.basis}`);
  lines.push(`- **Redundancy:** ${d.tier.label} — ${d.tier.redundancy}.`);
  lines.push(`- **Racks:** ~${d.racks.toLocaleString()} at ${req.kwPerRack} kW.`);
  lines.push(`- **PUE estimate:** ${d.pue.pue}. ${d.pue.basis}`);
  lines.push(`- **WUE estimate:** ${d.wue.value} L/kWh. ${d.wue.basis}`);
  lines.push(`- **Facility power:** ${d.power.facilityMw} MW → ${d.power.annualMwh.toLocaleString()} MWh/yr. ${d.power.basis}`);
  lines.push(`- **Capex:** $${d.capex.totalUsdM.toLocaleString()}M ($${d.capex.perMwUsdM}M/MW). ${d.capex.basis}`);
  lines.push(`- **Opex:** $${d.opex.totalUsdM.toLocaleString()}M/yr (energy $${d.opex.energyUsdM}M, water $${d.opex.waterUsdM}M ≈ ${d.opex.waterMegaL} ML, maintenance $${d.opex.maintUsdM}M). ${d.opex.basis}`);
  lines.push(`- **Efficiency upside vs. industry PUE 1.54:** $${d.vsIndustry.annualUsdM}M/yr. ${d.vsIndustry.basis}`);
  lines.push(`- **Interconnection:** ${d.interconnection.basis}`);
  lines.push('');
  lines.push('## Evidence trail');
  lines.push('');
  lines.push('| # | Source | Observation | Feature / ref | Fetched |');
  lines.push('|---|---|---|---|---|');
  c.evidence.forEach((e, i) => lines.push(`| ${i + 1} | ${e.source} | ${e.observation} | ${e.ref || ''} | ${e.fetchedAt || ''} |`));
  lines.push('');
  lines.push('## Caveats');
  lines.push('');
  for (const cv of caveats(c)) lines.push(`- ${cv}`);
  return lines.join('\n');
}

export function caveats(c) {
  const out = [];
  for (const cr of CRITERIA) {
    const s = c.sub[cr.key];
    if (s?.score == null) out.push(`${cr.label}: not scored (${s?.basis || 'no data'}); excluded from the composite and reflected in coverage.`);
  }
  out.push('OpenStreetMap power features are volunteer-mapped and incomplete; a missing substation is absent evidence, not evidence of absence.');
  out.push('Costs are 2026 planning ranges (JLL, Uptime, Epoch AI); confirm IT-MW vs facility-MW scope with the design team.');
  out.push('Land ownership, zoning, community sentiment, moratoria and utility queue position require primary diligence.');
  return out;
}

export function shortlistMarkdown(ranked, req, ctx = {}) {
  const lines = [`# Shortlist — ${ranked.length} candidates, ${req.itMw} MW IT, ${req.kwPerRack} kW/rack`, ''];
  lines.push(`Search bbox: W ${req.bbox.w.toFixed(3)} S ${req.bbox.s.toFixed(3)} E ${req.bbox.e.toFixed(3)} N ${req.bbox.n.toFixed(3)} · generated ${ctx.generatedAt || new Date().toISOString()}`, '');
  lines.push('| Rank | ID | Lat | Lon | Score | Coverage | Substation km | Line km | Free-cooling % | Flood | PGA g | Slope % | Cooling | PUE | Capex $M |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of ranked) {
    const m = c.measures;
    lines.push(`| ${c.rank} | ${c.id} | ${c.lat.toFixed(4)} | ${c.lon.toFixed(4)} | ${c.composite.score} | ${c.composite.coverage}% | ${f1(m.substationKm)} | ${f1(m.lineKm)} | ${m.freeCoolingFrac == null ? 'n/a' : (100 * m.freeCoolingFrac).toFixed(0)} | ${m.floodZone ?? (m.floodCovered ? 'none' : 'n/a')} | ${m.pga == null ? 'n/a' : m.pga.toFixed(2)} | ${f1(m.slopePct)} | ${c.design.cooling.key} | ${c.design.pue.pue} | ${c.design.capex.totalUsdM} |`);
  }
  return lines.join('\n');
}

export function toCsv(ranked) {
  const head = ['rank', 'id', 'lat', 'lon', 'score', 'coverage', ...CRITERIA.map((c) => c.key), 'substation_km', 'substation_kv', 'line_km', 'line_kv', 'generation_km', 'dc_within_50km', 'water_km', 'free_cooling_frac', 'p99_c', 'flood_zone', 'pga_g', 'slope_pct', 'state', 'cooling', 'pue', 'facility_mw', 'capex_usd_m', 'opex_usd_m'];
  const rows = ranked.map((c) => {
    const m = c.measures, d = c.design;
    return [c.rank, c.id, c.lat, c.lon, c.composite.score, c.composite.coverage, ...CRITERIA.map((cr) => c.sub[cr.key]?.score ?? ''), m.substationKm ?? '', m.substationKv ?? '', m.lineKm ?? '', m.lineKv ?? '', m.generationKm ?? '', m.dcCount ?? '', m.waterKm ?? '', m.freeCoolingFrac ?? '', m.p99C ?? '', m.floodZone ?? '', m.pga ?? '', m.slopePct ?? '', c.state ?? '', d.cooling.key, d.pue.pue, d.power.facilityMw, d.capex.totalUsdM, d.opex.totalUsdM];
  });
  return [head, ...rows].map((r) => r.map((v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n');
}
