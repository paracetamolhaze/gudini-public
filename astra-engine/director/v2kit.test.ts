import assert from "node:assert/strict";
import test from "node:test";
import { allowedUrl, privateAddress } from "./screens";
import { analyzeMontage, assetNeeds } from "./validate";
import { designGuide, v2Kit } from "./design";
import { repairSystemPrompt } from "./prompt";
import { uiCss } from "../src/kit/ui";
import { PALETTES } from "../src/design";

const wrap = (body: string, palette = "cream") => `import React from "react";
import { AstraVideo, Captions, Screen, Collage, Outro, Graphic } from "../kit";
export const Montage: React.FC = () => (
  <AstraVideo palette="${palette}">
    ${body}
    <Captions />
  </AstraVideo>
);`;

test("the screenshot browser never reaches the machine or the local network", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.18.0.3", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
    assert.equal(privateAddress(ip), true, ip);
  }
  assert.equal(privateAddress("140.82.112.3"), false);
  for (const url of ["http://localhost:3000", "http://gudini-site:3000/", "http://host.docker.internal:43127/", "file:///etc/passwd",
    "http://169.254.169.254/latest", "https://user:pass@example.com/", "https://example.com:8443/", "http://[::1]/"]) {
    assert.equal(await allowedUrl(url), null, url);
  }
});

test("pages and collage pieces become asset needs; their parts appear on words", () => {
  const analysis = analyzeMontage(wrap(`
    <Screen from={1} to={5} url="https://github.com/bitcoin/bitcoin" find="Bitcoin Core" at={2.5} />
    <Collage from={6} to={11} title="Пицца" items={[{ query: "Laszlo Hanyecz", wiki: "Laszlo Hanyecz", at: 6.4, label: "Ласло" }, { query: "pizza", at: 8, color: true }]} />
    <Outro from={17.5} to={20} title="ПОДПИШИСЬ" text="дальше — ключи" pose="hi" />`), 20);
  assert.deepEqual(analysis.problems, []);
  const needs = assetNeeds(analysis.blocks);
  assert.deepEqual(needs.screens, [{ url: "https://github.com/bitcoin/bitcoin", find: "Bitcoin Core" }]);
  assert.deepEqual(needs.cutouts.map(c => [c.query, c.wiki, c.color]), [["Laszlo Hanyecz", "Laszlo Hanyecz", false], ["pizza", undefined, true]]);
});

test("v2 blocks explain what is wrong with them", () => {
  const problems = analyzeMontage(wrap(`
    <Screen from={1} to={5} url="github.com/bitcoin" at={4.5} />
    <Collage from={6} to={11} items={[{ query: "a", at: 6.5, label: "очень длинная подпись на полоске" }, { query: "b", at: 7 }, { query: "c", at: 8 }, { query: "d", at: 9 }]} />
    <Outro from={2} to={5} pose="dance" />`), 20).problems.join("\n");
  assert.match(problems, /url — полный адрес/);
  assert.match(problems, /at без find/);
  assert.match(problems, /items — 1–3/);
  assert.match(problems, /длиннее 18 знаков/);
  assert.match(problems, /концовка — в последних 12 секундах/);
  assert.match(problems, /pose — одна из поз/);
});

test("the ending never points at a button that sits elsewhere on another platform", () => {
  const problems = analyzeMontage(wrap(`<Outro from={17.5} to={20} title="ПОДПИШИСЬ" pose="point" />`), 20).problems.join(" | ");
  assert.match(problems, /персонаж машет/);
});

test("the soft palettes have their own page: a backdrop is sent back", () => {
  const code = wrap(`<Screen from={1} to={5} url="https://github.com/bitcoin/bitcoin" />`).replace('palette="cream"', 'palette="cream" backdrop="dark room"');
  assert.match(analyzeMontage(code, 10).problems.join("\n"), /backdrop убери/);
  assert.equal(PALETTES.cream.soft, true);
  assert.equal(PALETTES.night.soft, true);
});

test("graphic moves may carry their own sound", () => {
  const ok = analyzeMontage(wrap(`<Graphic from={1} to={5} html={\`<div class="ui-cursor c"></div>\`} motion={[{ at: 2, sel: ".c", to: { scale: 0.9 }, sfx: "click" }]} />`), 10);
  assert.deepEqual(ok.problems, []);
  const bad = analyzeMontage(wrap(`<Graphic from={1} to={5} html={\`<div class="c"></div>\`} motion={[{ at: 2, sel: ".c", to: { x: 9 }, sfx: "boom" }]} />`), 10);
  assert.match(bad.problems.join("\n"), /sfx у «\.c»/);
});

test("interface parts come with the palette, icons and the mascot", () => {
  const css = uiCss(PALETTES.night, file => `/x/${file}`);
  for (const part of [".ui-window", ".ui-phone", ".ui-input", ".ui-cursor", ".ui-toggle", ".ui-toast", ".ui-mark", ".ui-ring", ".i-wallet", ".ui-mascot.key", ".ui-iso", ".iso-box", ".iso-disc", ".iso-group", ".iso-tag"]) assert.ok(css.includes(part), part);
  assert.ok(css.includes("/x/astra-ui/mascot/point.png"));
});

test("only v2 learns the new blocks; its repairs know them too", () => {
  assert.equal(designGuide("legacy"), "");
  assert.ok(designGuide("craft-v1").includes(v2Kit()));
  assert.ok(repairSystemPrompt("craft-v1").includes("Screen"));
  assert.equal(repairSystemPrompt().includes("## Screen"), false);
});
