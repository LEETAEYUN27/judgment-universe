// 포식자 「아귀룡」과 새끼들 : 마디 몸통(앞을 따라가는 사슬) + 다리 IK + 예고 동작이 있는 공격
import { THREE, G, clamp, lerp, damp, dampAng, angDiff, dist2, emit, ease } from './g.js';
import { W, hAt, nearColliders, solidTop } from './world.js';
const gAt = (x, z, cap) => { const g = hAt(x, z), t = solidTop(x, z); return t > g && t < g + cap ? t : g; };

const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), M4 = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
function pick(root, name) { let f = null; root.traverse(o => { if (o.name === name) f = o; }); return f; }
function basisX(obj, from, to, up) {      // obj 의 +X 축이 from→to 를 향하게
  X.subVectors(to, from).normalize(); Z.crossVectors(X, up); if (Z.lengthSq() < 1e-6) Z.set(0, 0, 1); Z.normalize(); Y.crossVectors(Z, X); M4.makeBasis(X, Y, Z); obj.quaternion.setFromRotationMatrix(M4); obj.position.copy(from);
}

export class Wyrm {
  constructor(o) {
    Object.assign(this, { id: 'boss', scale: 1, segs: 20, maxHp: 2600, home: W.arena, boss: true, name: '아귀룡' }, o);
    const S = this.scale; this.hp = this.maxHp; this.alive = true; this.spacing = 2.75 * S; this.rad = 1.9 * S;
    const src = G.assets[this.model || 'agwi']; this.group = new THREE.Group(); G.scene.add(this.group);
    const mk = name => { const n = pick(src, name).clone(true); n.position.set(0, 0, 0); n.scale.setScalar(S); n.traverse(m => { if (m.isMesh) { m.castShadow = true; m.material = m.material.clone(); m.material.envMapIntensity = 0.4; } }); this.group.add(n); return n; };
    this.headN = mk('head'); this.jawN = pick(this.headN, 'jaw'); this.segN = []; this.legs = []; this.mats = [];
    for (let i = 0; i < this.segs; i++) { const s = mk('seg'); const k = i < this.segs - 4 ? 1 - Math.abs(i - this.segs * 0.35) / this.segs * 0.55 : lerp(0.8, 0.35, (i - (this.segs - 4)) / 4); s.scale.setScalar(S * k); s.userData.k = k; this.segN.push(s); }
    this.tailN = mk('tail'); this.tailN.scale.setScalar(S * 0.5);
    if (!this.fly) for (let i = 1; i < this.segs - 4; i += 2) for (const side of [1, -1]) { const u = mk('legU'), l = mk('legL'); this.legs.push({ seg: i, side, u, l, foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, init: false }); }
    this.group.traverse(m => { if (m.isMesh) this.mats.push(m.material); });
    this.eyeMats = this.mats.filter(m => m.name === 'eye'); this.glowMats = this.mats.filter(m => m.name === 'glow');
    // 위치 : 머리 + 마디들. 자취(trail)를 따라 배치
    this.head = new THREE.Vector3(this.home.x, 0, this.home.z); this.yaw = 0; this.pts = []; for (let i = 0; i <= this.segs + 1; i++) this.pts.push(new THREE.Vector3());
    this.trail = []; this.coil();
    this.st = 'sleep'; this.t = 0; this.cd = { bite: 0, charge: 2, sweep: 3, burrow: 9 }; this.target = null; this.speed = 0; this.rear = 0; this.jaw = 0; this.dig = 0; this.glow = 0; this.flash = new Float32Array(this.segs + 2); this.ring = null; this.hazard = { bite: false, contact: false, erupt: null }; this.phase = 1; this.stunT = 0; this.wob = 0; this.deadT = 0;
    this.netT = 0; this.net = null; this.alts = new Float32Array(this.segs + 2);
    this.place(0.016);
  }
  coil() {       // 둥지에서 똬리를 튼 모습
    this.trail.length = 0; const n = Math.ceil(this.segs * this.spacing / 0.5) + 40;
    for (let k = 0; k < n; k++) { const d = k * 0.5, a = d / (9 * this.scale) , r = (7 + d * 0.11) * this.scale; this.trail.push(this.home.x + Math.cos(a) * r, this.home.z + Math.sin(a) * r); }
    this.head.x = this.trail[0]; this.head.z = this.trail[1]; this.yaw = Math.atan2(this.trail[0] - this.trail[2], this.trail[1] - this.trail[3]);
  }
  pushTrail() { const t = this.trail; if (dist2(this.head.x, this.head.z, t[0], t[1]) >= 0.5) { t.unshift(this.head.x, this.head.z); const max = (Math.ceil(this.segs * this.spacing / 0.5) + 30) * 2; if (t.length > max) t.length = max; } }
  along(d) {     // 자취에서 머리 뒤 d 만큼 떨어진 점
    const t = this.trail; let px = this.head.x, pz = this.head.z, acc = 0;
    for (let i = 0; i < t.length; i += 2) { const l = dist2(px, pz, t[i], t[i + 1]); if (acc + l >= d) { const k = l > 0 ? (d - acc) / l : 0; return [lerp(px, t[i], k), lerp(pz, t[i + 1], k)]; } acc += l; px = t[i]; pz = t[i + 1]; }
    return [px, pz];
  }
  players() { const a = []; if (G.me && !G.me.dead) a.push({ pos: G.me.pos, me: true }); for (const r of G.others.values()) if (!r.ch.st.dead) a.push({ pos: r.pos }); return a; }
  nearest() { let b = null, bd = 1e9; for (const p of this.players()) { const d = dist2(p.pos.x, p.pos.z, this.head.x, this.head.z); if (d < bd) { bd = d; b = p; } } return b ? { p: b, d: bd } : null; }
  go(st) { this.st = st; this.t = 0; emit('bossState', { id: this.id, st, boss: this.boss, pos: this.head }); }

