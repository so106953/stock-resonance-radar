"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise, Bell, CaretDown, ChartLineUp, Check, MagnifyingGlass, Star,
  SlidersHorizontal, Warning, X
} from "@phosphor-icons/react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";

const stocks = [];

const DEFAULT_STRATEGY = { ma: [5, 10, 20, 60], macd: [12, 26, 9], volumeRatio: 1.5, maxRise: 7, minDays: 120, excludeST: true };

function loadSavedStrategy() {
  if (typeof window === "undefined") return DEFAULT_STRATEGY;
  try {
    const saved = JSON.parse(window.localStorage.getItem("resonance-strategy"));
    return saved && Array.isArray(saved.ma) && Array.isArray(saved.macd) ? { ...DEFAULT_STRATEGY, ...saved } : DEFAULT_STRATEGY;
  } catch { return DEFAULT_STRATEGY; }
}

function loadSavedWatchlist() {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem("resonance-watchlist"));
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

function loadScanHistory() {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem("resonance-scan-history"));
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

function loadLatestScanQuality() {
  if (typeof window === "undefined") return { state: "idle", scanned: 0, matched: null, durationMs: 0 };
  try {
    const saved = JSON.parse(window.localStorage.getItem("resonance-latest-scan-quality"));
    return saved?.state === "done" ? saved : { state: "idle", scanned: 0, matched: null, durationMs: 0 };
  } catch { return { state: "idle", scanned: 0, matched: null, durationMs: 0 }; }
}

function loadSignalAlerts() {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem("resonance-alerts"));
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

function loadCloseArchive() {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem("resonance-close-archive") || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

function chinaClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const weekday = get("weekday");
  const workday = !["周六", "周日"].includes(weekday);
  const minutes = hour * 60 + minute;
  const trading = workday && ((minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900));
  const beforeOpen = workday && minutes < 570;
  return { time: `${get("hour")}:${get("minute")}:${get("second")}`, date: `${get("year")}-${get("month")}-${get("day")}（${weekday}）`, trading, workday, afterClose: workday && minutes >= 900, label: trading ? "A股交易中" : (beforeOpen ? "等待开盘" : workday ? "A股已收盘" : "A股休市") };
}

function loadAutoScan() {
  if (typeof window === "undefined") return 0;
  const value = Number(window.localStorage.getItem("resonance-auto-scan") || 0);
  return [0, 5, 15].includes(value) ? value : 0;
}

function loadDataProvider() {
  if (typeof window === "undefined") return "auto";
  const value = window.localStorage.getItem("resonance-data-provider") || "auto";
  return ["auto", "local"].includes(value) ? value : "auto";
}

const chartData = [];
/* Real K-line data is loaded from the server. No fabricated fallback data. */
/*
Array.from({ length: 42 }, (_, i) => {
  const close = 38 + i * 0.55 + Math.sin(i * 0.72) * 1.7 + (i > 31 ? (i - 31) * 0.55 : 0);
  return {
    day: i % 7 === 0 ? ["05-12", "05-27", "06-11", "06-25", "07-09", "07-23"][Math.floor(i / 7)] || "08-06" : "",
    close: +close.toFixed(2),
    low: +(close - 1.3).toFixed(2),
    high: +(close + 1.6).toFixed(2),
    ma5: +(close - 1.2).toFixed(2),
    ma10: +(36 + i * 0.57).toFixed(2),
    ma20: +(37 + i * 0.43).toFixed(2),
    ma60: +(36 + i * 0.31).toFixed(2),
    vol: Math.round(110 + (i % 6) * 32 + (i > 33 ? 120 : 0) + Math.sin(i) * 38),
    macd: +(Math.sin(i * .34) * 1.2 + (i > 32 ? (i - 32) * .17 : 0)).toFixed(2),
    dif: +(Math.sin(i * .28) * .8 + i * .035).toFixed(2),
    dea: +(Math.sin(i * .28 - .55) * .65 + i * .03).toFixed(2),
  };
}); */

function MiniTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return <div className="tooltip">收盘 {payload[0]?.payload.close}<br />成交量 {payload[0]?.payload.vol}万手</div>;
}

