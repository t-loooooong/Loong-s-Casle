import test from'node:test';import assert from'node:assert/strict';
import{parseOfficialCards,selectExactProduct,discoverProductImages,productIdentity,safeOfficialUrl,IMAGE_HOSTS}from'../scripts/official-product-search.mjs';
const card=(id,title)=>`<a href="/index/index/detail/id/${id}" class="c-card p-card -landscape"><div><img src="https://staticcdn.bandaihobbysite.cn/www/uploads/test-${id}.jpg" alt="${title}"></div></a>`;
const record={grade:'HG',modelName:'风灵高达',scale:null,priceCents:10000};
const html=card(123,'HG 1/144 风灵高达')+card(124,'MG 1/100 风灵高达')+card(125,'HG 1/144 风灵高达（透明版）');
test('official search cards preserve grade, scale and named variants',()=>{
  const cards=parseOfficialCards(html);assert.equal(cards.length,3);assert.equal(selectExactProduct(record,cards).sourceUrl,'https://bandaihobbysite.cn/index/index/detail/id/123');
  assert.equal(productIdentity('MGSD 命运高达').grade,'MGSD');assert.equal(productIdentity('HGBF 1/144 创制燃焰高达').grade,'HG');
});
test('same name with two exact versions cannot be auto-selected',()=>{
  assert.equal(selectExactProduct(record,parseOfficialCards(card(1,'HG 1/144 风灵高达')+card(2,'HG 1/144 风灵高达'))),null);
  assert.equal(selectExactProduct(record,parseOfficialCards(card(1,'MG 1/100 风灵高达'))),null);
  assert.equal(selectExactProduct(record,parseOfficialCards(card(1,'HG 1/144 风灵高达（透明版）'))),null);
});
test('new product receives a sourced image without touching price',async()=>{
  let requests=0;const source=structuredClone(record);
  const result=await discoverProductImages([record],{products:[]},{fetcher:async url=>{requests++;assert.match(url,/bandaihobbysite.cn\/item_all\?keyword=/);return{ok:true,text:async()=>html};}});
  assert.equal(requests,1);assert.equal(result.products.length,1);assert.equal(result.audit[0].status,'matched');assert.deepEqual(record,source);
});
test('network failures preserve records and return pending audit',async()=>{
  const result=await discoverProductImages([record],{products:[]},{fetcher:async()=>{throw Error('offline');}});
  assert.equal(result.products.length,0);assert.equal(result.audit[0].status,'source_unavailable');assert.equal(record.priceCents,10000);
});
test('explicit ambiguity and recent failed searches do not repeatedly hit source',async()=>{
  let requests=0;const fetcher=async()=>{requests++;throw Error('should not fetch');};
  await discoverProductImages([record],{products:[],unresolved:[{grade:'HG',modelName:'风灵高达'}]},{fetcher});
  await discoverProductImages([record],{products:[]},{fetcher,priorAttempts:{'["HG","风灵高达"]':new Date().toISOString()}});
  assert.equal(requests,0);
});
test('search budget and URL allowlist prevent unlimited or untrusted retrieval',async()=>{
  let requests=0;const result=await discoverProductImages([record,{...record,modelName:'其他新机'}],{products:[]},{maxSearches:1,fetcher:async()=>{requests++;return{ok:true,text:async()=>html};}});
  assert.equal(requests,1);assert.equal(result.audit.at(-1).status,'search_budget');
  assert.equal(safeOfficialUrl('https://bandai-a.akamaihd.net@evil.test/photo.jpg',IMAGE_HOSTS),false);
  assert.equal(safeOfficialUrl('http://staticcdn.bandaihobbysite.cn/p.jpg',IMAGE_HOSTS),false);
});
