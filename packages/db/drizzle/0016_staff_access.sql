CREATE TABLE "staff_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"actor_email" varchar(255) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" varchar(100) NOT NULL,
	"summary" text NOT NULL,
	"project_id" uuid,
	"source_id" uuid,
	"run_id" uuid
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "staff_org_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "staff_entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_actions" ADD CONSTRAINT "staff_actions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_actions" ADD CONSTRAINT "staff_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_actions" ADD CONSTRAINT "staff_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_actions" ADD CONSTRAINT "staff_actions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_actions" ADD CONSTRAINT "staff_actions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_actions_org_at_idx" ON "staff_actions" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "staff_actions_source_at_idx" ON "staff_actions" USING btree ("source_id","at");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_staff_org_id_orgs_id_fk" FOREIGN KEY ("staff_org_id") REFERENCES "public"."orgs"("id") ON DELETE set null ON UPDATE no action;