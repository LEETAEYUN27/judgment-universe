// 살림 : 채집 · 먹기 · 짓기 · 텃밭 · 촌장 퀘스트
import { THREE, G, clamp, dist2, emit, on } from './g.js';
import { clone } from './assets.js';
import { W, hAt, slopeAt, addCollider, solid } from './world.js';
import { Char } from './player.js';
import { burst, number, sfx } from './fx.js';

export const ITEM = { fruit: ['별열매', '🍎'], wood: ['나무', '🪵'], stone: ['돌', '🪨'], dust: ['빛가루', '✨'], seed: ['씨앗', '🌱'] };
export const BUILD = [
  { k: 'fire', name: '모닥불 화로', model: 'barrel_stove', s: 1.6, cost: { wood: 4, stone: 3 }, desc: '곁에 있으면 체력이 차오름', r: 1.0 },
  { k: 'farm', name: '텃밭', model: 'planter_box_01', s: 2.2, cost: { wood: 3 }, desc: '씨앗을 심으면 별열매가 열림', r: 0.9 },
  { k: 'lamp', name: '등불', model: 'Lantern_01', s: 3.0, cost: { wood: 1, dust: 2 }, desc: '주변을 밝힘', r: 0.3 },
  { k: 'hut', name: '오두막', model: 'hut', s: 1.15, cost: { wood: 14, stone: 8 }, desc: '쓰러지면 여기서 다시 일어남', r: 2.6 },
];
const NPCS = [];
const R2 = G.region === 2, R3 = G.region === 3;
export const CHIEF = R2 ? '솜이 할멈' : R3 ? '등대지기 도롱' : '촌장 모루';
export const REGNAME = ['', '별꽃 분지', '구름고래 고원', '잠든 화산섬'];
const SAVEKEY = r => 'mochi_save' + (r > 1 ? r : '');
const QUESTS1 = [
  { title: '첫 끼니', goal: '별열매 5개를 따서 촌장에게 가져가기', talk: ['어이쿠, 낯선 꼬물이로구먼. 나는 이 분지의 촌장 「모루」라네.', '여긴 별꽃 분지. 밤마다 풀과 꽃이 빛나는 아름다운 곳이지만… 북서쪽 분화구에 「아귀룡」이 둥지를 튼 뒤로 다들 달아나 버렸지.', '우선 배부터 채우세. 빛나는 덤불에서 별열매를 5개 따 오게. (덤불 앞에서 E)'], tgt: () => ['fruit'], check: () => G.inv.fruit >= 5, take: () => { G.inv.fruit -= 5; }, reward: () => { G.inv.seed += 3; G.inv.dust += 2; return '씨앗 3 · 빛가루 2'; }, done: '옳지, 잘 익었구먼! 답례로 씨앗과 빛가루를 주지.' },
  { title: '불씨', goal: '나무 4 · 돌 3을 모아 모닥불 화로 짓기 (B)', talk: ['밤이 길어. 그루터기와 바위를 도끼로 두드려 나무와 돌을 모으고, 화로를 지어 보게.', '화로 곁에 있으면 다친 몸이 낫는다네. (도끼질 : 마우스 왼쪽 / 짓기 : B)'], tgt: () => G.inv.wood < 4 ? ['wood'] : G.inv.stone < 3 ? ['stone'] : null, check: () => G.builds.some(b => b.k === 'fire'), reward: () => { G.weaponLv++; return '도끼 강화 +1'; }, done: '따뜻하구먼. 자네 도끼날을 벼려 주지. 한결 매서워질 걸세.' },
  { title: '첫 수확', goal: '텃밭을 짓고 씨앗을 심어 별열매 수확하기', talk: ['따 먹기만 해서는 겨울을 못 나지. 텃밭을 짓고 씨앗을 심어 보게.', '심고 나서 조금 기다리면 열매가 열린다네.'], check: () => G.stats.harvest >= 1, reward: () => { G.inv.fruit += 5; G.inv.seed += 2; return '별열매 5 · 씨앗 2'; }, done: '이제 굶을 걱정은 덜었구먼!' },
  { title: '새끼 아귀', goal: '숲을 돌아다니는 새끼 아귀 2마리 쓰러뜨리기', talk: ['숲에 아귀룡의 새끼들이 돌아다닌다네. 작다고 얕보면 물리지.', '달려들기 전에 눈이 번쩍하니, 그때 옆으로 굴러 피하고(Shift) 등을 두드리게. 2마리만 쓰러뜨려 보게.'], tgt: () => ['mob'], check: () => G.stats.mobKills >= 2, reward: () => { G.weaponLv++; G.me.maxHp += 25; G.me.hp = G.me.maxHp; return '도끼 강화 +1 · 최대 체력 +25'; }, done: '제법이구먼! 몸놀림이 달라졌어.' },
  { title: '보금자리', goal: '나무 14 · 돌 8로 오두막 짓기', talk: ['큰 싸움 전에 돌아올 집이 있어야지. 오두막을 지어 두게.', '쓰러지더라도 오두막에서 다시 일어날 수 있다네.'], tgt: () => G.inv.wood < 14 ? ['wood'] : G.inv.stone < 8 ? ['stone'] : null, check: () => G.builds.some(b => b.k === 'hut'), reward: () => { G.weaponLv++; return '도끼 강화 +1'; }, done: '훌륭한 집이야. 이제 준비가 되었구먼.' },
  { title: '아귀룡', goal: '북서쪽 분화구의 아귀룡 쓰러뜨리기', talk: ['때가 되었네. 북서쪽 그을린 분화구에 아귀룡이 잠들어 있지.', '놈은 우릴 삼키려 들 걸세. 입을 벌리고 뒤로 젖히면 문다는 신호, 몸을 세우고 울부짖으면 돌진한다는 신호야.', '돌진을 큰 바위나 큰 나무 쪽으로 유인해 들이받게 하면 한동안 뻗으니, 그때 머리를 노리게. 꼬리가 치솟으면 뛰어서 고리를 넘고!'], tgt: () => ['arena'], check: () => G.stats.bossDead, reward: () => { G.inv.dust += 20; return '빛가루 20 · 「분지의 수호자」'; }, done: '해냈구먼…! 분지에 다시 별꽃이 필 걸세. 동쪽 산맥 너머 「구름고래 고원」에서도 도움을 청하는 소리가 들린다네. 내 옆의 「바람문」이 열렸으니, 준비되면 건너가 보게.' },
];
const QUESTS2 = [
  { title: '고원의 첫 끼니', goal: '별열매 6개를 따서 솜이 할멈에게 가져가기', talk: ['아이고, 분지에서 바람문을 건너온 꼬물이로구나. 나는 이 고원의 「솜이 할멈」이란다.', '여긴 구름고래 고원. 골짜기마다 구름 바다가 흐르고 노을이 오래 머무는 곳이지. 하지만 동쪽 높은 「바람골」에 구름고래 「먹구름」이 눌러앉은 뒤로 다들 숨어 지낸단다.', '놈은 하늘을 헤엄치다 내려와 우리를 통째로 들이마신단다. 우선 배부터 채우자꾸나. 별열매 6개만 따다 주렴.'], tgt: () => ['fruit'], check: () => G.inv.fruit >= 6, take: () => { G.inv.fruit -= 6; }, reward: () => { G.inv.seed += 3; G.inv.dust += 3; return '씨앗 3 · 빛가루 3'; }, done: '고맙구나. 고원의 열매는 노을빛을 먹고 자라 더 달단다.' },
  { title: '하늘섬 보물', goal: '바람꽃을 타고 하늘섬에 올라 보물 상자 2개 열기', talk: ['고원 하늘에는 섬이 많이 떠 있단다. 청록빛 큰 바람꽃을 밟으면 섬까지 날아오를 수 있지.', '옛 꼬물족이 섬마다 보물을 숨겨 두었단다. 상자 2개만 열어 보렴. 섬에서 섬으로 건너뛸 수도 있단다.'], tgt: () => ['chest'], check: () => (G.stats.chests || 0) >= 2, reward: () => { G.weaponLv++; G.inv.wood += 8; return '도끼 강화 +1 · 나무 8'; }, done: '옳지, 날랜 아이로구나. 도끼날을 갈아 주마.' },
  { title: '등불 길', goal: '등불 2개 세우기 (B · 나무 1 · 빛가루 2)', talk: ['새끼 구름고래들은 어둑한 곳을 좋아한단다. 마을 어귀에 등불을 세워 길을 밝혀 다오.', '등불 2개면 된단다. 빛가루는 빛나는 꽃에서 모을 수 있지.'], tgt: () => G.inv.dust < 4 ? ['dust'] : null, check: () => G.builds.filter(b => b.k === 'lamp').length >= 2, reward: () => { G.inv.wood += 10; G.inv.stone += 6; return '나무 10 · 돌 6'; }, done: '환하구나! 이 나무와 돌로 집도 지어 보렴.' },
  { title: '새끼 구름고래', goal: '새끼 구름고래나 고원 아귀 3마리 쓰러뜨리기', talk: ['새끼 구름고래는 머리 위를 맴돌다 내리꽂힌단다. 눈이 번쩍하면 옆으로 굴러 피하렴.', '물고 나서 땅에 엎드려 있는 틈에 두드리면 된단다. 3마리만 쓰러뜨려 보렴.'], tgt: () => ['mob'], check: () => G.stats.mobKills >= 3, reward: () => { G.weaponLv++; G.me.maxHp += 30; G.me.hp = G.me.maxHp; return '도끼 강화 +1 · 최대 체력 +30'; }, done: '장하구나! 이제 먹구름 앞에 설 만하겠어.' },
  { title: '고원의 보금자리', goal: '나무 14 · 돌 8로 오두막 짓기', talk: ['큰 싸움 전에는 돌아올 집이 있어야 한단다. 바람골이 보이는 곳에 오두막을 지어 두렴.', '쓰러지더라도 오두막에서 다시 일어날 수 있단다.'], tgt: () => G.inv.wood < 14 ? ['wood'] : G.inv.stone < 8 ? ['stone'] : null, check: () => G.builds.some(b => b.k === 'hut'), reward: () => { G.weaponLv++; G.inv.fruit += 6; return '도끼 강화 +1 · 별열매 6'; }, done: '아늑하구나. 이제 때가 되었단다.' },
  { title: '구름고래 「먹구름」', goal: '동쪽 바람골의 구름고래 쓰러뜨리기', talk: ['동쪽 높은 대지 「바람골」에 먹구름이 잠들어 있단다.', '놈이 입을 크게 벌리고 숨을 들이쉬면 빨려 들어간단다. 그때는 옆으로 굴러서(Shift) 입 앞에서 벗어나렴.', '하늘 높이 솟구치면 네 머리 위로 떨어진다는 신호야. 바닥의 붉은 표시에서 벗어나고, 퍼지는 고리는 뛰어넘으렴.', '물거나 떨어진 뒤 땅에 엎드린 틈이 기회란다. 돌진할 때 돌기둥 뒤에 숨으면 들이받고 뻗는단다. 살아서 돌아오렴.'], tgt: () => ['arena'], check: () => G.stats.bossDead, reward: () => { G.inv.dust += 30; return '빛가루 30 · 「고원의 수호자」'; }, done: '해냈구나…! 고원 하늘이 다시 맑아지겠어. 구름 바다 건너 「잠든 화산섬」에서도 연기가 오른다는구나. 바람문이 그곳까지 이어졌으니 준비되면 건너가 보렴.' },
];
const QUESTS3 = [
  { title: '섬의 첫 끼니', goal: '별열매 6개를 따서 등대지기 도롱에게 가져가기', talk: ['어, 어서 와! 바람문에서 누가 나오다니. 난 이 섬의 등대지기 「도롱」이야.', '여긴 잠든 화산섬. 바다 한가운데 솟은 섬이고, 북서쪽 큰 화산은 오래 잠들어 있었지. 그런데 분화구 속에서 용암지네 「불등」이 깨어난 뒤로 밤마다 불비가 내려.', '배고프지? 일단 별열매 6개만 따다 줘. 이야기는 먹으면서 하자.'], tgt: () => ['fruit'], check: () => G.inv.fruit >= 6, take: () => { G.inv.fruit -= 6; }, reward: () => { G.inv.seed += 3; G.inv.dust += 3; return '씨앗 3 · 빛가루 3'; }, done: '고마워! 화산재 덕분에 이 섬 열매는 유난히 크다니까.' },
  { title: '온천', goal: '동남쪽 온천에 몸 담그기', talk: ['이 섬의 자랑은 온천이야. 동남쪽 김이 오르는 물에 들어가 있으면 다친 몸이 금세 나아.', '불등과 싸우다 다치면 거기서 쉬면 돼. 한번 다녀와 봐.'], tgt: () => ['spa'], check: () => !!G.stats.spa, reward: () => { G.me.maxHp += 25; G.me.hp = G.me.maxHp; return '최대 체력 +25'; }, done: '어때, 뜨끈하지? 몸이 한결 단단해졌을 거야.' },
  { title: '불씨 아귀', goal: '불씨 아귀 3마리 쓰러뜨리기', talk: ['불등의 새끼인 불씨 아귀들이 숲까지 내려왔어.', '달려들기 전에 눈이 번쩍하니까 옆으로 굴러 피하고 등을 두드려. 3마리만 부탁해.'], tgt: () => ['mob'], check: () => G.stats.mobKills >= 3, reward: () => { G.weaponLv++; return '도끼 강화 +1'; }, done: '대단한데! 도끼날을 화산암에 갈아 줄게.' },
  { title: '검은 돌', goal: '돌 10개를 모아 등대지기에게 가져가기', talk: ['등대를 고치려면 검은 화산암이 필요해. 바위를 도끼로 두드리면 돌이 나와.', '10개만 모아 줘.'], tgt: () => ['stone'], check: () => G.inv.stone >= 10, take: () => { G.inv.stone -= 10; }, reward: () => { G.weaponLv++; G.inv.wood += 14; return '도끼 강화 +1 · 나무 14'; }, done: '이거면 충분해! 남는 나무는 네 집 짓는 데 써.' },
  { title: '섬의 보금자리', goal: '나무 14 · 돌 8로 오두막 짓기', talk: ['분화구에 들어가기 전에 돌아올 집부터 지어 둬.', '쓰러져도 오두막에서 다시 일어날 수 있어.'], tgt: () => G.inv.wood < 14 ? ['wood'] : G.inv.stone < 8 ? ['stone'] : null, check: () => G.builds.some(b => b.k === 'hut'), reward: () => { G.weaponLv++; G.inv.fruit += 6; return '도끼 강화 +1 · 별열매 6'; }, done: '튼튼하게 지었네. 이제 준비 끝이야.' },
  { title: '용암지네 「불등」', goal: '북서쪽 화산 분화구의 불등 쓰러뜨리기', talk: ['북서쪽 화산을 올라 분화구 안으로 내려가면 불등이 있어.', '분화구 바닥의 용암 웅덩이는 밟으면 데니까 조심해. 불등이 몸을 세우고 하늘로 불을 뿜으면 불비가 내려. 바닥의 붉은 표시에서 얼른 벗어나.', '돌진할 때 현무암 기둥 뒤에 숨으면 들이받고 뻗어. 그때 머리를 노려. 꼭 살아서 돌아와!'], tgt: () => ['arena'], check: () => G.stats.bossDead, reward: () => { G.inv.dust += 40; return '빛가루 40 · 「화산섬의 수호자」'; }, done: '해냈구나…! 이제 밤에도 불비가 안 내리겠지. 바다 건너 또 다른 땅에서 소식이 오면 알려 줄게. (다음 지역 준비 중)' },
];
export const QUESTS = R2 ? QUESTS2 : R3 ? QUESTS3 : QUESTS1;

