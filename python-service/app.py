import os
import time
from threading import Lock

import akshare as ak
import baostock as bs
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="共振雷达 Python 数据服务", version="1.0.0")
allowed = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed, allow_methods=["GET"], allow_headers=["*"])

_cache: dict[str, tuple[float, object]] = {}
_lock = Lock()


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
    return {"ok": True, "service": "baostock-akshare", "time": int(time.time())}


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
        for source, fn in (("baostock", load_baostock_history), ("akshare", load_akshare_history)):
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
