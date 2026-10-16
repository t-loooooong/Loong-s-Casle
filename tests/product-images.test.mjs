import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile}from'node:fs/promises';
import {attachProductImages}from'../scripts/product-images.mjs';
const catalog=JSON.parse(await readFile(new URL('../config/product-images.json',import.meta.url),'utf8'));
const record={id:'price-test',grade:'HG',modelName:'柯西高达',scale:'1/144',priceCents:24700,status:'verified'};
test('expanded catalog retains explicit sources and unresolved models',()=>{assert.equal(catalog.products.length,32);assert.equal(catalog.unresolved.length,8);assert.ok(catalog.products.every(p=>p.image.sourceUrl&&p.image.credit));});
test('image attachment is presentation-only and does not mutate quotes',()=>{
  const original=structuredClone(record),[result]=attachProductImages([record],catalog.products);
  assert.deepEqual(record,original);assert.equal(result.priceCents,24700);assert.equal(result.status,'verified');
  assert.equal(result.productImage.productId,'hguc-xi-gundam-2021');assert.match(result.productImage.sourceUrl,/bandaispirits/);
});
test('different grades/scales/unknown models never get a guessed image',()=>{
  for(const changed of [{grade:'RG'},{scale:'1/100'},{modelName:'柯西高达透明版'},{modelName:'BC元祖'}])assert.equal(attachProductImages([{...record,...changed}],catalog.products)[0].productImage,undefined);
});
test('reviewed catalog can fill missing scale without changing quote scale',()=>{
  const source={...record,scale:null},[result]=attachProductImages([source],catalog.products);
  assert.equal(result.scale,null);assert.ok(result.productImage);
});
test('missing scale never chooses between multiple matching scales',()=>{
  const p=catalog.products[0], variants=[{...p,allowUnknownScale:true},{...p,id:'another-scale',scale:'1/100',allowUnknownScale:true}];
  assert.equal(attachProductImages([{...record,scale:null}],variants)[0].productImage,undefined);
});
test('unapproved sources and duplicate model mappings fail build',()=>{
  const item=catalog.products[0];
  assert.throws(()=>attachProductImages([record],[{...item,image:{...item.image,url:'javascript:alert(1)'}}]));
  assert.throws(()=>attachProductImages([record],[item,item]));
});
