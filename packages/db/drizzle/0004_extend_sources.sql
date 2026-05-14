ALTER TABLE "sources" ADD COLUMN "input_strategy" varchar(20);--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "url_template" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "listing_mode" varchar(20);--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "budget" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "is_sandbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "input_set_id" uuid;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_input_set_id_input_sets_id_fk" FOREIGN KEY ("input_set_id") REFERENCES "public"."input_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sources_input_set_id_idx" ON "sources" USING btree ("input_set_id");--> statement-breakpoint
CREATE INDEX "sources_is_sandbox_idx" ON "sources" USING btree ("is_sandbox");
