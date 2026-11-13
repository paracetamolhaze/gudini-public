/** A stand-in for the site's /api/3d/runner/* in tests: records every request and answers through a handler. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export type Seen = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  raw: Buffer;
  json: any;
};

/** JSON by default; raw answers bytes as they are (a recorded take), with its own headers. */
export type Answer = { status: number; body?: unknown; headers?: Record<string, string> } | { status: number; raw: Uint8Array; headers?: Record<string, string> } | "drop";

export async function fakeSite(handler: (req: Seen, all: Seen[]) => Answer | Promise<Answer>) {
  const seen: Seen[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", "http://site");
    let json: unknown = null;
    if (String(req.headers["content-type"] ?? "").startsWith("application/json")) json = JSON.parse(raw.toString("utf8") || "null");
    const entry: Seen = { method: req.method ?? "", path: url.pathname, query: url.searchParams, headers: req.headers, raw, json };
    seen.push(entry);
    const answer = await handler(entry, seen);
    if (answer === "drop") {
      req.socket.destroy();
      return;
    }
    if ("raw" in answer) {
      res.writeHead(answer.status, { "Content-Type": "application/octet-stream", "Content-Length": String(answer.raw.byteLength), ...answer.headers });
      res.end(answer.raw);
      return;
    }
    res.writeHead(answer.status, { "Content-Type": "application/json", ...answer.headers });
    res.end(JSON.stringify(answer.body ?? {}));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    calls: (path: string) => seen.filter(entry => entry.path === path),
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > until) throw new Error("Не дождался условия теста");
    await sleep(10);
  }
}
