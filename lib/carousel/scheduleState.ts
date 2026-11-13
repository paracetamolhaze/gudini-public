import type { Carousel, ScheduleState } from "./types";
/** Read legacy single schedules without losing them during migration. */
export function schedulesOf(c: Carousel): ScheduleState[] {
  return c.schedules ?? (c.schedule ? [c.schedule] : []);
}
export const schedulePlatform = (s: ScheduleState) => s.account.via === "threads" ? "threads" : "instagram";
export function selectSchedule(c: Carousel, id?: string) {
  const all = schedulesOf(c);
  return id ? all.find(s => s.id === id) : all.find(s => ["scheduled", "queued", "publishing", "uncertain", "missed", "failed"].includes(s.status)) ?? all[0];
}
