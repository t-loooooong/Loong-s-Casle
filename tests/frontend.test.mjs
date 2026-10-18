import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
async function page(payload, fail = false, savedWidths = null, storageThrows = false) {
  const elements = new Map();
  const element = (key) => {
    if (!elements.has(key)) elements.set(key, { value: ["#grade", "#status"].includes(key) ? "all" : "", textContent: "", innerHTML: "", style: {}, attributes: {}, classList: { add() {}, remove() {} }, listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; }, setAttribute(key, value) { this.attributes[key] = String(value); }, setPointerCapture() {} });
    return elements.get(key);
  };
  const columns = Array.from({ length: 6 }, (_, i) => element(`col${i}`));
  const handles = Array.from({ length: 6 }, (_, i) => element(`handle${i}`));
  let stored = savedWidths;
  let done;
  const loaded = new Promise(resolve => { done = resolve; });
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: selector => selector === "#price-table col" ? columns : handles }, Intl, Date, Set, URL, console: { error() {} },
    localStorage: { getItem() { if(storageThrows)throw new Error('blocked'); return stored; }, setItem(key,value) { if(storageThrows)throw new Error('blocked'); stored=value; } },
    fetch: async url => {
      assert.equal(url, "/data/prices.json");
      queueMicrotask(() => queueMicrotask(done));
      return { ok: !fail, status: fail ? 404 : 200, json: async () => payload };
    },
  });
  vm.runInContext(source, context);
  await loaded;
  await new Promise(resolve => setImmediate(resolve));
  return { element, columns, handles, stored: () => stored, render: () => vm.runInContext("render()", context), names: () => Array.from(vm.runInContext("state.filtered.map(item => item.modelName)", context)), rawGrades: () => Array.from(vm.runInContext("state.quotes.map(item => item.grade)", context)) };
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
test('product photo has alt, attribution and version disclaimer',async()=>{
  const photo={url:'https://bandai-a.akamaihd.net/bc/img/model/b/test.jpg',alt:'柯西高达',sourceUrl:'https://www.bandaispirits.co.jp/products/test',credit:'BANDAI',caption:'2021年版参考图，非卖家实拍',note:'报价版本以原视频为准'};
  const p=await page({records:[{...records[0],productImage:photo},records[1]],meta:{}});
  const html=p.element('#price-rows').innerHTML;
  assert.equal((html.match(/class="product-photo"/g)||[]).length,1);
  assert.match(html,/alt="柯西高达"/);assert.match(html,/2021年版参考图/);assert.match(html,/非卖家实拍/);
  assert.match(html,/loading="lazy"/);assert.equal(p.element('#metric-total').textContent,2);
});
test('failed image hides broken thumbnail without removing price row',async()=>{
  const p=await page({records,meta:{}});let classAdded;
  const target={classList:{contains:c=>c==='product-photo'},closest:()=>({classList:{add:c=>classAdded=c}})};
  p.element('#price-rows').listeners.error({target});assert.equal(target.hidden,true);assert.equal(classAdded,'image-unavailable');
  assert.match(p.element('#price-rows').innerHTML,/柯西高达/);
});
test('unsafe image URLs are ignored rather than rendered',async()=>{
  const p=await page({records:[{...records[0],productImage:{url:'javascript:alert(1)',sourceUrl:'https://www.bandaispirits.co.jp/test'}}],meta:{}});
  assert.ok(!p.element('#price-rows').innerHTML.includes('javascript:'));
});
test('missing images have a clear placeholder and do not claim a fake photo',async()=>{
  const p=await page({records,meta:{imageCoverage:{withImage:0,total:2}}});
  assert.match(p.element('#price-rows').innerHTML,/待配图/);assert.match(p.element('#price-rows').innerHTML,/型号或版本待确认/);assert.match(p.element('#update-note').textContent,/商品图 0\/2/);
});

test('RE/100 and RE share the RE badge and filter without rewriting source grades', async () => {
  const p=await page({records:[{...records[0],grade:'RE/100'}, {...records[1],grade:'RE'}]});
  assert.match(p.element('#grade').innerHTML, /value="RE">RE</);
  assert.doesNotMatch(p.element('#grade').innerHTML, /RE\/100/);
  p.element('#grade').value='RE';p.render();
  assert.equal(p.names().length,2);
  assert.doesNotMatch(p.element('#price-rows').innerHTML,/RE\/100/);
  assert.deepEqual(p.rawGrades(),['RE/100','RE']);
});

