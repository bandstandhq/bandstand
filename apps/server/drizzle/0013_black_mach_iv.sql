CREATE TABLE "voice_annotation_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"band_id" uuid NOT NULL,
	"voice_id" text NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"objects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"source_layer_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_annotation_layers" ADD CONSTRAINT "voice_annotation_layers_band_id_bands_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."bands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_annotation_layers" ADD CONSTRAINT "voice_annotation_layers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_annotation_layers_voice_user_idx" ON "voice_annotation_layers" USING btree ("voice_id","user_id");