ALTER TABLE "runs" ADD COLUMN "parent_run_id" uuid REFERENCES "runs"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "target_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "run_items" ADD COLUMN "target_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "run_items" ADD COLUMN "absent_fields" jsonb;
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "requested_fields" jsonb;
--> statement-breakpoint
CREATE INDEX "runs_parent_run_id_idx" ON "runs" ("parent_run_id");
