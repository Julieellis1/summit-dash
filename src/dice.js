// Physics dice (cannon-es) — purely visual. The engine has ALREADY decided each value.
// We simulate the throw offline, see which face ends up on top, then rotate the visual
// die's face mapping (a cube-symmetry quaternion) so the decided value lands facing up.
// The tumble is real physics; the outcome is server-authoritative.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// BoxGeometry material order: +x, -x, +y, -y, +z, -z  → face values (opposites sum to 7)
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((a) => new THREE.Vector3(...a));
const normalOfValue = (v) => FACE_NORMALS[FACE_VALUES.indexOf(v)];

const PIPS = { 1: [[0.5, 0.5]], 2: [[0.27, 0.27], [0.73, 0.73]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]], 4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]], 5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]], 6: [[0.27, 0.24], [0.73, 0.24], [0.27, 0.5], [0.73, 0.5], [0.27, 0.76], [0.73, 0.76]] };

function faceTexture(v, tint) {
  const S = 256; const cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, S, S); gr.addColorStop(0, tint[0]); gr.addColorStop(1, tint[1]);
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  for (const [x, y] of PIPS[v]) {
    const r = v === 1 ? 30 : 21;
    const pg = g.createRadialGradient(x * S - 4, y * S - 4, 2, x * S, y * S, r);
    pg.addColorStop(0, v === 1 ? '#ff6b6b' : '#3a3f63'); pg.addColorStop(1, v === 1 ? '#b3122b' : '#141729');
    g.fillStyle = pg; g.beginPath(); g.arc(x * S, y * S, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.arc(x * S, y * S, r + 1.5, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class Dice {
  constructor(renderer, { shadows = true, reducedMotion = false } = {}) {
    this.renderer = renderer; this.reducedMotion = reducedMotion;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.active = false; this.dice = [];
    const key = new THREE.DirectionalLight('#fff3e0', 2.4); key.position.set(-4, 10, 6); key.castShadow = shadows; key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera; sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6;
    this.scene.add(key, new THREE.AmbientLight('#b8c8ff', 1.1));
    const rim = new THREE.DirectionalLight('#9ad0ff', 1.2); rim.position.set(5, 4, -6); this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.32 }));
    floor.receiveShadow = true; this.scene.add(floor);
    this.geo = new RoundedBoxGeometry(1, 1, 1, 4, 0.16);
    this.skins = {
      ivory: [0, 1, 2, 3, 4, 5].map((i) => new THREE.MeshStandardMaterial({ map: faceTexture(FACE_VALUES[i], ['#fffaf0', '#efe3cf']), roughness: 0.32, metalness: 0.02 })),
      rival: [0, 1, 2, 3, 4, 5].map((i) => new THREE.MeshStandardMaterial({ map: faceTexture(FACE_VALUES[i], ['#e8f1ff', '#c9d8f5']), roughness: 0.32, metalness: 0.02 })),
    };
    this.shadows = shadows;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight; this.camera.aspect = w / h;
    // fit the 8×5.6 tray: farther away on portrait screens
    const halfW = 4.4; const vf = (this.camera.fov * Math.PI) / 180; const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const d = Math.max(12, halfW / Math.tan(hf / 2) + 1);
    this.camera.position.set(0, d * 0.86, d * 0.52); this.camera.lookAt(0, 0, 0.4); this.camera.updateProjectionMatrix();
  }

  _simulate(n) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -42, 0) });
      world.allowSleep = true;
      const mat = new CANNON.Material('m');
      world.addContactMaterial(new CANNON.ContactMaterial(mat, mat, { friction: 0.28, restitution: 0.38 }));
      const ground = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Plane() });
      ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0); world.addBody(ground);
      const wall = (x, z, ry) => { const b = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Plane() }); b.position.set(x, 0, z); b.quaternion.setFromEuler(0, ry, 0); world.addBody(b); };
      wall(-4, 0, Math.PI / 2); wall(4, 0, -Math.PI / 2); wall(0, -2.8, 0); wall(0, 2.8, Math.PI);
      const bodies = [];
      for (let i = 0; i < n; i++) {
        const b = new CANNON.Body({ mass: 1, material: mat, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)), sleepSpeedLimit: 0.12, sleepTimeLimit: 0.25, linearDamping: 0.08, angularDamping: 0.08 });
        b.position.set(-3.3 + Math.random() * 0.4, 2.5 + Math.random() + i * 1.2, 1.4 - i * 1.4 + Math.random() * 0.4);
        b.velocity.set(10 + Math.random() * 4, 1 + Math.random() * 2, -2 - Math.random() * 3 + i * 1.5);
        b.angularVelocity.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
        b.quaternion.setFromEuler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
        world.addBody(b); bodies.push(b);
      }
      const frames = [];
      for (let f = 0; f < 420; f++) {
        world.step(1 / 60);
        frames.push(bodies.map((b) => [b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]));
        if (f > 40 && bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING || (b.velocity.length() < 0.05 && b.angularVelocity.length() < 0.05))) break;
      }
      // which local face points up at rest?
      const tops = []; let clean = true;
      for (const fr of frames[frames.length - 1]) {
        const q = new THREE.Quaternion(fr[3], fr[4], fr[5], fr[6]); let best = -2, bi = 0;
        FACE_NORMALS.forEach((nrm, i) => { const y = nrm.clone().applyQuaternion(q).y; if (y > best) { best = y; bi = i; } });
        if (best < 0.97) clean = false; tops.push(FACE_NORMALS[bi]);
      }
      if (clean) return { frames, tops };
    }
    return null;
  }

  /** Throw dice that land on the given values. Returns a promise resolved at rest. */
  throw(values, { skin = ['ivory', 'rival'] } = {}) {
    this.clear();
    const n = values.length;
    const sim = this.reducedMotion ? null : this._simulate(n);
    this.active = true;
    this.dice = values.map((v, i) => {
      const mesh = new THREE.Mesh(this.geo, this.skins[skin[i] || 'ivory']); mesh.castShadow = this.shadows; this.scene.add(mesh);
      // visual = body ∘ fix, where fix maps the decided value's face normal onto the body's resting top face
      const fix = sim ? new THREE.Quaternion().setFromUnitVectors(normalOfValue(v), sim.tops[i]) : new THREE.Quaternion().setFromUnitVectors(normalOfValue(v), new THREE.Vector3(0, 1, 0));
      return { mesh, fix, v };
    });
    if (!sim) {
      this.dice.forEach((d, i) => { d.mesh.position.set((i - (n - 1) / 2) * 1.6, 0.5, 0.3); d.mesh.quaternion.copy(d.fix); });
      return new Promise((r) => setTimeout(r, 350));
    }
    return new Promise((resolve) => {
      let t = 0; const F = sim.frames;
      this.update = (dt) => {
        t += dt * 60; const f = Math.min(F.length - 1, Math.floor(t)); const k = Math.min(1, t - f); const g = F[Math.min(F.length - 1, f + 1)];
        this.dice.forEach((d, i) => {
          const a = F[f][i], b = g[i];
          d.mesh.position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
          const qa = new THREE.Quaternion(a[3], a[4], a[5], a[6]); const qb = new THREE.Quaternion(b[3], b[4], b[5], b[6]);
          d.mesh.quaternion.copy(qa.slerp(qb, k)).multiply(d.fix);
        });
        if (this.onImpact && f > 0 && F[f][0] && F[f - 1] && F[f][0][1] < 0.56 && F[f - 1][0][1] >= 0.56) this.onImpact();
        if (f >= F.length - 1) { this.update = null; resolve(); }
      };
    });
  }
  clear() { for (const d of this.dice) this.scene.remove(d.mesh); this.dice = []; this.active = false; this.update = null; }
  render(dt) {
    if (!this.active) return;
    if (this.update) this.update(dt);
    const r = this.renderer; r.autoClear = false; r.clearDepth(); r.render(this.scene, this.camera); r.autoClear = true;
  }
}
