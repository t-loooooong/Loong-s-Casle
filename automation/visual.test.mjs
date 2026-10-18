import test from'node:test';
import assert from'node:assert/strict';
import{mkdtemp,rm,readFile}from'node:fs/promises';
import{join,dirname}from'node:path';
import{fileURLToPath}from'node:url';
import{fuseCandidates}from'./fusion.mjs';
import{appendCandidates}from'./quotes.mjs';
import{collectVisual,publicVideo}from'./visual.mjs';
const video={bvid:'BV19FJX6QEpk',cid:'42780396563',page:1,title:'re维基纳降价',sourceUid:'382486276',sourceAccount:'test',publishedAt:'2026-10-16T02:25:59.000Z',subtitleText:'维基纳154元',subtitleKind:'bilibili',language:'zh-CN'};
const bundle={schemaVersion:1,producer:'subbatch-local-auto-v1',exportedAt:'2026-10-16T03:00:00Z',videos:[video],collection:{ok:true}};
const sub={bvid:video.bvid,page:1,sourceUid:video.sourceUid,priceCents:15400,currency:'CNY',priceType:'observed',issues:[],modelCandidates:[{grade:'RE/100',modelName:'维基纳'}],modelMatch:{method:'title_catalog_alias'},evidence:{text:'维基纳154元',startSeconds:2,endSeconds:4}};
const pic={...sub,channels:['visual'],priceLabel:'画面拼单价',modelMatch:{method:'screen_title_catalog'},evidence:{text:'万代RE/100维基纳 | ¥154',startSeconds:1,endSeconds:4,visualFrames:[{file:'frame-0001.jpg',seconds:1},{file:'frame-0004.jpg',seconds:4}]}};
test('matching timed visual and subtitle evidence becomes extracted, never human verified',()=>{
 const fused=fuseCandidates([sub],[pic]);assert.equal(fused.length,1);assert.deepEqual(fused[0].channels,['subtitle','visual']);
 const history={records:[],meta:{}};appendCandidates(history,fused,bundle,{observedAt:'2026-10-18T00:00:00Z',visualSummary:{status:'complete',checkedParts:1,totalParts:1}});
 assert.equal(history.records[0].status,'extracted');assert.equal(history.records[0].extractionMethod,'local_auto_dual');assert.equal(history.records[0].evidence.visualFrames.length,2);assert.equal(history.meta.visualCollection.status,'complete');
 assert.equal(appendCandidates(history,fused,bundle).length,0);
});
test('time, model, part and grade boundaries prevent unrelated subtitle cross-checks',()=>{
 for(const change of [{page:2},{modelCandidates:[{grade:'HG',modelName:'维基纳'}]},{modelCandidates:[{grade:'RE/100',modelName:'其他'}]},{evidence:{...pic.evidence,startSeconds:20,endSeconds:22}}]){
  const result=fuseCandidates([sub],[{...pic,...change}]);assert.equal(result.length,2);assert.equal(result[1].modelMatch.method,'screen_title_catalog');
 }
});
test('conflict creates a pending observation while preserving the previously known amount and history',()=>{
 const history={records:[],meta:{}};appendCandidates(history,[sub],bundle);const old=structuredClone(history.records[0]);
 const fused=fuseCandidates([sub],[{...pic,priceCents:16000}]);assert.ok(fused[0].issues.includes('subtitle_screen_conflict'));
 appendCandidates(history,fused,bundle,{observedAt:'2026-10-18T00:00:00Z'});
 assert.equal(history.records.length,2);assert.deepEqual(history.records[0],old);assert.equal(history.records[1].priceCents,15400);assert.equal(history.records[1].status,'pending');assert.match(history.records[1].notes,/保留此前/);
});
test('verified quotes remain immutable even when OCR disagrees',()=>{
 const history={records:[{bvid:video.bvid,grade:'RE/100',modelName:'维基纳',status:'verified',priceCents:15400}],meta:{}};
 assert.equal(appendCandidates(history,fuseCandidates([sub],[{...pic,priceCents:17000}]),bundle).length,0);assert.equal(history.records.length,1);
});
test('single-frame, deposit, box condition and foreign currency candidates stay pending',()=>{
 for(const issue of ['single_frame_only','screen_conditions_need_review','currency_needs_review']){
  const history={records:[],meta:{}};appendCandidates(history,fuseCandidates([],[{...pic,issues:[issue]}]),bundle);assert.equal(history.records[0].status,'pending');assert.equal(history.records[0].priceCents,null);
 }
});
test('subtitle-only processing remains usable when the visual channel is blocked',()=>{
 const history={records:[],meta:{}};appendCandidates(history,fuseCandidates([sub],[]),bundle,{visualSummary:{status:'blocked',checkedParts:0,totalParts:1}});
 assert.equal(history.records[0].priceCents,15400);assert.equal(history.records[0].extractionMethod,'local_auto_subtitle');assert.equal(history.meta.visualCollection.status,'blocked');
});
test('separate shopping-channel prices remain alternatives rather than becoming OCR conflicts',()=>{
 const alternate={...sub,priceCents:15000,priceLabel:'百亿（字幕原称）'};
 const fused=fuseCandidates([sub,alternate],[pic]);const history={records:[],meta:{}};appendCandidates(history,fused,bundle);
 assert.equal(history.records[0].priceCents,15400);assert.equal(history.records[0].status,'extracted');assert.equal(history.records[0].alternativePrices[0].priceCents,15000);
});
test('public video fetch stops at a risk-control response, without credential headers or retries',async()=>{
 let calls=0;await assert.rejects(publicVideo(video,{fetchImpl:async(url,options)=>{calls++;assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);return new Response('',{status:412});}}),e=>e.blocked===true);
 assert.equal(calls,1);
});
test('owner mismatch and restricted downloads do not request a video stream',async()=>{
 for(const bad of [{owner:{mid:1}},{rights:{download:0}}]){
  let calls=0;await assert.rejects(publicVideo(video,{fetchImpl:async()=>{calls++;return new Response(JSON.stringify({code:0,data:{bvid:video.bvid,owner:{mid:382486276},pubdate:1792117559,rights:{download:1},pages:[],...bad}}));}}));assert.equal(calls,1);
 }
});
test('visual queue resumes across cycles without re-running completed OCR or starving remaining parts',async()=>{
 const root=await mkdtemp(join(dirname(fileURLToPath(import.meta.url)),'.visual-test-'));let calls=0;
 try{
  const many={...bundle,videos:[1,2,3].map(page=>({...video,page,cid:String(100+page)}))};
  const analyze=async()=>({ok:true,at:String(++calls),candidates:[],rejected:0});
  let result=await collectVisual(many,{root,catalog:'unused',budget:2,analyze,log(){}});assert.equal(result.summary.checkedParts,2);
  result=await collectVisual(many,{root,catalog:'unused',budget:2,analyze,log(){}});assert.equal(result.summary.checkedParts,3);assert.equal(result.summary.status,'complete');
  const third=await collectVisual(many,{root,catalog:'unused',budget:2,analyze,log(){}});assert.equal(calls,3);assert.equal(result.fingerprint,third.fingerprint);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('blocked OCR sets a low-frequency cooldown for the channel, while cached/remaining subtitles are unaffected',async()=>{
 const root=await mkdtemp(join(dirname(fileURLToPath(import.meta.url)),'.visual-test-'));let calls=0;
 try{
  const analyze=async()=>{calls++;const e=Error('risk control');e.blocked=true;throw e;};
  const first=await collectVisual(bundle,{root,catalog:'unused',analyze,log(){}});
  const second=await collectVisual(bundle,{root,catalog:'unused',analyze,log(){}});
  assert.equal(first.summary.status,'blocked');assert.equal(second.summary.status,'blocked');assert.equal(calls,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('the visual recognizer never changes Windows policy or exports ephemeral media addresses',async()=>{
 const source=await readFile(new URL('./ocr/recognize.ps1',import.meta.url),'utf8');assert.doesNotMatch(source,/Set-ExecutionPolicy|Bypass|Unblock-File|Set-Acl/);
});
test('discovery-only tasks allow OCR even if subtitle extraction failed, without a fake transcript',async()=>{
 const task={...video};delete task.subtitleText;
 const input={...bundle,videos:[],visualTasks:[task]};
 const root=await mkdtemp(join(dirname(fileURLToPath(import.meta.url)),'.visual-test-'));
 try{
  const result=await collectVisual(input,{root,catalog:'unused',analyze:async()=>({ok:true,at:'one',candidates:[pic]})});
  assert.equal(result.summary.totalParts,1);assert.equal(result.summary.checkedParts,1);
  const history={records:[],meta:{}};appendCandidates(history,fuseCandidates([],result.candidates),input);
  assert.equal(history.records[0].extractionMethod,'local_auto_visual');assert.equal(history.records[0].priceCents,15400);
 }finally{await rm(root,{recursive:true,force:true});}
});
