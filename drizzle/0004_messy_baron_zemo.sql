ALTER TABLE "expenses" ADD COLUMN "receipt2_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "home_office_ignored" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "default_category_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "restored_at" timestamp;