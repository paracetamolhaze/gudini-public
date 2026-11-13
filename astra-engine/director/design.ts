import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT } from "./workspace";

export type DesignProfile = "legacy" | "craft-v1";

/** Resolve once per job, so generation and review always use the same rules. */
export function designProfile(value = process.env.ASTRA_DESIGN_PROFILE): DesignProfile {
  if (!value || value === "craft-v1") return "craft-v1";
  if (value === "legacy") return "legacy";
  throw new Error(`Unknown ASTRA_DESIGN_PROFILE: ${value}`);
}

export function designGuide(profile: DesignProfile): string {
  return profile === "legacy" ? "" : [designRules(), v2Kit()].join(SEPARATOR);
}

const SEPARATOR = ["", "", "---", "", ""].join(String.fromCharCode(10));

/** How v2 moves, composes and checks itself. */
export function designRules(): string {
  return fs.readFileSync(path.join(ENGINE_ROOT, "knowledge", "craft-v1.md"), "utf8");
}

/** The blocks only v2 knows: real pages, live interfaces, paper collages, the ending with the channel's mascot. */
export function v2Kit(): string {
  return fs.readFileSync(path.join(ENGINE_ROOT, "knowledge", "craft-v1-kit.md"), "utf8");
}
