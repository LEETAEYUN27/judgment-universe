// 입력 : 키보드 · 마우스 · 터치(조이스틱 · 단추 · 화면 끌기)
import { G, clamp } from './g.js';
export const I = { mx: 0, mz: 0, yaw: 0, pitch: 0.32, jump: false, dash: false, attack: false, interact: false, build: false, eat: false, sprint: false, keys: {}, locked: false, zoom: 7.5 };
const once = { jump: false, dash: false, attack: false, interact: false, build: false, eat: false };
export function consume(k) { const v = once[k]; once[k] = false; return v; }
export function press(k) { once[k] = true; }
export function initInput(canvas) {
  addEventListener('keydown', e => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.repeat) return; I.keys[e.code] = true;
    if (e.code === 'Space') { once.jump = true; e.preventDefault(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') once.dash = true;
    if (e.code === 'KeyE') once.interact = true; if (e.code === 'KeyB') once.build = true; if (e.code === 'KeyF') once.eat = true; if (e.code === 'KeyJ') once.attack = true;
  });
  addEventListener('keyup', e => { I.keys[e.code] = false; });
  canvas.addEventListener('mousedown', e => { if (G.paused) return; if (!I.locked && !G.mobile) { canvas.requestPointerLock && canvas.requestPointerLock(); } if (e.button === 0) once.attack = true; if (e.button === 2) once.dash = true; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerlockchange', () => { I.locked = document.pointerLockElement === canvas; });
  addEventListener('mousemove', e => { if (!I.locked) return; I.yaw -= e.movementX * 0.0026; I.pitch = clamp(I.pitch + e.movementY * 0.0022, -0.5, 1.25); });
  addEventListener('wheel', e => { I.zoom = clamp(I.zoom + Math.sign(e.deltaY) * 0.8, 3.5, 16); }, { passive: true });
  // 터치
  const joy = document.getElementById('joy'), knob = document.getElementById('knob'); let jid = null, jx = 0, jy = 0, look = null;
  if (joy) {
    const R = 52;
    joy.addEventListener('touchstart', e => { const t = e.changedTouches[0]; jid = t.identifier; const b = joy.getBoundingClientRect(); jx = b.left + b.width / 2; jy = b.top + b.height / 2; e.preventDefault(); }, { passive: false });
    const mv = e => { for (const t of e.changedTouches) if (t.identifier === jid) { let dx = t.clientX - jx, dy = t.clientY - jy; const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; } knob.style.transform = `translate(${dx}px,${dy}px)`; I.tx = dx / R; I.tz = dy / R; } };
    joy.addEventListener('touchmove', e => { mv(e); e.preventDefault(); }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === jid) { jid = null; knob.style.transform = ''; I.tx = I.tz = 0; } };
    joy.addEventListener('touchend', end); joy.addEventListener('touchcancel', end);
    document.querySelectorAll('[data-act]').forEach(b => { b.addEventListener('touchstart', e => { once[b.dataset.act] = true; b.classList.add('on'); e.preventDefault(); }, { passive: false }); b.addEventListener('touchend', () => b.classList.remove('on')); b.addEventListener('mousedown', e => { once[b.dataset.act] = true; e.stopPropagation(); }); });
    canvas.addEventListener('touchstart', e => { const t = e.changedTouches[0]; if (!look) look = { id: t.identifier, x: t.clientX, y: t.clientY }; }, { passive: true });
    canvas.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (look && t.identifier === look.id) { I.yaw -= (t.clientX - look.x) * 0.006; I.pitch = clamp(I.pitch + (t.clientY - look.y) * 0.004, -0.5, 1.25); look.x = t.clientX; look.y = t.clientY; } e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchend', e => { for (const t of e.changedTouches) if (look && t.identifier === look.id) look = null; });
  }
}
export function readMove() {
  const k = I.keys; let x = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0), z = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
  if (I.tx || I.tz) { x = I.tx; z = I.tz; }
  const d = Math.hypot(x, z); if (d > 1) { x /= d; z /= d; }
  I.mx = x; I.mz = z; I.sprint = !!k.ControlLeft || d > 0.92;
}
