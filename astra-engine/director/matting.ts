import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT } from "./workspace";

function cutOut(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.ASTRA_PYTHON ?? "python3", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
    child.on("error", reject);
    child.on("close", code => (code === 0 ? resolve() : reject(new Error(`вырезка автора: ${stderr.trim().split("\n").pop() || `код ${code}`}`))));
  });
}

/**
 * Cuts the author out for every range (text behind the author) and returns the cutout list
 * for the input. Ranges already cut earlier in this job are reused. Runs without blocking,
 * so it can go on while pictures are drawn.
 */
export async function makeCutouts(opts: { video: string; publicDir: string; subdir: string; ranges: { from: number; to: number }[] }) {
  const model = process.env.ASTRA_RVM_MODEL ?? path.join(ENGINE_ROOT, "matting/rvm_mobilenetv3_fp32.onnx");
  const dir = path.join(opts.publicDir, opts.subdir);
  fs.mkdirSync(dir, { recursive: true });
  const cutouts: { from: number; to: number; src: string }[] = [];
  for (const range of opts.ranges) {
    const name = `cutout-${range.from.toFixed(2)}-${range.to.toFixed(2)}.webm`;
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      // Written under a temporary name: an interrupted cut is never taken for a finished one.
      const temp = path.join(dir, `${name}.part.webm`);
      await cutOut([path.join(ENGINE_ROOT, "matting/cutout.py"), "--video", opts.video, "--start", range.from.toFixed(3),
        "--end", range.to.toFixed(3), "--out", temp, "--model", model]);
      fs.renameSync(temp, file);
    }
    cutouts.push({ from: range.from, to: range.to, src: `${opts.subdir}/${name}` });
  }
  return cutouts;
}
