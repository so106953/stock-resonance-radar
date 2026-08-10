CREATE TABLE `close_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`session_date` text NOT NULL,
	`captured_at` integer NOT NULL,
	`scan_mode` text NOT NULL,
	`status` text NOT NULL,
	`attempted` integer DEFAULT 0 NOT NULL,
	`scanned` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`completeness` integer DEFAULT 0 NOT NULL,
	`source_label` text,
	`items_json` text DEFAULT '[]' NOT NULL
);
