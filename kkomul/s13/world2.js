// 2지역 「구름고래 하늘바다」 : 머리 위에는 바다가 걸려 있고, 발밑은 뭉게구름인 거꾸로 된 세상
import { THREE, G, clamp, lerp, rng, dist2 } from './g.js';
import { parts, clone } from './assets.js';
import { W, hAt, slopeAt, fbm, solid, scatter, place, openGround, addPad } from './world.js';

const SEA = 190;                       // 하늘 바다 수면 높이
const NOISE = `float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  float fb(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
  float caustic(vec2 p, float t){ vec2 i = p; float c = 0.0; for (int n = 0; n < 3; n++){ float tt = t * (1.0 + float(n) * 0.37); i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x)); float l = abs(sin(i.x + tt)) + abs(cos(i.y + tt)); c += 1.0 / (0.25 + l * 2.6); } c /= 3.0; return clamp(pow(c * 1.55, 6.0), 0.0, 2.0); }`;
const TINTS = [0xff8fb1, 0xff7a59, 0xb89cff, 0xfff3ea, 0x7fe0d0, 0xffd27a, 0xff9ad5, 0x8fb8ff];
const U = () => W.uniforms;
let seaMesh, skyMesh, mistPts, mistArr, whales = [], colMats = [];

/* ───── 구름 땅 ───── */
function terrain2() {
  const geo = new THREE.PlaneGeometry(W.size, W.size, W.res, W.res); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), e = W.cell * 2.2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = hAt(x, z); pos.setY(i, h);
    const av = (hAt(x + e, z) + hAt(x - e, z) + hAt(x, z + e) + hAt(x, z - e)) / 4;
    col[i * 3] = clamp(0.62 + (h - av) * 0.22, 0, 1);                                          // 볼록한 곳은 밝게, 골은 그늘
    col[i * 3 + 1] = clamp(1 - dist2(x, z, W.arena.x, W.arena.z) / (W.arena.r * 1.1), 0, 1);     // 바람골
    col[i * 3 + 2] = clamp((h - 2) / 16, 0, 1);                                                // 안개 바다에 잠기는 가장자리
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const A = G.assets, mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, normalMap: A.n_wool, normalScale: new THREE.Vector2(1.6, 1.6), envMapIntensity: 0.15 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uTime: U().uTime, uSteps: U().uSteps });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_NORMALMAP\n vNormalMapUv = position.xz * 0.045;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn; uniform float uTime; uniform vec3 uSteps[16];\n' + NOISE)
      .replace('#include <color_fragment>', `
        float puff = fb(vWp.xz * 0.045) * 0.55 + fb(vWp.xz * 0.16) * 0.3 + fb(vWp.xz * 0.55) * 0.15;
        float sunl = dot(normalize(vWn), normalize(vec3(-0.5, 0.75, -0.6))) * 0.5 + 0.5;
        float lit = clamp(vColor.r * 0.55 + sunl * 0.45 + (puff - 0.5) * 0.9, 0.0, 1.0);
        vec3 c = mix(vec3(0.52, 0.50, 0.80), vec3(0.94, 0.92, 0.95), smoothstep(0.28, 0.72, lit));     // 그늘은 푸른 보랏빛, 볕은 흰빛
        c = mix(c, vec3(1.0, 0.86, 0.84), smoothstep(0.72, 0.98, lit) * 0.45);                          // 마루에 복숭앗빛
        c = mix(vec3(0.90, 0.70, 0.80), c, vColor.b);                                                   // 가장자리는 안개빛으로
        c = mix(c, c * vec3(0.84, 0.80, 0.96), vColor.g * 0.5);
        diffuseColor.rgb = c;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float up = smoothstep(0.55, 0.95, vWn.y);
        totalEmissiveRadiance += diffuseColor.rgb * 0.10; totalEmissiveRadiance += vec3(1.0, 0.82, 0.86) * pow(1.0 - max(dot(normalize(vWn), normalize(cameraPosition - vWp)), 0.0), 4.0) * 0.22;                                             // 구름은 그늘에서도 은은히 밝음
        totalEmissiveRadiance += vec3(0.55, 0.95, 1.0) * caustic(vWp.xz * 0.16, uTime * 0.55) * 0.22 * up;   // 하늘 바다를 지나온 물그림자
        float sg = 0.0; for (int i = 0; i < 16; i++) { float age = uTime - uSteps[i].z; if (age > 0.0 && age < 4.0) { float sd = distance(vWp.xz, uSteps[i].xy); sg += smoothstep(0.45, 0.0, abs(sd - age * 2.2)) * exp(-age * 1.3); } }
        totalEmissiveRadiance += vec3(1.0, 0.72, 0.9) * sg * 0.45;`);
  };
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.name = 'terrain'; G.scene.add(mesh);
}

