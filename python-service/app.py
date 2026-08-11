import os
import time
import urllib.request
from threading import Lock

import akshare as ak
import baostock as bs
import pandas as pd
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="共振雷达 Python 数据服务", version="1.0.0")
allowed = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed, allow_methods=["GET"], allow_headers=["*"])

_cache: dict[str, tuple[float, object]] = {}
_lock = Lock()
HTTP_TIMEOUT = (4, 12)
HTTP_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; StockResonanceRadar/1.1)"}


def cached(key: str, ttl: int, loader):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1], True
    value = loader()
    with _lock:
        _cache[key] = (now + ttl, value)
    return value, False


def clean_number(value):
    try:
        if pd.isna(value) or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def market_prefix(code: str) -> str:
    if code.startswith(("92", "4", "8")):
        return "bj"
    if code.startswith(("5", "6", "9")):
        return "sh"
    return "sz"


def load_tencent_quotes(codes: list[str]):
    """腾讯直连批量行情；用于诊断和对已有代码补充实时价、量比及市值。"""
    if not codes or len(codes) > 100:
        raise RuntimeError("腾讯行情每批须为1到100只")
    prefixed = [market_prefix(code) + code for code in codes]
    url = "https://qt.gtimg.cn/q=" + ",".join(prefixed)
    request = urllib.request.Request(url, headers=HTTP_HEADERS)
    with urllib.request.urlopen(request, timeout=12) as response:
        payload = response.read().decode("gbk", errors="replace")
    result = []
    for line in payload.split(";"):
        if "=" not in line or '"' not in line:
            continue
        values = line.split('"', 2)[1].split("~")
        if len(values) < 53 or not values[2].isdigit():
            continue
        price = clean_number(values[3])
        previous = clean_number(values[4])
        result.append({
            "code": values[2], "name": values[1], "price": price,
            "previousClose": previous, "open": clean_number(values[5]),
            "changePercent": clean_number(values[32]), "high": clean_number(values[33]),
            "low": clean_number(values[34]), "amount": (clean_number(values[37]) or 0) * 10000,
            "volumeRatio": clean_number(values[49]),
            # 腾讯字段45为总市值，单位亿元；网页统一使用元。
            "marketCap": (clean_number(values[45]) or 0) * 100000000,
            "isStale": bool(price and previous and price == previous and not clean_number(values[37])),
        })
    if not result:
        raise RuntimeError("腾讯行情返回空数据")
    return result


def load_baidu_history(code: str, start_date: str, end_date: str):
    """百度股市通日K，响应自带MA5/MA10/MA20。"""
    url = "https://finance.pae.baidu.com/selfselect/getstockquotation"
    params = {
        "all": "1", "isIndex": "false", "isBk": "false", "isBlock": "false",
        "isFutures": "false", "isStock": "true", "newFormat": "1",
        "group": "quotation_kline_ab", "finClientType": "pc", "code": code,
        "start_time": "", "ktype": "1",
    }
    headers = {
        **HTTP_HEADERS, "Accept": "application/vnd.finance-web.v1+json",
        "Origin": "https://gushitong.baidu.com", "Referer": "https://gushitong.baidu.com/",
    }
    response = requests.get(url, params=params, headers=headers, timeout=HTTP_TIMEOUT)
    response.raise_for_status()
    market = response.json().get("Result", {}).get("newMarketData", {})
    keys = market.get("keys") or []
    raw_rows = [row for row in str(market.get("marketData", "")).split(";") if row]
    if not keys or not raw_rows:
        raise RuntimeError("百度日K返回空数据")
    rows = []
    for raw in raw_rows:
        values = raw.split(",")
        item = dict(zip(keys, values))
        date = str(item.get("time") or item.get("date") or "")[:10]
        if not date or date < start_date or date > end_date:
            continue
        rows.append({
            "date": date, "open": clean_number(item.get("open")) or 0,
            "high": clean_number(item.get("high")) or 0, "low": clean_number(item.get("low")) or 0,
            "close": clean_number(item.get("close")) or 0, "volume": clean_number(item.get("volume")) or 0,
            "amount": clean_number(item.get("amount")) or 0,
            "ma5": clean_number(item.get("ma5avgprice")), "ma10": clean_number(item.get("ma10avgprice")),
            "ma20": clean_number(item.get("ma20avgprice")),
        })
    if len(rows) < 70:
        raise RuntimeError(f"百度历史数据不足：{len(rows)}")
    return rows


