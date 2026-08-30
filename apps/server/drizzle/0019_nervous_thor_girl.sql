ALTER TABLE "user_prefs" ADD COLUMN "keep_screen_awake" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_prefs" ADD COLUMN "locale" text;