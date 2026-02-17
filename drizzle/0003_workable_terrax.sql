CREATE TABLE "expense_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"blob_url" text NOT NULL,
	"file_name" varchar(500) NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"tenant_id" uuid NOT NULL,
	"role" varchar(50) DEFAULT 'owner' NOT NULL,
	"invited_by" uuid NOT NULL,
	"token" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action_type" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "expense_type" varchar(50) DEFAULT 'operating' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "home_office_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "is_home_office" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "home_total_sqft" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "home_office_sqft" integer;--> statement-breakpoint
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_usage" ADD CONSTRAINT "rate_limit_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limit_tenant_action_time_idx" ON "rate_limit_usage" USING btree ("tenant_id","action_type","created_at");