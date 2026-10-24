ALTER TABLE "orgs" ADD COLUMN "ai_cap_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_ai_cap_usd_nonnegative" CHECK ("orgs"."ai_cap_usd" >= 0);