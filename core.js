/* 주식 판단 연습장 — 데이터·지표·점수·채점 계산부 (화면과 분리, Node 에서도 검증 가능) */
(function (root) {
  'use strict';
  const SV = { idx: null, bySym: {}, tail: { asof: 0, rows: {} }, model: null, cache: {}, live: {}, base: './data/' };

  const fetchJSON = async (u) => { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error('데이터를 읽지 못했습니다 (' + r.status + ')'); return r.json(); };

  SV.init = async function () {
    const [idx, tail, model] = await Promise.all([fetchJSON(SV.base + 'idx.json'), fetchJSON(SV.base + 'tail.json').catch(() => ({ asof: 0, rows: {} })), fetchJSON(SV.base + 'model.json')]);
    SV.dipModel = await fetchJSON(SV.base + 'dip.json').catch(() => null);
    SV.idx = idx.list; SV.built = idx.built; SV.tail = tail; SV.model = model;
    SV.idx.forEach(x => { SV.bySym[x.s] = x; });
    return SV;
  };
  SV.info = (s) => SV.bySym[s] || null;
  SV.name = (s) => { const i = SV.bySym[s]; return i ? (i.k || i.n) : s; };
  SV.market = (s) => { const i = SV.bySym[s]; if (i) return i.m; return /\.(KS|KQ)$/.test(s) ? 'KR' : 'US'; };
  SV.cur = (s) => SV.market(s) === 'KR' ? 'KRW' : (s === '^KS11' || s === '^KQ11' ? 'PT' : 'USD');

  /* 이력 : 기본 파일 + 꼬리(최근 갱신분) 병합 */
  SV.hist = function (s) {
    if (SV.cache[s]) return SV.cache[s];
    const i = SV.bySym[s];
    if (!i) return Promise.reject(new Error('이력 데이터가 아직 없는 종목입니다'));
    const src = i.db ? (SV.extHist ? SV.extHist(i.f) : Promise.reject(new Error('이력 저장소에 연결되지 않았습니다'))) : fetchJSON(SV.base + 'h/' + i.f + '.json');
    SV.cache[s] = src.then(H => SV.mergeTail(H, SV.tail.rows[s]));
    SV.cache[s].catch(() => { delete SV.cache[s]; });
    return SV.cache[s];
  };
  SV.mergeTail = function (H, rows) {
    if (!rows) return H;
    for (const r of rows) {
      const n = H.d.length, last = H.d[n - 1];
      if (r[0] > last) { H.d.push(r[0]); H.o.push(r[1]); H.h.push(r[2]); H.l.push(r[3]); H.c.push(r[4]); H.v.push(r[5]); }
      else if (r[0] === last) { H.o[n - 1] = r[1]; H.h[n - 1] = r[2]; H.l[n - 1] = r[3]; H.c[n - 1] = r[4]; H.v[n - 1] = r[5]; }
    }
    return H;
  };
  /* 날짜(YYYYMMDD 정수) 이하에서 가장 가까운 거래일 위치 */
  SV.at = function (H, d) { let lo = 0, hi = H.d.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (H.d[m] <= d) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
  SV.atOrAfter = function (H, d) { let lo = 0, hi = H.d.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (H.d[m] >= d) { a = m; hi = m - 1; } else lo = m + 1; } return a; };

  /* ───── 지표 ───── */
  const sma = (a, n) => { const o = new Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
  const ema = (a, n) => { const k = 2 / (n + 1), o = new Array(a.length); o[0] = a[0]; for (let i = 1; i < a.length; i++) o[i] = a[i] * k + o[i - 1] * (1 - k); return o; };
  const rmax = (a, n) => { const o = new Array(a.length).fill(NaN); for (let i = n - 1; i < a.length; i++) { let m = -Infinity; for (let j = i - n + 1; j <= i; j++) if (a[j] > m) m = a[j]; o[i] = m; } return o; };
  const rmin = (a, n) => { const o = new Array(a.length).fill(NaN); for (let i = n - 1; i < a.length; i++) { let m = Infinity; for (let j = i - n + 1; j <= i; j++) if (a[j] < m) m = a[j]; o[i] = m; } return o; };
  const rstd = (a, n) => { const o = new Array(a.length).fill(NaN); for (let i = n - 1; i < a.length; i++) { let s = 0, q = 0; for (let j = i - n + 1; j <= i; j++) s += a[j]; const mu = s / n; for (let j = i - n + 1; j <= i; j++) q += (a[j] - mu) * (a[j] - mu); o[i] = Math.sqrt(q / (n - 1)); } return o; };
  SV.sma = sma; SV.ema = ema;

  SV.indicators = function (H) {
    if (H._ind) return H._ind;
    const c = H.c, h = H.h, l = H.l, v = H.v, n = c.length, I = {};
    const rsi = new Array(n).fill(NaN); let up = NaN, dn = NaN;
    for (let i = 1; i < n; i++) { const d = c[i] - c[i - 1], g = d > 0 ? d : 0, ls = d < 0 ? -d : 0; if (i === 1) { up = g; dn = ls; } else { up = up * 13 / 14 + g / 14; dn = dn * 13 / 14 + ls / 14; } rsi[i] = dn === 0 ? NaN : 100 - 100 / (1 + up / dn); }
    I.rsi = rsi;
    const m20 = sma(c, 20), m60 = sma(c, 60), m200 = sma(c, 200), hi252 = rmax(c, 252), sd20 = rstd(c, 20);
    I.m20 = m20; I.m60 = m60; I.m200 = m200;
    const v20 = sma(v, 20), v5 = sma(v, 5), v60 = sma(v, 60);
    const e12 = ema(c, 12), e26 = ema(c, 26), macd = c.map((_, i) => e12[i] - e26[i]), sig = ema(macd, 9);
    const tr = c.map((_, i) => i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))), atr = sma(tr, 14);
    const h20 = rmax(h, 20), l20 = rmin(l, 20);
    const f = (k, fn) => { I[k] = new Array(n); for (let i = 0; i < n; i++) I[k][i] = fn(i); };
    f('dd252', i => c[i] / hi252[i] - 1);
    f('d20', i => c[i] / m20[i] - 1); f('d60', i => c[i] / m60[i] - 1); f('d200', i => c[i] / m200[i] - 1);
    f('slope200', i => i >= 60 ? m200[i] / m200[i - 60] - 1 : NaN);
    f('volr', i => i >= 1 ? v[i] / v20[i - 1] : NaN);
    f('volr5', i => i >= 5 ? v5[i] / v60[i - 5] : NaN);
    f('ret1', i => i >= 1 ? c[i] / c[i - 1] - 1 : NaN); f('ret5', i => i >= 5 ? c[i] / c[i - 5] - 1 : NaN); f('ret20', i => i >= 20 ? c[i] / c[i - 20] - 1 : NaN);
    f('bb', i => (c[i] - m20[i]) / (2 * sd20[i]));
    f('macdh', i => (macd[i] - sig[i]) / c[i]);
    f('atr', i => atr[i] / c[i]);
    f('pos20', i => (c[i] - l20[i]) / (h20[i] - l20[i]));
    H._ind = I; return I;
  };
  SV.marketInd = function (M) {
    if (M._mk) return M._mk;
    const c = M.c, n = c.length, m200 = sma(c, 200), hi = rmax(c, 252), K = { mk200: [], mk20: [], mkdd: [] };
    for (let i = 0; i < n; i++) { K.mk200[i] = c[i] / m200[i] - 1; K.mk20[i] = i >= 20 ? c[i] / c[i - 20] - 1 : NaN; K.mkdd[i] = c[i] / hi[i] - 1; }
    M._mk = K; return K;
  };
  SV.mkSym = (s) => SV.market(s) === 'KR' ? '^KS11' : 'SPY';

  /* 특정 위치(i)의 특성값 묶음 */
  SV.features = function (H, M, i) {
    const I = SV.indicators(H), K = SV.marketInd(M), j = SV.at(M, H.d[i]), F = {};
    for (const k of ['rsi', 'dd252', 'd20', 'd60', 'd200', 'slope200', 'volr', 'volr5', 'ret1', 'ret5', 'ret20', 'bb', 'macdh', 'atr', 'pos20']) F[k] = I[k][i];
    F.mk200 = j >= 0 ? K.mk200[j] : NaN; F.mk20 = j >= 0 ? K.mk20[j] : NaN; F.mkdd = j >= 0 ? K.mkdd[j] : NaN;
    return F;
  };
  const OPS = { '<=': (a, b) => a <= b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '>': (a, b) => a > b };
  /* 매수 타점 점수 : 10년 백테스트에서 두 구간 모두 통과한 조합의 충족 여부로 산출 */
  /* 저점 매수 판정 (60거래일 기준) : 종목 급락 정도 4단계 × 시장 상태 3단계 = 12칸의 과거 결과표에서 지금 칸을 찾음 */
  SV.dip = function (F, mkt) {
    const M = SV.dipModel && SV.dipModel[mkt === 'KR' ? 'KR' : 'US']; if (!M || !F || !Number.isFinite(F.dd252) || !Number.isFinite(F.mkdd) || !Number.isFinite(F.rsi)) return null;
    const sharp = F.ret20 <= -0.15 || F.ret5 <= -0.08 || (F.dd252 <= -0.20 && F.d20 <= -0.07), mild = F.rsi <= 30 || F.bb <= -1;
    const lv = sharp && F.dd252 <= -0.30 ? 3 : sharp ? 2 : mild ? 1 : 0, ms = F.mkdd <= -0.10 ? 2 : F.mkdd <= -0.05 ? 1 : 0, c = M.tb['' + lv + ms], b = M.base, bh = M.baseH;
    const why = []; if (F.ret20 <= -0.15) why.push('20일간 ' + SV.pct(F.ret20, 0)); if (F.ret5 <= -0.08) why.push('5일간 ' + SV.pct(F.ret5, 0)); if (F.dd252 <= -0.20 && F.d20 <= -0.07) why.push('20일선 대비 ' + SV.pct(F.d20, 0)); if (!sharp && F.rsi <= 30) why.push('RSI ' + F.rsi.toFixed(0)); if (!sharp && F.bb <= -1) why.push('볼린저 하단 이탈');
    let k = 'none';
    if (lv >= 2 && c && c.n >= 300) { if (c.w60 >= b.w60 + 0.03 && c.hw60 >= bh.w60 && c.m60 > b.m60) k = 'good'; else if (c.w60 <= b.w60 - 0.04) k = 'bad'; else k = 'mid'; }
    return { lv, ms, cell: c, base: b, baseH: bh, k, why, dd: F.dd252, mkdd: F.mkdd, tb: M.tb,
      lvName: ['평상', '과매도', '급락', '급락 + 깊은 조정'][lv], msName: ['고점 부근', '고점 대비 -5~-10%', '고점 대비 -10% 이하'][ms],
      label: k === 'good' ? '반등 우위' : k === 'bad' ? '불리 · 떨어지는 칼' : k === 'mid' ? '우위 불분명' : '급락 구간 아님' };
  };
  /* 저점 매수 판정용 시장 낙폭 : 미국은 나스닥 종합, 한국은 코스피의 1년 고점 대비 (종가 기준) */
  SV.dipFor = async function (s, H, F) {
    const mkt = SV.market(s); let N; try { N = await SV.hist(mkt === 'KR' ? '^KS11' : '^IXIC'); } catch (e) { return null; }
    const d = H.d[H.d.length - 1]; let j = N.d.length - 1; while (j > 0 && N.d[j] > d) j--;
    let hi = 0; for (let k = Math.max(0, j - 251); k <= j; k++) if (N.c[k] > hi) hi = N.c[k];
    return SV.dip(Object.assign({}, F, { mkdd: N.c[j] / hi - 1 }), mkt);
  };
  SV.scoreFrom = function (F, mkt) {
    const Mo = SV.model[mkt === 'KR' ? 'KR' : 'US'];
    const on = Mo.conds.map(cd => cd.c.every(([k, op, val]) => Number.isFinite(F[k]) && OPS[op](F[k], val)));
    let up = 0, dn = 0, cu = 0, cd = 0; const good = [], bad = [];
    for (const g of Mo.good) if (g.i.every(x => on[x])) { cu++; if (g.lift > up) up = g.lift; good.push(g); }
    for (const b of Mo.bad) if (b.i.every(x => on[x])) { cd++; if (b.lift < dn) dn = b.lift; bad.push(b); }
    const score = Math.max(0, Math.min(100, 50 + (up + dn) * 220 + Math.min(cu, 10) * 0.8 - Math.min(cd, 10) * 0.8));
    const bucket = Mo.buckets.find(b => score >= b.lo && score < b.hi) || Mo.buckets[Mo.buckets.length - 1];
    const valid = Number.isFinite(F.dd252) && Number.isFinite(F.d200) && Number.isFinite(F.mk200);
    return { score: Math.round(score * 10) / 10, bucket, good, bad, on, conds: Mo.conds, base: Mo.base, valid, F };
  };
  SV.scoreAt = async function (s, date) {
    const [H, M] = await Promise.all([SV.hist(s), SV.hist(SV.mkSym(s))]);
    const i = date ? SV.at(H, date) : H.d.length - 1;
    if (i < 0) return null;
    const r = SV.scoreFrom(SV.features(H, M, i), SV.market(s)); r.date = H.d[i]; r.i = i; return r;
  };
  SV.grade = (sc) => sc >= 85 ? { k: 'buy', t: '매수 우위' } : sc <= 35 ? { k: 'avoid', t: '주의' } : { k: 'flat', t: '중립' };

  /* ───── 가상 매매·예측 채점 ─────
     trade : { s, side:'buy'|'sell', date(YYYYMMDD), amount, price? }  → 진입가는 해당 거래일 종가 */
  SV.HORIZONS = [5, 20, 60];
  SV.evalTrade = async function (t) {
    const H = await SV.hist(t.s), B = await SV.hist(SV.market(t.s) === 'KR' ? '^KS11' : 'QQQ');
    const i = SV.atOrAfter(H, t.date);
    if (i < 0) return { pending: true, reason: '해당 날짜의 시세가 아직 반영되지 않았습니다' };
    const entry = t.price || H.c[i], n = H.c.length - 1, sgn = t.side === 'sell' ? -1 : 1;
    const bi = SV.at(B, H.d[i]), bench = (k) => { const bj = SV.at(B, H.d[k]); return bi >= 0 && bj >= 0 ? B.c[bj] / B.c[bi] - 1 : NaN; };
    const R = { i, entryDate: H.d[i], entry, last: H.c[n], lastDate: H.d[n], days: n - i, side: t.side, hz: {} };
    R.ret = sgn * (H.c[n] / entry - 1); R.raw = H.c[n] / entry - 1; R.bench = bench(n);
    let mx = -Infinity, mn = Infinity, mxI = i, mnI = i;
    for (let k = i; k <= n; k++) { const r = H.c[k] / entry - 1; if (r > mx) { mx = r; mxI = k; } if (r < mn) { mn = r; mnI = k; } }
    R.best = sgn > 0 ? mx : -mn; R.worst = sgn > 0 ? mn : -mx; R.bestDate = H.d[sgn > 0 ? mxI : mnI]; R.worstDate = H.d[sgn > 0 ? mnI : mxI];
    for (const hz of SV.HORIZONS) if (i + hz <= n) { const r = H.c[i + hz] / entry - 1; R.hz[hz] = { ret: sgn * r, raw: r, bench: bench(i + hz), win: sgn * r > 0, date: H.d[i + hz] }; }
    R.path = { d: H.d.slice(i), r: H.c.slice(i).map(x => x / entry - 1), b: H.d.slice(i).map((_, k) => bench(i + k)) };
    R.judged = R.hz[20] ? R.hz[20] : (R.hz[5] || null); R.final = !!R.hz[20];
    if (t.amount) R.pnl = t.amount * R.ret;
    return R;
  };
  /* pred : { s, dir:'up'|'down', from(YYYYMMDD), days, conf } */
  SV.evalPred = async function (p) {
    const H = await SV.hist(p.s), i = SV.atOrAfter(H, p.from);
    if (i < 0) return { pending: true };
    const n = H.c.length - 1, k = i + p.days, base = p.base || H.c[i];
    if (k > n) return { pending: true, base, now: H.c[n] / base - 1, left: k - n, baseDate: H.d[i] };
    const r = H.c[k] / base - 1; return { pending: false, base, ret: r, hit: p.dir === 'up' ? r > 0 : r < 0, date: H.d[k], baseDate: H.d[i] };
  };

  /* 급등락 감지 : 최근 nDays 안에서 |등락률| ≥ th */
  SV.bigMoves = function (H, nDays, th) { const o = [], n = H.c.length; for (let i = Math.max(1, n - nDays); i < n; i++) { const r = H.c[i] / H.c[i - 1] - 1; if (Math.abs(r) >= th) o.push({ date: H.d[i], pct: r, vol: H.v[i] }); } return o; };

  /* 표기 */
  SV.fmtDate = (d) => { d = String(d); return d.slice(0, 4) + '. ' + (+d.slice(4, 6)) + '. ' + (+d.slice(6, 8)); };
  SV.fmtDateShort = (d) => { d = String(d); return (+d.slice(4, 6)) + '. ' + (+d.slice(6, 8)); };
  SV.iso = (d) => { d = String(d); return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8); };
  SV.fromISO = (s) => +String(s).replace(/-/g, '');
  SV.pct = (x, dg) => !Number.isFinite(x) ? '–' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(dg == null ? 1 : dg) + '%';
  SV.price = (x, s) => { if (!Number.isFinite(x)) return '–'; const m = SV.market(s); if (m === 'KR') return Math.round(x).toLocaleString('ko-KR') + '원'; const i = SV.bySym[s]; if (i && i.m === 'IX') return x.toLocaleString('en-US', { maximumFractionDigits: 2 }); return '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: x < 5 ? 4 : 2 }); };
  SV.money = (x, cur) => { if (!Number.isFinite(x)) return '–'; const s = x < 0 ? '−' : x > 0 ? '+' : ''; const a = Math.abs(x); return cur === 'KRW' ? s + Math.round(a).toLocaleString('ko-KR') + '원' : s + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 }); };

  root.SV = SV;
  if (typeof module !== 'undefined') module.exports = SV;
})(typeof window !== 'undefined' ? window : globalThis);
