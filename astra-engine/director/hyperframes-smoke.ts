import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { prepareHyperGraphics } from "./hyperframes";
import { analyzeMontage } from "./validate";
import { astraInputSchema } from "../src/input";
import { ENGINE_ROOT, prepareWorkspace } from "./workspace";
import { renderVideo } from "./render";

async function main() {
  const root = path.resolve(process.argv[2] ?? "../data/astra-v2-smoke");
  const publicDir = path.join(root, "public");
  fs.mkdirSync(publicDir, { recursive: true });
  fs.cpSync(path.join(ENGINE_ROOT, "public/fonts"), path.join(publicDir, "fonts"), { recursive: true });
  const video = path.join(publicDir, "author.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x183042:s=1080x1920:r=30:d=3", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", video]);
  const frameDir = path.join(publicDir, "author-frames");
  fs.mkdirSync(frameDir, { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-frames:v", "1", path.join(frameDir, "00001.jpg")]);
  for (let n = 2; n <= 90; n++) fs.copyFileSync(path.join(frameDir, "00001.jpg"), path.join(frameDir, `${String(n).padStart(5, "0")}.jpg`));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vn", path.join(publicDir, "voice.wav")]);
  const code = `import React from "react";import {AstraVideo,Graphic,Captions} from "../kit";
export const Montage=()=> <AstraVideo palette="violet"><Captions/><Graphic from={0} to={3} sfx={false}
html={'<div class="coin">АСТРА v2</div>'} css={'.coin{padding:36px;background:var(--accent);color:white;border-radius:24px;font:700 64px var(--sans)}'}
motion={[{at:0,sel:".coin",from:{x:-180,opacity:0},to:{x:180,opacity:1},dur:0.8,ease:"power3.out"}]}/></AstraVideo>`;
  const analysis = analyzeMontage(code, 3);
  assert.equal(analysis.problems.length, 0, analysis.problems.join("\n"));
  const input = astraInputSchema.parse({ duration: 3, fps: 30, video: "author.mp4", voice: "voice.wav", frames: { author: "author-frames", blur: "author-frames", count: 90 }, words: [] });
  const prepared = await prepareHyperGraphics({ blocks: analysis.blocks, code, input, publicDir, workDir: root, log: console.log });
  const clip = Object.entries(prepared.assets).find(([key]) => key.startsWith("hypergraphic:"))?.[1];
  assert.ok(clip, "HyperFrames clip attached to the Remotion input");
  const clipPath = path.join(publicDir, clip);
  const stats: number[] = [];
  for (const at of [0.1, 0.8]) {
    const png = execFileSync("ffmpeg", ["-v", "error", "-c:v", "libvpx-vp9", "-ss", String(at), "-i", clipPath, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { maxBuffer: 10 * 1024 * 1024 });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0, "corner remains transparent");
    let sum = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 40) { sum += (i / 4) % info.width; count++; }
    assert.ok(count > 100, "graphic has visible content"); stats.push(sum / count);
  }
  assert.ok(stats[1] - stats[0] > 60, "HyperFrames timeline actually moves the graphic");
  const final = path.join(root, "combined.mp4");
  await renderVideo({ workspace: prepareWorkspace(code, "hyperframes-smoke"), input: prepared, publicDir, out: final, scale: 0.25, onProgress: p => console.log(`Combined render ${Math.round(p * 100)}%`) });
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", final], { encoding: "utf8" }));
  const stream = probe.streams.find((s: any) => s.codec_type === "video");
  assert.equal(stream.width, 270); assert.equal(stream.height, 480); assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.1);
  const image = path.join(root, "combined.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "0.8", "-i", final, "-frames:v", "1", image]);
  console.log(`HyperFrames → transparent moving graphic → Remotion MP4: PASS (${final})`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

