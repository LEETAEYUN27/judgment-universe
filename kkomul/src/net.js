// 같이 하기 : 방장 브라우저가 중심이 되는 P2P (PeerJS 무료 중계 서버는 연결 주선만 담당). 최대 10명.
import { G, emit } from './g.js';
import { Remote } from './player.js';
import { nodeRemote, placeBuild, farmRemote } from './life.js';
const PRE = 'kkomul-world-v1-', MAXP = 10;
export class Net {
  constructor() { this.host = false; this.peer = null; this.conns = new Map(); this.up = null; this.id = null; this.code = null; this.sendT = 0; this.bossT = 0; }
  static code() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  open(id) { return new Promise((res, rej) => { const p = new Peer(id, { debug: 1 }); const t = setTimeout(() => rej(new Error('연결 서버 응답 없음')), 25000); p.on('open', i => { clearTimeout(t); res(p); }); p.on('error', e => { clearTimeout(t); rej(e); }); }); }
  async create() {
    this.code = Net.code(); this.peer = await this.open(PRE + this.code); this.host = true; this.id = 'host';
    this.peer.on('connection', c => {
      c.on('open', () => { if (this.conns.size >= MAXP - 1) { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); return; } });
      c.on('data', m => this.onHost(c, m)); c.on('close', () => this.drop(c)); c.on('error', () => this.drop(c));
    });
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (e) { } });
    return this.code;
  }
  async join(code) {
    this.code = code.toUpperCase().trim(); this.peer = await this.open(undefined); this.id = this.peer.id.slice(0, 8);
    await new Promise((res, rej) => { const c = this.peer.connect(PRE + this.code, { reliable: true, serialization: 'json' }); const t = setTimeout(() => rej(new Error('방을 찾지 못함')), 20000);
      c.on('open', () => { clearTimeout(t); this.up = c; c.send({ t: 'hello', id: this.id, name: G.me.name, kind: G.me.kind }); res(); });
      c.on('data', m => this.onClient(m)); c.on('close', () => emit('toast', '방장과의 연결이 끊어짐. 혼자 하기로 이어감')); c.on('error', e => rej(e)); this.peer.on('error', e => { clearTimeout(t); rej(e); }); });
  }
  drop(c) { const id = c._pid; if (!id) return; this.conns.delete(id); const r = G.others.get(id); if (r) { r.ch.dispose(); G.others.delete(id); emit('toast', (r.ch.tagName || '친구') + ' 나감'); emit('roster'); } this.cast({ t: 'leave', id }); }
  cast(m, except) { for (const [id, c] of this.conns) if (id !== except && c.open) c.send(m); }
  send(m) { if (this.host) this.cast(m); else if (this.up && this.up.open) this.up.send(m); }
  addRemote(id, kind, name) { if (G.others.has(id) || id === this.id) return; const r = new Remote(id, kind, name); r.ch.tagName = name; G.others.set(id, r); emit('roster'); }
  onHost(c, m) {
    if (m.t === 'hello') {
      c._pid = m.id; this.conns.set(m.id, c); this.addRemote(m.id, m.kind, m.name); emit('toast', m.name + ' 들어옴');
      const players = [{ id: 'host', kind: G.me.kind, name: G.me.name }]; for (const [id, r] of G.others) if (id !== m.id) players.push({ id, kind: r.ch.kind, name: r.ch.tagName });
      c.send({ t: 'welcome', players, time: G.time, wt: G.worldTime(), builds: G.builds.map(b => ({ k: b.k, x: b.x, z: b.z, ry: b.ry, state: b.state || 0 })), gone: G.goneNodes(), bossHp: G.boss.hp, bossAlive: G.boss.alive });
      this.cast({ t: 'join', id: m.id, kind: m.kind, name: m.name }, m.id); return;
    }
    if (m.t === 'p') { const r = G.others.get(m.id); if (r) r.set(m); this.cast(m, m.id); return; }
    if (m.t === 'dmg') { emit('netDmg', m); return; }
    this.world(m); this.cast(m, c._pid);
  }
  onClient(m) {
    if (m.t === 'full') { emit('toast', '방이 가득 참 (최대 10명)'); return; }
    if (m.t === 'welcome') { m.players.forEach(p => this.addRemote(p.id, p.kind, p.name)); m.builds.forEach(b => placeBuild(b, false)); m.gone.forEach(id => nodeRemote(id)); G.setWorldTime(m.wt); if (!m.bossAlive) { G.boss.alive = false; G.boss.deadT = 99; G.boss.group.visible = false; } emit('toast', '방에 들어옴 · ' + (m.players.length + 1) + '명'); return; }
    if (m.t === 'join') { this.addRemote(m.id, m.kind, m.name); emit('toast', m.name + ' 들어옴'); return; }
    if (m.t === 'leave') { const r = G.others.get(m.id); if (r) { r.ch.dispose(); G.others.delete(m.id); emit('roster'); } return; }
    if (m.t === 'p') { const r = G.others.get(m.id); if (r) r.set(m); return; }
    if (m.t === 'boss') { for (const s of m.list) { const w = s.id === 'boss' ? G.boss : G.mobs.find(x => x.id === s.id); if (w) w.applyNet(s); } return; }
    if (m.t === 'hitfx') { emit('hitfx', m); return; }
    this.world(m);
  }
  world(m) { if (m.t === 'node') nodeRemote(m.id); else if (m.t === 'build') placeBuild(m.item, false); else if (m.t === 'farm') farmRemote(m.x, m.z); }
  update(dt) {
    this.sendT -= dt; const me = G.me;
    if (this.sendT <= 0) { this.sendT = 0.066; const m = { t: 'p', id: this.id, x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2), yaw: +me.yaw.toFixed(2), g: me.grounded ? 1 : 0, d: me.dashT > 0 ? 1 : 0, a: me.atk >= 0 && me.atk < 0.2 ? 0 : -1, c: me.combo, hp: Math.round(me.hp), dead: me.dead ? 1 : 0, hit: me.ch.flash > 0.8 ? 1 : 0 }; this.send(m); }
    if (this.host) { this.bossT -= dt; if (this.bossT <= 0) { this.bossT = 0.1; const list = [G.boss.snapshot()]; for (const w of G.mobs) if (w.st !== 'sleep' || w.hp < w.maxHp) list.push(w.snapshot()); this.cast({ t: 'boss', list }); } }
    for (const r of G.others.values()) r.update(dt);
  }
  get count() { return G.others.size + 1; }
}
