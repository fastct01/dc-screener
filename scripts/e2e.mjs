/**
 * Headless end-to-end run: boot the app, run a screening on the default box, dump results + console errors,
 * and save screenshots to the scratch dir. Usage: node scripts/e2e.mjs [url] [chromePath]
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const url = process.argv[2] || 'http://localhost:5180/';
const executablePath = process.argv[3] || process.env.CHROME_PATH;
const outDir = process.env.E2E_OUT || process.cwd();

const browser = await puppeteer.launch({ executablePath, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1500,950', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
const logs = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(`[${t}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.hidden === true, { timeout: 120000 });
console.log(`boot ok in ${Date.now() - t0} ms`);
await page.screenshot({ path: path.join(outDir, 'e2e-1-boot.png') });

await page.select('#in-grid', '3');
await page.click('#btn-run');
await page.waitForFunction(() => !document.getElementById('right')?.hidden || !document.getElementById('run-error')?.hidden, { timeout: 300000 });
const err = await page.$eval('#run-error', (e) => (e.hidden ? '' : e.textContent));
console.log(`run finished in ${Date.now() - t0} ms${err ? ` — error: ${err}` : ''}`);
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: path.join(outDir, 'e2e-2-results.png') });

console.log('right hidden:', await page.$eval('#right', (e) => e.hidden), '| progress:', await page.$eval('#progress-stage', (e) => e.textContent), '| console issues so far:', logs.length ? '\n' + logs.slice(0, 15).join('\n') : 'none');
try {
const rows = await page.$$eval('#results-table tbody tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim()).join(' | ')));
console.log('rows:\n' + rows.join('\n'));
const detail = await page.$eval('#detail-id', (e) => e.textContent);
console.log('detail:', detail);
const scorecard = await page.$$eval('#tab-scorecard .crit', (els) => els.map((e) => e.querySelector('.name').textContent.trim() + ' = ' + e.querySelector('.val').textContent.trim()));
console.log('scorecard:', scorecard.join('; '));
await page.click('.tabs button[data-tab="design"]');
const design = await page.$$eval('#tab-design .kv', (els) => els.slice(0, 8).map((e) => e.querySelector('.k').textContent + ': ' + e.querySelector('.mono').textContent));
console.log('design:\n' + design.join('\n'));
await page.click('.tabs button[data-tab="evidence"]');
const evidence = await page.$$eval('#tab-evidence .ev', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 220)));
console.log('evidence:\n' + evidence.join('\n'));
await page.click('.tabs button[data-tab="memo"]');
const memo = await page.$eval('#memo-text', (e) => e.textContent);
console.log('memo chars:', memo.length, '| first line:', memo.split('\n')[0]);
await page.screenshot({ path: path.join(outDir, 'e2e-3-memo.png') });
} catch (e) { console.log('detail section failed:', e.message); }
// Close / reopen the results panel: × button, Escape, and the "Show results" button in the left panel.
try {
await page.click('#btn-close-results');
const afterClose = await page.evaluate(() => ({ right: document.getElementById('right').hidden, legend: document.getElementById('legend').hidden, show: document.getElementById('btn-show-results').hidden }));
await page.click('#btn-show-results');
const afterReopen = await page.evaluate(() => ({ right: document.getElementById('right').hidden, show: document.getElementById('btn-show-results').hidden }));
await page.keyboard.press('Escape');
const afterEsc = await page.evaluate(() => document.getElementById('right').hidden);
const ok = afterClose.right && afterClose.legend && !afterClose.show && !afterReopen.right && afterReopen.show && afterEsc;
console.log(`close/reopen ${ok ? 'ok' : 'FAILED'}:`, JSON.stringify({ afterClose, afterReopen, afterEsc }));
await page.screenshot({ path: path.join(outDir, 'e2e-4-closed.png') });
} catch (e) { console.log('close/reopen failed:', e.message); }
// Drag-to-draw a search box: the camera must not move while dragging, and the bbox must follow the drag.
try {
const cam = () => page.evaluate(() => { const p = window.__app.viewer.camera.positionWC; return [p.x, p.y, p.z].map((v) => Math.round(v)).join(','); });
const bboxOf = () => page.evaluate(() => window.__app.panel.bbox);
const drag = async (x0, y0, x1, y1) => { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8); await page.mouse.up(); };
const before = await bboxOf(); const cam0 = await cam();
await page.click('#btn-draw');
const inputsOff = await page.evaluate(() => window.__app.viewer.scene.screenSpaceCameraController.enableInputs === false);
await drag(560, 300, 760, 460);
await new Promise((r) => setTimeout(r, 300));
const drawn = await bboxOf(); const cam1 = await cam();
const modeCleared = await page.$eval('#btn-draw', (b) => !b.classList.contains('active'));
const inputsBack = await page.evaluate(() => window.__app.viewer.scene.screenSpaceCameraController.enableInputs === true);
// Extend the box by dragging its NE corner handle 80 px up/right.
const ne = await page.evaluate(() => { const { viewer, panel, Cesium } = window.__app; const c = viewer.scene.cartesianToCanvasCoordinates(Cesium.Cartesian3.fromDegrees(panel.bbox.e, panel.bbox.n)); return [c.x, c.y]; });
const cam2 = await cam();
await drag(ne[0], ne[1], ne[0] + 80, ne[1] - 80);
await new Promise((r) => setTimeout(r, 300));
const resized = await bboxOf(); const cam3 = await cam();
const drewOk = drawn && JSON.stringify(drawn) !== JSON.stringify(before) && drawn.e - drawn.w > 0.01 && drawn.n - drawn.s > 0.01;
const resizeOk = resized.e > drawn.e + 1e-4 && resized.n > drawn.n + 1e-4 && Math.abs(resized.w - drawn.w) < 1e-9 && Math.abs(resized.s - drawn.s) < 1e-9;
const ok = inputsOff && drewOk && cam0 === cam1 && modeCleared && inputsBack && resizeOk && cam2 === cam3;
console.log(`drag-to-draw ${ok ? 'ok' : 'FAILED'}:`, JSON.stringify({ inputsOff, drewOk, cameraStillWhileDrawing: cam0 === cam1, modeCleared, inputsBack, resizeOk, cameraStillWhileResizing: cam2 === cam3, drawn, resized }));
await page.screenshot({ path: path.join(outDir, 'e2e-5-drawn.png') });
} catch (e) { console.log('drag-to-draw failed:', e.message); }
console.log('console issues:', logs.length ? '\n' + logs.slice(0, 15).join('\n') : 'none');
await browser.close();