/* ───── 분홍 하늘 ───── */
function sky2() {
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uTime: U().uTime },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vD; uniform float uTime;\n${NOISE}
      void main(){ vec3 d = normalize(vD); float y = d.y;
        vec3 c = mix(vec3(1.0, 0.80, 0.70), vec3(0.99, 0.60, 0.72), smoothstep(-0.02, 0.22, y)); c = mix(c, vec3(0.72, 0.56, 0.90), smoothstep(0.2, 0.75, y));
        c = mix(vec3(0.97, 0.80, 0.84), c, smoothstep(-0.12, 0.02, y));                                // 지평선 아래는 안개 바다 빛
        vec3 sd = normalize(vec3(-0.5, 0.16, -0.85)); float s = max(dot(d, sd), 0.0); c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 3.0 + pow(s, 24.0) * 0.5 + pow(s, 4.0) * 0.18);
        float az = atan(d.z, d.x); float band = fb(vec2(az * 3.0 + uTime * 0.004, y * 9.0)); c = mix(c, vec3(1.0, 0.93, 0.92), smoothstep(0.5, 0.8, band) * smoothstep(0.26, 0.02, abs(y - 0.07)) * 0.75);   // 지평선의 긴 구름 띠
        gl_FragColor = vec4(c, 1.0); }` });
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(2000, 40, 20), mat); skyMesh.frustumCulled = false; skyMesh.renderOrder = -10; G.scene.add(skyMesh); W.skyMesh = skyMesh;
}

/* ───── 하늘에 걸린 바다 : 아래에서 올려다보는 수면 ───── */
function seaAbove() {
  const mat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false, fog: false, uniforms: { uTime: U().uTime, uWh: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] } },
    vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform float uTime; uniform vec3 uWh[3];\n${NOISE}
      void main(){ vec2 q = vP.xz; float dist = distance(cameraPosition.xz, q);
        float w1 = fb(q * 0.012 + vec2(uTime * 0.02, uTime * 0.013)), w2 = fb(q * 0.035 - vec2(uTime * 0.03, 0.0));
        vec2 gr = vec2(fb(q * 0.02 + vec2(0.7, 0.0) + uTime * 0.02) - w1, fb(q * 0.02 + vec2(0.0, 0.7) + uTime * 0.02) - w1) * 2.2;
        vec3 V = normalize(cameraPosition - vP); vec3 N = normalize(vec3(gr.x, -1.0, gr.y));
        float fres = pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 3.0);
        vec3 deep = vec3(0.04, 0.30, 0.52), mid = vec3(0.10, 0.62, 0.74), lite = vec3(0.62, 0.96, 0.96);
        vec3 c = mix(deep, mid, smoothstep(0.3, 0.7, w1)); c = mix(c, lite, smoothstep(0.55, 0.85, w2) * 0.55);
        float ca = caustic(q * 0.045, uTime * 0.5) + caustic(q * 0.11 + 7.0, uTime * 0.7) * 0.6; c += vec3(0.80, 1.0, 1.0) * ca * 0.42;                 // 수면의 빛 그물
        vec3 sd = normalize(vec3(-0.5, 0.16, -0.85)); float sp = pow(max(dot(reflect(-sd, N), V), 0.0), 60.0); c += vec3(1.0, 0.9, 0.75) * sp * 0.9;
        float sun = pow(max(dot(normalize(vP - cameraPosition), sd), 0.0), 9.0); c += vec3(1.0, 0.72, 0.6) * sun * 0.5;     // 해가 비쳐 드는 쪽
        for (int i = 0; i < 3; i++) { vec2 dd = (q - uWh[i].xy); float a = uWh[i].z; dd = vec2(dd.x * cos(a) - dd.y * sin(a), dd.x * sin(a) + dd.y * cos(a)); c *= 1.0 - 0.6 * smoothstep(1.0, 0.55, length(dd / vec2(16.0, 58.0))); }   // 수면 가까이 헤엄치는 큰 그림자
        c = mix(c, vec3(0.99, 0.66, 0.74), clamp(fres * 0.35 + smoothstep(700.0, 1900.0, dist) * 0.9, 0.0, 1.0));   // 멀수록 분홍 하늘을 비춤
        gl_FragColor = vec4(c, 1.0 - smoothstep(1500.0, 2100.0, dist)); }` });
  const geo = new THREE.CircleGeometry(2200, 72); geo.rotateX(Math.PI / 2);
  seaMesh = new THREE.Mesh(geo, mat); seaMesh.position.y = SEA; seaMesh.frustumCulled = false; seaMesh.renderOrder = -5; G.scene.add(seaMesh);
}

