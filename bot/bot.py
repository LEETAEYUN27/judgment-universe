#!/usr/bin/env python3
# 판단 유니버스 — 깃허브 자동 실행 봇
#   python3 bot/bot.py fast   : 5분 간격. 현재가 · 가격 알림 · 장중 급등락 · DART 공시 · 새 종목 이력 · (매시) 컨센서스
#   python3 bot/bot.py daily  : 장 마감 후. 일봉 꼬리 · 기사 · 공매도 · 급등락 사유 · 이슈 · 일정 · 요약
# 입력 : state/ (사용자 기록, watch.json · trades.json)   출력 : live/ (fast.json · daily.json · fund.json · idxx.json · hist/*.json)
# 환경 변수 : GROQ_API_KEY, DART_API_KEY, NTFY_TOPIC, APP_URL (모두 없어도 동작하되 해당 기능만 건너뜀)
import os, sys, json, time, re, urllib.request, urllib.parse, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = os.environ.get("LIVE_DIR", os.path.join(ROOT, "live")); STATE = os.environ.get("STATE_DIR", os.path.join(ROOT, "state"))
GROQ = os.environ.get("GROQ_API_KEY", ""); DART = os.environ.get("DART_API_KEY", ""); NTFY = os.environ.get("NTFY_TOPIC", ""); APP = os.environ.get("APP_URL", "")
KST = 9 * 3600
now_iso = lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
kst_day = lambda: int(time.strftime("%Y%m%d", time.gmtime(time.time() + KST)))

def load(p, d):
    try: return json.load(open(p, encoding="utf-8"))
    except Exception: return d
