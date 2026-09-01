CREATE TABLE "member_nicknames" (
	"band_id" uuid NOT NULL,
	"viewer_user_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"nickname" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_nicknames_band_id_viewer_user_id_target_user_id_pk" PRIMARY KEY("band_id","viewer_user_id","target_user_id")
);
--> statement-breakpoint
ALTER TABLE "member_nicknames" ADD CONSTRAINT "member_nicknames_band_id_bands_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."bands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_nicknames" ADD CONSTRAINT "member_nicknames_viewer_user_id_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_nicknames" ADD CONSTRAINT "member_nicknames_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;