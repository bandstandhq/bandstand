ALTER TABLE "attachments" ALTER COLUMN "uploaded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "sha256" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_band_id_sha256_idx" ON "attachments" USING btree ("band_id","sha256");--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "song_id";--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "key";