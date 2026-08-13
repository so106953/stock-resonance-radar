import { NextRequest, NextResponse } from "next/server";

const QUOTE_URLS = [
  "https://push2.eastmoney.com/api/qt/clist/get",
  "https://82.push2.eastmoney.com/api/qt/clist/get",
  "https://28.push2.eastmoney.com/api/qt/clist/get",
];
const HISTORY_URLS = [
  "https://push2his.eastmoney.com/api/qt/stock/kline/get",
  "https://53.push2his.eastmoney.com/api/qt/stock/kline/get",
];
const CORE_A_SHARE_CODES = [
  "600000","600009","600010","600015","600016","600018","600019","600028","600030","600031","600036","600048","600050","600089","600104","600111","600150","600176","600196","600276","600309","600406","600438","600519","600547","600570","600585","600588","600660","600690","600745","600809","600837","600887","600900","600919","600938","600941","600958","600999","601006","601012","601066","601088","601138","601166","601186","601211","601225","601288","601318","601319","601328","601336","601390","601398","601601","601628","601668","601688","601728","601766","601788","601800","601816","601857","601888","601899","601919","601985","601988","601989","601998","603019","603259","603288","603501","603986",
  "000001","000002","000063","000066","000100","000157","000166","000333","000338","000425","000538","000568","000596","000625","000651","000661","000725","000768","000776","000792","000858","000876","000895","000938","000963","000977","001289","001979","002027","002049","002050","002129","002142","002179","002230","002236","002241","002252","002304","002311","002352","002371","002410","002415","002459","002460","002463","002475","002493","002594","002601","002714","002812","002821","002920","002938","002966","003816","300014","300015","300033","300059","300122","300124","300274","300308","300316","300347","300394","300408","300413","300433","300450","300454","300496","300498","300502","300628","300661","300750","300751","300759","300760","300782","300896","300919","300957","300979" ];
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url: string, attempts = 2, timeout = 8500) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json,text/plain,*/*" }, signal: AbortSignal.timeout(timeout), cache: "no-store" });
      if (response.ok) return response;
      lastError = new Error(`上游返回 ${response.status}`);
    } catch (error) { lastError = error; }
    if (attempt + 1 < attempts) await delay(180 * (attempt + 1));
  }
  throw lastError instanceof Error ? lastError : new Error("上游数据源不可用");
}
function ema(values: number[], period: number) {
  const multiplier = 2 / (period + 1);
  let previous = values[0];
  return values.map(value => (previous = value * multiplier + previous * (1 - multiplier)));
}

type QuoteBody = { data?: { total?: number; diff?: Record<string, unknown>[] | Record<string, Record<string, unknown>> } };
type QuoteResult = Awaited<ReturnType<typeof loadAvailableQuotesUncached>>;
let quoteCache: { expiresAt: number; value: QuoteResult } | null = null;
let quoteRequest: Promise<QuoteResult> | null = null;
const historyCache = new Map<string, { expiresAt: number; value: HistoryBar[] }>();
const historyRequests = new Map<string, Promise<HistoryBar[]>>();
type HistoryBar = { date: string; open: number; close: number; high: number; low: number; volume: number; amount: number };

function pythonDataApi() {
  return String(process.env.PYTHON_DATA_API || "").replace(/\/$/, "");
}

async function loadPythonQuotes() {
  const base = pythonDataApi();
  if (!base) throw new Error("Python 备用源未配置");
  const response = await fetchWithRetry(`${base}/api/quotes`, 1, 12_000);
  const body = await response.json() as { data?: Record<string, unknown>[] };
  const rows = Array.isArray(body.data) ? body.data
    .filter(item => /^\d{6}$/.test(String(item.code || "")))
    .map(item => ({ ...item, volume: Number(item.volume || item.amount || 0) })) : [];
  if (rows.length < 100) throw new Error(`Python 行情仅取得 ${rows.length} 只`);
  return rows;
}

async function loadPythonTencentQuotes(codes: string[]) {
  const base = pythonDataApi();
  if (!base) throw new Error("Python 数据源未配置");
  if (!codes.length || codes.length > 100) throw new Error("腾讯批量行情须为1到100只");
  const response = await fetchWithRetry(`${base}/api/tencent-quotes?codes=${encodeURIComponent(codes.join(","))}`, 2, 15_000);
  const body = await response.json() as { data?: Record<string, unknown>[]; detail?: string };
  const rows = Array.isArray(body.data) ? body.data
    .filter(item => /^\d{6}$/.test(String(item.code || "")))
    // 当前腾讯后端以成交额为主要活跃度字段；补成非零volume，避免被误判为停牌。
    .map(item => ({ ...item, volume: Number(item.volume || item.amount || 0) })) : [];
  if (!rows.length) throw new Error(body.detail || "腾讯批量行情返回空数据");
  return rows;
}

async function loadQuotePage(page: number, pageSize = 500) {
  const query = new URLSearchParams({ pn: String(page), pz: String(pageSize), po: "1", np: "1", fltt: "2", invt: "2", fid: "f3", fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23", fields: "f2,f3,f5,f6,f10,f12,f14,f15,f16,f17,f18,f20" });
  let lastError = "行情节点不可用";
  for (const endpoint of QUOTE_URLS) {
    try {
      const response = await fetchWithRetry(`${endpoint}?${query}`);
      if (!response.ok) { lastError = `行情节点返回 ${response.status}`; continue; }
      const body = await response.json() as QuoteBody;
      const raw = body.data?.diff;
      const rows = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : []);
      if (rows.length) return { rows, total: Number(body.data?.total || rows.length) };
      lastError = "行情节点返回空数据";
    } catch (error) { lastError = error instanceof Error ? error.message : "行情节点异常"; }
  }
  throw new Error(lastError);
}

async function loadQuotes() {
  const first = await loadQuotePage(1);
  const pages = Math.min(12, Math.max(1, Math.ceil(first.total / 500)));
  const remaining = pages > 1 ? await Promise.all(Array.from({ length: pages - 1 }, (_, index) => loadQuotePage(index + 2).catch(() => ({ rows: [], total: first.total })))) : [];
  const unique = new Map<string, Record<string, unknown>>();
  for (const item of [first, ...remaining].flatMap(page => page.rows)) {
    const code = String(item.f12 || "");
    if (/^\d{6}$/.test(code)) unique.set(code, item);
  }
  const rows = [...unique.values()];
  if (rows.length < 100) throw new Error(`完整行情不足，仅取得 ${rows.length} 只`);
  return rows.map(item => ({ code: String(item.f12), name: String(item.f14), price: number(item.f2), changePercent: number(item.f3), volume: number(item.f5), amount: number(item.f6), volumeRatio: number(item.f10), high: number(item.f15), low: number(item.f16), open: number(item.f17), previousClose: number(item.f18), marketCap: number(item.f20) }));
}

async function loadTencentQuotes() {
  const symbols = CORE_A_SHARE_CODES.map(code => `${code.startsWith("6") ? "sh" : "sz"}${code}`);
  const chunks = Array.from({ length: Math.ceil(symbols.length / 50) }, (_, index) => symbols.slice(index * 50, index * 50 + 50));
  const texts = await Promise.all(chunks.map(async chunk => {
    const response = await fetchWithRetry(`https://qt.gtimg.cn/q=${chunk.join(",")}`);
    if (!response.ok) throw new Error(`腾讯行情返回 ${response.status}`);
    const bytes = await response.arrayBuffer();
    try { return new TextDecoder("gbk").decode(bytes); } catch { return new TextDecoder().decode(bytes); }
  }));
  const rows = texts.join("\n").split(/;\s*/).map(line => {
    const match = line.match(/v_(?:sh|sz)(\d{6})="([\s\S]*)"/);
    if (!match) return null;
    const fields = match[2].split("~");
    const price = Number(fields[3]); const previousClose = Number(fields[4]);
    const changePercent = Number(fields[32] || (previousClose ? ((price / previousClose - 1) * 100).toFixed(2) : 0));
    return { code: match[1], name: fields[1] || match[1], price, previousClose, open: Number(fields[5]), volume: Number(fields[36] || fields[6]), amount: Number(fields[37] || 0) * 10000, changePercent, high: Number(fields[33]), low: Number(fields[34]), volumeRatio: Number(fields[49] || 0), marketCap: Number(fields[45] || 0) * 100000000 };
  }).filter((row): row is NonNullable<typeof row> => Boolean(row && row.code && Number.isFinite(row.price) && row.price > 0));
  if (rows.length < 20) throw new Error(`腾讯行情仅取得 ${rows.length} 只`);
  return rows;
}

