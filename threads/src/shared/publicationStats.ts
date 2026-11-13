export type PublicationStatsPlatform = "threads" | "x";

/** Null counters mean no measured value is available; zero is an observed zero. */
export interface MetricTotals {
  posts: number;
  measuredPosts: number;
  views: number | null;
  likes: number | null;
  replies: number | null;
  updatedAt: string | null;
}

export interface PublicationStats {
  id: string;
  text: string;
  publishedAt: string;
  totals: MetricTotals;
  platforms: Partial<Record<PublicationStatsPlatform, MetricTotals & { permalink: string | null }>>;
}

export interface PublicationStatsReport {
  totals: MetricTotals;
  platforms: Record<PublicationStatsPlatform, MetricTotals>;
  posts: PublicationStats[];
  totalPosts: number;
  limit: number;
  offset: number;
}
