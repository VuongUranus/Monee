CREATE INDEX "fund_members_user_fund_idx" ON "fund_members" USING btree ("user_id","fund_id");--> statement-breakpoint
CREATE INDEX "transactions_user_type_date_idx" ON "transactions" USING btree ("user_id","type","date");--> statement-breakpoint
CREATE INDEX "transactions_user_category_date_idx" ON "transactions" USING btree ("user_id","category_id","date");--> statement-breakpoint
CREATE INDEX "transactions_user_account_date_idx" ON "transactions" USING btree ("user_id","account_id","date");