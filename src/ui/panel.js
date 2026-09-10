/** DOM glue: form state, weights, results table, detail tabs, exports. No Cesium in here. */
import { CRITERIA, defaultWeights } from '../engine/scoring.js';
import { candidateMemo, shortlistMarkdown, toCsv } from '../engine/memo.js';
import { scoreColorCss } from '../layers.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export class Panel {
  constructor({ onRun, onSelect, onSave, onDraw, onPin, onLayer, onNarrate }) {
    this.cb = { onRun, onSelect, onSave, onDraw, onPin, onLayer, onNarrate };
    this.weights = defaultWeights();
    this.result = null; this.req = null; this.selected = null;
    this._buildWeights();
    $('btn-run').addEventListener('click', () => this.cb.onRun(this.readRequest()));
    $('btn-draw').addEventListener('click', () => this.cb.onDraw());
    $('btn-pin').addEventListener('click', () => this.cb.onPin());
    $('btn-save-run').addEventListener('click', () => this.result && this.cb.onSave());
    $('btn-narrate').addEventListener('click', () => this.selected && this.cb.onNarrate(this.selected));
    $('btn-memo-md').addEventListener('click', () => this.selected && download(`memo-${this.selected.id}.md`, candidateMemo(this.selected, this.req, { total: this.result.ranked.length, generatedAt: this.result.generatedAt })));
    $('btn-export-csv').addEventListener('click', () => this.result && download('shortlist.csv', toCsv(this.result.ranked)));
    $('btn-export-md').addEventListener('click', () => this.result && download('shortlist.md', shortlistMarkdown(this.result.ranked, this.req, this.result)));
    $('btn-export-json').addEventListener('click', () => this.result && download('screening.json', JSON.stringify({ request: this.req, generatedAt: this.result.generatedAt, candidates: this.result.ranked }, null, 2)));
    $('btn-close-results').addEventListener('click', () => this.closeResults());
    $('btn-show-results').addEventListener('click', () => this.openResults());
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.tab)));
    document.querySelectorAll('#layers input').forEach((i) => i.addEventListener('change', () => this.cb.onLayer(i.dataset.layer, i.checked)));
    for (const id of ['in-lat', 'in-lon', 'in-half']) $(id).addEventListener('change', () => this.cb.onDraw?.('fromInputs'));
  }

  _buildWeights() {
    const host = $('weights');
    host.innerHTML = '';
    for (const c of CRITERIA) {
      const row = document.createElement('div'); row.className = 'weight';
      row.innerHTML = `<span title="${esc(c.group)}">${esc(c.label)}</span><input type="range" min="0" max="40" value="${c.weight}" data-key="${c.key}" /><span class="mono" data-val="${c.key}">${c.weight}</span>`;
      const input = row.querySelector('input');
      input.addEventListener('input', () => { this.weights[c.key] = Number(input.value); row.querySelector('[data-val]').textContent = input.value; });
      host.appendChild(row);
    }
  }

  /** Flash the save button so the user sees the screening landed in History. */
  flashSaved(name) {
    const b = $('btn-save-run'); b.textContent = 'Saved ✓'; b.title = name ? `Saved as “${name}”` : 'Saved to History';
    clearTimeout(this._savedTimer); this._savedTimer = setTimeout(() => { b.textContent = 'Save screening'; }, 1800);
  }

  /** Push a saved request back into the form so a reopened screening looks exactly like it did when it ran. */
  applyRequest(req) {
    $('in-grid').value = String(req.gridN); $('in-mw').value = req.itMw; $('in-kw').value = req.kwPerRack;
    $('in-tier').value = String(req.tier); $('in-cooling').value = req.cooling; $('in-price').value = req.usdPerKwh;
    $('in-util').value = req.utilization; $('in-fitout').checked = !!req.aiFitOut;
    if (req.bbox) { $('in-half').value = Math.round(((req.bbox.n - req.bbox.s) / 2) * 111); }
    this.weights = { ...defaultWeights(), ...(req.weights || {}) };
    this._buildWeights();
    this.setBbox(req.bbox || null);
    this.setPins(req.points || []);
  }

  readRequest() {
    return {
      bbox: this.bbox, points: this.pins?.length ? this.pins : null,
      gridN: Number($('in-grid').value), itMw: Number($('in-mw').value), kwPerRack: Number($('in-kw').value),
      tier: Number($('in-tier').value), cooling: $('in-cooling').value, usdPerKwh: Number($('in-price').value),
      utilization: Number($('in-util').value), aiFitOut: $('in-fitout').checked, weights: { ...this.weights },
    };
  }

  setBbox(bbox) {
    this.bbox = bbox;
    $('bbox-readout').textContent = bbox ? `bbox: W ${bbox.w.toFixed(3)} S ${bbox.s.toFixed(3)} E ${bbox.e.toFixed(3)} N ${bbox.n.toFixed(3)}` : 'bbox: —';
    if (bbox) { $('in-lat').value = ((bbox.n + bbox.s) / 2).toFixed(4); $('in-lon').value = ((bbox.e + bbox.w) / 2).toFixed(4); }
  }
  readCenter() { return { lat: Number($('in-lat').value), lon: Number($('in-lon').value), halfKm: Number($('in-half').value) }; }
  setPins(pins) {
    this.pins = pins;
    const el = $('pins-readout');
    el.hidden = !pins.length;
    el.textContent = pins.length ? `${pins.length} pin(s) will be screened instead of the grid · ${pins.map((p) => p.id).join(', ')}` : '';
  }
  setMode(mode) {
    $('btn-draw').classList.toggle('active', mode === 'draw');
    $('btn-pin').classList.toggle('active', mode === 'pin');
    const hint = $('hint');
    hint.hidden = !mode;
    hint.textContent = mode === 'draw' ? 'Press and drag on the globe to draw the search box (globe stays still) · drag a corner handle to resize · Esc to cancel' : mode === 'pin' ? 'Click to drop candidate pins · Esc to finish · Shift-click a pin to remove' : '';
  }

  setRunning(on) { $('btn-run').disabled = on; $('progress').hidden = !on && !this.result; $('run-error').hidden = true; }
  setProgress({ stage, pct }) { $('progress').hidden = false; $('progress-fill').style.width = `${pct}%`; $('progress-stage').textContent = stage; }
  setError(msg) { const e = $('run-error'); e.hidden = false; e.textContent = msg; }
  setNarrateEnabled(on) { const b = $('btn-narrate'); b.disabled = !on; b.title = on ? 'Ask Claude to narrate this scorecard (numbers are never recomputed)' : 'Set ANTHROPIC_API_KEY in .env to enable'; }

  showResults(result, req) {
    this.result = result; this.req = req;
    this.openResults();
    $('results-title').textContent = `Results · ${result.ranked.length} candidates · ${req.itMw} MW`;
    const tb = $('results-table').querySelector('tbody');
    tb.innerHTML = '';
    for (const c of result.ranked) {
      const m = c.measures;
      const tr = document.createElement('tr');
      tr.dataset.id = c.id;
      tr.innerHTML = `<td>${c.rank}</td><td>${esc(c.id)}</td><td><span class="score-pill" style="background:${scoreColorCss(c.composite.score)}">${c.composite.score}</span></td><td>${c.composite.coverage}%</td><td>${fmt(m.substationKm)} km${m.substationKv ? ` / ${m.substationKv} kV` : ''}</td><td>${fmt(m.lineKm)} km</td><td>${m.freeCoolingFrac == null ? '—' : Math.round(100 * m.freeCoolingFrac) + '%'}</td><td>${m.floodCovered ? (m.floodZone || 'none') : '—'}</td><td>${esc(c.stateCode?.replace('US-', '') || '—')}</td>`;
      tr.addEventListener('click', () => this.cb.onSelect(c));
      tb.appendChild(tr);
    }
    if (result.osm?.error) this.setError(`Overpass: ${result.osm.error}. Power/water sub-scores are 0 for this run — retry in a minute or shrink the box.`);
  }

  showDetail(c) {
    this.selected = c;
    document.querySelectorAll('#results-table tbody tr').forEach((tr) => tr.classList.toggle('selected', tr.dataset.id === c.id));
    $('detail').hidden = false;
    $('detail-id').textContent = `#${c.rank} · ${c.id} · ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}${c.state ? ` · ${c.state}` : ''}`;
    const pill = $('detail-score'); pill.textContent = `${c.composite.score} · cov ${c.composite.coverage}%`; pill.style.background = scoreColorCss(c.composite.score);

    $('tab-scorecard').innerHTML = CRITERIA.map((cr) => {
      const s = c.sub[cr.key];
      const v = s?.score;
      return `<div class="crit"><span class="name">${esc(cr.label)} <span class="dim">w${this.req.weights[cr.key]}</span></span><div class="track"><div class="fill" style="width:${v ?? 0}%;background:${v == null ? '#555' : scoreColorCss(v)}"></div></div><span class="val">${v == null ? '—' : v}</span><span class="basis">${esc(s?.basis)}</span></div>`;
    }).join('');

    const d = c.design;
    const kv = (k, v, basis) => `<div class="kv"><span class="k">${esc(k)}</span><span class="mono">${v}</span>${basis ? `<span class="basis">${esc(basis)}</span>` : ''}</div>`;
    $('tab-design').innerHTML = [
      kv('Cooling', esc(d.cooling.label), d.cooling.basis),
      kv('Redundancy', `${esc(d.tier.label)} — ${esc(d.tier.redundancy)}`),
      kv('Racks', d.racks.toLocaleString()),
      kv('PUE (est.)', d.pue.pue, d.pue.basis),
      kv('WUE (est.)', `${d.wue.value} L/kWh`, d.wue.basis),
      kv('Facility power', `${d.power.facilityMw} MW · ${d.power.annualMwh.toLocaleString()} MWh/yr`, d.power.basis),
      kv('Capex', `$${d.capex.totalUsdM.toLocaleString()}M · $${d.capex.perMwUsdM}M/MW`, d.capex.basis),
      kv('Opex / yr', `$${d.opex.totalUsdM.toLocaleString()}M (energy $${d.opex.energyUsdM}M · water $${d.opex.waterUsdM}M ≈ ${d.opex.waterMegaL} ML · maint $${d.opex.maintUsdM}M)`, d.opex.basis),
      kv('vs. industry PUE 1.54', `$${d.vsIndustry.annualUsdM}M/yr saved`, d.vsIndustry.basis),
      kv('Interconnection', 'not assessed', d.interconnection.basis),
    ].join('');

    $('tab-evidence').innerHTML = c.evidence.map((e, i) => `<div class="ev"><span class="src">[E${i + 1}] ${esc(e.source)}</span><br/>${esc(e.observation)}<br/><span class="ref">${esc(e.ref || '')}${e.fetchedAt ? ` · ${esc(e.fetchedAt)}` : ''}</span></div>`).join('');

    $('memo-text').textContent = candidateMemo(c, this.req, { total: this.result.ranked.length, generatedAt: this.result.generatedAt });
    this.showTab('scorecard');
  }

  /** Results panel visibility. Closing keeps the result (and the globe layers) so it can be reopened from the left panel. */
  openResults() { if (!this.result) return; $('right').hidden = false; $('legend').hidden = false; $('btn-show-results').hidden = true; }
  closeResults() { $('right').hidden = true; $('legend').hidden = true; $('btn-show-results').hidden = !this.result; }
  resultsOpen() { return !!this.result && !$('right').hidden; }

  showTab(name) {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    for (const t of ['scorecard', 'design', 'evidence', 'memo']) $(`tab-${t}`).hidden = t !== name;
  }

  setMemoText(text) { $('memo-text').textContent = text; this.showTab('memo'); }
}

function fmt(v) { return v == null ? '—' : Number(v).toFixed(1); }

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