export function initLife() {
  G.stats = G.stats || { harvest: 0, mobKills: 0, bossDead: false };
  // 촌장 · 떠돌이 상인
  const chief = new Char(R2 ? 'beoseot' : R3 ? 'dorong' : 'gureum', { name: CHIEF, weapon: false, scale: 1.55 }); const cx = W.spawn.x - 7, cz = W.spawn.z + 3; chief.root.position.set(cx, hAt(cx, cz), cz); chief.root.rotation.y = 1.2;
  const lamp = clone('Lantern_01'); lamp.scale.setScalar(3); lamp.position.set(cx + 1.4, hAt(cx + 1.4, cz + 0.6), cz + 0.6); G.scene.add(lamp); const pl = new THREE.PointLight(0xffc27a, 7, 22, 1.7); pl.position.set(cx + 1.4, hAt(cx, cz) + 1.2, cz + 0.6); G.scene.add(pl);
  NPCS.push({ id: 'chief', ch: chief, x: cx, z: cz, r: 3.4 });
  const mx = W.lake.x - W.lake.r - 26, mz = W.lake.z - 30, mer = new Char('ppiyak', { name: '떠돌이 삐삐', weapon: false, scale: 1.35 }); mer.root.position.set(mx, hAt(mx, mz), mz); NPCS.push({ id: 'merchant', ch: mer, x: mx, z: mz, r: 3.2 });
  addCollider({ x: cx, z: cz, r: 0.7 }); addCollider({ x: mx, z: mz, r: 0.6 });
  // 바람문 : 지역을 오가는 문 (돌기둥 둘 + 큰 바람꽃)
  { const gx = W.spawn.x + 13, gz = W.spawn.z - 9, gy = hAt(gx, gz);
    for (const sx of [-1, 1]) { const o = clone('rock_face_02'), x = gx + sx * 4.2, sc = 1.7; o.scale.setScalar(sc); o.position.set(x, hAt(x, gz) - 0.4, gz); o.rotation.y = sx * 1.2; o.traverse(m => { if (m.isMesh) m.castShadow = true; }); G.scene.add(o); solid('rock_face_02', { x, z: gz, y: hAt(x, gz) - 0.4, s: sc, ry: sx * 1.2 }); }
    const f = clone('flower_gazania'); f.scale.setScalar(13); f.position.set(gx, gy + 0.6, gz); const mats = [];
    f.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xb48cff); o.material.emissiveMap = o.material.map; o.material.emissiveIntensity = 0.2; o.material.alphaTest = 0.4; o.material.side = THREE.DoubleSide; mats.push(o.material); } });
    const l = new THREE.PointLight(0xb48cff, 0, 30, 1.6); l.position.set(gx, gy + 1.5, gz); G.scene.add(l); G.scene.add(f);
    GATE = { id: 'gate', type: 'gate', x: gx, z: gz, y: gy, obj: f, ready: true, r: 3.6, mats, light: l }; W.nodes.push(GATE); }
  on('strike', onStrike);
}
let GATE = null;
// 갈 수 있는 지역 : 앞 지역의 보스를 쓰러뜨려야 다음 지역이 열림
export function regionsOpen() { const dead = r => { if (r === G.region && G.stats && G.stats.bossDead) return true; try { const t = JSON.parse(localStorage.getItem(SAVEKEY(r)) || 'null'); return !!(t && t.stats && t.stats.bossDead); } catch (e) { return false; } }; const o = [1]; if (dead(1) || G.region >= 2) o.push(2); if (dead(2) || G.region >= 3) o.push(3); return o; }
export const gateOpen = () => regionsOpen().some(r => r !== G.region);
// 다른 지역으로 : 소지품 · 도끼 · 체력은 가져가고, 퀘스트 · 건물은 지역마다 따로 저장
export function travel(to, auto) {
  save();
  try { const key = SAVEKEY(to), t = JSON.parse(localStorage.getItem(key) || '{}'); t.inv = G.inv; t.weaponLv = G.weaponLv; t.maxHp = G.me ? G.me.maxHp : t.maxHp; localStorage.setItem(key, JSON.stringify(t));
    localStorage.setItem('mochi_region', String(to)); if (auto) sessionStorage.setItem('mochi_auto', JSON.stringify(auto)); } catch (e) { }
  G.leaving = true; const q = new URLSearchParams(location.search); q.delete('map'); const qs = q.toString(); location.href = location.pathname + (qs ? '?' + qs : '');
}

