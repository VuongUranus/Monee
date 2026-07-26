import crypto from "node:crypto";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import type { StoredFinancePayload, UserDatabase } from "@chi-tieu/shared";
import { normalizeStore } from "@chi-tieu/shared";
import type { FinanceDatabase } from "./client.js";
import {
  assemblePersonalStore,
  assembleSharedFundContent,
  insertSharedFund,
  replacePersonalStore,
  storeAsPayload,
} from "./finance-persistence.js";
import * as schema from "./schema.js";
import { isUserDatabase } from "../lib/repository.js";

export interface ImportSummary {
  checksum: string;
  alreadyImported: boolean;
  users: number;
  funds: number;
  transactions: number;
  lots: number;
  members: number;
  contributions: number;
}

export function parseUserDatabase(source: string): UserDatabase {
  const parsed: unknown = JSON.parse(source);
  if (!isUserDatabase(parsed)) throw new Error("File phải là database JSON schemaVersion 3 hoặc 4.");
  return parsed;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function differencePaths(expected: unknown, actual: unknown, prefix: string): string[] {
  if (canonical(expected) === canonical(actual)) return [];
  if ((expected === null || expected === undefined) && (actual === null || actual === undefined)) return [];
  if (typeof expected === "number" && typeof actual === "number") {
    const tolerance = Math.max(1, Math.abs(expected), Math.abs(actual)) * 1e-10;
    if (Math.abs(expected - actual) <= tolerance) return [];
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const result: string[] = [];
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      result.push(...differencePaths(expected[index], actual[index], `${prefix}[${index}]`));
      if (result.length >= 30) break;
    }
    return result;
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const result: string[] = [];
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      result.push(...differencePaths(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        `${prefix}.${key}`,
      ));
      if (result.length >= 30) break;
    }
    return result;
  }
  return [prefix];
}

function timestamp(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date(0) : parsed;
}

function lotCountFromYears(years: Record<string, { details: Record<string, unknown[]> }>): number {
  let total = 0;
  for (const year of Object.values(years)) {
    for (const details of Object.values(year.details)) {
      for (const detail of details as any[]) {
        if (Array.isArray(detail?.lots)) total += detail.lots.length;
      }
    }
  }
  return total;
}

export async function importUserDatabase(
  db: FinanceDatabase,
  source: string,
  sourceName: string,
): Promise<ImportSummary> {
  const database = parseUserDatabase(source);
  const checksum = crypto.createHash("sha256").update(source).digest("hex");
  const [previous] = await db.select().from(schema.dataImports).where(eq(schema.dataImports.checksumSha256, checksum));
  if (previous) {
    return {
      checksum,
      alreadyImported: true,
      users: previous.userCount,
      funds: previous.fundCount,
      transactions: previous.transactionCount,
      lots: previous.lotCount,
      members: previous.memberCount,
      contributions: previous.contributionCount,
    };
  }
  const [count] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users);
  if ((count?.count ?? 0) > 0) {
    throw new Error("Database đích đã có dữ liệu khác; importer từ chối ghi đè.");
  }

  return db.transaction(async (tx) => {
    let fundCount = 0;
    let transactionCount = 0;
    let lotCount = 0;
    let memberCount = 0;
    let contributionCount = 0;

    for (const record of Object.values(database.users)) {
      await tx.insert(schema.users).values({
        id: record.profile.sub,
        email: record.profile.email,
        name: record.profile.name || record.profile.email,
        picture: record.profile.picture || "",
        workspaceRevision: 1,
        createdAt: timestamp(record.createdAt),
        updatedAt: timestamp(record.updatedAt),
      });
    }

    for (const [userId, record] of Object.entries(database.users)) {
      const result = await replacePersonalStore(tx, userId, record.data);
      fundCount += result.fundCount;
      transactionCount += result.transactionCount;
      lotCount += result.lotCount;
    }

    for (const record of Object.values(database.sharedFunds ?? {})) {
      const result = await insertSharedFund(tx, {
        externalId: record.id,
        ownerId: record.ownerId,
        revision: record.revision,
        content: record.content,
        createdAt: timestamp(record.createdAt),
        updatedAt: timestamp(record.updatedAt),
      });
      fundCount += 1;
      lotCount += result.lotCount;
      const members = Object.values(record.members);
      memberCount += members.length;
      if (members.length) {
        await tx.insert(schema.fundMembers).values(members.map((member) => ({
          fundId: result.id,
          userId: member.userId,
          role: member.role,
          addedAt: timestamp(member.addedAt),
        })));
        for (const member of members) {
          const positions = await tx.select({ position: schema.fundPositions.position }).from(schema.fundPositions)
            .where(eq(schema.fundPositions.userId, member.userId));
          await tx.insert(schema.fundPositions).values({
            fundId: result.id,
            userId: member.userId,
            position: Math.max(-1, ...positions.map((item) => item.position)) + 1,
          });
        }
      }
      contributionCount += Object.values(record.content.contributions ?? {}).reduce((sum, entries) => sum + entries.length, 0);
    }

    await tx.insert(schema.dataImports).values({
      checksumSha256: checksum,
      sourceName: path.basename(sourceName),
      userCount: Object.keys(database.users).length,
      fundCount,
      transactionCount,
      lotCount,
      memberCount,
      contributionCount,
    });
    return {
      checksum,
      alreadyImported: false,
      users: Object.keys(database.users).length,
      funds: fundCount,
      transactions: transactionCount,
      lots: lotCount,
      members: memberCount,
      contributions: contributionCount,
    };
  });
}

