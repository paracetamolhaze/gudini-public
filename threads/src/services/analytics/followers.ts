import { loadSettings } from "../../config/settings.js";
import { query } from "../../db/pool.js";
import { activePlatforms, PLATFORM_IDS, type PlatformId } from "../../platforms/index.js";
import type { FollowerChanges, FollowerStats, FollowerStatsReport } from "../../shared/followerStats.js";
import { errorMessage, scrubSecrets } from "../../shared/logger.js";
import { audit } from "../audit.js";

const HOUR_MS = 60 * 60_000;
const BASELINE_TOLERANCE_MS = 6 * HOUR_MS;
const PERIODS = { day: 24 * HOUR_MS, week: 7 * 24 * HOUR_MS, month: 30 * 24 * HOUR_MS } as const;

interface FollowerObservation {
  followers: number;
  approximate: boolean;
  capturedAt: string;
}

/** The database chooses observations only for the current attempt's account. */
export interface FollowerHistory {
  platform: PlatformId;
  username: string | null;
  error: string | null;
  trackingSince: string | Date | null;
  latest: FollowerObservation | null;
  firstExact: FollowerObservation | null;
  day: FollowerObservation | null;
  week: FollowerObservation | null;
  month: FollowerObservation | null;
}

const observation = (alias: string) => `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE jsonb_build_object(
  'followers', ${alias}.followers, 'approximate', ${alias}.approximate, 'capturedAt', ${alias}.captured_at
) END`;

// Select only the latest, first and three period baselines, irrespective of how
// long tracking has run. All rows share one statement snapshot.
const REPORT_SQL = `
  SELECT names.platform, state.username, state.error,
    first_seen.captured_at AS "trackingSince",
    ${observation("latest")} AS latest,
    ${observation("first_exact")} AS "firstExact",
    ${observation("day_before")} AS day,
    ${observation("week_before")} AS week,
    ${observation("month_before")} AS month
  FROM (VALUES ('threads'), ('x')) names(platform)
  LEFT JOIN follower_collection_state state ON state.platform = names.platform
  LEFT JOIN LATERAL (
    SELECT id, followers, approximate, captured_at FROM follower_snapshots
    WHERE platform = names.platform AND account_id = state.account_id
    ORDER BY captured_at DESC, id DESC LIMIT 1
  ) latest ON true
  LEFT JOIN LATERAL (
    SELECT captured_at FROM follower_snapshots
    WHERE platform = names.platform AND account_id = state.account_id
    ORDER BY captured_at, id LIMIT 1
  ) first_seen ON true
  LEFT JOIN LATERAL (
    SELECT id, followers, approximate, captured_at FROM follower_snapshots
    WHERE platform = names.platform AND account_id = state.account_id AND approximate = false
    ORDER BY captured_at, id LIMIT 1
  ) first_exact ON true
  ${Object.entries({ day: "24 hours", week: "7 days", month: "30 days" }).map(([period, interval]) => `LEFT JOIN LATERAL (
    SELECT id, followers, approximate, captured_at FROM follower_snapshots
    WHERE platform = names.platform AND account_id = state.account_id
      AND captured_at <= latest.captured_at - interval '${interval}'
    ORDER BY captured_at DESC, id DESC LIMIT 1
  ) ${period}_before ON true`).join("\n")}
`;

