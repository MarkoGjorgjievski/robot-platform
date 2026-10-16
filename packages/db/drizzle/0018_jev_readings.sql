CREATE TABLE "jev_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"capture_id" uuid NOT NULL,
	"url" text NOT NULL,
	"status" varchar(12) DEFAULT 'running' NOT NULL,
	"model" varchar(40),
	"answers" jsonb,
	"input_tokens" integer,
	"cost_usd" numeric(10, 6),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "source_verifications" ADD COLUMN "verify_agreement" jsonb;--> statement-breakpoint
ALTER TABLE "jev_readings" ADD CONSTRAINT "jev_readings_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jev_readings" ADD CONSTRAINT "jev_readings_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jev_readings_capture_id_idx" ON "jev_readings" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "jev_readings_source_id_idx" ON "jev_readings" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "jev_readings_created_at_idx" ON "jev_readings" USING btree ("created_at");