  /* ── 판단 (방장 · 혼자 할 때만) ── */
  simulate(dt) {
    if (!this.alive) return; this.t += dt; const S = this.scale, c = this.cd; for (const k in c) c[k] = Math.max(0, c[k] - dt);
    const n = this.nearest(), tp = n && n.p.pos, ph = this.phase, fast = ph === 3 ? 1.3 : ph === 2 ? 1.12 : 1;
    const aim = tp ? Math.atan2(tp.x - this.head.x, tp.z - this.head.z) : this.yaw, off = Math.abs(angDiff(this.yaw, aim));
    this.hazard.bite = false; this.hazard.contact = false; this.hazard.erupt = null;
    let turn = 0, spd = 0, rear = 0, jaw = 0.08 + Math.sin(G.time * 2) * 0.04, dig = 0, glow = 0.25;
    switch (this.st) {
      case 'sleep': { jaw = 0.02; spd = 0; if (n && (dist2(tp.x, tp.z, this.home.x, this.home.z) < this.home.r * (this.boss ? 0.8 : 1) || this.hp < this.maxHp)) this.go('roar'); break; }
      case 'roar': { rear = ease(clamp(this.t / 0.5, 0, 1)); jaw = 0.9; glow = 1; turn = 2.5; if (this.t > (this.boss ? 1.9 : 0.7)) this.go('chase'); break; }
      case 'chase': {
        turn = (this.boss ? 1.55 : 2.6) * fast; spd = (this.boss ? 11.5 : 8.5) * fast * (off > 1.2 ? 0.6 : 1);
        if (!n) { spd = 3; break; }
        if (dist2(this.head.x, this.head.z, this.home.x, this.home.z) > this.home.r * (this.boss ? 2.3 : 2.2) && !this.boss) { this.go('return'); break; }
        const d = n.d;
        if (d < (this.boss ? 17 : 5) * 1 && off < 0.6 && c.bite <= 0) { this.go('biteTell'); c.bite = this.boss ? 2.4 / fast : 1.8; }
        else if (this.boss && d > 20 && d < 75 && off < 0.4 && c.charge <= 0) { this.go('chargeTell'); c.charge = 7.5 / fast; }
        else if (this.fly && this.boss && c.sweep <= 0 && d < 44 && off < 0.5) { this.go('inhaleTell'); c.sweep = 11 / fast; }
        else if (!this.fly && this.boss && c.sweep <= 0 && this.playersNearBody(11)) { this.go('sweepTell'); c.sweep = 6.5 / fast; }
        else if (this.boss && ph >= 2 && c.burrow <= 0 && d > 14) { this.go('dive'); c.burrow = 16 / fast; }
        break;
      }
      case 'return': { const a = Math.atan2(this.home.x - this.head.x, this.home.z - this.head.z); this.yaw = dampAng(this.yaw, a, 3, dt); spd = 9; if (dist2(this.head.x, this.head.z, this.home.x, this.home.z) < 12) this.go('chase'); if (n && n.d < 10) this.go('chase'); break; }
      case 'biteTell': { rear = 0.55; jaw = lerp(0.2, 1, this.t / 0.5); glow = 1; turn = 2.2; spd = -3 * S; if (this.t > (this.boss ? 0.55 : 0.4)) { this.go('bite'); this.lungeYaw = this.yaw; } break; }
      case 'bite': { jaw = lerp(1, 0, clamp((this.t - 0.16) / 0.1, 0, 1)); spd = (this.boss ? 62 : 26); rear = 0.15; this.hazard.bite = this.t > 0.05; if (this.t > 0.26) this.go('recover'); break; }
      case 'recover': { jaw = 0.1; spd = 0; rear = -0.25; glow = 0.1; if (this.t > (this.boss ? (this.fly ? 2.1 : 1.25) / fast : 0.8)) this.go('chase'); break; }
      case 'chargeTell': { rear = ease(clamp(this.t / 0.4, 0, 1)); jaw = 0.75; glow = 1; turn = 3; spd = -2; if (this.t > 0.95 / fast) this.go('charge'); break; }
      case 'charge': {
        turn = 0.55; spd = 36 * fast; jaw = 0.5; rear = 0.1; glow = 0.8; this.hazard.contact = true;
        for (const cl of nearColliders(this.head.x, this.head.z, 6)) if (cl.big && dist2(cl.x, cl.z, this.head.x, this.head.z) < cl.r + 2.6 * S) { this.go('stun'); emit('bossCrash', { x: this.head.x, y: this.head.y, z: this.head.z }); break; }
        if (this.st === 'charge' && this.t > 2.1) { this.go(ph === 3 && !this.fly ? 'sweepTell' : 'recover'); }
        break;
      }
      case 'inhaleTell': { jaw = lerp(0.2, 1, this.t / 0.7); glow = 1; turn = 2.4; spd = -2; rear = 0.2; if (this.t > 0.8) this.go('inhale'); break; }
      case 'inhale': { jaw = 1; glow = 1; turn = 0.9; spd = 1.5; this.hazard.bite = this.t > 0.25; if (this.t > 2.7) { this.go('bite'); this.lungeYaw = this.yaw; } break; }
      case 'stun': { jaw = 0.35; rear = -0.4; glow = 0; spd = 0; if (this.t > 3.6) this.go('chase'); break; }
      case 'sweepTell': { spd = 2; turn = 0.5; glow = 1; if (this.t > 0.75) { const tl = this.pts[this.segs]; this.ring = { x: tl.x, z: tl.z, r: 2, max: this.boss ? 46 : 12, y: hAt(tl.x, tl.z) }; emit('bossSweep', this.ring); this.go('sweep'); } break; }
      case 'sweep': { spd = 3; if (this.t > 0.9) this.go('chase'); break; }
      case 'dive': { dig = ease(clamp(this.t / 0.9, 0, 1)); rear = -0.6; spd = 9; turn = 1; if (this.t > 1.0) this.go('burrow'); break; }
      case 'burrow': { dig = 1; spd = 22 * fast; turn = 3.2; glow = 0; if (this.t > 2.4 || (n && n.d < 5 && this.t > 0.8)) { this.erupt = tp ? { x: tp.x, z: tp.z } : { x: this.head.x, z: this.head.z }; this.go('eruptTell'); emit('bossEruptTell', this.erupt); } break; }
      case 'eruptTell': { dig = 1; spd = 0; if (this.erupt) { this.head.x = damp(this.head.x, this.erupt.x, 9, dt); this.head.z = damp(this.head.z, this.erupt.z, 9, dt); } if (this.t > (this.fly ? 1.0 : 0.7)) { this.go('erupt'); emit('bossErupt', this.erupt); if (this.fly && this.erupt) this.ring = { x: this.erupt.x, z: this.erupt.z, r: 2, max: 40, y: hAt(this.erupt.x, this.erupt.z) }; } break; }
      case 'erupt': { const k = clamp(this.t / 0.35, 0, 1); dig = 1 - k; rear = 1.6 * Math.sin(k * Math.PI * 0.5) * (1 - clamp((this.t - 0.8) / 0.6, 0, 1)); jaw = 1; glow = 1; spd = 4; if (this.t < 0.35) this.hazard.erupt = this.erupt; if (this.t > 1.5) this.go('recover'); break; }
    }
    if (this.fly) dig = 0;
    if (turn > 0 && tp) { const dy = angDiff(this.yaw, aim), st = turn * dt; this.yaw += clamp(dy, -st, st); }
    this.speed = damp(this.speed, spd, this.st === 'bite' || this.st === 'charge' ? 30 : 5, dt);
    const hx0 = this.head.x, hz0 = this.head.z;
    this.head.x += Math.sin(this.yaw) * this.speed * dt; this.head.z += Math.cos(this.yaw) * this.speed * dt;
    // 바위 · 나무 : 못 넘는 것은 비켜서 돌아감 (돌진 · 잠행 중에는 예외)
    if (this.alive && !(this.fly && this.alts[0] > 5 * this.scale) && this.st !== 'charge' && this.st !== 'burrow' && this.st !== 'dive' && this.st !== 'erupt' && this.st !== 'eruptTell') {
      const hr = this.rad * 0.9, cap = this.boss ? 7 : 0.9, mv = Math.max(Math.abs(this.speed), 3) * dt;
      const bad = (x, z) => { if (solidTop(x, z) > hAt(x, z) + cap) return true; for (const c of nearColliders(x, z, 8)) { if (c.hf || c.h < 0 || c.node) continue; if (Math.hypot(x - c.x, z - c.z) < c.r + hr) return true; } return false; };
      if (bad(this.head.x, this.head.z)) { this.side = this.side || (Math.random() < 0.5 ? 1 : -1); let ok = false;
        for (const k of [0.5, 0.9, 1.3, 1.7, 2.1, 2.6, 3.14, -1.6, -2.4]) { const a = this.yaw + k * this.side, x = hx0 + Math.sin(a) * mv, z = hz0 + Math.cos(a) * mv; if (!bad(x, z)) { this.head.x = x; this.head.z = z; if (k < 0) this.side = -this.side; ok = true; break; } }
        if (!ok) { this.head.x = hx0; this.head.z = hz0; } this.sideT = 2.5; }
      else if (this.sideT > 0 && (this.sideT -= dt) <= 0) this.side = 0;
    }
    if (this.boss) { const dh = dist2(this.head.x, this.head.z, this.home.x, this.home.z), lim = 330; if (dh > lim) { this.head.x = this.home.x + (this.head.x - this.home.x) * lim / dh; this.head.z = this.home.z + (this.head.z - this.home.z) * lim / dh; } }
    this.rear = damp(this.rear, rear, 9, dt); this.jaw = damp(this.jaw, jaw, 18, dt); this.dig = dig; this.glow = damp(this.glow, glow, 8, dt);
    if (this.ring) { this.ring.r += 30 * dt; if (this.ring.r > this.ring.max) this.ring = null; }
    this.pushTrail();
    const hpR = this.hp / this.maxHp; if (this.boss) { const np = hpR < 0.33 ? 3 : hpR < 0.66 ? 2 : 1; if (np !== this.phase) { this.phase = np; this.go('roar'); emit('bossPhase', np); } }
  }
  playersNearBody(r) { for (const p of this.players()) for (let i = 6; i <= this.segs; i += 2) if (dist2(p.pos.x, p.pos.z, this.pts[i].x, this.pts[i].z) < r) return true; return false; }

