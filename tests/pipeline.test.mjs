import test from "node:test";
import assert from "node:assert/strict";
import { parseMentions, findPrices, extractArchive, toRecords } from "../scripts/extract.mjs";
import { mergeHistory, latestPerVideo, validateRecords } from "../scripts/dataset.mjs";
import { fetchFeed } from "../scripts/collect.mjs";

const account = { uid: "382486276", name: "郭大鑫鑫鑫鑫呀" };
const now = "2026-10-15T00:17:00Z";
const video = { bvid: "BV1CVdmB5E8P", sourceUid: account.uid, title: "HG柯西 券后247元", description: "", publishedAt: now };
const quote = () => toRecords(video, account, now)[0];
const archive = (bvid = video.bvid) => ({ modules: { module_author: { mid: account.uid, pub_ts: 1760000000 }, module_dynamic: { major: { archive: { bvid, title: video.title, desc: "" } } } } });
const ok = (items, has_more = 0, offset = "") => ({ ok: true, json: async () => ({ code: 0, data: { items, has_more, offset } }) });

test("grades do not overlap and full-width text is supported", () => {
  assert.deepEqual(parseMentions("ＭＧＳＤ命运、hg强人背包背刺、RE100夜莺"), [{ grade: "MGSD", modelName: "命运" }, { grade: "HG", modelName: "强人背包" }, { grade: "RE/100", modelName: "夜莺" }]);
});
test("CNY prices parse without turning scales into prices", () => {
  assert.deepEqual(findPrices("1/144 ￥247.50"), [24750]);
  assert.deepEqual(findPrices("HG柯西 1/144"), []);
  assert.deepEqual(findPrices("247元 / ¥247"), [24700]);
});
test("ranges, overseas currencies, and threshold discounts remain unknown", () => {
  for (const s of ["200-300元", "200至300元", "满300减50元", "5000日元", "USD 100元"]) assert.deepEqual(findPrices(s), []);
});
test("single explicit quote is extracted, never automatically verified", () => {
  assert.equal(quote().priceCents, 24700);
  assert.equal(quote().status, "extracted");
  validateRecords([quote()]);
});
test("multiple models, inherited grade lists, or multiple prices stay pending", () => {
  for (const title of ["HG柯西、RG海牛 247元", "HG柯西、海牛 247元", "HG柯西 原价300元 券后247元"]) {
    const records = toRecords({ ...video, title }, account, now);
    assert.ok(records.length);
    assert.ok(records.every(r => r.priceCents === null && r.status === "pending"));
  }
});
test("same price on a new video is a new historical observation", () => {
  const a = quote();
  const b = { ...a, bvid: "BV16aei6dEQN", videoUrl: "https://www.bilibili.com/video/BV16aei6dEQN/" };
  assert.equal(mergeHistory([a], [b]).length, 2);
});
test("unchanged daily scan does not duplicate observations", () => {
  assert.equal(mergeHistory([quote()], [{ ...quote(), observedAt: "2026-10-16T00:17:00Z" }]).length, 1);
});
test("changed price is appended; latest view selects the new price", () => {
  const records = mergeHistory([quote()], [{ ...quote(), observedAt: "2026-10-16T00:17:00Z", priceCents: 24000 }]);
  assert.equal(records.length, 2);
  assert.equal(records[0].priceCents, 24700);
  assert.equal(latestPerVideo(records)[0].priceCents, 24000);
});
test("manual verification and known prices survive a weaker parse", () => {
  const old = { ...quote(), status: "verified" };
  assert.deepEqual(mergeHistory([old], [{ ...quote(), priceCents: 24000 }]), [old]);
  assert.equal(mergeHistory([quote()], [{ ...quote(), priceCents: null, status: "pending" }]).length, 1);
});
test("malformed records and non-Bilibili URLs cannot be published", () => {
  assert.throws(() => validateRecords([{ ...quote(), priceCents: -10 }]));
  assert.throws(() => validateRecords([{ ...quote(), videoUrl: "javascript:alert(1)" }]));
  assert.throws(() => validateRecords([quote(), quote()]));
});
test("reposts, different authors, and invalid timestamps are ignored", () => {
  assert.equal(extractArchive({}, account.uid), null);
  const item = archive();
  item.modules.module_author.mid = "123";
  assert.equal(extractArchive(item, account.uid), null);
  item.modules.module_author.mid = account.uid;
  item.modules.module_author.pub_ts = 0;
  assert.equal(extractArchive(item, account.uid), null);
});
test("collector follows offset and deduplicates sticky videos", async () => {
  let calls = 0;
  const result = await fetchFeed(account, { maxPagesPerAccount: 5, requestDelayMs: 0 }, new Map(), async url => {
    calls++;
    if (calls === 1) return ok([archive()], 1, "page2");
    assert.equal(url.searchParams.get("offset"), "page2");
    return ok([archive(), archive("BV16aei6dEQN")]);
  });
  assert.equal(result.pages, 2);
  assert.equal(result.videos.length, 2);
});
test("risk control responses fail instead of reporting an empty successful run", async () => {
  await assert.rejects(fetchFeed(account, { maxPagesPerAccount: 5 }, new Map(), async () => ({ ok: true, json: async () => ({ code: -352 }) })), /-352/);
});
test("stalled pagination fails; page limit is reported as partial coverage", async () => {
  await assert.rejects(fetchFeed(account, { maxPagesPerAccount: 5 }, new Map(), async () => ok([], 1, "")), /stalled/);
  const result = await fetchFeed(account, { maxPagesPerAccount: 1 }, new Map(), async () => ok([archive()], 1, "next"));
  assert.equal(result.coverage, "recent_window_only");
});
