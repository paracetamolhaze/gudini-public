export type FollowerPlatform = "threads" | "x";

export interface FollowerChanges {
  day: number | null;
  week: number | null;
  month: number | null;
  sinceStart: number | null;
}

export interface FollowerStats {
  followers: number | null;
  approximate: boolean;
  changes: FollowerChanges;
  trackingSince: string | null;
  updatedAt: string | null;
  username: string | null;
  error: string | null;
}

export interface FollowerStatsReport {
  platforms: Record<FollowerPlatform, FollowerStats>;
  total: FollowerStats;
}
