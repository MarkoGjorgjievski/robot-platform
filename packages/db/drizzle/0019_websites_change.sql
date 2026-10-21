CREATE TABLE "field_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"field_key" varchar(255) NOT NULL,
	"result" jsonb NOT NULL,
	"verification_id" uuid,
	"verified_at" timestamp with time zone NOT NULL,
	"failed_verification_id" uuid,
	"field_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "value_refreshes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"field_key" varchar(255) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"drift_check_id" uuid,
	"verification_id" uuid,
	"pages" jsonb NOT NULL,
	"from_hash" varchar(64) NOT NULL,
	"to_hash" varchar(64) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drift_checks" ADD COLUMN "trigger" varchar(12) DEFAULT 'run' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "next_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "field_holds" ADD CONSTRAINT "field_holds_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_holds" ADD CONSTRAINT "field_holds_verification_id_source_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."source_verifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_holds" ADD CONSTRAINT "field_holds_failed_verification_id_source_verifications_id_fk" FOREIGN KEY ("failed_verification_id") REFERENCES "public"."source_verifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_refreshes" ADD CONSTRAINT "value_refreshes_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_refreshes" ADD CONSTRAINT "value_refreshes_drift_check_id_drift_checks_id_fk" FOREIGN KEY ("drift_check_id") REFERENCES "public"."drift_checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_refreshes" ADD CONSTRAINT "value_refreshes_verification_id_source_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."source_verifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_holds_source_field_idx" ON "field_holds" USING btree ("source_id","field_key");--> statement-breakpoint
CREATE INDEX "value_refreshes_source_at_idx" ON "value_refreshes" USING btree ("source_id","at");