/* ───── 가까운 상호작용 대상 ───── */
export function nearest(p) {
  let best = null, bd = 1e9;
  for (const n of NPCS) { const d = dist2(p.x, p.z, n.x, n.z); if (d < n.r && d < bd) { bd = d; best = { kind: 'npc', n, label: n.id === 'chief' ? CHIEF + '과 이야기' : '상인과 거래' }; } }
  for (const n of W.nodes) { if (!n.ready || n.type === 'wood' || n.type === 'stone') continue; const d = dist2(p.x, p.z, n.x, n.z); if (d < n.r && Math.abs(p.y - n.y) < 4 && d < bd) { bd = d; best = { kind: 'node', n, label: n.type === 'fruit' ? '별열매 따기' : n.type === 'dust' ? '빛가루 모으기' : n.type === 'gate' ? (gateOpen() ? '바람문 : 다른 지역으로 떠나기' : '닫힌 바람문') : '상자 열기' }; } }
  for (const b of G.builds) { if (b.k !== 'farm') continue; const d = dist2(p.x, p.z, b.x, b.z); if (d < 2.6 && d < bd) { const st = b.state || 0; if (st === 0 && G.inv.seed > 0) { bd = d; best = { kind: 'farm', b, label: '씨앗 심기' }; } else if (st === 2) { bd = d; best = { kind: 'farm', b, label: '수확하기' }; } } }
  return best;
}
export function interact(t) {
  if (!t) return;
  if (t.kind === 'npc') { t.n.id === 'chief' ? talkChief() : talkMerchant(); return; }
  if (t.kind === 'node') { if (t.n.type === 'gate') emit('gate'); else takeNode(t.n, true); return; }
  if (t.kind === 'farm') { farmAct(t.b, true); }
}
function gain(k, n, pos) { G.inv[k] += n; number(pos.x, pos.y + 1.6, pos.z, `+${n} ${ITEM[k][0]}`, 'gain'); emit('inv'); }
export function takeNode(n, mine) {
  if (!n.ready) return; n.ready = false; const p = { x: n.x, y: n.y, z: n.z };
  if (n.type === 'fruit') { n.fruits.forEach(f => f.visible = false); n.respawn = G.time + 75; if (mine) gain('fruit', 3, p); burst(n.x, n.y + 1.2, n.z, 14, 0xff5a7a, 3, 0.35, 3); }
  else if (n.type === 'dust') { n.obj.visible = false; n.respawn = G.time + 100; if (mine) gain('dust', 1, p); burst(n.x, n.y + 0.8, n.z, 22, 0xffd45a, 3, 0.4, 4, 2, 1.2); }
  else if (n.type === 'chest') { n.respawn = Infinity; if (mine) { G.stats.chests = (G.stats.chests || 0) + 1; gain('dust', 5, p); G.inv.seed += 2; G.weaponLv++; emit('toast', '상자에서 빛가루 5 · 씨앗 2를 얻고, 도끼가 한층 날카로워짐!'); } burst(n.x, n.y + 1, n.z, 40, 0x9affe0, 6, 0.5, 6, 6, 1.2); n.obj.rotation.x = -0.25; }
  if (mine) { sfx.pick(); G.net && G.net.send({ t: 'node', id: n.id }); G.me.ch.st.cheer = 0.5; }
}
function onStrike(s) {       // 도끼질 : 그루터기 · 바위
  for (const n of W.nodes) { if (!n.ready || (n.type !== 'wood' && n.type !== 'stone')) continue; if (dist2(s.x, s.z, n.x, n.z) > s.r + 0.6 * n.s) continue;
    n.hp--; n.obj.rotation.z = (Math.random() - 0.5) * 0.12; burst(n.x, n.y + 1, n.z, 8, n.type === 'wood' ? 0xc79a5a : 0xb8c4d0, 4, 0.3, 3); sfx.hit(); emit('hitstop', 0.03);
    if (n.hp <= 0) { n.ready = false; n.obj.visible = false; n.respawn = G.time + 120; n.hp = 3; for (const c of W.colliders) if (c.node === n) c.off = true; gain(n.type, 3, { x: n.x, y: n.y, z: n.z }); sfx.pick(); G.net && G.net.send({ t: 'node', id: n.id }); }
  }
}
export function nodeRemote(id) { const n = W.nodes.find(x => x.id === id); if (!n || !n.ready) return; if (n.type === 'wood' || n.type === 'stone') { n.ready = false; n.obj.visible = false; n.respawn = G.time + 120; for (const c of W.colliders) if (c.node === n) c.off = true; } else takeNode(n, false); }
export function eat() { if (G.inv.fruit <= 0 || G.me.hp >= G.me.maxHp || G.me.dead) return; G.inv.fruit--; G.me.heal(32); sfx.eat(); number(G.me.pos.x, G.me.pos.y + 1.8, G.me.pos.z, '+32', 'heal'); G.me.ch.st.cheer = 0.4; emit('inv'); }