/* ───── 빛줄기 : 하늘 바다에서 구름 땅으로 내려오는 볕 ───── */
function rays() {
  const r = rng(41), N = 46, geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, -0.5, 0);
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: { uTime: U().uTime },
    vertexShader: `uniform float uTime; varying vec2 vU; varying float vS; void main(){ vU = uv; vec3 c = instanceMatrix[3].xyz; float w = length(instanceMatrix[0].xyz), h = length(instanceMatrix[1].xyz); vS = fract(c.x * 0.137 + c.z * 0.071);
      vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0])); vec3 p = c + right * position.x * w * (1.0 + (-position.y) * 0.9) + vec3(0.0, position.y * h, 0.0); p.x += (-position.y) * h * 0.22; p.z += (-position.y) * h * 0.1 + sin(uTime * 0.2 + vS * 30.0) * (-position.y) * 6.0;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `varying vec2 vU; varying float vS; uniform float uTime; void main(){ float x = abs(vU.x - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, x); a *= a; float y = 1.0 - vU.y; a *= smoothstep(1.0, 0.75, y) * (0.35 + 0.65 * (1.0 - y)) ; a *= 0.6 + 0.4 * sin(uTime * 0.5 + vS * 40.0 + vU.x * 9.0);
      gl_FragColor = vec4(vec3(1.0, 0.92, 0.82) * a * 0.10, a); }` });
  const im = new THREE.InstancedMesh(geo, mat, N), M = new THREE.Matrix4();
  for (let i = 0; i < N; i++) { const a = r() * 6.283, d = 40 + Math.sqrt(r()) * 640, x = Math.cos(a) * d, z = Math.sin(a) * d, w = 16 + r() * 34; M.makeScale(w, SEA - Math.max(hAt(x, z), 0) + 4, 1); M.setPosition(x, SEA, z); im.setMatrixAt(i, M); }
  im.frustumCulled = false; im.renderOrder = 5; G.scene.add(im);
}

/* ───── 물기둥 : 하늘 바다와 구름 땅을 잇는 물줄기 ───── */
function column(x, z, rad, y0) {
  const h = SEA - y0, geo = new THREE.CylinderGeometry(rad * 1.35, rad, h, 28, 1, true); geo.translate(0, h / 2, 0);
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: U().uTime, uH: { value: h } },
    vertexShader: 'varying vec2 vU; varying vec3 vN; varying vec3 vV; void main(){ vU = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
    fragmentShader: `varying vec2 vU; varying vec3 vN; varying vec3 vV; uniform float uTime, uH;\n${NOISE}
      void main(){ vec2 q = vec2(vU.x * 14.0, vU.y * uH * 0.06 + uTime * 1.6); float s = fb(q) * 0.6 + fb(q * vec2(2.0, 0.6) + 3.0) * 0.4; float streak = smoothstep(0.42, 0.8, s);
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6); vec3 c = mix(vec3(0.20, 0.70, 0.85), vec3(0.92, 1.0, 1.0), streak) + vec3(0.6, 0.9, 1.0) * rim * 0.5;
        float a = (0.42 + 0.4 * streak + 0.3 * rim) * smoothstep(0.0, 0.03, vU.y) * smoothstep(1.0, 0.94, vU.y); gl_FragColor = vec4(c, a); }` });
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y0, z); m.renderOrder = 4; G.scene.add(m); colMats.push({ x, z, y: y0, r: rad });
}
// 물기둥이 떨어지는 얕은 못 (구름 위에 고인 물)
function pool() {
  const L = W.lake, y = 31.0, mat = new THREE.ShaderMaterial({ transparent: true, uniforms: { uTime: U().uTime, uC: { value: new THREE.Vector2(L.x, L.z) }, uR: { value: L.r } },
    vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform float uTime, uR; uniform vec2 uC;\n${NOISE}
      void main(){ float d = distance(vP.xz, uC); float rp = sin(d * 0.9 - uTime * 3.0) * 0.5 + 0.5; float w = fb(vP.xz * 0.12 + uTime * 0.1);
        vec3 V = normalize(cameraPosition - vP); float fr = pow(1.0 - max(V.y, 0.0), 3.0);
        vec3 c = mix(vec3(0.16, 0.66, 0.80), vec3(0.62, 0.95, 0.96), smoothstep(0.35, 0.8, w)); c += vec3(0.9, 1.0, 1.0) * rp * smoothstep(30.0, 6.0, d) * 0.35 + caustic(vP.xz * 0.2, uTime * 0.6) * 0.4;
        c = mix(c, vec3(0.99, 0.72, 0.78), fr * 0.7); gl_FragColor = vec4(c, mix(0.72, 0.94, fr) * smoothstep(uR * 1.02, uR * 0.9, d)); }` });
  const m = new THREE.Mesh(new THREE.CircleGeometry(L.r * 1.05, 56), mat); m.rotation.x = -Math.PI / 2; m.position.set(L.x, y, L.z); G.scene.add(m);
  column(L.x, L.z, 9, y); W.pool = { x: L.x, z: L.z, r: L.r, y };
}

