ALTER TABLE "run_items" ADD COLUMN "variant_of" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "variant_summary" jsonb;