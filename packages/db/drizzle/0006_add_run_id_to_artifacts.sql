ALTER TABLE "captures" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captures_run_id_idx" ON "captures" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extractions_run_id_idx" ON "extractions" USING btree ("run_id");