export function App() {
  const [selectedCode, setSelectedCode] = useState("603019");
  const [listMode, setListMode] = useState("signals");
  const [range, setRange] = useState("日K");
  const [watchlist, setWatchlist] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState("");
  const [quotes, setQuotes] = useState(stocks);
  const [feed, setFeed] = useState({ source: "连接中", fallback: false, updatedAt: null, count: 0 });
  const [scanSummary, setScanSummary] = useState(loadLatestScanQuality);
  const [scanResults, setScanResults] = useState(null);
  const [scanScope, setScanScope] = useState("60");
  const [cacheStatus, setCacheStatus] = useState({ cachedSymbols: 0, ttlHours: 6 });
  const [strategy, setStrategy] = useState(DEFAULT_STRATEGY);
  const [stockChart, setStockChart] = useState({ data: chartData, source: "等待真实K线", fallback: false, loading: false });
  const [scanHistory, setScanHistory] = useState([]);
  const [logMode, setLogMode] = useState("signals");
  const [alerts, setAlerts] = useState([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [clock, setClock] = useState({ time: "--:--:--", date: "", trading: false, workday: false, afterClose: false, label: "连接中" });
  const [autoScanMinutes, setAutoScanMinutes] = useState(0);
  const [backtest, setBacktest] = useState({ open: false, loading: false, data: null, fallback: false });
  const [dataProvider, setDataProvider] = useState("auto");
  const [visibleLimit, setVisibleLimit] = useState(12);
  const [watchAnalysis, setWatchAnalysis] = useState({});
  const [confirmedResults, setConfirmedResults] = useState([]);
  const [refreshStatus, setRefreshStatus] = useState({
    signals: { state: "idle", updatedAt: null, progress: 0 },
    confirmed: { state: "idle", updatedAt: null, progress: 0 },
    watchlist: { state: "idle", updatedAt: null, progress: 0 },
  });
  const updateRefreshStatus = (target, patch) => setRefreshStatus(current => ({
    ...current, [target]: { ...current[target], ...patch },
  }));
  const refreshTime = value => value ? new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "尚未刷新";
  const refreshLabel = target => refreshStatus[target].state === "running" ? "刷新中" : refreshStatus[target].state === "error" ? "刷新失败" : refreshTime(refreshStatus[target].updatedAt);
  const [closeArchive, setCloseArchive] = useState([]);
  const [closeRange, setCloseRange] = useState("day");
  const [marketCapMode, setMarketCapMode] = useState("all");
  const [closeGroup, setCloseGroup] = useState("all");
  const [viewMode, setViewMode] = useState("simple");
  const initialAutoScan = useRef(false);
  const fullScanStop = useRef(false);
  const [fullScan, setFullScan] = useState({ status: "idle", offset: 0, total: 0, failed: 0, matched: 0, updatedAt: null });
  const realtimeCandidates = useMemo(() => quotes
    .filter(item => Number(item.price) > 0 && Number(item.volume) > 0 && !String(item.name).includes("ST"))
    .filter(item => Number(item.changePercent) <= strategy.maxRise && Number(item.changePercent) >= -3)
    .filter(item => Number(item.volumeRatio) >= Math.max(1, strategy.volumeRatio * 0.72))
    .filter(item => marketCapMode === "all" || (Number(item.marketCap || 0) > 0 && (marketCapMode === "above300" ? Number(item.marketCap) >= 30000000000 : Number(item.marketCap) < 30000000000)))
    .sort((a, b) => (Number(b.volumeRatio) * 24 + Number(b.changePercent)) - (Number(a.volumeRatio) * 24 + Number(a.changePercent)))
    .map(item => ({
      code: item.code, name: item.name,
      score: Math.min(88, Math.round(45 + Number(item.volumeRatio) * 18 + Math.max(0, Number(item.changePercent)) * 2)),
      rise: `${Number(item.changePercent) >= 0 ? "+" : ""}${Number(item.changePercent || 0).toFixed(2)}%`,
      ratio: Number(item.volumeRatio || 0).toFixed(2), price: Number(item.price || 0).toFixed(2),
      industry: "实时量价观察候选", signalState: "watch", preliminary: true, marketCap: Number(item.marketCap || 0),
    })), [quotes, strategy.maxRise, strategy.volumeRatio, marketCapMode]);
  const signalStocks = scanResults ?? realtimeCandidates;
  const confirmedStocks = useMemo(() => {
    const tradingDates = [...new Set(closeArchive.map(batch => batch.sessionDate).filter(Boolean))].sort().reverse();
    const allowedDates = closeRange === "day" ? tradingDates.slice(0, 1) : closeRange === "week" ? tradingDates.slice(0, 5) : [];
    const cutoff = Date.now() - ({ "2h": 2 * 3600e3, "4h": 4 * 3600e3 }[closeRange] || 0);
    const includeGroup = item => closeGroup === "all" ? ["confirmed", "near-confirmed", "checked-confirmed"].includes(item.signalState) : closeGroup === "strict" ? item.signalState === "confirmed" : item.signalState === "near-confirmed";
    const includeCap = item => marketCapMode === "all" || (Number(item.marketCap || 0) > 0 && (marketCapMode === "above300" ? Number(item.marketCap) >= 30000000000 : Number(item.marketCap) < 30000000000));
    const current = confirmedResults.filter(item => includeGroup(item) && includeCap(item)).map(item => ({ ...item, capturedAt: Date.now() }));
    const archived = closeArchive.filter(batch => closeRange === "2h" || closeRange === "4h" ? Number(batch.capturedAt) >= cutoff : allowedDates.includes(batch.sessionDate)).flatMap(batch => (batch.items || []).filter(item => includeGroup(item) && includeCap(item)).map(item => ({ ...item, capturedAt: batch.capturedAt, sessionDate: batch.sessionDate })));
    const latest = new Map();
    [...current, ...archived].sort((a, b) => Number(b.capturedAt) - Number(a.capturedAt)).forEach(item => { if (!latest.has(item.code)) latest.set(item.code, item); });
    return [...latest.values()].sort((a, b) => Number(b.score) - Number(a.score));
  }, [confirmedResults, closeArchive, closeRange, closeGroup, marketCapMode]);
  const enrichedStocks = useMemo(() => {
    const baseCodes = new Set(signalStocks.map(item => item.code));
    const watchedExtras = quotes.filter(item => watchlist.includes(item.code) && !baseCodes.has(item.code)).map(item => ({
      code: item.code, name: item.name, score: Number(watchAnalysis[item.code]?.score || 0), rise: `${Number(item.changePercent) >= 0 ? "+" : ""}${Number(item.changePercent || 0).toFixed(2)}%`, ratio: Number(watchAnalysis[item.code]?.volumeRatio || item.volumeRatio || 0).toFixed(2), price: Number(item.price || 0).toFixed(2), industry: "自选股策略检查", signalState: watchAnalysis[item.code]?.signalState || "watch", ...watchAnalysis[item.code],
    }));
    return [...signalStocks, ...watchedExtras].map(item => {
      const live = quotes.find(q => q.code === item.code);
    if (!live) return item;
    const livePrice = Number(live.price);
    const liveChange = Number(live.changePercent);
    const liveRatio = Number(live.volumeRatio);
    return {
      ...item,
      price: Number.isFinite(livePrice) && livePrice > 0 ? livePrice.toFixed(2) : item.price,
      rise: Number.isFinite(liveChange) ? `${liveChange >= 0 ? "+" : ""}${liveChange.toFixed(2)}%` : item.rise,
      ratio: Number.isFinite(liveRatio) && liveRatio > 0 ? liveRatio.toFixed(2) : item.ratio,
      };
    });
  }, [quotes, watchlist, signalStocks, watchAnalysis]);
  const stock = enrichedStocks.find(item => item.code === selectedCode) || confirmedStocks.find(item => item.code === selectedCode) || enrichedStocks[0] || confirmedStocks[0] || { code: "------", name: "暂无真实数据", score: 0, rise: "--", ratio: "--", price: "--", industry: "行情源恢复后显示", signalState: "unavailable" };
  const visible = useMemo(() => (listMode === "confirmed" ? confirmedStocks : enrichedStocks)
    .filter(item => listMode === "signals" || listMode === "confirmed" || watchlist.includes(item.code))
    .filter(item => `${item.name}${item.code}`.includes(query.trim())), [query, enrichedStocks, confirmedStocks, listMode, watchlist]);
  const pagedVisible = visible.slice(0, visibleLimit);
  const favorite = watchlist.includes(stock.code);
  const latestBar = stockChart.data[stockChart.data.length - 1];
  const stockRise = Number(String(stock.rise || "0").replace("%", ""));
  const riskFlags = [
    stockRise >= 5 ? "当日涨幅较高，避免追涨" : "",
    Number(stock.ratio || 0) >= 3 ? "成交量短时过热" : "",
    Number(stock.marketCap || 0) > 0 && Number(stock.marketCap) < 10000000000 ? "小市值波动风险较高" : "",
    stock.signalState === "near-confirmed" || stock.preliminary ? "信号尚未严格确认" : "",
  ].filter(Boolean);
  const riskLevel = riskFlags.length >= 2 ? "高" : riskFlags.length === 1 ? "中" : "低";
  const simpleAction = stock.code === "------" ? "等待真实行情" : stockRise >= 5 ? "不要追高，等待回落后重新确认" : stock.signalState === "confirmed" ? "严格信号已确认，继续观察风险条件" : "暂列观察，等待三项条件全部确认";
  const marketStats = useMemo(() => {
    const valid = quotes.filter(item => Number.isFinite(Number(item.changePercent)));
    const up = valid.filter(item => Number(item.changePercent) > 0).length;
    const down = valid.filter(item => Number(item.changePercent) < 0).length;
    const ratio = valid.length ? up / valid.length : 0;
    return { up, down, total: valid.length, state: !valid.length ? "数据不足" : ratio >= .58 ? "强势" : ratio <= .42 ? "弱势" : "震荡", ratio: Math.round(ratio * 100) };
  }, [quotes]);
  const fullScanKey = useMemo(() => `v1-${strategy.ma.join("-")}-${strategy.macd.join("-")}-${strategy.volumeRatio}-${strategy.maxRise}-${strategy.minDays}-${strategy.excludeST}-${marketCapMode}`, [strategy, marketCapMode]);

  function applyPreset(type) {
    const presets = {
      steady: { volumeRatio: 1.5, maxRise: 5, minDays: 180, cap: "above300" },
      balanced: { volumeRatio: 1.2, maxRise: 7, minDays: 120, cap: "all" },
      active: { volumeRatio: 1.0, maxRise: 9, minDays: 60, cap: "below300" },
    };
    const selected = presets[type];
    setStrategy(current => ({ ...current, volumeRatio: selected.volumeRatio, maxRise: selected.maxRise, minDays: selected.minDays }));
    setMarketCapMode(selected.cap); setScanResults(null);
  }
  const searchResults = useMemo(() => query.trim() ? quotes.filter(item => `${item.name}${item.code}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : [], [query, quotes]);

  useEffect(() => {
    setWatchlist(loadSavedWatchlist());
    setStrategy(loadSavedStrategy());
    setScanHistory(loadScanHistory());
    setAlerts(loadSignalAlerts());
    setCloseArchive(loadCloseArchive());
    setAutoScanMinutes(loadAutoScan());
    setDataProvider(loadDataProvider());
    setClock(chinaClock());
    fetch("/api/market/close-archive").then(response => response.json()).then(payload => {
      if (!Array.isArray(payload.data)) return;
      setCloseArchive(current => {
        const merged = new Map([...payload.data, ...current].map(batch => [batch.id || `${batch.sessionDate}-${batch.capturedAt}`, batch]));
        const next = [...merged.values()].sort((a, b) => Number(b.capturedAt) - Number(a.capturedAt)).slice(0, 80);
        window.localStorage.setItem("resonance-close-archive", JSON.stringify(next));
        return next;
      });
    }).catch(() => {});
  }, []);

  useEffect(() => { setVisibleLimit(12); }, [listMode, query, scanResults]);

  useEffect(() => {
    let active = true;
    async function refreshQuotes() {
      try {
        const response = await fetch(`/api/market/quotes?provider=${dataProvider}`);
        const payload = await response.json();
        if (!active) return;
        if (!response.ok) throw new Error(payload.error || "免费行情源暂不可用");
        setQuotes(payload.data || []);
        setFeed(payload);
      } catch (error) {
        if (active) { setQuotes([]); setFeed({ source: "unavailable", unavailable: true, fallback: false, updatedAt: new Date().toISOString(), count: 0, warning: error.message }); }
      }
    }
    refreshQuotes();
    fetch("/api/market/cache-status").then(response => response.json()).then(payload => active && setCacheStatus(payload)).catch(() => {});
    const timer = window.setInterval(refreshQuotes, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [dataProvider]);

  useEffect(() => {
    let active = true;
    fetch(`/api/market/full-scan?id=${encodeURIComponent(fullScanKey)}`).then(response => response.json()).then(payload => {
      if (!active || !payload.data) return;
      const data = payload.data;
      // A scan only runs in the browser that started it. A persisted "running"
      // record is stale after a reload and must be resumable instead of locking
      // the scan button forever.
      const restoredStatus = data.status === "running" ? "paused" : (data.status || "paused");
      setFullScan({ status: restoredStatus, offset: Number(data.offset || 0), total: Number(data.total || 0), failed: Number(data.failed || 0), matched: (data.items || []).length, updatedAt: data.updatedAt || null });
      if (Array.isArray(data.items) && data.items.length) setScanResults(data.items);
    }).catch(() => {});
    return () => { active = false; };
  }, [fullScanKey]);

  useEffect(() => {
    if (initialAutoScan.current || !feed.updatedAt || !feed.count) return;
    initialAutoScan.current = true;
    const timer = window.setTimeout(() => runFullScan().catch(() => {}), 150);
    return () => window.clearTimeout(timer);
  }, [feed.updatedAt, feed.count]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(chinaClock()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!clock.date || clock.trading || !clock.workday || !clock.afterClose) return;
    const dateKey = clock.date.slice(0, 10);
    const key = `resonance-close-scan-v2-${dateKey}`;
    const previous = window.localStorage.getItem(key);
    if (previous === "done") return;
    if (previous?.startsWith("running:")) {
      const started = Number(previous.split(":")[1]);
      if (Date.now() - started < 5 * 60_000) return;
    }
    window.localStorage.setItem(key, `running:${Date.now()}`);
    setListMode("confirmed");
    scan("batch").then(() => window.localStorage.setItem(key, "done")).catch(() => window.localStorage.removeItem(key));
  }, [clock.date, clock.trading, clock.workday, clock.afterClose]);

  useEffect(() => {
    if (!autoScanMinutes) return undefined;
    const timer = window.setInterval(() => {
      if (chinaClock().trading) scan().catch(() => {});
    }, autoScanMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [autoScanMinutes, scanScope, strategy]);

  useEffect(() => {
    if (!watchlist.length) {
      setWatchAnalysis({});
      updateRefreshStatus("watchlist", { state: "done", updatedAt: Date.now(), message: "暂无自选", progress: 100 });
      return;
    }
    let active = true;
    updateRefreshStatus("watchlist", { state: "running", message: `正在更新 ${watchlist.length} 只自选`, progress: null });
    const params = new URLSearchParams({ codes: watchlist.join(","), limit: String(watchlist.length), ma: strategy.ma.join(","), macd: strategy.macd.join(","), volumeRatio: String(strategy.volumeRatio), maxRise: String(strategy.maxRise), minDays: String(strategy.minDays), excludeST: "false" });
    fetch(`/api/market/scan?${params}`).then(response => response.json()).then(payload => {
      if (!active || !Array.isArray(payload.leaders)) return;
      setWatchAnalysis(Object.fromEntries(payload.leaders.map(item => [item.code, item])));
      updateRefreshStatus("watchlist", { state: "done", updatedAt: Date.now(), message: `已更新 ${payload.leaders.length} 只`, progress: 100 });
    }).catch(error => active && updateRefreshStatus("watchlist", { state: "error", message: error?.message || "更新失败" }));
    return () => { active = false; };
  }, [watchlist, strategy]);

  useEffect(() => {
    let active = true;
    setStockChart(current => ({ ...current, loading: true }));
    const params = new URLSearchParams({ code: selectedCode, ma: strategy.ma.join(","), macd: strategy.macd.join(","), provider: dataProvider });
    fetch(`/api/market/history?${params}`).then(response => response.json()).then(payload => {
      if (!active) return;
      if (!payload.data?.length) throw new Error(payload.error || "暂无K线");
      setStockChart({ data: payload.data, source: "真实日K", fallback: false, loading: false });
    }).catch(() => active && setStockChart({ data: [], source: "K线暂不可用", fallback: false, loading: false }));
    return () => { active = false; };
  }, [selectedCode, strategy, dataProvider]);

  async function scan(scopeOverride) {
    if (scanning) throw new Error("扫描正在进行");
    const options = scopeOverride && typeof scopeOverride === "object" ? scopeOverride : {};
    const effectiveScope = typeof scopeOverride === "string" ? scopeOverride : (options.scope || scanScope);
    const refreshTarget = options.target || (clock.afterClose || listMode === "confirmed" ? "confirmed" : "signals");
    setScanning(true);
    updateRefreshStatus(refreshTarget, { state: "running", message: refreshTarget === "confirmed" ? "正在计算收盘确认" : refreshTarget === "watchlist" ? "正在更新我的自选" : "正在扫描盘中候选", progress: options.fullProgress ?? null });
    if (refreshTarget !== "watchlist") setScanSummary(summary => ({ ...summary, state: "running" }));
    try {
      const params = new URLSearchParams({
        limit: effectiveScope, ma: strategy.ma.join(","), macd: strategy.macd.join(","),
        volumeRatio: String(strategy.volumeRatio), maxRise: String(strategy.maxRise),
        minDays: String(strategy.minDays), excludeST: String(strategy.excludeST), marketCapMode, provider: dataProvider,
      });
      if (Array.isArray(options.codes) && options.codes.length) params.set("codes", options.codes.join(","));
      const response = await fetch(`/api/market/scan?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "扫描失败");
      const matchedCodes = new Set((payload.data || []).map(item => item.code));
      const nearCodes = new Set((payload.nearMatches || []).map(item => item.code));
      const combinedRows = [...(payload.data || []), ...(payload.nearMatches || []), ...(options.matchesOnly ? [] : (payload.leaders || []).filter(item => !matchedCodes.has(item.code) && !nearCodes.has(item.code)))];
      const nextResults = combinedRows.map(item => ({
        code: item.code, name: item.name, score: Number(item.score || 0),
        rise: `${Number(item.changePercent) >= 0 ? "+" : ""}${Number(item.changePercent || 0).toFixed(2)}%`,
        ratio: Number(item.volumeRatio || 0).toFixed(2), price: Number(item.price || 0).toFixed(2),
        ma5: item.ma5, ma10: item.ma10, ma20: item.ma20, ma60: item.ma60, dif: item.dif, dea: item.dea, marketCap: Number(item.marketCap || 0),
        bullishMa: Boolean(item.bullishMa), macdGoldenCross: Boolean(item.macdGoldenCross), recentMacdCross: Boolean(item.recentMacdCross), volumeExpanded: Boolean(item.volumeExpanded), missingReasons: item.missingReasons || [],
        industry: item.matched ? (payload.signalState === "confirmed" ? "符合全部要求" : "盘中策略命中") : item.nearMatch ? "接近满足（观察）" : (payload.signalState === "confirmed" ? "收盘已检查" : "真实行情高分观察候选"), signalState: item.nearMatch ? (item.signalState || "near-confirmed") : item.matched ? (item.signalState || payload.signalState || "intraday") : (payload.signalState === "confirmed" ? "checked-confirmed" : "watch"), preliminary: !item.matched && !item.nearMatch,
      }));
      if (refreshTarget === "watchlist") {
        setWatchAnalysis(current => {
          const next = { ...current };
          nextResults.forEach(item => { next[item.code] = item; });
          return next;
        });
      } else if (refreshTarget === "confirmed") {
        setConfirmedResults(current => options.append ? [...new Map([...(current || []), ...nextResults].map(item => [item.code, item])).values()].sort((a, b) => Number(b.score) - Number(a.score)) : nextResults);
      } else {
        setScanResults(current => options.append ? [...new Map([...(current || []), ...nextResults].map(item => [item.code, item])).values()].sort((a, b) => Number(b.score) - Number(a.score)) : nextResults);
      }
      if (nextResults.length && refreshTarget !== "watchlist") setSelectedCode(nextResults[0].code);
      const completedSummary = { state: "done", attempted: payload.attempted, scanned: payload.scanned, failed: payload.failed, failedDetails: payload.failedDetails || [], completeness: payload.completeness, sourceLabel: payload.sourceLabel, quoteCoverage: payload.quoteCoverage, updatedAt: payload.updatedAt || Date.now(), matched: payload.matched, nearMatched: payload.nearMatched, durationMs: payload.durationMs, fallback: payload.fallback, cacheHits: payload.cacheHits || 0, fetched: payload.fetched || 0, nextOffset: payload.nextOffset };
      if (refreshTarget !== "watchlist") {
        setScanSummary(completedSummary);
        window.localStorage.setItem("resonance-latest-scan-quality", JSON.stringify(completedSummary));
      }
      if (payload.signalState === "confirmed" && !options.skipRecords) {
        const capturedAt = Date.now();
        const batch = { id: `${payload.sessionDate || clock.date.slice(0, 10)}-${capturedAt}`, sessionDate: payload.sessionDate || clock.date.slice(0, 10), capturedAt, scanMode: payload.scanMode || "收盘后复盘", status: "success", attempted: payload.attempted || 0, scanned: payload.scanned || 0, failed: payload.failed || 0, completeness: payload.completeness || 0, sourceLabel: payload.sourceLabel || "免费行情", items: nextResults };
        setCloseArchive(current => {
          const next = [batch, ...current.filter(item => item.id !== batch.id)].filter(item => Number(item.capturedAt) >= Date.now() - 45 * 24 * 3600e3).slice(0, 80);
          window.localStorage.setItem("resonance-close-archive", JSON.stringify(next));
          return next;
        });
        fetch("/api/market/close-archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch) }).catch(() => {});
      }
      const record = { id: Date.now(), time: new Date().toLocaleString("zh-CN", { hour12: false }), scope: effectiveScope, scanned: payload.scanned, matched: payload.matched, durationMs: payload.durationMs, fallback: Boolean(payload.fallback), volumeRatio: strategy.volumeRatio, signalState: payload.signalState };
      if (!options.skipRecords) {
      setScanHistory(current => {
        const next = [record, ...current].slice(0, 30);
        window.localStorage.setItem("resonance-scan-history", JSON.stringify(next));
        return next;
      });
      }
      const dateKey = new Date().toISOString().slice(0, 10);
      const strategyKey = `${strategy.ma.join("-")}_${strategy.macd.join("-")}_${strategy.volumeRatio}`;
      const incoming = (payload.data || []).map(item => ({
        id: `${dateKey}_${item.code}_${strategyKey}_${item.signalState || payload.signalState}`, code: item.code, name: item.name,
        score: item.score, ratio: item.volumeRatio, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        fallback: Boolean(payload.fallback), signalState: item.signalState || payload.signalState, read: false,
      }));
      if (!options.skipRecords) setAlerts(current => {
        const known = new Set(current.map(item => item.id));
        const fresh = incoming.filter(item => !known.has(item.id));
        if (fresh.length) {
          setToast({ count: fresh.length, fallback: Boolean(payload.fallback) });
          window.setTimeout(() => setToast(null), 3800);
        }
        const next = [...fresh, ...current].slice(0, 100);
        window.localStorage.setItem("resonance-alerts", JSON.stringify(next));
        return next;
      });
      fetch("/api/market/cache-status").then(response => response.json()).then(setCacheStatus).catch(() => {});
      if (!options.fullBatch) updateRefreshStatus(refreshTarget, { state: "done", updatedAt: Date.now(), message: `完成：扫描 ${payload.scanned || 0} 只，命中 ${payload.matched || 0} 只`, progress: 100 });
      return { payload, nextResults };
    } catch (error) {
      if (refreshTarget !== "watchlist") setScanSummary({ state: "error", scanned: 0, matched: null, durationMs: 0, message: error.message });
      updateRefreshStatus(refreshTarget, { state: "error", message: error?.message || "刷新失败" });
      throw error;
    } finally {
      setScanning(false);
    }
  }

  async function refreshSection(target = listMode) {
    if (target === "watchlist") {
      if (!watchlist.length) {
        updateRefreshStatus("watchlist", { state: "done", updatedAt: Date.now(), progress: 100, message: "自选列表为空" });
        return;
      }
      return scan({ target: "watchlist", scope: String(Math.min(watchlist.length, 100)), codes: watchlist.slice(0, 100), matchesOnly: false, skipRecords: true });
    }
    if (scanScope === "full") {
      setListMode(target);
      return runFullScan(target);
    }
    return scan({ target });
  }

  async function runFullScan(targetOverride) {
    if (!quotes.length || fullScan.status === "running") return;
    fullScanStop.current = false;
    const eligibleCodes = quotes.filter(row => Number(row.price) > 0 && Number(row.volume) > 0)
      .filter(row => !strategy.excludeST || !String(row.name).includes("ST"))
      .filter(row => Number(row.changePercent) <= strategy.maxRise)
      .filter(row => marketCapMode === "all" || (Number(row.marketCap || 0) > 0 && (marketCapMode === "above300" ? Number(row.marketCap) >= 30000000000 : Number(row.marketCap) < 30000000000)))
      .sort((a, b) => String(a.code).localeCompare(String(b.code))).map(row => row.code);
    const sameTotal = fullScan.total === eligibleCodes.length;
    let offset = sameTotal && fullScan.status !== "done" ? Math.min(fullScan.offset, eligibleCodes.length) : 0;
    const canResume = sameTotal && fullScan.status !== "done";
    let failed = canResume ? fullScan.failed : 0;
    let accumulated = canResume && Array.isArray(scanResults) ? scanResults.filter(item => item.signalState === "confirmed" || item.signalState === "near-confirmed" || item.signalState === "intraday" || item.signalState === "near-intraday") : [];
    setScanScope("full");
    setQuery("");
    setVisibleLimit(12);
    if (!canResume) setScanResults([]);
    const fullTarget = targetOverride === "confirmed" || targetOverride === "signals" ? targetOverride : (clock.afterClose ? "confirmed" : "signals");
    setListMode(fullTarget);
    updateRefreshStatus(fullTarget, { state: "running", progress: eligibleCodes.length ? Math.round(offset / eligibleCodes.length * 100) : 0, message: `已处理 ${offset} / ${eligibleCodes.length}` });
    setFullScan({ status: "running", offset, total: eligibleCodes.length, failed, matched: accumulated.length, updatedAt: Date.now() });
    while (offset < eligibleCodes.length && !fullScanStop.current) {
      const codes = eligibleCodes.slice(offset, offset + 10);
      let batchResult = null; let batchError = "";
      for (let attempt = 0; attempt < 2 && !batchResult; attempt++) {
        try { batchResult = await scan({ scope: String(codes.length), codes, append: true, matchesOnly: true, skipRecords: true, target: fullTarget, fullBatch: true, fullProgress: eligibleCodes.length ? Math.round(offset / eligibleCodes.length * 100) : 0 }); }
        catch (error) { batchError = error?.message || "批次请求失败"; if (attempt === 0) await new Promise(resolve => window.setTimeout(resolve, 1800)); }
      }
      if (!batchResult) {
        fullScanStop.current = true;
        setFullScan(current => ({ ...current, status: "paused", batchError, updatedAt: Date.now() }));
        break;
      }
      const { payload, nextResults } = batchResult;
      accumulated = [...new Map([...accumulated, ...nextResults].map(item => [item.code, item])).values()].sort((a, b) => Number(b.score) - Number(a.score));
      failed += Number(payload.failed || 0);
      offset += codes.length;
      const status = offset >= eligibleCodes.length ? "done" : "running";
      const progress = { status, offset, total: eligibleCodes.length, failed, matched: accumulated.length, updatedAt: Date.now() };
      setFullScan(progress);
      updateRefreshStatus(fullTarget, { state: status === "done" ? "done" : "running", progress: eligibleCodes.length ? Math.round(offset / eligibleCodes.length * 100) : 100, updatedAt: status === "done" ? Date.now() : null, message: status === "done" ? `完成：当前列表 ${accumulated.length} 只` : `已处理 ${offset} / ${eligibleCodes.length}` });
      await fetch(`/api/market/full-scan?id=${encodeURIComponent(fullScanKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...progress, sessionDate: chinaClock().date.slice(0, 10), items: accumulated }) }).catch(() => {});
      if (status === "done") break;
    }
    if (fullScanStop.current) setFullScan(current => ({ ...current, status: "paused" }));
  }

  function stopFullScan() { fullScanStop.current = true; }

  function applyStrategy() {
    window.localStorage.setItem("resonance-strategy", JSON.stringify(strategy));
    window.localStorage.setItem("resonance-data-provider", dataProvider);
    setFiltersOpen(false);
    scan().catch(() => {});
  }

  function toggleFavorite() {
    setWatchlist(current => {
      const next = current.includes(stock.code) ? current.filter(code => code !== stock.code) : [...current, stock.code];
      window.localStorage.setItem("resonance-watchlist", JSON.stringify(next));
      return next;
    });
  }

  function addSearchResult(item) {
    setWatchlist(current => {
      const next = current.includes(item.code) ? current : [...current, item.code];
      window.localStorage.setItem("resonance-watchlist", JSON.stringify(next));
      return next;
    });
    setSelectedCode(item.code);
    setListMode("watchlist");
    setQuery("");
  }

  function openAlerts() {
    setAlertsOpen(value => !value);
    if (!alertsOpen) {
      setAlerts(current => {
        const next = current.map(item => ({ ...item, read: true }));
        window.localStorage.setItem("resonance-alerts", JSON.stringify(next));
        return next;
      });
    }
  }

  const unreadAlerts = alerts.filter(item => !item.read).length;

  function updateAutoScan(value) {
    const minutes = Number(value);
    setAutoScanMinutes(minutes);
    window.localStorage.setItem("resonance-auto-scan", String(minutes));
  }

  async function runStockBacktest() {
    setBacktest({ open: true, loading: true, data: null, fallback: false });
    const params = new URLSearchParams({ code: stock.code, ma: strategy.ma.join(","), macd: strategy.macd.join(","), volumeRatio: String(strategy.volumeRatio), holdingDays: "5", provider: dataProvider });
    try {
      const response = await fetch(`/api/market/backtest?${params}`);
      const payload = await response.json();
      setBacktest({ open: true, loading: false, data: payload.data, fallback: Boolean(payload.fallback) });
    } catch {
      setBacktest({ open: true, loading: false, data: null, fallback: true });
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◎</span><strong>共振雷达</strong></div>
        <div className={`market ${clock.trading ? "open" : "closed"}`}><i />{clock.label}</div>
        <span className="clock-time">{clock.time}</span><span className="clock-date">{clock.date}</span>
        <span className="coverage">覆盖 <b className="gold">{Number(feed.count || 0).toLocaleString()}</b> 只 <small>· {feed.unavailable ? "免费源暂不可用" : (feed.sourceLabel || feed.source || "免费行情")}</small></span><span className={feed.unavailable ? "feed-fallback" : "feed-live"}>{feed.unavailable ? "无数据（不展示模拟）" : "刷新自动更新 · 双源切换"} · 约60秒</span>
        <div className="search"><MagnifyingGlass size={19}/><input aria-label="搜索股票" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索股票 / 代码 / 名称" />
          {query && <div className="search-popover">{searchResults.length ? searchResults.map(item => <div className="search-result" key={item.code}><button className="result-main" onClick={() => addSearchResult(item)}><strong>{item.name}</strong><span>{item.code}</span><em>{Number(item.price) > 0 ? Number(item.price).toFixed(2) : "--"}</em></button><button className="quick-add" onClick={() => addSearchResult(item)}>{watchlist.includes(item.code) ? "已自选" : "+ 自选"}</button></div>) : <div className="search-empty">没有找到匹配股票</div>}</div>}
        </div>
        <div className="alerts-wrap"><button className="alerts-button" aria-label="信号提醒" onClick={openAlerts}><Bell size={19}/>{unreadAlerts > 0 && <span>{unreadAlerts > 99 ? "99+" : unreadAlerts}</span>}</button>
          {alertsOpen && <div className="alerts-panel"><div className="alerts-head"><strong>信号提醒</strong><span>{alerts.length}条</span><button onClick={() => setAlertsOpen(false)}><X size={16}/></button></div>{alerts.length ? alerts.slice(0, 12).map(item => <button className="alert-item" key={item.id} onClick={() => { setSelectedCode(item.code); setAlertsOpen(false); }}><div><strong>{item.name}</strong><span>{item.code}</span>{item.fallback && <em>演示</em>}</div><p>共振分 {item.score} · 量比 {Number(item.ratio || 0).toFixed(2)}</p><time>{item.time}</time></button>) : <div className="alerts-empty">扫描命中新信号后会显示在这里</div>}</div>}
        </div>
        <label className="auto-scan">自动<select aria-label="自动扫描周期" value={autoScanMinutes} onChange={event => updateAutoScan(event.target.value)}><option value="0">关闭</option><option value="5">5分钟</option><option value="15">15分钟</option></select></label>
        <div className="mode-switch" aria-label="显示模式"><button className={viewMode === "simple" ? "active" : ""} onClick={() => setViewMode("simple")}>简洁</button><button className={viewMode === "pro" ? "active" : ""} onClick={() => setViewMode("pro")}>专业</button></div>
        <button className="primary refresh-primary" onClick={() => refreshSection(listMode).catch(() => {})}><ArrowClockwise className={scanning || fullScan.status === "running" ? "spin" : ""} size={18}/><span>{fullScan.status === "running" ? "全市场扫描中" : scanning ? `正在刷新${listMode === "confirmed" ? "收盘确认" : listMode === "watchlist" ? "我的自选" : "盘中候选"}` : `刷新${listMode === "confirmed" ? "收盘确认" : listMode === "watchlist" ? "我的自选" : "盘中候选"}`}</span></button>
      </header>

      <section className={`workspace ${viewMode === "simple" ? "simple" : "pro"}`}>
        <aside className="watchlist">
          <div className="panel-title"><strong>{listMode === "signals" ? "共振候选" : listMode === "confirmed" ? "收盘确认" : "我的自选"}</strong><span>{listMode === "signals" ? signalStocks.length : listMode === "confirmed" ? confirmedStocks.length : watchlist.length}</span><button aria-label={`刷新${listMode === "confirmed" ? "收盘确认" : listMode === "watchlist" ? "我的自选" : "盘中候选"}`} onClick={() => refreshSection(listMode).catch(() => {})}><ArrowClockwise className={(listMode === "watchlist" ? refreshStatus.watchlist.state === "running" : refreshStatus[listMode].state === "running") ? "spin" : ""} size={17}/></button></div>
          <div className="list-tabs"><button className={listMode === "signals" ? "active" : ""} onClick={() => setListMode("signals")}>盘中候选{refreshStatus.signals.state === "running" && <i className="refresh-dot" />}</button><button className={listMode === "confirmed" ? "active" : ""} onClick={() => setListMode("confirmed")}>收盘确认 <span>{confirmedStocks.length}</span>{refreshStatus.confirmed.state === "running" && <i className="refresh-dot" />}</button><button className={listMode === "watchlist" ? "active" : ""} onClick={() => setListMode("watchlist")}>我的自选 <span>{watchlist.length}</span>{refreshStatus.watchlist.state === "running" && <i className="refresh-dot" />}</button></div>
          <div className="refresh-board" aria-live="polite">
            {[["signals", "盘中候选"], ["confirmed", "收盘确认"], ["watchlist", "我的自选"]].map(([key, label]) => {
              const status = refreshStatus[key];
              const determinate = Number.isFinite(status.progress);
              return <div key={key} className={`refresh-item ${status.state}`}><span className="refresh-state-icon">{status.state === "running" ? <ArrowClockwise className="spin" size={14}/> : status.state === "error" ? <Warning size={14}/> : status.updatedAt ? <Check size={14}/> : "·"}</span><div><strong>{label}{status.state === "running" && determinate ? ` ${status.progress}%` : ""}</strong><small>{status.state === "running" ? status.message || "刷新中" : refreshLabel(key)}</small><span className={`refresh-progress ${status.state === "running" && !determinate ? "indeterminate" : ""}`} aria-label={status.state === "running" ? `${label}刷新进度` : undefined} aria-valuenow={determinate ? status.progress : undefined} role={status.state === "running" ? "progressbar" : undefined}><i style={{ width: `${determinate ? status.progress : status.state === "done" ? 100 : 0}%` }} /></span></div></div>;
            })}
          </div>
          <div className={`scan-strip ${scanSummary.state}`}>
            {fullScan.status === "running" && `正在刷新${clock.afterClose ? "收盘确认" : "盘中候选"}：${fullScan.offset.toLocaleString()} / ${fullScan.total.toLocaleString()}（${fullScan.total ? Math.round(fullScan.offset / fullScan.total * 100) : 0}%）· 当前列表 ${signalStocks.length} 只 · 数据失败 ${fullScan.failed} 只`}
            {fullScan.status === "paused" && `全市场扫描已暂停：${fullScan.offset.toLocaleString()} / ${fullScan.total.toLocaleString()}${fullScan.batchError ? ` · 当前批次失败：${fullScan.batchError}` : "，点击继续可续跑"}`}
            {fullScan.status === "done" && `${clock.afterClose ? "收盘确认" : "盘中候选"}刷新完成：检查 ${fullScan.offset.toLocaleString()} 只 · 当前列表 ${signalStocks.length} 只 · 数据失败 ${fullScan.failed} 只`}
            {fullScan.status === "idle" && scanSummary.state === "idle" && "刷新后自动开始全市场扫描，也可手动运行"}
            {fullScan.status === "idle" && scanSummary.state === "running" && "正在拉取历史日线并计算指标…"}
            {fullScan.status === "idle" && scanSummary.state === "done" && `${clock.trading ? "盘中扫描" : "收盘后复盘"}成功：分析 ${scanSummary.scanned}/${scanSummary.attempted || scanSummary.scanned}，严格 ${scanSummary.matched}，接近 ${scanSummary.nearMatched || 0} · 完整度 ${scanSummary.completeness || 0}%`}
            {fullScan.status === "idle" && scanSummary.state === "error" && `扫描失败（不是0只命中）：${scanSummary.message}，稍后会自动重试`}
          </div>
          {fullScan.status === "idle" && scanSummary.state === "done" && scanSummary.failed > 0 && <div className="scan-fail-note">失败 {scanSummary.failed} 只不会计入“0只命中”{scanSummary.failedDetails?.length ? ` · 示例：${scanSummary.failedDetails.slice(0, 2).map(item => `${item.code} ${item.reason}`).join("；")}` : ""}</div>}
          <div className="scope-row" aria-label="扫描范围">
            {[{ value: "60", label: "快速60" }, { value: "200", label: "扩展200" }, { value: "full", label: "全部A股" }].map(option => <button key={option.value} className={scanScope === option.value ? "active" : ""} onClick={() => { setScanScope(option.value); if (option.value === "full" && fullScan.status !== "running") runFullScan().catch(() => {}); }}>{option.label}</button>)}
            {fullScan.status === "running" && <button className="stop-scan" onClick={stopFullScan}>暂停</button>}
            <span>已缓存 {cacheStatus.cachedSymbols} 只</span>
          </div>
          {(listMode === "signals" || listMode === "confirmed") && <div className="cap-filter" aria-label="公司市值筛选"><span>公司市值</span>{[{value:"all",label:"全部市值"},{value:"above300",label:"300亿以上"},{value:"below300",label:"300亿以内"}].map(option => <button key={option.value} className={marketCapMode === option.value ? "active" : ""} onClick={() => { setMarketCapMode(option.value); if (listMode === "signals") setScanResults(null); }}>{option.label}</button>)}</div>}
          {listMode === "confirmed" && <div className="close-range" aria-label="收盘数据时间范围">{[{value:"2h",label:"最近2小时"},{value:"4h",label:"最近4小时"},{value:"day",label:"最近交易日"},{value:"week",label:"近5交易日"}].map(option => <button key={option.value} className={closeRange === option.value ? "active" : ""} onClick={() => setCloseRange(option.value)}>{option.label}</button>)}</div>}
          {listMode === "confirmed" && <div className="close-groups" aria-label="收盘信号分组"><button className={closeGroup === "all" ? "active" : ""} onClick={() => setCloseGroup("all")}>全部收盘信息</button><button className={closeGroup === "strict" ? "active" : ""} onClick={() => setCloseGroup("strict")}>符合要求</button><button className={closeGroup === "near" ? "active" : ""} onClick={() => setCloseGroup("near")}>接近满足</button></div>}
          <div className="watch-head"><span>排名　股票 / 代码</span><span>共振分　涨幅　量比</span></div>
          <div className="stock-list">
            {pagedVisible.map((item) => {
              const original = visible.findIndex(s => s.code === item.code);
              return <button key={item.code} className={`stock-row ${item.code === stock.code ? "selected" : ""}`} onClick={() => setSelectedCode(item.code)}>
                <b>{original + 1}</b><span className="stock-name"><strong>{item.name}</strong><small>{item.code}{listMode === "signals" && Number(item.marketCap) > 0 ? ` · 市值${(Number(item.marketCap) / 100000000).toFixed(0)}亿` : ""}{listMode === "confirmed" && item.capturedAt ? ` · ${new Date(item.capturedAt).toLocaleString("zh-CN", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false })}` : ""}</small><small className="condition-line"><i className={item.bullishMa ? "pass" : "wait"}>均线{item.bullishMa ? "✓" : "·"}</i><i className={item.macdGoldenCross ? "pass" : item.recentMacdCross ? "near" : "wait"}>MACD{item.macdGoldenCross ? "当天✓" : item.recentMacdCross ? "近3日" : "·"}</i><i className={item.volumeExpanded ? "pass" : Number(item.ratio) >= 1.2 ? "near" : "wait"}>量能{item.volumeExpanded ? "✓" : Number(item.ratio) >= 1.2 ? item.ratio : "·"}</i></small>{item.signalState === "near-confirmed" && <small className="missing-line">{(item.missingReasons || []).join(" · ")}</small>}</span>
                <strong>{item.score}</strong><em>{item.rise}</em><span>{item.ratio}</span>
              </button>
            })}
            {visible.length > visibleLimit && <button className="load-more" onClick={() => setVisibleLimit(limit => Math.min(limit + 12, visible.length))}>显示更多 <span>还有 {visible.length - visibleLimit} 只</span></button>}
            {visible.length === 0 && <div className="empty-watchlist"><Star size={28}/><strong>{query ? "没有匹配的股票" : (listMode === "confirmed" ? (scanSummary.state === "error" ? "收盘扫描失败" : "本范围内严格命中0只") : listMode === "signals" ? "本次扫描没有命中" : "还没有自选股")}</strong><span>{query ? "请尝试其他代码或名称" : (listMode === "confirmed" ? (scanSummary.state === "error" ? "这不是0只满足；免费行情恢复后可重新扫描" : "可切换“接近满足”或近5交易日查看，结果已保存") : listMode === "signals" ? "可以调整量比阈值或扩大扫描范围" : "从候选股详情中点击“加入自选”")}</span>{listMode === "watchlist" && <button onClick={() => setListMode("signals")}>返回共振候选</button>}</div>}
          </div>
          <div className="watch-note"><p>{listMode === "confirmed" ? (closeGroup === "all" ? "显示本次收盘已成功分析的全部股票及条件状态" : closeGroup === "strict" ? "符合要求：均线多头 + MACD零轴上方当天金叉 + 成交量放大" : "接近满足：多头趋势、近3日零轴金叉、量比≥1.2") : "说明：按共振分从高到低排序"}</p><strong>共 {listMode === "signals" ? signalStocks.length : visible.length} 只</strong></div>
        </aside>

        <section className="analysis">
          <div className="stock-hero">
            <div><h1>{stock.name} <small>{stock.code}</small></h1><span>{clock.label}　{clock.time}</span></div>
            <div className="quote"><strong>{stock.price}</strong><span>{stock.rise}</span></div>
            <span className="industry">{stock.industry}</span>
            <span className={`chart-source ${stockChart.fallback ? "fallback" : "live"}`}>{stockChart.loading ? "加载K线…" : stockChart.source}</span>
          </div>
          <div className="simple-guide">
            <div className="preset-card"><span>普通人预设</span><strong>一键选择风险偏好</strong><div className="preset-buttons"><button onClick={() => applyPreset("steady")}>稳健</button><button onClick={() => applyPreset("balanced")}>均衡</button><button onClick={() => applyPreset("active")}>积极</button></div><p>预设会调整市值、量比、涨幅和上市时间，仍可在专业模式中继续修改。</p></div>
            <div className={`market-card market-${marketStats.state}`}><span>市场环境</span><strong>{marketStats.state}</strong><p>上涨 {marketStats.up} · 下跌 {marketStats.down} · 上涨占比 {marketStats.ratio}%</p>{marketStats.state === "弱势" && <p className="market-caution">当前环境不适合追涨，建议使用稳健模式。</p>}</div>
            <div className="simple-summary"><span>当前结论</span><strong>{stock.signalState === "confirmed" ? "严格命中" : stock.signalState === "near-confirmed" ? "接近满足" : stock.preliminary ? "盘中观察" : "等待确认"}</strong><p>{simpleAction}</p></div>
            <div className={`risk-card risk-${riskLevel}`}><span>风险等级</span><strong>{riskLevel}风险</strong><p>{riskFlags.length ? riskFlags.join("；") : "暂未发现明显追高或过热风险，但仍可能随行情变化"}</p></div>
            <div className="plain-checks"><h3>为什么进入名单</h3><div><b className={stock.bullishMa ? "ok" : "no"}>{stock.bullishMa ? "✓" : "·"}</b><span>均线多头<small>MA5 &gt; MA10 &gt; MA20 &gt; MA60</small></span></div><div><b className={stock.macdGoldenCross ? "ok" : stock.recentMacdCross ? "near" : "no"}>{stock.macdGoldenCross ? "✓" : stock.recentMacdCross ? "近3日" : "·"}</b><span>MACD零轴金叉<small>{stock.macdGoldenCross ? "当天确认" : stock.recentMacdCross ? "不是当天金叉" : "尚未确认"}</small></span></div><div><b className={stock.volumeExpanded ? "ok" : "no"}>{stock.volumeExpanded ? "✓" : "·"}</b><span>成交量放大<small>当前量比 {stock.ratio || "--"}，标准 ≥ {strategy.volumeRatio}</small></span></div></div>
            <div className="invalidation"><h3>什么情况下信号失效</h3><p>收盘跌破MA20，或MA5跌破MA10</p><p>MACD形成死叉并跌向零轴下方</p><p>量比快速跌破1.2，放量条件消失</p></div>
            <div className="quality-card"><span>最近一次成功扫描可信度</span><strong>{scanSummary.state === "done" ? `${scanSummary.completeness || 0}%` : scanning || fullScan.status === "running" ? "计算中" : "尚无成功扫描"}</strong><p>{scanSummary.state === "done" ? `计划 ${scanSummary.attempted || 0}只 · 成功 ${scanSummary.scanned || 0}只 · 数据失败 ${scanSummary.failed || 0}只` : scanning || fullScan.status === "running" ? "扫描完成后自动更新可信度" : "点击刷新后显示数据完整度"}</p><p>{scanSummary.state === "done" ? `更新于 ${refreshTime(scanSummary.updatedAt)} · ` : ""}{scanSummary.sourceLabel || feed.sourceLabel || "免费行情"} · 行情覆盖 {scanSummary.quoteCoverage || feed.count || 0}只</p></div>
            <div className="simple-warning"><Warning size={20}/><p>技术信号不代表一定上涨。避免追高、重仓单只股票或把观察信号当成买入指令。</p></div>
          </div>
          <div className="chart-toolbar">
            <div>{["分时", "1分", "5分", "15分", "30分", "60分", "日K", "周K", "月K"].map(x => <button key={x} className={range === x ? "active" : ""} onClick={() => setRange(x)}>{x}</button>)}</div>
            <div><button onClick={runStockBacktest}><ChartLineUp size={16}/>回测</button><button onClick={() => setFiltersOpen(v => !v)}><SlidersHorizontal size={16}/>指标</button><button>复权<CaretDown size={13}/></button></div>
          </div>
          <div className="legend"><span>MA5: <b className="white">{latestBar?.ma5?.toFixed?.(2) || "--"}</b></span><span>MA10: <b className="yellow">{latestBar?.ma10?.toFixed?.(2) || "--"}</b></span><span>MA20: <b className="purple">{latestBar?.ma20?.toFixed?.(2) || "--"}</b></span><span>MA60: <b className="cyan">{latestBar?.ma60?.toFixed?.(2) || "--"}</b></span></div>
          <div className="price-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={stockChart.data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#202a32" vertical={false}/><XAxis dataKey="day" stroke="#7d8993" tickLine={false}/><YAxis orientation="right" domain={["auto", "auto"]} stroke="#7d8993" tickLine={false}/><Tooltip content={<MiniTip/>}/>
                <Line dataKey="close" stroke="#ef4444" strokeWidth={2.4} dot={false}/><Line dataKey="ma5" stroke="#f4f4f5" strokeWidth={1.2} dot={false}/><Line dataKey="ma10" stroke="#f2c94c" strokeWidth={1.5} dot={false}/><Line dataKey="ma20" stroke="#c15fe4" strokeWidth={1.4} dot={false}/><Line dataKey="ma60" stroke="#24c7d9" strokeWidth={1.5} dot={false}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="subchart-head">成交量　{latestBar ? `${latestBar.vol}万手` : "--"}</div>
          <div className="volume-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={stockChart.data} margin={{right:4,left:-12}}><XAxis dataKey="day" hide/><YAxis orientation="right" stroke="#7d8993" tickLine={false}/><Bar dataKey="vol" fill="#ef4444"/><Line dataKey="ma10" stroke="#24c7d9" dot={false}/></ComposedChart></ResponsiveContainer></div>
          <div className="subchart-head">MACD (12,26,9)　DIF: {latestBar?.dif?.toFixed?.(2) || "--"}　 <span>DEA: {latestBar?.dea?.toFixed?.(2) || "--"}</span>　<b className="red">MACD: {latestBar?.macd?.toFixed?.(2) || "--"}</b></div>
          <div className="macd-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={stockChart.data} margin={{right:4,left:-12}}><XAxis dataKey="day" stroke="#7d8993" tickLine={false}/><YAxis orientation="right" stroke="#7d8993" tickLine={false}/><ReferenceLine y={0} stroke="#55606a"/><Bar dataKey="macd" fill="#ef4444"/><Line dataKey="dif" stroke="#f4f4f5" dot={false}/><Line dataKey="dea" stroke="#f2c94c" dot={false}/></ComposedChart></ResponsiveContainer></div>
        </section>

        <aside className="validator">
          <h2>信号验证</h2>
          <div className="score"><span>{stock.preliminary ? "观察评分" : "共振评分"}<strong>{stock.score}<small>/100</small></strong></span><b className={`signal-state ${stock.signalState || "intraday"}`}>{stock.signalState === "confirmed" ? "收盘确认" : stock.signalState === "unavailable" ? "等待数据" : stock.signalState === "watch" ? "实时观察" : "盘中触发"}</b></div>
          {stock.preliminary && <p className="preliminary-note">量价实时预筛结果，点击“重新扫描”后进行均线与 MACD 完整确认。</p>}
          {stock.code !== "------" && !stock.preliminary ? <>
            <CheckItem title="均线多头"><p>MA5 &gt; <b>MA10</b> &gt; <i>MA20</i> &gt; <em>MA60</em></p><p>{Number(stock.ma5 || 0).toFixed(2)} &gt; {Number(stock.ma10 || 0).toFixed(2)} &gt; {Number(stock.ma20 || 0).toFixed(2)} &gt; {Number(stock.ma60 || 0).toFixed(2)}</p></CheckItem>
            <CheckItem title="MACD零轴上金叉"><p>DIF {Number(stock.dif || 0).toFixed(2)} 上穿 <b>DEA {Number(stock.dea || 0).toFixed(2)}</b></p><p>DIF &gt; DEA &gt; 0</p></CheckItem>
            <CheckItem title="量能放大"><p>量比 {stock.ratio}</p><p>达到设定阈值 {strategy.volumeRatio}</p></CheckItem>
          </> : <div className="empty-history">{stock.preliminary ? "点击重新扫描，完成均线与MACD确认" : "真实行情恢复后显示验证结果"}</div>}
          <div className="filter-box"><h3>筛选条件（当前生效）</h3><div><span>排除 ST</span><b>{strategy.excludeST ? "是" : "否"}</b></div><div><span>上市 ≥ {strategy.minDays}日</span><b>是</b></div><div><span>涨幅 ≤ {strategy.maxRise}%</span><b>是</b></div><div><span>量比 ≥ {strategy.volumeRatio}</span><b>是</b></div></div>
          <button className={`favorite ${favorite ? "on" : ""}`} onClick={toggleFavorite}><Star size={20} weight={favorite ? "fill" : "regular"}/>{favorite ? "移出自选" : "加入自选"}</button>
          {filtersOpen && <StrategyDrawer strategy={strategy} setStrategy={setStrategy} dataProvider={dataProvider} setDataProvider={setDataProvider} onClose={() => setFiltersOpen(false)} onApply={applyStrategy} onReset={() => setStrategy(DEFAULT_STRATEGY)}/>} 
        </aside>
      </section>

      <footer className="event-log"><div className="log-title"><div className="log-tabs"><button className={logMode === "signals" ? "active" : ""} onClick={() => setLogMode("signals")}>最新触发</button><button className={logMode === "history" ? "active" : ""} onClick={() => setLogMode("history")}>扫描记录 <small>{scanHistory.length}</small></button></div><span><Warning size={18}/>盘中信号可能变化，以收盘确认结果为准</span></div>
        {logMode === "signals" && stocks.slice(0,3).map((s,i) => <div className="log-row" key={s.code}><time>{["10:30:42","10:29:18","10:28:55"][i]}</time><b>{s.name}　{s.code}</b><span>均线多头，MACD零轴上金叉，量比 {s.ratio}，量能放大，触发共振信号（盘中）</span></div>)}
        {logMode === "history" && (scanHistory.length ? scanHistory.slice(0,3).map(record => <div className="log-row history-row" key={record.id}><time>{record.time}</time><b>{record.scope === "batch" ? "全市场分批" : `扫描${record.scope}只`}</b><span>{record.fallback ? "离线演示" : record.signalState === "confirmed" ? "收盘确认" : "盘中扫描"} · 扫描 {record.scanned} · 命中 {record.matched} · 量比阈值 {record.volumeRatio} · {(record.durationMs / 1000).toFixed(1)}秒</span></div>) : <div className="empty-history">运行一次扫描后，记录会保存在这里</div>)}
      </footer>
      {toast && <div className="signal-toast"><Bell size={20} weight="fill"/><div><strong>{toast.fallback ? "新增演示信号" : "发现新共振信号"}</strong><span>{toast.count} 只股票已加入提醒中心</span></div></div>}
      {backtest.open && <BacktestModal stock={stock} backtest={backtest} strategy={strategy} onClose={() => setBacktest(current => ({ ...current, open: false }))}/>} 
    </main>
  );
}

function CheckItem({ title, children }) {
  return <div className="check-item"><div className="check-icon"><Check size={14} weight="bold"/></div><div><h3>{title}<span>已满足</span></h3>{children}</div></div>;
}

function StrategyDrawer({ strategy, setStrategy, dataProvider, setDataProvider, onClose, onApply, onReset }) {
  const updateArray = (key, index, value) => setStrategy(current => ({ ...current, [key]: current[key].map((item, itemIndex) => itemIndex === index ? Number(value) : item) }));
  const validMa = strategy.ma.every((value, index, array) => Number.isFinite(value) && value >= 2 && (index === 0 || value > array[index - 1]));
  const validMacd = strategy.macd.every(value => Number.isFinite(value) && value >= 2) && strategy.macd[0] < strategy.macd[1];
  const valid = validMa && validMacd && strategy.volumeRatio >= 1 && strategy.maxRise >= 1 && strategy.minDays >= strategy.ma[3];
  return <div className="drawer strategy-drawer">
    <div className="drawer-head"><strong>策略参数</strong><button aria-label="关闭设置" onClick={onClose}><X size={18}/></button></div>
    <fieldset><legend>均线周期</legend><div className="input-grid four">{strategy.ma.map((value, index) => <label key={index}>MA{index + 1}<input type="number" min="2" max="250" value={value} onChange={event => updateArray("ma", index, event.target.value)}/></label>)}</div></fieldset>
    <fieldset><legend>MACD</legend><div className="input-grid three">{["快线", "慢线", "信号"].map((label, index) => <label key={label}>{label}<input type="number" min="2" max="60" value={strategy.macd[index]} onChange={event => updateArray("macd", index, event.target.value)}/></label>)}</div></fieldset>
    <fieldset><legend>量能与过滤</legend><div className="input-grid two"><label>量比阈值<input type="number" min="1" max="5" step="0.1" value={strategy.volumeRatio} onChange={event => setStrategy(current => ({ ...current, volumeRatio: Number(event.target.value) }))}/></label><label>最大涨幅 %<input type="number" min="1" max="20" value={strategy.maxRise} onChange={event => setStrategy(current => ({ ...current, maxRise: Number(event.target.value) }))}/></label><label>最少上市日<input type="number" min="60" max="500" value={strategy.minDays} onChange={event => setStrategy(current => ({ ...current, minDays: Number(event.target.value) }))}/></label><label className="check-label"><input type="checkbox" checked={strategy.excludeST} onChange={event => setStrategy(current => ({ ...current, excludeST: event.target.checked }))}/>排除 ST</label></div></fieldset>
    <fieldset><legend>数据源</legend><label className="provider-select">行情模式<select value={dataProvider} onChange={event => setDataProvider(event.target.value)}><option value="auto">自动网络（失败降级）</option><option value="local">仅本地导入与缓存</option></select></label><p className="provider-help">本地模式读取 data/import/quotes.json 和 data/cache/market-history。</p></fieldset>
    <div className="strategy-summary">MA {strategy.ma.join(" / ")}　·　MACD {strategy.macd.join(" / ")}　·　量比 ≥ {strategy.volumeRatio}</div>
    {!valid && <div className="strategy-error">请确保均线周期递增、MACD快线小于慢线，且上市日数不少于最长均线。</div>}
    <div className="strategy-actions"><button className="reset-strategy" onClick={onReset}>恢复默认</button><button className="apply-strategy" disabled={!valid} onClick={onApply}>保存并重新扫描</button></div>
  </div>;
}

function BacktestModal({ stock, backtest, strategy, onClose }) {
  const data = backtest.data;
  return <div className="modal-backdrop"><section className="backtest-modal"><header><div><strong>{stock.name} 策略回测</strong><span>{stock.code} · 持有5个交易日 · MA {strategy.ma.join("/")} · MACD {strategy.macd.join("/")}</span></div>{backtest.fallback && <em>演示结果</em>}<button aria-label="关闭回测" onClick={onClose}><X size={19}/></button></header>{backtest.loading ? <div className="backtest-loading">正在加载历史数据并计算…</div> : data ? <><div className="backtest-metrics"><div><span>累计收益</span><strong className={data.totalReturn >= 0 ? "positive" : "negative"}>{data.totalReturn.toFixed(2)}%</strong></div><div><span>胜率</span><strong>{data.winRate.toFixed(1)}%</strong></div><div><span>交易次数</span><strong>{data.trades}</strong></div><div><span>平均收益</span><strong>{data.avgReturn.toFixed(2)}%</strong></div><div><span>最大回撤</span><strong className="negative">{data.maxDrawdown.toFixed(2)}%</strong></div></div><div className="equity-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.curve} margin={{top:12,right:12,left:-15,bottom:0}}><CartesianGrid stroke="#26313a" vertical={false}/><XAxis dataKey="index" stroke="#74808a"/><YAxis stroke="#74808a"/><ReferenceLine y={0} stroke="#59636b"/><Area dataKey="equity" stroke="#3b8ff0" fill="#153252" fillOpacity={0.65}/></ComposedChart></ResponsiveContainer></div><p className="backtest-note">回测仅用于研究，不代表未来收益。真实结果需计入手续费、滑点、停牌和涨跌停约束。</p></> : <div className="backtest-loading">暂时无法取得可用历史数据</div>}</section></div>;
}
