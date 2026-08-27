CREATE TABLE "ics_feed_tokens" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ics_feed_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "ics_feed_tokens" ADD CONSTRAINT "ics_feed_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;