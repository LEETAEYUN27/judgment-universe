// 효과 : 입자 · 충격 고리 · 피해 숫자 · 소리(합성음)
import { THREE, G, clamp, on } from './g.js';
import { hAt } from './world.js';
const MAX = 900; let geo, pts, pos, col, size, life, vel, head = 0;
export function initFx() {
  pos = new Float32Array(MAX * 3); col = new Float32Array(MAX * 3); size = new Float32Array(MAX); life = new Float32Array(MAX); vel = new Float32Array(MAX * 4);
  geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  pts = new THREE.Points(geo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: 'attribute float aSize; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * 300.0 / -mv.z; }',
    fragmentShader: 'varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vC * a, a); }' }));
  pts.frustumCulled = false; G.scene.add(pts);
}
export function burst(x, y, z, n, color, speed = 6, sz = 0.5, up = 4, grav = 12, lifeT = 0.7) {
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { const k = head; head = (head + 1) % MAX; const a = Math.random() * 6.283, e = Math.random() * 1.2 - 0.2, s = speed * (0.4 + Math.random() * 0.8);
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; vel[k * 4] = Math.cos(a) * Math.cos(e) * s; vel[k * 4 + 1] = Math.sin(e) * s + up; vel[k * 4 + 2] = Math.sin(a) * Math.cos(e) * s; vel[k * 4 + 3] = grav;
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; size[k] = sz * (0.6 + Math.random() * 0.8); life[k] = lifeT * (0.6 + Math.random() * 0.7); }
}
const rings = [];
export function ring(x, z, max, color = 0xff5a3c, speed = 30) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = Math.PI / 2; m.position.set(x, hAt(x, z) + 0.5, z); G.scene.add(m); rings.push({ m, r: 2, max, speed });
}
const marks = [];
export function mark(x, z, r, t, color = 0xff3b2e) { const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.15, r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.set(x, hAt(x, z) + 0.35, z); G.scene.add(m); marks.push({ m, t, t0: t }); }
export function updateFx(dt) {
  for (let k = 0; k < MAX; k++) if (life[k] > 0) { life[k] -= dt; vel[k * 4 + 1] -= vel[k * 4 + 3] * dt; pos[k * 3] += vel[k * 4] * dt; pos[k * 3 + 1] += vel[k * 4 + 1] * dt; pos[k * 3 + 2] += vel[k * 4 + 2] * dt; if (life[k] <= 0) size[k] = 0; else size[k] *= (1 - dt * 1.2); }
  geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = geo.attributes.aSize.needsUpdate = true;
  for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.r += r.speed * dt; r.m.scale.set(r.r, r.r, 14); r.m.material.opacity = clamp(1.2 - r.r / r.max, 0, 1); if (r.r > r.max) { G.scene.remove(r.m); rings.splice(i, 1); } }
  for (let i = marks.length - 1; i >= 0; i--) { const k = marks[i]; k.t -= dt; k.m.material.opacity = 0.35 + 0.4 * Math.abs(Math.sin(k.t * 16)); k.m.scale.setScalar(1 + (1 - k.t / k.t0) * 0.15); if (k.t <= 0) { G.scene.remove(k.m); marks.splice(i, 1); } }
}
const v3 = new THREE.Vector3();
export function number(x, y, z, text, cls = '') {
  v3.set(x, y, z).project(G.camera); if (v3.z > 1) return; const el = document.createElement('div'); el.className = 'dmg ' + cls; el.textContent = text; el.style.left = ((v3.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 30) + 'px'; el.style.top = ((-v3.y * 0.5 + 0.5) * innerHeight) + 'px'; document.getElementById('fxlayer').appendChild(el); setTimeout(() => el.remove(), 900);
}
/* 소리 : 받아 둔 음원이 없어 웹 오디오 합성음으로 대체 (인계 카드에 명시) */
let ac = null, master = null;
export function audioOn() { if (ac) return; try { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination); ambience(); } catch (e) { } }
function tone(f0, f1, dur, type = 'sine', vol = 0.3, delay = 0) { if (!ac) return; const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05); }
function noise(dur, f, q = 1, vol = 0.3, delay = 0, f1 = null) { if (!ac) return; const t = ac.currentTime + delay, n = ac.sampleRate * dur, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; const s = ac.createBufferSource(); s.buffer = b; const fl = ac.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.setValueAtTime(f, t); if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur); fl.Q.value = q; const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(fl); fl.connect(g); g.connect(master); s.start(t); }
function ambience() { const notes = [220, 277.2, 329.6, 415.3, 493.9, 554.4]; const play = () => { if (!ac) return; const f = notes[Math.floor(Math.random() * notes.length)] * (Math.random() < 0.3 ? 2 : 1); tone(f, f, 3.5, 'sine', 0.035); tone(f * 1.5, f * 1.5, 3.0, 'triangle', 0.012, 0.3); setTimeout(play, 1400 + Math.random() * 2600); }; play(); }
export const sfx = {
  jump: () => tone(380, 720, 0.13, 'sine', 0.18), jump2: () => { tone(520, 980, 0.12, 'sine', 0.16); tone(780, 1300, 0.1, 'triangle', 0.08, 0.04); }, dash: () => noise(0.22, 900, 0.8, 0.28, 0, 3000), land: () => noise(0.12, 180, 1, 0.3), step: () => noise(0.05, 500 + Math.random() * 300, 2, 0.05),
  swing: () => noise(0.14, 1400, 1.2, 0.2, 0, 500), hit: () => { noise(0.1, 320, 1.5, 0.45); tone(190, 70, 0.14, 'square', 0.12); }, hurt: () => { tone(300, 110, 0.3, 'sawtooth', 0.2); noise(0.2, 250, 1, 0.3); },
  pick: () => { tone(660, 990, 0.09, 'sine', 0.2); tone(990, 1320, 0.1, 'sine', 0.14, 0.07); }, build: () => { noise(0.08, 700, 3, 0.3); noise(0.08, 500, 3, 0.3, 0.12); tone(440, 660, 0.2, 'triangle', 0.12, 0.2); },
  quest: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.16, i * 0.11)), pad: () => { tone(200, 1400, 0.5, 'sine', 0.22); noise(0.5, 600, 0.6, 0.15, 0, 4000); },
  roar: (big = 1) => { tone(95 * (2 - big), 42, 1.5 * big, 'sawtooth', 0.34 * big); tone(140, 55, 1.3 * big, 'square', 0.12 * big); noise(1.4 * big, 240, 0.7, 0.5 * big, 0, 90); }, tell: () => { tone(880, 1320, 0.16, 'square', 0.1); tone(880, 1320, 0.16, 'square', 0.1, 0.2); },
  stomp: () => noise(0.16, 80, 1, 0.22), crash: () => { noise(0.7, 120, 0.6, 0.8); tone(80, 30, 0.6, 'sawtooth', 0.3); }, sweep: () => noise(0.6, 300, 0.5, 0.5, 0, 1800), erupt: () => { noise(0.9, 90, 0.6, 0.9); tone(60, 200, 0.5, 'sawtooth', 0.25); },
  win: () => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, f, 0.5, 'triangle', 0.18, i * 0.16)), die: () => tone(440, 80, 0.9, 'triangle', 0.25), eat: () => { noise(0.07, 900, 3, 0.2); noise(0.07, 800, 3, 0.2, 0.12); },
};