async function loadAvailableQuotesUncached() {
  try { return { rows: await loadQuotes(), source: "eastmoney-public", sourceLabel: "东方财富公开行情" }; }
  catch (primaryError) {
    const [pythonResult, tencentResult] = await Promise.allSettled([loadPythonQuotes(), loadTencentQuotes()]);
    if (pythonResult.status === "fulfilled") return { rows: pythonResult.value, source: "akshare-render", sourceLabel: "AKShare 免费行情", warning: primaryError instanceof Error ? primaryError.message : "主行情源不可用" };
    if (tencentResult.status === "fulfilled") return { rows: tencentResult.value, source: "tencent-public", sourceLabel: "腾讯核心行情（覆盖有限）", warning: `全市场源暂不可用：${pythonResult.reason instanceof Error ? pythonResult.reason.message : "Python 备用源失败"}` };
    throw new Error(`东方财富：${primaryError instanceof Error ? primaryError.message : "不可用"}；AKShare：${pythonResult.reason instanceof Error ? pythonResult.reason.message : "不可用"}；腾讯：${tencentResult.reason instanceof Error ? tencentResult.reason.message : "不可用"}`);
  }
}

async function loadAvailableQuotes(force = false) {
  const now = Date.now();
  if (!force && quoteCache && quoteCache.expiresAt > now) return { ...quoteCache.value, cacheHit: true };
  if (quoteRequest) return { ...(await quoteRequest), sharedRequest: true };
  quoteRequest = loadAvailableQuotesUncached();
  try {
    const value = await quoteRequest;
    quoteCache = { value, expiresAt: Date.now() + 15_000 };
    return value;
  } finally { quoteRequest = null; }
}

