// 꼬물족 캐릭터 : 부위별 움직임(절차식 애니메이션) + 내 캐릭터 조작 + 카메라
import { THREE, G, clamp, lerp, damp, dampAng, angDiff, dist2, emit } from './g.js';
import { clone } from './assets.js';
import { W, hAt, groundAt, nearColliders, solidTop } from './world.js';
import { I, consume, readMove } from './input.js';

const V = new THREE.Vector3();
export class Char {
  constructor(kind, opt = {}) {
    this.kind = kind; this.root = new THREE.Group(); this.model = clone('ch_' + kind); this.root.add(this.model); this.scale = opt.scale || 1.25; this.model.scale.setScalar(this.scale);
    this.n = {}; this.extras = []; this.eyes = []; this.mats = [];
    this.model.traverse(o => {
      if (/^(body|head|armL|armR|legL|legR)$/.test(o.name)) this.n[o.name] = o;
      if (/^(extra|tail)\d/.test(o.name) && !o.isMesh) this.extras.push({ o, a: Math.random() * 6, v: 0, r: 0 });
      if (o.isMesh) { o.castShadow = true; if (/^eye|^shine/.test(o.name)) this.eyes.push(o); o.material = o.material.clone(); o.material.envMapIntensity = 0.25; if (!/^eye|^shine/.test(o.name)) o.material.color.multiplyScalar(0.74); this.mats.push(o.material); }
    });
    this.rest = {}; for (const k in this.n) this.rest[k] = { p: this.n[k].position.clone(), r: this.n[k].rotation.clone() };
    this.phase = Math.random() * 6; this.squash = 0; this.squashV = 0; this.blink = 2 + Math.random() * 3; this.t = Math.random() * 10; this.flash = 0;
    this.st = { speed: 0, grounded: true, vy: 0, dash: 0, atk: -1, combo: 0, hurt: 0, eaten: 0, dead: false, cheer: 0 };
    if (opt.weapon !== false) this.setWeapon();
    if (opt.name) this.setName(opt.name);
    G.scene.add(this.root);
  }
  setWeapon() {
    const w = clone('wooden_axe'); const b = new THREE.Box3().setFromObject(w), s = b.getSize(V), k = 0.62 / Math.max(s.x, s.y, s.z); w.scale.setScalar(k / this.scale * 1.25);
    const h = new THREE.Group(); h.add(w); w.position.set(0, 0, 0); w.rotation.set(0, 0, 0);
    // 도끼 자루가 손에서 위로 서도록 가장 긴 축을 세움
    if (s.x >= s.y && s.x >= s.z) w.rotation.z = Math.PI / 2; else if (s.z >= s.y) w.rotation.x = -Math.PI / 2;
    h.position.set(-0.06, -0.10, 0.06); h.rotation.set(1.2, 0, 0); (this.n.armR || this.model).add(h); this.weapon = h;
    w.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }
  setName(name) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d'); g.font = '700 30px Jua, "Noto Sans KR", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 7; g.strokeStyle = 'rgba(20,24,40,.85)'; g.strokeText(name, 128, 34); g.fillStyle = '#fff8e8'; g.fillText(name, 128, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true, color: 0xb0b0b0, toneMapped: false })); sp.scale.set(2.4, 0.6, 1); sp.position.y = 1.9 * this.scale / 1.25 + 0.2; this.root.add(sp); this.tag = sp;
  }
  land(v) { this.squashV -= clamp(v * 0.09, 0.4, 2.2); }
  hit() { this.flash = 1; this.st.hurt = 0.35; }
  update(dt) {
    const s = this.st, n = this.n, R = this.rest; this.t += dt; if (!n.body) return;
    const run = clamp(s.speed / 10, 0, 1.4), air = !s.grounded;
    this.phase += dt * (5.5 + s.speed * 1.25) * (run > 0.05 && !air ? 1 : 0.25);
    const ph = this.phase, sw = Math.sin(ph), sw2 = Math.sin(ph * 2);
    // 찌그러짐 · 늘어남 (착지 · 점프)
    this.squashV += (-this.squash * 140 - this.squashV * 14) * dt; this.squash += this.squashV * dt;
    let sy = 1 + this.squash + (air ? clamp(s.vy * 0.012, -0.08, 0.16) : 0); let sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    if (s.eaten > 0) { sy *= 0.6; sxz *= 0.6; }
    this.model.scale.set(this.scale * sxz, this.scale * sy, this.scale * sxz);
    // 기울기
    let lean = run * 0.22, roll = 0, spin = 0, lift = 0;
    if (s.dash > 0) { lean = 1.05; }
    if (s.dead) { lean = 1.5; }
    const br = Math.sin(this.t * 2.2) * 0.012;
    n.body.position.y = R.body.p.y + (air ? 0 : Math.abs(sw) * 0.035 * run) + br;
    n.head.position.y = R.head.p.y + (air ? 0 : Math.abs(Math.sin(ph + 0.4)) * 0.045 * run) + br * 1.6;
    n.head.rotation.x = R.head.r.x - lean * 0.55 + (air ? clamp(-s.vy * 0.02, -0.3, 0.35) : 0) + Math.sin(this.t * 0.9) * 0.03;
    n.head.rotation.z = Math.sin(this.t * 0.6) * 0.04 + sw * 0.05 * run;
    // 팔다리
    let aL = -sw * 1.0 * run, aR = sw * 1.0 * run, lL = sw * 1.05 * run, lR = -sw * 1.05 * run, aZ = 0.15 + run * 0.15;
    if (air) { const f = clamp(s.vy * 0.05, -1, 1); aL = aR = -2.2 * Math.max(0, f) - 0.6; aZ = 0.9 + Math.sin(this.t * 22) * 0.25 * (f < 0 ? 1 : 0); lL = 0.5 + f * 0.4; lR = -0.3 - f * 0.3; }
    if (s.dash > 0) { aL = aR = 1.4; lL = lR = 0.9; aZ = 0.3; }
    if (s.cheer > 0) { aL = aR = -2.8 + Math.sin(this.t * 14) * 0.3; aZ = 0.5; lift = Math.abs(Math.sin(this.t * 9)) * 0.12; }
    // 공격 : 휘두르기 3연타 (3타는 회전 베기)
    let twist = 0;
    if (s.atk >= 0) {
      const t = s.atk, e = t < 0.35 ? t / 0.35 : 1, back = t > 0.6 ? (t - 0.6) / 0.4 : 0;
      if (s.combo === 2) { spin = t * Math.PI * 2; aR = -1.6; aZ = 1.3; aL = -0.8; }
      else { const dir = s.combo === 1 ? -1 : 1; aR = lerp(-2.7, 1.1, e * e) * (1 - back) + aR * back; twist = lerp(-0.7, 0.7, e) * dir * (1 - back); aL = 0.6; lean += 0.25 * e * (1 - back); }
    }
    n.armL.rotation.set(aL, 0, aZ); n.armR.rotation.set(aR, 0, -aZ); n.legL.rotation.x = lL; n.legR.rotation.x = lR;
    this.model.rotation.set(lean, spin + twist, roll); this.model.position.y = lift;
    // 잎 · 아가미 · 꼬리 : 흔들림
    for (const x of this.extras) { const target = Math.sin(this.t * 1.7 + x.a) * 0.12 + sw2 * 0.25 * run + (air ? -s.vy * 0.03 : 0) + (s.dash > 0 ? 0.8 : 0); x.v += ((target - x.r) * 90 - x.v * 9) * dt; x.r += x.v * dt; x.o.rotation.x = x.r; }
    // 눈 깜박임
    this.blink -= dt; const cl = this.blink < 0.1 || s.hurt > 0 || s.dead; if (this.blink < 0) this.blink = 1.5 + Math.random() * 4; for (const e of this.eyes) e.scale.y = cl ? 0.12 : 1;
    // 맞았을 때 붉게
    if (this.flash > 0 || this._fl) { this.flash = Math.max(0, this.flash - dt * 3.5); this._fl = this.flash > 0; for (const m of this.mats) { m.emissive.setRGB(this.flash * 0.9, this.flash * 0.1, this.flash * 0.1); } }
    if (s.hurt > 0) s.hurt -= dt; if (s.cheer > 0) s.cheer -= dt;
  }
  dispose() { G.scene.remove(this.root); }
}

