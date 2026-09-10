/** Headless check: far-side culling + click popup on an existing data center dot. */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
const url = process.argv[2] || 'http://localhost:5180/';
const executablePath = process.argv[3] || process.env.CHROME_PATH;
const outDir = process.env.E2E_OUT || process.cwd();
const browser = await puppeteer.launch({ executablePath, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1500,950', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('boot')?.hidden === true && window.__app, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));

const cull = await page.evaluate(() => {
  const { layers } = window.__app;
  layers.cullBehindHorizon();
  const col = layers.points.dcs; let shown = 0;
  for (let i = 0; i < col.length; i++) if (col.get(i).show) shown++;
  return { total: col.length, shown };
});
console.log('DC dots from US view: shown', cull.shown, 'of', cull.total, '(far side culled:', cull.total - cull.shown, ')');

// Fly to a specific data center and click it.
const target = await page.evaluate(async () => {
  const { viewer, layers, Cesium } = window.__app;
  const col = layers.points.dcs;
  let pick = null;
  for (let i = 0; i < col.length; i++) { const it = col.get(i).id.item; if (/equinix/i.test(it.name || '') && it.operator) { pick = it; break; } }
  if (!pick) pick = col.get(0).id.item;
  await new Promise((res) => { viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(pick.lon, pick.lat, 6000), duration: 0.5, complete: res }); });
  await new Promise((r) => setTimeout(r, 1200));
  layers.cullBehindHorizon();
  const win = viewer.scene.cartesianToCanvasCoordinates(Cesium.Cartesian3.fromDegrees(pick.lon, pick.lat, 0));
  return { name: pick.name, operator: pick.operator, ref: pick.ref, x: win?.x, y: win?.y };
});
console.log('target:', target);
await page.mouse.click(target.x, target.y);
await new Promise((r) => setTimeout(r, 600));
const popup = await page.evaluate(() => {
  const p = document.getElementById('popup');
  return { hidden: p.hidden, kind: document.getElementById('popup-kind').textContent, title: document.getElementById('popup-title').textContent, body: document.getElementById('popup-body').textContent, osm: document.getElementById('popup-osm').hidden ? null : document.getElementById('popup-osm').href };
});
console.log('popup:', popup);
await page.screenshot({ path: path.join(outDir, 'e2e-4-popup.png') });
console.log('console issues:', logs.length ? '\n' + logs.join('\n') : 'none');
await browser.close();