def save(p, o):
    os.makedirs(os.path.dirname(p), exist_ok=True); json.dump(o, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
def index():
    idx = load(os.path.join(ROOT, "data", "idx.json"), {"list": []})["list"]; ext = load(os.path.join(LIVE, "idxx.json"), {"list": []})["list"]
    return idx, ext, {x["s"]: x for x in idx + ext}
def name_of(known, s, w=None): x = known.get(s) or {}; return x.get("k") or (w or {}).get("n") or x.get("n") or s
def money(s, p): return (f"{round(p):,}원" if is_kr(s) else f"${p:,.2f}")

def notify(title, body, tags="", prio=3, click=None):
    print("NOTIFY", title, "|", body)
    if not NTFY: return
    try:
        req = urllib.request.Request("https://ntfy.sh/", data=json.dumps({"topic": NTFY, "title": title, "message": body, "priority": prio, "tags": [t for t in tags.split(",") if t], "click": click or APP or None}).encode("utf-8"), headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e: print("ntfy 실패", e)

def groq(prompt, js=False, max_tokens=1800, models=("openai/gpt-oss-120b", "qwen/qwen3.8-27b")):
    """Groq 호출. JSON 모드가 거절되면 일반 모드로 받아 본문에서 JSON 을 추려 냄. 모델 두 개를 차례로 시도."""
    if not GROQ: return None
    sysm = "당신은 한국어 금융 편집자입니다. 주어진 자료에 있는 사실만 사용하고, 자료에 없는 수치나 사건을 지어내지 않습니다. 매수·매도 권유를 쓰지 않습니다. 문체는 한국어 공식 문어체 개조식(「~함」「~임」)입니다."
    for k, (model, mode) in enumerate([(models[0], js), (models[0], js), (models[0], False), (models[1], False)]):
        body = {"model": model, "messages": [{"role": "system", "content": sysm}, {"role": "user", "content": prompt}], "temperature": 0.2, "max_tokens": max_tokens + (1200 if "gpt-oss" in model else 0)}
        if mode: body["response_format"] = {"type": "json_object"}
        try:
            req = urllib.request.Request("https://api.groq.com/openai/v1/chat/completions", data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + GROQ, "Content-Type": "application/json", "User-Agent": "judgment-universe-bot"})
            t = (json.loads(urllib.request.urlopen(req, timeout=120).read())["choices"][0]["message"]["content"] or "").strip()
            if not js: return t or None
            m = re.search(r"\{.*\}", t, re.S); return json.loads(m.group(0))
        except urllib.error.HTTPError as e:
            msg = e.read()[:300].decode("utf-8", "replace"); print("groq 실패", k, model, e.code, msg); w = re.search(r"try again in ([0-9.]+)s", msg)
            time.sleep(min(60, float(w.group(1)) + 2) if w else 5)
        except Exception as e: print("groq 실패", k, model, str(e)[:200]); time.sleep(3)
    return None

# ───── 공통 ─────
def state():
    w = load(os.path.join(STATE, "watch.json"), {"list": []}); t = load(os.path.join(STATE, "trades.json"), {"list": []})["list"]
    watch = w.get("list") or []; have = {x["s"] for x in watch}
    extra = [x for x in (w.get("prep") or []) if x.get("s") and x["s"] not in have]; seen = {x["s"] for x in extra} | have
    extra += [{"s": x["s"]} for x in t if x.get("s") and x["s"] not in seen and not seen.add(x["s"])]
    return watch, extra, t
def news_q(known, s, w=None):
    x = known.get(s) or {}; nm = name_of(known, s, w)
    u = re.search(r"\b(?:Long|Short|Bull|Bear|Target)\s+(?:\dX\s+)?(?:Long\s+|Short\s+)?([A-Z]{2,5})\b", x.get("n") or "")   # 단일 종목 레버리지 상품은 기초 종목 기사로 찾음
    if u and u.group(1) not in ("ETF", "ETN", "DAILY"): return u.group(1) + " stock"
    return (nm + " 주가") if is_kr(s) else (re.sub(r",? (Inc\.?|Corporation|Corp\.?|Holdings|plc|Ltd\.?|Daily ETF|ETF).*$", "", x.get("n") or s) + " stock")
def iso(d, off=0):
    t = time.mktime(time.strptime(str(d), "%Y%m%d")) + off * 86400; return time.strftime("%Y-%m-%d", time.localtime(t))
def refresh_news(watch, known, FU, only=None):
    """여러 출처에서 기사를 모으고 영어 제목을 한국어로 번역 (이미 번역한 제목은 재사용)"""
    for w in watch:
        s = w["s"]
        if (only is not None and s not in only) or s not in known: continue
        x = known[s]; f = FU.setdefault(s, {"s": s}); old = {n["t"]: n.get("ko") for n in f.get("news") or [] if n.get("ko")}
        und = underlying(x.get("n") or "")
        got = feeds(und, und, False) if und else feeds(s, x.get("n") or s, is_kr(s), x.get("k") or "")
        if got:
            for n in got:
                if old.get(n["t"]): n["ko"] = old[n["t"]]
            f["news"] = got; f["at"] = now_iso()
        time.sleep(0.3)
    tr = [(s, i, n["t"]) for s, f in FU.items() for i, n in enumerate(f.get("news") or []) if not n.get("ko") and not re.search(r"[가-힣]", n["t"]) and (only is None or s in only)][:120]
    for b in range(0, len(tr), 30):
        part = tr[b:b + 30]
        r = groq("다음 영어 기사 제목을 자연스러운 한국어 제목으로 번역할 것. 회사명은 한국에서 통용되는 표기를 쓰고, 원문에 없는 내용을 덧붙이지 말 것. 번호를 키로 하는 JSON 객체 하나만 출력 (예 : {\"1\":\"...\"}).\n" + "\n".join(f"{k + 1}. {t[2]}" for k, t in enumerate(part)), js=True, max_tokens=3000)
        for k, (s, i, _) in enumerate(part):
            if r and r.get(str(k + 1)): FU[s]["news"][i]["ko"] = str(r[str(k + 1)])[:160]
def underlying(n):
    u = re.search(r"\b(?:Long|Short|Bull|Bear|Target)\s+(?:\dX\s+)?(?:Long\s+|Short\s+)?([A-Z]{2,5})\b", n or "")
    return u.group(1) if u and u.group(1) not in ("ETF", "ETN", "DAILY") else None
def tidy(t):
    t = re.sub(r"\s*\((?:\[?\d+\]?[,\s]*)+\)", "", t or ""); t = re.sub(r"\[\d+\]", "", t)
    t = re.sub(r"\s+", " ", t); t = re.sub(r"(?:^|(?<=[.!?]))\s*[.,]\s*", " ", t); return re.sub(r"\s{2,}", " ", t).strip(" .") + ("." if t.strip(" .") else "")
def evidence(hl):
    return "\n".join(f"[{i + 1}] ({h.get('at', '')[:11]}, {h.get('src', '')}) {h['t']}" + (f" — {h['d']}" if h.get("d") else "") for i, h in enumerate(hl))
def verify(text, hl):
    """검증 단계 : 다른 모델에게 근거 기사와 대조시켜, 근거에 없는 문장을 지움. 남는 문장이 없으면 None."""
    if not text or not hl: return text
    r = groq("아래 [요약]의 각 문장이 [근거 기사]에 실제로 적힌 내용만으로 뒷받침되는지 검사할 것. 근거에 없는 인물명 · 수치 · 사건 · 인과관계가 들어간 문장은 unsupported 로 분류할 것. JSON 하나만 출력 : {\"keep\":[뒷받침되는 문장 원문 그대로],\"drop\":[뒷받침되지 않는 문장 원문 그대로]}\n\n[요약]\n" + text + "\n\n[근거 기사]\n" + evidence(hl), js=True, max_tokens=900, models=("qwen/qwen3.8-27b", "openai/gpt-oss-120b"))
    if not r or not isinstance(r.get("drop"), list): return text
    out = text
    for d in r["drop"]:
        d = str(d).strip()
        if d and d in out: out = out.replace(d, "")
    out = tidy(out)
    if out != text: print("검증에서 삭제 :", r["drop"])
    return out or None
def find_moves(s, rows, have, nbars=30):
    out = []
    for i in range(max(1, len(rows) - nbars), len(rows)):
        pct = rows[i][4] / rows[i - 1][4] - 1; mid = f"{fid(s)}_{rows[i][0]}"
        if abs(pct) >= 0.05 and mid not in have: out.append({"id": mid, "s": s, "date": rows[i][0], "pct": round(pct, 4)})
    return out
def explain(D, known, cands, limit=10):
    """급등락 사유 : 그 날짜 전후 기사(여러 출처 · 여러 검색어)를 모아 Groq 로 정리하고, 다른 모델로 근거 대조 검증."""
    moves = D.setdefault("moves", []); done = []
    for m in sorted(cands, key=lambda x: -x["date"])[:limit]:
        s = m["s"]; x = known.get(s) or {}; nm = name_of(known, s); und = underlying(x.get("n") or ""); rng = (iso(m["date"], -1), iso(m["date"], 2))
        hl = (feeds(und, und, False, "", rng, 10) if und else feeds(s, x.get("n") or s, is_kr(s), x.get("k") or "", rng, 10))
        why = groq(f"{nm}({s}) 주가가 {m['date']} 에 하루 동안 {m['pct'] * 100:+.1f}% 움직였음." + (f" 이 상품은 {und} 주가를 배수로 따르는 상품임." if und else "") + " 아래는 그 날짜 전후에 나온 기사임. 이 기사에 실제로 적힌 내용만 근거로 주가가 움직인 원인을 2~3문장으로 정리할 것. 기사에 없는 인물명 · 수치 · 세부 사항은 쓰지 말고, 기사 번호도 쓰지 말 것. 주가가 움직인 날보다 뒤에 일어난 일은 원인으로 쓰지 말 것. 기사만으로 원인을 특정할 수 없으면 「기사만으로는 원인을 특정할 수 없음」이라고만 쓸 것. 문장은 「~함」「~됨」「~있음」처럼 자연스러운 개조식으로 끝낼 것.\n" + evidence(hl), max_tokens=400) if hl else None
        if not why and hl: continue   # 일시 실패 : 다음 실행 때 다시 시도
        if why: why = tidy(verify(why, hl) or "") or "기사만으로는 원인을 특정할 수 없음."
        moves.append({"id": m["id"], "s": s, "date": m["date"], "pct": m["pct"], "reason": why or "그 날짜 전후의 기사를 찾지 못함.", "by": "기사 근거 자동 분석 · 교차 검증 (Groq)", "src": [{"t": (h.get("ko") or h["t"])[:70], "u": h["u"]} for h in hl[:3]]}); done.append(m["id"])
        time.sleep(2)
    D["moves"] = moves[-500:]; return done
ROWS = {}
def ensure_hist(watch, ext, known):
    added = []; ROWS.clear()
    for w in watch:
        s = w["s"]
        if s in known: continue
        try:
            m, rows = prices(s, 4000); rows = [r for r in rows if r[0] >= 20160101]
            if len(rows) < 30: continue
            kr = is_kr(s); rows = rnd(rows, kr); f = fid(s)
            save(os.path.join(LIVE, "hist", f + ".json"), {"d": [r[0] for r in rows], "o": [r[1] for r in rows], "h": [r[2] for r in rows], "l": [r[3] for r in rows], "c": [r[4] for r in rows], "v": [r[5] for r in rows]})
            it = {"s": s, "f": f, "n": (m.get("name") if m.get("name") != s else None) or w.get("n") or (None if kr else us_name(s)) or s, "k": krname(s[:6]) if kr else "", "m": "KR" if kr else "US", "cur": m.get("cur") or ("KRW" if kr else "USD"), "last": rows[-1][0], "db": True}
            ext.append(it); known[s] = it; added.append(s); ROWS[s] = rows
        except Exception as e: print("새 종목 이력 실패", s, e)
    if added: save(os.path.join(LIVE, "idxx.json"), {"list": ext})
    return added

# ───── 미국 종목 컨센서스 · 실적 (나스닥) ─────
def nasdaq_cons(sym):
    num = lambda x: float(re.sub(r"[^0-9.\-]", "", str(x)) or 0); o = {}
    try:
        c = json.loads(get(f"https://api.nasdaq.com/api/analyst/{sym}/targetprice"))["data"]["consensusOverview"]
        o["target"] = {"avg": c["priceTarget"], "low": c["lowPriceTarget"], "high": c["highPriceTarget"], "buy": c["buy"], "hold": c["hold"], "sell": c["sell"]}
    except Exception: pass
    try:
        e = json.loads(get(f"https://api.nasdaq.com/api/quote/{sym}/eps"))["data"]["earningsPerShare"]
        o["eps"] = [{"type": x["type"], "period": x["period"], "est": x.get("consensus"), "act": x.get("earnings") if x["type"] == "PreviousQuarter" else None} for x in e][-6:]
    except Exception: pass
    try:
        d = json.loads(get(f"https://api.nasdaq.com/api/analyst/{sym}/earnings-date"))["data"]; m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})\s*(after market close|before market open)?", d.get("reportText") or "")
        if m: o["next"] = {"d": int(m.group(3)) * 10000 + int(m.group(1)) * 100 + int(m.group(2)), "when": {"after market close": "장 마감 후", "before market open": "장 시작 전"}.get(m.group(4) or "", "")}
    except Exception: pass
    return o

