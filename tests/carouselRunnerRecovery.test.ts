import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCarousel, updateCarousel, attachJob, acquireRunnerLock, releaseRunnerLock } from '../lib/carousel/store';
import { runSchedulerTick } from '../lib/carousel/runnerControl';

test('periodic tick resumes an existing generation after a stale boot heartbeat', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gudini-runner-recovery-'));
  const cwd = process.cwd();
  const previous = process.env.CAROUSEL_DATA_DIR;
  const marker = path.join(root, 'started');
  try {
    process.env.CAROUSEL_DATA_DIR = path.join(root, 'data');
    fs.mkdirSync(path.join(root, 'node_modules/tsx/dist'), { recursive: true });
    fs.mkdirSync(path.join(root, 'lib/carousel'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib/carousel/runner.ts'), '');
    fs.writeFileSync(path.join(root, 'node_modules/tsx/dist/cli.mjs'),
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'started');`);
    const c = createCarousel({ idea: 'Recovery', wishes: '', slideCount: 3, language: 'ru', style: 'graphite', format: 'portrait' });
    updateCarousel(c.id, value => { attachJob(value, 'generate'); });
    acquireRunnerLock(123456);
    process.chdir(root);
    runSchedulerTick();
    assert.equal(fs.existsSync(marker), false, 'fresh heartbeat prevents a duplicate runner');
    releaseRunnerLock(123456);
    acquireRunnerLock(123456, Date.now() - 60_000);
    runSchedulerTick();
    for (let i = 0; i < 50 && !fs.existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(fs.existsSync(marker), true, 'existing unscheduled generation wakes after heartbeat expires');
  } finally {
    process.chdir(cwd);
    if (previous === undefined) delete process.env.CAROUSEL_DATA_DIR;
    else process.env.CAROUSEL_DATA_DIR = previous;
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('gudini-runner-recovery-'));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
