CREATE TABLE "workers" (
	"id" varchar(200) PRIMARY KEY NOT NULL,
	"queue" varchar(64) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"beat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" varchar(64),
	"browsers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lanes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"website_checks" boolean DEFAULT false NOT NULL,
	"recurring_runs" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "progress_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "workers_queue_beat_idx" ON "workers" USING btree ("queue","beat_at");