export interface VerificationResult {
  ok: boolean;
  differences: string[];
}

export async function verifyUserDatabase(
  db: FinanceDatabase,
  source: string,
): Promise<VerificationResult> {
  const database = parseUserDatabase(source);
  const differences: string[] = [];
  let expectedFunds = Object.keys(database.sharedFunds ?? {}).length;
  let expectedTransactions = 0;
  let expectedLots = 0;
  for (const [userId, record] of Object.entries(database.users)) {
    const expected = normalizeStore(record.data).store;
    expectedFunds += expected.funds.length;
    expectedTransactions += expected.expense.txns.length;
    expectedLots += lotCountFromYears(expected.years);
    const actual = await assemblePersonalStore(db, userId);
    differences.push(...differencePaths(expected, actual, `users.${userId}.data`));
  }
  for (const record of Object.values(database.sharedFunds ?? {})) {
    expectedLots += lotCountFromYears(Object.fromEntries(Object.entries(record.content.years).map(([year, value]) => [year, {
      details: { [record.id]: value.details },
    }])));
    const [fund] = await db.select().from(schema.funds)
      .where(eq(schema.funds.externalId, record.id));
    if (!fund) {
      differences.push(`sharedFunds.${record.id}:missing`);
      continue;
    }
    const actual = await assembleSharedFundContent(db, fund);
    const expected: typeof actual = {
      ...structuredClone(record.content),
      contributions: structuredClone(record.content.contributions ?? {}),
    };
    differences.push(...differencePaths(expected, actual, `sharedFunds.${record.id}.content`));
    const members = await db.select().from(schema.fundMembers).where(eq(schema.fundMembers.fundId, fund.id));
    if (members.length !== Object.keys(record.members).length) differences.push(`sharedFunds.${record.id}.members`);
  }
  const expectedMembers = Object.values(database.sharedFunds ?? {})
    .reduce((sum, record) => sum + Object.keys(record.members).length, 0);
  const expectedContributions = Object.values(database.sharedFunds ?? {})
    .reduce((sum, record) => sum + Object.values(record.content.contributions ?? {})
      .reduce((entrySum, entries) => entrySum + entries.length, 0), 0);
  const tableCount = async (table: any): Promise<number> => {
    const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(table);
    return result?.count ?? 0;
  };
  const actualCounts = {
    users: await tableCount(schema.users),
    funds: await tableCount(schema.funds),
    transactions: await tableCount(schema.transactions),
    lots: await tableCount(schema.holdingLots) + await tableCount(schema.goldLots),
    members: await tableCount(schema.fundMembers),
    contributions: await tableCount(schema.fundContributions),
  };
  const expectedCounts = {
    users: Object.keys(database.users).length,
    funds: expectedFunds,
    transactions: expectedTransactions,
    lots: expectedLots,
    members: expectedMembers,
    contributions: expectedContributions,
  };
  for (const key of Object.keys(expectedCounts) as Array<keyof typeof expectedCounts>) {
    if (actualCounts[key] !== expectedCounts[key]) {
      differences.push(`counts.${key}:${actualCounts[key]}!=${expectedCounts[key]}`);
    }
  }
  const checksum = crypto.createHash("sha256").update(source).digest("hex");
  const [importRecord] = await db.select().from(schema.dataImports)
    .where(eq(schema.dataImports.checksumSha256, checksum));
  if (!importRecord) differences.push("imports.checksum:missing");
  return { ok: differences.length === 0, differences };
}

export function normalizedPayload(payload: StoredFinancePayload): StoredFinancePayload {
  return storeAsPayload(normalizeStore(payload).store);
}