function iso(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function emptyStats(): FollowerStats {
  return {
    followers: null, approximate: false,
    changes: { day: null, week: null, month: null, sinceStart: null },
    trackingSince: null, updatedAt: null, username: null, error: null,
  };
}

/** Approximate counts are displayable, but cannot establish exact growth. */
function platformStats(history: FollowerHistory): FollowerStats {
  const result = { ...emptyStats(), username: history.username, error: history.error };
  const latest = history.latest;
  if (!latest) return result;
  result.followers = latest.followers;
  result.approximate = latest.approximate;
  result.updatedAt = iso(latest.capturedAt);
  result.trackingSince = iso(history.trackingSince);
  if (latest.approximate) return result;
  for (const period of Object.keys(PERIODS) as Array<keyof typeof PERIODS>) {
    const baseline = history[period];
    if (!baseline || baseline.approximate) continue;
    const gap = Date.parse(latest.capturedAt) - PERIODS[period] - Date.parse(baseline.capturedAt);
    if (gap >= 0 && gap <= BASELINE_TOLERANCE_MS) result.changes[period] = latest.followers - baseline.followers;
  }
  if (history.firstExact && !history.firstExact.approximate &&
      Date.parse(history.firstExact.capturedAt) === Date.parse(result.trackingSince!)) {
    result.changes.sinceStart = latest.followers - history.firstExact.followers;
  }
  return result;
}

/** Pure aggregation keeps unknown values, true zeros, and audience loss distinct. */
export function followerReportFromHistory(histories: FollowerHistory[]): FollowerStatsReport {
  const platforms = { threads: emptyStats(), x: emptyStats() };
  for (const history of histories) platforms[history.platform] = platformStats(history);
  const total = emptyStats();
  const values = Object.values(platforms);
  total.error = values.map((value, index) => value.error ? `${index === 0 ? "Threads" : "X"}: ${value.error}` : null).filter(Boolean).join("; ") || null;
  if (values.every(value => value.followers !== null)) {
    total.followers = values.reduce((sum, value) => sum + value.followers!, 0);
    total.approximate = values.some(value => value.approximate);
    // A combined audience is only as current as the older of its two counters.
    total.updatedAt = new Date(Math.min(...values.map(value => Date.parse(value.updatedAt!)))).toISOString();
    total.trackingSince = new Date(Math.max(...values.map(value => Date.parse(value.trackingSince!)))).toISOString();
  }
  const latestTimes = values.map(value => value.updatedAt === null ? NaN : Date.parse(value.updatedAt));
  const comparableUpdates = latestTimes.every(Number.isFinite) && Math.max(...latestTimes) - Math.min(...latestTimes) <= BASELINE_TOLERANCE_MS;
  for (const period of Object.keys(total.changes) as Array<keyof FollowerChanges>) {
    if (!comparableUpdates) continue;
    if (values.every(value => value.changes[period] !== null)) {
      if (period === "sinceStart") {
        const starts = values.map(value => Date.parse(value.trackingSince!));
        if (Math.max(...starts) - Math.min(...starts) > BASELINE_TOLERANCE_MS) continue;
      }
      total.changes[period] = values.reduce((sum, value) => sum + value.changes[period]!, 0);
    }
  }
  return { platforms, total };
}

export async function followerStatsReport(): Promise<FollowerStatsReport> {
  return followerReportFromHistory(await query<FollowerHistory>(REPORT_SQL));
}

function accountId(platform: PlatformId, id: string): string {
  const trimmed = id.trim();
  // The browser adapter identifies X accounts by handle; official APIs use IDs.
  return platform === "x" && !/^\d+$/.test(trimmed) ? trimmed.replace(/^@/, "").toLowerCase() : trimmed;
}

async function saveAttempt(platform: PlatformId, id: string | null, username: string | null, attemptedAt: string, error: string): Promise<void> {
  await query(`INSERT INTO follower_collection_state(platform, account_id, username, attempted_at, error)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (platform) DO UPDATE SET
      account_id = COALESCE(EXCLUDED.account_id, follower_collection_state.account_id),
      username = COALESCE(EXCLUDED.username, follower_collection_state.username),
      attempted_at = EXCLUDED.attempted_at, error = EXCLUDED.error
    WHERE EXCLUDED.attempted_at >= follower_collection_state.attempted_at`, [platform, id, username, attemptedAt, error]);
}

export async function captureFollowers(): Promise<{ captured: number; skipped: number; error: string | null }> {
  const settings = await loadSettings();
  const active = new Map(activePlatforms(settings).map(adapter => [adapter.id, adapter]));
  const errors: string[] = [];
  let captured = 0;
  let skipped = 0;
  for (const platform of PLATFORM_IDS) {
    const attemptedAt = new Date().toISOString();
    const adapter = active.get(platform);
    let currentId: string | null = null;
    let username: string | null = null;
    try {
      if (!adapter) throw new Error(settings.platforms[platform].enabled ? "Аккаунт не подключён" : "Площадка выключена");
      const identity = await adapter.me();
      currentId = accountId(platform, identity.id);
      username = identity.username;
      if (!currentId) throw new Error("Не удалось определить аккаунт");
      if (!adapter.followerMetrics) throw new Error("Площадка не предоставляет число подписчиков");
      const metrics = await adapter.followerMetrics();
      if (accountId(platform, metrics.accountId) !== currentId) throw new Error("Аккаунт сменился во время сбора подписчиков; повторите обновление");
      if (!Number.isSafeInteger(metrics.followers) || metrics.followers < 0) throw new Error("Площадка вернула некорректное число подписчиков");
      const capturedAt = new Date().toISOString();
      await query(`WITH snapshot AS (
        INSERT INTO follower_snapshots(platform, account_id, username, followers, approximate, captured_at)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
      ) INSERT INTO follower_collection_state(platform, account_id, username, attempted_at, error)
        VALUES ($1, $2, $3, $7, NULL)
        ON CONFLICT (platform) DO UPDATE SET account_id = EXCLUDED.account_id, username = EXCLUDED.username,
          attempted_at = EXCLUDED.attempted_at, error = NULL
        WHERE EXCLUDED.attempted_at >= follower_collection_state.attempted_at`,
      [platform, currentId, metrics.username, metrics.followers, metrics.approximate, capturedAt, attemptedAt]);
      captured++;
    } catch (err) {
      const message = scrubSecrets(errorMessage(err)).slice(0, 2000);
      await saveAttempt(platform, currentId, username, attemptedAt, message);
      skipped++;
      errors.push(`${platform === "threads" ? "Threads" : "X"}: ${message}`);
    }
  }
  const error = errors.join("; ") || null;
  await audit("INSIGHTS_CAPTURED", `Подписчики: ${captured} площадок, пропущено ${skipped}`, {}, { captured, skipped, error }, error ? "warn" : "info");
  return { captured, skipped, error };
}
