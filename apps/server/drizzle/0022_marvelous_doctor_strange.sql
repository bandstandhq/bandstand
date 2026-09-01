CREATE TABLE "pending_email_changes" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"old_email" text NOT NULL,
	"new_email" text NOT NULL,
	"confirm_token" text NOT NULL,
	"cancel_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pending_email_changes_confirm_token_unique" UNIQUE("confirm_token"),
	CONSTRAINT "pending_email_changes_cancel_token_unique" UNIQUE("cancel_token")
);
--> statement-breakpoint
ALTER TABLE "pending_email_changes" ADD CONSTRAINT "pending_email_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;