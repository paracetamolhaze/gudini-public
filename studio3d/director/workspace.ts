import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ENGINE_ROOT } from "./cast";

const run = promisify(execFile);

/**
 * A private copy of the 3D sources with the director's Scene.tsx in place of the test scene.
 * Lives inside the package folder so the bundler and tsc resolve the package's node_modules.
 */
export function prepareWorkspace(code: string, name: string): string {
  const dir = path.join(ENGINE_ROOT, ".work", "ws", name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(ENGINE_ROOT, "src"), path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/scene/Scene.tsx"), code, "utf8");
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        extends: path.join(ENGINE_ROOT, "tsconfig.json").replace(/\\/g, "/"),
        compilerOptions: { types: ["node"], typeRoots: [path.join(ENGINE_ROOT, "node_modules/@types").replace(/\\/g, "/")] },
        include: ["src"],
      },
      null,
      2,
    ),
  );
  return dir;
}

/** TypeScript errors of the scene, with paths shortened to the file inside src. */
export async function typecheck(dir: string): Promise<string[]> {
  const tsc = path.join(ENGINE_ROOT, "node_modules/typescript/bin/tsc");
  try {
    await run(process.execPath, [tsc, "--noEmit", "-p", path.join(dir, "tsconfig.json")], { cwd: dir, maxBuffer: 8 << 20 });
    return [];
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`
      .split(/\r?\n/)
      .filter((line) => /error TS/.test(line))
      .map((line) => line.replace(/^.*[\\/](src[\\/].*)$/, "$1"));
  }
}

export const removeWorkspace = (dir: string) => fs.rmSync(dir, { recursive: true, force: true });