/* ───── 짓기 ───── */
export function canAfford(b) { return Object.entries(b.cost).every(([k, v]) => G.inv[k] >= v); }
export function tryBuild(k) {
  const b = BUILD.find(x => x.k === k), me = G.me; if (!b) return;
  if (!canAfford(b)) { emit('toast', '재료가 모자람 : ' + Object.entries(b.cost).map(([k, v]) => `${ITEM[k][0]} ${v}`).join(' · ')); return; }
  const d = b.r + 2.2, x = me.pos.x + Math.sin(me.yaw) * d, z = me.pos.z + Math.cos(me.yaw) * d;
  if (slopeAt(x, z) > 0.35 || hAt(x, z) < W.water + 0.3) { emit('toast', '여기는 지을 수 없음. 평평한 땅을 찾아야 함'); return; }
  if (G.builds.some(o => dist2(o.x, o.z, x, z) < b.r + (BUILD.find(q => q.k === o.k).r) + 0.3)) { emit('toast', '다른 건물과 너무 가까움'); return; }
  for (const [kk, v] of Object.entries(b.cost)) G.inv[kk] -= v;
  const item = { k, x: +x.toFixed(2), z: +z.toFixed(2), ry: +(me.yaw + Math.PI).toFixed(2), state: 0, by: me.name }; G.net && G.net.send({ t: 'build', item: Object.assign({}, item) }); placeBuild(item, true); sfx.build(); emit('inv');
  if (k === 'hut') { G.home = { x: x + Math.sin(me.yaw + Math.PI) * 4, z: z + Math.cos(me.yaw + Math.PI) * 4 }; emit('toast', '오두막 완성! 쓰러지면 여기서 다시 일어남'); }
}
export function placeBuild(item, mine) {
  const b = BUILD.find(x => x.k === item.k), o = clone(b.model); o.scale.setScalar(b.s); o.position.set(item.x, hAt(item.x, item.z), item.z); o.rotation.y = item.ry;
  o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); G.scene.add(o); item.obj = o; G.builds.push(item);
  if (item.k !== 'hut') addCollider({ x: item.x, z: item.z, r: b.r, h: 2 });
  else { const c = Math.cos(item.ry), s = Math.sin(item.ry); for (const [lx, lz] of [[-1.7, 0], [1.7, 0], [0, 1.7], [-1.3, -1.7], [1.3, -1.7]]) addCollider({ x: item.x + lx * b.s * c + lz * b.s * s, z: item.z - lx * b.s * s + lz * b.s * c, r: 0.8, h: 3 }); }
  if (item.k === 'fire') { const l = new THREE.PointLight(0xff8a3c, 30, 30, 1.6); l.position.set(0, 0.9 / b.s, 0); o.add(l); item.light = l; }
  if (item.k === 'lamp') { const l = new THREE.PointLight(0xffd08a, 18, 24, 1.7); l.position.set(0, 0.3, 0); o.add(l); o.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.emissive = new THREE.Color(0xffb060); m.material.emissiveIntensity = 0.6; } }); }
  if (item.k === 'farm') { item.sprout = null; if (item.state) setFarm(item, item.state); }
  burst(item.x, o.position.y + 1, item.z, 30, 0xfff0b0, 5, 0.4, 5);
}
function setFarm(b, st) {
  b.state = st; if (b.sprout) { b.obj.remove(b.sprout); b.sprout = null; }
  if (st >= 1) { const g = new THREE.Group(), base = BUILD[1].s; for (let i = 0; i < 3; i++) { const p = clone(st === 2 ? 'shrub_04' : 'flower_empodium'); p.scale.setScalar((st === 2 ? 0.9 : 1.2) / base); p.position.set((i - 1) * 0.26, 0.16, 0); g.add(p); if (st === 2) { const f = clone('food_pomegranate_01'); f.scale.setScalar(2.4 / base); f.position.set((i - 1) * 0.26, 0.36, 0.05); f.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xff3b6b); o.material.emissiveIntensity = 1; } }); g.add(f); } } b.obj.add(g); b.sprout = g; }
}
export function farmAct(b, mine) {
  if ((b.state || 0) === 0) { if (mine) { if (G.inv.seed <= 0) return; G.inv.seed--; emit('inv'); sfx.pick(); } setFarm(b, 1); b.ripe = G.time + 40; }
  else if (b.state === 2) { setFarm(b, 0); if (mine) { gain('fruit', 4, { x: b.x, y: hAt(b.x, b.z), z: b.z }); G.inv.seed += 1; G.stats.harvest++; sfx.pick(); } }
  if (mine && G.net) G.net.send({ t: 'farm', x: b.x, z: b.z });
}
export function farmRemote(x, z) { const b = G.builds.find(o => o.k === 'farm' && Math.abs(o.x - x) < 0.1 && Math.abs(o.z - z) < 0.1); if (b) farmAct(b, false); }