  /* ── 모양 잡기 (모든 참가자) ── */
  place(dt) {
    const S = this.scale, n = this.segs, wave = G.time * 3.2;
    if (!this.alive) { this.deadT += dt; }
    const sink = this.alive ? 0 : Math.min(1, this.deadT / 2.5);
    if (this.fly) { const A = { sleep: 0, roar: 9, chase: 15, 'return': 12, biteTell: 4, bite: 0, recover: 0, chargeTell: 5, charge: 0.4, stun: 0, inhaleTell: 3, inhale: 1.5, dive: 20, burrow: 26, eruptTell: 26, erupt: 0, dead: 0 }, al = this.alts, want = (A[this.st] || 0) * Math.max(S, 0.35) * (this.alive ? 1 : 0), k = this.st === 'erupt' || this.st === 'bite' || this.st === 'charge' ? 9 : 2.6;
      al[0] = damp(al[0], want, k, dt); for (let i = 1; i < al.length; i++) al[i] = damp(al[i], al[i - 1], this.st === 'erupt' ? 14 : 7, dt); }
    for (let i = 0; i <= n + 1; i++) {
      const p = this.pts[i]; let x, z;
      if (i === 0) { x = this.head.x; z = this.head.z; } else { const a = this.along(i * this.spacing + 1.2 * S); x = a[0]; z = a[1]; }
      const k = i === 0 ? 1 : (this.segN[i - 1] ? this.segN[i - 1].userData.k : 0.4), g = gAt(x, z, this.boss ? 7 : 0.9);
      const digK = clamp(this.dig * 1.6 - i / n * 0.6, 0, 1);
      let y = Math.max(g, W.water - 1) + this.rad * k * 0.95 + Math.sin(wave - i * 0.55) * 0.35 * S * (this.speed > 2 ? 1 : 0.3);
      y -= digK * (this.rad * 2.6 + 3); y -= sink * this.rad * k * 0.55;
      if (this.fly) y += this.alts[i] + Math.sin(wave * 0.45 - i * 0.5) * 0.9 * S * Math.min(1, this.alts[i] / (4 * S + 0.01));
      if (i === 0) y += this.rear * 5.5 * S; else if (i < 5) y += this.rear * 5.5 * S * Math.pow(1 - i / 5, 1.6);
      p.set(x, y, z);
    }
    this.head.y = this.pts[0].y;
    // 머리
    const h = this.headN, p0 = this.pts[0], p1 = this.pts[1];
    h.position.copy(p0); const pitch = Math.atan2(p0.y - p1.y, dist2(p0.x, p0.z, p1.x, p1.z) + 0.001);
    h.rotation.set(0, 0, 0); h.rotation.order = 'YXZ'; h.rotation.y = this.yaw; h.rotation.x = -pitch * 0.9 - this.rear * 0.25 + (this.st === 'stun' ? 0.25 : 0) + (this.alive ? 0 : sink * 0.5); h.rotation.z = Math.sin(G.time * 1.3) * 0.05 + (this.st === 'stun' ? Math.sin(G.time * 9) * 0.06 : 0) + (this.alive ? 0 : sink * 0.9);
    this.jawN.rotation.x = this.jaw * 0.95;
    // 마디 : 앞 마디를 바라봄
    for (let i = 0; i < n; i++) { const s = this.segN[i], a = this.pts[i + 1], b = this.pts[i]; s.position.copy(a); V.copy(b); s.lookAt(V); s.rotateZ(Math.sin(wave * 0.5 - i * 0.6) * 0.08 + (this.alive ? 0 : sink * (i % 2 ? 0.7 : -0.5))); }
    const tl = this.tailN; tl.position.copy(this.pts[n + 1]); V.copy(this.pts[n]); tl.lookAt(V); if (this.st === 'sweepTell') tl.position.y += ease(clamp(this.t / 0.7, 0, 1)) * 5 * S;
    // 다리 : 발을 땅에 딛고, 멀어지면 한 걸음 옮김
    for (const L of this.legs) {
      const seg = this.segN[L.seg], k = seg.userData.k; X.set(1, 0, 0).applyQuaternion(seg.quaternion).multiplyScalar(L.side); Z.set(0, 0, 1).applyQuaternion(seg.quaternion);
      const hip = V.copy(seg.position).addScaledVector(X, 1.45 * S * k); hip.y -= 0.2 * S;
      const want = V2.copy(hip).addScaledVector(X, 4.6 * S * k).addScaledVector(Z, 2.0 * S); want.y = gAt(want.x, want.z, 7);
      if (!L.init) { L.foot.copy(want); L.init = true; L.t = 1; }
      const far = L.foot.distanceTo(want), stepLen = 4.2 * S * (((L.seg >> 1) + (L.side > 0 ? 0 : 1)) % 2 ? 1 : 1.25);
      if (L.t >= 1 && far > stepLen && this.alive) { L.from.copy(L.foot); L.to.copy(want).addScaledVector(Z, 2.4 * S * Math.min(1, this.speed / 10)); L.to.y = hAt(L.to.x, L.to.z); L.t = 0; }
      if (L.t < 1) { L.t = Math.min(1, L.t + dt / Math.max(0.07, 0.2 - this.speed * 0.004)); L.foot.lerpVectors(L.from, L.to, ease(L.t)); L.foot.y += Math.sin(L.t * Math.PI) * 2.2 * S; if (L.t >= 1 && this.boss && this.speed > 4) emit('bossStep', L.foot); }
      const foot = V3.copy(L.foot); foot.y -= digSink(this, L.seg) + sink * 0.5;
      const a = 3.2 * S * k, b = 4.6 * S * k; let d = hip.distanceTo(foot); if (d > a + b - 0.05) { foot.sub(hip).setLength(a + b - 0.05).add(hip); d = a + b - 0.05; }
      const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
      const dir = Y.subVectors(foot, hip).normalize(), side = new THREE.Vector3().crossVectors(dir, UP).normalize(), up = new THREE.Vector3().crossVectors(side, dir).normalize();
      const knee = new THREE.Vector3().copy(hip).addScaledVector(dir, a * cosA).addScaledVector(up, a * sinA);
      const hipC = hip.clone(), footC = foot.clone();
      L.u.scale.setScalar(S * k); L.l.scale.setScalar(S * k); basisX(L.u, hipC, knee, UP); basisX(L.l, knee, footC, UP);
    }
    // 빛 : 눈 · 옆구리 무늬 · 맞았을 때 번쩍
    const eg = 3 + this.glow * 14 + (this.st.endsWith('Tell') ? Math.sin(G.time * 30) * 4 : 0); for (const m of this.eyeMats) m.emissiveIntensity = this.alive ? eg : 0;
    for (const m of this.glowMats) m.emissiveIntensity = this.alive ? 2 + this.glow * 6 + (this.st === 'stun' ? 6 : 0) : 0;
    for (let i = 0; i < this.flash.length; i++) if (this.flash[i] > 0 || this._fl) { this.flash[i] = Math.max(0, this.flash[i] - dt * 5); const node = i === 0 ? this.headN : this.segN[i - 1]; if (node) node.traverse(m => { if (m.isMesh && m.material.name !== 'eye' && m.material.name !== 'glow' && m.material.name !== 'maw') m.material.emissive.setRGB(this.flash[i] * 1.2, this.flash[i] * 0.9, this.flash[i] * 0.6); }); }
    if (!this.alive && this.deadT > 14) this.group.visible = false;
  }

