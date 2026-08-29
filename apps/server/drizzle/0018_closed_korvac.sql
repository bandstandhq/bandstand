CREATE TABLE "pending_uploads" (
	"band_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"presigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"baseline_last_modified" timestamp with time zone,
	CONSTRAINT "pending_uploads_band_id_sha256_pk" PRIMARY KEY("band_id","sha256")
);
--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_band_id_bands_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."bands"("id") ON DELETE cascade ON UPDATE no action;