/* ───── 대화 · 퀘스트 ───── */
function talkChief() {
  const q = QUESTS[G.quest]; if (!q) { emit('dialog', { who: CHIEF, lines: [R3 ? '네 덕분에 섬이 조용해졌어. 다음 지역이 열리면 또 부탁할게!' : R2 ? '네 덕에 고원 하늘이 맑단다. 바람문으로 「잠든 화산섬」에 건너갈 수 있단다.' : '자네 덕에 분지가 평온하다네. 내 옆의 「바람문」으로 구름고래 고원에 건너갈 수 있다네.'] }); return; }
  if (G.questProg === 0) { emit('dialog', { who: CHIEF, lines: q.talk, end: () => { G.questProg = 1; emit('quest'); sfx.quest(); } }); return; }
  if (q.check()) { if (q.take) q.take(); const rw = q.reward(); emit('dialog', { who: CHIEF, lines: [q.done, `〔보상〕 ${rw}`], end: () => { G.quest++; G.questProg = 0; emit('quest'); emit('inv'); sfx.quest(); G.me.ch.st.cheer = 1.2; save(); if (QUESTS[G.quest]) talkChief(); } }); }
  else emit('dialog', { who: CHIEF, lines: [(R3 ? '아직이네. ' : R2 ? '아직이구나. ' : '아직이구먼. ') + q.goal + '.'] });
}
function talkMerchant() {
  G.stats.hpBuy = G.stats.hpBuy || 0;
  if (G.stats.hpBuy >= 4) { emit('dialog', { who: '떠돌이 삐삐', lines: ['삐약! 이제 더 줄 게 없어. 넌 이미 충분히 튼튼해!'] }); return; }
  if (G.inv.dust >= 4) emit('dialog', { who: '떠돌이 삐삐', lines: ['삐약! 빛가루 4개를 주면 「튼튼 물약」을 줄게. 최대 체력이 20 늘어나!'], choice: ['바꾼다 (빛가루 4)', '다음에'], pick: i => { if (i === 0) { G.inv.dust -= 4; G.me.maxHp += 20; G.me.hp = G.me.maxHp; G.stats.hpBuy++; emit('inv'); sfx.quest(); emit('toast', '최대 체력 +20'); save(); } } });
  else emit('dialog', { who: '떠돌이 삐삐', lines: ['삐약! 난 온 세상을 떠도는 상인이야. 빛나는 꽃에서 빛가루를 4개 모아 오면 「튼튼 물약」으로 바꿔 줄게.', '참, 청록빛 큰 바람꽃을 밟으면 하늘섬까지 날아오를 수 있어. 섬마다 보물 상자가 있다구!'] });
}

