// 3지역 「불씨의 섬」 : 용암 바다에 떠 있는 검은 화산섬. 땅에는 용암 강이 흐르고 하늘에는 재와 불티가 날림
import { THREE, G, clamp, lerp, rng, dist2 } from './g.js';
import { parts, clone, bounds } from './assets.js';
import { W, hAt, fbm, solid, scatter, place, openGround, addPad, lavaMask } from './world.js';
import { burst } from './fx.js';

const NOISE = `float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  float fb(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
  // 용암 : 굳은 껍질 판 사이로 밝은 속이 비치고, 천천히 흘러감. 반환 = 빛(선형, 1 초과 = 번짐)
  vec3 lavaCol(vec2 q, float t, float sc){ vec2 f = q * sc; vec2 w = vec2(fb(f * 0.6 + t * 0.02), fb(f * 0.6 + 7.3 - t * 0.017)); f += (w - 0.5) * 2.4 + vec2(t * 0.045, t * 0.03);
    float a = fb(f), b = fb(f * 2.7 + 3.1 - t * 0.05); float plate = smoothstep(0.36, 0.54, a * 0.65 + b * 0.35); float crack = pow(clamp(1.0 - abs(b * 2.0 - 1.0) * 1.6, 0.0, 1.0), 3.0);
    vec3 hot = mix(vec3(1.25, 0.26, 0.02), vec3(1.9, 0.95, 0.22), smoothstep(0.25, 0.0, a * 0.65 + b * 0.35 - 0.2));      // 속 : 주황 → 흰노랑
    vec3 crust = vec3(0.03, 0.014, 0.014) + vec3(1.2, 0.2, 0.02) * crack * 0.5;                                       // 껍질 : 검붉은 판 + 갈라진 틈
    return mix(hot, crust, plate) * (0.9 + 0.1 * sin(t * 1.7 + a * 20.0)); }`;
const U = () => W.uniforms;
let skyMesh, seaMesh, maskTex, vents = [], flash = { t: 6, v: 0 }, skyU;

/* ───── 용암 지도 : 땅 셰이더와 피해 판정이 같은 함수를 씀 ───── */
function buildMask() {
  const N = 640, d = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) d[j * N + i] = Math.round(lavaMask(-W.half + (i + 0.5) / N * W.size, -W.half + (j + 0.5) / N * W.size) * 255);
  maskTex = new THREE.DataTexture(d, N, N, THREE.RedFormat); maskTex.magFilter = maskTex.minFilter = THREE.LinearFilter; maskTex.needsUpdate = true;
  W.lavaAt = (x, z) => lavaMask(x, z) > 0.5;
}

