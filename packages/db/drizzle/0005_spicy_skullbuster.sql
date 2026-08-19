CREATE TABLE "run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"url" text NOT NULL,
	"input_index" integer DEFAULT 0 NOT NULL,
	"input_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"listing_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"page_number" integer,
	"parent_id" uuid,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"extraction_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_items_run_url_idx" ON "run_items" USING btree ("run_id","url");--> statement-breakpoint
CREATE INDEX "run_items_run_status_idx" ON "run_items" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "run_items_run_kind_idx" ON "run_items" USING btree ("run_id","kind");--> statement-breakpoint
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_parent_id_run_items_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "run_items"("id") ON DELETE set null;