def load_akshare_quotes():
    frame = ak.stock_zh_a_spot_em()
    rows = []
    for item in frame.to_dict("records"):
        code = str(item.get("代码", "")).zfill(6)
        if len(code) != 6:
            continue
        rows.append({
            "code": code,
            "name": str(item.get("名称", code)),
            "price": clean_number(item.get("最新价")),
            "changePercent": clean_number(item.get("涨跌幅")),
            "volume": clean_number(item.get("成交量")),
            "amount": clean_number(item.get("成交额")),
            "volumeRatio": clean_number(item.get("量比")),
            "high": clean_number(item.get("最高")),
            "low": clean_number(item.get("最低")),
            "open": clean_number(item.get("今开")),
            "previousClose": clean_number(item.get("昨收")),
            "marketCap": clean_number(item.get("总市值")),
        })
    if len(rows) < 100:
        raise RuntimeError(f"AKShare全市场行情不足：{len(rows)}")
    return rows


def load_baostock_history(code: str, start_date: str, end_date: str):
    login = bs.login()
    if login.error_code != "0":
        raise RuntimeError(login.error_msg)
    try:
        symbol = ("sh." if code.startswith(("5", "6", "9")) else "sz.") + code
        result = bs.query_history_k_data_plus(
            symbol,
            "date,open,high,low,close,volume,amount",
            start_date=start_date,
            end_date=end_date,
            frequency="d",
            adjustflag="2",
        )
        rows = []
        while result.error_code == "0" and result.next():
            row = result.get_row_data()
            rows.append({
                "date": row[0], "open": float(row[1] or 0), "high": float(row[2] or 0),
                "low": float(row[3] or 0), "close": float(row[4] or 0),
                "volume": float(row[5] or 0), "amount": float(row[6] or 0),
            })
        if len(rows) < 70:
            raise RuntimeError(f"Baostock历史数据不足：{len(rows)}")
        return rows
    finally:
        bs.logout()


def load_akshare_history(code: str, start_date: str, end_date: str):
    frame = ak.stock_zh_a_hist(symbol=code, period="daily", start_date=start_date.replace("-", ""), end_date=end_date.replace("-", ""), adjust="qfq")
    rows = [{
        "date": str(item.get("日期"))[:10], "open": clean_number(item.get("开盘")) or 0,
        "high": clean_number(item.get("最高")) or 0, "low": clean_number(item.get("最低")) or 0,
        "close": clean_number(item.get("收盘")) or 0, "volume": clean_number(item.get("成交量")) or 0,
        "amount": clean_number(item.get("成交额")) or 0,
    } for item in frame.to_dict("records")]
    if len(rows) < 70:
        raise RuntimeError(f"AKShare历史数据不足：{len(rows)}")
    return rows


@app.get("/health")
def health():
    return {"ok": True, "service": "tencent-baidu-baostock-akshare", "version": "1.1.0", "time": int(time.time())}


@app.get("/api/tencent-quotes")
def tencent_quotes(codes: str = Query("603019")):
    requested = [code.strip() for code in codes.split(",") if code.strip()]
    if not requested or any(not (code.isdigit() and len(code) == 6) for code in requested):
        raise HTTPException(status_code=400, detail="股票代码无效")
    try:
        data = load_tencent_quotes(requested)
        return {"source": "tencent", "count": len(data), "data": data}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/test-sources")
def test_sources(code: str = Query("603019")):
    if not (code.isdigit() and len(code) == 6):
        raise HTTPException(status_code=400, detail="股票代码无效")
    checks = {}
    for source, fn in (
        ("tencent", lambda: load_tencent_quotes([code])),
        ("baidu", lambda: load_baidu_history(code, "2020-01-01", "2050-01-01")),
    ):
        started = time.monotonic()
        try:
            data = fn()
            checks[source] = {"ok": True, "count": len(data), "latencyMs": round((time.monotonic() - started) * 1000)}
        except Exception as exc:
            checks[source] = {"ok": False, "error": str(exc), "latencyMs": round((time.monotonic() - started) * 1000)}
    return {"code": code, "ok": any(item["ok"] for item in checks.values()), "sources": checks}


@app.get("/api/quotes")
def quotes():
    try:
        data, cache_hit = cached("quotes", 45, load_akshare_quotes)
        return {"source": "akshare", "sourceLabel": "AKShare全市场补充", "cacheHit": cache_hit, "count": len(data), "data": data}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/history/{code}")
def history(code: str, start: str = Query("2020-01-01"), end: str = Query("2050-01-01")):
    if not (code.isdigit() and len(code) == 6):
        raise HTTPException(status_code=400, detail="股票代码无效")
    key = f"history:{code}:{start}:{end}"

    def loader():
        errors = []
        for source, fn in (("baidu", load_baidu_history), ("baostock", load_baostock_history), ("akshare", load_akshare_history)):
            try:
                return {"source": source, "data": fn(code, start, end)}
            except Exception as exc:
                errors.append(f"{source}: {exc}")
        raise RuntimeError("；".join(errors))

    try:
        result, cache_hit = cached(key, 6 * 3600, loader)
        return {**result, "cacheHit": cache_hit, "code": code, "count": len(result["data"])}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
