import test from "node:test";
import assert from "node:assert/strict";
import { feet, KEY_TRAVEL, keyPress, keysUnder } from "../src/kit/ground";
import { screenAt } from "../src/kit/Screens";
import type { Timeline } from "../src/kit/timeline";
import { analyzeScene } from "./validate";

// The owner (2026-10-23): «больше и качественней фон, чтобы на мониторах тоже иллюстрировалось, но просто фоном»;
// «клавиша должна проседать, когда они стоят на ней, при прыжке возвращается, при падении снова проседает».

const facts = { duration: 20, cast: ["me", "claude"], lines: [] };
const scene = (body: string) => `import React from "react";
import { Sketch, Actor, Shot, Screen, Face } from "../kit";
export const Scene: React.FC = () => (
  <Sketch>
    <Actor id="me" at={[-2.24, 0.56]} />
    <Actor id="claude" at={[2.24, 0.56]} />
    <Shot from={0} to={2} on="me" kind="medium" move="push" />
    <Face who="me" from={0} to={2} mood="happy" />
    <Shot from={2} to={10} on="me" kind="close" />
    <Shot from={10} to={20} on="claude" kind="close" />
    ${body}
  </Sketch>
);`;
const screenProblems = (body: string) => analyzeScene(scene(body), facts).filter((p) => /Screen|экран|лента|картинка/.test(p));

test("a reaction is long enough to read: no flash of a shot, an icon or a mood", () => {
  // the owner (2026-10-23): «не совсем понял, зачем эмоция такая у Клода на долю секунды»
  const quick = (body: string) => analyzeScene(`import React from "react";
import { Sketch, Actor, Shot, Face, Pop } from "../kit";
export const Scene: React.FC = () => (
  <Sketch>
    <Actor id="me" at={[-2.24, 0.56]} />
    <Actor id="claude" at={[2.24, 0.56]} />
    <Shot from={0} to={2} on="me" kind="medium" move="push" />
    <Face who="me" from={0} to={2} mood="happy" />
    <Shot from={2} to={8.85} on="me" kind="close" />
    <Shot from={8.85} to={10} on="claude" kind="close" />
    <Shot from={10} to={20} on="me" kind="medium" />
    ${body}
  </Sketch>
);`, facts);
  const flash = quick('<Pop who="claude" at={8.9} icon="?!" for={1.0} />\n    <Face who="claude" from={8.85} to={9.6} mood="shocked" />');
  assert.ok(flash.some((p) => /план не короче 1,5 с/.test(p)), flash.join(" | "));
  assert.ok(flash.some((p) => /значок на 1 с/.test(p)), flash.join(" | "));
  assert.ok(flash.some((p) => /значок стоит на плане 1,15 с/.test(p)), flash.join(" | "));
  assert.ok(flash.some((p) => /настроение shocked на 0,75 с/.test(p)), flash.join(" | "));
});

test("a position replaces the floating window: on the screen behind the hero who talks about it", () => {
  assert.deepEqual(screenProblems(`
    <Screen on="vertical" from={2} to={10} app="position" title="BTC/USDT ×50" lines={["LONG ×50  1 000 USDT", "Вход 64 210", "PnL −98%", "Статус: ликвидирован"]} trend="dump" />`), []);
  const bare = screenProblems('<Screen on="vertical" from={2} to={10} app="position" title="BTC/USDT ×50" lines={["LONG ×50"]} />');
  assert.ok(bare.some((p) => /2–6 строк/.test(p)), bare.join(" | "));
});

test("screens of the story pass the check: the chat on the monitor, a chart and a feed on the vertical screen", () => {
  assert.deepEqual(screenProblems(`
    <Screen on="monitor" from={0} to={12} app="chat" title="Стоит ли покупать курс по трейдингу?" lines={["Сначала проверь, на чём зарабатывает автор."]} />
    <Screen on="vertical" from={0} to={8} app="feed" title="Lambo Trading Academy" lines={["Старт продаж!", "Осталось 3 места"]} />
    <Screen on="vertical" from={8} to={20} app="chart" title="BTC/USDT" lines={["64 210", "−8,4%"]} trend="dump" />`), []);
});

test("one picture at a time on a screen, and a chart says where the price goes", () => {
  const overlap = screenProblems(`
    <Screen on="vertical" from={0} to={10} app="news" title="Новости" lines={["Биткоин упал", "Биржа закрыла вывод"]} />
    <Screen on="vertical" from={6} to={14} app="chart" title="BTC/USDT" lines={["64 210", "−8,4%"]} />`);
  assert.ok(overlap.some((p) => p.includes("одна картинка за раз")), overlap.join("\n"));
  assert.ok(overlap.some((p) => p.includes("trend")), overlap.join("\n"));
});

test("the owner's own channel is never a feed on the screen: his real deals are in the channel itself", () => {
  const problems = screenProblems(`<Screen on="vertical" from={0} to={8} app="feed" title="FX GOLD" lines={["XAU лонг +42", "BTC шорт"]} />`);
  assert.ok(problems.some((p) => p.includes("<Channel>")), problems.join("\n"));
});

const timeline = (screens: Timeline["screens"], acts: Timeline["acts"] = []): Timeline => ({
  shots: [], acts, faces: [], looks: [], moves: [], lights: [], pops: [], channels: [], screens, held: [],
  actors: [{ id: "me", at: [-2.24, 0.56] }, { id: "claude", at: [2.24, 0.56] }],
});

test("a screen rests on its idle picture, fades into the director's picture and back after it", () => {
  const tl = timeline([{ on: "monitor", from: 4, to: 10, app: "chat", title: "Вопрос", lines: ["Ответ"] }]);
  assert.equal(screenAt(tl, "monitor", 2).now.app, "home");
  const opening = screenAt(tl, "monitor", 4.1);
  assert.equal(opening.now.app, "chat");
  assert.equal(opening.before?.app, "home");
  assert.ok(opening.fade > 0 && opening.fade < 1);
  assert.ok(Math.abs(screenAt(tl, "monitor", 6).now.since - 2) < 1e-9);
  assert.equal(screenAt(tl, "monitor", 6).before, null);
  const closing = screenAt(tl, "monitor", 10.1);
  assert.equal(closing.now.app, "home");
  assert.equal(closing.before?.app, "chat");
  assert.equal(screenAt(tl, "vertical", 6).now.app, "home");
});

test("the key is down while a hero stands on it, up while he is in the air and down again when he lands", () => {
  const tl = timeline([], [{ who: "claude", from: 2, to: 3, do: "jump" }]);
  const lift = (t: number) => feet(tl, "claude", "blocky", t).lift;
  assert.equal(keyPress(lift(1)), 1);
  // the crouch before the push-off keeps the feet on the key
  assert.equal(lift(2.05), 0);
  assert.ok(feet(tl, "claude", "blocky", 2.08).crouch > 0.3);
  // in the air the key is all the way up
  assert.ok(lift(2.37) > 0.2);
  assert.equal(keyPress(lift(2.37)), 0);
  // landed: feet on the key, legs giving, the key down again
  assert.equal(lift(2.7), 0);
  assert.equal(keyPress(lift(2.7)), 1);
  assert.ok(feet(tl, "claude", "blocky", 2.7).crouch > 0);
  // each hero stands squarely on one key of his own
  const [key] = keysUnder(2.24, 0.56);
  assert.deepEqual([key.col, key.row, key.weight], [9, 3, 1]);
  assert.ok(KEY_TRAVEL > 0.1 && KEY_TRAVEL < 0.25);
});
