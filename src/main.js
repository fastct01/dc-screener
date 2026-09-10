import * as Cesium from 'cesium';
import { createGlobe, pickLonLat } from './globe.js';
import { Layers, describePick, scoreColorCss, pickedBoxCorner } from './layers.js';
import { Panel } from './ui/panel.js';
import { runScreening } from './screener.js';
import { bboxFromCenter, bboxSpanKm } from './engine/geo.js';
import { loadDatacenters, loadDams } from './data/localData.js';
import { candidateMemo } from './engine/memo.js';
import { saveRun, renameRun, listRuns, getRun, deleteRun, clearRuns } from './history.js';

const boot = document.getElementById('boot');
const bootStatus = document.getElementById('boot-status');

async function main() {
  const { viewer, terrainProvider } = await createGlobe('cesiumContainer', { onStatus: (s) => { bootStatus.textContent = s; } });
  const layers = new Layers(viewer);
  const camCtl = viewer.scene.screenSpaceCameraController;
  let mode = null, drawStart = null, dragEnd = null, pins = [], pinSeq = 0, lastResult = null;

  /** Single place that switches draw/pin mode. Draw mode freezes the camera so a mouse drag sizes the box instead of spinning the globe. */
  function setMode(next) {
    mode = next; drawStart = null; dragEnd = null;
    camCtl.enableInputs = mode !== 'draw';
    viewer.canvas.style.cursor = mode ? 'crosshair' : '';
    panel.setMode(mode);
  }
  const boxFrom = (a, b) => ({ w: Math.min(a[0], b[0]), e: Math.max(a[0], b[0]), s: Math.min(a[1], b[1]), n: Math.max(a[1], b[1]) });

  const panel = new Panel({
    onRun: async (req) => {
      if (!req.bbox) { panel.setError('Define a search area first (draw a box or set center + half-size).'); return; }
      const span = bboxSpanKm(req.bbox);
      if (span.x > 320 || span.y > 320) { panel.setError('Search box too large for Overpass — keep each side under ~300 km.'); return; }
      panel.setRunning(true);
      try {
        const result = await runScreening(req, { terrainProvider, onProgress: (p) => panel.setProgress(p) });
        showRun(req, result);
        try { currentRunName = null; currentRunId = await saveRun(req, result); await renderHistory(); } catch (e) { console.warn('Could not save screening to library', e); }
      } catch (e) {
        console.error(e);
        panel.setError(`Screening failed: ${e.message || e}`);
      } finally { panel.setRunning(false); }
    },
    onSelect: (c) => { panel.showDetail(c); layers.highlight(c.id); },
    onSave: async () => {
      if (!lastResult) return;
      const req = panel.req, s = req.bbox ? `${req.itMw} MW · ${((req.bbox.n + req.bbox.s) / 2).toFixed(2)}, ${((req.bbox.e + req.bbox.w) / 2).toFixed(2)}` : `${req.itMw} MW · pins`;
      const name = prompt('Name this screening:', currentRunName || s);
      if (name == null) return;
      try {
        if (currentRunId && (await renameRun(currentRunId, name.trim()))) { /* renamed in place */ }
        else currentRunId = await saveRun(req, lastResult, { name: name.trim() });
        currentRunName = name.trim() || null;
        panel.flashSaved(currentRunName);
        await renderHistory();
      } catch (e) { panel.setError(`Could not save screening: ${e.message || e}`); }
    },
    onDraw: (arg) => {
      if (arg === 'fromInputs') { setBboxFromInputs(); return; }
      setMode(mode === 'draw' ? null : 'draw');
    },
    onPin: () => setMode(mode === 'pin' ? null : 'pin'),
    onLayer: (key, on) => layers.setVisible(key, on),
    onNarrate: async (c) => {
      panel.setMemoText('Asking Claude to narrate… (numbers come only from the scored JSON)');
      try {
        const r = await fetch('/api/memo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: panel.req, candidate: c, deterministicMemo: candidateMemo(c, panel.req, { total: lastResult.ranked.length }) }) });
        const j = await r.json();
        if (j.error) panel.setMemoText(`Narration unavailable: ${j.error}\n\n${candidateMemo(c, panel.req, { total: lastResult.ranked.length })}`);
        else panel.setMemoText(`${j.markdown}\n\n---\n_Narrated by ${j.model}; every figure traceable to the deterministic memo below._\n\n${candidateMemo(c, panel.req, { total: lastResult.ranked.length })}`);
      } catch (e) { panel.setMemoText(`Narration failed: ${e.message}`); }
    },
  });

  function setBboxFromInputs() {
    const { lat, lon, halfKm } = panel.readCenter();
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const bbox = bboxFromCenter(lon, lat, halfKm);
    panel.setBbox(bbox); layers.setBox(bbox);
  }
  setBboxFromInputs();

  /** Put a screening (fresh or reopened) on the globe and in the results panel. */
  function showRun(req, result) {
    lastResult = result;
    layers.setPoints('substations', result.osm.substations, (s) => s.p, { size: 6 });
    layers.setPoints('plants', result.osm.plants, (s) => s.p, { size: 7 });
    layers.setPoints('water', result.osm.water, (s) => s.p, { size: 4 });
    layers.setLines(result.osm.lines);
    layers.setRivers(result.osm.rivers);
    layers.setCandidates(result.ranked);
    panel.showResults(result, req);
    if (result.ranked[0]) { panel.showDetail(result.ranked[0]); layers.highlight(result.ranked[0].id); }
  }

  // Screening library (second icon): every completed run is listed here and can be reopened or removed.
  let currentRunId = null, currentRunName = null;
  const histBtn = document.getElementById('btn-history'), hist = document.getElementById('history'), histList = document.getElementById('history-list');
  function openHistory(on) { hist.hidden = !on; histBtn.setAttribute('aria-expanded', String(on)); if (on) renderHistory(); }
  histBtn.addEventListener('click', (e) => { e.stopPropagation(); openHistory(hist.hidden); });
  document.addEventListener('click', (e) => { if (!hist.hidden && !hist.contains(e.target)) openHistory(false); });
  async function renderHistory() {
    let runs = [];
    try { runs = await listRuns(); } catch (e) { console.warn('Library unavailable', e); }
    document.getElementById('history-empty').hidden = runs.length > 0;
    document.getElementById('btn-history-clear').hidden = runs.length === 0;
    histList.innerHTML = '';
    for (const r of runs) {
      const s = r.summary, d = new Date(r.savedAt);
      const row = document.createElement('div'); row.className = `hist${r.id === currentRunId ? ' current' : ''}`; row.dataset.id = r.id; row.title = 'Open this screening';
      const area = s.points ? `${s.points} pin${s.points === 1 ? '' : 's'}` : `${s.gridN}×${s.gridN} grid`;
      const when = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      row.innerHTML = `<div class="when">${r.name ? `<b>${escapeHtml(r.name)}</b> <span class="dim">${escapeHtml(when)}</span>` : escapeHtml(when)}</div>`
        + `<div class="what">${s.itMw} MW · ${area} · ${s.count} candidates${s.state ? ` · ${escapeHtml(s.state)}` : ''}</div>`
        + `<div class="where">${s.lat != null ? `${s.lat}, ${s.lon}` : 'pins only'}${s.topId ? ` · best ${escapeHtml(s.topId)}` : ''}</div>`
        + `<div class="top">${s.topScore != null ? `<span class="score-pill" style="background:${scoreColorCss(s.topScore)}">${s.topScore}</span>` : ''}<button class="del" type="button" title="Remove from library" aria-label="Remove">×</button></div>`;
      row.querySelector('.del').addEventListener('click', async (e) => { e.stopPropagation(); await deleteRun(r.id); if (currentRunId === r.id) { currentRunId = null; currentRunName = null; } renderHistory(); });
      row.addEventListener('click', async () => {
        const full = await getRun(r.id); if (!full) { renderHistory(); return; }
        currentRunId = r.id; currentRunName = full.name || null;
        panel.applyRequest(full.request);
        pins = full.request.points ? full.request.points.map((p) => ({ ...p })) : []; pinSeq = pins.length; layers.setPins(pins);
        layers.setBox(full.request.bbox);
        showRun(full.request, full.result);
        if (full.request.bbox) layers.flyToBbox(full.request.bbox, 1.5);
        openHistory(false);
      });
      histList.appendChild(row);
    }
  }
  document.getElementById('btn-history-clear').addEventListener('click', async () => { if (!confirm('Remove every saved screening from the library?')) return; await clearRuns(); currentRunId = null; currentRunName = null; renderHistory(); });
  renderHistory();

  // Three-dot button (top-left) shows / hides the left bar.
  const menuBtn = document.getElementById('btn-menu'), left = document.getElementById('left');
  menuBtn.addEventListener('click', () => { left.hidden = !left.hidden; menuBtn.setAttribute('aria-expanded', String(!left.hidden)); });

  // Optional-key status
  fetch('/api/status').then((r) => r.json()).then((s) => panel.setNarrateEnabled(!!s.anthropic)).catch(() => panel.setNarrateEnabled(false));

  // Bundled global layers
  bootStatus.textContent = 'Loading bundled datasets…';
  const [dcs, dams] = await Promise.all([loadDatacenters(), loadDams()]);
  layers.setPoints('dcs', dcs.features, (d) => [d.lon, d.lat], { size: 4 });
  layers.setPoints('dams', dams.features, (d) => [d.lon, d.lat], { size: 4 });

  // Globe interaction
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  // ---- search box: press-drag-release to draw; drag a corner handle to extend an existing box ----
  // Raw pointer events in the capture phase, so Cesium's camera controller never sees the press: the globe stays
  // perfectly still while the box is sized (no pan, and no release inertia when input is handed back).
  const canvasPos = (e) => { const r = viewer.canvas.getBoundingClientRect(); return new Cesium.Cartesian2(e.clientX - r.left, e.clientY - r.top); };
  viewer.canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || mode === 'pin') return;
    const pos = canvasPos(e);
    const corner = pickedBoxCorner(viewer.scene.pick(pos));
    if (corner && panel.bbox) { const b = panel.bbox; drawStart = [corner.includes('w') ? b.e : b.w, corner.includes('n') ? b.s : b.n]; } // anchor = opposite corner
    else if (mode === 'draw') drawStart = pickLonLat(viewer, pos);
    if (!drawStart) return;
    dragEnd = null;
    e.stopImmediatePropagation(); e.preventDefault();
    hidePopup();
    viewer.canvas.style.cursor = 'crosshair';
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!drawStart) return;
    const ll = pickLonLat(viewer, canvasPos(e)); if (!ll) return;
    dragEnd = ll; layers.setBox(boxFrom(drawStart, ll));
  }, true);
  window.addEventListener('pointerup', (e) => {
    if (!drawStart || e.button !== 0) return;
    const ll = pickLonLat(viewer, canvasPos(e)) || dragEnd;
    const bbox = ll && boxFrom(drawStart, ll);
    drawStart = null; dragEnd = null;
    if (!bbox || (bbox.e - bbox.w < 1e-3 && bbox.n - bbox.s < 1e-3)) { layers.setBox(panel.bbox); viewer.canvas.style.cursor = mode ? 'crosshair' : ''; return; } // bare click: keep the old box
    panel.setBbox(bbox); layers.setBox(bbox);
    setMode(null); // also hands camera input back
  }, true);

  handler.setInputAction((ev) => {
    if (mode === 'draw' || drawStart) return;
    if (mode === 'pin') {
      const picked = viewer.scene.pick(ev.position);
      const pickedId = picked?.id?.id;
      if (ev.shift && typeof pickedId === 'string' && pickedId.startsWith('pin-')) {
        pins = pins.filter((p) => `pin-${p.id}` !== pickedId); layers.setPins(pins); panel.setPins(pins); return;
      }
      const ll = pickLonLat(viewer, ev.position); if (!ll) return;
      pins.push({ id: `P${++pinSeq}`, lon: +ll[0].toFixed(5), lat: +ll[1].toFixed(5) });
      layers.setPins(pins); panel.setPins(pins);
      if (!panel.bbox || !within(panel.bbox, ll)) { const b = growBbox(panel.bbox, pins); panel.setBbox(b); layers.setBox(b); }
      return;
    }
    const desc = describePick(viewer.scene.pick(ev.position));
    if (!desc) { hidePopup(); return; }
    if (desc.layer === 'candidate' && lastResult) {
      const c = lastResult.ranked.find((x) => x.id === desc.candId);
      if (c) { panel.showDetail(c); layers.highlight(c.id); showPopup(candidatePopup(c), ev.position); }
      return;
    }
    if (desc.layer === 'pin') { hidePopup(); return; }
    showPopup(featurePopup(desc.layer, desc.item), ev.position);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // Pointer cursor over anything clickable (throttled pick).
  let lastHover = 0;
  handler.setInputAction((ev) => {
    const now = performance.now();
    if (now - lastHover < 80) return;
    lastHover = now;
    if (mode || drawStart) { viewer.canvas.style.cursor = 'crosshair'; return; }
    const picked = viewer.scene.pick(ev.endPosition);
    const corner = pickedBoxCorner(picked);
    viewer.canvas.style.cursor = corner ? (corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize') : describePick(picked) ? 'pointer' : '';
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  // ---- popup ----
  const popup = document.getElementById('popup');
  document.getElementById('popup-close').addEventListener('click', hidePopup);
  document.getElementById('popup-fly').addEventListener('click', () => { if (popup._ll) layers.flyToPoint(popup._ll[0], popup._ll[1], 12000); });
  function hidePopup() { popup.hidden = true; }
  function showPopup(info, pos) {
    document.getElementById('popup-kind').textContent = info.kind;
    document.getElementById('popup-title').textContent = info.title;
    document.getElementById('popup-body').innerHTML = info.rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span>`).join('');
    const osm = document.getElementById('popup-osm'); osm.hidden = !info.osmRef; if (info.osmRef) osm.href = `https://www.openstreetmap.org/${info.osmRef}`;
    const web = document.getElementById('popup-web'); web.hidden = !info.web; if (info.web) web.href = /^https?:/i.test(info.web) ? info.web : `https://${info.web}`;
    popup._ll = info.ll;
    popup.hidden = false;
    const x = Math.min(pos.x + 14, window.innerWidth - popup.offsetWidth - 12);
    const y = Math.min(pos.y + 14, window.innerHeight - popup.offsetHeight - 12);
    popup.style.left = `${Math.max(12, x)}px`; popup.style.top = `${Math.max(12, y)}px`;
  }
  function featurePopup(layer, it) {
    const ll = it.p || [it.lon, it.lat];
    const coords = `${ll[1].toFixed(5)}, ${ll[0].toFixed(5)}`;
    switch (layer) {
      case 'dcs': return { kind: 'Existing data center · OSM', title: it.name || 'Data center', rows: [['Operator', it.operator], ['IT capacity', it.cap], ['Location', it.addr], ['Coordinates', coords], ['OSM id', it.ref || it.id]], osmRef: it.ref, web: it.web, ll };
      case 'dams': return { kind: 'Dam · OSM / OpenInfraMap', title: it.name || 'Dam', rows: [['Operator', it.op], ['Coordinates', coords], ['OSM id', it.ref || it.id]], osmRef: it.ref, ll };
      case 'substations': return { kind: 'Substation · OSM', title: it.name || 'Substation', rows: [['Voltage', it.kv != null ? `${it.kv} kV` : 'untagged'], ['Type', it.sub], ['Coordinates', coords], ['OSM', it.ref]], osmRef: it.ref, ll };
      case 'plants': return { kind: 'Power plant · OSM', title: it.name || 'Power plant', rows: [['Source', it.source], ['Output', it.output], ['Coordinates', coords], ['OSM', it.ref]], osmRef: it.ref, ll };
      case 'water': return { kind: 'Water body · OSM', title: it.name || 'Water', rows: [['Kind', it.kind], ['Coordinates', coords], ['OSM', it.ref]], osmRef: it.ref, ll };
      case 'lines': return { kind: 'Power line · OSM', title: it.name || 'Power line', rows: [['Voltage', it.kv != null ? `${it.kv} kV` : 'untagged'], ['Vertices', it.line?.length], ['OSM', it.ref]], osmRef: it.ref, ll: it.line?.[0] };
      default: return { kind: layer, title: it.name || layer, rows: [['Coordinates', coords]], ll };
    }
  }
  function candidatePopup(c) {
    const m = c.measures;
    return { kind: `Candidate · rank ${c.rank} of ${lastResult.ranked.length}`, title: `${c.id} · score ${c.composite.score} (coverage ${c.composite.coverage}%)`, rows: [['Substation', m.substationKm != null ? `${m.substationKm} km · ${m.substationKv ?? '?'} kV` : 'none'], ['Line', m.lineKm != null ? `${m.lineKm} km` : 'none'], ['Free cooling', m.freeCoolingFrac != null ? `${Math.round(100 * m.freeCoolingFrac)}%` : 'n/a'], ['Cooling', c.design.cooling.label], ['PUE est.', c.design.pue.pue], ['Capex', `$${c.design.capex.totalUsdM.toLocaleString()}M`], ['Coordinates', `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`]], ll: [c.lon, c.lat] };
  }
  function escapeHtml(v) { return String(v).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
  window.__app = { viewer, layers, panel, Cesium };

  // Escape dismisses the most transient thing first: an active draw/pin mode, then the popup, then the results panel.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!hist.hidden) { openHistory(false); return; }
    if (mode || drawStart) { setMode(null); layers.setBox(panel.bbox); return; }
    if (!popup.hidden) { hidePopup(); return; }
    if (panel.resultsOpen()) panel.closeResults();
  });

  layers.flyToBbox(panel.bbox, 1.5);
  boot.hidden = true;
}

function within(b, ll) { return ll[0] >= b.w && ll[0] <= b.e && ll[1] >= b.s && ll[1] <= b.n; }
function growBbox(b, pins) {
  const lons = pins.map((p) => p.lon), lats = pins.map((p) => p.lat);
  const pad = 0.05;
  return { w: Math.min(b?.w ?? Infinity, ...lons) - pad, e: Math.max(b?.e ?? -Infinity, ...lons) + pad, s: Math.min(b?.s ?? Infinity, ...lats) - pad, n: Math.max(b?.n ?? -Infinity, ...lats) + pad };
}

main().catch((e) => { console.error(e); bootStatus.textContent = `Failed to start: ${e.message || e}`; });