async function fetchHistoryUncached(code: string): Promise<HistoryBar[]> {
  const market = code.startsWith("6") ? "1" : "0";
  const query = new URLSearchParams({ secid: `${market}.${code}`, klt: "101", fqt: "1", lmt: "140", end: "20500101", fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61" });
  const base = pythonDataApi();
  try {
    if (!base) throw new Error("Python 备用源未配置");
    const response = await fetchWithRetry(`${base}/api/history/${code}`, 2, 15_000);
    const body = await response.json() as { data?: HistoryBar[]; detail?: string };
    if (!Array.isArray(body.data) || body.data.length < 70) throw new Error(body.detail || "百度日K不足");
    return body.data.map(row => ({ date: String(row.date), open: Number(row.open), close: Number(row.close), high: Number(row.high), low: Number(row.low), volume: Number(row.volume), amount: Number(row.amount || 0) }));
  } catch (pythonError) {
    const eastmoneyTasks = HISTORY_URLS.map(async endpoint => {
      const response = await fetchWithRetry(`${endpoint}?${query}`, 1, 5000);
      const body = await response.json() as { data?: { klines?: string[] } };
      if (!Array.isArray(body.data?.klines) || body.data.klines.length < 70) throw new Error("东财历史行情不足");
      return body.data.klines.map(line => { const [date, open, close, high, low, volume, amount] = line.split(","); return { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume), amount: Number(amount) }; });
    });
    try { return await Promise.any(eastmoneyTasks); }
    catch { throw new Error(`百度日K失败：${pythonError instanceof Error ? pythonError.message : "未知错误"}；东财后备也不可用`); }
  }
}

async function loadHistory(code: string) {
  const cached = historyCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = historyRequests.get(code);
  if (pending) return pending;
  const request = fetchHistoryUncached(code);
  historyRequests.set(code, request);
  try {
    const value = await request;
    historyCache.set(code, { value, expiresAt: Date.now() + 6 * 3600_000 });
    return value;
  } finally { historyRequests.delete(code); }
}

function strategyFrom(url: URL) {
  return {
    ma: (url.searchParams.get("ma") || "5,10,20,60").split(",").map(Number),
    macd: (url.searchParams.get("macd") || "12,26,9").split(",").map(Number),
    volumeRatio: Number(url.searchParams.get("volumeRatio") || 1.5),
    maxRise: Number(url.searchParams.get("maxRise") || 7),
    minDays: Number(url.searchParams.get("minDays") || 120),
    excludeST: url.searchParams.get("excludeST") !== "false",
    marketCapMode: url.searchParams.get("marketCapMode") || "all",
  };
}

function analyze(quote: Record<string, any>, bars: Awaited<ReturnType<typeof loadHistory>>, strategy: ReturnType<typeof strategyFrom>) {
  const closes = bars.map(row => row.close);
  const volumes = bars.map(row => row.volume);
  const mas = strategy.ma.map(period => average(closes.slice(-period)));
  const fast = ema(closes, strategy.macd[0]);
  const slow = ema(closes, strategy.macd[1]);
  const dif = fast.map((value, index) => value - slow[index]);
  const dea = ema(dif, strategy.macd[2]);
  const last = dif.length - 1;
  const bullishMa = mas[0] > mas[1] && mas[1] > mas[2] && mas[2] > mas[3];
  const macdGoldenCross = dif[last] > dea[last] && dif[last - 1] <= dea[last - 1] && dif[last] > 0 && dea[last] > 0;
  const recentMacdCross = [last, last - 1, last - 2].some(index => index > 0 && dif[index] > dea[index] && dif[index - 1] <= dea[index - 1] && dif[index] > 0 && dea[index] > 0);
  const volumeRatio = quote.volumeRatio > 0 ? quote.volumeRatio : volumes[last] / average(volumes.slice(-6, -1));
  const volumeExpanded = volumeRatio >= strategy.volumeRatio;
  const score = (bullishMa ? 40 : 0) + (macdGoldenCross ? 35 : 0) + (volumeExpanded ? 25 : Math.min(24, Math.round(volumeRatio * 12)));
  const matched = bullishMa && macdGoldenCross && volumeExpanded;
  const nearMatch = !matched && bullishMa && recentMacdCross && volumeRatio >= 1.2;
  const missingReasons = [!bullishMa ? "均线未完全多头" : "", !recentMacdCross ? "近3日无零轴金叉" : (!macdGoldenCross ? "金叉不是当日发生" : ""), !volumeExpanded ? `量比${volumeRatio.toFixed(2)}未达${strategy.volumeRatio}` : ""].filter(Boolean);
  return { ...quote, barDate: bars[last]?.date, ma5: mas[0], ma10: mas[1], ma20: mas[2], ma60: mas[3], dif: dif[last], dea: dea[last], volumeRatio, bullishMa, macdGoldenCross, recentMacdCross, volumeExpanded, score, matched, nearMatch, missingReasons };
}

function marketSession() {
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)?.value || "";
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const workday = !["周六", "周日"].includes(get("weekday"));
  const trading = workday && ((minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900));
  return { trading, workday, signalState: trading ? "intraday" : "confirmed", label: trading ? "盘中实时扫描" : "收盘后复盘" };
}

