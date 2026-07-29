WITH gold_costs AS (
  SELECT
    fm.id,
    ROUND(SUM(
      CASE
        WHEN gl.cost_basis_type = 'total_paid' THEN gl.cost_basis_value_vnd
        WHEN gl.cost_basis_type IN ('unit_price', 'historical') THEN gl.chi * gl.cost_basis_value_vnd
        ELSE 0
      END
    ))::bigint AS amount
  FROM fund_months fm
  JOIN funds f ON f.id = fm.fund_id AND f.category = 'gold'
  JOIN fund_month_details fmd ON fmd.fund_month_id = fm.id AND fmd.type = 'gold'
  JOIN gold_lots gl ON gl.detail_id = fmd.id
  GROUP BY fm.id
  HAVING BOOL_OR(gl.chi > 0)
    AND BOOL_AND(
      gl.chi <= 0
      OR (
        gl.cost_basis_value_vnd > 0
        AND gl.cost_basis_type IN ('unit_price', 'total_paid', 'historical')
      )
    )
),
holding_costs AS (
  SELECT
    fm.id,
    ROUND(SUM(
      CASE
        WHEN f.category = 'stock'
          THEN hl.quantity * COALESCE(hl.purchase_price, 0) + COALESCE(hl.fee_vnd, 0)
        ELSE hl.quantity * COALESCE(hl.purchase_price, 0) * COALESCE(hl.purchase_fx_vnd, 0) + COALESCE(hl.fee_vnd, 0)
      END
    ))::bigint AS amount
  FROM fund_months fm
  JOIN funds f ON f.id = fm.fund_id AND f.category IN ('stock', 'crypto')
  JOIN fund_month_details fmd ON fmd.fund_month_id = fm.id AND fmd.type = 'hold'
  JOIN holding_lots hl ON hl.detail_id = fmd.id
  GROUP BY fm.id, f.category
  HAVING BOOL_OR(hl.quantity > 0)
    AND BOOL_AND(
      hl.quantity <= 0
      OR (
        hl.purchase_price > 0
        AND (f.category = 'stock' OR hl.purchase_fx_vnd > 0)
      )
    )
),
cost_values AS (
  SELECT id, amount FROM gold_costs
  UNION ALL
  SELECT id, amount FROM holding_costs
)
UPDATE fund_months fm
SET amount = cost_values.amount
FROM cost_values
WHERE fm.id = cost_values.id;
