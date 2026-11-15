// 1지역 「별꽃 분지」 : 지형 · 하늘 · 물 · 식생 · 떠 있는 섬 · 자원
import { THREE, G, clamp, lerp, rng, dist2, ease } from './g.js';
import { parts, clone, bounds } from './assets.js';

export const W = {
  size: 1500, res: 300, half: 750, limit: 690, water: 0,
  spawn: { x: 0, z: 0 }, lake: { x: 250, z: 240, r: 125 }, arena: { x: -360, z: -330, r: 105 },
  islands: [], pads: [], colliders: [], nodes: [], grid: null, cell: 0, hmap: null, uniforms: { uTime: { value: 0 }, uNight: { value: 1 } },
};

/* ───── 높이 함수 ───── */
const P = new Uint8Array(512); { const r = rng(20261115); for (let i = 0; i < 256; i++) P[i] = i; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; } for (let i = 0; i < 256; i++) P[256 + i] = P[i]; }
const hash = (x, y) => P[(P[x & 255] + y) & 255] / 255;
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v); }
export function fbm(x, y, o = 5) { let a = 0.5, f = 1, s = 0; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2.03; } return s; }
function rawHeight(x, z) {
  let h = fbm(x * 0.0042 + 11, z * 0.0042 + 7, 5) * 62 - 20;                          // 완만한 구릉
  h += Math.pow(fbm(x * 0.0015 + 3, z * 0.0015 + 9, 3), 2.2) * 95;                    // 큰 능선
  const dc = Math.hypot(x, z);
  const sp = ease(clamp(1 - dc / 130, 0, 1)); h = lerp(h, 6 + fbm(x * 0.03, z * 0.03, 2) * 1.2, sp);          // 마을 터 : 평평한 풀밭
  const dl = dist2(x, z, W.lake.x, W.lake.z), lk = ease(clamp(1 - dl / (W.lake.r * 1.5), 0, 1)); h = lerp(h, -9 + dl * 0.06, lk);   // 호수
  const da = dist2(x, z, W.arena.x, W.arena.z), ar = ease(clamp(1 - da / (W.arena.r * 1.35), 0, 1));
  h = lerp(h, 14 + Math.max(0, da - W.arena.r * 0.85) * 0.55, ar);                    // 아귀 둥지 : 가장자리가 솟은 분화구
  const edge = clamp((dc - 620) / 130, 0, 1); h += edge * edge * (95 + fbm(x * 0.012 + 5, z * 0.012 + 5, 3) * 70);                  // 바깥을 둘러싼 산맥
  return h;
}
export function buildHeight() {
  const n = W.res + 1, m = new Float32Array(n * n); W.cell = W.size / W.res;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) m[j * n + i] = rawHeight(-W.half + i * W.cell, -W.half + j * W.cell);
  W.hmap = m;
}
export function hAt(x, z) {
  const n = W.res + 1, fx = clamp((x + W.half) / W.cell, 0, W.res - 0.001), fz = clamp((z + W.half) / W.cell, 0, W.res - 0.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, m = W.hmap;
  return lerp(lerp(m[j * n + i], m[j * n + i + 1], u), lerp(m[(j + 1) * n + i], m[(j + 1) * n + i + 1], u), v);
}
export function slopeAt(x, z) { const e = 2.5; return Math.hypot(hAt(x + e, z) - hAt(x - e, z), hAt(x, z + e) - hAt(x, z - e)) / (2 * e); }
// 발 디딜 높이 : 지형 또는 떠 있는 섬 윗면 (위에서 내려올 때만 섬에 착지)
export function groundAt(x, z, y) {
  let g = hAt(x, z);
  for (const s of W.islands) { if (dist2(x, z, s.x, s.z) < s.r && y >= s.y - 1.2) g = Math.max(g, s.y); }
  return g;
}

/* ───── 지형 ───── */
function terrain() {
  const geo = new THREE.PlaneGeometry(W.size, W.size, W.res, W.res); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, hAt(x, z));
    col[i * 3] = clamp((fbm(x * 0.011 + 40, z * 0.011 + 40, 3) - 0.42) * 4, 0, 1);       // 숲 바닥 비율
    col[i * 3 + 1] = clamp((fbm(x * 0.02 + 90, z * 0.02 + 15, 2) - 0.55) * 5, 0, 1);      // 빛 이끼
    col[i * 3 + 2] = clamp(1 - dist2(x, z, W.arena.x, W.arena.z) / (W.arena.r * 1.1), 0, 1);  // 둥지의 그을린 땅
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const A = G.assets, mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, normalMap: A.n_leafy_grass, normalScale: new THREE.Vector2(0.7, 0.7) });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { tGrass: { value: A.t_leafy_grass }, tForest: { value: A.t_forrest_ground_01 }, tRock: { value: A.t_cliff_side }, tSand: { value: A.t_coast_sand_01 }, uTime: W.uniforms.uTime, uNight: W.uniforms.uNight });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_NORMALMAP\n vNormalMapUv = position.xz * 0.11;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn; uniform sampler2D tGrass, tForest, tRock, tSand; uniform float uTime, uNight;')
      .replace('#include <color_fragment>', `
        vec2 q = vWp.xz;
        vec3 cg = mix(texture2D(tGrass, q * 0.16).rgb, texture2D(tGrass, q * 0.023).rgb, 0.4) * vec3(0.55, 1.05, 0.9) * 1.1;
        vec3 cf = mix(texture2D(tForest, q * 0.10).rgb, texture2D(tForest, q * 0.017).rgb, 0.4);
        vec3 cr = mix(texture2D(tRock, q * 0.031).rgb, texture2D(tRock, vWp.zy * 0.017 + q.x * 0.011).rgb, 0.5) * vec3(0.62, 0.72, 0.9);
        vec3 cs = texture2D(tSand, q * 0.09).rgb;
        float slope = 1.0 - vWn.y;
        vec3 c = mix(cg, cf, vColor.r);
        c = mix(c, cs, smoothstep(2.2, 0.4, vWp.y));
        c = mix(c, cr, smoothstep(0.30, 0.52, slope));
        c = mix(c, cr * vec3(0.55, 0.42, 0.40), vColor.b * 0.85);
        c = mix(c, cr * 1.15, smoothstep(95.0, 150.0, vWp.y));
        diffuseColor.rgb = c;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float gl = vColor.g * (1.0 - smoothstep(0.25, 0.45, 1.0 - vWn.y)) * (0.55 + 0.45 * sin(uTime * 0.8 + vWp.x * 0.07 + vWp.z * 0.05));
        totalEmissiveRadiance += vec3(0.05, 0.75, 0.62) * gl * 1.3 * uNight;`);
  };
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.name = 'terrain'; G.scene.add(mesh);
}

