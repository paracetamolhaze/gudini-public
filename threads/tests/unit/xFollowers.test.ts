import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { parseFollowerCount, readProfileFollowers } from "../../src/x/browser/followers.js";
import { XLayoutChanged } from "../../src/x/browser/pages.js";
import { XBrowserClient } from "../../src/x/browser/client.js";

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function profileFixture(html: string, username = "Owner") {
  const page = await browser.newPage();
  await page.route("https://x.com/**", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
  await page.goto(`https://x.com/${username}`);
  return page;
}

test("follower numbers distinguish full integers, locale abbreviations, and absent counters", () => {
  for (const text of ["1,234 Followers", "1 234 читателя", "1\u202f234 подписчика", "1.234 Followers"]) {
    assert.deepEqual(parseFollowerCount(text), { followers: 1234, approximate: false }, text);
  }
  assert.deepEqual(parseFollowerCount("0 Followers"), { followers: 0, approximate: false });
  assert.deepEqual(parseFollowerCount("1,5 тыс. читателей"), { followers: 1500, approximate: true });
  assert.deepEqual(parseFollowerCount("1.2M Followers"), { followers: 1_200_000, approximate: true });
  assert.deepEqual(parseFollowerCount("2 млн подписчиков"), { followers: 2_000_000, approximate: true });
  for (const text of ["Followers", "", "-1 Followers", "1,23 Followers", "NaN", "1e3", "12 following"]) assert.equal(parseFollowerCount(text), null, text);
});

test("own profile exact tooltip wins over compact label and other accounts, feed, and sidebar are ignored", async t => {
  const page = await profileFixture(`
    <main><div data-testid="primaryColumn">
      <a href="/Other/followers" title="99999">99.9K Followers</a>
      <article><a href="/Owner/followers" title="88888">88.8K Followers</a></article>
      <div data-testid="UserCell"><a href="/Owner/followers" title="77777">77.7K Followers</a></div>
      <a href="https://evil.example/Owner/followers" title="66666">66.6K Followers</a>
      <a href="/owner/verified_followers"><span title="1,234">1.2K</span> Followers</a>
    </div><aside><a href="/Owner/followers" title="55555">55.5K Followers</a></aside></main>
  `);
  t.after(() => page.close());
  assert.deepEqual(await readProfileFollowers(page, "OWNER"), { followers: 1234, approximate: false });
});

test("an exact child title takes priority over rounded tooltip and visible text", async t => {
  const page = await profileFixture('<main><a href="https://x.com/Owner/followers" title="1.2K"><span title="1,249">1.2K</span> Followers</a></main>');
  t.after(() => page.close());
  assert.deepEqual(await readProfileFollowers(page, "Owner"), { followers: 1249, approximate: false });
});

test("localized compact labels remain approximate when X provides no full integer", async t => {
  const page = await profileFixture('<main><a href="/Owner/verified_followers">1,5 тыс. читателей</a></main>');
  t.after(() => page.close());
  assert.deepEqual(await readProfileFollowers(page, "Owner"), { followers: 1500, approximate: true });
});

test("a displayed zero follower count is valid", async t => {
  const page = await profileFixture('<main><a href="/Owner/followers">0 Followers</a></main>');
  t.after(() => page.close());
  assert.deepEqual(await readProfileFollowers(page, "Owner"), { followers: 0, approximate: false });
});

test("a profile link that mounts before its count waits for the counter to paint", async t => {
  const page = await profileFixture('<main><a href="/Owner/followers">Followers</a></main>');
  t.after(() => page.close());
  await page.evaluate(() => {
    setTimeout(() => { document.querySelector("a")!.textContent = "123 Followers"; }, 100);
  });
  assert.deepEqual(await readProfileFollowers(page, "Owner"), { followers: 123, approximate: false });
});

test("another profile page is rejected even if it includes a link to the owner's followers", async t => {
  const page = await profileFixture('<main><a href="/Owner/followers">123 Followers</a></main>', "Other");
  t.after(() => page.close());
  await assert.rejects(readProfileFollowers(page, "Owner"), XLayoutChanged);
});

test("missing, unreadable, and contradictory owner counts fail closed", async t => {
  for (const html of [
    '<main><a href="/Other/followers">999 Followers</a><article><a href="/Owner/followers">888 Followers</a></article></main>',
    '<main><a href="/Owner/followers">Followers</a></main>',
    '<main><a href="/Owner/followers" title="100">100 Followers</a><a href="/Owner/verified_followers" title="20">20 Followers</a></main>',
  ]) {
    const page = await profileFixture(html);
    t.after(() => page.close());
    await assert.rejects(readProfileFollowers(page, "Owner", { timeoutMs: 50 }), XLayoutChanged);
  }
});

test("browser client requests followers without an account supplied by the caller", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const client = new XBrowserClient("http://container", "test", async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ username: "Owner", followers: 1234, approximate: false }), { headers: { "content-type": "application/json" } });
  });
  assert.deepEqual(await client.followers(), { username: "Owner", followers: 1234, approximate: false });
  assert.deepEqual(calls, [{ url: "http://container/followers", body: {} }]);
});
