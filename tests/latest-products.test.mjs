import test from 'node:test';
import assert from 'node:assert/strict';
import {latestPerProduct}from'../scripts/dataset.mjs';
const quote={id:'old',sourceUid:'382486276',bvid:'BV1CVdmB5E8P',grade:'MG',modelName:'空降百式',scale:null,publishedAt:'2026-10-13T12:00:00Z',observedAt:'2026-10-16T02:00:00Z',priceCents:17800,status:'verified',videoTitle:'旧视频'};
const recent={...quote,id:'new',bvid:'BV16aei6dEQN',publishedAt:'2026-10-15T12:00:00Z',observedAt:'2026-10-15T13:00:00Z',priceCents:17000,status:'extracted',videoTitle:'新视频'};

test('one row per product across videos, retaining products not mentioned in the newest video',()=>{
  const other={...quote,id:'other',modelName:'路西法',grade:'HG'};
  const input=[recent,quote,other],snapshot=structuredClone(input);
  const rows=latestPerProduct(input);
  assert.deepEqual(rows.map(row=>row.id),['new','other']);
  assert.equal(rows[0].priceCents,17000);assert.equal(rows[0].bvid,recent.bvid);
  assert.deepEqual(input,snapshot);
});
test('publication date wins over verification, price, import time and input order',()=>{
  const old={...quote,observedAt:'2027-01-01T00:00:00Z',priceCents:1};
  for(const input of [[old,recent],[recent,old]])assert.equal(latestPerProduct(input)[0].id,'new');
});
test('latest unknown price does not silently inherit the old video price or status',()=>{
  const rows=latestPerProduct([quote,{...recent,priceCents:null,status:'pending'}]);
  assert.equal(rows.length,1);assert.equal(rows[0].priceCents,null);assert.equal(rows[0].status,'pending');
});
test('same-video observations choose the most recent timestamp, not array order',()=>{
  const updated={...quote,id:'updated',observedAt:'2026-10-17T00:00:00Z',priceCents:19000};
  for(const input of [[quote,updated],[updated,quote]])assert.equal(latestPerProduct(input)[0].id,'updated');
});
test('different grades, explicit scales and named variants remain separate',()=>{
  for(const changed of [{grade:'HG'},{scale:'1/100'},{modelName:'空降百式透明版'}]){
    const original={...quote,scale:'1/144'};
    assert.equal(latestPerProduct([original,{...recent,scale:'1/144',...changed}]).length,2);
  }
});
test('RE aliases, fullwidth letters, letter case and surrounding whitespace share identity',()=>{
  const old={...quote,grade:'RE/100',modelName:' 月光Ｘ '};
  const next={...recent,grade:'RE',modelName:'月光x'};
  assert.equal(latestPerProduct([old,next]).length,1);assert.equal(latestPerProduct([old,next])[0].id,'new');
});
test('unknown scale joins a unique known scale without rewriting evidence or assuming a second scale',()=>{
  const known={...quote,scale:'1/100'},unknown={...recent,scale:null};
  let rows=latestPerProduct([known,unknown]);assert.equal(rows.length,1);assert.equal(rows[0].scale,null);
  rows=latestPerProduct([known,unknown,{...quote,id:'other-scale',scale:'1/144'}]);assert.equal(rows.length,3);
});
test('manual-only products remain; a video takes precedence without deleting the manual record',()=>{
  const manual={...quote,id:'manual',manual:true,publishedAt:'2027-01-01T00:00:00Z'};
  assert.equal(latestPerProduct([manual])[0].id,'manual');
  assert.equal(latestPerProduct([manual,recent])[0].id,'new');assert.equal(manual.id,'manual');
});
test('a manual product with a second scale prevents an unknown-scale video from being incorrectly merged',()=>{
  const input=[quote,{...recent,id:'known',scale:'1/100'},{...quote,id:'manual-scale',manual:true,scale:'1/144'}];
  assert.equal(latestPerProduct(input).length,3);
});
test('empty or invalid dates are ranked last and exact ties are stable',()=>{
  assert.deepEqual(latestPerProduct([]),[]);
  assert.equal(latestPerProduct([{...quote,publishedAt:null},recent])[0].id,'new');
  assert.equal(latestPerProduct([quote,{...quote,id:'tie'}])[0].id,'old');
});
