// 꼬물족 이야기 — 시작 · 반복 · 화면 표시
import { THREE, G, clamp, damp, dist2, emit, on } from './g.js';
import { loadAll, CHARS } from './assets.js';
import { W, buildWorld, updateWorld, hAt, stepGlow, solidTop, camBlocked } from './world.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { I, initInput, consume, press } from './input.js';
import { Player, TUNE } from './player.js';
import { spawnMonsters } from './boss.js';
import { initFx, updateFx, burst, ring, mark, number, sfx, audioOn } from './fx.js';
import { initLife, updateLife, nearest, interact, eat, tryBuild, canAfford, BUILD, ITEM, QUESTS, CHIEF, REGNAME, regionsOpen, travel, gateOpen, save, load, placeBuild } from './life.js';
import { Net } from './net.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = s => document.querySelector(s);
// 색 보정 : 어두운 곳은 청록, 밝은 곳은 자줏빛으로 살짝 기울이고 가장자리를 어둡게
const GRADE = { uniforms: { tDiffuse: { value: null } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, c * vec3(0.80, 1.04, 1.16), smoothstep(0.5, 0.0, l) * 0.6); c = mix(c, c * vec3(1.10, 0.97, 1.08), smoothstep(0.5, 1.0, l) * 0.5);
    c = mix(vec3(l), c, 1.22); c = (c - 0.5) * 1.08 + 0.5; vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.75; gl_FragColor = vec4(max(c, 0.0), 1.0); }` };
const canvas = $('#c'); let hitstop = 0, lastSave = 0, kind = CHARS[0][0], target = null, bossSeen = false;
G.ui = { blocked: false }; G.frame = 0; G.norender = new URLSearchParams(location.search).has('norender');
G.worldTime = () => W.uniforms.uTime.value; G.setWorldTime = t => { W.uniforms.uTime.value = t; };
G.goneNodes = () => W.nodes.filter(n => !n.ready).map(n => n.id);
if (G.mobile) { document.body.classList.add('mobile'); G.quality = 0.45; } else G.quality = 0.85;
{ const q = new URLSearchParams(location.search).get('q'); if (q) G.quality = +q; }

/* ───── 준비 ───── */
async function boot() {
  const r = new THREE.WebGLRenderer({ canvas, antialias: !G.mobile, powerPreference: 'high-performance' }); G.renderer = r;
  const lite = new URLSearchParams(location.search).has('lite'); G.lite = lite; r.setPixelRatio(lite ? 0.6 : Math.min(devicePixelRatio, G.mobile ? 1.25 : 1.5)); r.setSize(innerWidth, innerHeight); r.shadowMap.enabled = !lite; r.shadowMap.type = THREE.PCFSoftShadowMap; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.2;
  G.scene = new THREE.Scene(); G.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.3, 2400);
  const comp = new EffectComposer(r); comp.addPass(new RenderPass(G.scene, G.camera)); const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.62, 0.7, 0.86); comp.addPass(bloom); comp.addPass(new ShaderPass(GRADE)); comp.addPass(new OutputPass()); G.composer = comp;
  addEventListener('resize', () => { r.setSize(innerWidth, innerHeight); comp.setSize(innerWidth, innerHeight); G.camera.aspect = innerWidth / innerHeight; G.camera.updateProjectionMatrix(); });
  startUI();
  await loadAll(p => { $('#load i').style.width = Math.round(p * 86) + '%'; });
  $('#loadTxt').textContent = W.name + '을(를) 일구는 중…'; await new Promise(r => setTimeout(r, 30));
  buildWorld(); spawnMonsters(); initFx(); initLife(); initInput(canvas); events();
  $('#load i').style.width = '100%'; $('#loadTxt').textContent = '준비 끝! 꼬물족을 고르고 시작'; ['#solo', '#host', '#join'].forEach(s => $(s).disabled = false);
  window.__g = G; window.__w = W; window.__tune = TUNE; window.__I = I; window.__hAt = hAt; window.__solidTop = solidTop; window.__camBlocked = camBlocked; window.__THREE = THREE; window.__press = press; window.__life = { tryBuild, interact, nearest, eat }; G.ready = true;
  r.setAnimationLoop(loop);
  if (G.testMode) return begin('solo');
  // 지역 이동 직후 : 이전에 하던 방식(혼자 · 방장 · 참가)으로 자동으로 이어감
  let auto = null; try { auto = JSON.parse(sessionStorage.getItem('mochi_auto') || 'null'); sessionStorage.removeItem('mochi_auto'); } catch (e) { }
  if (auto) { if (auto.code) $('#code').value = auto.code; begin(auto.mode, auto.code, 12); }
}
function startUI() {
  if (G.region === 2) { $('#chap').textContent = '제2장 · 구름고래 고원'; $('#lore').textContent = '골짜기마다 구름 바다가 흐르고 노을이 오래 머무는 하늘 고원. 바람문을 건너온 꼬물족 앞에, 하늘을 헤엄치다 내려와 모두를 통째로 들이마시는 구름고래 「먹구름」이 나타난다.'; }
  if (G.region === 3) { $('#chap').textContent = '제3장 · 잠든 화산섬'; $('#lore').textContent = '바다 한가운데 솟은 검은 화산섬. 오래 잠들어 있던 분화구에서 용암지네 「불등」이 깨어나 밤마다 불비를 내린다. 온천에서 몸을 추스르고, 용암 웅덩이를 피해 분화구 바닥까지 내려가야 한다.'; }
  { const row = $('#regRow'); row.innerHTML = ''; const open = (() => { try { return regionsOpen(); } catch (e) { return [1]; } })().filter(r => r !== G.region);
    if (open.length) { row.style.display = 'flex'; for (const to of open) { const b = document.createElement('button'); b.className = 'btn alt'; b.textContent = `제${to}장 「${REGNAME[to]}」`; b.onclick = () => { try { localStorage.setItem('mochi_region', String(to)); } catch (e) { } const q = new URLSearchParams(location.search); q.delete('map'); const qs = q.toString(); location.href = location.pathname + (qs ? '?' + qs : ''); }; row.appendChild(b); } } }
  const box = $('#chars'); CHARS.forEach(([k, nm], i) => { const b = document.createElement('button'); b.innerHTML = `<img src="assets/ui/${k}.png" alt="">${nm}`; b.className = i === 0 ? 'on' : ''; b.onclick = () => { kind = k; box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }; box.appendChild(b); });
  try { $('#name').value = localStorage.getItem('mochi_name') || ''; const k = localStorage.getItem('mochi_kind'); if (k) { kind = k; box.querySelectorAll('button').forEach((x, i) => x.classList.toggle('on', CHARS[i][0] === k)); } } catch (e) { }
  $('#solo').onclick = () => begin('solo'); $('#host').onclick = () => begin('host'); $('#join').onclick = () => begin('join');
}
async function begin(mode, keepCode, tries = 0) {
  const name = ($('#name').value || '').trim() || CHARS.find(c => c[0] === kind)[1]; const err = $('#err'); err.textContent = '';
  try { localStorage.setItem('mochi_name', name); localStorage.setItem('mochi_kind', kind); } catch (e) { }
  ['#solo', '#host', '#join'].forEach(s => $(s).disabled = true); audioOn();
  const had = mode !== 'join' ? load() : (load(), false);
  G.me = new Player(kind, name); if (G._maxHp) { G.me.maxHp = G._maxHp; G.me.hp = G._maxHp; }
  if (mode === 'join') G.builds.length = 0;
  try {
    if (mode === 'host') { G.net = new Net(); $('#loadTxt').textContent = '방을 여는 중…'; const code = await G.net.create(keepCode); $('#room').style.display = 'block'; $('#roomCode').textContent = code; toast('방 코드 ' + code + ' — 친구에게 알려 주면 같이 할 수 있음'); }
    if (mode === 'join') { const code = $('#code').value.trim(); if (code.length < 4) throw new Error('방 코드를 입력해 주십시오'); G.net = new Net(); $('#loadTxt').textContent = '방을 찾는 중…'; await G.net.join(code); $('#room').style.display = 'block'; $('#roomCode').textContent = G.net.code; }
  } catch (e) { G.me.ch.dispose(); G.me = null; G.net = null;
    if (tries > 0) { $('#loadTxt').textContent = '친구들과 다시 만나는 중… (' + tries + ')'; setTimeout(() => begin(mode, keepCode, tries - 1), 2500); return; } err.textContent = '연결 실패 : ' + (e.type === 'unavailable-id' ? '방 코드가 겹침. 다시 시도' : e.type === 'peer-unavailable' ? '그 코드의 방이 없음' : (e.message || e.type || e)); ['#solo', '#host', '#join'].forEach(s => $(s).disabled = false); return; }
  if (mode !== 'join' && G._builds) G._builds.forEach(b => placeBuild(b, false));
  if (G.home) G.me.respawn(), G.me.inv = 0;
  if (G.stats.bossDead && mode !== 'join') { G.boss.alive = false; G.boss.deadT = 99; G.boss.group.visible = false; }
  $('#bossName').textContent = G.boss.name;
  $('#start').style.display = 'none'; $('#hud').classList.add('on'); $('#meName').textContent = name; G.paused = false; G.started = true;
  I.yaw = 0.6; I.pitch = 0.16; invUI(); questUI(); buildUI();
  if (!had || G.quest === 0) setTimeout(() => toast((G.region > 1 ? REGNAME[G.region] + '에 도착! ' : '') + '「' + CHIEF + '」에게 가서 말을 걸어 보자 (E)'), 1200);
  setTimeout(() => toast(G.mobile ? '화면 빈 곳을 끌면 시선이 돌아감' : '화면을 클릭하면 마우스로 시선 회전 (Esc 로 풀기) · 클릭한 채 끌기나 방향키 ← → ↑ ↓ 도 가능'), 4500);
}

/* ───── 사건 ───── */
function allWyrms() { return [G.boss, ...G.mobs]; }
const isHost = () => !G.net || G.net.host;
function events() {
  on('strike', s => {
    let any = false;
    for (const w of allWyrms()) { const h = w.hitTest(s.x, s.y, s.z, s.r); if (!h) continue; any = true; const m = w.mult(h.i), dmg = Math.round(s.dmg * m * (0.9 + Math.random() * 0.2));
      if (isHost()) w.applyDamage(h.i, dmg); else { G.net.send({ t: 'dmg', id: w.id, i: h.i, dmg }); w.flash[h.i] = 1; w._fl = true; }
      number(h.p.x, h.p.y + w.rad, h.p.z, dmg, m > 1.4 ? 'crit' : ''); burst(s.x, s.y + 0.5, s.z, m > 1.4 ? 26 : 12, m > 1.4 ? 0xffd84a : 0xff7a4a, 7, 0.45, 4); sfx.hit(); hitstop = m > 1.4 ? 0.07 : 0.04; G.me.shake = Math.max(G.me.shake, m > 1.4 ? 0.45 : 0.25);
    }
    if (!any) sfx.swing();
  });
  on('netDmg', m => { const w = m.id === 'boss' ? G.boss : G.mobs.find(x => x.id === m.id); if (w) w.applyDamage(m.i, m.dmg); });
  on('bossState', e => {
    const w = e.id === 'boss' ? G.boss : G.mobs.find(x => x.id === e.id), near = G.me ? dist2(G.me.pos.x, G.me.pos.z, e.pos.x, e.pos.z) : 999; if (near > 140) return; const big = e.boss ? 1 : 0.45;
    if (e.st === 'roar') { sfx.roar(big); if (e.boss && G.me) { G.me.shake = Math.max(G.me.shake, 0.9); if (!bossSeen) { bossSeen = true; toast(G.boss.name + '이(가) 깨어남!'); } } }
    if (e.st === 'biteTell') sfx.tell(); if (e.st === 'chargeTell') { sfx.roar(0.7); sfx.tell(); } if (e.st === 'sweepTell') sfx.tell(); if (e.st === 'inhaleTell') { sfx.tell(); sfx.roar(0.5); if (e.boss) toast('들이마신다! 옆으로 굴러서(Shift) 입 앞에서 벗어날 것'); }
    if (e.st === 'stun') { sfx.crash(); burst(e.pos.x, e.pos.y, e.pos.z, 60, 0xd8c8a0, 12, 0.7, 8); if (G.me) G.me.shake = 1; toast('들이받고 뻗음! 지금 머리를 노릴 것'); }
    if (e.st === 'sweep' && w) { const tl = w.pts[w.segs]; ring(tl.x, tl.z, e.boss ? 46 : 12, 0xff5a3c); sfx.sweep(); }
    if (e.st === 'eruptTell' && w) { const p = w.erupt || w.head; mark(p.x, p.z, 7.5, 0.7); sfx.tell(); }
    if (e.st === 'erupt' && w) { const p = w.erupt || w.head; burst(p.x, hAt(p.x, p.z) + 1, p.z, 90, 0xb89a70, 16, 0.9, 14, 20, 1.2); sfx.erupt(); if (G.me && near < 60) G.me.shake = 1; }
    if (e.st === 'dive') sfx.erupt();
    if (e.st === 'rainTell' && e.boss) { sfx.roar(0.8); toast('불비가 내린다! 붉은 표시에서 벗어날 것'); }
    if (e.st === 'rain' && w && w.hazard.rocks) { for (const q of w.hazard.rocks) burst(q[0], hAt(q[0], q[1]) + 1, q[1], 26, 0xff7a1a, 9, 0.7, 9, 14, 0.9); sfx.erupt(); if (G.me && near < 70) G.me.shake = Math.max(G.me.shake, 0.6); }
  });
  on('bossStep', p => { if (!G.me) return; const d = dist2(G.me.pos.x, G.me.pos.z, p.x, p.z); if (d < 45) { G.me.shake = Math.max(G.me.shake, 0.3 * (1 - d / 45)); sfx.stomp(); burst(p.x, p.y + 0.3, p.z, 5, 0x9a8a70, 3, 0.5, 2, 6, 0.6); } });
  on('bossRocks', e => { for (const q of e.rocks) mark(q[0], q[1], 4.6, e.t); sfx.tell(); });
  on('bossPhase', n => toast(G.region === 3 ? (n === 2 ? '불등이 더 자주 불비를 뿜음!' : '불등이 미쳐 날뜀!') : G.region === 2 ? (n === 2 ? '먹구름이 하늘 높이 솟구쳐 내리꽂기 시작함!' : '먹구름이 미쳐 날뜀!') : (n === 2 ? '아귀룡이 땅속으로 파고들기 시작함!' : '아귀룡이 미쳐 날뜀!')));
  on('bossDead', e => { if (e.boss) { G.stats.bossDead = true; sfx.win(); toast(G.boss.name + '을(를) 쓰러뜨림! ' + CHIEF + '에게 돌아가자'); for (let i = 0; i < 6; i++) setTimeout(() => burst(e.pos.x + (Math.random() - 0.5) * 20, e.pos.y + 4, e.pos.z + (Math.random() - 0.5) * 20, 60, [0xffd84a, 0x7affd8, 0xff8ad0][i % 3], 14, 0.8, 12, 8, 1.6), i * 350); if (G.me) G.me.ch.st.cheer = 3; }
    else { G.stats.mobKills++; burst(e.pos.x, e.pos.y, e.pos.z, 30, 0x9affd0, 8, 0.5, 6); sfx.quest(); toast((G.region === 3 ? '불씨 아귀' : G.region === 2 ? '고원 괴물' : '새끼 아귀') + ' 토벌 (' + G.stats.mobKills + ')'); G.inv.dust += 1; invUI(); } questUI(); save(); });
  on('grabbed', () => { sfx.hurt(); toast('삼켜짐!'); });
  on('hurt', () => { sfx.hurt(); const h = $('#hurt'); h.style.opacity = 1; setTimeout(() => h.style.opacity = 0, 180); });
  on('died', () => { sfx.die(); $('#dead').style.display = 'flex'; }); on('respawn', () => { $('#dead').style.display = 'none'; });
  on('jump', () => sfx.jump()); on('jump2', p => { sfx.jump2(); burst(p.x, p.y, p.z, 10, 0xbfffe8, 3, 0.4, 0, 0, 0.4); }); on('dash', p => { sfx.dash(); burst(p.x, p.y + 0.5, p.z, 12, 0xe8fff8, 4, 0.5, 1, 0, 0.35); });
  on('land', e => { stepGlow(e.pos.x, e.pos.z); sfx.land(); burst(e.pos.x, e.pos.y + 0.1, e.pos.z, Math.min(16, 4 + e.v), 0xc8c0a0, 3, 0.45, 1.5, 6, 0.5); }); on('step', p => { sfx.step(); stepGlow(p.x, p.z); }); on('pad', p => { sfx.pad(); burst(p.x, p.y + 1, p.z, 50, 0x35ffd0, 9, 0.6, 14, 4, 1.1); toast('바람꽃을 타고 날아오름!'); });
  on('hitstop', t => { hitstop = Math.max(hitstop, t); }); on('toast', toast); on('inv', invUI); on('quest', questUI); on('roster', () => { const n = G.net ? G.net.count : 1; $('#roomN').textContent = n; if (isHost() && G.boss.alive) { const b = G.boss, base = 2600, nm = Math.round(base * (1 + 0.6 * (n - 1))); b.hp = Math.round(b.hp / b.maxHp * nm); b.maxHp = nm; } });
  on('dialog', openDialog);
  on('say', m => { const r = G.others.get(m.id); if (!r) return; bubble(r.pos, SAY[m.i]); toast((r.ch.tagName || '친구') + ' : ' + SAY[m.i]); if (m.i === 0 || m.i === 3) r.ch.st.cheer = 1; });
  on('gate', () => {
    const open = regionsOpen().filter(r => r !== G.region);
    if (!open.length) { toast('바람문이 잠들어 있음. ' + G.boss.name + '을(를) 쓰러뜨리면 열림'); return; }
    if (G.net && !G.net.host) { toast('지역 이동은 방장만 할 수 있음'); return; }
    emit('dialog', { who: '바람문', lines: ['바람문 너머로 다른 땅의 바람이 불어온다. 소지품과 도끼는 가져가고, 이곳의 집과 퀘스트는 그대로 남는다.' + (G.net ? ' 방의 친구들도 함께 건너간다.' : '')], choice: [...open.map(r => `「${REGNAME[r]}」(으)로`), '다음에'], pick: i => { const to = open[i]; if (!to) return; if (G.net) { G.net.cast({ t: 'travel', r: to }); setTimeout(() => travel(to, { mode: 'host', code: G.net.code }), 400); } else travel(to, { mode: 'solo' }); } });
  });
  on('travel', m => { toast('방장을 따라 다른 지역으로 건너감…'); setTimeout(() => travel(m.r, { mode: 'join', code: G.net.code }), 600); });
  $('#bClose').onclick = () => toggleBuild(false);
  addEventListener('keydown', e => { if (e.code === 'Escape') { toggleBuild(false); } if (/^Digit[1-4]$/.test(e.code) && $('#build').style.display !== 'block' && G.started && !dlg && document.activeElement.tagName !== 'INPUT') say(+e.code.slice(5) - 1);
    if (/^Digit[1-5]$/.test(e.code) && $('#build').style.display === 'block') { tryBuild(BUILD[+e.code.slice(5) - 1].k); toggleBuild(false); } if ((e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') && dlg) { e.preventDefault(); dlgNext(); } });
  addEventListener('beforeunload', save);
}

/* ───── 화면 표시 ───── */
function toast(t) { const el = document.createElement('div'); el.className = 'toast sheet'; el.textContent = t; const box = $('#toasts'); box.appendChild(el); while (box.children.length > 3) box.firstChild.remove(); setTimeout(() => el.remove(), 3800); }
function invUI() { const el = $('#inv'); const prev = el._v || {}; el.innerHTML = Object.keys(ITEM).map(k => `<div data-k="${k}" class="${prev[k] !== undefined && prev[k] !== G.inv[k] ? 'bump' : ''}" title="${ITEM[k][0]}">${ITEM[k][1]}<b>${G.inv[k]}</b></div>`).join('') + `<div title="도끼 단계">🪓<b>${G.weaponLv + 1}</b></div>`; el._v = Object.assign({}, G.inv); buildUI(); }
// 퀘스트 목표 방향 · 거리
function questTarget() {
  const q = QUESTS[G.quest], me = G.me, chief = { x: W.spawn.x - 7, z: W.spawn.z + 3, n: CHIEF }; if (!q || !me) return null; if (G.questProg === 0 || q.check()) return chief;
  const near = (list, n) => { let b = null, bd = 1e9; for (const o of list) { const d = dist2(me.pos.x, me.pos.z, o.x, o.z); if (d < bd) { bd = d; b = o; } } return b && { x: b.x, z: b.z, n }; };
  const t = q.tgt ? q.tgt() : null; if (!t) return null; const NM = { fruit: '별열매', wood: '나무', stone: '돌', dust: '빛나는 꽃', chest: '하늘섬 바람꽃' };
  if (t[0] === 'mob') return near(G.mobs.filter(m => m.alive).map(m => m.head), '괴물');
  if (t[0] === 'spa') return { x: W.lake.x, z: W.lake.z, n: '온천' };
  if (t[0] === 'arena') return { x: W.arena.x, z: W.arena.z, n: G.region === 2 ? '바람골' : G.region === 3 ? '화산 분화구' : '분화구' };
  if (t[0] === 'chest') { const open = W.nodes.filter(n => n.type === 'chest' && n.ready).map(n => { let b = null, bd = 1e9; for (const p of W.pads) { const d = dist2(p.x, p.z, n.x, n.z); if (d < bd) { bd = d; b = p; } } return b; }).filter(Boolean); return me.pos.y > hAt(me.pos.x, me.pos.z) + 15 ? near(W.nodes.filter(n => n.type === 'chest' && n.ready), '상자') : near(open, NM.chest); }
  return near(W.nodes.filter(n => n.type === t[0] && n.ready), NM[t[0]]);
}
let qT = null;
function questDir() {
  if ((G.frame & 31) === 0 || !qT) qT = questTarget(); const el = $('#qDir'); if (!qT) { el.style.display = 'none'; return; }
  const me = G.me, dx = qT.x - me.pos.x, dz = qT.z - me.pos.z, d = Math.hypot(dx, dz); if (d < 6) { el.style.display = 'none'; return; }
  const f = G.camera.getWorldDirection(new THREE.Vector3()), a = Math.atan2(f.z * dx - f.x * dz, f.x * dx + f.z * dz);
  el.style.display = 'flex'; $('#qArrow').style.transform = `rotate(${(-a * 57.3).toFixed(0)}deg)`; $('#qDist').textContent = `${qT.n} ${Math.round(d)}걸음`;
}
function questUI() { const q = QUESTS[G.quest]; if (!q) { $('#qTitle').textContent = '분지의 수호자'; $('#qGoal').textContent = G.region === 3 ? '잠든 화산섬을 지켜 냄. 다음 지역 준비 중' : G.region === 2 ? '구름고래 고원을 지켜 냄. 바람문으로 잠든 화산섬에 갈 수 있음' : '별꽃 분지를 지켜 냄. 바람문으로 구름고래 고원에 갈 수 있음'; $('#qHint').textContent = ''; return; } $('#qTitle').textContent = q.title; $('#qGoal').textContent = G.questProg === 0 ? CHIEF + '과 이야기하기' : q.goal; $('#qHint').textContent = G.questProg === 1 && q.check() ? '✔ 완료! 촌장에게 돌아가기' : ''; }
// 한마디 : 숫자 1~4 (머리 위 말풍선, 같은 방 친구에게도 보임)
const SAY = ['👋 안녕!', '🆘 도와줘!', '➡️ 이리 와!', '😆 ㅋㅋㅋ']; let sayT = 0;
function bubble(pos, text) { number(pos.x, pos.y + 2.6, pos.z, text, 'say'); }
function say(i) { if (!G.me || G.time < sayT || !SAY[i]) return; sayT = G.time + 0.8; bubble(G.me.pos, SAY[i]); if (i === 0 || i === 3) G.me.ch.st.cheer = 1; if (G.net) G.net.send({ t: 'say', id: G.net.id, i }); }
function buildUI() { const g = $('#bGrid'); if (!g) return; g.innerHTML = BUILD.map((b, i) => `<button class="it ${canAfford(b) ? '' : 'no'}" data-k="${b.k}">${i + 1}. ${b.name}<small>${b.desc}</small><b>${Object.entries(b.cost).map(([k, v]) => `${ITEM[k][1]}${v}`).join(' ')}</b></button>`).join(''); g.querySelectorAll('.it').forEach(el => el.onclick = () => { tryBuild(el.dataset.k); toggleBuild(false); }); }
function toggleBuild(v) { const el = $('#build'), on = v === undefined ? el.style.display !== 'block' : v; if (on && dlg) return; el.style.display = on ? 'block' : 'none'; G.ui.blocked = on || !!dlg; if (on) { buildUI(); document.exitPointerLock && document.exitPointerLock(); } }
let dlg = null;
function openDialog(d) { dlg = Object.assign({ i: 0 }, d); G.ui.blocked = true; $('#dialog').style.display = 'block'; $('#dWho').textContent = d.who; document.exitPointerLock && document.exitPointerLock(); dlgShow(); }
function dlgShow() { const last = dlg.i >= dlg.lines.length - 1; $('#dText').textContent = dlg.lines[dlg.i]; const a = $('#dActs'); a.innerHTML = ''; if (last && dlg.choice) dlg.choice.forEach((c, i) => { const b = document.createElement('button'); b.className = 'btn' + (i ? ' alt' : ''); b.textContent = c; b.onclick = () => { const p = dlg.pick; closeDialog(); p && p(i); }; a.appendChild(b); }); else { const b = document.createElement('button'); b.className = 'btn'; b.textContent = last ? '알겠음' : '다음 ▸'; b.onclick = dlgNext; a.appendChild(b); } }
function dlgNext() { if (!dlg) return; if (dlg.i < dlg.lines.length - 1) { dlg.i++; dlgShow(); } else if (!dlg.choice) { const e = dlg.end; closeDialog(); e && e(); } }
function closeDialog() { dlg = null; $('#dialog').style.display = 'none'; G.ui.blocked = $('#build').style.display === 'block'; consume('interact'); consume('jump'); consume('attack'); }
function hud() {
  const me = G.me; $('#hpBar').style.transform = `scaleX(${clamp(me.hp / me.maxHp, 0, 1)})`; $('#stBar').style.transform = `scaleX(${me.stam / 100})`; $('#meHp').textContent = Math.ceil(me.hp) + ' / ' + me.maxHp;
  const b = G.boss, show = b.alive && b.st !== 'sleep' && dist2(me.pos.x, me.pos.z, b.head.x, b.head.z) < 160; $('#boss').style.display = show ? 'block' : 'none'; if (show) $('#bossBar').style.transform = `scaleX(${b.hp / b.maxHp})`;
  const p = $('#prompt'); if (target && !G.ui.blocked) { p.style.display = 'block'; p.innerHTML = (G.mobile ? '' : '<kbd>E</kbd>') + target.label; } else p.style.display = 'none';
  if (G.questProg === 1 && (G.frame & 63) === 0) questUI();
  questDir();
}

/* ───── 반복 ───── */
let last = performance.now(), menuA = 0;
function tick(dt, now) {
  G.dt = dt; G.time += dt; G.frame++;
  const host = isHost(), me = G.me;
  if (!G.ui.blocked) { if (consume('interact')) interact(target); if (consume('eat')) eat(); } else { consume('eat'); }
  if (consume('build')) toggleBuild();
  me.update(dt);
  for (const w of allWyrms()) { w.update(dt, host); w.hazards(me); }
  if (G.net) G.net.update(dt);
  { const b = G.boss; if (b.alive && b.st === 'inhale' && (G.frame % 2) === 0) { const d = 6 + Math.random() * 34, a2 = b.yaw + (Math.random() - 0.5) * 1.2, x = b.head.x + Math.sin(a2) * d, z = b.head.z + Math.cos(a2) * d; burst(x, hAt(x, z) + 0.5 + Math.random() * 3, z, 3, 0xd9c8ff, 2, 0.35, 1, -3, 0.7); } }
  updateLife(dt); if ((G.frame & 7) === 0) target = nearest(me.pos);
  updateWorld(dt, me.pos); updateFx(dt);
  if (now - lastSave > 20000) { lastSave = now; save(); }
}
G.sim = (dt, n) => { for (let i = 0; i < n; i++) tick(dt, 0); hud(); };      // 자동 점검용 : 화면을 그리지 않고 시간만 진행
let perfT = 0, perfN = 0, perfLv = 0;
function perf(raw) {      // 느린 기기 : 처음 몇 초의 프레임을 재서 풀 수 · 해상도 · 그림자를 단계적으로 낮춤
  if (!G.started || G.testMode || perfLv >= 3) return; perfT += raw; perfN++;
  if (perfT < 4) return; const fps = perfN / perfT; perfT = 0; perfN = 0;
  if (fps >= 33) { if (fps > 50) perfLv = 9; return; } perfLv++;
  if (perfLv === 1) { W.grassMesh.geometry.instanceCount = Math.round(W.grassN * 0.5); G.renderer.setPixelRatio(1); G.composer.setPixelRatio && G.composer.setPixelRatio(1); }
  if (perfLv === 2) { W.grassMesh.geometry.instanceCount = Math.round(W.grassN * 0.25); G.renderer.shadowMap.enabled = false; G.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
  if (perfLv === 3) { G.lite = true; G.renderer.setPixelRatio(0.8); toast('기기 성능에 맞춰 그래픽을 낮춤'); }
}
function loop(now) {
  const raw = (now - last) / 1000; perf(raw);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (hitstop > 0) { hitstop -= dt; dt *= 0.08; }
  if (G.started && G.me) { if (!G.hold) { tick(dt, now); hud(); } }
  else {
    // 시작 화면 : 분지를 천천히 도는 카메라
    G.frame++; G.time += dt; menuA += dt * 0.05; const cx = Math.sin(menuA) * 70, cz = Math.cos(menuA) * 70; if (W.hmap) { G.camera.position.set(cx, hAt(cx, cz) + 16, cz); G.camera.lookAt(-60, 22, -80); for (const w of allWyrms()) w.place(dt); updateLife(dt); updateWorld(dt, G.camera.position); } updateFx(dt);
  }
  if (G.norender) return;
  if (G.lite) G.renderer.render(G.scene, G.camera); else G.composer.render();
}
boot().catch(e => { console.error(e); $('#err').textContent = '불러오기 실패 : ' + (e.message || e); });