const sortableRecords = [
  {...records[0],modelName:'低价',priceCents:9000,publishedAt:'2025-12-31T23:00:00Z'},
  {...records[1],modelName:'高价',priceCents:100000,publishedAt:'2026-01-01T01:00:00Z'},
  {...records[0],modelName:'待提取',priceCents:null,publishedAt:null},
  {...records[0],modelName:'中价',priceCents:20000,publishedAt:'2026-01-01T00:00:00Z'},
];
test('price header toggles numeric order, keeping missing prices last',async()=>{
  const p=await page({records:sortableRecords});
  p.element('#sort-price').listeners.click();
  assert.deepEqual(p.names(),['低价','中价','高价','待提取']);
  assert.equal(p.element('#price-header').attributes['aria-sort'],'ascending');
  p.element('#sort-price').listeners.click();
  assert.deepEqual(p.names(),['高价','中价','低价','待提取']);
  assert.equal(p.element('#price-header').attributes['aria-sort'],'descending');
  assert.equal(p.element('#date-header').attributes['aria-sort'],'none');
  p.element('#grade').value='HG';p.render();
  assert.deepEqual(p.names(),['中价','低价','待提取']);
});
test('date sorting uses complete timestamps across years, missing/invalid dates last',async()=>{
  const p=await page({records:[...sortableRecords,{...records[0],modelName:'无效日期',publishedAt:'bad'}]});
  assert.deepEqual(p.names(),['高价','中价','低价','待提取','无效日期']);
  p.element('#sort-date').listeners.click();
  assert.deepEqual(p.names(),['低价','中价','高价','待提取','无效日期']);
  assert.equal(p.element('#date-header').attributes['aria-sort'],'ascending');
  p.element('#sort-date').listeners.click();
  assert.equal(p.names()[0],'高价');
});
test('equal prices retain their source order',async()=>{
  const p=await page({records:records.map(r=>({...r,priceCents:100}))});
  p.element('#sort-price').listeners.click();assert.deepEqual(p.names(),['柯西高达','海牛高达']);
  p.element('#sort-price').listeners.click();assert.deepEqual(p.names(),['柯西高达','海牛高达']);
});
test('drag resizes only the chosen column and persists on pointer release',async()=>{
  const p=await page({records});const handle=p.handles[2];
  handle.listeners.pointerdown({button:0,pointerId:1,clientX:100,preventDefault(){}});
  handle.listeners.pointermove({pointerId:2,clientX:500});
  assert.equal(p.columns[2].style.width,'190px');
  handle.listeners.pointermove({pointerId:1,clientX:180});
  assert.equal(p.columns[2].style.width,'270px');assert.equal(p.columns[1].style.width,'100px');
  assert.equal(p.element('#price-table').style.width,'1370px');
  handle.listeners.pointerup({pointerId:1});
  assert.equal(JSON.parse(p.stored())[2],270);
  const reloaded=await page({records},false,p.stored());assert.equal(reloaded.columns[2].style.width,'270px');
  reloaded.element('#reset-columns').listeners.click();assert.equal(reloaded.columns[2].style.width,'190px');
});
test('keyboard resizing is clamped and storage failures do not break data rendering',async()=>{
  const p=await page({records},false,null,true);const h=p.handles[0];
  const press=key=>h.listeners.keydown({key,preventDefault(){}});
  press('Home');assert.equal(p.columns[0].style.width,'250px');
  press('ArrowLeft');assert.equal(p.columns[0].style.width,'250px');
  press('ArrowRight');assert.equal(p.columns[0].style.width,'260px');
  press('End');press('ArrowRight');assert.equal(p.columns[0].style.width,'1200px');
  assert.equal(h.attributes['aria-valuenow'],'1200');assert.equal(p.names().length,2);
});
test('corrupt and outdated stored widths safely fall back to defaults',async()=>{
  for(const value of ['broken','[1,2]','[340,100,190,120,140,-1]','[340,100,"190",120,140,400]']){
    const p=await page({records},false,value);assert.equal(p.columns[2].style.width,'190px');assert.equal(p.columns[5].style.width,'400px');
  }
});

test('manual entries have honest provenance and uploaded photos are not labelled official',async()=>{
  const url='/uploads/'+'a'.repeat(64)+'.jpg';
  const p=await page({records:[{...records[0],id:'manual:test',manual:true,status:'manual',notes:'<script>unsafe</script>',videoUrl:null,sourceUrl:'javascript:alert(1)',productImage:{kind:'manual-upload',url,sourceUrl:url,alt:'上传图',caption:'站长上传参考图'}}]});
  const html=p.element('#price-rows').innerHTML;
  assert.match(html,/站长上传图/);assert.match(html,/站长手动添加 · 非视频采集/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/官方商品图|可信度|javascript:/);assert.equal(p.element('#metric-verified').textContent,0);
  p.element('#status').value='manual';p.render();assert.equal(p.names().length,1);
});
test('manual image flags do not allow arbitrary or protocol-relative image URLs',async()=>{
  for(const url of ['https://evil.example/image.jpg','//evil.example/a.jpg','/uploads/../evil.jpg']){
    const p=await page({records:[{...records[0],productImage:{kind:'manual-upload',url,sourceUrl:url}}]});
    assert.doesNotMatch(p.element('#price-rows').innerHTML,/class="product-photo"/);
  }
});
test('dual-channel evidence is explicit, escaped, and not labelled human verified',async()=>{
 const p=await page({records:[{...records[0],grade:'MB',status:'extracted',extractionMethod:'local_auto_dual',evidence:{page:1,startSeconds:6,text:'<b>screen 1314</b> | 字幕1314'}}],meta:{visualCollection:{status:'blocked',checkedParts:1,totalParts:3}}});
 assert.match(p.element('#price-rows').innerHTML,/字幕＋画面证据/);assert.match(p.element('#price-rows').innerHTML,/&lt;b&gt;/);assert.match(p.element('#price-rows').innerHTML,/截图保存在本机/);
 assert.match(p.element('#grade').innerHTML,/value="MB"/);assert.match(p.element('#update-note').textContent,/画面OCR 1\/3分P.*访问受限/);
 assert.equal(p.element('#metric-verified').textContent,0);
});
