import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
async function page(payload, fail = false) {
  const elements = new Map();
  const element = (key) => {
    if (!elements.has(key)) elements.set(key, { value: ["#grade", "#status"].includes(key) ? "all" : "", textContent: "", innerHTML: "", listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; }, setAttribute() {} });
    return elements.get(key);
  };
  let done;
  const loaded = new Promise(resolve => { done = resolve; });
  const context = vm.createContext({
    document: { querySelector: element }, Intl, Date, Set, console: { error() {} },
    fetch: async url => {
      assert.equal(url, "/data/prices.json");
      queueMicrotask(() => queueMicrotask(done));
      return { ok: !fail, status: fail ? 404 : 200, json: async () => payload };
    },
  });
  vm.runInContext(source, context);
  await loaded;
  await new Promise(resolve => setImmediate(resolve));
  return { element, render: () => vm.runInContext("render()", context) };
}
const records = [
  { modelName: "柯西高达", grade: "HG", priceCents: 24700, status: "verified", videoTitle: "测试视频", videoUrl: "https://www.bilibili.com/video/BV1CVdmB5E8P/" },
  { modelName: "海牛高达", grade: "RG", priceCents: 30000, status: "extracted", videoTitle: "另一个视频", videoUrl: "https://www.bilibili.com/video/BV16aei6dEQN/" },
];
test("static data loads and HG/search/status filters compose", async () => {
  const p = await page({ records, meta: {} });
  assert.equal(p.element("#metric-total").textContent, 2);
  assert.equal(p.element("#metric-verified").textContent, 1);
  p.element("#grade").value = "HG";
  p.element("#search").value = "柯西";
  p.element("#status").value = "verified";
  p.render();
  assert.match(p.element("#record-count").textContent, /1 \/ 2/);
  assert.ok(!p.element("#price-rows").innerHTML.includes("海牛高达"));
});
test("extracted quote is not displayed as manually verified", async () => {
  const p = await page({ records: [records[1]], meta: {} });
  assert.match(p.element("#price-rows").innerHTML, /自动提取/);
  assert.ok(!p.element("#price-rows").innerHTML.includes("已核对"));
});
test("initial data does not claim that automatic collection is already active", async () => {
  const p = await page({ records, meta: { lastSyncAt: null } });
  assert.match(p.element("#update-note").textContent, /尚无成功采集记录/);
});
test("failed collection is visible even if older prices exist", async () => {
  const p = await page({ records, meta: { lastSyncAt: "2026-10-10T00:17:00Z", check: { ok: false, lastAttemptAt: "2026-10-15T00:17:00Z" } } });
  assert.match(p.element("#update-note").textContent, /未完成.*保留旧数据/);
});
test("unavailable file shows an error instead of silently displaying seed prices", async () => {
  const p = await page(null, true);
  assert.equal(p.element("#update-note").textContent, "价格数据读取失败");
});
test("video title markup is escaped", async () => {
  const p = await page({ records: [{ ...records[0], videoTitle: '<img src=x onerror="alert(1)">' }], meta: {} });
  assert.match(p.element("#price-rows").innerHTML, /&lt;img/);
  assert.ok(!p.element("#price-rows").innerHTML.includes("<img"));
});
test("local progress is distinct from failed cloud collection", async () => {
  const p = await page({records,meta:{localCollection:{ok:false,attemptedAt:'2026-10-16T00:00Z',lastSuccessAt:null},lastLocalImportParts:3,check:{ok:false}}});
  assert.match(p.element('#update-note').textContent,/本次未完成.*3个分P.*云端接口采集仍失败/);
});
test("automated subtitle evidence is visible and escaped", async () => {
  const p = await page({records:[{...records[1],extractionMethod:'local_auto_subtitle',evidence:{page:2,startSeconds:15,text:'<script>bad</script>'}}],meta:{}});
  assert.match(p.element('#price-rows').innerHTML,/P2.*15.0秒/);
  assert.match(p.element('#price-rows').innerHTML,/&lt;script&gt;/);
});
