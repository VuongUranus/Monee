ALTER TABLE "ledger_months" ADD CONSTRAINT "ledger_months_year_fk" FOREIGN KEY ("user_id","year") REFERENCES "public"."ledger_years"("user_id","year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_types" ADD CONSTRAINT "account_types_position_nonnegative" CHECK ("account_types"."position" >= 0);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_position_nonnegative" CHECK ("accounts"."position" >= 0);--> statement-breakpoint
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_values_nonnegative" CHECK ("finance_categories"."budget" >= 0 and "finance_categories"."position" >= 0);--> statement-breakpoint
ALTER TABLE "fund_contributions" ADD CONSTRAINT "fund_contributions_year_positive" CHECK ("fund_contributions"."year" > 0);--> statement-breakpoint
ALTER TABLE "fund_months" ADD CONSTRAINT "fund_months_year_positive" CHECK ("fund_months"."year" > 0);--> statement-breakpoint
ALTER TABLE "fund_months" ADD CONSTRAINT "fund_months_amount_nonnegative" CHECK ("fund_months"."amount" >= 0);--> statement-breakpoint
ALTER TABLE "fund_positions" ADD CONSTRAINT "fund_positions_nonnegative" CHECK ("fund_positions"."position" >= 0);--> statement-breakpoint
ALTER TABLE "fund_year_goals" ADD CONSTRAINT "fund_year_goals_year_positive" CHECK ("fund_year_goals"."year" > 0);--> statement-breakpoint
ALTER TABLE "fund_year_goals" ADD CONSTRAINT "fund_year_goals_amount_nonnegative" CHECK ("fund_year_goals"."amount" >= 0);--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_money_nonnegative" CHECK (
    "funds"."fund_plan" >= 0 and "funds"."opening_balance" >= 0 and "funds"."all_goal" >= 0
  );--> statement-breakpoint
ALTER TABLE "gold_lots" ADD CONSTRAINT "gold_lots_values_nonnegative" CHECK (
    "gold_lots"."position" >= 0 and "gold_lots"."chi" >= 0
    and ("gold_lots"."manual_price" is null or "gold_lots"."manual_price" >= 0)
    and ("gold_lots"."purchase_price" is null or "gold_lots"."purchase_price" >= 0)
    and ("gold_lots"."fee_vnd" is null or "gold_lots"."fee_vnd" >= 0)
  );--> statement-breakpoint
ALTER TABLE "holding_lots" ADD CONSTRAINT "holding_lots_values_nonnegative" CHECK (
    "holding_lots"."position" >= 0 and "holding_lots"."quantity" >= 0
    and ("holding_lots"."manual_price" is null or "holding_lots"."manual_price" >= 0)
    and ("holding_lots"."purchase_price" is null or "holding_lots"."purchase_price" >= 0)
    and ("holding_lots"."purchase_fx_vnd" is null or "holding_lots"."purchase_fx_vnd" >= 0)
    and ("holding_lots"."fee_vnd" is null or "holding_lots"."fee_vnd" >= 0)
  );--> statement-breakpoint
ALTER TABLE "ledger_months" ADD CONSTRAINT "ledger_months_income_nonnegative" CHECK ("ledger_months"."income" >= 0);--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_money_nonnegative" CHECK (
    "user_settings"."monthly_income" >= 0 and "user_settings"."emergency_fund_goal" >= 0
    and "user_settings"."debt_balance" >= 0 and "user_settings"."debt_monthly_payment" >= 0
  );