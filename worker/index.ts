/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

async function ensureCloseArchive(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS close_scans (id TEXT PRIMARY KEY, session_date TEXT NOT NULL, captured_at INTEGER NOT NULL, scan_mode TEXT NOT NULL, status TEXT NOT NULL, attempted INTEGER NOT NULL DEFAULT 0, scanned INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, completeness INTEGER NOT NULL DEFAULT 0, source_label TEXT, items_json TEXT NOT NULL DEFAULT '[]')`),
    db.prepare("CREATE INDEX IF NOT EXISTS close_scans_session_idx ON close_scans(session_date DESC, captured_at DESC)"),
  ]);
}

async function ensureFullScan(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS full_scan_state (id TEXT PRIMARY KEY, session_date TEXT NOT NULL, offset_count INTEGER NOT NULL DEFAULT 0, total_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, items_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL)`).run();
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/market/full-scan") {
      try {
        await ensureFullScan(env.DB);
        const id = url.searchParams.get("id") || "default";
        if (request.method === "GET") {
          const row = await env.DB.prepare("SELECT id, session_date, offset_count, total_count, failed_count, status, items_json, updated_at FROM full_scan_state WHERE id = ?").bind(id).first<Record<string, unknown>>();
          if (!row) return json({ data: null });
          return json({ data: { id: row.id, sessionDate: row.session_date, offset: row.offset_count, total: row.total_count, failed: row.failed_count, status: row.status, items: JSON.parse(String(row.items_json || "[]")), updatedAt: row.updated_at } });
        }
        if (request.method === "POST") {
          const body = await request.json() as Record<string, unknown>;
          const items = Array.isArray(body.items) ? body.items.slice(0, 800) : [];
          await env.DB.prepare("INSERT OR REPLACE INTO full_scan_state (id, session_date, offset_count, total_count, failed_count, status, items_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(id, String(body.sessionDate || "unknown"), Number(body.offset || 0), Number(body.total || 0), Number(body.failed || 0), String(body.status || "running"), JSON.stringify(items), Date.now()).run();
          return json({ ok: true });
        }
        return json({ error: "method not allowed" }, 405);
      } catch (error) { return json({ error: "全市场扫描进度暂不可用", warning: error instanceof Error ? error.message : "数据库不可用" }, 503); }
    }

    if (url.pathname === "/api/market/close-archive") {
      try {
        await ensureCloseArchive(env.DB);
        if (request.method === "GET") {
          const result = await env.DB.prepare("SELECT id, session_date, captured_at, scan_mode, status, attempted, scanned, failed, completeness, source_label, items_json FROM close_scans ORDER BY captured_at DESC LIMIT 80").all();
          const data = (result.results || []).map((row: Record<string, unknown>) => ({ id: row.id, sessionDate: row.session_date, capturedAt: row.captured_at, scanMode: row.scan_mode, status: row.status, attempted: row.attempted, scanned: row.scanned, failed: row.failed, completeness: row.completeness, sourceLabel: row.source_label, items: JSON.parse(String(row.items_json || "[]")) }));
          return json({ data });
        }
        if (request.method === "POST") {
          const body = await request.json() as Record<string, unknown>;
          const sessionDate = String(body.sessionDate || "");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return json({ error: "交易日期无效" }, 400);
          const capturedAt = Number(body.capturedAt || Date.now());
          const items = Array.isArray(body.items) ? body.items.slice(0, 160) : [];
          const id = String(body.id || `${sessionDate}-${capturedAt}`);
          await env.DB.prepare("INSERT OR REPLACE INTO close_scans (id, session_date, captured_at, scan_mode, status, attempted, scanned, failed, completeness, source_label, items_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(id, sessionDate, capturedAt, String(body.scanMode || "收盘后复盘"), String(body.status || "success"), Number(body.attempted || 0), Number(body.scanned || 0), Number(body.failed || 0), Number(body.completeness || 0), String(body.sourceLabel || "免费行情"), JSON.stringify(items)).run();
          return json({ ok: true, id });
        }
        return json({ error: "method not allowed" }, 405);
      } catch (error) { return json({ error: "收盘记录服务暂不可用", warning: error instanceof Error ? error.message : "数据库不可用" }, 503); }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
