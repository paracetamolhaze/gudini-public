import test from "node:test";
import assert from "node:assert/strict";
import channel from "../src/channel.json";
import { channelShown, qrPath } from "../src/kit/Channel";
import { analyzeScene } from "./validate";

// The owner (2026-10-22): «добавь в 3Д QR-код канала в кадре». The card sits above the subtitles on every shot;
// these tests keep the code itself whole and the director's use of the card sensible.

const facts = { duration: 20, cast: ["me", "claude"], lines: [] };
const scene = (body: string) => `import React from "react";
import { Sketch, Actor, Shot, Channel, Face } from "../kit";
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

test("the channel QR is a whole code: square, with the three finder corners", () => {
  const rows = channel.qr;
  const n = rows.length;
  assert.ok(n >= 21 && (n - 21) % 4 === 0, `size ${n}`);
  assert.ok(rows.every((r) => r.length === n && /^[01]+$/.test(r)));
  const finder = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
  for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    assert.deepEqual(rows.slice(y, y + 7).map((r) => r.slice(x, x + 7)), finder, `corner ${x},${y}`);
  }
  assert.ok(channel.url.startsWith("https://t.me/"));
});

test("the card draws every dark module once and fades in and out of its window", () => {
  const path = qrPath(["0110", "1001"]);
  assert.equal(path, "M4 3h2v1h-2zM3 4h1v1h-1zM6 4h1v1h-1z");
  const cards = [{ from: 5, to: 11 }];
  assert.equal(channelShown(cards, 4.9), 0);
  assert.equal(channelShown(cards, 8), 1);
  assert.ok(channelShown(cards, 5.1) > 0 && channelShown(cards, 5.1) < 1);
  assert.equal(channelShown(cards, 11.2), 0);
});

test("the validator takes one card on the channel lines and teaches its length", () => {
  assert.deepEqual(analyzeScene(scene("<Channel from={6} to={12} />"), facts), []);
  const refused: [string, RegExp][] = [
    ["<Channel from={6} to={8} />", /не успеют отсканировать/],
    ["<Channel from={2} to={19} />", /надолго закрывает верх кадра/],
    ["<Channel from={1} to={6} />\n    <Channel from={12} to={18} />", /один раз за ролик/],
  ];
  for (const [body, teach] of refused) {
    const problems = analyzeScene(scene(body), facts);
    assert.ok(problems.some((p) => teach.test(p)), `${body}: ${problems.join(" | ")}`);
  }
});