/* ───── 내 캐릭터 ───── */
export const TUNE = { run: 10.5, accel: 75, airAccel: 34, jump: 13.5, jump2: 12, gravity: 34, dashSpeed: 31, dashTime: 0.19, dashCd: 0.5, dashCost: 22, iframes: 0.3, stamRegen: 30, atkTime: 0.34, atkRange: 2.9, atkDmg: 22 };
export class Player {
  constructor(kind, name) {
    this.ch = new Char(kind, { name }); this.kind = kind; this.name = name;
    this.pos = new THREE.Vector3(W.spawn.x + 4, 0, W.spawn.z + 6); this.pos.y = hAt(this.pos.x, this.pos.z); this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.grounded = true;
    this.jumps = 0; this.coyote = 0; this.dashT = 0; this.dashCd = 0; this.airDash = false; this.stam = 100; this.hp = 100; this.maxHp = 100; this.inv = 0; this.atk = -1; this.combo = 0; this.comboT = 0; this.hitDone = false; this.launch = 0;
    this.dead = false; this.respawnT = 0; this.grabbed = null; this.camPos = new THREE.Vector3(); this.camTarget = new THREE.Vector3(); this.shake = 0; this.stepT = 0;
  }
  damage(d, from, knock = 14) {
    if (this.inv > 0 || this.dead) return false;
    this.hp -= d; this.inv = 0.9; this.ch.hit(); this.shake = Math.max(this.shake, 0.6); emit('hurt', { d });
    if (from) { const dx = this.pos.x - from.x, dz = this.pos.z - from.z, l = Math.hypot(dx, dz) || 1; this.vel.x = dx / l * knock; this.vel.z = dz / l * knock; this.vel.y = 9; this.grounded = false; }
    if (this.hp <= 0) this.die(); return true;
  }
  die() { this.dead = true; this.hp = 0; this.respawnT = 4; this.ch.st.dead = true; emit('died'); }
  respawn() {
    const h = G.home || { x: W.spawn.x + 4, z: W.spawn.z + 6 }; this.pos.set(h.x, hAt(h.x, h.z) + 0.5, h.z); this.vel.set(0, 0, 0); this.hp = this.maxHp; this.dead = false; this.ch.st.dead = false; this.inv = 2.5; this.grabbed = null; emit('respawn');
  }
  heal(v) { this.hp = Math.min(this.maxHp, this.hp + v); }
  update(dt) {
    const T = TUNE, s = this.ch.st; readMove();
    this.inv = Math.max(0, this.inv - dt); this.dashCd = Math.max(0, this.dashCd - dt); this.comboT = Math.max(0, this.comboT - dt);
    if (this.dead) { this.respawnT -= dt; this.vel.x = damp(this.vel.x, 0, 6, dt); this.vel.z = damp(this.vel.z, 0, 6, dt); if (this.respawnT <= 0) this.respawn(); }
    if (this.grabbed) { this.pos.copy(this.grabbed()); this.vel.set(0, 0, 0); s.eaten = 1; this.sync(dt); this.camera(dt); return; } else s.eaten = 0;
    // 이동 방향 (카메라 기준)
    const fx = -Math.sin(I.yaw), fz = -Math.cos(I.yaw), rx = Math.cos(I.yaw), rz = -Math.sin(I.yaw);
    let mx = rx * I.mx - fx * I.mz, mz = rz * I.mx - fz * I.mz; const ml = Math.hypot(mx, mz);
    const canAct = !this.dead && !G.ui.blocked;
    if (!canAct) { mx = mz = 0; }
    const swim = this.pos.y < W.water - 0.35 && hAt(this.pos.x, this.pos.z) < W.water - 0.5;
    const maxS = T.run * (swim ? 0.55 : 1) * (this.atk >= 0 && this.atk < 0.6 ? 0.55 : 1);
    // 대시
    if (canAct && consume('dash') && this.dashCd <= 0 && this.stam >= T.dashCost && (this.grounded || !this.airDash)) {
      let dx = mx, dz = mz; if (ml < 0.1) { dx = Math.sin(this.yaw); dz = Math.cos(this.yaw); } const l = Math.hypot(dx, dz);
      this.dashDir = [dx / l, dz / l]; this.dashT = T.dashTime; this.dashCd = T.dashCd; this.stam -= T.dashCost; this.inv = Math.max(this.inv, T.iframes); if (!this.grounded) this.airDash = true; this.vel.y = Math.max(this.vel.y, 1.5); this.atk = -1; emit('dash', this.pos);
    }
    if (this.dashT > 0) {
      this.dashT -= dt; this.vel.x = this.dashDir[0] * T.dashSpeed; this.vel.z = this.dashDir[1] * T.dashSpeed; this.vel.y = Math.max(this.vel.y - T.gravity * 0.25 * dt, -2); this.yaw = Math.atan2(this.dashDir[0], this.dashDir[1]);
      if (this.dashT <= 0) { this.vel.x *= 0.45; this.vel.z *= 0.45; }
    } else {
      const acc = this.grounded ? T.accel : T.airAccel;
      if (this.launch > 0) { this.launch -= dt; }      // 바람꽃 도약 중에는 수평 속도 유지
      else {
        const tx = mx * maxS, tz = mz * maxS, dvx = tx - this.vel.x, dvz = tz - this.vel.z, dl = Math.hypot(dvx, dvz), st = acc * dt;
        if (dl <= st) { this.vel.x = tx; this.vel.z = tz; } else { this.vel.x += dvx / dl * st; this.vel.z += dvz / dl * st; }
      }
      if (ml > 0.1 && this.atk < 0) this.yaw = dampAng(this.yaw, Math.atan2(mx, mz), 16, dt);
      this.vel.y -= T.gravity * dt * (this.vel.y < 0 ? 1.25 : 1);
    }
    // 점프
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    if (canAct && consume('jump')) {
      if (this.coyote > 0) { this.vel.y = T.jump; this.grounded = false; this.coyote = 0; this.jumps = 1; this.ch.squashV += 1.6; emit('jump', this.pos); }
      else if (this.jumps < 2) { this.vel.y = T.jump2; this.jumps = 2; this.ch.squashV += 1.2; emit('jump2', this.pos); }
    }
    // 공격
    if (canAct && consume('attack') && this.dashT <= 0 && (this.atk < 0 || this.atk > 0.55)) {
      this.combo = this.comboT > 0 ? (this.combo + 1) % 3 : 0; this.atk = 0; this.hitDone = false;
      const tg = G.findTarget ? G.findTarget(this.pos, this.yaw, 7) : null; if (tg) this.yaw = Math.atan2(tg.x - this.pos.x, tg.z - this.pos.z);
      if (this.grounded) { this.vel.x += Math.sin(this.yaw) * 5; this.vel.z += Math.cos(this.yaw) * 5; }
      emit('swing', { combo: this.combo });
    }
    if (this.atk >= 0) {
      this.atk += dt / (T.atkTime * (this.combo === 2 ? 1.5 : 1));
      if (!this.hitDone && this.atk > 0.32) { this.hitDone = true; const dmg = (T.atkDmg + G.weaponLv * 9) * (this.combo === 2 ? 1.9 : 1) * (this.grounded ? 1 : 1.25); emit('strike', { x: this.pos.x + Math.sin(this.yaw) * 1.3, y: this.pos.y + 0.8, z: this.pos.z + Math.cos(this.yaw) * 1.3, r: T.atkRange * (this.combo === 2 ? 1.25 : 1), dmg, yaw: this.yaw, spin: this.combo === 2 }); }
      if (this.atk >= 1) { this.atk = -1; this.comboT = 0.45; }
    }
    this.stam = Math.min(100, this.stam + T.stamRegen * dt * (this.dashT > 0 ? 0 : 1));
    // 이동 · 충돌
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y += this.vel.y * dt;
    for (const c of nearColliders(this.pos.x, this.pos.z, 12)) { if (c.hf || c.h < 0) continue; const dx = this.pos.x - c.x, dz = this.pos.z - c.z, d = Math.hypot(dx, dz), rr = c.r + 0.45, y0 = c.y0 === undefined ? hAt(c.x, c.z) : c.y0; if (d < rr && d > 0.001 && this.pos.y < y0 + (c.h || 6) && this.pos.y > y0 - 2) { this.pos.x = c.x + dx / d * rr; this.pos.z = c.z + dz / d * rr; } }
    // 바위 · 그루터기 : 옆면은 막히고, 뛰어오르면 위에 설 수 있음
    { const lim = this.pos.y + 0.14 + Math.hypot(this.pos.x - ox, this.pos.z - oz) * 1.5;
      if (solidTop(this.pos.x, this.pos.z) > lim) { if (solidTop(this.pos.x, oz) <= lim) this.pos.z = oz; else if (solidTop(ox, this.pos.z) <= lim) this.pos.x = ox; else { this.pos.x = ox; this.pos.z = oz; } } }
    const dc = Math.hypot(this.pos.x, this.pos.z); if (dc > W.limit) { this.pos.x *= W.limit / dc; this.pos.z *= W.limit / dc; }
    let g = groundAt(this.pos.x, this.pos.z, this.pos.y); if (swim || hAt(this.pos.x, this.pos.z) < W.water - 0.55) g = Math.max(g, W.water - 0.55);
    const was = this.grounded;
    if (this.pos.y <= g) { if (!was && this.vel.y < -6) { this.ch.land(-this.vel.y); emit('land', { pos: this.pos, v: -this.vel.y }); } this.pos.y = g; this.vel.y = 0; this.grounded = true; this.jumps = 0; this.airDash = false; this.launch = 0; }
    else if (this.pos.y > g + 0.25) this.grounded = false;
    else if (was && this.vel.y <= 0) { this.pos.y = g; this.vel.y = 0; }      // 내리막에서 바닥에 붙음
    // 바람꽃
    if (this.grounded) for (const p of W.pads) if (dist2(this.pos.x, this.pos.z, p.x, p.z) < p.r) { const t = p.power / T.gravity * 1.72; this.vel.y = p.power; this.vel.x = p.dir[0] * p.dist / t; this.vel.z = p.dir[1] * p.dist / t; this.grounded = false; this.launch = t * 0.95; this.jumps = 1; this.ch.squashV += 2.5; emit('pad', p); }
    // 발소리
    if (this.grounded && Math.hypot(this.vel.x, this.vel.z) > 4) { this.stepT -= dt * Math.hypot(this.vel.x, this.vel.z); if (this.stepT < 0) { this.stepT = 2.4; emit('step', this.pos); } }
    this.sync(dt); this.camera(dt);
  }
  sync(dt) {
    const s = this.ch.st; s.speed = Math.hypot(this.vel.x, this.vel.z); s.grounded = this.grounded; s.vy = this.vel.y; s.dash = this.dashT; s.atk = this.atk; s.combo = this.combo;
    this.ch.root.position.copy(this.pos); this.ch.root.rotation.y = this.yaw; this.ch.root.visible = !(this.inv > 0 && !this.dead && Math.floor(G.time * 18) % 2 === 0 && this.dashT <= 0 && this.inv < 0.85);
    this.ch.update(dt);
  }
  camera(dt) {
    const cam = G.camera, fight = G.boss && G.boss.alive && dist2(this.pos.x, this.pos.z, G.boss.head.x, G.boss.head.z) < 110;
    const dist = I.zoom + (fight ? 5.5 : 0) + Math.min(6, Math.hypot(this.vel.x, this.vel.z) * 0.08) + Math.max(0, this.pos.y - hAt(this.pos.x, this.pos.z) - 8) * 0.25;
    this.camDist = damp(this.camDist || dist, dist, 3, dt);
    V.set(this.pos.x, this.pos.y + 1.5 + (fight ? 1.2 : 0), this.pos.z); this.camTarget.lerp(V, 1 - Math.exp(-14 * dt));
    const cp = Math.cos(I.pitch), px = this.camTarget.x + Math.sin(I.yaw) * cp * this.camDist, pz = this.camTarget.z + Math.cos(I.yaw) * cp * this.camDist; let py = this.camTarget.y + Math.sin(I.pitch) * this.camDist;
    py = Math.max(py, Math.max(hAt(px, pz), solidTop(px, pz)) + 0.7);
    cam.position.set(px, py, pz);
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 1.8); const k = this.shake * this.shake * 0.9; cam.position.x += (Math.random() - 0.5) * k; cam.position.y += (Math.random() - 0.5) * k; cam.position.z += (Math.random() - 0.5) * k; }
    cam.lookAt(this.camTarget); cam.fov = damp(cam.fov, fight ? 66 : 58 + Math.min(8, Math.hypot(this.vel.x, this.vel.z) * 0.25), 4, dt); cam.updateProjectionMatrix();
  }
}