/* ───── 하늘 : 은하수 · 달 둘 · 오로라 ───── */
function sky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uTime: W.uniforms.uTime, uNight: W.uniforms.uNight },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vD; uniform float uTime, uNight;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      float fb(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
      float stars(vec3 d, float sc, float th){ vec3 p = d * sc; vec3 i = floor(p), f = fract(p) - 0.5; float r = h21(i.xy + i.z * 17.0); float s = smoothstep(0.09 * r, 0.0, length(f)) * step(th, r); return s * (0.6 + 0.4 * sin(uTime * (1.0 + r * 3.0) + r * 40.0)); }
      void main(){
        vec3 d = normalize(vD); float up = clamp(d.y, -0.2, 1.0);
        vec3 top = mix(vec3(0.10, 0.20, 0.46), vec3(0.004, 0.008, 0.035), uNight), hor = mix(vec3(0.98, 0.62, 0.60), vec3(0.03, 0.12, 0.17), uNight), glow = mix(vec3(1.0, 0.78, 0.55), vec3(0.16, 0.07, 0.24), uNight);
        vec3 c = mix(hor, top, pow(smoothstep(-0.05, 0.75, up), 0.6));
        c += glow * pow(1.0 - abs(up), 7.0) * 0.55;
        // 은하수 띠
        vec3 ax = normalize(vec3(0.35, 0.55, -0.75)); float band = 1.0 - abs(dot(d, ax)); float mw = pow(band, 5.0);
        vec2 mp = vec2(atan(d.z, d.x) * 3.0, d.y * 4.0); float cloud = fb(mp * 1.7 + 3.0);
        vec3 mwc = mix(vec3(0.45, 0.30, 0.75), vec3(0.25, 0.75, 0.85), fb(mp * 0.8)) * mw * (0.35 + cloud * 1.3);
        mwc -= vec3(0.25) * mw * smoothstep(0.55, 0.8, fb(mp * 2.6 + 9.0));
        float st = stars(d, 160.0, 0.72) + stars(d, 90.0, 0.80) * 1.5 + stars(d, 260.0, 0.6) * (0.4 + mw * 2.5);
        float vis = mix(0.12, 1.0, uNight) * smoothstep(-0.02, 0.2, d.y);
        c += (max(mwc, 0.0) * 0.55 + vec3(0.9, 0.95, 1.0) * st * 1.6) * vis;
        // 달 둘
        vec3 m1 = normalize(vec3(-0.45, 0.52, -0.72)); float a1 = dot(d, m1); c += vec3(0.95, 0.97, 1.0) * smoothstep(0.9965, 0.9975, a1) * (0.75 + 0.25 * fb(d.xy * 60.0)) + vec3(0.5, 0.65, 1.0) * pow(max(a1, 0.0), 180.0) * 0.5;
        vec3 m2 = normalize(vec3(0.62, 0.33, 0.70)); float a2 = dot(d, m2); c += vec3(1.0, 0.62, 0.72) * smoothstep(0.9990, 0.9994, a2) + vec3(1.0, 0.4, 0.6) * pow(max(a2, 0.0), 400.0) * 0.4;
        // 오로라 장막
        float az = atan(d.z, d.x); float wav = sin(az * 3.0 + uTime * 0.12) * 0.12 + sin(az * 7.0 - uTime * 0.2) * 0.05;
        float cur = smoothstep(0.0, 0.25, d.y - 0.16 - wav) * smoothstep(0.62, 0.22, d.y - wav);
        float ray = 0.55 + 0.45 * n2(vec2(az * 26.0 + uTime * 0.25, 1.0));
        c += mix(vec3(0.1, 1.0, 0.65), vec3(0.6, 0.3, 1.0), smoothstep(0.2, 0.6, d.y)) * cur * ray * 0.34 * mix(0.25, 1.0, uNight) * (0.6 + 0.4 * sin(az * 2.0 + uTime * 0.07));
        gl_FragColor = vec4(c * mix(1.0, 0.6, uNight), 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), mat); m.name = 'sky'; m.frustumCulled = false; m.renderOrder = -10; G.scene.add(m); W.skyMesh = m;
}

