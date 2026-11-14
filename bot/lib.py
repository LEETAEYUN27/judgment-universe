# 판단 유니버스 — 시세·기사·지표 수집 함수 (표준 라이브러리만 사용)
import json, urllib.request, urllib.parse, re, sys, os, time, html, argparse, glob, email.utils
import urllib.error
import xml.etree.ElementTree as ET
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36", "Accept": "application/json, text/plain, */*"}
def get(u, t=15): return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=t).read()
def fid(s): return re.sub(r"[^A-Za-z0-9]", "_", s)
def chunk(f): return "c%d" % (sum(map(ord, f)) % 8)
def ymd(t, off): return int(time.strftime("%Y%m%d", time.gmtime(t + off)))

Y429 = [0]
def yahoo(sym, rng):
    if Y429[0] >= 3: raise RuntimeError("yahoo 일시 차단 (429) — 대체 출처 사용")
    err = None
    for host in ("query1", "query2"):
        try:
            j = json.loads(get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range={rng}&interval=1d"))
            r = j["chart"]["result"][0]; q = r["indicators"]["quote"][0]; m = r["meta"]; off = m.get("gmtoffset", 0); rows = []
            for i, t in enumerate(r.get("timestamp") or []):
                if q["close"][i] is None or q["open"][i] is None: continue
                rows.append([ymd(t, off), q["open"][i], q["high"][i], q["low"][i], q["close"][i], int(q["volume"][i] or 0)])
            Y429[0] = 0; return m, rows
        except urllib.error.HTTPError as e:
            err = e
            if e.code == 429: Y429[0] += 1; break
            time.sleep(1)
        except Exception as e: err = e; time.sleep(1)
    raise err
def naver_hist(code, days):
    t1 = time.strftime("%Y%m%d"); t0 = time.strftime("%Y%m%d", time.gmtime(time.time() - days * 86400))
    txt = get(f"https://fchart.stock.naver.com/siseJson.nhn?symbol={code}&requestType=1&startTime={t0}&endTime={t1}&timeframe=day", 40).decode("utf-8", "replace")
    rows = []
    for m in re.finditer(r'\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)', txt):
        d, o, h, l, c, v = m.groups(); rows.append([int(d), float(o), float(h), float(l), float(c), int(float(v))])
    return rows
def nasdaq_hist(sym, days):
    t1 = time.strftime("%Y-%m-%d"); t0 = time.strftime("%Y-%m-%d", time.gmtime(time.time() - days * 86400)); num = lambda x: float(re.sub(r"[^0-9.\-]", "", str(x)) or 0)
    for ac in ("stocks", "etf"):
        try:
            j = json.loads(get(f"https://api.nasdaq.com/api/quote/{sym}/historical?assetclass={ac}&fromdate={t0}&todate={t1}&limit=4000", 40))
            rr = (j.get("data") or {}).get("tradesTable", {}).get("rows") or []
            if not rr: continue
            rows = []
            for r in rr:
                mm, dd, yy = r["date"].split("/"); rows.append([int(yy + mm + dd), num(r["open"]), num(r["high"]), num(r["low"]), num(r["close"]), int(num(r["volume"]))])
            rows.sort(); return rows
        except Exception: continue
    return []
NAVER_IX = {"^GSPC": "https://api.stock.naver.com/index/.INX/basic", "^IXIC": "https://api.stock.naver.com/index/.IXIC/basic", "^SOX": "https://api.stock.naver.com/index/.SOX/basic", "^VIX": "https://api.stock.naver.com/index/.VIX/basic", "^KS11": "https://m.stock.naver.com/api/index/KOSPI/basic", "^KQ11": "https://m.stock.naver.com/api/index/KOSDAQ/basic", "KRW=X": "https://api.stock.naver.com/marketindex/exchange/FX_USDKRW", "CL=F": "https://api.stock.naver.com/marketindex/energy/CLcv1", "^TNX": "https://api.stock.naver.com/marketindex/bond/US10YT=RR"}
def naver_ix_hist(sym):
    """지수·환율·유가·금리 최근 60일 (네이버). 거래량 없음."""
    u = NAVER_IX[sym].replace("/basic", ""); u += ("/prices" if "/marketindex/" in u else "/price") + "?page=1&pageSize=60"
    num = lambda x: float(str(x).replace(",", "") or 0); rows = []
    for r in json.loads(get(u)):
        c = num(r["closePrice"]); d = int(r["localTradedAt"][:10].replace("-", ""))
        rows.append([d, num(r.get("openPrice") or c), num(r.get("highPrice") or c), num(r.get("lowPrice") or c), c, 0])
    rows.sort(key=lambda x: x[0]); return rows
def us_name(sym):
    for ac in ("stocks", "etf"):
        try: return json.loads(get(f"https://api.nasdaq.com/api/quote/{sym.replace('.', '-')}/info?assetclass={ac}", 12))["data"]["companyName"]
        except Exception: continue
    return None
def prices(sym, days):
    """일봉 [[YYYYMMDD,o,h,l,c,v]...] 과 이름·통화. 야후 우선, 막히면 네이버(한국)·나스닥(미국)."""
    try:
        m, rows = yahoo(sym, "11y" if days > 400 else "3mo")
        if rows: return {"name": m.get("longName") or m.get("shortName") or sym, "cur": m.get("currency"), "src": "yahoo"}, rows
    except Exception: pass
    if is_kr(sym): rows = naver_hist(sym[:6], days)
    elif re.fullmatch(r"[A-Z.]{1,6}", sym): rows = nasdaq_hist(sym.replace(".", "-"), days)
    elif sym in NAVER_IX: rows = naver_ix_hist(sym)
    else: rows = []
    if not rows: raise RuntimeError("시세 출처 모두 실패: " + sym)
    return {"name": sym, "cur": "KRW" if is_kr(sym) else "USD", "src": "alt"}, rows
CORE = ["^GSPC", "^IXIC", "^SOX", "^VIX", "^TNX", "DX-Y.NYB", "CL=F", "KRW=X", "^KS11", "^KQ11", "BTC-USD", "SPY", "QQQ", "TQQQ", "SQQQ", "SOXL"]
def rnd(rows, kr):
    out = []
    for d, o, h, l, c, v in rows:
        dec = 0 if kr else (2 if c >= 5 else 4)
        f = (lambda x: int(round(x))) if kr else (lambda x: round(x, dec))
        out.append([d, f(o), f(h), f(l), f(c), v])
    return out
def is_kr(s): return s.endswith((".KS", ".KQ"))

# ───── 종목 부가 정보 ─────
def news(q, kr=False, n=8, rng=None):
    p = "hl=ko&gl=KR&ceid=KR:ko" if kr else "hl=en-US&gl=US&ceid=US:en"
    try:
        x = ET.fromstring(get("https://news.google.com/rss/search?q=" + urllib.parse.quote(q + (f" after:{rng[0]} before:{rng[1]}" if rng else " when:4d")) + "&" + p)); out = []
        for it in x.iter("item"):
            t = html.unescape(it.findtext("title") or ""); src = it.findtext("source") or ""
            if src and t.endswith(" - " + src): t = t[:-len(src) - 3]
            pd = it.findtext("pubDate") or ""
            try: ts = email.utils.parsedate_to_datetime(pd).timestamp()
            except Exception: ts = 0
            out.append({"t": t, "u": it.findtext("link"), "src": src, "at": pd[5:22], "_ts": ts})
        out.sort(key=lambda a: -a["_ts"])
        for o in out: o.pop("_ts")
        return out[:n]
    except Exception: return []
def short_interest(sym):
    try:
        j = json.loads(get(f"https://api.nasdaq.com/api/quote/{sym}/short-interest?assetClass=stocks"))
        num = lambda s: float(re.sub(r"[^0-9.\-]", "", str(s)) or 0)
        return [{"date": r["settlementDate"], "shares": num(r["interest"]), "avgVol": num(r["avgDailyShareVolume"]), "dtc": num(r["daysToCover"])} for r in j["data"]["shortInterestTable"]["rows"][:6]]
    except Exception: return None
def naver(code):
    try:
        j = json.loads(get(f"https://m.stock.naver.com/api/stock/{code}/integration"))
        info = {x["code"]: x.get("value") for x in j.get("totalInfos", [])}; c = j.get("consensusInfo") or {}
        return {"per": info.get("per"), "cnsPer": info.get("cnsPer"), "pbr": info.get("pbr"), "foreign": info.get("foreignRate"), "mcap": info.get("marketValue"), "div": info.get("dividendYieldRatio"), "target": c.get("priceTargetMean"), "reco": c.get("recommMean"), "cnsDate": c.get("createDate")}
    except Exception: return None
def krname(code):
    try: return json.loads(get(f"https://m.stock.naver.com/api/stock/{code}/basic")).get("stockName") or ""
    except Exception: return ""


def quote(sym):
    """현재가·전일 대비·장 열림 여부. 야후 우선, 막히면 나스닥(미국)·네이버(한국)."""
    now = time.time()
    try:
        m, rows = yahoo(sym, "5d"); tp = (m.get("currentTradingPeriod") or {}).get("regular") or {}
        day = ymd(m.get("regularMarketTime", now), m.get("gmtoffset", 0)); p = m.get("regularMarketPrice")
        prev = rows[-2][4] if len(rows) >= 2 and day == rows[-1][0] else (rows[-1][4] if rows else None)
        if p and prev: return {"p": p, "chg": p / prev - 1, "open": tp.get("start", 0) <= now <= tp.get("end", 0) + 900, "day": day}
    except Exception: pass
    num = lambda x: float(re.sub(r"[^0-9.\-]", "", str(x)) or 0)
    if is_kr(sym):
        j = json.loads(get(f"https://m.stock.naver.com/api/stock/{sym[:6]}/basic")); p = num(j["closePrice"]); r = num(j.get("fluctuationsRatio", 0)) / 100
        return {"p": p, "chg": r, "open": j.get("marketStatus") == "OPEN", "day": int(time.strftime("%Y%m%d", time.gmtime(now + 9 * 3600)))}
    if sym in NAVER_IX:
        j = json.loads(get(NAVER_IX[sym])); j = j.get("exchangeInfo") or j; p = num(j["closePrice"]); r = num(j.get("fluctuationsRatio", 0)) / 100
        return {"p": p, "chg": r, "open": j.get("marketStatus") == "OPEN", "day": int(time.strftime("%Y%m%d", time.gmtime(now - 5 * 3600 if sym in ("^GSPC", "^IXIC", "^SOX", "^VIX") else now + 9 * 3600)))}
    if not re.fullmatch(r"[A-Z.]{1,6}", sym): raise RuntimeError("현재가 조회 실패: " + sym)
    for ac in ("stocks", "etf"):
        try:
            d = json.loads(get(f"https://api.nasdaq.com/api/quote/{sym.replace('.', '-')}/info?assetclass={ac}", 12))["data"]; pd = d["primaryData"]
            return {"p": num(pd["lastSalePrice"]), "chg": num(pd["percentageChange"]) / 100, "open": d.get("marketStatus") == "Open", "day": int(time.strftime("%Y%m%d", time.gmtime(now - 5 * 3600)))}
        except Exception: continue
    raise RuntimeError("현재가 조회 실패: " + sym)


# ───── 기사 수집 : 여러 출처를 합쳐 중복 제거 ─────
def rss(u, src=None, t=12):
    """RSS · Atom 공통 파서 → [{t,u,src,at,ts,d}]"""
    out = []
    try: x = ET.fromstring(get(u, t))
    except Exception: return out
    for it in list(x.iter("item")) + list(x.iter("{http://www.w3.org/2005/Atom}entry")):
        g = lambda k: it.findtext(k) or it.findtext("{http://www.w3.org/2005/Atom}" + k) or ""
        ti = html.unescape(re.sub(r"<[^>]+>", "", g("title"))).strip(); s = it.findtext("source") or src or ""
        if s and ti.endswith(" - " + s): ti = ti[:-len(s) - 3]
        ti = re.sub(r"\s*\|\s*[A-Z.]{1,6} Stock News$", "", ti)
        link = g("link"); 
        if not link:
            l = it.find("{http://www.w3.org/2005/Atom}link"); link = l.get("href") if l is not None else ""
        pd = g("pubDate") or g("updated") or g("published")
        try: ts = email.utils.parsedate_to_datetime(pd).timestamp()
        except Exception:
            try: ts = time.mktime(time.strptime(pd[:19], "%Y-%m-%dT%H:%M:%S"))
            except Exception: ts = 0
        d = html.unescape(re.sub(r"<[^>]+>", " ", html.unescape(g("description") or g("summary")))); d = re.sub(r"\s+", " ", d).strip()
        if d.startswith(ti[:40]) or "news.google.com" in (g("description") or ""): d = ""
        if ti and link: out.append({"t": ti, "u": link.strip(), "src": s, "at": time.strftime("%d %b %Y %H:%M", time.gmtime(ts)) if ts else "", "ts": ts, "d": d[:300]})
    return out
MAJOR = "site:reuters.com OR site:bloomberg.com OR site:cnbc.com OR site:wsj.com OR site:barrons.com OR site:ft.com OR site:marketwatch.com OR site:investors.com"
WIRES = "site:businesswire.com OR site:prnewswire.com OR site:globenewswire.com OR site:sec.gov"
def gnews(q, kr=False, rng=None, when="7d"):
    p = "hl=ko&gl=KR&ceid=KR:ko" if kr else "hl=en-US&gl=US&ceid=US:en"
    return rss("https://news.google.com/rss/search?q=" + urllib.parse.quote(q + (f" after:{rng[0]} before:{rng[1]}" if rng else " when:" + when)) + "&" + p)
def feeds(sym, name, kr=False, kname="", rng=None, n=12):
    """종목 기사 종합. 미국 : 구글 뉴스(티커 · 회사명 · 주요 언론 · 보도자료) + 시킹알파 + 나스닥 + 스톡타이탄 + 빙 + 야후. 한국 : 구글 뉴스 한국어 2종 + 영문."""
    got = []; base = re.sub(r",? (Inc\.?|Corporation|Corp\.?|Holdings|Group|plc|Ltd\.?|Co\.?|N\.V\.|S\.A\.)\b.*$", "", name or sym).strip() or sym
    if kr:
        k = kname or name
        qs = [(k + " 주가", True), (k + " 실적 OR 공시 OR 수주 OR 전망", True), (base + " stock", False)]
        for q, ko in qs: got += gnews(q, ko, rng); time.sleep(0.2)
    else:
        code = sym.replace(".", "-")
        for q in [f"{base} stock", f'"{code}" stock {base.split()[0]}', f"{base} ({MAJOR})", f"{base} ({WIRES})"] + ([f"{kname} 주가"] if kname else []):
            got += gnews(q, q.endswith("주가"), rng, "7d" if "site:" not in q else "14d"); time.sleep(0.2)
        if not rng:
            for u, s in [(f"https://seekingalpha.com/api/sa/combined/{code}.xml", "Seeking Alpha"), (f"https://www.nasdaq.com/feed/rssoutbound?symbol={code}", "Nasdaq"), (f"https://www.stocktitan.net/rss/news/{code}", "보도자료 (StockTitan)"), (f"https://www.bing.com/news/search?q={urllib.parse.quote(base + ' stock')}&format=rss", "Bing News"), (f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={code}&region=US&lang=en-US", "Yahoo Finance")]:
                r = rss(u, s)
                if s == "Nasdaq": r = [x for x in r if base.split()[0].lower() in (x["t"] + x["d"]).lower() or sym.lower() in (x["t"] + x["d"]).lower().split()]
                got += r; time.sleep(0.15)
    now = time.time(); seen = set(); out = []; key = base.split()[0].lower(); kk = (kname or "")[:3]
    for x in sorted(got, key=lambda a: -a["ts"]):
        k = re.sub(r"[^a-z0-9가-힣]", "", x["t"].lower())[:48]
        if not k or k in seen: continue
        if not rng and x["ts"] and now - x["ts"] > 10 * 86400: continue
        txt = (x["t"] + " " + x["d"]).lower()
        if key not in txt and sym.lower().split(".")[0] not in txt and not (kk and kk in txt): continue   # 종목과 무관한 기사 제외
        seen.add(k); out.append(x)
    for o in out: o.pop("ts", None)
    return out[:n]
def market_feeds():
    """시장 전반 : 구글 뉴스 주제 검색 + CNBC · 마켓워치 · 인베스팅 속보 (요약문 포함)"""
    got = []
    for q, kr in [("stock market today Wall Street", False), ("Federal Reserve inflation interest rates", False), ("AI data center semiconductor stocks", False), ("tech stocks regulation tariffs White House", False), ("oil geopolitics markets", False), ("미국 증시 마감", True), ("코스피 반도체 외국인", True)]:
        got += gnews(q, kr, None, "2d")[:7]; time.sleep(0.2)
    for u, s in [("https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664", "CNBC"), ("https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069", "CNBC"), ("https://feeds.content.dowjones.io/public/rss/mw_topstories", "MarketWatch"), ("https://www.investing.com/rss/news_25.rss", "Investing.com")]:
        got += rss(u, s)[:10]
    now = time.time(); seen = set(); out = []
    for x in sorted(got, key=lambda a: -a["ts"]):
        k = re.sub(r"[^a-z0-9가-힣]", "", x["t"].lower())[:48]
        if not k or k in seen or (x["ts"] and now - x["ts"] > 3 * 86400): continue
        seen.add(k); x.pop("ts", None); out.append(x)
    return out[:70]