/* ───── 다른 플레이어 (받은 상태를 부드럽게 따라감) ───── */
export class Remote {
  constructor(id, kind, name) { this.id = id; this.ch = new Char(kind, { name }); this.pos = new THREE.Vector3(0, -100, 0); this.to = new THREE.Vector3(); this.yaw = 0; this.toYaw = 0; this.first = true; this.hp = 100; this.last = performance.now(); }
  set(m) { this.to.set(m.x, m.y, m.z); this.toYaw = m.yaw; const s = this.ch.st; s.grounded = !!m.g; s.dash = m.d ? 0.1 : 0; if (m.a >= 0 && s.atk < 0) s.atk = 0; s.combo = m.c || 0; s.dead = !!m.dead; this.hp = m.hp; if (this.first) { this.pos.copy(this.to); this.first = false; } this.last = performance.now(); if (m.hit) this.ch.hit(); }
  update(dt) {
    const s = this.ch.st, before = V.copy(this.pos); this.pos.lerp(this.to, 1 - Math.exp(-12 * dt)); this.yaw = dampAng(this.yaw, this.toYaw, 12, dt);
    s.speed = Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / Math.max(dt, 0.001); s.vy = (this.pos.y - before.y) / Math.max(dt, 0.001);
    if (s.atk >= 0) { s.atk += dt / 0.36; if (s.atk >= 1) s.atk = -1; }
    this.ch.root.position.copy(this.pos); this.ch.root.rotation.y = this.yaw; this.ch.update(dt);
  }
}
