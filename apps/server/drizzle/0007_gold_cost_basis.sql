ALTER TABLE "gold_lots" DROP CONSTRAINT "gold_lots_values_nonnegative";--> statement-breakpoint
ALTER TABLE "gold_lots" ADD COLUMN "cost_basis_type" text;--> statement-breakpoint
ALTER TABLE "gold_lots" ADD COLUMN "cost_basis_value_vnd" numeric(30, 10);--> statement-breakpoint
ALTER TABLE "gold_lots" ADD COLUMN "cost_basis_quote_date" date;--> statement-breakpoint
ALTER TABLE "gold_lots" ADD COLUMN "cost_basis_source" text;--> statement-breakpoint
UPDATE "gold_lots"
SET
  "cost_basis_type" = CASE
    WHEN COALESCE("fee_vnd", 0) > 0 THEN 'total_paid'
    WHEN COALESCE("purchase_price", 0) > 0 THEN 'unit_price'
    ELSE NULL
  END,
  "cost_basis_value_vnd" = CASE
    WHEN COALESCE("fee_vnd", 0) > 0
      THEN "chi" * COALESCE("purchase_price", 0) + "fee_vnd"
    WHEN COALESCE("purchase_price", 0) > 0 THEN "purchase_price"
    ELSE NULL
  END;--> statement-breakpoint
ALTER TABLE "gold_lots" ADD CONSTRAINT "gold_lots_cost_basis_valid" CHECK (
    (
      "gold_lots"."cost_basis_type" is null
      and "gold_lots"."cost_basis_value_vnd" is null
      and "gold_lots"."cost_basis_quote_date" is null
      and "gold_lots"."cost_basis_source" is null
    ) or (
      "gold_lots"."cost_basis_type" = 'unit_price'
      and "gold_lots"."cost_basis_value_vnd" is not null
      and "gold_lots"."cost_basis_quote_date" is null
      and "gold_lots"."cost_basis_source" is null
    ) or (
      "gold_lots"."cost_basis_type" = 'total_paid'
      and "gold_lots"."cost_basis_value_vnd" is not null
      and "gold_lots"."cost_basis_quote_date" is null
      and "gold_lots"."cost_basis_source" is null
    ) or (
      "gold_lots"."cost_basis_type" = 'historical'
      and "gold_lots"."cost_basis_value_vnd" is not null
      and "gold_lots"."cost_basis_quote_date" is not null
      and "gold_lots"."cost_basis_source" is not null
    )
  );--> statement-breakpoint
ALTER TABLE "gold_lots" ADD CONSTRAINT "gold_lots_values_nonnegative" CHECK (
    "gold_lots"."position" >= 0 and "gold_lots"."chi" >= 0
    and ("gold_lots"."manual_price" is null or "gold_lots"."manual_price" >= 0)
    and ("gold_lots"."purchase_price" is null or "gold_lots"."purchase_price" >= 0)
    and ("gold_lots"."fee_vnd" is null or "gold_lots"."fee_vnd" >= 0)
    and ("gold_lots"."cost_basis_value_vnd" is null or "gold_lots"."cost_basis_value_vnd" >= 0)
  );
