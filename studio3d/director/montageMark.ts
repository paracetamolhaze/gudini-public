/**
 * Which of the site's videos the montage in a work folder is. A montage marks its folder "pending" as it starts
 * replacing the previous montage's files; once the site has taken the video, the runner marks the folder with that
 * video's time on the site (Video3D.at, which the site's answer to /complete carries as the job's finishedAt). A dub
 * renders the montage again only for that very video: a montage whose upload failed, or an older one when another
 * runner made the site's video, is never taken for it. Folders from before marks have none and are matched by length.
 * No imports beyond node: the runner loads this module itself, before the director.
 */
import fs from "node:fs";
import path from "node:path";

export const MARK_FILE = "montage.json";

export type MontageMark = { state: "pending" } | { state: "shown"; videoAt: string; jobId: string };

/** The folder's mark; null when it has none. A mark that does not read is as good as "pending": nothing is known. */
export function readMark(workDir: string): MontageMark | null {
  const file = path.join(workDir, MARK_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const mark = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<{ state: string; videoAt: unknown; jobId: unknown }>;
    if (mark?.state === "shown" && typeof mark.videoAt === "string" && mark.videoAt) return { state: "shown", videoAt: mark.videoAt, jobId: String(mark.jobId ?? "") };
  } catch {
    // a half-written mark: see above
  }
  return { state: "pending" };
}

/** Writes the mark whole (renamed into place); null removes it, leaving the folder to the length check. */
export function writeMark(workDir: string, mark: MontageMark | null): void {
  const file = path.join(workDir, MARK_FILE);
  if (!mark) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.writeFileSync(`${file}.part`, JSON.stringify(mark));
  fs.renameSync(`${file}.part`, file);
}
