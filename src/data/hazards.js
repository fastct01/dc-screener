/** FEMA NFHL flood zone + USGS design PGA via the dev-server proxies (cached). US-only coverage. */
export async function fetchFlood(lat, lon) {
  const r = await fetch(`/api/fema?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
  if (!r.ok) return { covered: false, error: `FEMA HTTP ${r.status}` };
  const j = await r.json();
  return { ...j, fetchedAt: r.headers.get('x-fetched-at') || new Date().toISOString(), source: 'FEMA National Flood Hazard Layer (S_FLD_HAZ_AR)' };
}

export async function fetchSeismic(lat, lon) {
  const r = await fetch(`/api/usgs?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
  if (!r.ok) return { pga: null, error: `USGS HTTP ${r.status}` };
  const j = await r.json();
  return { ...j, fetchedAt: r.headers.get('x-fetched-at') || new Date().toISOString(), source: 'USGS Design Maps (ASCE 7-22, Site Class D, Risk Cat III)' };
}
