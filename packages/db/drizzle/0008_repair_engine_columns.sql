ALTER TABLE "runs" ADD COLUMN "parent_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "target_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "run_items" ADD COLUMN "target_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "run_items" ADD COLUMN "absent_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "requested_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_parent_run_id_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "runs_parent_run_id_idx" ON "runs" ("parent_run_id");
