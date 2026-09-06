CREATE TABLE "permission_guard_warnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"band_id" uuid NOT NULL,
	"map_name" text NOT NULL,
	"key" text NOT NULL,
	"acting_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid
);
--> statement-breakpoint
ALTER TABLE "permission_guard_warnings" ADD CONSTRAINT "permission_guard_warnings_band_id_bands_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."bands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_guard_warnings" ADD CONSTRAINT "permission_guard_warnings_acting_user_id_users_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_guard_warnings" ADD CONSTRAINT "permission_guard_warnings_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "permission_guard_warnings_band_id_idx" ON "permission_guard_warnings" USING btree ("band_id");