/* ───── 검은 화산암 땅 + 용암 강 ───── */
function terrain3() {
  const geo = new THREE.PlaneGeometry(W.size, W.size, W.res, W.res); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, hAt(x, z));
    col[i * 3] = clamp((fbm(x * 0.012 + 40, z * 0.012 + 40, 3) - 0.4) * 4, 0, 1);                       // 재가 쌓인 곳
    col[i * 3 + 1] = clamp(1 - dist2(x, z, W.arena.x, W.arena.z) / 400, 0, 1);                          // 화산에 가까울수록 붉게 달아오름
    col[i * 3 + 2] = clamp((fbm(x * 0.03 + 9, z * 0.03 + 2, 2) - 0.5) * 6, 0, 1); }                     // 불씨 이끼
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const A = G.assets, mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05, normalMap: A.n_rock_boulder_cracked, normalScale: new THREE.Vector2(1.5, 1.5), envMapIntensity: 0.25 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { tRock: { value: A.t_rock_boulder_cracked }, tBurn: { value: A.t_burned_ground_01 }, tDark: { value: A.t_dark_rock }, tMask: { value: maskTex }, uTime: U().uTime });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_NORMALMAP\n vNormalMapUv = position.xz * 0.07;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn; uniform sampler2D tRock, tBurn, tDark, tMask; uniform float uTime; float gLava; vec3 gGlow;\n' + NOISE)
      .replace('#include <color_fragment>', `
        vec2 q = vWp.xz; float m = texture2D(tMask, q / ${W.size.toFixed(1)} + 0.5).r;
        vec3 rock = mix(texture2D(tRock, q * 0.07).rgb, texture2D(tRock, q * 0.013).rgb, 0.45) * vec3(0.34, 0.32, 0.36);      // 검은 현무암
        vec3 ash = texture2D(tBurn, q * 0.09).rgb * vec3(0.62, 0.58, 0.58);
        vec3 cliff = mix(texture2D(tDark, q * 0.04).rgb, texture2D(tDark, vWp.zy * 0.03 + q.x * 0.02).rgb, 0.5) * vec3(0.5, 0.42, 0.42);
        vec3 c = mix(rock, ash, vColor.r * 0.8); c = mix(c, cliff, smoothstep(0.32, 0.6, 1.0 - vWn.y));
        c = mix(c, c * vec3(1.25, 0.72, 0.62), vColor.g * 0.6);                                              // 화산 쪽은 붉은 기운
        c *= 1.0 - smoothstep(0.08, 0.5, m) * 0.75;                                                          // 용암 가장자리는 그을림
        gLava = smoothstep(0.5, 0.6, m) * smoothstep(0.75, 0.9, vWn.y + m * 0.3);
        gGlow = vec3(1.0, 0.2, 0.02) * smoothstep(0.25, 0.52, m) * (1.0 - gLava) * 0.55                       // 달아오른 가장자리
              + vec3(1.0, 0.35, 0.05) * vColor.b * smoothstep(0.6, 0.9, fb(q * 0.6)) * (0.5 + 0.5 * sin(uTime * 1.3 + q.x * 0.4 + q.y * 0.3)) * 0.5;   // 불씨 이끼
        diffuseColor.rgb = mix(c, vec3(0.02, 0.01, 0.01), gLava);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gGlow + lavaCol(vWp.xz, uTime, 0.11) * gLava;`);
  };
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.name = 'terrain'; G.scene.add(mesh);
}

/* ───── 용암 바다 ───── */
function lavaSea() {
  const mat = new THREE.ShaderMaterial({ fog: false, uniforms: { uTime: U().uTime },
    vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform float uTime;\n${NOISE}
      void main(){ float d = distance(cameraPosition.xz, vP.xz); vec3 c = lavaCol(vP.xz, uTime * 0.7, 0.035) * 0.8; c = mix(c, vec3(0.5, 0.09, 0.02), smoothstep(250.0, 1300.0, d));      // 멀리는 붉은 빛으로 뭉개짐
        gl_FragColor = vec4(c, 1.0); }` });
  seaMesh = new THREE.Mesh(new THREE.CircleGeometry(2300, 64), mat); seaMesh.rotation.x = -Math.PI / 2; seaMesh.position.y = W.water; seaMesh.frustumCulled = false; G.scene.add(seaMesh);
}

/* ───── 하늘 : 검붉은 밤, 재구름, 화산 연기 기둥과 번개, 붉은 달 ───── */
function sky3() {
  skyU = { uTime: U().uTime, uVol: { value: new THREE.Vector3(0, 0.1, -1) }, uFlash: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vD; uniform float uTime, uFlash; uniform vec3 uVol;\n${NOISE}
      float stars(vec3 d){ vec3 p = d * 190.0; vec3 i = floor(p), f = fract(p) - 0.5; float r = h21(i.xy + i.z * 17.0); return smoothstep(0.08 * r, 0.0, length(f)) * step(0.985, r); }
      void main(){ vec3 d = normalize(vD); float y = d.y;
        vec3 c = mix(vec3(0.42, 0.07, 0.03), vec3(0.10, 0.02, 0.05), smoothstep(0.0, 0.35, y)); c = mix(c, vec3(0.012, 0.006, 0.02), smoothstep(0.3, 0.9, y));
        c = mix(vec3(0.55, 0.11, 0.03), c, smoothstep(-0.1, 0.06, y));                                           // 수평선 : 용암 바다의 빛
        c += stars(d) * vec3(1.0, 0.8, 0.7) * smoothstep(0.25, 0.6, y) * 0.7;
        vec3 md = normalize(vec3(0.62, 0.42, 0.55)); float mm = dot(d, md); c += vec3(1.0, 0.25, 0.12) * (smoothstep(0.9972, 0.9982, mm) * 1.6 + pow(max(mm, 0.0), 60.0) * 0.35);   // 붉은 달
        vec2 uvc = d.xz / (abs(y) + 0.35); float cl = fb(uvc * 1.4 + vec2(uTime * 0.006, 0.0)) * 0.6 + fb(uvc * 3.6 - vec2(uTime * 0.01, uTime * 0.004)) * 0.4; float ca = smoothstep(0.42, 0.72, cl) * smoothstep(-0.02, 0.2, y);
        vec3 smoke = mix(vec3(0.05, 0.03, 0.04), vec3(0.5, 0.11, 0.04), smoothstep(0.5, 0.0, y) * (1.0 - cl)); c = mix(c, smoke, ca * 0.9);                       // 아래에서 붉게 물든 재구름
        vec3 vd = normalize(uVol); float az = dot(normalize(d.xz), normalize(vd.xz)); float side = length(d.xz - normalize(vd.xz) * dot(d.xz, normalize(vd.xz)));
        float width = 0.07 + max(y - vd.y, 0.0) * 0.9; float pl = smoothstep(width, width * 0.25, side) * step(0.0, az) * smoothstep(vd.y - 0.03, vd.y + 0.06, y) * smoothstep(1.0, 0.45, y);
        float pn = fb(vec2(side * 9.0, y * 6.0 - uTime * 0.05)); pl *= smoothstep(0.25, 0.6, pn + 0.25);
        vec3 pc = mix(vec3(1.2, 0.34, 0.05), vec3(0.06, 0.035, 0.045), smoothstep(vd.y, vd.y + 0.28, y)); c = mix(c, pc, pl * 0.92);                             // 화산 연기 기둥 : 밑동은 불빛
        c += vec3(0.75, 0.7, 1.0) * uFlash * pl * smoothstep(0.35, 0.7, pn) * 2.2 + vec3(0.3, 0.2, 0.35) * uFlash * ca * 0.25;                                   // 연기 속 번개
        gl_FragColor = vec4(c, 1.0); }` });
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(2000, 40, 20), mat); skyMesh.frustumCulled = false; skyMesh.renderOrder = -10; G.scene.add(skyMesh); W.skyMesh = skyMesh;
}

