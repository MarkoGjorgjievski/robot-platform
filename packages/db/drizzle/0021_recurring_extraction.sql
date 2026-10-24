CREATE TABLE "run_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"format" varchar(8) NOT NULL,
	"filename" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"rows" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"ok" boolean NOT NULL,
	"status_code" integer,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "schedule" jsonb;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "schedule_last" jsonb;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "webhook_url" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "run_files" ADD CONSTRAINT "run_files_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_files_run_format_idx" ON "run_files" USING btree ("run_id","format");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_run_at_idx" ON "webhook_deliveries" USING btree ("run_id","at");--> statement-breakpoint
CREATE INDEX "sources_next_run_at_idx" ON "sources" USING btree ("next_run_at") WHERE "sources"."schedule" IS NOT NULL;