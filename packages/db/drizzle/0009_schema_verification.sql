CREATE TABLE "source_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"definition_hash" varchar(64) NOT NULL,
	"captures" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"all_passed" boolean DEFAULT false NOT NULL,
	"ai_calls" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "drifted_fields" jsonb;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "schema_definition" jsonb;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "verification_set" jsonb;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "drifted_fields" jsonb;--> statement-breakpoint
ALTER TABLE "source_verifications" ADD CONSTRAINT "source_verifications_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_verifications_source_id_idx" ON "source_verifications" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "source_verifications_source_completed_idx" ON "source_verifications" USING btree ("source_id","completed_at");