/* ───── 불티 (위로) · 재 (아래로) ───── */
function embers() {
  const r = rng(71), N = Math.round(1100 * Math.max(0.4, G.quality)), pos = new Float32Array(N * 3), sd = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = r() * 220; pos[i * 3 + 1] = r(); pos[i * 3 + 2] = r() * 220; sd[i * 3] = r(); sd[i * 3 + 1] = r() < 0.62 ? 1.5 + r() * 4 : -(0.5 + r() * 1.0); sd[i * 3 + 2] = 0.4 + Math.pow(r(), 3) * 1.5; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aS', new THREE.BufferAttribute(sd, 3));
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: U().uTime, uP: U().uP },
    vertexShader: `attribute vec3 aS; uniform float uTime; uniform vec3 uP; varying float vA; varying float vK; void main(){ vec3 p; p.xz = mod(position.xz - uP.xz + 110.0, 220.0) - 110.0 + uP.xz; float span = 70.0; p.y = uP.y - 12.0 + mod(position.y * span + uTime * aS.y, span);
      p.x += sin(uTime * 0.9 + aS.x * 40.0 + p.y * 0.3) * 1.4 + uTime * 0.0; p.z += cos(uTime * 0.7 + aS.x * 70.0 + p.y * 0.25) * 1.4; vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; vK = step(0.0, aS.y);
      vA = smoothstep(110.0, 50.0, -mv.z) * (0.45 + 0.55 * sin(uTime * (3.0 + aS.x * 5.0) + aS.x * 60.0)); gl_PointSize = clamp(aS.z * mix(70.0, 110.0, vK) / -mv.z, 1.0, 12.0); }`,
    fragmentShader: 'varying float vA; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); vec3 c = mix(vec3(0.16, 0.13, 0.13), vec3(1.0, 0.42, 0.08) * 2.0, vK); gl_FragColor = vec4(c * a * max(vA, 0.15 * (1.0 - vK) + 0.0), a * vA); }' });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 6; G.scene.add(pts);
}

