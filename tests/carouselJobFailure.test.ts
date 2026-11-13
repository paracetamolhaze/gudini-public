import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeJob } from '../lib/carousel/jobs';
import { createCarousel, updateCarousel, getCarousel, attachJob } from '../lib/carousel/store';

test('failed illustration run keeps the scenario and ends in error, never done', async () => {
  const saved = { ...process.env };
  process.env.CAROUSEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'carousel-job-failure-'));
  process.env.CAROUSEL_IMAGE_TRANSPORT = 'codex';
  process.env.CAROUSEL_TEXT_MODEL = 'gpt-6-astra';
  process.env.CODEX_BRIDGE_TOKEN = 'test';
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    res.setHeader('content-type', 'application/json');
    res.statusCode = req.url === '/image' ? 502 : 200;
    res.end(JSON.stringify(req.url === '/image' ? { error: 'Reference decode failed' } : {
      text: JSON.stringify({ ok: true, issues: [] }), usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 }, runId: 'test', durationMs: 1,
    }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.CODEX_BRIDGE_URL = process.env.CODEX_IMAGE_BRIDGE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const c = createCarousel({ idea: 'Ethereum', wishes: '', slideCount: 3, language: 'ru', format: 'portrait', style: 'graphite' }, { mode: 'illustrated', imageModel: 'codex/imagegen' });
    const updated = updateCarousel(c.id, x => {
      x.slides = [{ id: 'sfailed', kind: 'cover', kicker: '', title: 'Ethereum', body: '', bullets: [], cta: '', image: {
        brief: 'Ethereum network', composition: 'center', textPlacement: 'bottom', versions: [], rev: 0, attempts: 0, status: 'none',
      } }];
      attachJob(x, 'images');
    });
    await executeJob(c.id, updated.job!);
    const result = getCarousel(c.id)!;
    assert.equal(result.job!.state, 'error');
    assert.match(result.job!.error!, /Не готовы иллюстрации/);
    assert.equal(result.slides[0].title, 'Ethereum');
    assert.equal(result.slides[0].image!.status, 'error');
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