/* ───── 산호 숲 · 해면 · 말미잘 · 다시마 · 소라 · 뭉게구름 ───── */
function flora() {
  const CORALS = [0xff8fb1, 0xff7a59, 0xb89cff, 0xfff3ea, 0xffd27a, 0xff9ad5, 0xff5f6d, 0xc9a0ff], r = rng(177), q = G.quality, tint = () => CORALS[Math.floor(r() * CORALS.length)], reef = (x, z) => fbm(x * 0.009 + 40, z * 0.009 + 40, 3);
  const glowUp = m => { m.color.multiplyScalar(1.7); m.emissive = new THREE.Color(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = 0.12; m.envMapIntensity = 0.2; };
  // 산호 나무 3종
  for (const [key, n] of [['coral_tree_a', 46], ['coral_tree_b', 46], ['coral_tree_c', 34]]) {
    const list = place(r, Math.round(n * q), (x, z) => openGround(x, z, 22) && Math.hypot(x, z) > 42 && reef(x, z) > 0.42 ? { s: 1.2 + Math.pow(r(), 1.6) * 2.6, c: tint() } : null); list.forEach(t => { t.y -= 0.3 * t.s; });
    scatter(key, list, { shadow: true, max: 560, mat: glowUp }); list.forEach(t => W.colliders.push({ x: t.x, z: t.z, r: 0.5 * t.s, big: 1, h: 3 * t.s, can: [t.x, t.y + 6.4 * t.s, t.z, 2.6 * t.s] }));
  }
  const fans = place(r, Math.round(190 * q), (x, z) => openGround(x, z, 8) && Math.hypot(x, z) > 30 ? { s: 0.9 + r() * 1.9, c: tint() } : null); scatter('coral_fan', fans, { shadow: true, max: 380, mat: glowUp }); fans.forEach(t => W.colliders.push({ x: t.x, z: t.z, r: 0.22 * t.s, h: 2 * t.s }));
  const tabs = place(r, Math.round(95 * q), (x, z) => openGround(x, z, 8) && Math.hypot(x, z) > 30 ? { s: 1.4 + Math.pow(r(), 2) * 3.2, c: tint() } : null); scatter('coral_table', tabs, { shadow: true, max: 480, mat: glowUp }); tabs.forEach(t => solid('coral_table', t));
  const brains = place(r, Math.round(130 * q), (x, z) => openGround(x, z, 4) && Math.hypot(x, z) > 30 ? { s: 1.0 + Math.pow(r(), 2.5) * 4.5, c: tint() } : null); brains.forEach(t => { t.y -= 0.12 * t.s; }); scatter('coral_brain', brains, { shadow: true, max: 480, mat: glowUp });
  brains.forEach(t => { solid('coral_brain', t); if (t.s > 3) W.colliders.push({ x: t.x, z: t.z, r: 1.1 * t.s, big: 1, h: -1 }); });
  const sps = place(r, Math.round(150 * q), (x, z) => openGround(x, z, 6) && Math.hypot(x, z) > 30 && reef(x, z) > 0.38 ? { s: 0.9 + r() * 1.8, c: tint() } : null); scatter('sponge', sps, { shadow: true, max: 360, mat: glowUp }); sps.forEach(t => W.colliders.push({ x: t.x, z: t.z, r: 0.95 * t.s, h: 2.6 * t.s }));
  // 소라 (실제 스캔 모델) : 올라설 수 있는 큰 껍데기
  const sh = place(r, Math.round(70 * q), (x, z) => openGround(x, z, 4) && Math.hypot(x, z) > 30 ? { s: 30 + Math.pow(r(), 2) * 70 } : null); sh.forEach(t => { t.y -= 0.003 * t.s; }); scatter('lambis_shell', sh, { shadow: true, max: 420, bright: 1.25 }); sh.forEach(t => solid('lambis_shell', t));
  // 바람골 가장자리의 큰 산호 기둥 (구름고래가 들이받는 곳)
  const ring = []; for (let k = 0; k < 9; k++) { const a = k / 9 * 6.283 + 0.3, d = W.arena.r * (0.6 + (k % 3) * 0.13), x = W.arena.x + Math.cos(a) * d, z = W.arena.z + Math.sin(a) * d, s = 2.6 + r() * 1.2; ring.push({ x, z, y: hAt(x, z) - 0.3 * s, s, ry: r() * 6.283, c: tint() }); }
  scatter('coral_tree_c', ring, { shadow: true, max: 900, mat: glowUp }); ring.forEach(t => W.colliders.push({ x: t.x, z: t.z, r: 0.62 * t.s, big: 1, h: 3 * t.s }));
  // 흔들리는 것 : 말미잘 · 다시마
  const sway = (amp, hgt) => m => { m.color.set(0xffffff); m.side = THREE.DoubleSide; m.envMapIntensity = 0.2; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0.0; m.onBeforeCompile = shd => { shd.uniforms.uTime = U().uTime; shd.vertexShader = shd.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>\n float ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17; float k = clamp(transformed.y / ${hgt.toFixed(1)}, 0.0, 1.0); k *= k; transformed.x += sin(uTime * 1.1 + ph + transformed.y * 0.5) * ${amp.toFixed(2)} * k; transformed.z += cos(uTime * 0.9 + ph * 1.3 + transformed.y * 0.4) * ${amp.toFixed(2)} * k;`); shd.fragmentShader = shd.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.38;'); }; };
  scatter('anemone', place(r, Math.round(650 * q), (x, z) => openGround(x, z, 2) ? { s: 0.7 + r() * 1.5, c: tint() } : null), { max: 200, mat: sway(0.35, 2.0) });
  const kc = [0x9fd8b0, 0x6fd0c0, 0xe6d08a, 0xa8c8f0];
  scatter('kelp', place(r, Math.round(520 * q), (x, z) => openGround(x, z, 4) && Math.hypot(x, z) > 20 && reef(x, z) < 0.56 ? { s: 0.7 + r() * 1.1, c: kc[Math.floor(r() * 4)] } : null), { max: 330, mat: sway(1.6, 14.0) });
  // 땅의 뭉게구름 둔덕 (밟고 넘어갈 수 있음)
  const pf = place(r, Math.round(150 * q), (x, z) => hAt(x, z) > 6 && Math.hypot(x, z) > 36 && dist2(x, z, W.arena.x, W.arena.z) > W.arena.r ? { s: 0.35 + Math.pow(r(), 2) * 1.3 } : null); pf.forEach(t => { t.y -= 0.9 * t.s; });
  scatter('cloud_puff', pf, { max: 620, mat: cloudMat }); pf.forEach(t => solid('cloud_puff', t));
}
function cloudMat(m) { m.color.set(0xfdf6f8); m.roughness = 1; m.envMapIntensity = 0.12; m.color.set(0xe9e0ea); m.emissive = new THREE.Color(0xb48cc8); m.emissiveIntensity = 0.16; }

/* ───── 떠 있는 구름 섬 (바람꽃으로 올라감) ───── */
function isles() {
  const r = rng(5), defs = [[70, 110, 30, 22], [150, 190, 46, 26], [250, 240, 64, 28], [-150, -170, 40, 28], [-300, -300, 66, 34], [420, 120, 58, 30], [-430, 110, 80, 38], [60, -400, 54, 30], [300, -120, 40, 24]];
  for (const [x, z, up, rad] of defs) {
    const s = rad / 5.6, y = hAt(x, z) + up, top = y + 1.85 * s * 0.55, isl = { x, z, y: top, r: rad * 0.8 }; W.islands.push(isl);
    const g = new THREE.Group(); g.position.set(x, y, z);
    for (const [dy, sc, sy, ry] of [[0, 1, 0.55, 0], [-2.2 * s, 0.72, 0.5, 2.1], [-4.0 * s, 0.42, 0.5, 4.0]]) { const c = clone('cloud_puff'); c.scale.set(s * sc, s * sy, s * sc); c.position.y = dy; c.rotation.y = ry + r() * 3; c.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); cloudMat(o.material); o.castShadow = true; o.receiveShadow = true; } }); g.add(c); }
    const ts = 1.0 + r() * 0.8, tree = clone(['coral_tree_a', 'coral_tree_b'][Math.floor(r() * 2)]); tree.scale.setScalar(ts); tree.position.set(rad * 0.22, top - y - 0.3, -rad * 0.18); tree.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setHex([0xff8fb1, 0xff7a59, 0xb89cff, 0xffd27a][Math.floor(r() * 4)]).multiplyScalar(1.6); o.material.emissive = new THREE.Color(0xffffff); o.material.emissiveMap = o.material.map; o.material.emissiveIntensity = 0.22; o.castShadow = true; } }); g.add(tree);
    const chest = clone('treasure_chest'); chest.scale.setScalar(1.6); chest.position.set(-rad * 0.28, top - y, rad * 0.14); chest.rotation.y = r() * 6; g.add(chest);
    W.colliders.push({ x: x + rad * 0.22, z: z - rad * 0.18, r: 0.5 * ts, y0: top, h: 3 * ts }, { x: x - rad * 0.28, z: z + rad * 0.14, r: 0.9, y0: top, h: 1.2 });
    W.nodes.push({ id: 'chest' + W.islands.length, type: 'chest', x: x - rad * 0.28, z: z + rad * 0.14, y: top, obj: chest, ready: true, r: 3.2 }); G.scene.add(g); isl.group = g;
    let a = r() * 6.28, px, pz, gd = 0; do { a += 1.1; px = x + Math.cos(a) * (rad + 14); pz = z + Math.sin(a) * (rad + 14); } while (hAt(px, pz) < 6 && gd++ < 6);
    addPad(px, pz, Math.sqrt(2 * 34 * (top - hAt(px, pz) + 9)), [x - px, z - pz]);
  }
}

/* ───── 떠다니는 해파리 ───── */
function jellies() {
  const r = rng(63), n = Math.round(110 * Math.max(0.5, G.quality)), ps = parts('jellyfish'), list = [];
  for (let i = 0, gd = 0; i < n && gd < n * 20; gd++) { const x = (r() * 2 - 1) * 600, z = (r() * 2 - 1) * 600; if (hAt(x, z) < 6) continue; list.push({ x, z, y: hAt(x, z) + 5 + Math.pow(r(), 1.5) * 34, s: 0.7 + Math.pow(r(), 2) * 2.6, ry: r() * 6.28, c: TINTS[Math.floor(r() * TINTS.length)] }); i++; }
  scatter('jellyfish', list, { max: 420, mat: m => { const glow = m.name === 'glow'; m.transparent = !glow; m.opacity = glow ? 1 : 0.62; m.depthWrite = glow; m.side = THREE.DoubleSide; m.envMapIntensity = 0.3; m.emissive = new THREE.Color(glow ? 0xffffff : 0xff9ad0); m.emissiveIntensity = glow ? 2.4 : 0.55;
    m.onBeforeCompile = shd => { shd.uniforms.uTime = U().uTime; shd.vertexShader = shd.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>\n float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.29; float beat = sin(uTime * 1.6 + ph); float bell = smoothstep(-0.2, 0.3, transformed.y); transformed.xz *= 1.0 + beat * 0.1 * bell; float tk = clamp(-transformed.y / 4.0, 0.0, 1.0); transformed.x += sin(uTime * 1.3 + ph + transformed.y * 1.4) * 0.25 * tk; transformed.z += cos(uTime * 1.1 + ph + transformed.y * 1.2) * 0.25 * tk; transformed.y += (sin(uTime * 0.5 + ph) * 1.6 + beat * 0.25) / max(0.4, length(instanceMatrix[1].xyz));`); }; } });
}

