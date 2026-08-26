ALTER TABLE "sources" ADD COLUMN "confirmed_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "projects" SET "name" = 'Scratch', "slug" = 'scratch' WHERE "slug" = 'sandbox';