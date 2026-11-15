// 공용 상태 · 도구
import * as THREE from 'three';
export { THREE };
export const G = {
  scene: null, camera: null, renderer: null, composer: null, time: 0, dt: 0, assets: {}, me: null, others: new Map(), boss: null, mobs: [],
  input: null, net: null, ui: null, paused: true, started: false, quality: 1, mobile: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent),
  inv: { fruit: 0, roast: 0, wood: 0, stone: 0, dust: 0, seed: 0 }, weaponLv: 0, quest: 0, questProg: 0, builds: [], home: null, testMode: new URLSearchParams(location.search).has('test'),
};
// 지역 : 1 별꽃 분지 · 2 구름고래 고원 · 3 잠든 화산섬 (주소의 ?map= 이 우선, 다음은 저장된 값)
{ let r = new URLSearchParams(location.search).get('map'); if (!r) try { r = localStorage.getItem('mochi_region'); } catch (e) { } G.region = +r === 2 ? 2 : +r === 3 ? 3 : 1; }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
export const dampAng = (a, b, k, dt) => a + angDiff(a, b) * (1 - Math.exp(-k * dt));
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); };
export const ease = t => t * t * (3 - 2 * t);
export const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => window.addEventListener(name, e => fn(e.detail));
