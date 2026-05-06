CREATE TABLE "quick_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"extracted_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" integer,
	"sources" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "quick_extractions_domain_idx" ON "quick_extractions" USING btree ("domain");
--> statement-breakpoint
CREATE INDEX "quick_extractions_created_at_idx" ON "quick_extractions" USING btree ("created_at");
