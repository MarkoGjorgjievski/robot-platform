CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" varchar(20) NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"to_address" varchar(255) NOT NULL,
	"subject" text NOT NULL,
	"text" text NOT NULL,
	"html" text NOT NULL,
	"status" varchar(10) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "attention_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_attention" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_failed_runs" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_dedupe_key_idx" ON "email_messages" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "email_messages_org_created_idx" ON "email_messages" USING btree ("org_id","created_at");