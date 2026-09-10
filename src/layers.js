/** Cesium layer management: bundled points, OSM query results, search box, pins, and scored candidates. */
import * as Cesium from 'cesium';

const COLORS = {
  dcs: Cesium.Color.fromCssColorString('#c084fc'),
  dams: Cesium.Color.fromCssColorString('#60a5fa'),
  substations: Cesium.Color.fromCssColorString('#00d4ff'),
  plants: Cesium.Color.fromCssColorString('#f0a63c'),
  water: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.8),
  lines: Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.55),
  box: Cesium.Color.fromCssColorString('#00d4ff'),
};

export function scoreColorCss(score) {
  // red (0) → amber (50) → green (100)
  const t = Math.max(0, Math.min(1, score / 100));
  const lerp = (a, b, u) => Math.round(a + (b - a) * u);
  const [r1, g1, b1] = [255, 77, 77], [r2, g2, b2] = [255, 209, 102], [r3, g3, b3] = [74, 222, 128];
  const [r, g, b] = t < 0.5 ? [lerp(r1, r2, t * 2), lerp(g1, g2, t * 2), lerp(b1, b2, t * 2)] : [lerp(r2, r3, (t - 0.5) * 2), lerp(g2, g3, (t - 0.5) * 2), lerp(b2, b3, (t - 0.5) * 2)];
  return `rgb(${r},${g},${b})`;
}

/**
 * Turn a Cesium pick result into {layer, item} for point primitives (id = {layer,item}) and
 * polyline/candidate entities (properties.layer / properties.item). Returns null for anything else.
 */
export const BOX_CORNERS = ['nw', 'ne', 'sw', 'se'];
/** Returns the corner key ('nw' | 'ne' | 'sw' | 'se') if the pick is a search-box handle, else null. */
export function pickedBoxCorner(picked) {
  const id = picked?.id?.id;
  return typeof id === 'string' && id.startsWith('box-corner-') ? id.slice(11) : null;
}

export function describePick(picked) {
  const id = picked?.id;
  if (!id) return null;
  if (id.layer && id.item) return { layer: id.layer, item: id.item };
  const props = id.properties;
  if (props?.layer) {
    const layer = props.layer.getValue?.() ?? props.layer;
    if (layer === 'candidate') return { layer, candId: props.candId.getValue?.() ?? props.candId };
    return { layer, item: props.item?.getValue?.() ?? props.item };
  }
  if (typeof id.id === 'string' && id.id.startsWith('pin-')) return { layer: 'pin', pinId: id.id.slice(4) };
  return null;
}

