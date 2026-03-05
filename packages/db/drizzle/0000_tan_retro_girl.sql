CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extractor_id" uuid NOT NULL,
	"environment" varchar(50) DEFAULT 'default' NOT NULL,
	"username" text,
	"password" text,
	"extra_fields" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"prefix" varchar(10),
	"has_goto_override" boolean DEFAULT false NOT NULL,
	"has_set_zip_code_override" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domains_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "extractor_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extractor_id" uuid NOT NULL,
	"label" varchar(255) NOT NULL,
	"input_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"country" varchar(10) NOT NULL,
	"robot_template" varchar(255) DEFAULT 'robots/san-antonio' NOT NULL,
	"variant" varchar(50) NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "robot_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"country" varchar(10),
	"robot_template" varchar(255) DEFAULT 'robots/san-antonio' NOT NULL,
	"parameter_overrides" jsonb DEFAULT '{}'::jsonb,
	"has_goto2" boolean DEFAULT false NOT NULL,
	"has_before_extract" boolean DEFAULT false NOT NULL,
	"has_extract" boolean DEFAULT false NOT NULL,
	"has_transform" boolean DEFAULT false NOT NULL,
	"schemas" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extractor_id" uuid NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"input_label" varchar(255),
	"started_at" timestamp,
	"completed_at" timestamp,
	"result_count" integer,
	"results" jsonb,
	"logs" text,
	"video_url" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractor_inputs" ADD CONSTRAINT "extractor_inputs_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractors" ADD CONSTRAINT "extractors_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractors" ADD CONSTRAINT "extractors_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robot_overrides" ADD CONSTRAINT "robot_overrides_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credentials_extractor_id_idx" ON "credentials" USING btree ("extractor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_extractor_env_idx" ON "credentials" USING btree ("extractor_id","environment");--> statement-breakpoint
CREATE INDEX "extractor_inputs_extractor_id_idx" ON "extractor_inputs" USING btree ("extractor_id");--> statement-breakpoint
CREATE INDEX "extractors_org_id_idx" ON "extractors" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "extractors_domain_id_idx" ON "extractors" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extractors_org_domain_country_variant_idx" ON "extractors" USING btree ("org_id","domain_id","country","variant");--> statement-breakpoint
CREATE INDEX "robot_overrides_domain_id_idx" ON "robot_overrides" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "runs_extractor_id_idx" ON "runs" USING btree ("extractor_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");