/* ───── 온천 : 언덕 위의 청록빛 못과 김 ───── */
function spring() {
  const L = W.lake, y = 14.1, mat = new THREE.ShaderMaterial({ transparent: true, uniforms: { uTime: U().uTime, uC: { value: new THREE.Vector2(L.x, L.z) }, uR: { value: L.r } },
    vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform float uTime, uR; uniform vec2 uC;\n${NOISE}
      void main(){ float d = distance(vP.xz, uC); float w = fb(vP.xz * 0.16 + uTime * 0.08); vec3 V = normalize(cameraPosition - vP); float fr = pow(1.0 - max(V.y, 0.0), 3.0);
        vec3 c = mix(vec3(0.05, 0.55, 0.55), vec3(0.45, 1.0, 0.9), smoothstep(0.3, 0.8, w)) * 1.15; c += vec3(0.6, 1.0, 0.95) * smoothstep(0.75, 0.9, fb(vP.xz * 0.5 - uTime * 0.15)) * 0.5;
        c = mix(c, vec3(0.5, 0.12, 0.06), fr * 0.5); gl_FragColor = vec4(c, mix(0.8, 0.95, fr) * smoothstep(uR * 1.0, uR * 0.88, d)); }` });
  const m = new THREE.Mesh(new THREE.CircleGeometry(L.r * 1.02, 48), mat); m.rotation.x = -Math.PI / 2; m.position.set(L.x, y, L.z); G.scene.add(m); W.pool = { x: L.x, z: L.z, r: L.r, y };
  // 김
  const r = rng(9), N = 70, pos = new Float32Array(N * 3), sd = new Float32Array(N * 2); for (let i = 0; i < N; i++) { const a = r() * 6.283, d = Math.sqrt(r()) * L.r * 0.9; pos[i * 3] = L.x + Math.cos(a) * d; pos[i * 3 + 1] = y; pos[i * 3 + 2] = L.z + Math.sin(a) * d; sd[i * 2] = r(); sd[i * 2 + 1] = 0.6 + r(); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aS', new THREE.BufferAttribute(sd, 2));
  const sm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: U().uTime },
    vertexShader: 'attribute vec2 aS; uniform float uTime; varying float vA; void main(){ float t = fract(uTime * 0.06 * aS.y + aS.x); vec3 p = position; p.y += t * 16.0; p.x += sin(t * 5.0 + aS.x * 30.0) * 2.0 * t; vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; vA = sin(t * 3.14) * smoothstep(160.0, 60.0, -mv.z); gl_PointSize = clamp((900.0 + 2200.0 * t) / -mv.z, 2.0, 260.0); }',
    fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(0.85, 0.95, 0.95), a * a * vA * 0.16); }' });
  const pts = new THREE.Points(geo, sm); pts.frustumCulled = false; pts.renderOrder = 4; G.scene.add(pts);
}

/* ───── 불씨 나무 · 현무암 기둥 · 흑요석 · 불꽃 수정 · 불백합 · 가시덤불 · 분기공 · 갈비뼈 ───── */
function flora() {
  const r = rng(277), q = G.quality, dry = (x, z, mg = 0) => openGround(x, z, mg) && !W.lavaAt(x, z) && lavaMask(x, z) < 0.15, grove = (x, z) => fbm(x * 0.009 + 40, z * 0.009 + 40, 3);
  const em = m => { m.envMapIntensity = 0.25; if (m.name === 'ember' || m.name === 'ember2' || m.name === 'firex') { m.emissiveIntensity = (m.emissiveIntensity || 1) * 0.42; m.userData.pulse = 1; W.pulse.push(m); } };
  for (const [key, n] of [['ember_tree_a', 62], ['ember_tree_b', 52]]) { const list = place(r, Math.round(n * q), (x, z) => dry(x, z, 20) && Math.hypot(x, z) > 42 && grove(x, z) > 0.42 ? { s: 1.0 + Math.pow(r(), 1.5) * 1.6 } : null); list.forEach(t => { t.y -= 0.25 * t.s; });
    scatter(key, list, { shadow: true, max: 620, mat: em }); list.forEach(t => W.colliders.push({ x: t.x, z: t.z, r: 0.45 * t.s, big: 1, h: 3 * t.s, can: [t.x, t.y + 6.2 * t.s, t.z, 2.4 * t.s] })); }
  const cols = place(r, Math.round(105 * q), (x, z) => dry(x, z, 6) && Math.hypot(x, z) > 40 ? { s: 0.8 + Math.pow(r(), 2) * 2.2 } : null);
  for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283 + 0.1, d = W.arena.r * (0.5 + (k % 2) * 0.3), x = W.arena.x + Math.cos(a) * d, z = W.arena.z + Math.sin(a) * d; if (lavaMask(x, z) > 0.1) continue; cols.push({ x, z, y: hAt(x, z), s: 2.0 + r() * 0.8, ry: r() * 6.283 }); }
  scatter('basalt_columns', cols, { shadow: true, max: 620, bright: 0.85 }); cols.forEach(t => { solid('basalt_columns', t); if (t.s > 1.5) W.colliders.push({ x: t.x, z: t.z, r: 2.2 * t.s, big: 1, h: -1 }); });
  const obs = place(r, Math.round(260 * q), (x, z) => dry(x, z, 4) && Math.hypot(x, z) > 30 ? { s: 0.7 + Math.pow(r(), 2) * 2.2 } : null); scatter('obsidian_shards', obs, { shadow: true, max: 380, mat: m => { m.envMapIntensity = 1.6; m.roughness = 0.1; } }); obs.forEach(t => W.colliders.push({ x: t.x, z: t.z, r: 0.5 * t.s, h: 2.5 * t.s }));
  scatter('fire_crystal', place(r, Math.round(150 * q), (x, z) => dry(x, z, 4) && Math.hypot(x, z) > 30 && lavaMask(x, z) < 0.12 ? { s: 0.5 + r() * 1.0 } : null), { max: 380, mat: em });
  scatter('fire_lily', place(r, Math.round(1500 * q), (x, z) => dry(x, z, 2) ? { s: 1.1 + r() * 1.6 } : null), { max: 190, mat: m => { em(m); m.side = THREE.DoubleSide; } });
  scatter('thorn_bush', place(r, Math.round(520 * q), (x, z) => dry(x, z, 3) && Math.hypot(x, z) > 20 ? { s: 0.8 + r() * 1.2 } : null), { max: 260, mat: em });
  const vs = place(r, Math.round(26 * Math.max(0.6, q)), (x, z) => dry(x, z, 10) && Math.hypot(x, z) > 60 ? { s: 1.3 + r() * 1.2 } : null); scatter('vent', vs, { shadow: true, max: 520, bright: 0.8, mat: em }); vs.forEach(t => { solid('vent', t); vents.push({ x: t.x, z: t.z, y: t.y + 1.0 * t.s, s: t.s, next: r() * 6 }); });
  const rb = []; for (const [x, z, s, ry] of [[-150, 40, 1.0, 0.6], [120, -210, 1.25, 2.2], [-60, 330, 0.9, 4.0], [380, 60, 1.1, 1.2], [-380, -90, 1.3, 5.2]]) if (hAt(x, z) > W.water + 2) rb.push({ x, z, y: hAt(x, z) - 0.8 * s, s, ry }); scatter('ribs', rb, { shadow: true, max: 900, bright: 1.1 });
}

/* ───── 떠 있는 현무암 섬 (윗면은 육각 기둥 바닥) ───── */
function isles() {
  const r = rng(5), cliff = parts('namaqualand_cliff_02'), cb = bounds('namaqualand_cliff_02'), bb = bounds('basalt_columns'), defs = [[110, -120, 44, 24], [220, 60, 60, 28], [-120, 230, 50, 28], [330, -230, 70, 30], [-200, -60, 56, 26]];
  for (const [x, z, up, rad] of defs) {
    if (hAt(x, z) < W.water + 1) continue; const y = hAt(x, z) + up, isl = { x, z, y, r: rad * 0.78 }; W.islands.push(isl); const g = new THREE.Group(); g.position.set(x, y, z);
    for (let k = 0; k < 4; k++) for (const p of cliff) { const mm = p.mat.clone(); mm.side = THREE.DoubleSide; mm.color.multiplyScalar(0.45); const m = new THREE.Mesh(p.geo, mm); const s = (rad * (1.5 - k * 0.24)) / Math.max(cb.size.x, cb.size.z); m.applyMatrix4(p.m); const h = new THREE.Group(); h.add(m); h.scale.set(s, -s * (1.3 + k * 0.5), s); h.rotation.y = k * 1.3 + r(); h.position.y = -2.2 - k * rad * 0.15; g.add(h); m.castShadow = true; }
    const top = clone('basalt_columns'), ts = rad * 2.05 / Math.max(bb.size.x, bb.size.z), sy = 0.22; top.scale.set(ts, ts * sy, ts); top.position.y = -bb.max.y * ts * sy + 0.15; top.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.8); o.receiveShadow = true; o.castShadow = true; } }); g.add(top);
    const tsz = 0.9 + r() * 0.6, tree = clone('ember_tree_a'); tree.scale.setScalar(tsz); tree.position.set(rad * 0.2, 0, -rad * 0.16); g.add(tree);
    const chest = clone('treasure_chest'); chest.scale.setScalar(1.6); chest.position.set(-rad * 0.26, 0, rad * 0.14); chest.rotation.y = r() * 6; g.add(chest);
    W.colliders.push({ x: x + rad * 0.2, z: z - rad * 0.16, r: 0.45 * tsz, y0: y, h: 3 * tsz }, { x: x - rad * 0.26, z: z + rad * 0.14, r: 0.9, y0: y, h: 1.2 });
    W.nodes.push({ id: 'chest' + W.islands.length, type: 'chest', x: x - rad * 0.26, z: z + rad * 0.14, y, obj: chest, ready: true, r: 3.2 }); G.scene.add(g); isl.group = g;
    let a = r() * 6.28, px, pz, gd = 0; do { a += 1.3; px = x + Math.cos(a) * (rad + 14); pz = z + Math.sin(a) * (rad + 14); } while ((hAt(px, pz) < W.water + 2 || lavaMask(px, pz) > 0.1) && gd++ < 6);
    addPad(px, pz, Math.sqrt(2 * 34 * (y - hAt(px, pz) + 9)), [x - px, z - pz]);
  }
}

export function build3() {
  W.pulse = []; G.scene.fog = new THREE.FogExp2(0x3a0f0a, 0.0021); if (G.scene.environment) G.scene.environmentIntensity = 0.12; if (G.bloom) { G.bloom.strength = 0.5; G.bloom.threshold = 0.9; G.bloom.radius = 0.6; } G.renderer.toneMappingExposure = 1.0;
  buildMask(); sky3(); terrain3(); lavaSea(); spring(); isles(); flora(); embers();
}
const cF = new THREE.Color(0x3a0f0a), cV = new THREE.Vector3();
export function update3(dt, focus, sun, hemi) {
  const t = U().uTime.value; U().uNight.value = 0.9;
  sun.color.setHex(0xffb49a); sun.intensity = 1.5; hemi.color.setHex(0x6a3a5a); hemi.groundColor.setHex(0xff5a1e); hemi.intensity = 0.62 + Math.sin(t * 1.3) * 0.04;      // 아래(용암)에서 올라오는 붉은 빛
  flash.t -= dt; if (flash.t <= 0) { flash.t = 3 + Math.random() * 9; flash.v = 1; } flash.v = Math.max(0, flash.v - dt * (flash.v > 0.6 ? 9 : 2.5)); if (flash.v > 0.5 && Math.random() < 0.3) flash.v = 1;
  skyU.uFlash.value = flash.v; G.scene.fog.color.copy(cF).multiplyScalar(1 + flash.v * 0.5);
  if (focus) { sun.target.position.copy(focus); sun.position.set(focus.x + 62, focus.y + 60, focus.z + 55); skyMesh.position.set(focus.x, 0, focus.z); seaMesh.position.x = focus.x; seaMesh.position.z = focus.z;
    const dx = W.arena.x - focus.x, dz = W.arena.z - focus.z, d = Math.hypot(dx, dz) || 1; skyU.uVol.value.set(dx / d, clamp((hAt(W.arena.x + W.arena.r * 1.3, W.arena.z) - focus.y) / Math.max(d, 60), -0.05, 0.6), dz / d);
    for (const v of vents) { v.next -= dt; if (v.next <= 0) { v.next = 4 + Math.random() * 6; if (dist2(v.x, v.z, focus.x, focus.z) < 110) { burst(v.x, v.y, v.z, 26, 0xff7a1a, 5, 0.5, 15, 10, 1.3); burst(v.x, v.y, v.z, 10, 0xffd27a, 3, 0.4, 20, 8, 1.1); } } } }
  const pk = 0.85 + 0.15 * Math.sin(t * 2.3); for (const m of W.pulse) { if (m.userData.base === undefined) m.userData.base = m.emissiveIntensity; m.emissiveIntensity = m.userData.base * pk; }
}
