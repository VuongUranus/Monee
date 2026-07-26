CREATE TABLE "account_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type_id" uuid,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "data_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checksum_sha256" text NOT NULL,
	"source_name" text NOT NULL,
	"user_count" integer NOT NULL,
	"fund_count" integer NOT NULL,
	"transaction_count" integer NOT NULL,
	"lot_count" integer NOT NULL,
	"member_count" integer NOT NULL,
	"contribution_count" integer NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_imports_checksum_sha256_unique" UNIQUE("checksum_sha256")
);
--> statement-breakpoint
CREATE TABLE "finance_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"budget" bigint DEFAULT 0 NOT NULL,
	"position" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "finance_categories_type" CHECK ("finance_categories"."type" in ('income', 'expense'))
);
--> statement-breakpoint
CREATE TABLE "fund_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"fund_id" uuid NOT NULL,
	"member_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" smallint NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_contributions_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "fund_contributions_month_range" CHECK ("fund_contributions"."month" between 1 and 12),
	CONSTRAINT "fund_contributions_amount_positive" CHECK ("fund_contributions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "fund_members" (
	"fund_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_members_fund_id_user_id_pk" PRIMARY KEY("fund_id","user_id"),
	CONSTRAINT "fund_members_role" CHECK ("fund_members"."role" in ('viewer', 'editor'))
);
--> statement-breakpoint
CREATE TABLE "fund_month_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_month_id" uuid NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "fund_month_details_fund_month_id_unique" UNIQUE("fund_month_id"),
	CONSTRAINT "fund_month_details_type" CHECK ("fund_month_details"."type" in ('hold', 'gold'))
);
--> statement-breakpoint
CREATE TABLE "fund_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" smallint NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "fund_months_month_range" CHECK ("fund_months"."month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "fund_positions" (
	"fund_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "fund_positions_fund_id_user_id_pk" PRIMARY KEY("fund_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "fund_year_goals" (
	"fund_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "fund_year_goals_fund_id_year_pk" PRIMARY KEY("fund_id","year")
);
--> statement-breakpoint
CREATE TABLE "funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"category" text NOT NULL,
	"fund_plan" bigint DEFAULT 0 NOT NULL,
	"opening_balance" bigint DEFAULT 0 NOT NULL,
	"all_goal" bigint DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funds_category" CHECK ("funds"."category" in ('saving', 'stock', 'gold', 'crypto')),
	CONSTRAINT "funds_revision_positive" CHECK ("funds"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "gold_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"detail_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"chi" numeric(30, 10) NOT NULL,
	"manual_price" numeric(30, 10),
	"purchase_price" numeric(30, 10),
	"fee_vnd" numeric(30, 10),
	"purchased_at" date,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "holding_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"detail_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"ticker" text NOT NULL,
	"quantity" numeric(30, 10) NOT NULL,
	"manual_price" numeric(30, 10),
	"purchase_price" numeric(30, 10),
	"purchase_fx_vnd" numeric(30, 10),
	"fee_vnd" numeric(30, 10),
	"purchased_at" date,
	"note" text,
	"exchange" text,
	"provider_id" text
);
--> statement-breakpoint
CREATE TABLE "ledger_months" (
	"user_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" smallint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "ledger_months_user_id_year_month_pk" PRIMARY KEY("user_id","year","month"),
	CONSTRAINT "ledger_months_month_range" CHECK ("ledger_months"."month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "ledger_years" (
	"user_id" text NOT NULL,
	"year" integer NOT NULL,
	CONSTRAINT "ledger_years_user_id_year_pk" PRIMARY KEY("user_id","year"),
	CONSTRAINT "ledger_years_year_positive" CHECK ("ledger_years"."year" > 0)
);
--> statement-breakpoint
CREATE TABLE "legacy_prices" (
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"price" numeric(30, 10) NOT NULL,
	CONSTRAINT "legacy_prices_user_id_symbol_pk" PRIMARY KEY("user_id","symbol")
);
--> statement-breakpoint
CREATE TABLE "market_crypto_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"lookup_key" text NOT NULL,
	"position" integer NOT NULL,
	"provider_id" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"rank" integer
);
--> statement-breakpoint
CREATE TABLE "market_crypto_quotes" (
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"price_usd" numeric(30, 10) NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_crypto_quotes_user_id_provider_id_pk" PRIMARY KEY("user_id","provider_id")
);
--> statement-breakpoint
CREATE TABLE "market_crypto_symbols" (
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"provider_id" text NOT NULL,
	CONSTRAINT "market_crypto_symbols_user_id_symbol_pk" PRIMARY KEY("user_id","symbol")
);
--> statement-breakpoint
CREATE TABLE "market_fx_quotes" (
	"user_id" text PRIMARY KEY NOT NULL,
	"usd_vnd" numeric(30, 10) NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"fetched_at" timestamp with time zone,
	"legacy" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_gold_quotes" (
	"user_id" text PRIMARY KEY NOT NULL,
	"xau_usd_per_troy_ounce" numeric(30, 10) NOT NULL,
	"vnd_per_chi" numeric(30, 10) NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_quote_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	"key" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_states" (
	"user_id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "market_stock_quotes" (
	"user_id" text NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"price_vnd" numeric(30, 10) NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_stock_quotes_user_id_exchange_symbol_pk" PRIMARY KEY("user_id","exchange","symbol")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"user_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"account_id" uuid,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_type" CHECK ("transactions"."type" in ('income', 'expense')),
	CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"show_goals" boolean DEFAULT false NOT NULL,
	"monthly_income" bigint DEFAULT 0 NOT NULL,
	"emergency_fund_goal" bigint DEFAULT 0 NOT NULL,
	"debt_balance" bigint DEFAULT 0 NOT NULL,
	"debt_monthly_payment" bigint DEFAULT 0 NOT NULL,
	"onboarding_status" text DEFAULT 'pending' NOT NULL,
	"onboarding_version" integer DEFAULT 1 NOT NULL,
	"onboarding_skipped_at" timestamp with time zone,
	"income_migration_version" integer DEFAULT 1 NOT NULL,
	"future_income_reset_version" integer DEFAULT 1 NOT NULL,
	"legacy_usd_rate" numeric(30, 10),
	CONSTRAINT "user_settings_onboarding_status" CHECK ("user_settings"."onboarding_status" in ('pending', 'completed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"picture" text DEFAULT '' NOT NULL,
	"workspace_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_workspace_revision_positive" CHECK ("users"."workspace_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "account_types" ADD CONSTRAINT "account_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_type_id_account_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."account_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_contributions" ADD CONSTRAINT "fund_contributions_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_contributions" ADD CONSTRAINT "fund_contributions_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_members" ADD CONSTRAINT "fund_members_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_members" ADD CONSTRAINT "fund_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_month_details" ADD CONSTRAINT "fund_month_details_fund_month_id_fund_months_id_fk" FOREIGN KEY ("fund_month_id") REFERENCES "public"."fund_months"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_months" ADD CONSTRAINT "fund_months_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_positions" ADD CONSTRAINT "fund_positions_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_positions" ADD CONSTRAINT "fund_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_year_goals" ADD CONSTRAINT "fund_year_goals_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_lots" ADD CONSTRAINT "gold_lots_detail_id_fund_month_details_id_fk" FOREIGN KEY ("detail_id") REFERENCES "public"."fund_month_details"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_lots" ADD CONSTRAINT "holding_lots_detail_id_fund_month_details_id_fk" FOREIGN KEY ("detail_id") REFERENCES "public"."fund_month_details"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_months" ADD CONSTRAINT "ledger_months_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_years" ADD CONSTRAINT "ledger_years_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_prices" ADD CONSTRAINT "legacy_prices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_crypto_matches" ADD CONSTRAINT "market_crypto_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_crypto_quotes" ADD CONSTRAINT "market_crypto_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_crypto_symbols" ADD CONSTRAINT "market_crypto_symbols_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_fx_quotes" ADD CONSTRAINT "market_fx_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_gold_quotes" ADD CONSTRAINT "market_gold_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_quote_errors" ADD CONSTRAINT "market_quote_errors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_states" ADD CONSTRAINT "market_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_stock_quotes" ADD CONSTRAINT "market_stock_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_finance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_types_user_external_unique" ON "account_types" USING btree ("user_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_external_unique" ON "accounts" USING btree ("user_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_categories_user_type_external_unique" ON "finance_categories" USING btree ("user_id","type","external_id");--> statement-breakpoint
CREATE INDEX "fund_contributions_fund_period_idx" ON "fund_contributions" USING btree ("fund_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "fund_months_fund_period_unique" ON "fund_months" USING btree ("fund_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "fund_positions_user_position_unique" ON "fund_positions" USING btree ("user_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "funds_owner_external_unique" ON "funds" USING btree ("owner_id","external_id");--> statement-breakpoint
CREATE INDEX "funds_external_idx" ON "funds" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gold_lots_detail_position_unique" ON "gold_lots" USING btree ("detail_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "holding_lots_detail_position_unique" ON "holding_lots" USING btree ("detail_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "market_crypto_matches_key_position_unique" ON "market_crypto_matches" USING btree ("user_id","lookup_key","position");--> statement-breakpoint
CREATE UNIQUE INDEX "market_quote_errors_user_position_unique" ON "market_quote_errors" USING btree ("user_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_user_external_unique" ON "transactions" USING btree ("user_id","external_id");--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree (lower("email"));