/**
 * Keyless Cesium globe: Esri World Imagery (attribution required) + Re:Earth ellipsoidal terrain (CC BY 4.0).
 * Adapted from gods-eye-view's mapStackController — no Google/ion credentials needed.
 */
import * as Cesium from 'cesium';

const ESRI_WORLD_IMAGERY_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
const ESRI_CREDIT = 'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const REEARTH_TERRAIN_URL = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';

export const DATA_CREDITS = [
  '<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a> — World Imagery: Esri, Maxar, Earthstar Geographics, GIS User Community',
  'Terrain: <a href="https://reearth.io" target="_blank" rel="noopener">Re:Earth Terrain</a> / Mapterhorn (CC BY 4.0), EGM2008 (NGA)',
  'Power, water, existing data centers &amp; dams: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL 1.0) via Overpass API and Open Infrastructure Map',
  'Climate: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> Historical Weather API, ERA5 (CC BY 4.0)',
  'Flood zones: FEMA National Flood Hazard Layer (US public domain)',
  'Seismic design values: USGS Design Maps web service (US public domain)',
  'State boundaries: <a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a> (public domain)',
  'Bundled OSM snapshots originate from <a href="https://github.com/bilawalsidhu/gods-eye-view" target="_blank" rel="noopener">gods-eye-view</a> (MIT code; data keeps its own license)',
];

export async function createGlobe(containerId, { onStatus = () => {} } = {}) {
  const creditContainer = document.createElement('div');
  creditContainer.id = 'cesium-credits';
  document.body.appendChild(creditContainer);

  const viewer = new Cesium.Viewer(containerId, {
    timeline: false, animation: false, baseLayerPicker: false, geocoder: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, vrButton: false,
    selectionIndicator: false, infoBox: false, baseLayer: false, creditContainer, msaaSamples: 4,
  });
  viewer.targetFrameRate = 60;
  viewer.scene.globe.show = true;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.globe.enableLighting = false;

  for (const html of DATA_CREDITS) viewer.creditDisplay.addStaticCredit(new Cesium.Credit(html, false));
  viewer.creditDisplay.addStaticCredit(new Cesium.Credit('<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a>', true));

  onStatus('Loading Esri World Imagery…');
  try {
    const provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI_WORLD_IMAGERY_URL, { credit: ESRI_CREDIT, enablePickFeatures: false });
    viewer.imageryLayers.addImageryProvider(provider);
  } catch (e) {
    console.warn('[globe] Esri unavailable, falling back to OSM tiles', e);
    viewer.imageryLayers.addImageryProvider(new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/', credit: '© OpenStreetMap contributors' }));
  }

  onStatus('Loading terrain…');
  let terrainProvider;
  try {
    terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(REEARTH_TERRAIN_URL);
  } catch (e) {
    console.warn('[globe] Re:Earth terrain unavailable, flat ellipsoid', e);
    terrainProvider = new Cesium.EllipsoidTerrainProvider();
  }
  viewer.terrainProvider = terrainProvider;

  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-98.5, 38.5, 9.5e6) });
  return { viewer, terrainProvider, Cesium };
}

/** Pick a [lon,lat] on the globe from a window position, terrain-aware. */
export function pickLonLat(viewer, windowPosition) {
  const ray = viewer.camera.getPickRay(windowPosition);
  const cart = ray && viewer.scene.globe.pick(ray, viewer.scene);
  if (!cart) return null;
  const c = Cesium.Cartographic.fromCartesian(cart);
  return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
}

/**
 * Sample a 3×3 terrain grid at `spacingM` around [lon,lat] and return the maximum slope (%).
 * Uses ellipsoidal heights; slope is height difference over horizontal distance so the datum cancels.
 */
export async function sampleSlopePct(terrainProvider, lon, lat, spacingM = 250) {
  const dLat = spacingM / 110574;
  const dLon = spacingM / (111320 * Math.cos((lat * Math.PI) / 180));
  const pts = [];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) pts.push(Cesium.Cartographic.fromDegrees(lon + i * dLon, lat + j * dLat));
  let sampled;
  try { sampled = await Cesium.sampleTerrainMostDetailed(terrainProvider, pts); } catch { return null; }
  const h = sampled.map((c) => c.height);
  if (h.some((v) => v == null || !Number.isFinite(v))) return null;
  let max = 0;
  const idx = (i, j) => (j + 1) * 3 + (i + 1);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const h0 = h[idx(i, j)];
    if (i < 1) max = Math.max(max, Math.abs(h[idx(i + 1, j)] - h0) / spacingM);
    if (j < 1) max = Math.max(max, Math.abs(h[idx(i, j + 1)] - h0) / spacingM);
  }
  return { slopePct: Math.round(max * 1000) / 10, elevationM: Math.round(h[idx(0, 0)]) };
}
