/**
 * Pure geometry helpers (no Cesium). All distances in kilometres, coordinates in degrees [lon, lat].
 */
const R_KM = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance between two [lon, lat] points, km. */
export function haversineKm(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Distance from point p to segment [a,b] using a local equirectangular projection
 * around p (accurate to well under 1% at the ≤100 km scales screening cares about).
 */
export function pointToSegmentKm(p, a, b) {
  const kx = Math.cos(toRad(p[1])) * 111.32;
  const ky = 110.574;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy);
}

/** Minimum distance from p to a polyline (array of [lon,lat]), km. */
export function pointToPolylineKm(p, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = pointToSegmentKm(p, line[i - 1], line[i]);
    if (d < best) best = d;
  }
  return line.length === 1 ? haversineKm(p, line[0]) : best;
}

/** Nearest item (by `getPoint(item)` -> [lon,lat]) to p. Returns {item, km} or null. */
export function nearestPoint(p, items, getPoint) {
  let best = null;
  for (const item of items) {
    const q = getPoint(item);
    if (!q) continue;
    const km = haversineKm(p, q);
    if (!best || km < best.km) best = { item, km };
  }
  return best;
}

/** Nearest polyline (by `getLine(item)` -> [[lon,lat],...]) to p. */
export function nearestLine(p, items, getLine) {
  let best = null;
  for (const item of items) {
    const line = getLine(item);
    if (!line || !line.length) continue;
    const km = pointToPolylineKm(p, line);
    if (!best || km < best.km) best = { item, km };
  }
  return best;
}

/** Count items within radiusKm of p. */
export function countWithinKm(p, items, getPoint, radiusKm) {
  let n = 0;
  for (const item of items) {
    const q = getPoint(item);
    if (q && haversineKm(p, q) <= radiusKm) n++;
  }
  return n;
}

/** Ray-casting point-in-polygon for GeoJSON Polygon / MultiPolygon geometry. */
export function pointInGeometry(p, geometry) {
  if (!geometry) return false;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  for (const rings of polys) {
    if (!rings.length) continue;
    if (!pointInRing(p, rings[0])) continue;
    let inHole = false;
    for (let i = 1; i < rings.length; i++) if (pointInRing(p, rings[i])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const intersect = (yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Regular grid of candidate points inside a bbox {w,s,e,n}. `n` per axis. Points sit at cell centres
 * so a 1×1 grid returns the bbox centre.
 */
export function gridCandidates(bbox, n) {
  const pts = [];
  const dx = (bbox.e - bbox.w) / n, dy = (bbox.n - bbox.s) / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    pts.push({ lon: +(bbox.w + dx * (i + 0.5)).toFixed(5), lat: +(bbox.s + dy * (j + 0.5)).toFixed(5) });
  }
  return pts;
}

/** Bbox {w,s,e,n} from centre + half-size in km. */
export function bboxFromCenter(lon, lat, halfKm) {
  const dLat = halfKm / 110.574;
  const dLon = halfKm / (111.32 * Math.cos(toRad(lat)));
  return { w: lon - dLon, e: lon + dLon, s: lat - dLat, n: lat + dLat };
}

export function bboxSpanKm(bbox) {
  const midLat = (bbox.n + bbox.s) / 2;
  return { x: (bbox.e - bbox.w) * 111.32 * Math.cos(toRad(midLat)), y: (bbox.n - bbox.s) * 110.574 };
}

/** Expand bbox by km on every side (used so infrastructure just outside the search area still counts). */
export function expandBbox(bbox, km) {
  const midLat = (bbox.n + bbox.s) / 2;
  const dLat = km / 110.574, dLon = km / (111.32 * Math.cos(toRad(midLat)));
  return { w: bbox.w - dLon, e: bbox.e + dLon, s: Math.max(-89, bbox.s - dLat), n: Math.min(89, bbox.n + dLat) };
}
