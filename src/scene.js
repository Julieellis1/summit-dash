// Summit Dash — Three.js world: stylized warm-lit low-poly mountain, 200-tile spiral
// trail, climbers, effects and follow camera. Render-only: it never touches rules.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BOARD, T, TILE_INFO, CAMPS, BOARD_LEN } from './board.js';

// ───────── mountain geometry constants ─────────
const R0 = 40, R1 = 3.2, TURNS = 3.35, PEAK = 41, RB = 49, RMAX = 120, TH0 = Math.PI * 0.62;
const PHI = TURNS * Math.PI * 2;
const profile = (r) => PEAK * Math.pow(Math.max(0, 1 - r / RB), 1.22);
const rAt = (phi) => R0 + (R1 - R0) * (phi / PHI);
const pathXZ = (phi) => { const r = rAt(phi); const a = TH0 + phi; return [Math.cos(a) * r, Math.sin(a) * r]; };
const pathH = (phi) => profile(rAt(phi));

// ───────── noise ─────────
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s / 0.9375; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

function nearestPath(x, z) {
  const th = Math.atan2(z, x);
  let p0 = (th - TH0) % (Math.PI * 2); if (p0 < 0) p0 += Math.PI * 2;
  let best = { d: Infinity, phi: 0 };
  for (let k = -1; k <= Math.ceil(TURNS) + 1; k++) {
    const phi = Math.min(PHI, Math.max(0, p0 + k * Math.PI * 2));
    const [px, pz] = pathXZ(phi);
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, phi };
  }
  return best;
}
function naturalH(x, z) {
  const r = Math.hypot(x, z); const th = Math.atan2(z, x);
  const n = fbm(x * 0.055 + 13.1, z * 0.055 - 7.7) - 0.5;
  const steep = Math.max(0, 1 - r / RB);
  const ridge = 1 - Math.abs(Math.sin(th * 5 + n * 4 + r * 0.05));
  let h = profile(r) + n * (2.2 + 6.5 * steep) + ridge * 2.8 * steep * steep;
  if (r > RB - 6) h += (fbm(x * 0.03, z * 0.03) - 0.5) * 6 * smooth(RB - 6, RB + 25, r) + smooth(RB + 30, RMAX, r) * 10 * fbm(x * 0.02 + 5, z * 0.02);
  return h;
}
export function terrainH(x, z) {
  const r = Math.hypot(x, z);
  const nat = naturalH(x, z);
  const np = nearestPath(x, z);
  const ph = pathH(np.phi) - 0.06;
  let h = mix(ph, nat, smooth(1.9, 4.6, np.d));
  if (r < 6.5) h = mix(pathH(PHI) - 0.06, h, smooth(4.2, 6.5, r));
  return h;
}

export class World {
  constructor(canvas, { quality = 'high', reducedMotion = false } = {}) {
    this.quality = quality; this.reducedMotion = reducedMotion;
    const hi = quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: hi, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, hi ? 2 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = hi;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.3, 900);
    this.clock = new THREE.Clock();
    this.anims = [];
    this.tokens = new Map();
    this.focusPid = null;
    this.userUntil = 0;
    this.shakeAmt = 0;
    this.overview = false;
    this.afterRender = null;
    this._buildSky();
    this._buildLights();
    this._buildPath();
    this._buildTerrain();
    this._buildTiles();
    this._buildDecor();
    this._buildParticles();
    this._buildControls(canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.camera.position.set(70, 50, 70);
    this.controls.target.set(0, 15, 0);
  }

