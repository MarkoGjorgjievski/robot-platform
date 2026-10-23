CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" varchar(64) DEFAULT 'default' NOT NULL,
	"type" varchar(40) NOT NULL,
	"key" varchar(200),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(12) DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 10 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"locked_by" varchar(200),
	"locked_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "coverage_checks" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "drift_checks" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "source_verifications" ADD COLUMN "job_id" uuid;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("queue","status","priority","run_after");--> statement-breakpoint
CREATE INDEX "jobs_lease_idx" ON "jobs" USING btree ("status","locked_until");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_key_idx" ON "jobs" USING btree ("queue","key") WHERE "jobs"."status" in ('queued', 'running') and "jobs"."key" is not null;--> statement-breakpoint
CREATE INDEX "captures_job_id_idx" ON "captures" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "coverage_checks_job_id_idx" ON "coverage_checks" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "drift_checks_job_id_idx" ON "drift_checks" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "runs_job_id_idx" ON "runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "source_verifications_job_id_idx" ON "source_verifications" USING btree ("job_id");