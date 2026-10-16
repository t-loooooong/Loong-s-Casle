import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyManual,validateManualBundle,validateManualStore,mergeManual,applyManual,publishManual,decodePhoto,scanManualUploads} from '../automation/manual.mjs';
import {mkdtemp,writeFile,utimes,rm,readFile,mkdir,copyFile,cp}from'node:fs/promises';
import {tmpdir}from'node:os';
import {join}from'node:path';
import {fileURLToPath}from'node:url';
import {spawnSync}from'node:child_process';
const id='12345678-1234-4123-8123-123456789abc',otherId='22345678-1234-4123-8123-123456789abc';
const product={modelName:'测试高达',grade:'RE',scale:'1/100',priceCents:19900,priceDate:'2026-10-16',sourceUrl:'https://example.com/product',notes:'手动填写，不冒充视频报价'};
const bundle={schemaVersion:1,producer:'gunpla-manual-v1',requestId:id,createdAt:'2026-10-16T00:00:00Z',action:'add-product',product,image:null};
// JPEG marker fixture: SOF0 dimensions and a scan. Real browser encoding is separately tested in the UI.
const photo={base64:Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,2,0,255,217]).toString('base64')};
test('manual packages are strictly validated and canonicalize RE without leaking extra fields',()=>{
  const clean=validateManualBundle({...bundle,token:'SECRET',product:{...product,cookie:'SECRET'}});
  assert.equal(clean.product.grade,'RE/100');assert.doesNotMatch(JSON.stringify(clean),/SECRET/);
  for(const change of [{producer:'unknown'},{requestId:'../../file'},{action:'delete'},{product:{...product,priceCents:-1}},{product:{...product,priceCents:0}},{product:{...product,priceCents:1.1}},{product:{...product,priceDate:'2026-02-30'}},{product:{...product,sourceUrl:'javascript:alert(1)'}},{product:{...product,sourceUrl:'https://user:pass@example.com'}},{product:{...product,grade:'FAKE'}}])assert.throws(()=>validateManualBundle({...bundle,...change}));
});
test('manual records persist separately, do not mutate quotes, and never become verified',()=>{
  const original=[{id:'video',grade:'HG',modelName:'其他',priceCents:12300,status:'extracted'}],copy=structuredClone(original);
  const {store}=mergeManual(emptyManual(),validateManualBundle(bundle),original),rows=applyManual(original,store);
  assert.deepEqual(original,copy);assert.equal(rows.length,2);assert.equal(rows[1].status,'manual');assert.equal(rows[1].priceCents,19900);assert.equal(rows[1].videoUrl,null);
  assert.equal(mergeManual(store,validateManualBundle(bundle),original).duplicate,true);
  assert.throws(()=>mergeManual(store,validateManualBundle({...bundle,requestId:otherId}),original),/已存在/);
});
test('empty price is allowed and does not create a pretend Bilibili identity',()=>{
  const {store}=mergeManual(emptyManual(),validateManualBundle({...bundle,product:{...product,priceCents:null}}));
  const [row]=applyManual([],store);assert.equal(row.priceCents,null);assert.equal(row.bvid,undefined);assert.equal(row.sourceUid,undefined);
});
test('image overrides apply only to exact name, grade and scale, leaving price/status intact',()=>{
  const history=[{grade:'RE/100',modelName:'测试高达',scale:'1/100',priceCents:100,status:'pending'},{grade:'HG',modelName:'测试高达',scale:'1/100'},{grade:'RE/100',modelName:'测试高达',scale:null}];
  const upload=validateManualBundle({...bundle,action:'set-image',target:product,image:photo});
  const {store}=mergeManual(emptyManual(),upload,history),rows=applyManual(history,store);
  assert.equal(rows[0].productImage.kind,'manual-upload');assert.equal(rows[0].priceCents,100);assert.equal(rows[0].status,'pending');assert.equal(rows[1].productImage,undefined);assert.equal(rows[2].productImage,undefined);
  assert.throws(()=>mergeManual(emptyManual(),upload,[]),/不存在/);
});
test('unsafe/traversal images, invalid sizes and SVG are rejected',()=>{
  const result=decodePhoto(photo);assert.match(result.url,/^\/uploads\/[a-f0-9]{64}\.jpg$/);
  for(const base64 of ['<svg/>',Buffer.from('<svg onload="bad"/>').toString('base64'),'A'.repeat(1400004)])assert.throws(()=>decodePhoto({base64}));
  const oversized=Buffer.from(photo.base64,'base64');oversized.writeUInt16BE(1700,7);assert.throws(()=>decodePhoto({base64:oversized.toString('base64')}));
  assert.throws(()=>validateManualStore({...emptyManual(),images:[{...product,url:'/uploads/../secret'}]}));
});
test('manual publication retries a race and changes only manual data and hashed JPEG assets',async()=>{
  let head='old',store=emptyManual(),races=0,treeContent,allPaths=[],writes=0;
  const api=async(path,options={})=>{
    if(path==='/git/ref/heads/main')return{object:{sha:head}};
    if(path.startsWith('/git/commits/'))return{tree:{sha:'tree'}};
    if(path.startsWith('/contents/data/manual-products.json'))return{encoding:'base64',content:Buffer.from(JSON.stringify(store)).toString('base64')};
    if(path.startsWith('/contents/data/history.json'))return{encoding:'base64',content:Buffer.from('{"records":[]}').toString('base64')};
    if(path==='/git/blobs'){assert.equal(options.body.encoding,'base64');return{sha:'image'};}
    if(path==='/git/trees'){allPaths.push(...options.body.tree.map(x=>x.path));treeContent=JSON.parse(options.body.tree[0].content);return{sha:'new-tree'};}
    if(path==='/git/commits')return{sha:'new-commit'};
    if(path==='/git/refs/heads/main'){
      assert.equal(options.body.force,false);writes++;
      if(!races++){head='new';store.receipts.push(otherId);const error=Error('race');error.status=422;throw error;}
      store=treeContent;return{};
    }
    throw Error(path);
  };
  await publishManual(api,{...bundle,image:photo});
  assert.deepEqual(store.receipts,[otherId,id]);assert.equal(writes,2);
  assert.ok(allPaths.every(path=>path==='data/manual-products.json'||/^uploads\/[a-f0-9]{64}\.jpg$/.test(path)));
  assert.equal((await publishManual(api,{...bundle,image:photo})).duplicate,true);assert.equal(writes,2);
});
test('download watcher rejects arbitrary data, publishes a package once, and isolates failures',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'gunpla-manual-'));let pushes=0;
  try{
    const good=join(directory,`manual-${id}.json`),bad=join(directory,`manual-${otherId}.json`);
    await writeFile(good,JSON.stringify(bundle));await writeFile(bad,'not json');
    await utimes(good,new Date(0),new Date(0));await utimes(bad,new Date(0),new Date(0));
    const api=async(path,options={})=>{
      if(path==='/git/ref/heads/main')return{object:{sha:'head'}};
      if(path.startsWith('/git/commits/'))return{tree:{sha:'tree'}};
      if(path.startsWith('/contents/data/manual-products')){const e=Error('missing');e.status=404;throw e;}
      if(path.startsWith('/contents/data/history'))return{encoding:'base64',content:Buffer.from('{"records":[]}').toString('base64')};
      if(path==='/git/trees')return{sha:'tree'};
      if(path==='/git/commits')return{sha:'commit'};
      if(path==='/git/refs/heads/main'){pushes++;return{};}
      throw Error(path);
    };
    const processed={},logs=[];let saved=0;
    await scanManualUploads(directory,processed,api,async()=>saved++,message=>logs.push(message));
    await scanManualUploads(directory,processed,api,async()=>saved++,message=>logs.push(message));
    assert.equal(pushes,1);assert.equal(saved,1);assert.match(logs.join('\n'),/JSON 格式错误/);assert.match(logs.join('\n'),/已推送/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('build copies only manual image paths and never bundles local credentials',async()=>{
  const source=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');
  assert.match(source,/imagePath\(url\)/);assert.match(source,/manual-ui\.js/);assert.doesNotMatch(source,/copyFile.*state|copyFile.*token/);
});

test('isolated static build includes uploaded asset and manual row without changing history',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'gunpla-manual-build-'));
  const root=fileURLToPath(new URL('../',import.meta.url));
  try{
    for(const name of ['scripts','config'])await cp(join(root,name),join(directory,name),{recursive:true});
    for(const name of ['data','uploads','automation'])await mkdir(join(directory,name));
    for(const name of ['index.html','styles.css','app.js','manual-ui.js','package.json','seed.json'])await copyFile(join(root,name),join(directory,name));
    const history=JSON.parse(await readFile(join(root,'seed.json'),'utf8'));
    const older={...history.records[0],id:'older-video',publishedAt:'2026-01-01T00:00:00Z',observedAt:'2026-10-17T00:00:00Z'};
    const newer={...history.records[0],id:'newer-video',bvid:'BV0000000001',videoUrl:'https://www.bilibili.com/video/BV0000000001/',publishedAt:'2026-10-16T00:00:00Z',observedAt:'2026-10-16T00:00:00Z',priceCents:null,status:'pending'};
    history.records=[older,newer];
    await writeFile(join(directory,'data/history.json'),JSON.stringify(history));
    await copyFile(join(root,'automation/manual.mjs'),join(directory,'automation/manual.mjs'));
    const {store}=mergeManual(emptyManual(),validateManualBundle({...bundle,image:photo}));
    const asset=decodePhoto(photo);
    await writeFile(join(directory,'data/manual-products.json'),JSON.stringify(store));
    await writeFile(join(directory,asset.path),Buffer.from(photo.base64,'base64'));
    const result=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:directory,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
    const prices=JSON.parse(await readFile(join(directory,'dist/data/prices.json'),'utf8'));
    const exportedHistory=JSON.parse(await readFile(join(directory,'dist/data/history.json'),'utf8'));
    const row=prices.records.find(row=>row.id===`manual:${id}`);
    assert.equal(row.modelName,'测试高达');assert.equal(row.productImage.url,asset.url);assert.equal(row.priceCents,19900);assert.equal(row.status,'manual');
    assert.deepEqual(prices.meta.manualReceipts,[id]);assert.ok(!exportedHistory.records.some(row=>row.manual));
    assert.deepEqual(exportedHistory,history);assert.equal(prices.records.filter(row=>!row.manual).length,1);
    assert.equal(prices.records.find(row=>!row.manual).id,'newer-video');assert.equal(prices.records.find(row=>!row.manual).priceCents,null);
    assert.equal(prices.meta.viewMode,'latest-per-product');assert.equal(prices.meta.hiddenOlderVideoRecords,1);
    assert.deepEqual(await readFile(join(directory,'dist',asset.path)),Buffer.from(photo.base64,'base64'));
  }finally{await rm(directory,{recursive:true,force:true});}
});