/* ───── 시간에 따른 갱신 ───── */
export function updateLife(dt) {
  if (R3 && G.me && !G.me.dead) { const me = G.me, p = me.pos;
    if (dist2(p.x, p.z, W.lake.x, W.lake.z) < W.lake.r * 1.25 && p.y < W.water + 0.4) { if (me.hp < me.maxHp) me.heal(9 * dt); if (!G.stats.spa) { G.stats.spa = true; emit('toast', '온천에 몸을 담금. 다친 몸이 나음'); emit('quest'); } }
    for (const L of W.lavas) if (dist2(p.x, p.z, L.x, L.z) < L.r && p.y < L.y + 0.7 && me.inv <= 0) { if (me.damage(16, L, 6)) { me.vel.y = 13; burst(p.x, p.y + 0.5, p.z, 24, 0xff7a1a, 5, 0.5, 6); } break; } }
  if (GATE) { const k = gateOpen() ? 1.6 + Math.sin(G.time * 2.2) * 0.5 : 0.15; for (const m of GATE.mats) m.emissiveIntensity = k; GATE.light.intensity = gateOpen() ? 26 : 0; }
  for (const n of NPCS) { n.ch.update(dt); if (G.me) { const d = dist2(G.me.pos.x, G.me.pos.z, n.x, n.z); if (d < 9) n.ch.root.rotation.y += (Math.atan2(G.me.pos.x - n.x, G.me.pos.z - n.z) - n.ch.root.rotation.y) * Math.min(1, dt * 4); } }
  if ((G.frame & 31) === 0) {
    for (const n of W.nodes) if (!n.ready && n.respawn && G.time > n.respawn) { n.ready = true; n.obj.visible = true; if (n.fruits) n.fruits.forEach(f => f.visible = true); for (const c of W.colliders) if (c.node === n) c.off = false; }
    for (const b of G.builds) if (b.k === 'farm' && b.state === 1 && G.time > (b.ripe || 0)) setFarm(b, 2);
  }
  if (G.me && !G.me.dead) for (const b of G.builds) if (b.k === 'fire') { if (dist2(G.me.pos.x, G.me.pos.z, b.x, b.z) < 7 && G.me.hp < G.me.maxHp) G.me.heal(7 * dt); if (b.light) b.light.intensity = 28 + Math.sin(G.time * 11) * 5 + Math.sin(G.time * 23) * 3; if (Math.random() < dt * 14) burst(b.x, hAt(b.x, b.z) + 1.4, b.z, 1, 0xff9a3c, 0.6, 0.3, 2.5, -1, 0.9); }
}

/* ───── 저장 ───── */
export function save() {
  try { if (G.leaving || !G.started) return; localStorage.setItem(SAVEKEY(G.region), JSON.stringify({ inv: G.inv, weaponLv: G.weaponLv, quest: G.quest, questProg: G.questProg, stats: G.stats, maxHp: G.me ? G.me.maxHp : 100, home: G.home, builds: G.net && !G.net.host ? [] : G.builds.map(b => ({ k: b.k, x: b.x, z: b.z, ry: b.ry, state: b.state || 0 })) })); } catch (e) { }
}
export function load() {
  try { const s = JSON.parse(localStorage.getItem(SAVEKEY(G.region)) || 'null'); if (!s) return false; Object.assign(G.inv, s.inv); G.weaponLv = s.weaponLv || 0; G.quest = s.quest || 0; G.questProg = s.questProg || 0; G.stats = Object.assign({ harvest: 0, mobKills: 0, bossDead: false }, s.stats); G.home = s.home || null; G._maxHp = s.maxHp; G._builds = s.builds || []; return true; } catch (e) { return false; }
}
