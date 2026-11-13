import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT } from "./workspace";

const dir = path.join(ENGINE_ROOT, "knowledge");

export type Example = { name: string; text: string; code: string; duration: number };

/**
 * Worked examples: transcript plus the montage a strong editor would make. Astra v2 learns from the same videos
 * edited its way (examples-v2): she follows her examples closely, so they show the look she should make.
 */
export function loadExamples(set: "examples" | "examples-v2" = "examples"): Example[] {
  return fs.readdirSync(path.join(dir, set)).filter(f => f.endsWith(".md")).sort().map(file => {
    const text = fs.readFileSync(path.join(dir, set, file), "utf8").replace(/\r\n/g, "\n");
    const code = text.match(/```tsx\n([\s\S]*?)```/)?.[1] ?? "";
    const times = [...text.matchAll(/@(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
    return { name: file.replace(/\.md$/, ""), text, code, duration: Math.max(0, ...times) + 1.5 };
  });
}

export function loadGuide(): { director: string; kit: string } {
  return {
    director: fs.readFileSync(path.join(dir, "director.md"), "utf8"),
    kit: fs.readFileSync(path.join(dir, "kit.md"), "utf8"),
  };
}

/**
 * The owner's lessons from earlier videos: one per line, newest last. Astra v2 also gets the owner's newer word on
 * the creator look (lessons-v2.md): it comes last, so it reads the older lessons the way v2 shows things.
 */
export function loadLessons(profile: "legacy" | "craft-v1" = "legacy"): string[] {
  const read = (file: string) => fs.readFileSync(path.join(dir, file), "utf8").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return profile === "legacy" ? read("lessons.md") : [...read("lessons.md"), ...read("lessons-v2.md")];
}
