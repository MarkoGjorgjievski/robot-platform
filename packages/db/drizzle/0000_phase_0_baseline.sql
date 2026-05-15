CREATE TABLE "captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"run_id" uuid,
	"url" text NOT NULL,
	"html" text,
	"markdown" text,
	"screenshot_path" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"schema" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_intelligence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(255) NOT NULL,
	"page_type" varchar(50) NOT NULL,
	"api_endpoints" jsonb DEFAULT '[]'::jsonb,
	"field_paths" jsonb DEFAULT '{}'::jsonb,
	"popup_selectors" jsonb DEFAULT '[]'::jsonb,
	"pagination_config" jsonb,
	"has_json_ld" boolean DEFAULT false NOT NULL,
	"has_next_data" boolean DEFAULT false NOT NULL,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"successful_runs" integer DEFAULT 0 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"last_verified_at" timestamp DEFAULT now() NOT NULL,
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
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"capture_id" uuid NOT NULL,
	"run_id" uuid,
	"data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0,
	"confidence" integer,
	"validation_result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "input_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_inline" boolean DEFAULT false NOT NULL,
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
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"default_schedule" varchar(100),
	"output_destination" text,
	"proxy_pool" varchar(100),
	"default_rate_limit" integer,
	"notification_channel" text,
	"owner_email" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
	"js_overrides" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extractor_id" uuid,
	"source_id" uuid,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"input_label" varchar(255),
	"started_at" timestamp,
	"completed_at" timestamp,
	"result_count" integer,
	"results" jsonb,
	"html" text,
	"logs" text,
	"replay_data" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"label" varchar(255) NOT NULL,
	"input_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid,
	"domain_id" uuid,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"country" varchar(10) NOT NULL,
	"locale" varchar(10),
	"currency" varchar(10),
	"data_center" varchar(10),
	"proxy_type" varchar(50),
	"login_pool" varchar(100),
	"maximum_inputs" integer,
	"runner_framework" varchar(50),
	"schema_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"robot_template" varchar(255) DEFAULT 'robots/san-antonio' NOT NULL,
	"variant" varchar(50) DEFAULT 'default' NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"source_type" varchar(20) DEFAULT 'legacy',
	"url_pattern" text,
	"selectors_json" jsonb,
	"input_strategy" varchar(20),
	"url_template" text,
	"listing_mode" varchar(20),
	"budget" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_sandbox" boolean DEFAULT false NOT NULL,
	"input_set_id" uuid,
	"ai_status" varchar(20) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sources_non_sandbox_requires_dataset" CHECK ("sources"."is_sandbox" = true OR "sources"."dataset_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractor_inputs" ADD CONSTRAINT "extractor_inputs_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractors" ADD CONSTRAINT "extractors_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractors" ADD CONSTRAINT "extractors_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_sets" ADD CONSTRAINT "input_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robot_overrides" ADD CONSTRAINT "robot_overrides_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_inputs" ADD CONSTRAINT "source_inputs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_input_set_id_input_sets_id_fk" FOREIGN KEY ("input_set_id") REFERENCES "public"."input_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captures_source_id_idx" ON "captures" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "captures_run_id_idx" ON "captures" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "credentials_extractor_id_idx" ON "credentials" USING btree ("extractor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_extractor_env_idx" ON "credentials" USING btree ("extractor_id","environment");--> statement-breakpoint
CREATE INDEX "datasets_project_id_idx" ON "datasets" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "datasets_project_slug_idx" ON "datasets" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "domain_intelligence_domain_idx" ON "domain_intelligence" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_intelligence_domain_page_type_idx" ON "domain_intelligence" USING btree ("domain","page_type");--> statement-breakpoint
CREATE INDEX "extractions_source_id_idx" ON "extractions" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "extractions_capture_id_idx" ON "extractions" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "extractions_run_id_idx" ON "extractions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "extractor_inputs_extractor_id_idx" ON "extractor_inputs" USING btree ("extractor_id");--> statement-breakpoint
CREATE INDEX "extractors_org_id_idx" ON "extractors" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "extractors_domain_id_idx" ON "extractors" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extractors_org_domain_country_variant_idx" ON "extractors" USING btree ("org_id","domain_id","country","variant");--> statement-breakpoint
CREATE INDEX "input_sets_project_id_idx" ON "input_sets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_org_id_idx" ON "projects" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_slug_idx" ON "projects" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "robot_overrides_domain_id_idx" ON "robot_overrides" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "runs_extractor_id_idx" ON "runs" USING btree ("extractor_id");--> statement-breakpoint
CREATE INDEX "runs_source_id_idx" ON "runs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "source_inputs_source_id_idx" ON "source_inputs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "sources_dataset_id_idx" ON "sources" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "sources_domain_id_idx" ON "sources" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_dataset_slug_idx" ON "sources" USING btree ("dataset_id","slug");--> statement-breakpoint
CREATE INDEX "sources_input_set_id_idx" ON "sources" USING btree ("input_set_id");--> statement-breakpoint
CREATE INDEX "sources_is_sandbox_idx" ON "sources" USING btree ("is_sandbox");