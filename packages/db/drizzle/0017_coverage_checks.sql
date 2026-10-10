CREATE TABLE "coverage_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"verification_id" uuid,
	"status" varchar(12) DEFAULT 'running' NOT NULL,
	"results" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "coverage_checks" ADD CONSTRAINT "coverage_checks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_checks" ADD CONSTRAINT "coverage_checks_verification_id_source_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."source_verifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coverage_checks_source_id_idx" ON "coverage_checks" USING btree ("source_id");