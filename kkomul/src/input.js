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
  let dragOn = false, lastX = 0, lastY = 0;
  canvas.addEventListener('mousedown', e => { if (G.paused) return; dragOn = true; lastX = e.clientX; lastY = e.clientY; if (!I.locked && !G.mobile) { try { const pr = canvas.requestPointerLock && canvas.requestPointerLock(); if (pr && pr.catch) pr.catch(() => { }); } catch (er) { } } if (e.button === 0) once.attack = true; if (e.button === 2) once.dash = true; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerlockchange', () => { I.locked = document.pointerLockElement === canvas; });
  addEventListener('mousemove', e => {       // 포인터 잠금 상태이거나, 단추를 누른 채 끌 때 시선 회전
    if (G.paused) return; const drag = !I.locked && (e.buttons & 7) !== 0 && dragOn; if (!I.locked && !drag) return;
    let dx = e.movementX, dy = e.movementY; if (dx === undefined || (drag && dx === 0 && dy === 0)) { dx = e.clientX - lastX; dy = e.clientY - lastY; } lastX = e.clientX; lastY = e.clientY;
    if (Math.abs(dx) > 300 || Math.abs(dy) > 300) return;
    I.yaw -= dx * (I.locked ? 0.0026 : 0.0052); I.pitch = clamp(I.pitch + dy * (I.locked ? 0.0022 : 0.0042), -0.5, 1.25); I.lookT = 2.5;
  });
  addEventListener('mouseup', () => { dragOn = false; });
  document.addEventListener('pointerlockerror', () => { I.locked = false; });
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
    canvas.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (look && t.identifier === look.id) { I.yaw -= (t.clientX - look.x) * 0.008; I.pitch = clamp(I.pitch + (t.clientY - look.y) * 0.005, -0.5, 1.25); look.x = t.clientX; look.y = t.clientY; } e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchend', e => { for (const t of e.changedTouches) if (look && t.identifier === look.id) look = null; });
  }
}
export function readMove() {
  const k = I.keys; let x = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), z = (k.KeyS ? 1 : 0) - (k.KeyW ? 1 : 0);
  if (I.tx || I.tz) { x = I.tx; z = I.tz; }
  const d = Math.hypot(x, z); if (d > 1) { x /= d; z /= d; }
  // 방향키 : 시선 회전. 마우스를 쓰지 않을 때는 옆걸음 방향으로 시선이 천천히 따라감
  const dt = G.dt || 0.016, lx = (k.ArrowLeft ? 1 : 0) - (k.ArrowRight ? 1 : 0), ly = (k.ArrowDown ? 1 : 0) - (k.ArrowUp ? 1 : 0);
  if (lx || ly) { I.yaw += lx * 2.4 * dt; I.pitch = clamp(I.pitch + ly * 1.3 * dt, -0.5, 1.25); I.lookT = 2.5; }
  I.lookT = Math.max(0, (I.lookT || 0) - dt); if (!I.locked && I.lookT <= 0 && !G.mobile && Math.abs(x) > 0.3) I.yaw -= x * 0.9 * dt;
  I.mx = x; I.mz = z; I.sprint = !!k.ControlLeft || d > 0.92;
}
