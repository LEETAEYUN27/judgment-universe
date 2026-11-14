/* 판단 유니버스 — 화면부 */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const cls = x => x > 0 ? 'up' : x < 0 ? 'down' : 'mute';
  const todayInt = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  const S = { tab: 'env', watch: [], issues: [], moves: [], trades: [], alerts: [], fund: {}, brief: null, quotes: null, cal: [], loaded: {}, sel: null, issueFilter: 'all', openIssue: null, meta: {}, storeNote: null, q: '', remote: null };
  let SVok = false;

  /* ───────── 저장소 : 깃허브 저장소 (live 가지 = 자동 수집, state 가지 = 내 기록) ───────── */
  const GH = (() => {
    let owner = 'LEETAEYUN27', repo = 'judgment-universe';
    const m = location.hostname.match(/^([^.]+)\.github\.io$/); if (m) { owner = m[1]; repo = location.pathname.split('/')[1] || repo; }
    const dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname), api = 'https://api.github.com/repos/' + owner + '/' + repo;
    const tok = () => { try { return localStorage.getItem('ju_token') || ''; } catch (e) { return ''; } };
    const hdr = raw => ({ Authorization: 'Bearer ' + tok(), Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
    const enc = str => { const u = new TextEncoder().encode(str); let o = ''; for (let i = 0; i < u.length; i += 8192) o += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(o); };
    const dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\s/g, '')), c => c.charCodeAt(0)));
    const fail = (code, st) => { const e = new Error(code + ' ' + (st || '')); e.code = code; return e; };
    let bad = false; const devState = {};
    async function read(branch, path) {
      let r;
      if (dev) { if (branch === 'state' && devState[path]) return devState[path]; r = await fetch('./_dev/' + branch + '/' + path, { cache: 'no-store' }); }
      else {
        if (tok() && !bad) { r = await fetch(api + '/contents/' + path + '?ref=' + branch, { headers: hdr(true), cache: 'no-store' }); if (r.status === 401) { bad = true; r = null; } }
        if (!r) r = await fetch('https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + branch + '/' + path + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
      }
      if (r.status === 404) return null; if (!r.ok) throw fail('read', r.status); return r.json();
    }
    async function mutate(path, fn, msg) {
      if (dev) { const cur = await read('state', path).catch(() => null); devState[path] = fn(cur); return devState[path]; }
      if (!tok()) throw fail('notoken');
      for (let k = 0; k < 3; k++) {
        const g = await fetch(api + '/contents/' + path + '?ref=state', { headers: hdr(false), cache: 'no-store' }); let sha, cur = null;
        if (g.status === 200) { const j = await g.json(); sha = j.sha; try { cur = JSON.parse(dec(j.content)); } catch (e) { cur = null; } }
        else if (g.status === 401 || g.status === 403) throw fail('auth', g.status); else if (g.status !== 404) throw fail('read', g.status);
        const next = fn(cur), body = { message: msg || '기록 갱신', content: enc(JSON.stringify(next)), branch: 'state' }; if (sha) body.sha = sha;
        const p = await fetch(api + '/contents/' + path, { method: 'PUT', headers: hdr(false), body: JSON.stringify(body) });
        if (p.ok) return next; if (p.status === 401 || p.status === 403 || p.status === 404) throw fail('auth', p.status); if (p.status !== 409 && p.status !== 422) throw fail('write', p.status);
      }
      throw fail('write', 'conflict');
    }
    async function check(t) {
      const r = await fetch(api, { headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!r.ok) return '이 키로는 저장소에 접근할 수 없습니다 (' + r.status + '). 키를 다시 확인해 주십시오.';
      const j = await r.json(); return j.permissions && j.permissions.push ? null : '키는 맞지만 쓰기 권한이 없습니다. 키를 만들 때 Contents 권한을 「Read and write」로 지정해 주십시오.';
    }
    async function kick() { if (dev || !tok()) return false; try { const r = await fetch(api + '/actions/workflows/fast.yml/dispatches', { method: 'POST', headers: hdr(false), body: JSON.stringify({ ref: 'main' }) }); return r.status === 204; } catch (e) { return false; } }
    return { owner, repo, dev, tok, read, mutate, check, kick, isBad: () => bad, reset: () => { bad = false; } };
  })();
  const Store = {
    user: [], auto: [],
    canWrite() { return GH.dev || (!!GH.tok() && !GH.isBad()); },
    async init() {
      SV.extHist = f => GH.read('live', 'hist/' + f + '.json').then(x => { if (!x) throw new Error('이력 없음'); return x; });
      await Promise.all([this.loadState(), this.loadLive(true)]);
      setInterval(() => { if (!document.hidden) this.loadLive(false); }, 60000);
      setInterval(() => { if (!document.hidden) this.loadLive(true); }, 15 * 60000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.loadLive(true); this.loadState(); } });
    },
    note() { S.storeNote = this.canWrite() ? null : (GH.isBad() ? '연결 키가 만료되었거나 맞지 않습니다. 오른쪽 위 시각 표시를 눌러 새 키를 넣어 주십시오.' : '보기 전용 상태입니다. 종목 추가 · 가격 알림 · 가상 매매를 저장하려면 오른쪽 위 시각 표시를 눌러 연결 키를 한 번 넣어 주십시오.'); },
    mergeMoves() { const m = {}; this.auto.forEach(x => { m[x.id] = x; }); this.user.forEach(x => { m[x.id] = x; }); S.moves = Object.values(m); },
    async loadState() {
      try {
        const [w, t, mv] = await Promise.all([GH.read('state', 'watch.json'), GH.read('state', 'trades.json'), GH.read('state', 'moves.json')]);
        S.watch = (w && w.list) || []; S.trades = (t && t.list) || []; this.user = (mv && mv.list) || []; this.mergeMoves();
        for (const k of ['watch', 'trades', 'moves']) S.loaded[k] = true; this.note();
      } catch (e) { S.storeNote = '기록 저장소를 읽지 못했습니다. 잠시 뒤 자동으로 다시 시도합니다.'; }
      preload(); render();
    },
    async loadLive(full) {
      try {
        const F = await GH.read('live', 'fast.json');
        if (F) {
          S.quotes = { at: F.at, q: F.q || {} }; S.open = F.open || {}; S.disc = F.disc || {}; let seen = ''; try { seen = localStorage.getItem('ju_seen') || ''; } catch (e) { }
          S.alerts = (F.alerts || []).map(a => Object.assign({}, a, { seen: (a.at || '') <= seen })); S.loaded.alerts = S.loaded.quotes = true; applyQuotes();
        }
      } catch (e) { }
      if (full) {
        try {
          const [D, FU, IX] = await Promise.all([GH.read('live', 'daily.json'), GH.read('live', 'fund.json'), GH.read('live', 'idxx.json')]);
          if (IX && IX.list) { let add = 0; IX.list.forEach(it => { if (!SV.bySym[it.s]) { const x = Object.assign({}, it); SV.idx.push(x); SV.bySym[x.s] = x; delete S.meta[x.s]; add++; } }); if (add) preload(); }
          if (FU) S.fund = FU;
          if (D) {
            S.issues = D.issues || []; S.brief = D.brief || null; S.cal = D.cal || []; this.auto = D.moves || []; this.mergeMoves();
            let n = 0; for (const k in (D.tail || {})) n += D.tail[k].length; const key = (D.asof || 0) + ':' + n;
            if (key !== this.tailKey) { this.tailKey = key; SV.tail = { asof: D.asof || 0, rows: D.tail || {} }; SV.cache = {}; S.meta = {}; for (const k in loading) delete loading[k]; evalKey = ''; preload(); }
          }
          for (const k of ['issues', 'fund', 'brief', 'cal']) S.loaded[k] = true;
        } catch (e) { }
      }
      liveUI(); calcRisk(); render();
    },
    fail(e) { if (e && (e.code === 'notoken' || e.code === 'auth')) { toast(e.code === 'auth' ? '연결 키가 맞지 않습니다. 설정에서 다시 넣어 주십시오.' : '저장하려면 연결 키가 필요합니다.'); openSettings(); } else toast('저장하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.'); },
    async put(col, id, data) {
      const row = Object.assign({ id }, data), up = cur => { const list = ((cur && cur.list) || []).filter(x => x.id !== id); list.push(row); return { list }; };
      try {
        if (col === 'trades') { const n = await GH.mutate('trades.json', up, '가상 매매 기록'); S.trades = n.list; }
        else if (col === 'moves') { const n = await GH.mutate('moves.json', up, '급등락 메모'); this.user = n.list; this.mergeMoves(); }
        else return false;
        render(); return true;
      } catch (e) { this.fail(e); return false; }
    },
    async del(col, id) {
      try { if (col !== 'trades') return false; const n = await GH.mutate('trades.json', cur => ({ list: ((cur && cur.list) || []).filter(x => x.id !== id) }), '가상 매매 삭제'); S.trades = n.list; render(); return true; }
      catch (e) { this.fail(e); return false; }
    },
    async setWatch(list) {
      try { const n = await GH.mutate('watch.json', cur => Object.assign({}, cur, { list }), '모니터링 목록 변경'); S.watch = n.list; preload(); render(); return true; }
      catch (e) { this.fail(e); return false; }
    }
  };
  Store.waitFor = function (sym) {
    return new Promise(res => { let k = 0; const t = setInterval(async () => { k++; await Store.loadLive(true); if (SV.info(sym)) { clearInterval(t); res(true); } else if (k >= 24) { clearInterval(t); res(false); } }, 15000); });
  };
  Store.prep = async function (sym, name) {
    try { await GH.mutate('watch.json', cur => { const o = Object.assign({ list: [] }, cur), p = (o.prep || []).filter(x => x.s !== sym); p.push({ s: sym, n: name || '', at: new Date().toISOString() }); o.prep = p.slice(-40); return o; }, '종목 이력 준비 요청'); }
    catch (e) { Store.fail(e); return false; }
    GH.kick(); return Store.waitFor(sym);
  };
  /* 전 종목 목록 (미국 · 한국 약 1만 7천 개) — 처음 검색할 때 한 번 받음 */
  const Dir = { list: null, p: null, load() { if (!this.p) this.p = fetch('./data/all.json').then(r => r.json()).then(j => { this.list = j.list || []; }).catch(() => { this.list = []; }); return this.p; }, name(sym) { const a = (this.list || []).find(x => x[0] === sym); return a ? a[1] : null; } };
  function searchAll(q) {
    q = q.trim().toLowerCase(); if (!q) return []; const out = [], seen = new Set();
    const sc = (s, n, k) => { s = s.toLowerCase(); const b = s.replace(/\.k[sq]$/, ''); n = (n || '').toLowerCase(); k = (k || '').toLowerCase(); return s === q || b === q ? 0 : b.startsWith(q) ? 1 : k.startsWith(q) ? 2 : n.startsWith(q) ? 3 : (k.includes(q) || n.includes(q)) ? 4 : 9; };
    SV.idx.forEach(x => { if (x.m === 'IX') return; const r = sc(x.s, x.n, x.k); seen.add(x.s); if (r < 9) out.push([r - 0.5, { s: x.s, n: x.k || x.n }]); });
    (Dir.list || []).forEach(a => { if (seen.has(a[0])) return; const r = sc(a[0], a[1], ''); if (r < 9) out.push([r, { s: a[0], n: a[1] }]); });
    return out.sort((a, b) => a[0] - b[0] || a[1].s.length - b[1].s.length).slice(0, 8).map(a => a[1]);
  }
  function resultsHTML(q, mark, label) {
    const had = !!Dir.list, loc = searchAll(q);
    return '<div class="results">' + loc.map(x => '<button data-pick="' + esc(x.s) + '" data-name="' + esc(x.n) + '"><span class="sym">' + esc(x.s.replace(/\.K[SQ]$/, '')) + '</span><span class="nm">' + esc(x.n) + '</span><span class="add">' + (mark && mark.has(x.s) ? '추가됨' : label) + '</span></button>').join('') + (!loc.length ? '<button disabled><span class="nm">' + (had ? '일치하는 종목이 없습니다.' : '전체 종목 목록을 불러오는 중입니다.') + '</span></button>' : '') + '</div>';
  }
  function paintRes() {
    const el = $('#qres'); if (!el) return; const q = S.q.trim(); if (!q) { el.innerHTML = ''; return; }
    if (!Dir.list) Dir.load().then(paintRes);
    el.innerHTML = resultsHTML(q, new Set(S.watch.map(w => w.s)), '추가');
  }
  /* 하락 위험 단계 : 2014. 11 ~ 2026. 10 나스닥 일봉 2,998일 백테스트. 조건 5개 중 충족 개수별로 「이후 20거래일 안에 나스닥이 그날 종가보다 8% 넘게 더 내려간 비율」을 집계 */
  const RISK_TBL = [
    { k: 'lo', lab: '평온', p: 5.3, p10: 2.9, avg: 1.1, min: -2.5, n: 1984 },
    { k: 'mid', lab: '주의', p: 12.7, p10: 9.6, avg: 1.1, min: -3.4, n: 395 },
    { k: 'hi', lab: '경계', p: 22.1, p10: 12.9, avg: 1.5, min: -4.0, n: 249 },
    { k: 'max', lab: '위험', p: 33.3, p10: 27.5, avg: -0.5, min: -6.1, n: 189 },
    { k: 'ext', lab: '극단 · 공포 구간', p: 21.0, p10: 9.9, avg: 4.7, min: -4.0, n: 181 }];
  async function calcRisk() {
    if (!SVok) return;
    try {
      const cur = (s, H) => { const p = px(s); return p && Number.isFinite(p.p) ? p.p : H.c[H.c.length - 1]; };
      const [G, N, V, X] = await Promise.all(['^GSPC', '^IXIC', '^VIX', '^SOX'].map(s => SV.hist(s)));
      const ma = (H, k) => { const a = H.c.slice(-k); return a.reduce((x, y) => x + y, 0) / a.length; };
      const g = cur('^GSPC', G), n = cur('^IXIC', N), v = cur('^VIX', V), x = cur('^SOX', X);
      const cl = N.c.slice(-21); if (Math.abs(n / cl[cl.length - 1] - 1) > 1e-6) { cl.push(n); cl.shift(); }
      const rr = []; for (let i = 1; i < cl.length; i++) rr.push(cl[i] / cl[i - 1] - 1); const mu = rr.reduce((p, q) => p + q, 0) / rr.length, rv = Math.sqrt(rr.reduce((p, q) => p + (q - mu) * (q - mu), 0) / rr.length * 252);
      const hi = Math.max(n, Math.max.apply(null, N.c.slice(-252))), g2 = g / ma(G, 200) - 1, x2 = x / ma(X, 200) - 1, dd = n / hi - 1;
      const conds = [
        ['S&P500 200일선 아래', g2 < 0, '200일선 대비 ' + SV.pct(g2), 23.5],
        ['반도체지수 200일선 아래', x2 < 0, '200일선 대비 ' + SV.pct(x2), 26.2],
        ['나스닥 20일 변동성 25% 이상', rv >= 0.25, '연율 ' + (rv * 100).toFixed(0) + '%', 23.1],
        ['VIX 25 이상', v >= 25, 'VIX ' + v.toFixed(1), 16.1],
        ['나스닥 1년 고점 대비 -10% 이하', dd <= -0.10, '고점 대비 ' + SV.pct(dd), 25.5]];
      const cnt = conds.filter(c => c[1]).length, lv = cnt === 0 ? 0 : cnt === 1 ? 1 : cnt <= 3 ? 2 : cnt === 4 ? 3 : 4, prev = S.risk && S.risk.key, key = cnt + ':' + conds.map(c => c[2]).join('|');
      S.risk = Object.assign({ key, cnt, lv, conds, at: S.quotes && S.quotes.at }, RISK_TBL[lv]);
      if (prev !== key) render();
    } catch (e) { }
  }
  function riskHTML() {
    const r = S.risk; if (!r) return '<div class="risk pad"><div class="skel" style="width:40%"></div><div class="skel"></div></div>';
    const td = todayInt(), wk = S.issues.filter(i => i.date >= td - 7), dn = wk.filter(i => i.dir < 0).length, upn = wk.filter(i => i.dir > 0).length;
    return '<div class="risk pad ' + r.k + '"><div class="rh"><div><div class="rk">하락 위험 단계 <small>MARKET THREAT LEVEL</small></div><div class="rv"><b class="num">' + r.p.toFixed(0) + '<i>%</i></b><em>' + r.lab + '</em></div></div><div class="rt">' + (r.at ? new Date(r.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 시세 기준<br>5분 간격 재계산' : '') + '</div></div>' +
      '<div class="rcells">' + RISK_TBL.map((t, i) => '<span class="' + (i === r.lv ? 'on ' : i < r.lv ? 'past ' : '') + t.k + '"><b>' + t.p.toFixed(0) + '%</b>' + t.lab.split(' ')[0] + '</span>').join('') + '</div>' +
      '<p class="rdesc">과거 같은 단계였던 ' + r.n.toLocaleString() + '일 가운데 <b>' + r.p.toFixed(0) + '%</b>에서, 이후 20거래일 안에 나스닥이 그날 종가보다 <b>8% 넘게 더</b> 내려갔습니다 (평소 10%). 10% 넘게 내려간 비율은 ' + r.p10.toFixed(0) + '%, 20거래일 뒤 평균 수익률은 <b class="' + cls(r.avg) + '">' + (r.avg > 0 ? '+' : '') + r.avg.toFixed(1) + '%</b> 였습니다.</p>' +
      '<div class="rconds">' + r.conds.map(c => '<div class="rc' + (c[1] ? ' on' : '') + '"><i></i><span>' + c[0] + '</span><em>' + esc(c[2]) + '</em></div>').join('') + '</div>' +
      '<div class="rnews">최근 1주 자동 수집 이슈 : 하방 ' + dn + '건 · 상방 ' + upn + '건 <small>(단계 계산에는 넣지 않음)</small></div>' +
      '<details class="more"><summary>백테스트 근거와 한계 보기</summary><div class="rtbl"><div class="h"><span>단계 (충족 조건 수)</span><span>8% 추가 하락</span><span>20일 평균</span><span>표본</span></div>' + RISK_TBL.map((t, i) => '<div class="' + (i === r.lv ? 'cur' : '') + '"><span>' + t.lab + ' (' + ['0', '1', '2~3', '4', '5'][i] + '개)</span><span>' + t.p.toFixed(1) + '%</span><span class="' + cls(t.avg) + '">' + (t.avg > 0 ? '+' : '') + t.avg.toFixed(1) + '%</span><span>' + t.n.toLocaleString() + '일</span></div>').join('') + '</div>' +
      '<p class="note" style="margin-top:10px">2014년 11월 ~ 2026년 10월 나스닥 2,998거래일 기준입니다. 요인 14개에 최적 가중치를 주는 방식도 시험했으나, 학습에 쓰지 않은 기간에서는 맞히지 못해(판별력 0.47, 0.5가 동전 던지기) 버렸습니다. 대신 기간을 나눠도 방향이 유지된 조건 5개의 충족 개수만 씁니다. 조건이 하나도 없을 때의 추가 급락 비율은 전반기 4.6% · 후반기 6.1%로 안정적이었으나, 2개 이상 구간은 시기별 편차가 큽니다 (예 : 4개 충족 시 전반기 24% · 후반기 41%).</p>' +
      '<p class="note" style="margin-top:6px"><b>읽는 법</b> : 단계가 오르면 「더 크게 빠질 가능성」이 평소의 2~3배로 커진다는 뜻이지, 반드시 빠진다는 뜻이 아닙니다. 위험 단계에서도 3번 중 2번은 8% 추가 하락이 없었고, 5개가 모두 켜진 극단 구간은 오히려 20일 뒤 평균 +4.7%로 반등이 많았습니다. 손절 여부는 이 확률과 보유 종목의 사정을 함께 놓고 직접 판단하십시오.</p></details></div>';
  }
  const Live = { mcp: null };
  function liveUI() {
    const b = $('#liveBtn'), t = $('#liveTxt'), at = S.quotes && Date.parse(S.quotes.at || '');
    b.classList.toggle('on', !!at && Date.now() - at < 20 * 60000);
    t.textContent = at ? new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 시세' : '연결 중';
  }
  function applyQuotes() {
    const Q = S.quotes; if (!Q || !Q.q) return;
    for (const s in Q.q) SV.live[s] = { p: Q.q[s].p, chg: Q.q[s].chg, t: (Q.q[s].t || 0) * 1000, src: 'task' };
  }
  function openSettings() {
    const ago = t => { const m = Math.round((Date.now() - Date.parse(t)) / 60000); return !t ? '기록 없음' : m < 1 ? '방금' : m < 60 ? m + '분 전' : m < 1440 ? Math.round(m / 60) + '시간 전' : Math.round(m / 1440) + '일 전'; };
    const body = () => '<div class="block pad"><h3>자동 수집 상태 <small>깃허브에서 24시간 실행</small></h3><div class="kv"><div><div class="k">시세 · 알림 점검</div><div class="v" style="font-size:13px">' + ago(S.quotes && S.quotes.at) + '</div></div><div><div class="k">미국 장</div><div class="v" style="font-size:13px">' + (S.open && S.open.US ? '열림' : '닫힘') + '</div></div><div><div class="k">한국 장</div><div class="v" style="font-size:13px">' + (S.open && S.open.KR ? '열림' : '닫힘') + '</div></div></div><p class="note" style="margin-top:8px">5분 간격으로 시세 · 가격 알림 · 급등락 · DART 공시를 점검하고, 장 마감 뒤 이슈 · 일정 · 급등락 사유를 정리합니다. 깃허브 사정으로 몇 분씩 늦어질 수 있습니다.</p></div>' +
      '<div class="block pad"><h3>기록 저장 연결 <small>' + (Store.canWrite() ? '연결됨' : '연결 안 됨') + '</small></h3><p class="note">종목 추가 · 가격 알림 · 가상 매매를 저장하려면 깃허브 연결 키가 필요합니다. 키는 이 기기 안에만 보관하며 다른 곳으로 보내지 않습니다. 휴대폰과 컴퓨터에 각각 한 번씩 넣으면 됩니다.</p><div class="field" style="grid-template-columns:1fr"><div><label>깃허브 연결 키 (github_pat_ 로 시작)</label><input class="inp" id="tokIn" type="password" autocomplete="off" placeholder="' + (GH.tok() ? '저장되어 있음 — 바꾸려면 새 키 입력' : '여기에 붙여 넣기') + '"></div></div><div class="btnrow"><button class="btn sm" id="tokSave">키 저장</button>' + (GH.tok() ? '<button class="btn sm line" id="tokDel">이 기기에서 키 지우기</button>' : '') + '<a class="btn sm ghost" style="text-decoration:none;display:inline-flex;align-items:center" target="_blank" rel="noopener" href="https://github.com/settings/personal-access-tokens/new">키 만들기 ↗</a></div><p class="note" id="tokMsg" style="margin-top:8px"></p></div>' +
      '<div class="block pad"><h3>휴대폰 알림 <small>ntfy 앱</small></h3><p class="note">알림은 ntfy 앱으로 옵니다. 앱에서 구독 주제를 한 번 등록하면 이 화면을 닫아 두어도, 컴퓨터를 꺼 두어도 알림을 받습니다. 구독 주제는 외부에 공개하지 않도록 이 화면에 표시하지 않습니다.</p><div class="btnrow"><a class="btn sm ghost" style="text-decoration:none;display:inline-flex;align-items:center" target="_blank" rel="noopener" href="https://play.google.com/store/apps/details?id=io.heckel.ntfy">안드로이드 앱 ↗</a><a class="btn sm ghost" style="text-decoration:none;display:inline-flex;align-items:center" target="_blank" rel="noopener" href="https://apps.apple.com/app/ntfy/id1625396347">아이폰 앱 ↗</a></div></div>' +
      '<div class="pad"><p class="note" style="margin-top:14px">이 도구는 판단 연습용이며 실제 주문 기능이 없습니다. 저장소 : ' + esc(GH.owner + '/' + GH.repo) + '</p></div>';
    const mount = b => {
      const msg = $('#tokMsg', b);
      $('#tokSave', b).onclick = async () => { const v = $('#tokIn', b).value.trim(); if (!v) { msg.textContent = '키를 붙여 넣어 주십시오.'; return; } msg.textContent = '확인하는 중입니다.'; let er = null; try { er = GH.dev ? null : await GH.check(v); } catch (e) { er = '확인하지 못했습니다. 인터넷 연결을 확인해 주십시오.'; } if (er) { msg.textContent = er; return; } try { localStorage.setItem('ju_token', v); } catch (e) { msg.textContent = '이 브라우저는 저장을 막고 있습니다. 사생활 보호 창이 아닌 일반 창에서 열어 주십시오.'; return; } GH.reset(); toast('연결했습니다.'); await Store.loadState(); closeSheet(); };
      const d = $('#tokDel', b); if (d) d.onclick = () => { try { localStorage.removeItem('ju_token'); } catch (e) { } Store.note(); toast('이 기기에서 키를 지웠습니다.'); closeSheet(); render(); };
    };
    openSheet('설정', '연결 상태 · 기록 저장 · 알림', body(), mount);
  }

  /* ───────── 종목별 요약 미리 계산 ───────── */
  const loading = {};
  async function ensure(s) {
    if (S.meta[s] || loading[s] || !SVok) return; if (!SV.info(s)) { S.meta[s] = { none: true }; return; }
    loading[s] = true;
    try {
      const [H, M] = await Promise.all([SV.hist(s), SV.hist(SV.mkSym(s)).catch(() => null)]);
      const n = H.c.length, c = H.c[n - 1], prev = H.c[n - 2], w = H.c.slice(-252);
      const m = { c, prev, chg: c / prev - 1, d: H.d[n - 1], spark: H.c.slice(-60), hi52: Math.max.apply(null, w), lo52: Math.min.apply(null, w) };
      if (M && SV.info(s).m !== 'IX') { const r = SV.scoreFrom(SV.features(H, M, n - 1), SV.market(s)); m.score = r; }
      S.meta[s] = m;
    } catch (e) { S.meta[s] = { none: true }; }
    loading[s] = false; render();
  }
  const STRIP = ['^GSPC', '^IXIC', '^SOX', '^VIX', '^TNX', 'DX-Y.NYB', 'CL=F', 'KRW=X', '^KS11', 'BTC-USD'];
  function preload() { if (!SVok) return; STRIP.forEach(ensure); S.watch.forEach(w => ensure(w.s)); S.trades.forEach(t => ensure(t.s)); }
  function px(s) {
    const m = S.meta[s], L = SV.live[s];
    if (L && Number.isFinite(L.p) && (!m || m.none || L.t >= Date.UTC(+String(m.d).slice(0, 4), +String(m.d).slice(4, 6) - 1, +String(m.d).slice(6, 8)))) return { p: L.p, chg: L.chg, live: L.src === 'live', t: L.t };
    if (m && !m.none) return { p: m.c, chg: m.chg, d: m.d };
    return null;
  }

  /* ───────── 그리기 도구 ───────── */
  function prep(cv) { const r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 3); const w = Math.max(10, r.width), h = Math.max(10, r.height); if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); } const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); return { g, w, h }; }
  function spark(cv, a, color) {
    if (!cv || !a || a.length < 2) return; const { g, w, h } = prep(cv); const mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), r = mx - mn || 1;
    const X = i => 1 + i / (a.length - 1) * (w - 2), Y = v => 2 + (1 - (v - mn) / r) * (h - 4);
    g.beginPath(); a.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)));
    g.strokeStyle = color; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
    g.lineTo(w - 1, h); g.lineTo(1, h); g.closePath(); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, color + '33'); gr.addColorStop(1, color + '00'); g.fillStyle = gr; g.fill();
  }
  const hexA = (c, a) => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join(''); const n = parseInt(c, 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };

  /* 가격 차트 */
  function drawChart(cv, H, o) {
    const { g, w, h } = prep(cv), n = H.c.length, bars = Math.min(o.bars || 252, n), i0 = n - bars, I = SV.indicators(H);
    const up = css('--up'), dn = css('--down'), ink3 = css('--ink3'), line = css('--line'), ink = css('--ink'), acc = css('--accent');
    const padR = 54, padT = 22, padB = 20, vh = Math.round(h * 0.15), ph = h - padT - padB - vh - 6, pw = w - padR - 6;
    let mn = Infinity, mx = -Infinity, vmx = 0;
    for (let i = i0; i < n; i++) { if (H.l[i] < mn) mn = H.l[i]; if (H.h[i] > mx) mx = H.h[i]; if (H.v[i] > vmx) vmx = H.v[i]; }
    (o.lines || []).forEach(L => { if (L.y > mn * 0.75 && L.y < mx * 1.25) { mn = Math.min(mn, L.y); mx = Math.max(mx, L.y); } });
    const pad = (mx - mn) * 0.06 || 1; mn -= pad; mx += pad;
    const X = i => 6 + (i - i0 + 0.5) / bars * pw, Y = v => padT + (1 - (v - mn) / (mx - mn)) * ph;
    g.font = '10.5px Manrope, sans-serif'; g.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) { const v = mn + (mx - mn) * k / 4, y = Y(v); g.strokeStyle = line; g.lineWidth = 1; g.beginPath(); g.moveTo(6, y + .5); g.lineTo(6 + pw, y + .5); g.stroke(); g.fillStyle = ink3; g.textAlign = 'left'; g.fillText(shortNum(v, o.sym), w - padR + 6, y); }
    // 날짜 눈금
    g.textAlign = 'center'; g.fillStyle = ink3; const step = Math.max(1, Math.floor(bars / 4));
    for (let i = i0 + Math.floor(step / 2); i < n; i += step) g.fillText(bars > 400 ? String(H.d[i]).slice(2, 4) + '. ' + (+String(H.d[i]).slice(4, 6)) : SV.fmtDateShort(H.d[i]), X(i), h - 9);
    // 거래량
    const bw = Math.max(1, pw / bars * 0.7), vy = h - padB;
    for (let i = i0; i < n; i++) { const u = H.c[i] >= (i ? H.c[i - 1] : H.o[i]); g.fillStyle = hexA(u ? up : dn, 0.28); const bh = vmx ? H.v[i] / vmx * vh : 0; g.fillRect(X(i) - bw / 2, vy - bh, bw, bh); }
    // 가격
    if (bars <= 130) {
      for (let i = i0; i < n; i++) { const u = H.c[i] >= H.o[i], col = u ? up : dn; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(X(i), Y(H.h[i])); g.lineTo(X(i), Y(H.l[i])); g.stroke(); const y1 = Y(Math.max(H.o[i], H.c[i])), y2 = Y(Math.min(H.o[i], H.c[i])); g.fillRect(X(i) - bw / 2, y1, bw, Math.max(1, y2 - y1)); }
    } else {
      g.beginPath(); for (let i = i0; i < n; i++) i === i0 ? g.moveTo(X(i), Y(H.c[i])) : g.lineTo(X(i), Y(H.c[i]));
      g.strokeStyle = ink; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
      g.lineTo(X(n - 1), padT + ph); g.lineTo(X(i0), padT + ph); g.closePath(); const gr = g.createLinearGradient(0, padT, 0, padT + ph); gr.addColorStop(0, hexA(acc, 0.16)); gr.addColorStop(1, hexA(acc, 0)); g.fillStyle = gr; g.fill();
    }
    // 이동평균선
    [['m20', '#E8A317'], ['m60', '#8B5CF6'], ['m200', '#14B8A6']].forEach(([k, col]) => { g.beginPath(); let st = false; for (let i = i0; i < n; i++) { const v = I[k][i]; if (!Number.isFinite(v)) continue; st ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)); st = true; } g.strokeStyle = col; g.lineWidth = 1.1; g.stroke(); });
    // 알림 가격선
    (o.lines || []).forEach(L => { if (L.y < mn || L.y > mx) return; const y = Y(L.y); g.setLineDash([5, 4]); g.strokeStyle = L.color; g.lineWidth = 1.2; g.beginPath(); g.moveTo(6, y); g.lineTo(6 + pw, y); g.stroke(); g.setLineDash([]); g.fillStyle = L.color; g.textAlign = 'left'; g.font = '700 10px Noto Sans KR, sans-serif'; g.fillText(L.label, 10, y - 8); g.font = '10.5px Manrope, sans-serif'; });
    // 표시 : 급등락 · 가상 매매
    (o.marks || []).forEach(m => { const i = SV.at(H, m.d); if (i < i0 || i < 0) return; const x = X(i);
      if (m.type === 'move') { g.beginPath(); g.arc(x, Y(H.c[i]), 3.2, 0, 7); g.fillStyle = m.pct > 0 ? up : dn; g.fill(); g.strokeStyle = css('--surface'); g.lineWidth = 1.5; g.stroke(); }
      else { const buy = m.type === 'buy', y = buy ? Y(H.l[i]) + 9 : Y(H.h[i]) - 9; g.beginPath(); if (buy) { g.moveTo(x, y - 6); g.lineTo(x - 5.5, y + 4); g.lineTo(x + 5.5, y + 4); } else { g.moveTo(x, y + 6); g.lineTo(x - 5.5, y - 4); g.lineTo(x + 5.5, y - 4); } g.closePath(); g.fillStyle = acc; g.fill(); } });
    // 마지막 가격
    const last = o.live || H.c[n - 1], yl = Y(Math.max(mn, Math.min(mx, last)));
    g.setLineDash([2, 3]); g.strokeStyle = ink3; g.beginPath(); g.moveTo(6, yl); g.lineTo(6 + pw, yl); g.stroke(); g.setLineDash([]);
    g.fillStyle = ink; roundRect(g, w - padR + 2, yl - 9, padR - 4, 18, 4); g.fill(); g.fillStyle = css('--surface'); g.textAlign = 'center'; g.font = '700 10.5px Manrope, sans-serif'; g.fillText(shortNum(last, o.sym), w - padR / 2, yl + .5);
    // 십자선
    if (o.hover != null) { const i = Math.max(i0, Math.min(n - 1, i0 + Math.floor((o.hover - 6) / pw * bars))); g.strokeStyle = hexA(ink, 0.35); g.lineWidth = 1; g.beginPath(); g.moveTo(X(i), padT); g.lineTo(X(i), vy); g.stroke(); g.beginPath(); g.arc(X(i), Y(H.c[i]), 3.5, 0, 7); g.fillStyle = acc; g.fill(); return i; }
    return null;
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function shortNum(v, s) { const m = SV.market(s || ''); if (m === 'KR' && !/\^/.test(s)) return v >= 1e6 ? (v / 1e4).toFixed(0) + '만' : v >= 1e5 ? (v / 1e4).toFixed(1) + '만' : Math.round(v).toLocaleString(); return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v >= 100 ? v.toFixed(1) : v.toFixed(2); }

  /* 세계선 차트 : 실행한 세계 · 하지 않은 세계 · 지수를 산 세계 */
  function drawWorlds(cv, R, t) {
    const { g, w, h } = prep(cv); const acc = css('--accent'), ink3 = css('--ink3'), line = css('--line'), good = css('--good'), warn = css('--warn'), ink2 = css('--ink2'), surf = css('--surface');
    const n = R.path.r.length, span = Math.max(n - 1, 62), sell = t.side === 'sell';
    const exec = R.path.r.map(r => sell ? 0 : r), alt = R.path.r.map(r => sell ? r : 0), bench = R.path.b;
    let mn = 0, mx = 0; [exec, alt, bench].forEach(a => a.forEach(v => { if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } }));
    const pad = Math.max(0.02, (mx - mn) * 0.12); mn -= pad; mx += pad;
    const padL = 10, padR = 46, padT = 24, padB = 22, pw = w - padL - padR, ph = h - padT - padB;
    const X = i => padL + i / span * pw, Y = v => padT + (1 - (v - mn) / (mx - mn)) * ph;
    g.font = '10.5px Manrope, sans-serif'; g.textBaseline = 'middle';
    const st = niceStep((mx - mn) / 4);
    for (let v = Math.ceil(mn / st) * st; v <= mx; v += st) { const y = Y(v); g.strokeStyle = Math.abs(v) < 1e-9 ? hexA(ink2, 0.55) : line; g.lineWidth = 1; g.beginPath(); g.moveTo(padL, y + .5); g.lineTo(padL + pw, y + .5); g.stroke(); g.fillStyle = ink3; g.textAlign = 'left'; g.fillText((v > 0 ? '+' : '') + Math.round(v * 100) + '%', w - padR + 6, y); }
    // 채점 시점 세로선
    SV.HORIZONS.forEach(hz => { const x = X(hz); g.setLineDash([3, 4]); g.strokeStyle = hexA(ink2, 0.35); g.beginPath(); g.moveTo(x, padT - 4); g.lineTo(x, padT + ph); g.stroke(); g.setLineDash([]); g.fillStyle = ink3; g.textAlign = 'center'; g.font = '10px Noto Sans KR, sans-serif'; g.fillText(hz + '거래일', x, h - 9); });
    // 아직 오지 않은 구간
    if (n - 1 < span) { g.fillStyle = hexA(ink3, 0.07); g.fillRect(X(n - 1), padT, padL + pw - X(n - 1), ph); g.fillStyle = ink3; g.textAlign = 'center'; g.font = '10.5px Noto Sans KR, sans-serif'; if (padL + pw - X(n - 1) > 70) g.fillText('아직 오지 않은 구간', (X(n - 1) + padL + pw) / 2, padT + 12); }
    // 두 세계 사이 채움
    g.beginPath(); exec.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); for (let i = n - 1; i >= 0; i--) g.lineTo(X(i), Y(alt[i])); g.closePath();
    const diff = exec[n - 1] - alt[n - 1]; g.fillStyle = hexA(diff >= 0 ? good : warn, 0.13); g.fill();
    const path = (a, col, lw, dash) => { g.beginPath(); let s = false; a.forEach((v, i) => { if (!Number.isFinite(v)) return; s ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)); s = true; }); g.setLineDash(dash || []); g.strokeStyle = col; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke(); g.setLineDash([]); };
    path(bench, hexA(warn, 0.9), 1.3, [4, 4]); path(alt, ink3, 1.8); path(exec, acc, 2.6);
    // 분기점
    g.beginPath(); g.arc(X(0), Y(0), 9, 0, 7); g.fillStyle = hexA(acc, 0.18); g.fill(); g.beginPath(); g.arc(X(0), Y(0), 4.5, 0, 7); g.fillStyle = acc; g.fill(); g.strokeStyle = surf; g.lineWidth = 2; g.stroke();
    g.fillStyle = ink2; g.textAlign = 'left'; g.font = '700 10.5px Noto Sans KR, sans-serif'; g.fillText(SV.fmtDateShort(R.entryDate) + ' 분기', X(0) + 2, padT - 12);
    // 끝점
    [[exec, acc], [alt, ink3]].forEach(([a, col]) => { g.beginPath(); g.arc(X(n - 1), Y(a[n - 1]), 4, 0, 7); g.fillStyle = col; g.fill(); g.strokeStyle = surf; g.lineWidth = 2; g.stroke(); });
  }
  function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }

  /* ───────── 공통 UI ───────── */
  let toastT; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }
  let sheetClose = null;
  function openSheet(ttl, sub, html, mount, onClose) { S.detail = null; S.detailPaint = null; $('#sheetTtl').textContent = ttl; $('#sheetSub').textContent = sub || ''; $('#sheetAct').innerHTML = ''; const b = $('#sheetBody'); b.innerHTML = html; b.scrollTop = 0; $('#sheet').classList.add('on'); sheetClose = onClose || null; if (mount) mount(b); }
  function closeSheet() { $('#sheet').classList.remove('on'); $('#sheetBody').innerHTML = ''; S.detail = null; if (sheetClose) sheetClose(); sheetClose = null; render(); }
  let raf = 0; function render() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; paint(); }); }
  function paint() {
    if (!SVok) return;
    $('#asof').textContent = (S.meta['^GSPC'] || {}).d ? SV.fmtDateShort(S.meta['^GSPC'].d) + ' 종가 기준' : '';
    const unseen = S.alerts.filter(a => !a.seen).length; const bn = $('#bellN'); bn.hidden = !unseen; bn.textContent = unseen;
    $('#fab').classList.toggle('on', S.tab === 'uni' && !$('#sheet').classList.contains('on'));
    if ($('#sheet').classList.contains('on')) { if (S.detail && S.detailPaint) S.detailPaint(); return; }
    ({ env: paintEnv, watch: paintWatch, uni: paintUni, rec: paintRec })[S.tab]();
  }
  const note = () => S.storeNote ? '<div class="pad"><div class="banner">' + esc(S.storeNote) + '</div></div>' : '';

  /* ───────── 환경 ───────── */
  const CATS = [['all', '전체'], ['mine', '내 종목 영향'], ['거시', '거시'], ['정치', '정치·규제'], ['섹터', '섹터·기업'], ['지정학', '지정학']];
  function paintEnv() {
    const v = $('#v-env'), mine = new Set(S.watch.map(w => w.s));
    const strip = STRIP.map(s => { const m = S.meta[s]; if (!m || m.none) return '<div class="tick"><div class="n">' + esc(SV.name(s)) + '</div><div class="skel"></div></div>'; const p = px(s) || {}; const val = s === '^TNX' ? p.p.toFixed(2) + '%' : s === 'KRW=X' ? Math.round(p.p).toLocaleString() + '원' : s === 'CL=F' || s === 'BTC-USD' ? '$' + p.p.toLocaleString('en-US', { maximumFractionDigits: s === 'CL=F' ? 1 : 0 }) : p.p.toLocaleString('en-US', { maximumFractionDigits: p.p > 1000 ? 0 : 2 }); return '<button class="tick" data-sym="' + esc(s) + '"><div class="n">' + esc(SV.name(s)) + '</div><div class="v">' + val + '</div><div class="c ' + cls(p.chg) + '">' + SV.pct(p.chg, 2) + '</div><canvas data-spark="' + esc(s) + '"></canvas></button>'; }).join('');
    let list = S.issues.slice().sort((a, b) => (b.date - a.date) || (b.sev - a.sev));
    const f = S.issueFilter; if (f === 'mine') list = list.filter(x => (x.tickers || []).some(t => mine.has(t))); else if (f !== 'all') list = list.filter(x => x.cat === f);
    const issues = list.length ? list.map(x => {
      const tk = (x.tickers || []).filter(t => mine.has(t)), others = (x.tickers || []).filter(t => !mine.has(t)).slice(0, 4);
      return '<button class="issue' + (S.openIssue === x.id ? ' open' : '') + '" data-issue="' + esc(x.id) + '"><div class="sev d' + (x.dir || 0) + '">' + [3, 2, 1].map(k => '<i class="' + (x.sev >= k ? 'f' : '') + '"></i>').join('') + '<em>' + (x.dir < 0 ? '하방' : x.dir > 0 ? '상방' : '혼재') + '</em></div><div><div class="t">' + esc(x.title) + '</div><div class="m">' + SV.fmtDateShort(x.date) + ' · ' + esc(x.cat || '') + (x.sectors && x.sectors.length ? ' · ' + esc(x.sectors.join(', ')) : '') + '</div>' +
        ((tk.length || others.length) ? '<div class="tags">' + tk.map(t => '<span class="tag mine">' + esc(t.replace(/\.K[SQ]$/, '')) + '</span>').join('') + others.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
        '<div class="b">' + esc(x.body) + (x.next ? '<div class="next">다음 확인 : ' + esc(x.next) + '</div>' : '') + (x.src && x.src.length ? '<div class="src">' + x.src.map(s => '<a href="' + esc(s.u) + '" target="_blank" rel="noopener">' + esc(s.t) + ' ↗</a>').join('') + '</div>' : '') + '</div></div></button>';
    }).join('') : '<div class="empty">' + (S.loaded.issues ? '해당하는 이슈가 없습니다.' : '이슈를 불러오는 중입니다.') + '</div>';
    const td = todayInt(), cal = S.cal.filter(c => c.d >= td - 1).sort((a, b) => a.d - b.d).slice(0, 12);
    v.innerHTML = riskHTML() + '<div class="strip">' + strip + '</div>' + note() + '<div class="pad">' +
      (S.brief && S.brief.text ? '<div class="brief"><div class="k">' + SV.fmtDateShort(S.brief.date) + ' 시장 요약</div><p>' + esc(S.brief.text) + '</p></div>' : '') +
      '<h2 class="sec">시장에 영향을 주는 이슈 <small>막대 3칸 = 영향 큼</small></h2><div class="chips">' + CATS.map(([k, t]) => '<button class="chip' + (f === k ? ' on' : '') + '" data-cat="' + k + '">' + t + '</button>').join('') + '</div></div>' +
      '<div class="sheetlist pad" style="margin-top:8px">' + issues + '</div>' +
      '<div class="pad"><h2 class="sec">다가오는 일정</h2></div><div class="sheetlist pad">' + (cal.length ? cal.map(c => '<div class="cal"><div class="d">' + SV.fmtDateShort(c.d) + '<small>' + '일월화수목금토'[new Date(SV.iso(c.d)).getDay()] + '요일' + (c.tm ? ' ' + esc(c.tm) : '') + '</small></div><div><b>' + esc(c.t) + '</b>' + (c.w ? '<div class="note">' + esc(c.w) + '</div>' : '') + '</div></div>').join('') : '<div class="empty">등록된 일정이 없습니다.</div>') + '</div>' +
      '<div class="pad"><p class="note" style="margin-top:14px">시세와 하락 위험 단계는 5분 간격으로 갱신됩니다. 이슈 · 시장 요약 · 일정은 미국 · 한국 장 마감 뒤 기사 제목을 근거로 자동 정리한 것이므로, 중요한 내용은 출처 기사로 확인하십시오.</p></div>';
    $$('[data-spark]', v).forEach(c => { const m = S.meta[c.dataset.spark]; if (m && m.spark) spark(c, m.spark, m.spark[m.spark.length - 1] >= m.spark[0] ? css('--up') : css('--down')); });
  }

  /* ───────── 종목 ───────── */
  function ring(sc) { if (!sc || !sc.valid) return '<div class="sc"><b class="mute">–</b></div>'; const g = SV.grade(sc.score), C = 2 * Math.PI * 16; return '<div class="sc ' + g.k + '"><svg viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="16"/><circle class="fg" cx="20" cy="20" r="16" stroke-dasharray="' + (C * sc.score / 100).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg><b>' + Math.round(sc.score) + '</b></div>'; }
  function searchLocal(q) { q = q.trim().toLowerCase(); if (!q) return []; const sc = x => { const s = x.s.toLowerCase(), n = (x.n || '').toLowerCase(), k = (x.k || '').toLowerCase(); return s === q || s.replace(/\.k[sq]$/, '') === q ? 0 : s.startsWith(q) ? 1 : k.startsWith(q) ? 2 : n.startsWith(q) ? 3 : (k.includes(q) || n.includes(q)) ? 4 : 9; }; return SV.idx.map(x => [sc(x), x]).filter(a => a[0] < 9).sort((a, b) => a[0] - b[0]).slice(0, 7).map(a => a[1]); }
  function paintWatch() {
    const v = $('#v-watch');
    const rows = S.watch.map(w => {
      const m = S.meta[w.s], p = px(w.s), nm = SV.info(w.s) ? SV.name(w.s) : (w.n || w.s);
      const al = (w.buy || w.sell) ? '<span class="al">알림</span>' : '';
      return '<button class="row" data-open="' + esc(w.s) + '"><div style="min-width:0"><div class="nm">' + esc(nm) + '</div><div class="sy">' + esc(w.s.replace(/\.K[SQ]$/, '')) + al + (m && m.none && !p ? '<span>이력 준비 중</span>' : '') + '</div></div><canvas data-spark="' + esc(w.s) + '"></canvas><div class="px">' + (p ? '<div class="p">' + SV.price(p.p, w.s) + '</div><div class="c ' + cls(p.chg) + '">' + SV.pct(p.chg, 2) + '</div>' : '<div class="p mute">–</div>') + '</div>' + ring(m && m.score) + '</button>';
    }).join('');
    if (!$('#q', v)) v.innerHTML = '<div id="wNote"></div><div class="pad"><div class="search"><input id="q" type="search" inputmode="search" enterkeyhint="search" placeholder="종목명 · 티커 · 종목코드 (미국 · 한국 전 종목)" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></div><div id="qres"></div></div><div id="wList"></div>';
    const qi = $('#q', v); if (document.activeElement !== qi && qi.value !== S.q) qi.value = S.q;
    $('#wNote', v).innerHTML = note(); paintRes();
    $('#wList', v).innerHTML = '<div class="pad"><h2 class="sec">모니터링 종목 <small>' + S.watch.length + '개</small></h2><div class="legend"><span>종목</span><span>60일</span><span>현재가</span><span>타점</span></div></div>' +
      '<div class="sheetlist pad">' + (rows || '<div class="empty">' + (S.loaded.watch ? '위 검색창에서 종목을 추가하십시오.' : '종목을 불러오는 중입니다.') + '</div>') + '</div>' +
      '<div class="pad"><p class="note" style="margin-top:14px"><b>타점 점수</b>는 10년 백테스트에서 확인된 조건 조합을 지금 얼마나 충족하는지 나타냅니다. 미사용 검증 구간에서 실제로 차이가 난 것은 85점 이상뿐이며, 그 아래 구간은 「근거 없음」으로 읽어야 합니다. 매수 권유가 아닌 참고 지표입니다.</p></div>';
    $$('[data-spark]', v).forEach(c => { const m = S.meta[c.dataset.spark]; if (m && m.spark) spark(c, m.spark, m.chg >= 0 ? css('--up') : css('--down')); });
  }
  async function addWatch(s, name) {
    if (S.watch.some(w => w.s === s)) { toast('이미 목록에 있습니다.'); return; }
    const it = { s, addedAt: new Date().toISOString() }; if (name) it.n = name;
    if (await Store.setWatch(S.watch.concat([it]))) { S.q = ''; const qi = $('#q'); if (qi) qi.value = ''; const ready = !!SV.info(s); toast(ready ? '추가했습니다.' : '추가했습니다. 차트와 점수는 1~5분 안에 준비됩니다.'); GH.kick(); if (!ready) Store.waitFor(s); render(); }
  }

  /* 종목 상세 */
  async function openDetail(s) {
    const w = () => S.watch.find(x => x.s === s) || { s };
    const info = SV.info(s), nm = info ? SV.name(s) : ((w().n) || s);
    openSheet(nm, s.replace(/\.K[SQ]$/, '') + (info ? ' · ' + (info.m === 'KR' ? '한국' : info.m === 'US' ? '미국' : '지수') : ''), '<div class="pad" style="padding-top:20px"><div class="skel"></div><div class="skel" style="width:60%"></div></div>');
    S.detail = s;
    let H = null, M = null; try { H = await SV.hist(s); M = await SV.hist(SV.mkSym(s)); } catch (e) { }
    if (S.detail !== s) return;
    let bars = 252, hover = null, cons = null, consErr = null, consBusy = false, aiBusy = {};
    const inW = () => S.watch.some(x => x.s === s);
    const body = $('#sheetBody');
    const build = () => {
      const p = px(s), m = S.meta[s], sc = (H && M && info && info.m !== 'IX') ? SV.scoreFrom(SV.features(H, M, H.c.length - 1), SV.market(s)) : null, g = sc ? SV.grade(sc.score) : null, W = w(), F = S.fund[s];
      const pos52 = p && m && !m.none ? Math.max(0, Math.min(1, (p.p - m.lo52) / (m.hi52 - m.lo52 || 1))) : null;
      let h = '<div class="hero pad"><div class="p num">' + (p ? SV.price(p.p, s) : '–') + '</div><div class="c ' + cls(p && p.chg) + '">' + (p ? SV.pct(p.chg, 2) : '') + '<small>' + (p && p.live ? '실시간' : p && p.t ? '최근 점검 시세' : (m && m.d ? SV.fmtDateShort(m.d) + ' 종가' : '')) + '</small></div>' +
        (pos52 != null ? '<div class="note" style="margin-top:10px;display:flex;justify-content:space-between"><span>52주 최저 ' + SV.price(m.lo52, s) + '</span><span>최고 ' + SV.price(m.hi52, s) + '</span></div><div class="bar52"><i style="left:calc(' + (pos52 * 100).toFixed(1) + '% - 1px)"></i></div>' : '') +
        (H ? '<div class="rng">' + [[63, '3개월'], [252, '1년'], [756, '3년'], [9999, '10년']].map(([b, t]) => '<button data-rng="' + b + '" class="' + (bars === b ? 'on' : '') + '">' + t + '</button>').join('') + '</div>' : '') + '</div>';
      if (H) h += '<div class="chartwrap"><canvas id="chart"></canvas><div class="readout" id="readout" hidden></div><div class="pad malegend"><span><i style="background:#E8A317"></i>20일선</span><span><i style="background:#8B5CF6"></i>60일선</span><span><i style="background:#14B8A6"></i>200일선</span><span>● 5% 이상 급등락</span><span>▲▼ 내 가상 매매</span></div></div>';
      else h += '<div class="pad"><div class="banner">이 종목은 아직 가격 이력이 준비되지 않았습니다. 모니터링 목록에 있으면 5~10분 안에 자동으로 준비되어 차트·타점 점수·가상 매매가 열립니다.</div></div>';
      // 타점 점수
      if (sc && sc.valid) {
        const b = sc.bucket, a = Math.PI * (1 - sc.score / 100), gx = 56 + 46 * Math.cos(a), gy = 58 - 46 * Math.sin(a), col = g.k === 'buy' ? 'var(--good)' : g.k === 'avoid' ? 'var(--warn)' : 'var(--ink3)';
        h += '<div class="block pad"><h3>매수 타점 점수 <small>' + (SV.market(s) === 'KR' ? '한국' : '미국') + ' 종목 10년 백테스트 기준</small></h3><div class="dial"><div class="g"><svg viewBox="0 0 112 66"><path d="M10 58 A46 46 0 0 1 102 58" fill="none" stroke="var(--sunk)" stroke-width="9" stroke-linecap="round"/><path d="M10 58 A46 46 0 0 1 ' + gx.toFixed(1) + ' ' + gy.toFixed(1) + '" fill="none" stroke="' + col + '" stroke-width="9" stroke-linecap="round"/></svg><b class="num">' + Math.round(sc.score) + '</b></div><div><div class="v ' + g.k + '">' + g.t + ' 구간</div><div class="s">' +
          (g.k === 'buy' ? '과거 같은 구간에서 매수한 경우 20거래일 뒤 오른 비율이 평소보다 뚜렷이 높았습니다.' : g.k === 'avoid' ? '부정적 조합이 겹쳤으나, 미사용 검증 구간에서는 평소와 차이가 작았습니다. 약한 경고로만 보십시오.' : '검증된 조합이 충분히 겹치지 않았습니다. 이 점수만으로는 판단 근거가 없습니다.') + '</div></div></div>' +
          '<div class="kv"><div><div class="k">20일 뒤 상승 비율</div><div class="v">' + (b.win * 100).toFixed(0) + '%</div></div><div><div class="k">20일 평균 수익률</div><div class="v ' + cls(b.avg) + '">' + SV.pct(b.avg) + '</div></div><div><div class="k">도중 최대 하락(중앙값)</div><div class="v down">' + SV.pct(b.mae) + '</div></div></div>' +
          '<p class="note" style="margin-top:8px">위 수치는 모델 선정에 쓰지 않은 2023년 이후 구간에서 같은 점수대가 보인 결과입니다 (표본 ' + b.n.toLocaleString() + '건). 평소 아무 날에 샀을 때의 상승 비율은 ' + (sc.base.winH * 100).toFixed(0) + '%, 평균 ' + SV.pct(sc.base.avgH) + ' 입니다.</p>' +
          '<div class="conds">' + sc.conds.map((c, i) => '<span class="cond' + (sc.on[i] ? ' on' : '') + '">' + esc(c.l) + '</span>').join('') + '</div>' +
          (sc.good.length || sc.bad.length ? '<details class="more"><summary>충족한 조합 ' + sc.good.length + '개 · 부정 조합 ' + sc.bad.length + '개 보기</summary>' + sc.good.slice(0, 5).map(c => comboRow(c, sc, true)).join('') + sc.bad.slice(0, 3).map(c => comboRow(c, sc, false)).join('') + '</details>' : '') + '</div>';
      }
      // 가상 매매
      if (H) h += '<div class="block pad"><h3>지금 판단을 기록 <small>나중에 자동 채점됩니다</small></h3><div class="btnrow" style="margin-top:0"><button class="btn" data-what="buy" style="flex:1">오늘 샀다면</button><button class="btn ghost" data-what="sell" style="flex:1">오늘 팔았다면</button></div></div>';
      // 알림
      h += '<div class="block pad"><h3>가격 알림 <small>조건에 닿으면 휴대폰 알림</small></h3>' + (inW() ? '<div class="field"><div><label>이 가격 이하로 내려오면 (매수 타점)</label><input class="inp" id="alBuy" inputmode="decimal" placeholder="미설정" value="' + (W.buy || '') + '"></div><div><label>이 가격 이상으로 오르면 (매도 가격)</label><input class="inp" id="alSell" inputmode="decimal" placeholder="미설정" value="' + (W.sell || '') + '"></div></div><div class="btnrow"><button class="btn sm" id="alSave">알림 저장</button><span class="note" style="align-self:center">5분 간격 점검 · 휴대폰 알림</span></div>' : '<p class="note">모니터링 목록에 추가하면 알림을 설정할 수 있습니다.</p><div class="btnrow"><button class="btn sm" id="addHere">모니터링에 추가</button></div>') + '</div>';
      // 컨센서스·실적 (미국) · 공시 (한국)
      const C = F && F.cons;
      if (C && (C.target || (C.eps && C.eps.length))) {
        const t = C.target, up = t && p && t.avg ? t.avg / p.p - 1 : null, nx = C.next;
        h += '<div class="block pad"><h3>증권가 컨센서스 · 실적 <small>나스닥 집계 · 1시간 간격 갱신</small></h3>' +
          (t ? '<div class="kv"><div><div class="k">목표주가 평균</div><div class="v">$' + (+t.avg).toFixed(0) + '</div></div><div><div class="k">현재가 대비</div><div class="v ' + cls(up) + '">' + (up != null ? SV.pct(up, 0) : '–') + '</div></div><div><div class="k">목표가 범위</div><div class="v" style="font-size:12.5px">$' + (+t.low).toFixed(0) + ' ~ $' + (+t.high).toFixed(0) + '</div></div></div><p class="note" style="margin-top:8px">투자의견 : 매수 ' + t.buy + ' · 보유 ' + t.hold + ' · 매도 ' + t.sell + '</p>' : '') +
          (nx ? '<p class="note" style="margin-top:6px">다음 실적 발표 : <b style="color:var(--warn)">' + SV.fmtDate(nx.d) + (nx.when ? ' ' + esc(nx.when) : '') + '</b> (미국 현지 기준)</p>' : '') +
          (C.eps && C.eps.length ? '<div style="margin-top:8px">' + C.eps.map(e => '<div class="brk" style="grid-template-columns:minmax(0,1fr) 78px 78px"><span class="lb">' + esc(e.period) + ' 분기' + (e.act == null ? ' <b style="color:var(--warn)">발표 예정</b>' : '') + '</span><span>' + (e.est != null ? '예상 ' + (+e.est).toFixed(2) : '–') + '</span><span class="' + (e.act != null && e.est != null ? cls(e.act - e.est) : '') + '">' + (e.act != null ? '실제 ' + (+e.act).toFixed(2) : '–') + '</span></div>').join('') + '<p class="note" style="margin-top:6px">주당순이익(EPS, 달러) 기준. 실제가 예상보다 높으면 붉은색입니다. 실적이 발표되면 휴대폰 알림을 보냅니다.</p></div>' : '') + '</div>';
      }
      const DS = (S.disc || {})[s];
      if (SV.market(s) === 'KR') h += '<div class="block pad"><h3>공시 <small>DART · 5분 간격 점검</small></h3>' + (DS && DS.length ? '<div class="news">' + DS.slice(0, 8).map(d => '<a href="' + esc(d.u) + '" target="_blank" rel="noopener">' + esc(d.t) + '<small>' + SV.fmtDateShort(d.d) + ' 접수</small></a>').join('') + '</div>' : '<p class="note">최근 접수된 공시가 없습니다. 새 공시가 올라오면 휴대폰 알림을 보냅니다.</p>') + '</div>';
      // 수급·밸류
      if (F && (F.si || F.kr)) {
        h += '<div class="block pad"><h3>수급 · 포지션 <small>' + (F.si ? '공매도 잔고 (월 2회 공시)' : '네이버 금융') + '</small></h3>';
        if (F.si && F.si.length) { const a = F.si[0], b = F.si[1]; h += '<div class="kv"><div><div class="k">공매도 잔고</div><div class="v">' + (a.shares / 1e6).toFixed(1) + '백만주</div></div><div><div class="k">직전 대비</div><div class="v ' + (b ? cls(a.shares - b.shares) : '') + '">' + (b ? SV.pct(a.shares / b.shares - 1) : '–') + '</div></div><div><div class="k">상환 소요일</div><div class="v">' + a.dtc.toFixed(1) + '일</div></div></div><p class="note" style="margin-top:8px">' + esc(a.date) + ' 결제일 기준. 잔고가 늘면 하락 베팅이 늘었다는 뜻이며, 상환 소요일이 길수록 급반등(숏 스퀴즈) 여지가 큽니다. 선물·옵션 포지션은 무료 자료가 없어 표시하지 않습니다.</p>'; }
        if (F.kr) { const k = F.kr; h += '<div class="kv"><div><div class="k">PER / 추정 PER</div><div class="v" style="font-size:12.5px">' + esc(k.per || '–') + ' / ' + esc(k.cnsPer || '–') + '</div></div><div><div class="k">외국인 보유율</div><div class="v">' + esc(k.foreign || '–') + '</div></div><div><div class="k">목표주가 평균</div><div class="v" style="font-size:12.5px">' + (k.target ? esc(k.target) + '원' : '–') + '</div></div></div><p class="note" style="margin-top:8px">컨센서스 기준일 ' + esc(k.cnsDate || '–') + ' · 시가총액 ' + esc(k.mcap || '–') + '</p>'; }
        h += '</div>';
      }
      // 급등락 기록
      const auto = H ? SV.bigMoves(H, 30, 0.05) : [], logged = S.moves.filter(x => x.s === s), byDate = {}; logged.forEach(x => { byDate[x.date] = x; });
      const all = auto.map(a => Object.assign({}, a, byDate[a.date] || {})).concat(logged.filter(x => !auto.some(a => a.date === x.date))).sort((a, b) => b.date - a.date).slice(0, 12);
      h += '<div class="block pad"><h3>급등락 기록 <small>하루 ±5% 이상</small></h3>' + (all.length ? all.map(x => '<div class="mv"><div class="d"><b class="' + cls(x.pct) + '">' + SV.pct(x.pct) + '</b>' + SV.fmtDateShort(x.date) + '</div><div class="r">' + (x.reason ? esc(x.reason) + '<div class="by">' + esc(x.by || '자동 수집') + (x.src && x.src[0] ? ' · <a href="' + esc(x.src[0].u) + '" target="_blank" rel="noopener" style="color:var(--accent)">출처 ↗</a>' : '') + '</div>' : (aiBusy[x.date] ? '<textarea class="inp" id="memo' + x.date + '" rows="2" style="height:auto;padding:8px 10px" placeholder="내가 파악한 원인"></textarea><div class="btnrow" style="margin-top:6px"><button class="btn sm" data-memo="' + x.date + '">저장</button></div>' : '<span class="mute">자동 분석 대기 중 — 다음 정리 때 Groq 가 그날 기사로 분석합니다.</span> <button class="btn sm line" data-why="' + x.date + '" style="height:28px;margin-left:4px">직접 기록</button>')) + '</div></div>').join('') : '<p class="note">최근 30거래일 동안 하루 5% 이상 움직인 날이 없습니다.</p>') + '</div>';
      // 뉴스
      if (F && F.news && F.news.length) h += '<div class="block pad"><h3>최근 기사 <small>' + esc((F.at || '').slice(5, 10).replace('-', '. ')) + ' 수집</small></h3><div class="news">' + F.news.slice(0, 7).map(n => '<a href="' + esc(n.u) + '" target="_blank" rel="noopener">' + esc(n.ko || n.t) + '<small>' + esc(n.src || '') + ' · ' + esc((n.at || '').slice(0, 6)) + '</small></a>').join('') + '</div></div>';
      if (inW()) h += '<div class="pad"><div class="btnrow"><button class="btn sm line" id="rmWatch">모니터링에서 제거</button></div></div>';
      body.innerHTML = h; mount();
    };
    const comboRow = (c, sc, good) => '<div class="combo"><b style="color:' + (good ? 'var(--good)' : 'var(--warn)') + '">' + c.i.map(i => esc(sc.conds[i].l)).join(' + ') + '</b><div class="st">학습 ' + (c.wa * 100).toFixed(0) + '% · 선정 ' + (c.wb * 100).toFixed(0) + '% · 미사용 검증 ' + (c.wh != null && c.nh >= 30 ? (c.wh * 100).toFixed(0) + '% (' + c.nh + '건, 평균 ' + SV.pct(c.mh) + ')' : '표본 부족') + '</div></div>';
    const draw = () => {
      const cv = $('#chart', body); if (!cv || !H) return; const W = w(), p = px(s);
      const marks = SV.bigMoves(H, Math.min(bars, H.c.length), 0.05).map(m => ({ d: m.date, type: 'move', pct: m.pct })).concat(S.trades.filter(t => t.s === s).map(t => ({ d: t.date, type: t.side })));
      const lines = []; if (W.buy) lines.push({ y: +W.buy, label: '매수 타점 ' + SV.price(+W.buy, s), color: css('--good') }); if (W.sell) lines.push({ y: +W.sell, label: '매도 가격 ' + SV.price(+W.sell, s), color: css('--warn') });
      const i = drawChart(cv, H, { bars, sym: s, marks, lines, hover, live: p && p.live ? p.p : null }), ro = $('#readout', body);
      if (i != null) { ro.hidden = false; ro.textContent = SV.fmtDate(H.d[i]) + '  종가 ' + SV.price(H.c[i], s) + '  ' + SV.pct(i ? H.c[i] / H.c[i - 1] - 1 : 0, 2) + '  거래량 ' + (H.v[i] >= 1e6 ? (H.v[i] / 1e6).toFixed(1) + '백만' : H.v[i].toLocaleString()); } else ro.hidden = true;
    };
    const mount = () => {
      draw(); const cv = $('#chart', body);
      if (cv) { const mv = e => { const r = cv.getBoundingClientRect(); hover = e.clientX - r.left; draw(); }; cv.onpointerdown = mv; cv.onpointermove = e => { if (e.pointerType === 'mouse' || e.buttons) mv(e); }; cv.onpointerleave = cv.onpointerup = () => { hover = null; draw(); }; }
      $$('[data-rng]', body).forEach(b => b.onclick = () => { bars = +b.dataset.rng; $$('[data-rng]', body).forEach(x => x.classList.toggle('on', x === b)); draw(); });
      $$('[data-what]', body).forEach(b => b.onclick = () => openTrade({ s, side: b.dataset.what }));
      const sv = $('#alSave', body); if (sv) sv.onclick = async () => { const num = v => { v = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(v) && v > 0 ? v : null; }; const buy = num($('#alBuy', body).value), sell = num($('#alSell', body).value); const list = S.watch.map(x => { if (x.s !== s) return x; const y = Object.assign({}, x); if (buy) y.buy = buy; else delete y.buy; if (sell) y.sell = sell; else delete y.sell; return y; }); if (await Store.setWatch(list)) { toast(buy || sell ? '알림을 저장했습니다.' : '알림을 해제했습니다.'); build(); } };
      const ah = $('#addHere', body); if (ah) ah.onclick = () => addWatch(s).then(build);
      const rm = $('#rmWatch', body); if (rm) rm.onclick = async () => { if (await Store.setWatch(S.watch.filter(x => x.s !== s))) { toast('목록에서 제거했습니다.'); closeSheet(); } };
      $$('[data-memo]', body).forEach(b => b.onclick = () => saveMemo(+b.dataset.memo));
      $$('[data-why]', body).forEach(b => b.onclick = () => why(+b.dataset.why));
    };
    const why = (date) => { aiBusy[date] = true; build(); const t = $('#memo' + date, body); if (t) t.focus(); };
    const saveMemo = async (date) => { const t = $('#memo' + date, body), v = t && t.value.trim(); if (!v) { toast('내용을 적어 주십시오.'); return; } const i = SV.at(H, date); if (await Store.put('moves', (s + '_' + date).replace(/[^A-Za-z0-9_]/g, '_'), { s, date, pct: H.c[i] / H.c[i - 1] - 1, reason: v, by: '직접 기록', at: new Date().toISOString() })) { aiBusy[date] = false; toast('기록했습니다.'); if (S.detail === s) build(); } };
    S.detailPaint = () => { if (S.detail !== s) return; const a = document.activeElement; if ((a && body.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) || body.querySelector('details[open]')) draw(); else build(); };
    build();
  }

  /* ───────── 가상 매매 입력 ───────── */
  function openTrade(pre) {
    pre = pre || {}; const syms = S.watch.map(w => w.s).filter(s => SV.info(s)); ['QQQ', 'TQQQ', 'SQQQ', 'SOXL', 'SPY'].forEach(s => { if (!syms.includes(s)) syms.push(s); }); if (pre.s && !syms.includes(pre.s)) syms.unshift(pre.s);
    const st = { s: pre.s || syms[0], side: pre.side || 'buy' }, tdISO = SV.iso(todayInt());
    const html = '<div class="pad" style="padding-top:16px"><div class="seg"><button data-side="buy" class="buy">샀다면</button><button data-side="sell" class="sell">팔았다면</button></div>' +
      '<div style="margin-top:14px"><label class="note">종목 — 모니터링 여부와 관계없이 미국 · 한국 전 종목에서 검색</label><div class="pickcur" id="tCur"></div><input class="inp" id="tQ" type="search" enterkeyhint="search" placeholder="종목명 · 티커 · 종목코드로 검색" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" style="font-size:14px;font-family:var(--txt);font-weight:500;margin-top:8px"><div id="tRes"></div><div class="chips" id="tQuick" style="margin-top:8px"></div></div>' +
      '<div class="field" style="margin-top:12px"><div><label>기준일 (그날 종가로 체결)</label><input class="inp" id="tD" type="date" max="' + tdISO + '" value="' + tdISO + '" style="font-size:14px"></div><div><label id="tAL">금액</label><input class="inp" id="tA" inputmode="numeric"></div></div>' +
      '<div style="margin-top:12px"><label class="note">확신도 — 이 판단이 맞을 가능성을 스스로 몇 %로 보는지</label><select class="inp" id="tC"><option value="50">50% (반반)</option><option value="60" selected>60%</option><option value="70">70%</option><option value="80">80%</option><option value="90">90% (거의 확실)</option></select></div>' +
      '<div style="margin-top:12px"><label class="note">판단 근거 (나중에 복기할 때 봅니다)</label><textarea class="inp" id="tT" placeholder="예 : 실적과 무관한 정치 이슈로 과하게 빠졌다고 봄"></textarea></div>' +
      '<div id="tPrev" class="note" style="margin-top:12px;min-height:38px"></div><button class="btn wide" id="tSave" style="margin-top:6px">이 세계선 만들기</button>' +
      '<p class="note" style="margin-top:12px">실제 주문은 나가지 않습니다. 기준일로부터 5 · 20 · 60거래일 뒤 결과를 자동으로 채점합니다. 오늘 날짜로 기록한 것만 「실시간 판단」으로 적중률에 반영하고, 지난 날짜를 고른 것은 결과를 알고 고를 수 있으므로 「과거 가정」으로 따로 보관합니다.</p></div>';
    openSheet('가상 매매', '판단을 기록하면 결과를 대신 추적합니다', html, async (b) => {
      const seg = () => $$('[data-side]', b).forEach(x => x.classList.toggle('on', x.dataset.side === st.side));
      const amt = () => { const kr = SV.market(st.s) === 'KR'; $('#tAL', b).textContent = kr ? '금액 (원)' : '금액 (달러)'; const a = $('#tA', b); if (!a.dataset.touched) a.value = kr ? '10,000,000' : '10,000'; };
      const prev = async () => {
        const d = SV.fromISO($('#tD', b).value), el = $('#tPrev', b); if (!d) { el.textContent = ''; return; }
        if (!SV.info(st.s)) { el.textContent = '이 종목의 10년 가격 이력을 받아 오는 중입니다 (보통 1~5분). 이 화면을 열어 두면 준비되는 대로 자동으로 이어집니다.'; return; }
        try { const H = await SV.hist(st.s), i = SV.atOrAfter(H, d); if (i < 0) { el.innerHTML = '선택한 날짜의 종가는 아직 없습니다. 다음 거래일 종가가 들어오면 그 값으로 체결됩니다.'; return; } const sc = await SV.scoreAt(st.s, H.d[i]); el.innerHTML = '체결 기준 : <b>' + SV.fmtDate(H.d[i]) + ' 종가 ' + SV.price(H.c[i], st.s) + '</b>' + (sc && sc.valid ? ' · 그날 타점 점수 <b>' + Math.round(sc.score) + '</b> (' + SV.grade(sc.score).t + ')' : '') + (H.d[i] < todayInt() - 3 ? '<br>지난 날짜이므로 「과거 가정」으로 기록됩니다.' : ''); } catch (e) { el.textContent = ''; }
      };
      const nameOf = x => SV.info(x) ? SV.name(x) : (st.n || Dir.name(x) || x), ready = () => !!SV.info(st.s);
      const cur = () => { $('#tCur', b).innerHTML = '<b>' + esc(nameOf(st.s)) + '</b><span>' + esc(st.s.replace(/\.K[SQ]$/, '')) + '</span>' + (ready() ? '' : '<em>가격 이력 준비 중</em>'); $('#tQuick', b).innerHTML = syms.slice(0, 10).map(x => '<button class="chip' + (x === st.s ? ' on' : '') + '" data-q="' + esc(x) + '">' + esc(SV.name(x)) + '</button>').join(''); $$('[data-q]', b).forEach(c => c.onclick = () => choose(c.dataset.q)); };
      const choose = async (x, n) => {
        st.s = x; st.n = n || null; $('#tQ', b).value = ''; $('#tRes', b).innerHTML = ''; cur(); amt(); prev();
        if (!SV.info(x)) { const ok = await Store.prep(x, n); if (st.s !== x || !$('#tCur', b)) return; cur(); if (ok) { toast('가격 이력이 준비되었습니다.'); prev(); } else if (Store.canWrite()) $('#tPrev', b).textContent = '준비가 늦어지고 있습니다. 5~10분 뒤 다시 열어 주십시오. (자동 수집이 다음 차례에 이어서 처리합니다.)'; }
      };
      let tq; $('#tQ', b).oninput = e => { const q = e.target.value; clearTimeout(tq); tq = setTimeout(() => { const el = $('#tRes', b); if (!el) return; if (!q.trim()) { el.innerHTML = ''; return; } const paintT = () => { if (!$('#tRes', b) || $('#tQ', b).value !== q) return; el.innerHTML = resultsHTML(q, null, '선택'); $$('[data-pick]', el).forEach(r => r.onclick = () => choose(r.dataset.pick, r.dataset.name)); }; if (!Dir.list) Dir.load().then(paintT); paintT(); }, 60); };
      seg(); cur(); amt(); prev();
      $$('[data-side]', b).forEach(x => x.onclick = () => { st.side = x.dataset.side; seg(); });
      $('#tD', b).onchange = prev; $('#tA', b).oninput = e => { e.target.dataset.touched = 1; };
      $('#tSave', b).onclick = async () => {
        const date = SV.fromISO($('#tD', b).value), amount = parseFloat($('#tA', b).value.replace(/,/g, '')); if (!date) { toast('기준일을 선택해 주십시오.'); return; } if (!(amount > 0)) { toast('금액을 입력해 주십시오.'); return; } if (!SV.info(st.s)) { toast('가격 이력이 준비된 뒤에 저장할 수 있습니다.'); return; }
        const btn = $('#tSave', b); btn.disabled = true; let entry = null, score = null, ed = date;
        try { const H = await SV.hist(st.s), i = SV.atOrAfter(H, date); if (i >= 0) { entry = H.c[i]; ed = H.d[i]; const sc = await SV.scoreAt(st.s, ed); if (sc && sc.valid) score = sc.score; } } catch (e) { }
        const id = 't' + Date.now().toString(36), t = { s: st.s, side: st.side, date: ed, amount, cur: SV.market(st.s) === 'KR' ? 'KRW' : 'USD', conf: +$('#tC', b).value, thesis: $('#tT', b).value.trim().slice(0, 500), createdAt: new Date().toISOString(), live: date >= todayInt() - 3 };
        if (entry) t.price = entry; if (score != null) t.score = score;
        if (await Store.put('trades', id, t)) { S.sel = id; S.tab = 'uni'; tabsUI(); closeSheet(); toast('세계선을 만들었습니다.'); } else btn.disabled = false;
      };
    });
  }

  /* ───────── 유니버스 ───────── */
  const evalCache = {}; let evalKey = '';
  async function evalAll() {
    const key = S.trades.map(t => t.id + ':' + t.date + ':' + (t.price || '')).join('|') + '#' + SV.tail.asof; if (key === evalKey) return; evalKey = key;
    await Promise.all(S.trades.map(async t => { try { evalCache[t.id] = await SV.evalTrade(t); } catch (e) { evalCache[t.id] = { pending: true, reason: '이 종목의 가격 이력이 아직 없습니다' }; } })); render();
  }
  const verdict = R => !R || R.pending ? ['wait', '대기'] : R.final ? (R.judged.win ? ['hit', '적중'] : ['miss', '빗나감']) : ['wait', '진행 중'];
  function paintUni() {
    const v = $('#v-uni'); evalAll();
    const list = S.trades.slice().sort((a, b) => (b.date - a.date) || (b.createdAt > a.createdAt ? 1 : -1));
    if (!list.length) { v.innerHTML = note() + '<div class="empty" style="padding-top:60px">' + (S.loaded.trades ? '아직 만든 세계선이 없습니다.<br>오른쪽 아래 「가상 매매」로 「그날 샀다면 · 팔았다면」을 기록해 보십시오.' : '불러오는 중입니다.') + '</div>'; return; }
    if (!S.sel || !list.some(t => t.id === S.sel)) S.sel = list[0].id;
    const t = list.find(x => x.id === S.sel), R = evalCache[t.id], nm = SV.name(t.s), sell = t.side === 'sell';
    let top = '<div class="world pad"><div class="q">' + SV.fmtDate(t.date) + ', <em>' + esc(nm) + '</em>' + (sell ? ' 을(를) 팔았다면' : ' 을(를) ' + SV.money(t.amount, t.cur).replace(/^[+−]/, '') + ' 샀다면') + '</div>';
    if (!R) top += '<div class="skel" style="margin-top:14px"></div><div class="skel" style="width:70%"></div>';
    else if (R.pending) top += '<p class="note" style="margin-top:10px">' + esc(R.reason || '체결 기준일의 종가를 기다리는 중입니다.') + '</p>';
    else {
      const [vk, vt] = verdict(R);
      top += '<div class="a"><span class="big num ' + cls(R.ret) + '">' + SV.pct(R.ret) + '</span><span class="sm">' + (R.pnl != null ? '<b class="num ' + cls(R.pnl) + '">' + SV.money(R.pnl, t.cur) + '</b> · ' : '') + R.days + '거래일 경과 · <span class="j ' + vk + '">' + vt + '</span></span></div>' +
        '<p class="note" style="margin-top:4px">' + (sell ? '팔지 않고 들고 있었다면 ' + SV.pct(R.raw) + ' 였습니다. ' + (R.ret > 0 ? '판 것이 유리했습니다.' : R.ret < 0 ? '들고 있는 편이 유리했습니다.' : '') : '체결가 ' + SV.price(R.entry, t.s) + ' → 현재 ' + SV.price(R.last, t.s) + '. 같은 날 ' + (SV.market(t.s) === 'KR' ? '코스피' : 'QQQ') + '를 샀다면 ' + SV.pct(R.bench) + '.') + '</p>' +
        '<canvas id="worlds"></canvas><div class="wl"><span><i style="background:var(--accent)"></i>' + (sell ? '판 세계 (현금)' : '산 세계') + '</span><span><i style="background:var(--ink3)"></i>' + (sell ? '안 판 세계 (계속 보유)' : '안 산 세계 (현금)') + '</span><span><i style="background:var(--warn)"></i>' + (SV.market(t.s) === 'KR' ? '코스피' : 'QQQ') + '를 산 세계</span></div>' +
        '<div class="hz">' + SV.HORIZONS.map(hz => { const x = R.hz[hz]; return '<div><div class="k">' + hz + '거래일 뒤' + (x ? ' · ' + SV.fmtDateShort(x.date) : '') + '</div><div class="v ' + (x ? cls(x.ret) : 'mute') + '">' + (x ? SV.pct(x.ret) : '–') + '</div><div class="j ' + (x ? (x.win ? 'hit' : 'miss') : 'wait') + '">' + (x ? (x.win ? '적중' : '빗나감') : (hz - R.days) + '거래일 남음') + '</div></div>'; }).join('') + '</div>' +
        '<p class="note" style="margin-top:10px">도중 최고 ' + SV.pct(R.best) + ' (' + SV.fmtDateShort(R.bestDate) + ') · 최저 ' + SV.pct(R.worst) + ' (' + SV.fmtDateShort(R.worstDate) + ')' + (t.score != null ? ' · 기록 당시 타점 점수 ' + Math.round(t.score) : '') + ' · 확신도 ' + (t.conf || '–') + '%</p>' +
        (t.thesis ? '<p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:var(--ink2)">근거 : ' + esc(t.thesis) + '</p>' : '');
    }
    top += '<div class="btnrow"><button class="btn sm line" data-chart="' + esc(t.s) + '">종목 화면</button><button class="btn sm line" id="delT">이 세계선 삭제</button></div></div>';
    const rows = list.map(x => { const r = evalCache[x.id], [vk, vt] = verdict(r); return '<button class="urow' + (x.id === S.sel ? ' sel' : '') + '" data-sel="' + esc(x.id) + '"><div style="min-width:0"><div class="t">' + esc(SV.name(x.s)) + ' ' + (x.side === 'sell' ? '팔았다면' : '샀다면') + (x.example ? '<span class="ex">예시</span>' : x.live ? '' : '<span class="ex" style="color:var(--ink3);background:var(--sunk)">과거 가정</span>') + '</div><div class="m">' + SV.fmtDate(x.date) + '</div></div><canvas data-path="' + esc(x.id) + '"></canvas><div class="rt ' + (r && !r.pending ? cls(r.ret) : 'mute') + '">' + (r && !r.pending ? SV.pct(r.ret) : '–') + '<small class="j ' + vk + '">' + vt + '</small></div></button>'; }).join('');
    v.innerHTML = note() + top + '<div class="pad"><h2 class="sec">내 세계선 <small>' + list.length + '개</small></h2></div><div class="sheetlist pad">' + rows + '</div><div class="pad"><p class="note" style="margin-top:14px">적중 판정은 20거래일 뒤 기준입니다. 「샀다면」은 올랐으면 적중, 「팔았다면」은 내렸으면 적중으로 봅니다.</p></div><div style="height:70px"></div>';
    const cv = $('#worlds', v); if (cv && R && !R.pending) drawWorlds(cv, R, t);
    $$('[data-path]', v).forEach(c => { const r = evalCache[c.dataset.path], x = S.trades.find(q => q.id === c.dataset.path); if (r && !r.pending && r.path.r.length > 1) { const a = r.path.r.map(z => x.side === 'sell' ? -z : z); spark(c, a, a[a.length - 1] >= 0 ? css('--up') : css('--down')); } });
  }

  /* ───────── 기록 (채점) ───────── */
  function stats(arr) { const fin = arr.filter(x => x.R && !x.R.pending && x.R.final); const w = fin.filter(x => x.R.judged.win).length; const avg = a => a.length ? a.reduce((p, c) => p + c, 0) / a.length : NaN; return { n: arr.length, fin: fin.length, win: w, rate: fin.length ? w / fin.length : NaN, avg: avg(fin.map(x => x.R.judged.ret)), ex: avg(fin.filter(x => x.t.side !== 'sell').map(x => x.R.judged.raw - x.R.judged.bench)) }; }
  function paintRec() {
    const v = $('#v-rec'); evalAll();
    const all = S.trades.filter(t => !t.example).map(t => ({ t, R: evalCache[t.id] })), live = all.filter(x => x.t.live), hypo = all.filter(x => !x.t.live), ex = S.trades.filter(t => t.example).map(t => ({ t, R: evalCache[t.id] }));
    const st = stats(live), base = SV.model.US.base.winH;
    const line = (lb, s) => '<div class="brk"><span class="lb">' + lb + '</span><span>' + s.fin + '건</span><span>' + (s.fin ? (s.rate * 100).toFixed(0) + '%' : '–') + '</span><span class="' + cls(s.avg) + '">' + (s.fin ? SV.pct(s.avg) : '–') + '</span></div>';
    const by = (fn) => { const m = {}; live.forEach(x => { const k = fn(x); if (k == null) return; (m[k] = m[k] || []).push(x); }); return m; };
    const side = by(x => x.t.side === 'sell' ? '「팔았다면」 판단' : '「샀다면」 판단'), sc = by(x => x.t.score == null ? null : x.t.score >= 85 ? '타점 85점 이상에서 기록' : '타점 85점 미만에서 기록'), cf = by(x => x.t.conf >= 80 ? '확신도 80% 이상' : x.t.conf >= 60 ? '확신도 60~70%' : '확신도 50%'), tk = by(x => SV.name(x.t.s));
    const ins = [];
    if (!st.fin) ins.push('확정된 실시간 판단이 아직 없습니다. 오늘 날짜로 가상 매매를 기록하면 20거래일 뒤부터 적중률이 집계됩니다.');
    else {
      if (st.fin < 10) ins.push('확정 판단이 ' + st.fin + '건입니다. 10건 미만에서는 운의 영향이 커서 적중률을 실력으로 해석하기 이릅니다.');
      ins.push('아무 날에나 미국 종목을 샀을 때 20거래일 뒤 오른 비율은 약 ' + (base * 100).toFixed(0) + '% 입니다. 「샀다면」 적중률이 이 수준을 넘어야 판단이 보탬이 된 것입니다.');
      if (Number.isFinite(st.ex)) ins.push('「샀다면」 판단의 20거래일 수익률은 같은 날 지수를 산 경우보다 평균 ' + SV.pct(st.ex) + (st.ex > 0 ? ' 높았습니다.' : ' 낮았습니다.'));
      const hi = cf['확신도 80% 이상'] && stats(cf['확신도 80% 이상']); if (hi && hi.fin >= 3) ins.push('확신도 80% 이상으로 기록한 판단의 실제 적중률은 ' + (hi.rate * 100).toFixed(0) + '% 입니다. ' + (hi.rate < 0.7 ? '확신에 비해 결과가 낮으므로 확신이 클 때 금액을 키우는 것은 주의가 필요합니다.' : '확신과 결과가 대체로 맞습니다.'));
    }
    const calib = [50, 60, 70, 80, 90].map(c => { const s = stats(live.filter(x => x.t.conf === c)); return s.fin ? '<div class="brk" style="grid-template-columns:70px minmax(0,1fr) 54px"><span class="lb">' + c + '%</span><div class="meter" style="margin:0"><i style="width:' + (s.rate * 100).toFixed(0) + '%"></i><u style="left:' + c + '%"></u></div><span>' + (s.rate * 100).toFixed(0) + '%</span></div>' : ''; }).join('');
    const tl = all.concat(ex).sort((a, b) => b.t.date - a.t.date).map(x => { const [vk, vt] = verdict(x.R), R = x.R; return '<button class="urow" data-go="' + esc(x.t.id) + '" style="grid-template-columns:minmax(0,1fr) 78px"><div style="min-width:0"><div class="t">' + esc(SV.name(x.t.s)) + ' ' + (x.t.side === 'sell' ? '팔았다면' : '샀다면') + (x.t.example ? '<span class="ex">예시</span>' : x.t.live ? '' : '<span class="ex" style="color:var(--ink3);background:var(--sunk)">과거 가정</span>') + '</div><div class="m">' + SV.fmtDate(x.t.date) + (x.t.conf ? ' · 확신 ' + x.t.conf + '%' : '') + (x.t.score != null ? ' · 타점 ' + Math.round(x.t.score) : '') + '</div></div><div class="rt ' + (R && !R.pending ? cls(R.ret) : 'mute') + '">' + (R && !R.pending ? SV.pct(R.judged ? R.judged.ret : R.ret) : '–') + '<small class="j ' + vk + '">' + vt + '</small></div></button>'; }).join('');
    v.innerHTML = note() + '<div class="score pad"><div class="note" style="font-weight:700;color:var(--ink3);letter-spacing:.04em">내 판단 적중률 · 20거래일 기준</div><div class="big" style="margin-top:6px"><b class="num">' + (st.fin ? (st.rate * 100).toFixed(0) : '–') + '<span style="font-size:22px;font-family:var(--num);font-weight:800;padding:0;color:inherit">%</span></b><span>확정 ' + st.fin + '건 중 ' + st.win + '건 적중<br>진행 중 ' + (st.n - st.fin) + '건</span></div><div class="meter"><i style="width:' + (st.fin ? (st.rate * 100).toFixed(0) : 0) + '%"></i><u style="left:' + (base * 100).toFixed(0) + '%"></u></div><div class="note" style="margin-top:5px">세로선 = 아무 날에나 샀을 때의 기준선 ' + (base * 100).toFixed(0) + '%</div>' +
      '<div class="kv"><div><div class="k">평균 수익률</div><div class="v ' + cls(st.avg) + '">' + (st.fin ? SV.pct(st.avg) : '–') + '</div></div><div><div class="k">지수 대비</div><div class="v ' + cls(st.ex) + '">' + (Number.isFinite(st.ex) ? SV.pct(st.ex) : '–') + '</div></div><div><div class="k">과거 가정 실험</div><div class="v">' + hypo.length + '건</div></div></div></div>' +
      '<div class="pad"><h2 class="sec">읽는 법</h2></div><div class="sheetlist pad">' + ins.map(i => '<div class="insight">' + esc(i) + '</div>').join('') + '</div>' +
      (st.fin ? '<div class="pad"><h2 class="sec">구분별 성적</h2></div><div class="sheetlist pad"><div class="brk h"><span class="lb">구분</span><span>확정</span><span>적중률</span><span>평균</span></div>' + [side, sc, cf, tk].map(g => Object.keys(g).map(k => line(esc(k), stats(g[k]))).join('')).join('') + '</div>' : '') +
      (calib ? '<div class="pad"><h2 class="sec">확신도 점검 <small>막대 = 실제 적중률, 세로선 = 내가 말한 확신도</small></h2></div><div class="sheetlist pad">' + calib + '</div>' : '') +
      '<div class="pad"><h2 class="sec">전체 기록</h2></div><div class="sheetlist pad">' + (tl || '<div class="empty">기록이 없습니다.</div>') + '</div>' +
      '<div class="pad"><p class="note" style="margin-top:14px">「과거 가정」과 「예시」는 결과를 알고 고를 수 있으므로 적중률에 넣지 않습니다. 이 기록은 판단 연습용이며 수익을 보장하지 않습니다.</p></div>';
  }

  /* ───────── 알림 ───────── */
  function openAlerts() {
    const list = S.alerts.slice().sort((a, b) => (b.at > a.at ? 1 : -1)).slice(0, 60);
    openSheet('알림', '가격 조건 · 급등락 · 공시 · 실적', '<div class="sheetlist pad" style="margin-top:10px">' + (list.length ? list.map(a => '<button class="alog' + (a.seen ? '' : ' new') + '" data-open="' + esc(a.s || '') + '"' + (a.u ? ' data-u="' + esc(a.u) + '"' : '') + ' style="width:100%;text-align:left"><div><b>' + esc(a.msg || '') + '</b>' + (a.detail ? '<div class="note">' + esc(a.detail) + '</div>' : '') + '</div><small>' + esc((a.at || '').slice(5, 16).replace('T', ' ').replace('-', '. ')) + '</small></button>').join('') : '<div class="empty">아직 알림이 없습니다.<br>종목 화면에서 매수 타점 · 매도 가격을 설정하십시오.</div>') + '</div><div class="pad"><p class="note" style="margin-top:14px">같은 내용이 ntfy 앱으로 휴대폰에 전달됩니다 (5분 간격 점검, 장 마감 뒤 요약). 공시 알림을 누르면 DART 원문이 열립니다.</p></div>', (b) => {
      $$('[data-open]', b).forEach(x => x.onclick = () => { if (x.dataset.u) window.open(x.dataset.u, '_blank', 'noopener'); else if (x.dataset.open) openDetail(x.dataset.open); });
      try { localStorage.setItem('ju_seen', new Date().toISOString()); } catch (e) { } S.alerts.forEach(a => { a.seen = true; }); render();
    });
  }

  /* ───────── 이벤트 ───────── */
  function tabsUI() { $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === S.tab)); $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + S.tab)); try { localStorage.setItem('ju_tab', S.tab); } catch (e) { } }
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.tab = b.dataset.t; tabsUI(); const mn = $('#main'); mn.classList.remove('enter'); void mn.offsetWidth; mn.classList.add('enter'); clearTimeout(mn._t); mn._t = setTimeout(() => mn.classList.remove('enter'), 900); $('#main').scrollTop = 0; render(); };
  $('#sheetBack').onclick = closeSheet; $('#bellBtn').onclick = openAlerts; $('#liveBtn').onclick = openSettings; $('#fab').onclick = () => openTrade({});
  $('#main').addEventListener('click', async e => {
    const t = e.target.closest('[data-issue],[data-cat],[data-open],[data-pick],[data-sym],[data-sel],[data-go],[data-chart],#delT'); if (!t) return;
    if (t.dataset.issue) { S.openIssue = S.openIssue === t.dataset.issue ? null : t.dataset.issue; if (e.target.closest('a')) return; render(); }
    else if (t.dataset.cat) { S.issueFilter = t.dataset.cat; render(); }
    else if (t.dataset.open) openDetail(t.dataset.open);
    else if (t.dataset.sym) openDetail(t.dataset.sym);
    else if (t.dataset.pick) addWatch(t.dataset.pick, t.dataset.name);
    else if (t.dataset.sel) { S.sel = t.dataset.sel; $('#main').scrollTop = 0; render(); }
    else if (t.dataset.go) { S.sel = t.dataset.go; S.tab = 'uni'; tabsUI(); $('#main').scrollTop = 0; render(); }
    else if (t.dataset.chart) openDetail(t.dataset.chart);
    else if (t.id === 'delT') { if (t.dataset.arm) { const id = S.sel; S.sel = null; await Store.del('trades', id); toast('삭제했습니다.'); } else { t.dataset.arm = 1; t.textContent = '한 번 더 누르면 삭제'; setTimeout(() => { if (t.isConnected) { delete t.dataset.arm; t.textContent = '이 세계선 삭제'; } }, 3000); } }
  });
  let qT; $('#main').addEventListener('input', e => { if (e.target.id === 'q') { S.q = e.target.value; clearTimeout(qT); qT = setTimeout(paintRes, 60); } });
  let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(render, 150); });
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

  /* ───────── 시작 ───────── */
  (async function boot() {
    try { const t = localStorage.getItem('ju_tab'); if (t && $('#v-' + t)) { S.tab = t; tabsUI(); } } catch (e) { }
    $('#v-' + S.tab).innerHTML = '<div class="pad" style="padding-top:24px"><div class="skel"></div><div class="skel" style="width:70%"></div><div class="skel" style="width:85%"></div></div>';
    try { await SV.init(); SVok = true; } catch (e) { $('#v-' + S.tab).innerHTML = '<div class="empty">시세 데이터를 불러오지 못했습니다. 화면을 새로 열어 주십시오.</div>'; return; }
    await Store.init(); preload(); render(); liveUI();
  })();
  window.__sv = { S, Store, GH, render, openDetail, openTrade, openSettings };
})();
