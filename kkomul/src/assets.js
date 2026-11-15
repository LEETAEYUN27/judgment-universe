// 소재 불러오기 : glb 모델 · PBR 질감 · 환경 조명
import { THREE, G } from './g.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export const MODELS = ['jacaranda_tree', 'quiver_tree_02', 'island_tree_02', 'dead_tree_trunk_02', 'tree_stump_01', 'fern_02', 'shrub_sorrel_01', 'flower_empodium', 'dandelion_01', 'shrub_04', 'flower_gazania', 'rock_moss_set_01', 'namaqualand_boulder_02', 'rock_09', 'namaqualand_cliff_02', 'treasure_chest', 'Lantern_01', 'wooden_axe', 'food_pomegranate_01', 'planter_box_01', 'barrel_stove', 'hut'];
export const CHARS = [['ssak', '새싹콩'], ['dotori', '도토리곰'], ['dorong', '도롱'], ['ppiyak', '삐약솜'], ['beoseot', '버섯동'], ['gureum', '구름양']];
const TEX = ['leafy_grass', 'forrest_ground_01', 'cliff_side', 'coast_sand_01', 'mossy_rock'];

export async function loadAll(onProgress) {
  const gl = new GLTFLoader(), tl = new THREE.TextureLoader(); let done = 0;
  const jobs = [];
  const total = MODELS.length + CHARS.length + 1 + TEX.length * 2 + 1;
  const tick = () => onProgress(++done / total);
  const glb = (key, url) => jobs.push(gl.loadAsync(url).then(g => { G.assets[key] = g.scene; tick(); }).catch(e => { console.warn('모델 실패', key, e); tick(); }));
  MODELS.forEach(m => glb(m, `assets/models/${m}.glb`));
  CHARS.forEach(([c]) => glb('ch_' + c, `assets/chars/${c}.glb`));
  glb('agwi', 'assets/mon/agwi.glb');
  const tex = (key, url, srgb) => jobs.push(tl.loadAsync(url).then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; G.assets[key] = t; tick(); }).catch(() => tick()));
  TEX.forEach(t => { tex('t_' + t, `assets/tex/${t}_diff.jpg`, true); tex('n_' + t, `assets/tex/${t}_nor.jpg`, false); });
  jobs.push(new RGBELoader().loadAsync('assets/sky/env_night.hdr').then(h => { h.mapping = THREE.EquirectangularReflectionMapping; G.assets.env = h; tick(); }).catch(() => tick()));
  await Promise.all(jobs);
}

// 모델을 인스턴싱용 조각(기하 · 재질 · 자체 변환)으로 풀어 줌
export function parts(key) {
  const src = G.assets[key]; if (!src) return [];
  src.updateMatrixWorld(true); const out = [];
  src.traverse(o => { if (o.isMesh) out.push({ geo: o.geometry, mat: o.material, m: o.matrixWorld.clone() }); });
  return out;
}
export function clone(key) { const s = G.assets[key]; return s ? s.clone(true) : new THREE.Group(); }
// 모델의 크기 · 바닥 높이
export function bounds(key) { const b = new THREE.Box3().setFromObject(G.assets[key]); return { min: b.min, max: b.max, size: b.getSize(new THREE.Vector3()) }; }
