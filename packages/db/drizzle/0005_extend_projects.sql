ALTER TABLE "projects" ADD COLUMN "default_schedule" varchar(100);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "output_destination" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "proxy_pool" varchar(100);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_rate_limit" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "notification_channel" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_email" varchar(255);