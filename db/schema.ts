import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const closeScans = sqliteTable("close_scans", {
  id: text("id").primaryKey(),
  sessionDate: text("session_date").notNull(),
  capturedAt: integer("captured_at").notNull(),
  scanMode: text("scan_mode").notNull(),
  status: text("status").notNull(),
  attempted: integer("attempted").notNull().default(0),
  scanned: integer("scanned").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  completeness: integer("completeness").notNull().default(0),
  sourceLabel: text("source_label"),
  itemsJson: text("items_json").notNull().default("[]"),
});