/* ───── 하늘을 헤엄치는 물고기 떼 ───── */
function fishes() {
  const r = rng(88), ps = parts('fish'); if (!ps.length) return; const S = Math.round(16 * Math.max(0.5, G.quality)), per = 26, N = S * per, geo = ps[0].geo.clone(); geo.applyMatrix4(ps[0].m);
  const cen = new Float32Array(N * 4), par = new Float32Array(N * 4), colr = new Float32Array(N * 3), C = new THREE.Color();
  for (let s = 0, gd = 0; s < S && gd < 400; gd++) { const x = (r() * 2 - 1) * 560, z = (r() * 2 - 1) * 560; if (hAt(x, z) < 6) continue; const y = hAt(x, z) + 6 + r() * 22, R = 7 + r() * 12, sp = (0.25 + r() * 0.3) * (r() < 0.5 ? 1 : -1), hue = TINTS[Math.floor(r() * TINTS.length)];
    for (let k = 0; k < per; k++) { const i = s * per + k; cen[i * 4] = x; cen[i * 4 + 1] = y + (r() - 0.5) * 3.5; cen[i * 4 + 2] = z; cen[i * 4 + 3] = R * (0.8 + r() * 0.4); par[i * 4] = (k / per) * 1.6 + r() * 0.5; par[i * 4 + 1] = sp * (0.9 + r() * 0.2); par[i * 4 + 2] = 1.2 + r() * 1.4; par[i * 4 + 3] = r() * 6.28; C.setHex(hue).offsetHSL((r() - 0.5) * 0.05, 0, (r() - 0.5) * 0.1); colr[i * 3] = C.r; colr[i * 3 + 1] = C.g; colr[i * 3 + 2] = C.b; } s++; }
  const ig = new THREE.InstancedBufferGeometry(); ig.index = geo.index; ig.setAttribute('position', geo.attributes.position); ig.setAttribute('normal', geo.attributes.normal);
  ig.setAttribute('aC', new THREE.InstancedBufferAttribute(cen, 4)); ig.setAttribute('aP', new THREE.InstancedBufferAttribute(par, 4)); ig.setAttribute('aCol', new THREE.InstancedBufferAttribute(colr, 3)); ig.instanceCount = N;
  const mat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { uTime: U().uTime },
    vertexShader: `uniform float uTime; attribute vec4 aC, aP; attribute vec3 aCol; varying vec3 vC; varying float vL;
      void main(){ float a = aP.x + uTime * aP.y; float dirS = sign(aP.y); vec3 p = position * aP.z; p.x += sin(uTime * 9.0 + aP.w - position.z * 5.0) * 0.08 * aP.z * smoothstep(0.2, -0.5, position.z);        // 꼬리 흔들기 (모델 앞쪽 = +z)
        float ca = cos(a), sa = sin(a); vec3 fw = vec3(-sa, 0.0, ca) * dirS, rt = vec3(ca, 0.0, sa) * dirS; vec3 wp = aC.xyz + vec3(ca, 0.0, sa) * aC.w + rt * p.x + vec3(0.0, p.y + sin(a * 3.0 + aP.w) * 0.8, 0.0) + fw * p.z;
        vec3 n = normalize(rt * normal.x + vec3(0.0, normal.y, 0.0) + fw * normal.z); vL = 0.55 + 0.45 * max(dot(n, normalize(vec3(-0.4, 0.8, -0.4))), 0.0); vC = aCol; gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
    fragmentShader: 'varying vec3 vC; varying float vL; void main(){ gl_FragColor = vec4(vC * vL * 1.15, 1.0); }' });
  const m = new THREE.Mesh(ig, mat); m.frustumCulled = false; G.scene.add(m);
}

/* ───── 위로 떠오르는 물방울 ───── */
function bubbles() {
  const r = rng(71), N = Math.round(900 * Math.max(0.4, G.quality)), pos = new Float32Array(N * 3), sd = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = r() * 240; pos[i * 3 + 1] = r(); pos[i * 3 + 2] = r() * 240; sd[i * 3] = r(); sd[i * 3 + 1] = 2.5 + r() * 5; sd[i * 3 + 2] = 0.4 + Math.pow(r(), 3) * 1.6; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aS', new THREE.BufferAttribute(sd, 3));
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: U().uTime, uP: U().uP },
    vertexShader: `attribute vec3 aS; uniform float uTime; uniform vec3 uP; varying float vA; void main(){ vec3 p; p.xz = mod(position.xz - uP.xz + 120.0, 240.0) - 120.0 + uP.xz; float span = 150.0; p.y = uP.y - 20.0 + mod(position.y * span + uTime * aS.y, span);
      p.x += sin(uTime * 0.8 + aS.x * 40.0 + p.y * 0.2) * 0.8; p.z += cos(uTime * 0.7 + aS.x * 70.0 + p.y * 0.17) * 0.8; vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; vA = smoothstep(120.0, 60.0, -mv.z); gl_PointSize = clamp(aS.z * 190.0 / -mv.z, 1.0, 26.0); }`,
    fragmentShader: 'varying float vA; void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q); float ring = smoothstep(0.5, 0.42, d) * smoothstep(0.30, 0.44, d); float hi = smoothstep(0.16, 0.0, length(q - vec2(-0.16, -0.16))); float a = (ring * 0.75 + hi * 0.9 + smoothstep(0.5, 0.0, d) * 0.1) * vA; gl_FragColor = vec4(vec3(0.9, 1.0, 1.0), a); }' });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 6; G.scene.add(pts);
}

/* ───── 발치를 흐르는 안개 ───── */
function mist() {
  const r = rng(52), N = 150, geo = new THREE.BufferGeometry(), pos = new Float32Array(N * 3), sd = new Float32Array(N); mistArr = [];
  for (let i = 0; i < N; i++) { mistArr.push({ x: (r() * 2 - 1) * 150, z: (r() * 2 - 1) * 150, v: 0.6 + r() * 1.2 }); sd[i] = r(); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aS', new THREE.BufferAttribute(sd, 1));
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: U().uTime },
    vertexShader: 'attribute float aS; varying float vA; varying float vS; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vS = aS; vA = smoothstep(150.0, 70.0, -mv.z) * smoothstep(3.0, 14.0, -mv.z); gl_PointSize = clamp((2600.0 + aS * 2600.0) / -mv.z, 4.0, 420.0); }',
    fragmentShader: `varying float vA; varying float vS; uniform float uTime;\n${NOISE}\n void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q); float a = smoothstep(0.5, 0.05, d); a *= 0.55 + 0.45 * fb(q * 3.0 + vS * 20.0 + uTime * 0.03); gl_FragColor = vec4(vec3(1.0, 0.92, 0.95), a * a * vA * 0.07); }` });
  mistPts = new THREE.Points(geo, mat); mistPts.frustumCulled = false; mistPts.renderOrder = 3; G.scene.add(mistPts);
}

/* ───── 하늘 바다 속을 헤엄치는 큰 그림자 (구름고래 무리) ───── */
function skyWhales() {
  const r = rng(19);
  for (let i = 0; i < 3; i++) whales.push({ a: r() * 6.28, R: 260 + i * 150, sp: (0.012 + r() * 0.01) * (i % 2 ? -1 : 1), cx: (r() - 0.5) * 200, cz: (r() - 0.5) * 200 });
}

export function build2() {
  G.scene.fog = new THREE.FogExp2(0xf0a9bd, 0.0013); if (G.scene.environment) G.scene.environmentIntensity = 0.18; if (G.bloom) { G.bloom.strength = 0.3; G.bloom.threshold = 0.94; G.bloom.radius = 0.5; } G.renderer.toneMappingExposure = 1.0;
  sky2(); terrain2(); seaAbove(); pool(); isles(); flora(); jellies(); fishes(); bubbles(); mist(); rays(); skyWhales();
  for (const [x, z, rad] of [[-330, -60, 5], [120, 420, 6], [470, 260, 4]]) if (hAt(x, z) > 6) column(x, z, rad, hAt(x, z) - 0.5);
}
const cA = new THREE.Color(), cB = new THREE.Color(0xffb48a);
export function update2(dt, focus, sun, hemi) {
  const t = U().uTime.value, cyc = (t / 420 + 0.2) % 1, dusk = 0.5 + 0.5 * Math.sin(cyc * Math.PI * 2);      // 낮과 노을 사이를 오감 (밤 없음)
  U().uNight.value = 0.15 + 0.2 * dusk;
  sun.color.copy(cA.setHex(0xfff0e0).lerp(cB, dusk)); sun.intensity = lerp(2.3, 1.8, dusk); hemi.color.setHex(0xffc8d8); hemi.groundColor.setHex(0xb79ad6); hemi.intensity = lerp(1.3, 1.1, dusk);
  if (focus) { sun.target.position.copy(focus); sun.position.set(focus.x - 60, focus.y + 100, focus.z - 70); skyMesh.position.set(focus.x, 0, focus.z); seaMesh.position.x = focus.x; seaMesh.position.z = focus.z; }
  // 큰 그림자 이동
  const uw = seaMesh.material.uniforms.uWh.value; whales.forEach((w, i) => { w.a += w.sp * dt; uw[i].set(w.cx + Math.cos(w.a) * w.R, w.cz + Math.sin(w.a) * w.R, -w.a + (w.sp > 0 ? 0 : Math.PI)); });
  // 안개 : 바람에 흘러가며 플레이어 주위를 맴돎
  if (focus && mistPts) { const p = mistPts.geometry.attributes.position; for (let i = 0; i < mistArr.length; i++) { const m = mistArr[i]; m.x += m.v * dt; let dx = m.x - focus.x, dz = m.z - focus.z; if (dx > 150) m.x -= 300; else if (dx < -150) m.x += 300; if (dz > 150) m.z -= 300; else if (dz < -150) m.z += 300; if ((G.frame + i) % 6 === 0 || !m.y) m.y = Math.max(hAt(m.x, m.z), 0) + 1.2; p.setXYZ(i, m.x, m.y, m.z); } p.needsUpdate = true; }
  for (const m of W.glowMats) m.emissiveIntensity = 0.3 * (m.userData.gk || 1);
}
