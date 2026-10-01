ALTER TABLE "datasets" ADD COLUMN "variant_mode" varchar(20) DEFAULT 'ignore' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "variant_setup" jsonb;