  /* ── 맞기 : 가장 가까운 부위 ── */
  hitTest(x, y, z, r) {
    if (!this.alive || this.dig > 0.6) return null; let best = -1, bd = 1e9;
    for (let i = 0; i <= this.segs; i++) { const p = this.pts[i], k = i === 0 ? 1.25 : this.segN[i - 1].userData.k, d = Math.hypot(p.x - x, p.z - z) - this.rad * k, dy = Math.abs(p.y - y) - this.rad * k; if (d < r && dy < r + 1 && d < bd) { bd = d; best = i; } }
    return best < 0 ? null : { i: best, p: this.pts[best] };
  }
  mult(i) { const weak = this.st === 'stun' ? 3 : this.st === 'recover' ? 2 : 1; return i === 0 ? 1.5 * weak : weak > 1 ? 1.3 : 1; }
  applyDamage(i, dmg) {
    if (!this.alive) return; this.hp = Math.max(0, this.hp - dmg); this.flash[i] = 1; this._fl = true;
    if (this.st === 'sleep') this.go('roar');
    if (this.hp <= 0) { this.alive = false; this.st = 'dead'; this.ring = null; this.hazard = { bite: false, contact: false, erupt: null }; emit('bossDead', { id: this.id, boss: this.boss, pos: this.head.clone() }); }
  }