/* ───── 호수 ───── */
function water() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, uniforms: { uTime: W.uniforms.uTime, uNight: W.uniforms.uNight, uC: { value: new THREE.Vector3(W.lake.x, 0, W.lake.z) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform float uTime, uNight; uniform vec3 uC;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        vec2 q = vP.xz * 0.08; float w = n(q + uTime * 0.12) * 0.6 + n(q * 2.3 - uTime * 0.2) * 0.4;
        vec3 V = normalize(cameraPosition - vP); float fr = pow(1.0 - max(V.y, 0.0), 3.0);
        vec3 deep = mix(vec3(0.05, 0.32, 0.45), vec3(0.02, 0.10, 0.20), uNight), shal = mix(vec3(0.35, 0.85, 0.85), vec3(0.10, 0.75, 0.70), uNight);
        vec3 c = mix(deep, shal, smoothstep(0.35, 0.75, w));
        c += vec3(0.25, 1.0, 0.85) * smoothstep(0.72, 0.9, w) * (0.35 + 0.65 * uNight);      // 물빛 반짝임
        c = mix(c, mix(vec3(0.95, 0.8, 0.85), vec3(0.25, 0.3, 0.65), uNight), fr * 0.7);
        gl_FragColor = vec4(c, mix(0.78, 0.92, fr));
      }`,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(W.lake.r * 1.6, 64), mat); m.rotation.x = -Math.PI / 2; m.position.set(W.lake.x, W.water, W.lake.z); m.name = 'water'; G.scene.add(m);
}

/* ───── 식생 · 바위 : 인스턴싱 ───── */
function fixMat(m, glow, leafOnly, gk) {
  m = m.clone(); if (m.map) m.map.anisotropy = 4;
  if (m.transparent || m.alphaTest > 0 || (m.map && m.name && /leav|leaf|flower|petal|grass|fern|plant/i.test(m.name))) { m.transparent = false; m.alphaTest = 0.45; m.side = THREE.DoubleSide; }
  if (glow && (!leafOnly || m.alphaTest > 0)) { m.emissive = new THREE.Color(glow); m.emissiveMap = m.map; m.emissiveIntensity = 0.0; m.userData.gk = gk || 1; W.glowMats.push(m); }
  m.envMapIntensity = 0.5; return m;
}
function scatter(key, list, opt = {}) {      // list : [{x,y,z,s,ry}]
  const ps = parts(key); if (!ps.length || !list.length) return;
  const CH = 8, cs = W.size / CH, buckets = new Map();
  for (const it of list) { const k = Math.floor((it.x + W.half) / cs) + '_' + Math.floor((it.z + W.half) / cs); (buckets.get(k) || buckets.set(k, []).get(k)).push(it); }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), T = new THREE.Vector3(), E = new THREE.Euler();
  for (const p of ps) {
    const mat = fixMat(p.mat, opt.glow, opt.leafOnly, opt.gk);
    for (const arr of buckets.values()) {
      const im = new THREE.InstancedMesh(p.geo, mat, arr.length);
      arr.forEach((it, i) => { E.set(it.rx || 0, it.ry || 0, it.rz || 0); Q.setFromEuler(E); S.setScalar(it.s); T.set(it.x, it.y, it.z); M.compose(T, Q, S).multiply(p.m); im.setMatrixAt(i, M); });
      im.castShadow = !!opt.shadow; im.receiveShadow = true; im.computeBoundingSphere(); G.scene.add(im); W.veg.push({ im, x: im.boundingSphere.center.x, z: im.boundingSphere.center.z, r: im.boundingSphere.radius, max: opt.max || 700 });
    }
  }
}
function place(r, n, rule) { const out = []; let guard = 0; while (out.length < n && guard++ < n * 30) { const x = (r() * 2 - 1) * (W.limit - 10), z = (r() * 2 - 1) * (W.limit - 10); const it = rule(x, z); if (it) out.push(Object.assign({ x, z, y: hAt(x, z), ry: r() * 6.283 }, it)); } return out; }
const openGround = (x, z, margin = 0) => hAt(x, z) > W.water + 0.8 && slopeAt(x, z) < 0.5 && dist2(x, z, W.arena.x, W.arena.z) > W.arena.r * 0.95 + margin && Math.hypot(x, z) < W.limit - 20;
const forest = (x, z) => fbm(x * 0.011 + 40, z * 0.011 + 40, 3);

function vegetation() {
  const r = rng(77); W.glowMats = []; W.veg = [];
  const q = G.quality;
  // 큰 나무
  const big = place(r, Math.round(70 * q), (x, z) => openGround(x, z, 20) && Math.hypot(x, z) > 45 && forest(x, z) > 0.44 ? { s: 3.0 + r() * 4.2 } : null);
  scatter('island_tree_02', big, { shadow: true, glow: 0x1fae8f, leafOnly: true, gk: 0.5 }); big.forEach(t => W.colliders.push({ x: t.x, z: t.z, r: 0.9 * t.s, big: 1 }));
  const jac = place(r, Math.round(10 * q), (x, z) => openGround(x, z, 30) && Math.hypot(x, z) > 45 && forest(x, z) < 0.52 ? { s: 1.6 + r() * 1.8 } : null);
  scatter('jacaranda_tree', jac, { shadow: true, glow: 0xb06cff, leafOnly: true, gk: 0.9 }); jac.forEach(t => W.colliders.push({ x: t.x, z: t.z, r: 0.7 * t.s, big: 1 }));
  const qv = place(r, Math.round(150 * q), (x, z) => openGround(x, z, 10) && Math.hypot(x, z) > 30 ? { s: 1.4 + r() * 2.6 } : null);
  scatter('quiver_tree_02', qv, { shadow: true }); qv.forEach(t => W.colliders.push({ x: t.x, z: t.z, r: 0.45 * t.s }));
  // 바위
  const bo = place(r, Math.round(120 * q), (x, z) => hAt(x, z) > W.water - 1 && Math.hypot(x, z) > 30 && dist2(x, z, W.arena.x, W.arena.z) > 40 ? { s: 1.5 + Math.pow(r(), 3) * 9, rx: r() * 0.4, rz: r() * 0.4 } : null);
  scatter('namaqualand_boulder_02', bo, { shadow: true, max: 620 });
  bo.forEach(t => { if (t.s > 2.5) W.colliders.push({ x: t.x, z: t.z, r: 0.55 * t.s, big: t.s > 4 ? 1 : 0 }); t.y -= 0.25 * t.s; });
  const rk = place(r, Math.round(160 * q), (x, z) => hAt(x, z) > W.water - 2 ? { s: 0.8 + r() * 2.2 } : null); scatter('rock_moss_set_01', rk, { max: 260 });
  // 풀 · 꽃 (밤에 빛남)
  const low = (key, n, s0, s1, glow, f) => scatter(key, place(r, Math.round(n * q), (x, z) => openGround(x, z) && (!f || f(x, z)) ? { s: s0 + r() * (s1 - s0) } : null), { glow, max: 170 });
  low('fern_02', 2600, 1.2, 2.8, 0x1ad6a0, (x, z) => forest(x, z) > 0.44);
  low('shrub_sorrel_01', 700, 1.5, 3.2, null);
  low('fern_02', 1400, 1.0, 2.2, 0xff4f9a, (x, z) => forest(x, z) > 0.4);
  low('shrub_sorrel_01', 1300, 1.6, 3.4, 0x2bd4ff);
  low('shrub_sorrel_01', 500, 1.2, 2.4, 0x8a7bff);
  low('flower_empodium', 1800, 1.4, 3.0, 0xffd34a, (x, z) => forest(x, z) < 0.55);
  low('dandelion_01', 1500, 1.6, 3.4, 0xfff2a8, (x, z) => forest(x, z) < 0.55);
  low('shrub_04', 380, 1.2, 2.4, null);
}

/* ───── 떠 있는 섬 · 바람꽃(도약대) ───── */
function islands() {
  const defs = [[95, -150, 46, 26], [-190, 120, 58, 34], [330, -260, 74, 40], [-470, -40, 90, 46], [120, 430, 64, 36]];   // x, z, 윗면 높이(지면 기준), 반지름
  const cliff = parts('namaqualand_cliff_02'), cb = bounds('namaqualand_cliff_02'), top = parts('namaqualand_boulder_02'), tb = bounds('namaqualand_boulder_02'), r = rng(5);
  for (const [x, z, up, rad] of defs) {
    const y = hAt(x, z) + up, isl = { x, z, y, r: rad * 0.86 }; W.islands.push(isl);
    const g = new THREE.Group(); g.position.set(x, y, z);
    // 아랫면 : 절벽 바위를 뒤집어 여러 겹 겹침
    for (let k = 0; k < 5; k++) for (const p of cliff) {
      const mm = p.mat.clone(); mm.side = THREE.DoubleSide; const m = new THREE.Mesh(p.geo, mm); const s = (rad * (1.5 - k * 0.2)) / Math.max(cb.size.x, cb.size.z); m.applyMatrix4(p.m);
      const h = new THREE.Group(); h.add(m); h.scale.set(s, -s * (1.4 + k * 0.5), s); h.rotation.y = k * 1.3 + r(); h.position.y = -1.5 - k * rad * 0.16; g.add(h); m.castShadow = true;
    }
    // 윗면 : 납작하게 누른 큰 바위 + 풀 재질
    for (const p of top) { const m = new THREE.Mesh(p.geo, new THREE.MeshStandardMaterial({ map: G.assets.t_leafy_grass, normalMap: G.assets.n_leafy_grass, color: 0xb8f0c8, roughness: 0.95 })); m.material.map.repeat.set(1, 1); m.applyMatrix4(p.m); const h = new THREE.Group(); h.add(m); const s = rad * 2.1 / Math.max(tb.size.x, tb.size.z); h.scale.set(s, s * 0.16, s); h.position.y = -tb.size.y * s * 0.16 * 0.42; g.add(h); m.receiveShadow = true; }
    const tree = clone('island_tree_02'); tree.scale.setScalar(2.2 + r() * 1.5); tree.position.set(rad * 0.25, 0, -rad * 0.2); g.add(tree);
    const chest = clone('treasure_chest'); chest.scale.setScalar(1.6); chest.position.set(-rad * 0.3, 0, rad * 0.15); chest.rotation.y = r() * 6; g.add(chest);
    W.nodes.push({ id: 'chest' + W.islands.length, type: 'chest', x: x - rad * 0.3, z: z + rad * 0.15, y, obj: chest, ready: true, r: 3.2 });
    G.scene.add(g); isl.group = g;
    // 섬 아래 바람꽃
    const a = r() * 6.28, px = x + Math.cos(a) * (rad + 14), pz = z + Math.sin(a) * (rad + 14); addPad(px, pz, Math.sqrt(2 * 34 * (up + 9)), [x - px, z - pz]);
  }
}
function addPad(x, z, power, toward) {
  const y = hAt(x, z), f = clone('flower_gazania'); f.scale.setScalar(9); f.position.set(x, y, z);
  f.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0x35ffd0); o.material.emissiveMap = o.material.map; o.material.emissiveIntensity = 1.6; o.material.alphaTest = 0.4; o.material.side = THREE.DoubleSide; } });
  const l = new THREE.PointLight(0x35ffd0, 22, 26, 1.6); l.position.set(0, 0.35, 0); f.add(l); G.scene.add(f);
  const d = Math.hypot(toward[0], toward[1]) || 1; W.pads.push({ x, z, y, r: 2.6, power, dir: [toward[0] / d, toward[1] / d], dist: d, obj: f });
}

/* ───── 자원 : 열매 덤불 · 그루터기(나무) · 돌 · 빛꽃(빛가루) ───── */
function resources() {
  const r = rng(303); let id = 0;
  const add = (type, key, n, s0, s1, rule, deco) => {
    const near = Math.round(n * 0.35);
    for (let i = 0, guard = 0; i < n && guard < n * 60; guard++) {
      const rad = i < near ? 40 + r() * 150 : 180 + r() * 470, a = r() * 6.283, x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (!openGround(x, z, 15) || (rule && !rule(x, z))) continue;
      const obj = clone(key), s = s0 + r() * (s1 - s0); obj.scale.setScalar(s); obj.position.set(x, hAt(x, z), z); obj.rotation.y = r() * 6.28;
      obj.traverse(o => { if (o.isMesh) { o.castShadow = true; if (o.material.alphaTest === 0 && o.material.transparent) { o.material = o.material.clone(); o.material.transparent = false; o.material.alphaTest = 0.45; o.material.side = THREE.DoubleSide; } } });
      const node = { id: type + (id++), type, x, z, y: obj.position.y, obj, ready: true, r: type === 'wood' ? 2.4 : 2.0, hp: 3, s };
      if (deco) deco(node, obj, s); G.scene.add(obj); W.nodes.push(node); i++;
      if (type === 'wood' || type === 'stone') W.colliders.push({ x, z, r: (type === 'wood' ? 0.55 : 0.75) * s, node });
    }
  };
  add('fruit', 'shrub_04', 46, 2.6, 3.4, null, (node, obj, s) => {
    node.fruits = []; for (let k = 0; k < 4; k++) { const f = clone('food_pomegranate_01'); f.scale.setScalar(3.2 / s * 1.0); const a = k * 1.57 + r(); f.position.set(Math.cos(a) * 0.22, 0.26 + r() * 0.1, Math.sin(a) * 0.22);
      f.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xff3b6b); o.material.emissiveIntensity = 0.9; } }); obj.add(f); node.fruits.push(f); }
  });
  add('wood', 'tree_stump_01', 30, 1.6, 2.4); add('wood', 'dead_tree_trunk_02', 26, 1.3, 2.0);
  add('stone', 'rock_09', 44, 1.4, 2.4);
  add('dust', 'flower_gazania', 50, 3.0, 4.2, null, (node, obj) => { obj.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xffc44a); o.material.emissiveMap = o.material.map; o.material.emissiveIntensity = 1.5; o.material.alphaTest = 0.4; o.material.side = THREE.DoubleSide; } }); });
}

/* ───── 반딧불이 · 빛 포자 ───── */
function motes() {
  const n = Math.round(1400 * G.quality), pos = new Float32Array(n * 3), seed = new Float32Array(n), r = rng(9);
  for (let i = 0; i < n; i++) { const x = (r() * 2 - 1) * W.limit, z = (r() * 2 - 1) * W.limit; pos[i * 3] = x; pos[i * 3 + 1] = hAt(x, z) + 0.6 + r() * 7; pos[i * 3 + 2] = z; seed[i] = r(); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: W.uniforms.uTime, uNight: W.uniforms.uNight },
    vertexShader: `attribute float aSeed; uniform float uTime; varying float vS; void main(){ vS = aSeed; vec3 p = position; p.x += sin(uTime * (0.3 + aSeed) + aSeed * 50.0) * 1.6; p.y += sin(uTime * 0.7 + aSeed * 30.0) * 0.9; p.z += cos(uTime * (0.25 + aSeed * 0.7) + aSeed * 80.0) * 1.6;
      vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (60.0 + aSeed * 90.0) / -mv.z * (0.6 + 0.4 * sin(uTime * 2.0 + aSeed * 90.0)); }`,
    fragmentShader: `varying float vS; uniform float uNight; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); vec3 c = mix(vec3(0.3, 1.0, 0.8), vec3(1.0, 0.85, 0.4), step(0.6, vS)); c = mix(c, vec3(0.8, 0.5, 1.0), step(0.88, vS)); gl_FragColor = vec4(c * a * 1.6, a * mix(0.25, 1.0, uNight)); }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; G.scene.add(pts);
}

