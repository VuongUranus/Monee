import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);
const decimal = (name: string) => numeric(name, { precision: 30, scale: 10, mode: "number" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  picture: text("picture").notNull().default(""),
  workspaceRevision: integer("workspace_revision").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`),
  check("users_workspace_revision_positive", sql`${table.workspaceRevision} > 0`),
]);

export const userSettings = pgTable("user_settings", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  showGoals: boolean("show_goals").notNull().default(false),
  monthlyIncome: money("monthly_income"),
  emergencyFundGoal: money("emergency_fund_goal"),
  debtBalance: money("debt_balance"),
  debtMonthlyPayment: money("debt_monthly_payment"),
  onboardingStatus: text("onboarding_status").notNull().default("pending"),
  onboardingVersion: integer("onboarding_version").notNull().default(1),
  onboardingSkippedAt: timestamp("onboarding_skipped_at", { withTimezone: true }),
  incomeMigrationVersion: integer("income_migration_version").notNull().default(1),
  futureIncomeResetVersion: integer("future_income_reset_version").notNull().default(1),
  legacyUsdRate: decimal("legacy_usd_rate"),
}, (table) => [
  check("user_settings_onboarding_status", sql`${table.onboardingStatus} in ('pending', 'completed', 'skipped')`),
  check("user_settings_money_nonnegative", sql`
    ${table.monthlyIncome} >= 0 and ${table.emergencyFundGoal} >= 0
    and ${table.debtBalance} >= 0 and ${table.debtMonthlyPayment} >= 0
  `),
]);

export const ledgerYears = pgTable("ledger_years", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.year] }),
  check("ledger_years_year_positive", sql`${table.year} > 0`),
]);

export const ledgerMonths = pgTable("ledger_months", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  month: smallint("month").notNull(),
  income: money("income"),
  note: text("note").notNull().default(""),
}, (table) => [
  primaryKey({ columns: [table.userId, table.year, table.month] }),
  foreignKey({
    columns: [table.userId, table.year],
    foreignColumns: [ledgerYears.userId, ledgerYears.year],
    name: "ledger_months_year_fk",
  }).onDelete("cascade"),
  check("ledger_months_month_range", sql`${table.month} between 1 and 12`),
  check("ledger_months_income_nonnegative", sql`${table.income} >= 0`),
]);

export const funds = pgTable("funds", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  shared: boolean("shared").notNull().default(false),
  name: text("name").notNull(),
  color: text("color").notNull(),
  category: text("category").notNull(),
  fundPlan: money("fund_plan"),
  openingBalance: money("opening_balance"),
  allGoal: money("all_goal"),
  goalConfigured: boolean("goal_configured").notNull().default(false),
  revision: integer("revision").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("funds_owner_external_unique").on(table.ownerId, table.externalId),
  index("funds_external_idx").on(table.externalId),
  check("funds_category", sql`${table.category} in ('saving', 'stock', 'gold', 'crypto')`),
  check("funds_revision_positive", sql`${table.revision} > 0`),
  check("funds_money_nonnegative", sql`
    ${table.fundPlan} >= 0 and ${table.openingBalance} >= 0 and ${table.allGoal} >= 0
  `),
]);

export const fundPositions = pgTable("fund_positions", {
  fundId: uuid("fund_id").notNull().references(() => funds.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
}, (table) => [
  primaryKey({ columns: [table.fundId, table.userId] }),
  uniqueIndex("fund_positions_user_position_unique").on(table.userId, table.position),
  check("fund_positions_nonnegative", sql`${table.position} >= 0`),
]);

export const fundMembers = pgTable("fund_members", {
  fundId: uuid("fund_id").notNull().references(() => funds.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.fundId, table.userId] }),
  index("fund_members_user_fund_idx").on(table.userId, table.fundId),
  check("fund_members_role", sql`${table.role} in ('viewer', 'editor')`),
]);

export const fundMonths = pgTable("fund_months", {
  id: uuid("id").primaryKey().defaultRandom(),
  fundId: uuid("fund_id").notNull().references(() => funds.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  month: smallint("month").notNull(),
  amount: money("amount"),
}, (table) => [
  uniqueIndex("fund_months_fund_period_unique").on(table.fundId, table.year, table.month),
  check("fund_months_month_range", sql`${table.month} between 1 and 12`),
  check("fund_months_year_positive", sql`${table.year} > 0`),
  check("fund_months_amount_nonnegative", sql`${table.amount} >= 0`),
]);

export const fundYearGoals = pgTable("fund_year_goals", {
  fundId: uuid("fund_id").notNull().references(() => funds.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  amount: money("amount"),
}, (table) => [
  primaryKey({ columns: [table.fundId, table.year] }),
  check("fund_year_goals_year_positive", sql`${table.year} > 0`),
  check("fund_year_goals_amount_nonnegative", sql`${table.amount} >= 0`),
]);

export const fundMonthDetails = pgTable("fund_month_details", {
  id: uuid("id").primaryKey().defaultRandom(),
  fundMonthId: uuid("fund_month_id").notNull().unique().references(() => fundMonths.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
}, (table) => [
  check("fund_month_details_type", sql`${table.type} in ('hold', 'gold')`),
]);

export const holdingLots = pgTable("holding_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  detailId: uuid("detail_id").notNull().references(() => fundMonthDetails.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  ticker: text("ticker").notNull(),
  quantity: decimal("quantity").notNull(),
  manualPrice: decimal("manual_price"),
  purchasePrice: decimal("purchase_price"),
  purchaseFxVnd: decimal("purchase_fx_vnd"),
  feeVnd: decimal("fee_vnd"),
  purchasedAt: date("purchased_at"),
  note: text("note"),
  exchange: text("exchange"),
  providerId: text("provider_id"),
}, (table) => [
  uniqueIndex("holding_lots_detail_position_unique").on(table.detailId, table.position),
  check("holding_lots_values_nonnegative", sql`
    ${table.position} >= 0 and ${table.quantity} >= 0
    and (${table.manualPrice} is null or ${table.manualPrice} >= 0)
    and (${table.purchasePrice} is null or ${table.purchasePrice} >= 0)
    and (${table.purchaseFxVnd} is null or ${table.purchaseFxVnd} >= 0)
    and (${table.feeVnd} is null or ${table.feeVnd} >= 0)
  `),
]);

export const goldLots = pgTable("gold_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  detailId: uuid("detail_id").notNull().references(() => fundMonthDetails.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  chi: decimal("chi").notNull(),
  manualPrice: decimal("manual_price"),
  purchasePrice: decimal("purchase_price"),
  feeVnd: decimal("fee_vnd"),
  purchasedAt: date("purchased_at"),
  note: text("note"),
}, (table) => [
  uniqueIndex("gold_lots_detail_position_unique").on(table.detailId, table.position),
  check("gold_lots_values_nonnegative", sql`
    ${table.position} >= 0 and ${table.chi} >= 0
    and (${table.manualPrice} is null or ${table.manualPrice} >= 0)
    and (${table.purchasePrice} is null or ${table.purchasePrice} >= 0)
    and (${table.feeVnd} is null or ${table.feeVnd} >= 0)
  `),
]);

export const financeCategories = pgTable("finance_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  budget: money("budget"),
  position: integer("position").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("finance_categories_user_type_external_unique").on(table.userId, table.type, table.externalId),
  check("finance_categories_type", sql`${table.type} in ('income', 'expense')`),
  check("finance_categories_values_nonnegative", sql`${table.budget} >= 0 and ${table.position} >= 0`),
]);

export const accountTypes = pgTable("account_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("account_types_user_external_unique").on(table.userId, table.externalId),
  check("account_types_position_nonnegative", sql`${table.position} >= 0`),
]);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  typeId: uuid("type_id").references(() => accountTypes.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("accounts_user_external_unique").on(table.userId, table.externalId),
  check("accounts_position_nonnegative", sql`${table.position} >= 0`),
]);

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").notNull().references(() => financeCategories.id),
  accountId: uuid("account_id").references(() => accounts.id),
  date: date("date").notNull(),
  type: text("type").notNull(),
  amount: money("amount"),
  note: text("note").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("transactions_user_external_unique").on(table.userId, table.externalId),
  index("transactions_user_date_idx").on(table.userId, table.date),
  index("transactions_user_type_date_idx").on(table.userId, table.type, table.date),
  index("transactions_user_category_date_idx").on(table.userId, table.categoryId, table.date),
  index("transactions_user_account_date_idx").on(table.userId, table.accountId, table.date),
  check("transactions_type", sql`${table.type} in ('income', 'expense')`),
  check("transactions_amount_positive", sql`${table.amount} > 0`),
]);

export const fundContributions = pgTable("fund_contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull().unique(),
  fundId: uuid("fund_id").notNull().references(() => funds.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull().references(() => users.id),
  year: integer("year").notNull(),
  month: smallint("month").notNull(),
  amount: money("amount"),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("fund_contributions_fund_period_idx").on(table.fundId, table.year, table.month),
  check("fund_contributions_month_range", sql`${table.month} between 1 and 12`),
  check("fund_contributions_year_positive", sql`${table.year} > 0`),
  check("fund_contributions_amount_positive", sql`${table.amount} > 0`),
]);

export const legacyPrices = pgTable("legacy_prices", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  price: decimal("price").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.symbol] }),
]);

export const marketFxQuotes = pgTable("market_fx_quotes", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  usdVnd: decimal("usd_vnd").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  legacy: boolean("legacy").notNull().default(false),
});

export const marketGoldQuotes = pgTable("market_gold_quotes", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  xauUsdPerTroyOunce: decimal("xau_usd_per_troy_ounce").notNull(),
  vndPerChi: decimal("vnd_per_chi").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

export const marketStockQuotes = pgTable("market_stock_quotes", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  priceVnd: decimal("price_vnd").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.exchange, table.symbol] }),
]);

export const marketCryptoQuotes = pgTable("market_crypto_quotes", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  priceUsd: decimal("price_usd").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.providerId] }),
]);

export const marketCryptoSymbols = pgTable("market_crypto_symbols", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  providerId: text("provider_id").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.symbol] }),
]);

export const marketCryptoMatches = pgTable("market_crypto_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lookupKey: text("lookup_key").notNull(),
  position: integer("position").notNull(),
  providerId: text("provider_id").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  rank: integer("rank"),
}, (table) => [
  uniqueIndex("market_crypto_matches_key_position_unique").on(table.userId, table.lookupKey, table.position),
]);

export const marketQuoteErrors = pgTable("market_quote_errors", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  key: text("key").notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
}, (table) => [
  uniqueIndex("market_quote_errors_user_position_unique").on(table.userId, table.position),
]);

export const marketStates = pgTable("market_states", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const dataImports = pgTable("data_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  checksumSha256: text("checksum_sha256").notNull().unique(),
  sourceName: text("source_name").notNull(),
  userCount: integer("user_count").notNull(),
  fundCount: integer("fund_count").notNull(),
  transactionCount: integer("transaction_count").notNull(),
  lotCount: integer("lot_count").notNull(),
  memberCount: integer("member_count").notNull(),
  contributionCount: integer("contribution_count").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});