  /* ── 내 캐릭터가 당하는지 (각자 자기 화면에서 판정) ── */
  hazards(pl) {
    if (!this.alive || pl.dead || pl.grabbed) return; const S = this.scale, p = pl.pos, hz = this.hazard;
    const mouth = V.set(this.head.x + Math.sin(this.yaw) * 3.6 * S, this.head.y - 0.6 * S, this.head.z + Math.cos(this.yaw) * 3.6 * S);
    if (hz.bite && pl.inv <= 0 && Math.hypot(p.x - mouth.x, p.z - mouth.z) < 3.3 * S + 0.5 && Math.abs(p.y - mouth.y) < 4.2 * S + 1) {
      if (this.boss) { const self = this, t0 = G.time; pl.grabbed = () => { if (G.time - t0 > 1.25 || !self.alive) { pl.grabbed = null; pl.inv = 0; pl.damage(42, self.head, 20); pl.vel.y = 15; } return V2.set(self.head.x + Math.sin(self.yaw) * 2.6 * S, self.head.y - 0.9 * S, self.head.z + Math.cos(self.yaw) * 2.6 * S); }; emit('grabbed'); }
      else pl.damage(12, this.head, 10);
      return;
    }
    if (this.st === 'inhale' && !(pl.dashT > 0)) { const dx = mouth.x - p.x, dz = mouth.z - p.z, d = Math.hypot(dx, dz), a = Math.abs(angDiff(this.yaw, Math.atan2(-dx, -dz)));
      if (d < 46 * S && d > 1 && a < 0.75) { const pull = (this.boss ? 9.2 : 5) * (1 - d / (60 * S)) * G.dt; p.x += dx / d * pull; p.z += dz / d * pull; pl.pulled = 0.2; } }
    if (hz.contact) for (let i = 0; i < 6; i++) { const q = this.pts[i]; if (Math.hypot(p.x - q.x, p.z - q.z) < this.rad * 1.15 + 0.5 && p.y < q.y + this.rad + 1 && p.y > q.y - this.rad * 1.6 - 1) { pl.damage(30, q, 24); return; } }
    if (hz.erupt && Math.hypot(p.x - hz.erupt.x, p.z - hz.erupt.z) < 7.5 * S) { if (pl.damage(34, hz.erupt, 12)) pl.vel.y = 22; return; }
    if (this.ring) { const d = Math.hypot(p.x - this.ring.x, p.z - this.ring.z); if (Math.abs(d - this.ring.r) < 1.6 && p.y < hAt(p.x, p.z) + 1.5) pl.damage(this.boss ? 22 : 8, this.ring, 10); }
    // 몸에 깔리지 않게 밀어냄
    if (this.dig < 0.5) for (let i = 0; i <= this.segs; i += 1) { const q = this.pts[i], k = i === 0 ? 1.1 : this.segN[i - 1].userData.k, rr = this.rad * k * 0.9 + 0.4, dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz); if (d < rr && d > 0.01 && p.y < q.y + this.rad * k * 0.8 && p.y > q.y - this.rad * k * 1.6 - 1) { p.x = q.x + dx / d * rr; p.z = q.z + dz / d * rr; } }
  }

  /* ── 통신 ── */
  snapshot() { const t = this.trail, n = Math.min(t.length, (Math.ceil(this.segs * this.spacing / 0.5) + 6) * 2), a = new Array(n / 4 | 0); for (let i = 0, k = 0; i + 1 < n; i += 4) a[k++] = [Math.round(t[i] * 10) / 10, Math.round(t[i + 1] * 10) / 10]; return { id: this.id, st: this.st, t: +this.t.toFixed(2), hp: this.hp, mh: this.maxHp, x: +this.head.x.toFixed(2), z: +this.head.z.toFixed(2), yaw: +this.yaw.toFixed(3), sp: +this.speed.toFixed(1), rear: +this.rear.toFixed(2), jaw: +this.jaw.toFixed(2), dig: +this.dig.toFixed(2), glow: +this.glow.toFixed(2), ring: this.ring, hz: this.hazard, ph: this.phase, tr: a, alive: this.alive }; }
  applyNet(s) { this.net = s; if (s.st !== this.st) { this.st = s.st; emit('bossState', { id: this.id, st: s.st, boss: this.boss, pos: this.head }); } this.t = s.t; this.hp = s.hp; if (s.mh) this.maxHp = s.mh; this.phase = s.ph; this.ring = s.ring; this.hazard = s.hz || this.hazard; if (this.alive && !s.alive) { this.alive = false; emit('bossDead', { id: this.id, boss: this.boss, pos: this.head.clone() }); } const tr = this.trail; tr.length = 0; for (const p of s.tr) { tr.push(p[0], p[1]); } }
  follow(dt) { const s = this.net; if (!s) return; this.t += dt; this.head.x = damp(this.head.x, s.x + Math.sin(s.yaw) * s.sp * 0.05, 14, dt); this.head.z = damp(this.head.z, s.z + Math.cos(s.yaw) * s.sp * 0.05, 14, dt); this.yaw = dampAng(this.yaw, s.yaw, 14, dt); this.speed = s.sp; this.rear = damp(this.rear, s.rear, 12, dt); this.jaw = damp(this.jaw, s.jaw, 16, dt); this.dig = damp(this.dig, s.dig, 10, dt); this.glow = s.glow; if (this.ring) this.ring.r += 30 * dt; }
  update(dt, host) { if (host) this.simulate(dt); else this.follow(dt); this.place(dt); }
}
function digSink(w, seg) { return clamp(w.dig * 1.6 - seg / w.segs * 0.6, 0, 1) * (w.rad * 2.6 + 3); }

