import test from "node:test";
import assert from "node:assert/strict";
import { followerReportFromHistory, type FollowerHistory } from "../../src/services/analytics/followers.js";

const latestAt = "2026-10-23T12:00:00.000Z";
const observation = (followers: number, capturedAt: string, approximate = false) => ({ followers, capturedAt, approximate });
function history(overrides: Partial<FollowerHistory> = {}): FollowerHistory {
  return {
    platform: "threads", username: "owner", error: null, trackingSince: "2026-09-01T12:00:00.000Z",
    latest: observation(150, latestAt), firstExact: observation(80, "2026-09-01T12:00:00.000Z"),
    day: observation(140, "2026-10-22T12:00:00.000Z"),
    week: observation(100, "2026-10-16T12:00:00.000Z"),
    month: observation(90, "2026-09-23T12:00:00.000Z"),
    ...overrides,
  };
}

test("follower growth preserves negative changes and exact zero counters", () => {
  const report = followerReportFromHistory([history({ latest: observation(0, latestAt) })]);
  assert.deepEqual(report.platforms.threads.changes, { day: -140, week: -100, month: -90, sinceStart: -80 });
  assert.equal(report.platforms.threads.followers, 0);
  assert.equal(report.total.followers, null, "a missing X counter is not zero");
  assert.deepEqual(report.total.changes, { day: null, week: null, month: null, sinceStart: null });
});

test("each period requires a nearby baseline and a full period of history", () => {
  const report = followerReportFromHistory([history({
    day: observation(120, "2026-10-22T05:59:59.999Z"),
    week: observation(100, "2026-10-16T06:00:00.000Z"),
    month: null,
  })]);
  assert.deepEqual(report.platforms.threads.changes, { day: null, week: 50, month: null, sinceStart: 70 });
  assert.equal(followerReportFromHistory([history({ day: observation(120, "2026-10-22T12:00:00.001Z") })]).platforms.threads.changes.day, null);
});

test("PostgreSQL Date timestamps retain milliseconds when matching the first exact snapshot", () => {
  const firstAt = "2026-10-23T04:15:57.053Z";
  const initial = history({ trackingSince: new Date(firstAt), firstExact: observation(1602, firstAt), latest: observation(1602, firstAt), day: null, week: null, month: null });
  assert.equal(followerReportFromHistory([initial]).platforms.threads.changes.sinceStart, 0);
  assert.equal(followerReportFromHistory([{ ...initial, latest: observation(1605, latestAt) }]).platforms.threads.changes.sinceStart, 3);
});

test("approximate counts are displayable but never produce exact growth", () => {
  const approximateLatest = followerReportFromHistory([history({ latest: observation(1_200, latestAt, true) })]);
  assert.equal(approximateLatest.platforms.threads.followers, 1_200);
  assert.equal(approximateLatest.platforms.threads.approximate, true);
  assert.deepEqual(approximateLatest.platforms.threads.changes, { day: null, week: null, month: null, sinceStart: null });
  const approximateBaseline = followerReportFromHistory([history({ day: observation(100, "2026-10-22T12:00:00Z", true) })]);
  assert.equal(approximateBaseline.platforms.threads.changes.day, null);
  assert.equal(approximateBaseline.platforms.threads.changes.week, 50);
});

test("combined stats sum only known values and expose the shared tracking interval", () => {
  const report = followerReportFromHistory([history(), history({
    platform: "x", username: "another", trackingSince: "2026-10-01T12:00:00.000Z",
    latest: observation(10, "2026-10-23T09:00:00.000Z"),
    firstExact: observation(12, "2026-10-01T12:00:00.000Z"),
    day: observation(11, "2026-10-22T09:00:00.000Z"), week: null, month: null,
    error: "Счётчик временно недоступен",
  })]);
  assert.equal(report.total.followers, 160);
  assert.equal(report.total.approximate, false);
  assert.deepEqual(report.total.changes, { day: 9, week: null, month: null, sinceStart: null });
  assert.equal(report.total.trackingSince, "2026-10-01T12:00:00.000Z");
  assert.equal(report.total.updatedAt, "2026-10-23T09:00:00.000Z");
  assert.match(report.total.error!, /X: Счётчик временно недоступен/);
  assert.equal(report.platforms.x.updatedAt, "2026-10-23T09:00:00.000Z", "a failed refresh retains the measurement timestamp");
});

test("since-start growth requires exact initial counts and comparable platform starts", () => {
  const approximateStart = followerReportFromHistory([history({ firstExact: observation(90, "2026-09-02T12:00:00Z") })]);
  assert.equal(approximateStart.platforms.threads.changes.sinceStart, null);
  const second = history({ platform: "x", trackingSince: "2026-09-01T18:00:00Z", firstExact: observation(100, "2026-09-01T18:00:00Z") });
  assert.equal(followerReportFromHistory([history(), second]).total.changes.sinceStart, 120);
  second.trackingSince = "2026-09-01T18:00:00.001Z";
  second.firstExact!.capturedAt = second.trackingSince;
  assert.equal(followerReportFromHistory([history(), second]).total.changes.sinceStart, null);
});

test("combined growth stays unknown when platform observations cover different windows", () => {
  const report = followerReportFromHistory([history(), history({
    platform: "x", latest: observation(50, "2026-10-21T12:00:00Z"),
    day: observation(40, "2026-10-20T12:00:00Z"),
    week: observation(30, "2026-10-14T12:00:00Z"),
    month: observation(20, "2026-09-21T12:00:00Z"),
  })]);
  assert.equal(report.total.followers, 200, "last available audience totals remain displayable");
  assert.equal(report.platforms.threads.changes.day, 10);
  assert.equal(report.platforms.x.changes.day, 10);
  assert.deepEqual(report.total.changes, { day: null, week: null, month: null, sinceStart: null });
});

test("an account without observations remains unknown even when it has an error", () => {
  const report = followerReportFromHistory([history({
    username: "new-account", latest: null, firstExact: null, trackingSince: null, day: null, week: null, month: null,
    error: "Нет разрешения",
  })]);
  assert.equal(report.platforms.threads.followers, null);
  assert.equal(report.platforms.threads.username, "new-account");
  assert.equal(report.platforms.threads.error, "Нет разрешения");
  assert.equal(report.platforms.threads.updatedAt, null);
  assert.equal(report.total.followers, null);
});