function chart(bars: Awaited<ReturnType<typeof loadHistory>>, strategy: ReturnType<typeof strategyFrom>) {
  const closes = bars.map(row => row.close);
  const fast = ema(closes, strategy.macd[0]); const slow = ema(closes, strategy.macd[1]);
  const dif = fast.map((value, index) => value - slow[index]); const dea = ema(dif, strategy.macd[2]);
  return bars.slice(-60).map((row, visibleIndex) => { const index = bars.length - 60 + visibleIndex; return { day: visibleIndex % 10 === 0 || visibleIndex === 59 ? row.date.slice(5) : "", close: row.close, high: row.high, low: row.low, vol: Math.round(row.volume / 10000), ma5: average(closes.slice(Math.max(0,index-strategy.ma[0]+1), index+1)), ma10: average(closes.slice(Math.max(0,index-strategy.ma[1]+1), index+1)), ma20: average(closes.slice(Math.max(0,index-strategy.ma[2]+1), index+1)), ma60: average(closes.slice(Math.max(0,index-strategy.ma[3]+1), index+1)), dif: dif[index], dea: dea[index], macd: (dif[index]-dea[index])*2 }; });
}

export async function GET(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  const url = new URL(request.url);
  if (action === "cache-status") return NextResponse.json({ cachedSymbols: 0, ttlHours: 0, hosted: true });
  if (action === "quotes") {
    try { const result = await loadAvailableQuotes(url.searchParams.get("force") === "1"); return NextResponse.json({ source: result.source, sourceLabel: result.sourceLabel, fallback: false, updatedAt: new Date().toISOString(), count: result.rows.length, warning: result.warning, cacheHit: Boolean(result.cacheHit), sharedRequest: Boolean(result.sharedRequest), refreshMode: "打开网页自动更新", data: result.rows }); }
    catch (error) { return NextResponse.json({ error: "免费行情源暂不可用", source: "unavailable", updatedAt: new Date().toISOString(), count: 0, warning: error instanceof Error ? error.message : "行情不可用", data: [] }, { status: 503 }); }
  }
  const strategy = strategyFrom(url);
  if (action === "history") {
    const code = url.searchParams.get("code") || "";
    try { const bars = await loadHistory(code); return NextResponse.json({ source: "eastmoney-public", fallback: false, code, count: bars.length, data: chart(bars, strategy) }); }
    catch (error) { return NextResponse.json({ error: "历史行情暂不可用", source: "unavailable", code, warning: error instanceof Error ? error.message : "历史行情不可用", data: [] }, { status: 503 }); }
  }
  if (action === "scan") {
    const started = Date.now();
    try {
      const session = marketSession();
      const requested = url.searchParams.get("limit") || "60";
      const requestedCodes = (url.searchParams.get("codes") || "").split(",").filter(code => /^\d{6}$/.test(code)).slice(0, 100);
      const quoteResult = requestedCodes.length
        ? { rows: await loadPythonTencentQuotes(requestedCodes), source: "tencent-render", sourceLabel: "腾讯实时行情 + 百度日K" }
        : await loadAvailableQuotes();
      const quotes = quoteResult.rows;
      const codeSet = new Set(requestedCodes);
      const limit = requestedCodes.length ? requestedCodes.length : requested === "batch" ? 300 : Math.min(Math.max(Number(requested) || 60, 1), 200);
      const eligible = quotes.filter(row => Number(row.price) > 0 && Number(row.volume) > 0).filter(row => {
        if (strategy.marketCapMode === "all" || requestedCodes.length) return true;
        const cap = Number(row.marketCap || 0);
        if (!cap) return false;
        return strategy.marketCapMode === "above300" ? cap >= 30000000000 : cap < 30000000000;
      });
      const pool = (requestedCodes.length
        ? eligible.filter(row => codeSet.has(row.code))
        : eligible.filter(row => Number(row.amount) > 0).filter(row => !strategy.excludeST || !row.name.includes("ST")).filter(row => Number(row.changePercent) <= strategy.maxRise).sort((a,b) => Number(b.amount)-Number(a.amount)))
        .slice(0, limit);
      const results: Record<string, any>[] = []; const failedDetails: { code: string; reason: string }[] = []; let cursor = 0; let failed = 0;
      async function worker() { while (cursor < pool.length) { const quote = pool[cursor++]; try { const bars = await loadHistory(quote.code); if (bars.length >= strategy.minDays) results.push(analyze(quote, bars, strategy)); else { failed++; failedDetails.push({ code: quote.code, reason: `历史数据不足：${bars.length}` }); } } catch (error) { failed++; failedDetails.push({ code: quote.code, reason: error instanceof Error ? error.message : "历史数据请求失败" }); } } }
      // 免费实例资源有限。全市场小批次使用2路，普通扫描最多4路。
      await Promise.all(Array.from({ length: requestedCodes.length ? 2 : 4 }, worker));
      results.sort((a,b) => b.score-a.score); const matches = results.filter(item => item.matched).map(item => ({ ...item, signalState: session.signalState }));
      const nearMatches = results.filter(item => item.nearMatch).slice(0, 80).map(item => ({ ...item, signalState: session.signalState === "confirmed" ? "near-confirmed" : "near-intraday" }));
      const attempted = pool.length; const completeness = attempted ? Math.round(results.length / attempted * 100) : 0;
      const sessionDate = String(results.find(item => item.barDate)?.barDate || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()));
      return NextResponse.json({ source: quoteResult.source, sourceLabel: quoteResult.sourceLabel, fallback: false, scanMode: session.label, signalState: session.signalState, sessionDate, attempted, scanned: results.length, failed, failedDetails: failedDetails.slice(0, 20), completeness, quoteCoverage: quotes.length, matched: matches.length, nearMatched: nearMatches.length, durationMs: Date.now()-started, updatedAt: new Date().toISOString(), data: matches, nearMatches, leaders: results.slice(0,60), strategy });
    } catch (error) { return NextResponse.json({ error: "真实扫描暂不可用", source: "unavailable", scanned: 0, matched: 0, warning: error instanceof Error ? error.message : "扫描不可用", data: [], leaders: [] }, { status: 503 }); }
  }
  if (action === "backtest") return NextResponse.json({ error: "真实回测功能正在接入，当前不提供模拟结果", source: "unavailable", code: url.searchParams.get("code"), data: null }, { status: 503 });
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