export function spawnMonsters() {
  if (G.region === 2) {
    G.boss = new Wyrm({ model: 'gorae', fly: true, name: '구름고래 「먹구름」', segs: 16, maxHp: 3400 });
    [[160, -110], [-150, 170], [300, 90], [-90, -280], [-340, 280], [90, 380]].forEach(([x, z], i) => { if (hAt(x, z) > W.water + 1) G.mobs.push(new Wyrm({ id: 'm' + i, model: 'gorae', fly: true, scale: 0.26, segs: 7, maxHp: 190, boss: false, name: '새끼 구름고래', home: { x, z, r: 34 } })); });
    [[-220, -60], [230, 330], [470, -40]].forEach(([x, z], i) => { if (hAt(x, z) > W.water + 1) G.mobs.push(new Wyrm({ id: 'g' + i, scale: 0.34, segs: 9, maxHp: 230, boss: false, name: '고원 아귀', home: { x, z, r: 30 } })); });
  } else {
  G.boss = new Wyrm({});
  const spots = [[150, -90], [-140, 190], [300, 60], [-60, -260], [420, -180], [-330, 300], [60, 380]];
  spots.forEach(([x, z], i) => { if (hAt(x, z) > W.water + 1) G.mobs.push(new Wyrm({ id: 'm' + i, scale: 0.3, segs: 8, maxHp: 170, boss: false, name: '새끼 아귀', home: { x, z, r: 30 } })); });
  }
  G.findTarget = (pos, yaw, range) => { let b = null, bd = range; for (const w of [G.boss, ...G.mobs]) { if (!w.alive) continue; const h = w.hitTest(pos.x, pos.y + 0.8, pos.z, range); if (h) { const d = Math.hypot(h.p.x - pos.x, h.p.z - pos.z); if (d < bd + w.rad) { bd = d; b = h.p; } } } return b; };
}
