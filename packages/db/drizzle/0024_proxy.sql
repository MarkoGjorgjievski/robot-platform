ALTER TABLE "sources" ALTER COLUMN "country" SET DATA TYPE varchar(2);--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "country" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "proxy_url" text;