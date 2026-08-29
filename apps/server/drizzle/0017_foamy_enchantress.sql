CREATE INDEX "band_members_user_id_idx" ON "band_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invites_band_id_idx" ON "invites" USING btree ("band_id");--> statement-breakpoint
CREATE INDEX "voice_annotation_layers_source_layer_id_idx" ON "voice_annotation_layers" USING btree ("source_layer_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");