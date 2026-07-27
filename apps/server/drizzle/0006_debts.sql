CREATE TABLE "debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"counterparty" text DEFAULT '' NOT NULL,
	"principal" bigint DEFAULT 0 NOT NULL,
	"annual_interest_rate" numeric(30, 10) DEFAULT 0 NOT NULL,
	"term_months" integer DEFAULT 0 NOT NULL,
	"payment_amount" bigint DEFAULT 0 NOT NULL,
	"first_payment_date" date,
	"payment_category_id" uuid,
	"payment_account_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debts_kind" CHECK ("debts"."kind" in ('borrowed', 'lent', 'credit_card', 'installment')),
	CONSTRAINT "debts_status" CHECK ("debts"."status" in ('active', 'settled')),
	CONSTRAINT "debts_values" CHECK ("debts"."principal" > 0 and "debts"."annual_interest_rate" >= 0 and "debts"."term_months" >= 0 and "debts"."payment_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "debt_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"debt_id" uuid NOT NULL,
	"installment" integer NOT NULL,
	"paid_at" date NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"principal_amount" bigint DEFAULT 0 NOT NULL,
	"interest_amount" bigint DEFAULT 0 NOT NULL,
	"transaction_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debt_payments_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "debt_payments_values" CHECK ("debt_payments"."installment" > 0 and "debt_payments"."amount" > 0 and "debt_payments"."principal_amount" >= 0 and "debt_payments"."interest_amount" >= 0 and "debt_payments"."amount" = "debt_payments"."principal_amount" + "debt_payments"."interest_amount")
);
--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_payment_category_id_finance_categories_id_fk" FOREIGN KEY ("payment_category_id") REFERENCES "public"."finance_categories"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_payment_account_id_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "debts_user_external_unique" ON "debts" USING btree ("user_id","external_id");
--> statement-breakpoint
CREATE INDEX "debts_user_status_idx" ON "debts" USING btree ("user_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "debt_payments_debt_installment_unique" ON "debt_payments" USING btree ("debt_id","installment");
--> statement-breakpoint
CREATE UNIQUE INDEX "debt_payments_debt_external_unique" ON "debt_payments" USING btree ("debt_id","external_id");
--> statement-breakpoint
CREATE INDEX "debt_payments_debt_paid_at_idx" ON "debt_payments" USING btree ("debt_id","paid_at");
--> statement-breakpoint
INSERT INTO "debts" ("external_id", "user_id", "kind", "name", "principal", "payment_amount", "note")
SELECT 'legacy-debt', "user_id", 'borrowed', 'Dư nợ cũ', "debt_balance", "debt_monthly_payment", 'Cần bổ sung kỳ hạn và ngày thanh toán.'
FROM "user_settings"
WHERE "debt_balance" > 0
ON CONFLICT ("user_id", "external_id") DO NOTHING;
--> statement-breakpoint
UPDATE "user_settings" SET "debt_balance" = 0, "debt_monthly_payment" = 0 WHERE "debt_balance" > 0;
