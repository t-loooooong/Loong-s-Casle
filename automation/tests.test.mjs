import test from 'node:test';
import assert from 'node:assert/strict';
import { partsOf, day, due, videoRecord, visualTask, cleanBundle } from './extension/auto-core.mjs';
import { appendCandidates, validateBundle } from './quotes.mjs';
import { publishHistory } from './remote.mjs';
const info = { success:true,bvid:'BV1sKJ26WEFk',title:'HG测试',full_data:{owner:{mid:382486276,name:'test'},pubdate:1792069200,pages:[{cid:123,page:1,duration:20},{cid:456,page:2,duration:30}]} };
const video = videoRecord(info,partsOf(info)[0],{subtitleText:'1\n00:00:01,000 --> 00:00:02,000\nHG元祖100元',subtitleKind:'bilibili-ai',language:'ai-zh'});
const bundle = { schemaVersion:1,producer:'subbatch-local-auto-v1',videos:[video],exportedAt:'2026-10-16T00:00:00Z',collection:{ok:false} };
const candidate = { bvid:video.bvid,page:1,sourceUid:'382486276',priceCents:10000,priceType:'observed',currency:'CNY',issues:[],modelCandidates:[{grade:'HG',modelName:'元祖'}],evidence:{text:'HG元祖100元',startSeconds:1,endSeconds:2} };
test('discovery manifest preserves metadata but no transcript, signed media URL or credential',()=>{
 const task=visualTask(info,partsOf(info)[0]);
 const output=cleanBundle({videos:{},visualTasks:{one:{...task,cookie:'SECRET',videoStreamUrl:'SECRET'}},scanComplete:false});
 assert.equal(output.videos.length,0);assert.equal(output.visualTasks.length,1);assert.equal(output.visualTasks[0].cid,'123');
 assert.equal(output.visualTasks[0].subtitleText,undefined);assert.equal(JSON.stringify(output).includes('SECRET'),false);
 validateBundle(output);
 assert.throws(()=>validateBundle({...output,visualTasks:[{...task,sourceUid:'1'}]}));
});
test('Beijing date and daily catchup',()=>{assert.equal(day(new Date('2026-10-15T20:00Z')),'2026-10-16');assert.equal(due({},new Date('2026-10-16T00:16Z')),false);assert.equal(due({},new Date('2026-10-16T00:17Z')),true);assert.equal(due({paused:true},new Date('2026-10-16T09:17Z')),false);assert.equal(due({lastDay:'2026-10-16'},new Date('2026-10-16T09:17Z')),false);});
test('all parts and strict owner / exclusive / limits',()=>{assert.equal(partsOf(info).length,2);assert.throws(()=>partsOf({...info,full_data:{...info.full_data,owner:{mid:1}}}));assert.throws(()=>partsOf({...info,isChargeExclusive:true}));assert.throws(()=>partsOf({...info,full_data:{...info.full_data,pages:[]}}));});
test('sanitized export contains no hidden reply/cookie fields',()=>{let out=cleanBundle({videos:{a:{...video,cookie:'SECRET',audioUrl:'SECRET'}},cookie:'SECRET',scanComplete:false});assert.equal(JSON.stringify(out).includes('SECRET'),false);assert.equal(out.collection.ok,false);});
test('invalid sources rejected before public write',()=>{assert.throws(()=>validateBundle({...bundle,videos:[{...video,sourceUid:'1'}]}));assert.throws(()=>validateBundle({...bundle,producer:'unknown'}));});
test('unambiguous quotes at most extracted and idempotent',()=>{let h={records:[],meta:{lastSyncAt:null}};assert.equal(appendCandidates(h,[candidate],bundle).length,1);assert.equal(h.records[0].status,'extracted');assert.equal(appendCandidates(h,[candidate],bundle).length,0);assert.equal(h.meta.lastSyncAt,null);assert.equal(h.meta.localCollection.ok,false);});
test('ambiguous currency/implicit price must be pending/null',()=>{for(const issue of ['currency_needs_review','implicit_cny_unit','model_needs_review']){let h={records:[],meta:{}};appendCandidates(h,[{...candidate,issues:[issue]}],bundle);assert.equal(h.records[0].status,'pending');assert.equal(h.records[0].priceCents,null);}});
test('existing verified and title-crosschecked prices preserved',()=>{for(const status of ['verified','extracted']){let h={records:[{...candidate,...candidate.modelCandidates[0],status}],meta:{}};assert.equal(appendCandidates(h,[candidate],bundle).length,0);assert.equal(h.records.length,1);}});
test('unknown model is never invented from title and stays local',()=>{let h={records:[],meta:{}};appendCandidates(h,[{...candidate,modelCandidates:[],issues:['model_needs_review']}],bundle);assert.equal(h.records.length,0);});
test('title-gated spoken price can be extracted, never verified',()=>{let h={records:[],meta:{}};appendCandidates(h,[{...candidate,issues:['implicit_cny_unit'],modelMatch:{method:'title_catalog_alias'}}],bundle);assert.equal(h.records[0].status,'extracted');assert.equal(h.records[0].priceCents,10000);});
test('normal/channel/box prices kept separate, not overwritten by the lowest price',()=>{let h={records:[],meta:{}};let list=[candidate,{...candidate,priceCents:9900,priceLabel:'百亿（字幕原称）',evidence:{...candidate.evidence,startSeconds:3}},{...candidate,priceCents:9000,issues:['availability_or_payment_conditions']}];appendCandidates(h,list,bundle);assert.equal(h.records.length,1);assert.equal(h.records[0].priceCents,10000);assert.equal(h.records[0].alternativePrices[0].priceCents,9900);assert.match(h.records[0].notes,/条件不明/);});
test('conflicting direct quotes are pending instead of silently choosing one',()=>{let h={records:[],meta:{}};appendCandidates(h,[candidate,{...candidate,priceCents:9900}],bundle);assert.equal(h.records[0].status,'pending');assert.equal(h.records[0].priceCents,null);});
test('branch race retries against fresh history without force push',async()=>{
  let head='old', conflicts=0, history={records:[],meta:{}};
  const api=async(path,options={})=>{
    if(path==='/git/ref/heads/main')return{object:{sha:head}};
    if(path.startsWith('/git/commits/'))return{tree:{sha:'tree'}};
    if(path.startsWith('/contents/'))return{encoding:'base64',content:Buffer.from(JSON.stringify(history)).toString('base64')};
    if(path==='/git/trees'){let h=JSON.parse(options.body.tree[0].content);assert.equal(options.body.tree.length,1);assert.equal(options.body.tree[0].path,'data/history.json');return{sha:JSON.stringify(h)};}
    if(path==='/git/commits')return{sha:options.body.tree};
    if(path==='/git/refs/heads/main'){
      assert.equal(options.body.force,false);
      if(!conflicts++){head='new';history.records.push({id:'human-update'});let e=Error('race');e.status=422;throw e;}
      history=JSON.parse(options.body.sha);return{};
    }
    throw Error(path);
  };
  assert.equal(await publishHistory(api,h=>{h.records.push({id:'auto'});return 1;}),1);
  assert.deepEqual(history.records.map(r=>r.id),['human-update','auto']);
});
