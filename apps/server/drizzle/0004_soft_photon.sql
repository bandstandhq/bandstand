ALTER TABLE "jwks" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jwks" ADD COLUMN "alg" text;--> statement-breakpoint
ALTER TABLE "jwks" ADD COLUMN "crv" text;