# ───── DART 공시 : 시장 전체 최신 목록에서 모니터링 종목만 추림 ─────
def dart_new(watch, known, F):
    if not DART: return []
    kr = {w["s"][:6]: w["s"] for w in watch if is_kr(w["s"])}
    if not kr: return []
    last = F.get("dart_last") or ""; out = []; top = last; first = not last
    bgn = time.strftime("%Y%m%d", time.gmtime(time.time() + KST - (2 if first else 1) * 86400))
    for page in range(1, 31 if first else 9):
        try: j = json.loads(get(f"https://opendart.fss.or.kr/api/list.json?crtfc_key={DART}&bgn_de={bgn}&page_count=100&page_no={page}", 20))
        except Exception as e: print("DART 조회 실패", e); break
        rows = j.get("list") or []; stop = False
        for it in rows:
            if it["rcept_no"] <= last: stop = True; continue
            top = max(top, it["rcept_no"]); s = kr.get((it.get("stock_code") or "").strip())
            if s: out.append({"s": s, "name": name_of(known, s), "title": re.sub(r"\s+", " ", it["report_nm"]).strip(), "date": int(it["rcept_dt"]), "no": it["rcept_no"], "u": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=" + it["rcept_no"]})
        if stop or page >= int(j.get("total_page") or 1): break
        time.sleep(0.1)
    F["dart_last"] = top; out.sort(key=lambda x: x["no"])
    return out

# ═════ 5분 작업 ═════
def fast():
    watch, extra, trades = state(); idx, ext, known = index()
    F = load(os.path.join(LIVE, "fast.json"), {}); FU = load(os.path.join(LIVE, "fund.json"), {}); first = not F.get("at"); fund_dirty = False
    added = ensure_hist(watch + extra, ext, known)
    if added:
        D = load(os.path.join(LIVE, "daily.json"), {}); have = {m["id"] for m in D.get("moves") or []}; cands = []
        for s in added: cands += find_moves(s, ROWS.get(s) or [], have)
        wa = [w for w in watch if w["s"] in added]
        if wa: refresh_news(wa, known, FU); fund_dirty = True
        if cands and explain(D, known, cands, 8): save(os.path.join(LIVE, "daily.json"), D)
        if not first: notify("새 종목 준비 완료", ", ".join(name_of(known, s) for s in added) + " — 차트 · 타점 점수 · 가상 매매 사용 가능", "chart_with_upwards_trend", 2)
    syms = []; [syms.append(s) for s in [w["s"] for w in watch] + CORE + [x["s"] for x in extra] if s not in syms]
    q = dict(F.get("q") or {}); opened = {"US": False, "KR": False}; alerts = list(F.get("alerts") or []); ids = {a["id"] for a in alerts}; wmap = {w["s"]: w for w in watch}
    def push(a, title, tags, prio):
        if a["id"] in ids: return
        ids.add(a["id"]); a["at"] = now_iso(); alerts.append(a)
        if not first: notify(title, a["msg"], tags, prio)
    from concurrent.futures import ThreadPoolExecutor
    def _q(s):
        try: return s, quote(s)
        except Exception: return s, None
    with ThreadPoolExecutor(6) as ex: got = dict(ex.map(_q, syms))
    for s in syms:
        r = got.get(s)
        if not r: continue
        q[s] = {"p": round(r["p"], 4), "chg": round(r["chg"], 4), "t": int(time.time()), "o": 1 if r["open"] else 0}
        w = wmap.get(s)
        if not w: continue
        if r["open"]: opened["KR" if is_kr(s) else "US"] = True
        if not r["open"]: continue
        nm = name_of(known, s, w); p = r["p"]; day = r["day"]
        if w.get("buy") and p <= w["buy"]: push({"id": f"{fid(s)}_buy_{day}", "s": s, "kind": "buy", "price": p, "level": w["buy"], "msg": f"{nm} {money(s, p)} — 매수 타점 {money(s, w['buy'])} 도달"}, "매수 타점 도달", "dart", 5)
        if w.get("sell") and p >= w["sell"]: push({"id": f"{fid(s)}_sell_{day}", "s": s, "kind": "sell", "price": p, "level": w["sell"], "msg": f"{nm} {money(s, p)} — 매도 가격 {money(s, w['sell'])} 도달"}, "매도 가격 도달", "moneybag", 5)
        for th in (0.05, 0.10):
            if abs(r["chg"]) >= th:
                a = {"id": f"{fid(s)}_move{int(th * 100)}_{day}", "s": s, "kind": "move", "price": p, "pct": round(r["chg"], 4), "msg": f"{nm} 장중 {r['chg'] * 100:+.1f}% ({money(s, p)})"}
                if a["id"] not in ids and not first:
                    und = underlying((known.get(s) or {}).get("n") or ""); hl = feeds(und, und, False, "", None, 8) if und else feeds(s, (known.get(s) or {}).get("n") or s, is_kr(s), (known.get(s) or {}).get("k") or "", None, 8)
                    why = groq(f"{nm}({s}) 주가가 오늘 장중 {r['chg'] * 100:+.1f}% 움직였음. 아래 최근 기사에 실제로 적힌 내용만 근거로 원인을 1~2문장으로 정리할 것. 기사만으로 원인을 특정할 수 없으면 「기사만으로는 원인을 특정할 수 없음」이라고만 쓸 것.\n" + evidence(hl), max_tokens=300) if hl else None
                    why = verify(why, hl) if why else None
                    if why: a["detail"] = why; a["msg"] += "\n" + why
                push(a, "급등" if r["chg"] > 0 else "급락", "chart_with_upwards_trend" if r["chg"] > 0 else "chart_with_downwards_trend", 4)
    # DART 공시
    for d in dart_new(watch, known, F):
        t = d["title"]; big = re.search(r"실적|손익구조|공급계약|증자|감자|합병|분할|자기주식|조회공시|거래정지|전환사채|신주인수권|배당|분기보고서|반기보고서|사업보고서|주요사항|영업양수|영업양도|소송|횡령|배임|상장폐지|관리종목", t)
        quiet = re.search(r"임원ㆍ주요주주|동일인등출자|최대주주등소유주식변동|대량보유상황|특수관계인|기업집단|대규모내부거래", t) and not big
        a = {"id": "dart_" + d["no"], "s": d["s"], "kind": "dart", "msg": f"{d['name']} 공시 — {t}", "u": d["u"]}
        if a["id"] not in ids and not quiet:
            ids.add(a["id"]); a["at"] = now_iso(); alerts.append(a)
            if not first: notify("주요 공시" if big else "새 공시", a["msg"], "page_facing_up", 4 if big else 2, d["u"])
        (F.setdefault("disc", {}).setdefault(d["s"], [])).insert(0, {"t": d["title"], "d": d["date"], "u": d["u"]}); F["disc"][d["s"]] = F["disc"][d["s"]][:15]
    F.pop("dart_corp", None); F.pop("dart_seen", None)
    # 컨센서스 · 실적 : 한 시간에 한 번
    if time.time() - F.get("cons_at", 0) > 3300:
        for w in watch:
            s = w["s"]
            if is_kr(s) or not re.fullmatch(r"[A-Z.]{1,6}", s) or (known.get(s) or {}).get("m") == "IX": continue
            c = nasdaq_cons(s)
            if not c: continue
            old = (FU.get(s) or {}).get("cons") or {}; FU.setdefault(s, {"s": s})["cons"] = c
            ot = {x["period"]: x.get("type") for x in old.get("eps") or []}
            for x in c.get("eps") or []:
                if x["type"] == "PreviousQuarter" and ot.get(x["period"]) == "UpcomingQuarter" and x.get("act") is not None:
                    d = x["act"] - (x.get("est") or 0); push({"id": f"{fid(s)}_eps_{fid(x['period'])}", "s": s, "kind": "eps", "msg": f"{name_of(known, s, w)} 실적 발표 — 주당순이익 {x['act']} (예상 {x.get('est')}, {'상회' if d > 0 else '하회' if d < 0 else '부합'})"}, "실적 발표", "bar_chart", 4)
            time.sleep(0.2)
        refresh_news(watch, known, FU); F["cons_at"] = int(time.time()); fund_dirty = True
    if fund_dirty: save(os.path.join(LIVE, "fund.json"), FU)
    F.update({"at": now_iso(), "q": q, "open": opened, "alerts": alerts[-150:]})
    save(os.path.join(LIVE, "fast.json"), F); print("fast 완료", len(q), "시세", len(alerts), "알림", opened)

# ═════ 일일 작업 ═════
ECON = [("CPI", "소비자물가(CPI)"), ("PPI", "생산자물가(PPI)"), ("PCE", "개인소비지출 물가(PCE)"), ("Nonfarm Payrolls", "비농업 고용"), ("Unemployment Rate", "실업률"), ("FOMC", "FOMC"), ("Fed Interest Rate", "연준 금리 결정"), ("Fed Chair", "연준 의장 발언"), ("GDP", "GDP"), ("Retail Sales", "소매판매"), ("ISM Manufacturing PMI", "ISM 제조업 지수"), ("ISM Services PMI", "ISM 서비스업 지수"), ("JOLTs", "구인 건수"), ("Initial Jobless Claims", "신규 실업수당 청구"), ("Michigan Consumer Sentiment", "미시간 소비자심리")]
def calendar(watch, known, FU):
    cal = []; today = time.time()
    for k in range(0, 12):
        t = today + k * 86400; ds = time.strftime("%Y-%m-%d", time.gmtime(t)); d = int(ds.replace("-", ""))
        if time.gmtime(t).tm_wday >= 5: continue
        try:
            rows = (json.loads(get(f"https://api.nasdaq.com/api/calendar/economicevents?date={ds}")).get("data") or {}).get("rows") or []; seen = set()
            for r in rows:
                if r.get("country") != "United States": continue
                for key, ko in ECON:
                    if key.lower() in (r.get("eventName") or "").lower() and ko not in seen:
                        seen.add(ko); cons = re.sub(r"&nbsp;|\s", "", r.get("consensus") or ""); prev = re.sub(r"&nbsp;|\s", "", r.get("previous") or "")
                        cal.append({"d": d, "t": "미국 " + ko, "w": (r.get("eventName") or "") + (f" · 예상 {cons}" if cons else "") + (f" · 이전 {prev}" if prev else "")}); break
        except Exception: pass
        time.sleep(0.2)
    for w in watch:
        nx = ((FU.get(w["s"]) or {}).get("cons") or {}).get("next")
        if nx and nx["d"] >= kst_day() - 1: cal.append({"d": nx["d"], "t": f"{name_of(known, w['s'], w)} 실적 발표", "w": (nx.get("when") or "") + " (미국 현지 날짜 기준)", "tk": [w["s"]]})
    cal.sort(key=lambda x: x["d"]); return cal

MARKET_Q = [("stock market today Wall Street", False), ("Federal Reserve inflation interest rates", False), ("AI data center semiconductor stocks", False), ("US politics regulation tech stocks", False), ("oil geopolitics markets", False), ("미국 증시 마감", True), ("코스피 반도체 외국인", True)]
def issues(watch, known, D, FU, mk):
    heads = []; n = 0
    for h in market_feeds(): n += 1; heads.append({"i": n, "t": h["t"], "src": h["src"], "u": h["u"], "at": h["at"], "d": h.get("d") or ""})
    for w in watch:
        for h in ((FU.get(w["s"]) or {}).get("news") or [])[:4]: n += 1; heads.append({"i": n, "t": f"[{name_of(known, w['s'], w)}] " + h["t"], "src": h.get("src"), "u": h["u"], "at": h.get("at"), "d": h.get("d") or ""})
    old = [{"id": x["id"], "date": x["date"], "title": x["title"]} for x in D.get("issues") or []]
    wl = ", ".join(f"{name_of(known, w['s'], w)}({w['s']})" for w in watch)
    prompt = f"""오늘은 {kst_day()} (한국 시간). 아래는 최근 기사 제목 목록과 시장 수치임. 미국 주식시장, 기술주·AI·반도체 섹터, 그리고 모니터링 종목에 영향을 줄 수 있는 이슈만 골라 5~8개로 정리할 것. 여러 기사가 다루는 굵직한 사안을 우선하고, 기사 한 건짜리 사소한 내용이나 개별 종목의 단순 등락 보도는 넣지 말 것. 본문(body)과 요약(brief)에는 기사 번호를 쓰지 말 것 (번호는 src 에만).

모니터링 종목 : {wl}
시장 수치 : {json.dumps(mk, ensure_ascii=False)}
기존 이슈(같은 주제면 id 를 그대로 재사용) : {json.dumps(old, ensure_ascii=False)}

기사 제목 :
""" + "\n".join(f"{h['i']}. ({h['at'][:11]}, {h['src']}) {h['t']}" + (f" — {h['d'][:200]}" if h['d'] else "") for h in heads) + """

모든 문장은 「~함」「~임」「~됨」「~있음」 꼴의 개조식으로 끝낼 것. 다음 JSON 한 개만 출력할 것 :
{"brief":"시장 요약 3~4문장","issues":[{"id":"영문 소문자·숫자·하이픈 슬러그","date":YYYYMMDD,"cat":"거시|정치|섹터|지정학 중 하나","sev":1~3 (3이 영향 큼),"dir":-1|0|1 (주가에 하방|혼재|상방),"title":"한 줄 제목","body":"무슨 일이 있었고 왜 영향이 있는지 2~4문장. 기사 제목에 실제로 적힌 내용·수치·인물명만 사용하고, 제목에 없는 세부 사항은 추정해 덧붙이지 말 것. 제목만으로 사실관계가 불분명하면 「~라는 보도가 있음」으로 쓸 것","sectors":["영향 섹터"],"tickers":["영향 받는 모니터링 종목 심볼, 위 목록의 심볼 표기 그대로"],"next":"다음에 확인할 일정이나 지표, 없으면 빈 문자열","src":[근거 기사 번호]}]}"""
    r = groq(prompt, js=True, max_tokens=3500)
    if not r or not r.get("issues"): return None
    hm = {h["i"]: h for h in heads}; out = []; valid = {w["s"] for w in watch} | set(CORE)
    for x in r["issues"][:10]:
        try:
            ev = [hm[i] for i in (x.get("src") or []) if i in hm]
            if not ev: continue   # 근거 기사가 없는 이슈는 버림
            x["body"] = verify(re.sub(r"\s*\(?관련 기사 번호[^.)]*\)?\.?", "", str(x.get("body", ""))).strip(), ev)
            if not x["body"]: continue
            out.append({"id": re.sub(r"[^a-z0-9\-]", "", str(x["id"]).lower())[:50] or f"i{len(out)}", "date": int(x.get("date") or kst_day()), "cat": x.get("cat") if x.get("cat") in ("거시", "정치", "섹터", "지정학") else "섹터", "sev": max(1, min(3, int(x.get("sev", 2)))), "dir": max(-1, min(1, int(x.get("dir", 0)))), "title": str(x["title"])[:120], "body": re.sub(r"\s*\(?관련 기사 번호[^.)]*\)?\.?", "", str(x.get("body", ""))).strip()[:1200], "sectors": [str(s) for s in (x.get("sectors") or [])][:4], "tickers": [t for t in (x.get("tickers") or []) if t in valid][:10], "next": str(x.get("next") or "")[:200], "src": [{"t": (h["src"] or "기사") + " — " + h["t"][:60], "u": h["u"]} for h in ev[:4]], "auto": True})
        except Exception: continue
    return {"brief": str(r.get("brief") or "")[:700], "issues": out}

def daily(all_syms=False):
    watch, extra, trades = state(); idx, ext, known = index()
    D = load(os.path.join(LIVE, "daily.json"), {}); FU = load(os.path.join(LIVE, "fund.json"), {}); ensure_hist(watch + extra, ext, known)
    active = set(CORE) | {w["s"] for w in watch} | {x["s"] for x in extra}
    tail = dict(D.get("tail") or {}); latest = {}; full = {}; fail = []
    span = max(70, int((time.time() - time.mktime(time.strptime(str(min(x["last"] for x in idx)), "%Y%m%d"))) / 86400) + 10)
    for x in idx + ext:
        s = x["s"]
        if not all_syms and s not in active: continue
        try:
            m, rows = prices(s, span); rows = rnd(rows, x["m"] == "KR"); latest[s] = rows[-2:]; full[s] = rows; t = [r for r in rows if r[0] > x["last"]]
            if t: tail[s] = t
        except Exception: fail.append(s)
        time.sleep(0.25)
    asof = max([r[-1][0] for r in latest.values() if r] or [D.get("asof", 0)])
    # 기사(번역 포함) · 수급
    refresh_news(watch, known, FU)
    for w in watch:
        s = w["s"]; x = known.get(s)
        if not x: continue
        f = FU.setdefault(s, {"s": s})
        if x["m"] == "KR": f["kr"] = naver(s[:6]) or f.get("kr")
        elif x["m"] == "US": f["si"] = short_interest(s) or f.get("si")
        time.sleep(0.2)
    # 급등락 사유 : 최근 30거래일 가운데 아직 사유가 없는 날을 최근 것부터 분석
    have = {m["id"] for m in D.get("moves") or [] if "찾지 못함" not in m.get("reason", "") or m["date"] < kst_day() - 5}; cands = []
    D["moves"] = [m for m in D.get("moves") or [] if m["id"] in have]
    for w in watch: cands += find_moves(w["s"], full.get(w["s"]) or [], have)
    done = set(explain(D, known, cands, 12)); moves = D["moves"]; new_moves = [m for m in moves if m["id"] in done and m["date"] >= asof]
    mk = {s: {"date": latest[s][-1][0], "close": latest[s][-1][4], "pct": round((latest[s][-1][4] / latest[s][-2][4] - 1) * 100, 2)} for s in ["^GSPC", "^IXIC", "^SOX", "^VIX", "^TNX", "CL=F", "KRW=X", "^KS11", "QQQ"] if len(latest.get(s) or []) == 2}
    cal = calendar(watch, known, FU)
    iss = issues(watch, known, D, FU, mk)
    if iss:
        keep = [x for x in (D.get("issues") or []) if not x.get("auto") and x["date"] >= kst_day() - 2000 and time.time() - time.mktime(time.strptime(str(x["date"]), "%Y%m%d")) < 12 * 86400]
        ids = {x["id"] for x in iss["issues"]}; D["issues"] = iss["issues"] + [x for x in keep if x["id"] not in ids]; D["brief"] = {"date": (mk.get("^GSPC") or {}).get("date") or asof, "text": iss["brief"]}
    D.update({"at": now_iso(), "asof": asof, "tail": tail, "moves": moves[-400:], "cal": cal or D.get("cal") or [], "failed": fail})
    save(os.path.join(LIVE, "daily.json"), D); save(os.path.join(LIVE, "fund.json"), FU)
    big = new_moves
    lines = [f"{k.replace('^GSPC', 'S&P500').replace('^IXIC', '나스닥').replace('^KS11', '코스피')} {v['pct']:+.1f}%" for k, v in mk.items() if k in ("^GSPC", "^IXIC", "^KS11")]
    body = " · ".join(lines) + ("\n" + "\n".join(f"{name_of(known, m['s'])} {m['pct'] * 100:+.1f}%" for m in big) if big else "") + ("\n" + (D.get("brief") or {}).get("text", "")[:220] if D.get("brief") else "")
    notify("장 마감 요약", body.strip() or "갱신 완료", "newspaper", 3)
    print("daily 완료", asof, len(tail), "꼬리", len(new_moves), "급등락", len(D.get("issues") or []), "이슈", "실패", fail)

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fast"
    try: fast() if cmd == "fast" else daily("--all" in sys.argv)
    except Exception: traceback.print_exc(); sys.exit(1)
