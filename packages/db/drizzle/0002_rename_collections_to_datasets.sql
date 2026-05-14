ALTER TABLE "collections" RENAME TO "datasets";--> statement-breakpoint
ALTER TABLE "sources" RENAME COLUMN "collection_id" TO "dataset_id";--> statement-breakpoint
ALTER INDEX "collections_project_id_idx" RENAME TO "datasets_project_id_idx";--> statement-breakpoint
ALTER INDEX "collections_project_slug_idx" RENAME TO "datasets_project_slug_idx";--> statement-breakpoint
ALTER INDEX "sources_collection_id_idx" RENAME TO "sources_dataset_id_idx";--> statement-breakpoint
ALTER INDEX "sources_collection_slug_idx" RENAME TO "sources_dataset_slug_idx";
