import fs from "node:fs";
import path from "node:path";
import type { AssetNeeds } from "./assets";
import { coinKey } from "../src/kit/iconPictures";
import type { Analysis } from "./validate";
import type { AstraInput } from "../src/input";
import { cutoutKey, screenKey } from "../src/assetKeys";

type InputAssets = { assets: Record<string, string> };
type Prepared = { purpose: string; files: string[]; signatures: string[] };

export function fileSignature(publicDir: string, file: string): string {
  try {
    const s = fs.statSync(path.join(publicDir, file));
    return s.isFile() ? `${s.size}:${s.mtimeMs}:${s.ctimeMs}` : "";
  } catch { return ""; }
}

/** A selected window remains valid for the same words and required length, even if layout changes. */
export function footageContext(analysis: Analysis, words: AstraInput["words"], f: { query: string; start?: number }) {
  const blocks = analysis.blocks.filter(b => b.type === "Footage" && b.props.query === f.query
    && (typeof b.props.start === "number" ? Math.round(b.props.start) : undefined) === f.start);
  const said = blocks.map(b => words.filter(w => w.end > b.from - 0.3 && w.start < b.to + 0.3).map(w => w.word).join(" ")).filter(Boolean).join(" … ");
  const length = Math.max(4, Math.min(10, Math.round(Math.max(3, ...blocks.map(b => b.to - b.from)) + 1)));
  return { said, length, purpose: JSON.stringify([said, length]) };
}

/** Keep prepared files through local repairs, including selected windows and redrawn replacements.
 * The caller's sizes (span/plate) stay intact because retained assets never enter resolveAssets again.
 */
export class PreparedAssets {
  private readonly prepared = new Map<string, Prepared>();
  constructor(private readonly publicDir: string) {}

  private signature(file: string): string {
    return fileSignature(this.publicDir, file);
  }

  private describe(needs: AssetNeeds) {
    const footageKey = (f: { query: string; start?: number }) => `${f.query}${f.start === undefined ? "" : `@${Math.round(f.start)}`}`;
    return {
      emoji: needs.emoji.map(n => ({ value: n, keys: [`emoji:${n}`], purpose: n })),
      logos: needs.logos.map(n => ({ value: n, keys: [`logo:${n.toLowerCase()}`], purpose: n.toLowerCase() })),
      photos: needs.photos.map(n => ({ value: n, keys: [`photo:${n}`], purpose: needs.looks?.[n] ?? n })),
      scenes: (needs.scenes ?? []).map(n => ({ value: n, keys: [`scene:${n}`], purpose: n })),
      memes: (needs.memes ?? []).map(n => ({ value: n, keys: [`meme:${n}`], purpose: n })),
      morphs: (needs.morphs ?? []).map(m => ({ value: m, keys: [`morph:${m.from.toFixed(2)}`], purpose: m.into })),
      reals: (needs.reals ?? []).map(r => ({ value: r, keys: [`real:${r.wiki ?? r.query}`], purpose: JSON.stringify(r) })),
      footage: (needs.footage ?? []).map(f => ({ value: f, keys: [`footage:${footageKey(f)}`, `footage-poster:${footageKey(f)}`], purpose: JSON.stringify(f) })),
      screens: (needs.screens ?? []).map(sh => ({ value: sh, keys: [screenKey(sh)], purpose: JSON.stringify(sh) })),
      cutouts: (needs.cutouts ?? []).map(c => ({ value: c, keys: [cutoutKey(c)], purpose: JSON.stringify([c.query, c.wiki, c.color === true]) })),
      coins: (needs.coins ?? []).map(c => ({ value: c, keys: [coinKey(c)], purpose: c.toLowerCase() })),
    };
  }

  remember(needs: AssetNeeds, input: InputAssets): void {
    for (const group of Object.values(this.describe(needs))) for (const item of group) {
      const files = item.keys.map(key => input.assets[key]);
      const signatures = files.map(file => file ? this.signature(file) : "");
      if (signatures.every(Boolean)) this.prepared.set(item.keys[0], { purpose: item.purpose, files, signatures });
      else this.prepared.delete(item.keys[0]);
    }
  }

  pending(needs: AssetNeeds, input: InputAssets): AssetNeeds {
    const items = this.describe(needs);
    const pending = <T>(group: { value: T; keys: string[]; purpose: string }[]) => group.filter(item => {
      const old = this.prepared.get(item.keys[0]);
      return !old || old.purpose !== item.purpose || item.keys.some((key, i) => {
        const file = input.assets[key];
        const signature = file ? this.signature(file) : "";
        return !file || file !== old.files[i] || !signature || signature !== old.signatures[i];
      });
    }).map(item => item.value);
    return { emoji: pending(items.emoji), logos: pending(items.logos), photos: pending(items.photos), looks: needs.looks,
      scenes: pending(items.scenes), memes: pending(items.memes), morphs: pending(items.morphs), reals: pending(items.reals), footage: pending(items.footage),
      screens: pending(items.screens), cutouts: pending(items.cutouts), coins: pending(items.coins) };
  }
}