  // ───────── environment ─────────
  _buildSky() {
    const geo = new THREE.SphereGeometry(600, 32, 16);
    this.skyU = { top: { value: new THREE.Color('#2f63a8') }, mid: { value: new THREE.Color('#8ec0ea') }, bot: { value: new THREE.Color('#ffd0a1') }, sunDir: { value: new THREE.Vector3(-0.6, 0.35, 0.5).normalize() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = mix(bot, mid, smoothstep(-0.02, 0.22, h)); c = mix(c, top, smoothstep(0.22, 0.85, h));
          float s = max(dot(normalize(vP), sunDir), 0.0); c += vec3(1.0,0.75,0.45) * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.28);
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);
    this.fogBase = new THREE.Color('#f2cfaa');
    this.fogCold = new THREE.Color('#dfe8f3');
    this.scene.fog = new THREE.Fog(this.fogBase.clone(), 70, 330);
    this.scene.background = new THREE.Color('#f2cfaa');
  }
  _buildLights() {
    this.hemi = new THREE.HemisphereLight('#cfe3ff', '#7a5a3a', 1.15);
    this.scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight('#ffc98f', 2.6));
    sun.position.set(-70, 60, 55);
    sun.castShadow = this.quality === 'high';
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 10; sc.far = 260;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    this.scene.add(sun); this.scene.add(sun.target);
    const fill = new THREE.DirectionalLight('#9fc3ff', 0.45); fill.position.set(60, 30, -50); this.scene.add(fill);
  }
  _buildPath() {
    // dense samples → equal arc-length resample into 200 tiles
    const N = 6000; const pts = []; let len = 0; const cum = [0];
    for (let i = 0; i <= N; i++) {
      const phi = (i / N) * PHI; const [x, z] = pathXZ(phi);
      const p = new THREE.Vector3(x, pathH(phi), z); if (i) { len += p.distanceTo(pts[i - 1].p); cum.push(len); }
      pts.push({ p, phi });
    }
    this.tilePos = [null]; this.tilePhi = [null];
    let j = 0;
    for (let t = 1; t <= BOARD_LEN; t++) {
      const target = ((t - 1) / (BOARD_LEN - 1)) * len;
      while (j < N && cum[j + 1] < target) j++;
      const f = (target - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j] || 1);
      const phi = mix(pts[j].phi, pts[Math.min(N, j + 1)].phi, Math.min(1, f));
      const [x, z] = pathXZ(phi);
      this.tilePos.push(new THREE.Vector3(x, pathH(phi) + 0.16, z));
      this.tilePhi.push(phi);
    }
    this.tileTan = [null];
    for (let t = 1; t <= BOARD_LEN; t++) {
      const a = this.tilePos[Math.max(1, t - 1)], b = this.tilePos[Math.min(BOARD_LEN, t + 1)];
      this.tileTan.push(b.clone().sub(a).setY(0).normalize());
    }
    this.zoneH = [1, 40, 80, 120, 160, 200].map((t) => this.tilePos[t].y);
  }
  _buildTerrain() {
    const hi = this.quality === 'high';
    const NR = hi ? 104 : 72, NS = hi ? 260 : 170;
    const pos = []; const idx = [];
    pos.push(0, terrainH(0, 0), 0);
    for (let i = 1; i <= NR; i++) {
      const r = RMAX * Math.pow(i / NR, 1.38);
      for (let k = 0; k < NS; k++) {
        const a = (k / NS) * Math.PI * 2 + (i % 2) * (Math.PI / NS);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x, terrainH(x, z), z);
      }
    }
    const vi = (i, k) => (i === 0 ? 0 : 1 + (i - 1) * NS + (((k % NS) + NS) % NS));
    for (let k = 0; k < NS; k++) idx.push(0, vi(1, k + 1), vi(1, k));
    for (let i = 1; i < NR; i++) {
      for (let k = 0; k < NS; k++) {
        const a = vi(i, k), b = vi(i, k + 1), c = vi(i + 1, k), d = vi(i + 1, k + 1);
        if (i % 2) { idx.push(a, b, d, a, d, c); } else { idx.push(a, b, c, b, d, c); }
      }
    }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    const P = geo.attributes.position; const cols = new Float32Array(P.count * 3);
    const zh = this.zoneH; const c = new THREE.Color();
    const pal = {
      grass: ['#7fb24f', '#6fa246', '#8dbd57', '#77a94c'], dry: ['#b9a05a', '#a99256', '#c2ab66'],
      rock: ['#8d7764', '#9d8670', '#7a6758', '#a48d74'], dark: ['#6a5a4f', '#5e5048'],
      snow: ['#f3f5f8', '#e8eef4', '#fbfbfc'], ice: ['#d3e6f5', '#c3dcef', '#e2eef8'],
      trail: ['#d6b07a', '#cfa673'], trailRock: ['#b49a7d'], trailSnow: ['#e3e9f0', '#d9e1ea'],
    };
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < P.count; i += 3) {
      va.fromBufferAttribute(P, i); vb.fromBufferAttribute(P, i + 1); vc.fromBufferAttribute(P, i + 2);
      const cx = (va.x + vb.x + vc.x) / 3, cy = (va.y + vb.y + vc.y) / 3, cz = (va.z + vb.z + vc.z) / 3;
      n.subVectors(vc, vb).cross(vb.clone().sub(va)).normalize(); if (n.y < 0) n.negate();
      const slope = n.y; const j = hash2(Math.floor(cx * 7), Math.floor(cz * 7));
      const pick = (arr) => arr[Math.floor(j * arr.length) % arr.length];
      const np = nearestPath(cx, cz); const rr = Math.hypot(cx, cz);
      let col;
      const hN = cy + (j - 0.5) * 2.2;
      if (np.d < 1.75 || rr < 4.6) col = hN > zh[3] ? pick(pal.trailSnow) : hN > zh[2] - 2 ? pick(pal.trailRock) : pick(pal.trail);
      else if (hN < zh[1] + 1.5) col = slope < 0.62 ? pick(pal.dry) : pick(pal.grass);
      else if (hN < zh[2] - 1) col = slope < 0.7 ? pick(pal.rock) : (j < 0.55 ? pick(pal.dry) : pick(pal.grass));
      else if (hN < zh[3] - 1) col = slope < 0.6 ? pick(pal.dark) : pick(pal.rock);
      else if (hN < zh[4] - 0.5) col = slope > 0.72 ? pick(pal.snow) : pick(pal.rock);
      else col = slope > 0.55 ? (j < 0.5 ? pick(pal.ice) : pick(pal.snow)) : pick(pal.ice);
      c.set(col);
      for (let q = 0; q < 3; q++) { cols[(i + q) * 3] = c.r; cols[(i + q) * 3 + 1] = c.g; cols[(i + q) * 3 + 2] = c.b; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true; this.terrain.castShadow = hi;
    this.scene.add(this.terrain);
    // far ground disc to the horizon
    const g2 = new THREE.CircleGeometry(900, 48); g2.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ color: '#86ad5a', roughness: 1 }));
    ground.position.y = -0.6; ground.receiveShadow = true; this.scene.add(ground);
    // a lake on the plains
    const lake = new THREE.Mesh(new THREE.CircleGeometry(14, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#5fa6c8', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 }));
    lake.position.set(-78, terrainH(-78, 40) + 0.35, 40); lake.scale.set(1.4, 1, 1); this.scene.add(lake);
  }

  _iconTexture(icon, bg, ring = '#ffffff', size = 128) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size; const g = cv.getContext('2d');
    g.beginPath(); g.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2);
    const grd = g.createRadialGradient(size * 0.4, size * 0.35, 4, size / 2, size / 2, size * 0.46);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.25, bg); grd.addColorStop(1, bg);
    g.fillStyle = grd; g.fill(); g.lineWidth = size * 0.05; g.strokeStyle = ring; g.stroke();
    g.font = `${size * 0.5}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(icon, size / 2, size / 2 + size * 0.03);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return tex;
  }
  _textTexture(text, { bg = 'rgba(20,24,40,0.72)', fg = '#fff', font = 600, px = 44, pad = 18 } = {}) {
    const cv = document.createElement('canvas'); const g = cv.getContext('2d');
    g.font = `${font} ${px}px Outfit, system-ui, sans-serif`; const w = Math.ceil(g.measureText(text).width) + pad * 2; const h = px + pad * 1.2;
    cv.width = w; cv.height = h; g.font = `${font} ${px}px Outfit, system-ui, sans-serif`;
    g.fillStyle = bg; const r = h / 2; g.beginPath(); g.roundRect(0, 0, w, h, r); g.fill();
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, aspect: w / h };
  }

  _buildTiles() {
    const geo = new THREE.CylinderGeometry(0.86, 0.94, 0.26, 6);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
    const inst = (this.tileMesh = new THREE.InstancedMesh(geo, mat, BOARD_LEN));
    inst.castShadow = false; inst.receiveShadow = true;
    const dummy = new THREE.Object3D(); const col = new THREE.Color();
    this.tileBaseColor = [null];
    for (let t = 1; t <= BOARD_LEN; t++) {
      const p = this.tilePos[t]; const tan = this.tileTan[t];
      dummy.position.copy(p).setY(p.y - 0.04); dummy.rotation.set(0, Math.atan2(tan.x, tan.z), 0);
      const big = BOARD[t] === T.CAMP || BOARD[t] === T.FORK || t === 1 || t === BOARD_LEN;
      dummy.scale.setScalar(big ? 1.32 : 1); dummy.updateMatrix(); inst.setMatrixAt(t - 1, dummy.matrix);
      const type = BOARD[t];
      const base = type === T.SAFE ? (t > 160 ? '#d9e6f2' : t > 120 ? '#c9d3cf' : '#a9cf8a') : TILE_INFO[type].color;
      col.set(base); this.tileBaseColor.push(col.clone()); inst.setColorAt(t - 1, col);
    }
    inst.instanceColor.needsUpdate = true;
    this.scene.add(inst);
    // glowing rim ring for the human's current tile
    this.hiRing = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.22, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    this.scene.add(this.hiRing);
    // floating icons
    this.iconTex = {}; this.icons = [];
    for (let t = 1; t <= BOARD_LEN; t++) {
      const type = BOARD[t]; if (type === T.SAFE) continue;
      if (!this.iconTex[type]) this.iconTex[type] = this._iconTexture(TILE_INFO[type].icon, TILE_INFO[type].color);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.iconTex[type], depthWrite: false, transparent: true }));
      const big = type === T.CAMP || type === T.FORK || type === T.SUMMIT || type === T.START;
      sp.scale.setScalar(big ? 1.5 : 0.95); sp.position.copy(this.tilePos[t]).add(new THREE.Vector3(0, big ? 2.0 : 1.15, 0));
      sp.userData = { t, base: sp.position.y, ph: t * 0.7 };
      sp.renderOrder = 2; this.scene.add(sp); this.icons.push(sp);
    }
    // milestone numbers
    for (let t = 10; t <= BOARD_LEN; t += 10) {
      const label = CAMPS.includes(t) ? `⛺ CAMP ${t}` : t === BOARD_LEN ? 'SUMMIT 200' : `${t}`;
      const { tex, aspect } = this._textTexture(label, { px: 40, bg: CAMPS.includes(t) ? 'rgba(255,122,61,0.9)' : 'rgba(25,28,45,0.55)' });
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
      const s = CAMPS.includes(t) || t === 200 ? 0.62 : 0.42; sp.scale.set(s * aspect, s, 1);
      const out = this.tilePos[t].clone().setY(0).normalize().multiplyScalar(1.25);
      sp.position.copy(this.tilePos[t]).add(out).add(new THREE.Vector3(0, CAMPS.includes(t) ? 3.0 : 0.55, 0));
      sp.renderOrder = 3; this.scene.add(sp);
    }
    const fk = this._textTexture('🔀 ROUTE FORK 65', { px: 40, bg: 'rgba(214,160,30,0.92)' });
    const fsp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fk.tex, depthWrite: false, transparent: true }));
    fsp.scale.set(0.6 * fk.aspect, 0.6, 1); fsp.position.copy(this.tilePos[65]).add(new THREE.Vector3(0, 3.0, 0)); this.scene.add(fsp);
  }

  _buildDecor() {
    const hi = this.quality === 'high';
    const rnd = (() => { let s = 1337; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296; })();
    // pines
    const foliage = new THREE.ConeGeometry(1, 2.2, 7); foliage.translate(0, 2.0, 0);
    const fol2 = new THREE.ConeGeometry(0.75, 1.7, 7); fol2.translate(0, 3.0, 0);
    const trunk = new THREE.CylinderGeometry(0.16, 0.22, 1.1, 5); trunk.translate(0, 0.55, 0);
    const nTrees = hi ? 420 : 160;
    const fm = new THREE.InstancedMesh(foliage, new THREE.MeshStandardMaterial({ color: '#3f7a3f', flatShading: true, roughness: 0.9 }), nTrees);
    const fm2 = new THREE.InstancedMesh(fol2, new THREE.MeshStandardMaterial({ color: '#4c8a45', flatShading: true, roughness: 0.9 }), nTrees);
    const tm = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: '#6b4a32', roughness: 1 }), nTrees);
    const d = new THREE.Object3D(); let k = 0; let tries = 0;
    while (k < nTrees && tries++ < 20000) {
      const a = rnd() * Math.PI * 2; const r = 14 + rnd() * 90;
      const x = Math.cos(a) * r, z = Math.sin(a) * r; const h = terrainH(x, z);
      if (h > this.zoneH[2] - 2) continue;
      if (nearestPath(x, z).d < 3.2) continue;
      if (Math.hypot(x + 78, z - 40) < 20) continue;
      if (h > this.zoneH[1] && rnd() < 0.55) continue;
      d.position.set(x, h - 0.2, z); d.rotation.set(0, rnd() * 6, 0); d.scale.setScalar(0.65 + rnd() * 0.75); d.updateMatrix();
      fm.setMatrixAt(k, d.matrix); fm2.setMatrixAt(k, d.matrix); tm.setMatrixAt(k, d.matrix);
      const c = new THREE.Color().setHSL(0.28 + rnd() * 0.08, 0.42, 0.28 + rnd() * 0.1); fm.setColorAt(k, c); fm2.setColorAt(k, c.clone().offsetHSL(0, 0, 0.06));
      k++;
    }
    for (const m of [fm, fm2, tm]) { m.count = k; m.castShadow = hi; m.receiveShadow = true; this.scene.add(m); }
    // rocks & boulders
    const nRocks = hi ? 220 : 90;
    const rg = new THREE.DodecahedronGeometry(1, 0);
    const rm = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: '#8b7a6b', flatShading: true, roughness: 0.95 }), nRocks);
    k = 0; tries = 0;
    while (k < nRocks && tries++ < 20000) {
      const a = rnd() * Math.PI * 2; const r = 5 + rnd() * 60; const x = Math.cos(a) * r, z = Math.sin(a) * r; const h = terrainH(x, z);
      if (nearestPath(x, z).d < 2.6) continue;
      if (h < this.zoneH[1] && rnd() < 0.7) continue;
      d.position.set(x, h, z); d.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); const s = 0.3 + rnd() * 1.1; d.scale.set(s, s * (0.6 + rnd() * 0.5), s); d.updateMatrix();
      rm.setMatrixAt(k, d.matrix); const c = new THREE.Color(h > this.zoneH[4] ? '#dfe7ef' : h > this.zoneH[3] ? '#a7a3a4' : '#8b7a6b'); rm.setColorAt(k, c); k++;
    }
    rm.count = k; rm.castShadow = hi; rm.receiveShadow = true; this.scene.add(rm);
    // base camps: tents + campfire glow
    this.glows = [];
    const glowTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,220,150,1)'); gr.addColorStop(0.35, 'rgba(255,140,60,0.55)'); gr.addColorStop(1, 'rgba(255,100,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(cv); return t; })();
    this.glowTex = glowTex;
    for (const c of CAMPS) {
      const p = this.tilePos[c]; const tan = this.tileTan[c]; const side = new THREE.Vector3(-tan.z, 0, tan.x);
      const out = p.clone().setY(0).normalize(); if (side.dot(out) < 0) side.negate();
      [[1.6, '#ff7a3d', 0.4], [1.5, '#ffc145', -1.6]].forEach(([off, col, along]) => {
        const tent = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.25, 4), new THREE.MeshStandardMaterial({ color: col, flatShading: true, roughness: 0.7 }));
        const pos = p.clone().add(side.clone().multiplyScalar(off)).add(tan.clone().multiplyScalar(along));
        pos.y = Math.max(terrainH(pos.x, pos.z), p.y - 0.2) + 0.6; tent.position.copy(pos); tent.rotation.y = Math.PI / 4 + Math.atan2(tan.x, tan.z);
        tent.castShadow = hi; this.scene.add(tent);
      });
      const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      fire.position.copy(p).add(side.clone().multiplyScalar(1.4)).add(tan.clone().multiplyScalar(-0.6)).add(new THREE.Vector3(0, 0.6, 0)); fire.scale.setScalar(1.8); this.scene.add(fire); this.glows.push(fire);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6), new THREE.MeshStandardMaterial({ color: '#ddd' }));
      pole.position.copy(p).add(side.clone().multiplyScalar(-0.95)).add(new THREE.Vector3(0, 1.3, 0)); this.scene.add(pole);
    }
    // summit flag
    const top = this.tilePos[BOARD_LEN];
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.2), new THREE.MeshStandardMaterial({ color: '#e8e8e8', metalness: 0.6, roughness: 0.3 }));
    const fp = new THREE.Vector3(0, top.y, 0).lerp(top, 0.45); pole.position.copy(fp).add(new THREE.Vector3(0, 2.1, 0)); pole.castShadow = hi; this.scene.add(pole);
    const fg = new THREE.PlaneGeometry(2.2, 1.3, 12, 4); fg.translate(1.1, 0, 0);
    this.flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: '#e63946', side: THREE.DoubleSide, roughness: 0.6 }));
    this.flag.position.copy(fp).add(new THREE.Vector3(0, 3.6, 0)); this.flag.castShadow = hi; this.scene.add(this.flag);
    this.flagBase = fg.attributes.position.array.slice();
    const cairn = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), new THREE.MeshStandardMaterial({ color: '#cfdbe6', flatShading: true }));
    cairn.position.copy(fp).add(new THREE.Vector3(0, 0.2, 0)); this.scene.add(cairn);
    // start arch
    const s = this.tilePos[1]; const tan = this.tileTan[1]; const side = new THREE.Vector3(-tan.z, 0, tan.x);
    for (const sgn of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.6, 6), new THREE.MeshStandardMaterial({ color: '#7a5233' }));
      post.position.copy(s).add(side.clone().multiplyScalar(1.4 * sgn)).add(new THREE.Vector3(0, 1.2, 0)); post.castShadow = hi; this.scene.add(post);
    }
    const ban = this._textTexture('🚩 TRAILHEAD', { px: 40, bg: 'rgba(230,57,70,0.95)' });
    const bs = new THREE.Sprite(new THREE.SpriteMaterial({ map: ban.tex, transparent: true, depthWrite: false })); bs.scale.set(0.55 * ban.aspect, 0.55, 1); bs.position.copy(s).add(new THREE.Vector3(0, 2.7, 0)); this.scene.add(bs);
    // clouds
    this.clouds = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, transparent: true, opacity: 0.93, emissive: '#ffe6d0', emissiveIntensity: 0.25 });
    for (let i = 0; i < (hi ? 11 : 6); i++) {
      const g = new THREE.Group(); const n = 3 + Math.floor(rnd() * 4);
      for (let j = 0; j < n; j++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + rnd() * 2.5, 0), cm); b.position.set(j * 2.6 - n, rnd() * 1.2, rnd() * 2); b.scale.y = 0.62; g.add(b); }
      const a = rnd() * Math.PI * 2; const r = 95 + rnd() * 90; g.position.set(Math.cos(a) * r, 34 + rnd() * 26, Math.sin(a) * r);
      g.userData = { a, r, sp: 0.004 + rnd() * 0.006 }; this.clouds.add(g);
    }
    this.scene.add(this.clouds);
  }

  _buildParticles() {
    const hi = this.quality === 'high';
    const N = this.reducedMotion ? 0 : hi ? 1600 : 600;
    const geo = new THREE.BufferGeometry(); const arr = new Float32Array(N * 3); const spd = new Float32Array(N);
    for (let i = 0; i < N; i++) { arr[i * 3] = (Math.random() - 0.5) * 60; arr[i * 3 + 1] = Math.random() * 30; arr[i * 3 + 2] = (Math.random() - 0.5) * 60; spd[i] = 0.6 + Math.random(); }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const cv = document.createElement('canvas'); cv.width = cv.height = 32; const g = cv.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    this.snowMat = new THREE.PointsMaterial({ size: 0.32, map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, opacity: 0, color: '#ffffff' });
    this.snow = new THREE.Points(geo, this.snowMat); this.snow.userData.spd = spd; this.snow.frustumCulled = false;
    this.scene.add(this.snow);
    this.burstTex = cv;
  }

  _buildControls(canvas) {
    const c = (this.controls = new OrbitControls(this.camera, canvas));
    c.enableDamping = true; c.dampingFactor = 0.08; c.minDistance = 5; c.maxDistance = 190; c.maxPolarAngle = Math.PI * 0.47; c.enablePan = false;
    c.addEventListener('start', () => { this.userUntil = performance.now() + 6000; });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.fov = w < h ? 55 : 42; this.camera.updateProjectionMatrix();
  }

  // ───────── climbers ─────────
  addToken(pid, { color = '#e63946', name = '?', isHuman = false } = {}) {
    const hi = this.quality === 'high';
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, flatShading: true });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.42, 3, 8), bodyMat); body.position.y = 0.55; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), new THREE.MeshStandardMaterial({ color: '#f1c6a0', roughness: 0.7 })); head.position.y = 1.08; g.add(head);
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.205, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), roughness: 0.8 })); hat.position.y = 1.11; g.add(hat);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffffff' })); pom.position.y = 1.33; g.add(pom);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.2), new THREE.MeshStandardMaterial({ color: '#3d3a4b', roughness: 0.8 })); pack.position.set(0, 0.62, -0.24); g.add(pack);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.38, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e9c46a' })); roll.position.set(0, 0.86, -0.26); g.add(roll);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = hi; } });
    if (isHuman) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.95, depthWrite: false }));
      ring.position.y = 0.05; g.add(ring); g.userData.ring = ring;
      g.scale.setScalar(1.18);
    }
    const { tex, aspect } = this._textTexture(isHuman ? `★ ${name}` : name, { px: 38, bg: isHuman ? 'rgba(255,183,77,0.95)' : 'rgba(20,24,40,0.7)', fg: isHuman ? '#1b1b2a' : '#fff' });
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    tag.scale.set(0.42 * aspect, 0.42, 1); tag.position.y = 1.85; tag.renderOrder = 10; g.add(tag);
    const colorDot = new THREE.Color(color);
    g.userData = { ...g.userData, pid, tile: 1, body: bodyMat, baseColor: colorDot, slot: new THREE.Vector3(), moving: false, isHuman, tag };
    this.scene.add(g); this.tokens.set(pid, g);
    this.placeToken(pid, 1, true);
    return g;
  }
  _slotOffset(pid, tile) {
    const here = [...this.tokens.values()].filter((t) => t.userData.tile === tile).map((t) => t.userData.pid);
    const i = here.indexOf(pid); const n = here.length;
    if (n <= 1) return new THREE.Vector3();
    const a = (i / n) * Math.PI * 2; const r = 0.42 + 0.03 * n;
    return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
  }
  placeToken(pid, tile, instant = false) {
    const tk = this.tokens.get(pid); if (!tk) return;
    tk.userData.tile = tile;
    this._relayout(instant);
  }
  _relayout(instant) {
    for (const tk of this.tokens.values()) {
      if (tk.userData.moving) continue;
      const t = tk.userData.tile; const p = this.tilePos[t].clone().add(this._slotOffset(tk.userData.pid, t));
      tk.userData.slot.copy(p);
      if (instant) tk.position.copy(p);
      const tan = this.tileTan[Math.min(BOARD_LEN, t)]; tk.rotation.y = Math.atan2(tan.x, tan.z);
    }
  }
  /** Animate a climber from one tile to another. mode: hop | jump | slide */
  moveToken(pid, from, to, mode = 'hop', speed = 1) {
    const tk = this.tokens.get(pid); if (!tk) return Promise.resolve();
    if (from === to) return Promise.resolve();
    const rm = this.reducedMotion;
    const myId = (tk.userData.animId = (tk.userData.animId || 0) + 1);
    if (tk.userData.cancel) tk.userData.cancel();
    tk.userData.moving = true; tk.userData.tile = to;
    const steps = [];
    if (mode === 'hop' && !rm) { const dir = Math.sign(to - from); for (let t = from; t !== to; t += dir) steps.push([t, t + dir]); }
    else steps.push([from, to]);
    const per = rm ? 0.12 : mode === 'hop' ? 0.2 / speed : mode === 'jump' ? 0.85 / speed : Math.min(1.2, 0.12 * Math.abs(to - from)) / speed;
    const arc = mode === 'hop' ? 0.55 : mode === 'jump' ? 2.8 + Math.abs(to - from) * 0.08 : 0.05;
    if (mode === 'jump' && !rm) this.ropeArc(this.tilePos[from], this.tilePos[to]);
    return new Promise((resolve) => {
      let i = 0; let tt = 0;
      const startP = tk.position.clone();
      let a = startP; let b = this.tilePos[steps[0][1]].clone();
      tk.userData.cancel = () => { tk.userData.cancel = null; resolve(); };
      this.anims.push((dt) => {
        if (tk.userData.animId !== myId) return true;
        tt += dt / per;
        const k = Math.min(1, tt);
        const e = mode === 'slide' ? 1 - Math.pow(1 - k, 2) : k;
        if (mode === 'slide' && steps.length === 1) {
          // follow the trail backwards/forwards tile by tile for slides
          const span = to - from; const f = from + span * e; const t0 = Math.floor(f), t1 = Math.min(BOARD_LEN, t0 + 1);
          const q = this.tilePos[Math.max(1, t0)].clone().lerp(this.tilePos[Math.max(1, t1)], f - t0);
          tk.position.copy(q);
        } else {
          tk.position.lerpVectors(a, b, e); tk.position.y += Math.sin(Math.PI * k) * arc;
        }
        const dir = b.clone().sub(a).setY(0); if (dir.lengthSq() > 1e-4) tk.rotation.y = Math.atan2(dir.x, dir.z) + (mode === 'slide' && to < from ? Math.PI : 0);
        if (k >= 1) {
          if (mode === 'hop' && this.onHop) this.onHop(pid, steps[i][1]);
          i++; tt = 0;
          if (i >= steps.length) { tk.userData.moving = false; tk.userData.cancel = null; this._relayout(false); resolve(); return true; }
          a = tk.position.clone().setY(this.tilePos[steps[i][0]].y); a.copy(this.tilePos[steps[i][0]]); b = this.tilePos[steps[i][1]].clone();
        }
        return false;
      });
    });
  }
  setFocus(pid) { this.focusPid = pid; }
  snapCamera() {
    const tk = this.focusPid && this.tokens.get(this.focusPid); if (!tk) return;
    const f = tk.position.clone().add(new THREE.Vector3(0, 0.9, 0));
    this.camera.position.add(f.clone().sub(this.controls.target)); this.controls.target.copy(f); this._snap = true; this.userUntil = 0; this.overview = false;
  }
  flyOverview(on) { this.overview = on; this.userUntil = 0; }
  highlightTile(t) { const p = this.tilePos[t]; this.hiRing.position.set(p.x, p.y + 0.12, p.z); }

  // ───────── effects ─────────
  burst(pos, color = '#ffffff', n = 40, { speed = 4, life = 1.1, size = 0.35, gravity = -6, up = 3 } = {}) {
    if (this.reducedMotion) n = Math.min(n, 8);
    const geo = new THREE.BufferGeometry(); const P = new Float32Array(n * 3); const V = [];
    for (let i = 0; i < n; i++) { P[i * 3] = pos.x; P[i * 3 + 1] = pos.y + 0.6; P[i * 3 + 2] = pos.z; const a = Math.random() * Math.PI * 2; const s = speed * (0.4 + Math.random() * 0.8); V.push(new THREE.Vector3(Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s)); }
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    const mat = new THREE.PointsMaterial({ size, color, map: new THREE.CanvasTexture(this.burstTex), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat); this.scene.add(pts); let t = 0;
    this.anims.push((dt) => {
      t += dt; for (let i = 0; i < n; i++) { V[i].y += gravity * dt; P[i * 3] += V[i].x * dt; P[i * 3 + 1] += V[i].y * dt; P[i * 3 + 2] += V[i].z * dt; }
      geo.attributes.position.needsUpdate = true; mat.opacity = Math.max(0, 1 - t / life);
      if (t > life) { this.scene.remove(pts); geo.dispose(); mat.dispose(); return true; } return false;
    });
  }
  confetti(pos) {
    for (const c of ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93']) this.burst(pos, c, 18, { speed: 5, up: 7, life: 1.8, size: 0.3, gravity: -7 });
  }
  rockslide(tile) {
    const p = this.tilePos[tile]; const inward = p.clone().setY(0).normalize().multiplyScalar(-1);
    const n = this.reducedMotion ? 3 : 14;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15 + Math.random() * 0.25, 0), new THREE.MeshStandardMaterial({ color: '#7d6655', flatShading: true }));
      const start = p.clone().add(inward.clone().multiplyScalar(3 + Math.random() * 2)).add(new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3));
      m.position.copy(start); m.castShadow = true; this.scene.add(m);
      const v = inward.clone().multiplyScalar(-(2 + Math.random() * 2)); let vy = 0; let t = 0; const delay = Math.random() * 0.4;
      this.anims.push((dt) => {
        t += dt; if (t < delay) return false;
        vy -= 14 * dt; m.position.addScaledVector(v, dt); m.position.y += vy * dt; m.rotation.x += dt * 6; m.rotation.z += dt * 4;
        const g = terrainH(m.position.x, m.position.z); if (m.position.y < g + 0.15) { m.position.y = g + 0.15; vy = -vy * 0.35; }
        if (t > 2.2) { this.scene.remove(m); m.geometry.dispose(); return true; } return false;
      });
    }
    this.burst(p, '#c9a27a', 30, { speed: 3, up: 2, size: 0.5, life: 1.4, gravity: -2 });
    this.shake(0.5);
  }
  frost(pid) {
    const tk = this.tokens.get(pid); if (!tk) return;
    this.burst(tk.position, '#9fe0ff', 46, { speed: 3, up: 4, size: 0.32, life: 1.3, gravity: -3 });
    const mat = tk.userData.body; const base = tk.userData.baseColor.clone(); let t = 0;
    this.anims.push((dt) => { t += dt; const k = Math.max(0, 1 - t / 1.6); mat.color.copy(base).lerp(new THREE.Color('#bfe9ff'), k); mat.emissive.set('#3aa0ff').multiplyScalar(k * 0.6); if (t > 1.6) { mat.color.copy(base); mat.emissive.set('#000000'); return true; } return false; });
  }
  shieldBubble(pid) {
    const tk = this.tokens.get(pid); if (!tk) return;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: '#7fb2ff', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.copy(tk.position).add(new THREE.Vector3(0, 0.7, 0)); this.scene.add(m); let t = 0;
    this.anims.push((dt) => { t += dt; m.scale.setScalar(0.6 + t * 1.2); m.material.opacity = Math.max(0, 0.5 - t * 0.4); if (t > 1.3) { this.scene.remove(m); return true; } return false; });
  }
  ropeArc(a, b) {
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 3 + a.distanceTo(b) * 0.25, 0));
    const curve = new THREE.QuadraticBezierCurve3(a.clone().add(new THREE.Vector3(0, 0.4, 0)), mid, b.clone().add(new THREE.Vector3(0, 0.4, 0)));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.06, 6), new THREE.MeshBasicMaterial({ color: '#4ff0d6', transparent: true, opacity: 0.95 }));
    this.scene.add(m); let t = 0;
    this.anims.push((dt) => { t += dt; m.material.opacity = Math.max(0, 1 - t / 1.6); if (t > 1.6) { this.scene.remove(m); m.geometry.dispose(); return true; } return false; });
  }
  pulseTile(t, color = '#b98cff') {
    const p = this.tilePos[t]; const m = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.6, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(p).add(new THREE.Vector3(0, 0.14, 0)); this.scene.add(m); let tt = 0;
    this.anims.push((dt) => { tt += dt; m.scale.setScalar(1 + tt * 3); m.material.opacity = Math.max(0, 1 - tt); if (tt > 1) { this.scene.remove(m); return true; } return false; });
  }
  shake(a) { if (!this.reducedMotion) this.shakeAmt = Math.max(this.shakeAmt, a); }
  eruptionFX(kind) {
    if (kind === 'sunbreak') {
      let t = 0; this.anims.push((dt) => { t += dt; this.sun.intensity = 2.6 + Math.sin(Math.min(1, t / 2.4) * Math.PI) * 3; if (t > 2.4) { this.sun.intensity = 2.6; return true; } return false; });
      for (const tk of this.tokens.values()) this.burst(tk.position, '#ffd166', 20, { up: 5, life: 1.6 });
    } else if (kind === 'whiteout') {
      const f = this.scene.fog; const n0 = f.near, f0 = f.far; let t = 0;
      this.anims.push((dt) => { t += dt; const k = Math.sin(Math.min(1, t / 3) * Math.PI); f.near = mix(n0, 2, k); f.far = mix(f0, 22, k); f.color.lerp(new THREE.Color('#f4f7fb'), k * 0.3); if (t > 3) { f.near = n0; f.far = f0; return true; } return false; });
      this.shake(0.4);
    } else {
      const geo = new THREE.TorusGeometry(46, 1.6, 8, 80, Math.PI); const cols = []; const P = geo.attributes.position; const c = new THREE.Color();
      for (let i = 0; i < P.count; i++) { const ang = Math.atan2(P.getY(i), P.getX(i)); const rr = Math.hypot(P.getX(i), P.getY(i)); c.setHSL(((rr - 44.4) / 3.2) * 0.8, 0.9, 0.6); cols.push(c.r, c.g, c.b); }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      m.position.set(0, 6, -10); m.lookAt(this.camera.position.clone().setY(6)); this.scene.add(m); let t = 0;
      this.anims.push((dt) => { t += dt; m.material.opacity = 0.55 * Math.sin(Math.min(1, t / 3.5) * Math.PI); if (t > 3.5) { this.scene.remove(m); geo.dispose(); return true; } return false; });
    }
  }

  // ───────── frame loop ─────────
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta()); const time = this.clock.elapsedTime;
    this.anims = this.anims.filter((fn) => !fn(dt));
    // focus & camera
    const tk = this.focusPid && this.tokens.get(this.focusPid);
    const ctl = this.controls;
    let focus = tk ? tk.position.clone().add(new THREE.Vector3(0, 0.9, 0)) : new THREE.Vector3(0, 18, 0);
    if (this.overview) focus = new THREE.Vector3(0, 16, 0);
    const prev = ctl.target.clone();
    ctl.target.lerp(focus, this.reducedMotion ? 1 : 1 - Math.exp(-dt * 6));
    this.camera.position.add(ctl.target.clone().sub(prev));
    if (performance.now() > this.userUntil) {
      const off = this.camera.position.clone().sub(ctl.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      const out = Math.atan2(focus.x, focus.z);
      const wantAz = this.overview ? sph.theta + dt * 0.08 : out + 0.35;
      let dAz = wantAz - sph.theta; dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
      const portrait = window.innerWidth < window.innerHeight;
      const wantR = this.overview ? (portrait ? 190 : 128) : portrait ? 33 : 19.5;
      const wantPhi = this.overview ? 1.08 : portrait ? 0.86 : 0.98;
      const k = this.reducedMotion || this._snap ? 1 : 1 - Math.exp(-dt * 2.2);
      this._snap = false;
      sph.theta += dAz * k; sph.radius += (wantR - sph.radius) * k; sph.phi += (wantPhi - sph.phi) * k;
      this.camera.position.copy(ctl.target).add(new THREE.Vector3().setFromSpherical(sph));
    }
    ctl.update();
    // keep camera above terrain
    const gh = terrainH(this.camera.position.x, this.camera.position.z) + 1.2; if (this.camera.position.y < gh) this.camera.position.y = gh;
    if (this.shakeAmt > 0.001) { this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt; this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt; this.shakeAmt *= 0.9; }
    // altitude mood: colder fog & snow as you climb
    const alt = Math.min(1, Math.max(0, (focus.y - this.zoneH[2]) / (this.zoneH[5] - this.zoneH[2])));
    if (!this.overview) {
      this.scene.fog.color.copy(this.fogBase).lerp(this.fogCold, alt);
      this.scene.background.copy(this.scene.fog.color);
      this.snowMat.opacity = this.overview ? 0 : alt * 0.9;
    } else this.snowMat.opacity = 0;
    if (this.snowMat.opacity > 0.01) {
      const P = this.snow.geometry.attributes.position; const sp = this.snow.userData.spd;
      for (let i = 0; i < P.count; i++) {
        let y = P.getY(i) - sp[i] * dt * 2.2; let x = P.getX(i) + Math.sin(time + i) * dt * 0.6 + dt * 0.8;
        if (y < -2) y = 28; if (x > 30) x = -30; P.setY(i, y); P.setX(i, x);
      }
      P.needsUpdate = true; this.snow.position.copy(ctl.target).add(new THREE.Vector3(0, -8, 0));
    }
    // ambient motion
    for (const sp of this.icons) sp.position.y = sp.userData.base + Math.sin(time * 1.6 + sp.userData.ph) * 0.08;
    for (const g of this.glows) g.material.opacity = 0.75 + Math.sin(time * 9 + g.id) * 0.2;
    if (this.flag) { const P = this.flag.geometry.attributes.position; const b = this.flagBase; for (let i = 0; i < P.count; i++) { const x = b[i * 3]; P.setZ(i, Math.sin(x * 2.4 - time * 5) * 0.18 * (x / 2.2)); } P.needsUpdate = true; }
    for (const c of this.clouds.children) { c.userData.a += c.userData.sp * dt; c.position.x = Math.cos(c.userData.a) * c.userData.r; c.position.z = Math.sin(c.userData.a) * c.userData.r; }
    for (const t of this.tokens.values()) if (!t.userData.moving) t.position.lerp(t.userData.slot, Math.min(1, dt * 10));
    for (const t of this.tokens.values()) if (t.userData.ring) { t.userData.ring.material.opacity = 0.6 + Math.sin(time * 4) * 0.3; }
    this.hiRing.material.opacity = 0.55 + Math.sin(time * 3) * 0.3;
    // sun follows the action for crisp local shadows
    this.sun.target.position.copy(ctl.target); this.sun.position.copy(ctl.target).add(new THREE.Vector3(-70, 60, 55));
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    if (this.afterRender) this.afterRender(dt);
  }
}