export class Layers {
  constructor(viewer) {
    this.viewer = viewer;
    this.points = {};        // key -> PointPrimitiveCollection
    this.lineSource = new Cesium.CustomDataSource('lines');
    this.waterSource = new Cesium.CustomDataSource('water');
    this.candSource = new Cesium.CustomDataSource('candidates');
    this.uiSource = new Cesium.CustomDataSource('ui');
    for (const s of [this.lineSource, this.waterSource, this.candSource, this.uiSource]) viewer.dataSources.add(s);
    this.visible = { dcs: true, dams: false, substations: true, lines: true, plants: true, water: false };
    // Horizon culling: points are drawn with depth testing disabled so terrain never swallows them, which
    // also means the far side of the globe would show through. An ellipsoidal occluder hides anything
    // below the camera's horizon; re-evaluated whenever the camera moves appreciably.
    this._occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, viewer.camera.positionWC);
    viewer.camera.percentageChanged = 0.003;
    viewer.camera.changed.addEventListener(() => this.cullBehindHorizon());
    viewer.camera.moveEnd.addEventListener(() => this.cullBehindHorizon());
  }

  cullBehindHorizon() {
    const occ = this._occluder;
    occ.cameraPosition = this.viewer.camera.positionWC;
    for (const col of Object.values(this.points)) {
      for (let i = 0; i < col.length; i++) { const pt = col.get(i); pt.show = occ.isPointVisible(pt.position); }
    }
    for (const src of [this.candSource, this.uiSource]) {
      for (const e of src.entities.values) {
        if (!e.point) continue;
        const pos = e.position?.getValue(Cesium.JulianDate.now());
        if (pos) e.show = occ.isPointVisible(pos);
      }
    }
    this.viewer.scene.requestRender();
  }

  _pointCollection(key) {
    if (!this.points[key]) {
      this.points[key] = this.viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
      this.points[key].show = !!this.visible[key];
    }
    return this.points[key];
  }

  setPoints(key, items, getLonLat, { size = 5, color } = {}) {
    const col = this._pointCollection(key);
    col.removeAll();
    for (const it of items) {
      const ll = getLonLat(it); if (!ll) continue;
      col.add({ position: Cesium.Cartesian3.fromDegrees(ll[0], ll[1], 0), pixelSize: size, color: color || COLORS[key], outlineColor: Cesium.Color.BLACK.withAlpha(0.6), outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY, id: { layer: key, item: it } });
    }
    this.cullBehindHorizon();
  }

  setLines(items) {
    this.lineSource.entities.removeAll();
    for (const l of items) {
      if (l.line.length < 2) continue;
      this.lineSource.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(l.line.flat()), width: l.kv >= 230 ? 2.5 : l.kv >= 100 ? 1.8 : 1, material: COLORS.lines, clampToGround: true }, properties: { layer: 'lines', item: l } });
    }
    this.lineSource.show = this.visible.lines;
  }

  setRivers(items) {
    this.waterSource.entities.removeAll();
    for (const r of items) {
      if (r.line.length < 2) continue;
      this.waterSource.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(r.line.flat()), width: 1.5, material: COLORS.water, clampToGround: true } });
    }
    this.waterSource.show = this.visible.water;
  }

  setVisible(key, on) {
    this.visible[key] = on;
    if (this.points[key]) this.points[key].show = on;
    if (key === 'lines') this.lineSource.show = on;
    if (key === 'water') { this.waterSource.show = on; if (this.points.water) this.points.water.show = on; }
    this.viewer.scene.requestRender();
  }

  setBox(bbox) {
    this.uiSource.entities.removeById('search-box');
    for (const k of BOX_CORNERS) this.uiSource.entities.removeById(`box-corner-${k}`);
    if (!bbox) return;
    // Corner handles: grab and drag one to extend/shrink the box (see main.js LEFT_DOWN).
    for (const k of BOX_CORNERS) {
      const lon = k.includes('w') ? bbox.w : bbox.e, lat = k.includes('n') ? bbox.n : bbox.s;
      this.uiSource.entities.add({ id: `box-corner-${k}`, position: Cesium.Cartesian3.fromDegrees(lon, lat), point: { pixelSize: 9, color: COLORS.box, outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    }
    this.uiSource.entities.add({ id: 'search-box', rectangle: { coordinates: Cesium.Rectangle.fromDegrees(bbox.w, bbox.s, bbox.e, bbox.n), material: COLORS.box.withAlpha(0.06), outline: true, outlineColor: COLORS.box, outlineWidth: 2, height: 0 } });
    // Rectangle outlines don't render clamped; add an explicit ground polyline ring.
    this.uiSource.entities.removeById('search-box-ring');
    this.uiSource.entities.add({ id: 'search-box-ring', polyline: { positions: Cesium.Cartesian3.fromDegreesArray([bbox.w, bbox.s, bbox.e, bbox.s, bbox.e, bbox.n, bbox.w, bbox.n, bbox.w, bbox.s]), width: 2, material: COLORS.box, clampToGround: true } });
    this.viewer.scene.requestRender();
  }

  setPins(pins) {
    for (const e of [...this.uiSource.entities.values]) if (e.id.startsWith('pin-')) this.uiSource.entities.remove(e);
    pins.forEach((p) => this.uiSource.entities.add({ id: `pin-${p.id}`, position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat), point: { pixelSize: 9, color: Cesium.Color.WHITE, outlineColor: COLORS.box, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: { text: p.id, font: '11px JetBrains Mono', pixelOffset: new Cesium.Cartesian2(0, -16), fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Cesium.Color.BLACK, disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
    this.cullBehindHorizon();
  }

  setCandidates(ranked) {
    this.candSource.entities.removeAll();
    for (const c of ranked) {
      const color = Cesium.Color.fromCssColorString(scoreColorCss(c.composite.score));
      this.candSource.entities.add({
        id: `cand-${c.id}`,
        position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat),
        point: { pixelSize: c.rank <= 3 ? 16 : 11, color, outlineColor: c.rank <= 3 ? Cesium.Color.WHITE : Cesium.Color.BLACK, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: `#${c.rank} · ${c.composite.score}`, font: '11px JetBrains Mono', pixelOffset: new Cesium.Cartesian2(0, -18), fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Cesium.Color.BLACK, disableDepthTestDistance: Number.POSITIVE_INFINITY, show: c.rank <= 10 },
        properties: { layer: 'candidate', candId: c.id },
      });
    }
    this.cullBehindHorizon();
  }

  highlight(candId) {
    for (const e of this.candSource.entities.values) {
      const isSel = e.properties?.candId?.getValue() === candId;
      e.point.outlineColor = isSel ? Cesium.Color.fromCssColorString('#00d4ff') : Cesium.Color.BLACK;
      e.point.outlineWidth = isSel ? 4 : 2;
    }
    this.viewer.scene.requestRender();
  }

  flyToBbox(bbox, padding = 0.3) {
    const dLon = (bbox.e - bbox.w) * padding, dLat = (bbox.n - bbox.s) * padding;
    this.viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(bbox.w - dLon, bbox.s - dLat, bbox.e + dLon, bbox.n + dLat), duration: 1.4 });
  }

  flyToPoint(lon, lat, heightM = 25000) {
    this.viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, heightM), orientation: { heading: 0, pitch: Cesium.Math.toRadians(-60), roll: 0 }, duration: 1.4 });
  }
}
