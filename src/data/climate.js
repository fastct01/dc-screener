/**
 * Hourly dry-bulb + RH from the Open-Meteo Historical Weather API (ERA5-based, CC BY 4.0, keyless, CORS-enabled).
 * We reduce one full year to economizer statistics. One request per candidate (~8,760 hourly values).
 */
const YEAR = 2025;

export async function fetchClimate(lat, lon, { year = YEAR, signal } = {}) {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    start_date: `${year}-01-01`, end_date: `${year}-12-31`,
    hourly: 'temperature_2m,relative_humidity_2m', timezone: 'UTC',
  }).toString();
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
  const j = await r.json();
  const temps = j.hourly?.temperature_2m || [];
  const rh = j.hourly?.relative_humidity_2m || [];
  return { ...reduceHourly(temps, rh), year, fetchedAt: new Date().toISOString(), source: 'Open-Meteo Historical Weather API (ERA5)' };
}

/** Pure reducer so it can be unit-tested. Thresholds: ≤18 °C full economizer, 18–24 partial. */
export function reduceHourly(temps, rh = []) {
  let free = 0, partial = 0, hot = 0, n = 0, sum = 0;
  const valid = [];
  for (let i = 0; i < temps.length; i++) {
    const t = temps[i];
    if (t == null || !Number.isFinite(t)) continue;
    n++; sum += t; valid.push(t);
    if (t <= 18) free++; else if (t <= 24) partial++;
    if (t >= 32) hot++;
  }
  valid.sort((a, b) => a - b);
  const p99 = valid.length ? valid[Math.min(valid.length - 1, Math.floor(valid.length * 0.99))] : null;
  const p1 = valid.length ? valid[Math.floor(valid.length * 0.01)] : null;
  // Mean wet-bulb (Stull 2011) as an evaporative-cooling potential indicator
  let wbSum = 0, wbN = 0;
  for (let i = 0; i < temps.length; i++) {
    const t = temps[i], h = rh[i];
    if (t == null || h == null) continue;
    wbSum += stullWetBulb(t, h); wbN++;
  }
  return {
    totalHours: n, freeHours: free, partialHours: partial, hotHours: hot,
    meanC: n ? Math.round((sum / n) * 10) / 10 : null, p99C: p99, p1C: p1,
    meanWetBulbC: wbN ? Math.round((wbSum / wbN) * 10) / 10 : null,
    freeCoolingFrac: n ? (free + 0.5 * partial) / n : null,
  };
}

export function stullWetBulb(t, rh) {
  return t * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(t + rh) - Math.atan(rh - 1.676331)
    + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035;
}
