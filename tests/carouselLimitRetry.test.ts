import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { LIMIT_RETRY_DELAY_MS, limitNote, parseLimitReset } from "../lib/carousel/limitRetry";

/**
 * Лимит подписки Claude (01.11 все семь заданий простояли с 17:23 до 21:44): задание само встаёт на повтор через
 * пару минут после сброса, карточка пишет «лимит Claude, продолжу в 20:02»; остальные ошибки ждут «Повторить».
 */

const MSG = "Не удалось найти и проверить историю: Claude: Claude не выполнил задание: You've hit your session limit · resets 8pm (Asia/Qyzylorda)";

test("ошибка лимита: время сброса из текста, повтор через 2 минуты, на карточке «продолжу в 20:02»", () => {
  const now = Date.parse("2026-11-01T12:23:00Z");
  const reset = parseLimitReset(MSG, now)!;
  assert.ok(reset && reset.getTime() > now && reset.getTime() - now < 24 * 3600_000);
  assert.equal(limitNote(new Date(reset.getTime() + LIMIT_RETRY_DELAY_MS)), "лимит Claude, продолжу в 20:02");
  // сброс уже прошёл — значит, следующий такой же, через сутки
  const later = parseLimitReset(MSG, reset.getTime() + 3600_000)!;
  assert.equal(later.getTime() - reset.getTime(), 24 * 3600_000);
  assert.equal(limitNote(parseLimitReset("You've hit your usage limit · resets 8:30am (Asia/Qyzylorda)", now)!), "лимит Claude, продолжу в 08:30");
});

test("другие ошибки не похожи на лимит и ждут кнопку «Повторить»", () => {
  assert.equal(parseLimitReset("Мост каруселей к Claude недоступен"), null);
  assert.equal(parseLimitReset("Claude не ответил вовремя"), null);
  assert.equal(parseLimitReset("You've hit your session limit"), null, "без времени сброса не угадываем");
});

test("планировщик ставит в очередь только задания, у которых наступило время повтора", async () => {
  process.env.CAROUSEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gudini-limit-"));
  const { createSidCarousel } = await import("../lib/carousel/sid/create");
  const { attachJob, finishJob, getCarousel, updateCarousel } = await import("../lib/carousel/store");
  const { requeueLimited } = await import("../lib/carousel/limitRetry");
  const make = (retryAt?: string, error = "лимит Claude, продолжу в 20:02") => {
    const c = createSidCarousel({ style: "urgent" });
    const job = updateCarousel(c.id, (x) => { attachJob(x, "generate"); }).job!;
    finishJob(c.id, job.id, "error", { error, retryAt });
    return c.id;
  };
  const due = make(new Date(Date.now() - 60_000).toISOString());
  const wait = make(new Date(Date.now() + 3600_000).toISOString());
  const plain = make(undefined, "Тексты не подошли");
  assert.equal(requeueLimited(), 1);
  assert.equal(getCarousel(due)!.job!.state, "queued");
  assert.equal(getCarousel(due)!.job!.type, "generate");
  assert.equal(getCarousel(wait)!.job!.state, "error");
  assert.equal(getCarousel(plain)!.job!.state, "error");
  assert.equal(requeueLimited(), 0, "второй проход ничего не трогает");
});
