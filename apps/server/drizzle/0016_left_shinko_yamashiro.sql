CREATE TABLE "push_reminder_log" (
	"user_id" uuid NOT NULL,
	"reminder_key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_reminder_log_user_id_reminder_key_pk" PRIMARY KEY("user_id","reminder_key")
);
--> statement-breakpoint
ALTER TABLE "push_reminder_log" ADD CONSTRAINT "push_reminder_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;