/* ───── 충돌 격자 ───── */
function buildGrid() { const cs = 24; W.grid = new Map(); W.gcs = cs; for (const c of W.colliders) { const k = Math.floor(c.x / cs) + '_' + Math.floor(c.z / cs); (W.grid.get(k) || W.grid.set(k, []).get(k)).push(c); } }
export function nearColliders(x, z, rad = 4) { const cs = W.gcs, out = [], i0 = Math.floor((x - rad) / cs), i1 = Math.floor((x + rad) / cs), j0 = Math.floor((z - rad) / cs), j1 = Math.floor((z + rad) / cs); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = W.grid.get(i + '_' + j); if (a) for (const c of a) if (!c.off) out.push(c); } return out; }
export function addCollider(c) { W.colliders.push(c); const k = Math.floor(c.x / W.gcs) + '_' + Math.floor(c.z / W.gcs); (W.grid.get(k) || W.grid.set(k, []).get(k)).push(c); return c; }

/* ───── 조명 · 낮밤 ───── */
let sun, hemi;
function lights() {
  hemi = new THREE.HemisphereLight(0x9cc0ff, 0x2a4a44, 1.5); G.scene.add(hemi);
  sun = new THREE.DirectionalLight(0xbfd4ff, 2.2); sun.castShadow = true; const s = sun.shadow; s.mapSize.set(2048, 2048); s.camera.near = 1; s.camera.far = 260; const e = 70; s.camera.left = -e; s.camera.right = e; s.camera.top = e; s.camera.bottom = -e; s.bias = -0.0006; s.normalBias = 0.6;
  G.scene.add(sun); G.scene.add(sun.target);
  G.scene.fog = new THREE.FogExp2(0x1d4a66, 0.0016);
  if (G.assets.env) { G.scene.environment = G.assets.env; G.scene.environmentIntensity = 0.45; }
}
const cNightFog = new THREE.Color(0x0c2c3c), cDuskFog = new THREE.Color(0xd79a9a), cNightSun = new THREE.Color(0xa9c6ff), cDuskSun = new THREE.Color(0xffc9a0), tmp = new THREE.Color();
export function updateWorld(dt, focus) {
  W.uniforms.uTime.value += dt;
  const cyc = (W.uniforms.uTime.value / 420 + 0.35) % 1, night = clamp(0.9 + 0.16 * Math.sin(cyc * Math.PI * 2 + 0.6), 0.72, 1);    // 대부분 밤, 가끔 황혼
  W.uniforms.uNight.value = night;
  G.scene.fog.color.copy(tmp.copy(cDuskFog).lerp(cNightFog, night)); sun.color.copy(tmp.copy(cDuskSun).lerp(cNightSun, night)); sun.intensity = lerp(3.4, 1.5, night);
  hemi.intensity = lerp(2.2, 0.8, night); hemi.color.setHex(0x7fa0ff);
  for (const m of W.glowMats) m.emissiveIntensity = (0.2 + night * 2.2) * (m.userData.gk || 1);
  if (focus && (G.frame % 20) === 0) for (const v of W.veg) v.im.visible = Math.hypot(v.x - focus.x, v.z - focus.z) < v.max + v.r;
  if (focus) { sun.target.position.copy(focus); sun.position.set(focus.x - 55, focus.y + 95, focus.z - 85); W.skyMesh.position.set(focus.x, 0, focus.z); }
}

export function buildWorld() {
  buildHeight(); lights(); sky(); terrain(); water(); islands(); vegetation(); resources(); motes(); buildGrid();
}
