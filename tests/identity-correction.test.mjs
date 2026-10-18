import test from 'node:test';
import assert from 'node:assert/strict';
import {appendCandidates} from '../automation/quotes.mjs';
import {latestPerProduct} from '../scripts/dataset.mjs';
test('Ex-S correction hides only the incorrect automatic identity, never deletes history or verified rows',()=>{
 const source={bvid:'BV19FJX6QEpk',cid:'1234',page:1,title:'hg exs',sourceUid:'382486276',sourceAccount:'test',publishedAt:'2026-10-18T00:00:00Z',subtitleText:''};
 const old={id:'wrong',...source,videoUrl:'https://www.bilibili.com/video/BV19FJX6QEpk/',grade:'HG',modelName:'S高达',priceCents:10300,status:'extracted',extractionMethod:'local_auto_visual',observedAt:'2026-10-18T01:00:00Z',evidence:{text:'HGUC ExS高达 ¥103',page:1}};
 const h={records:[old],meta:{}};
 const c={bvid:source.bvid,page:1,sourceUid:source.sourceUid,currency:'CNY',priceCents:10300,issues:[],modelCandidates:[{grade:'HG',modelName:'Ex-S高达'}],channels:['visual'],evidence:{text:'HGUC ExS高达 ¥103',startSeconds:0,endSeconds:2}};
 const bundle={producer:'subbatch-local-auto-v1',schemaVersion:1,exportedAt:'2026-10-18T02:00:00Z',videos:[source]};
 const added=appendCandidates(h,[c],bundle);
 assert.deepEqual(added[0].correctsObservationIds,['wrong']);assert.equal(h.records.length,2);assert.equal(h.records[0],old);
 assert.deepEqual(latestPerProduct(h.records).map(r=>r.modelName),['Ex-S高达']);
 for(const change of [{status:'verified'},{bvid:'BV1junG67Eup'},{extractionMethod:'frame_review'}]){
  const changed=[{...old,...change},added[0]];
  assert.equal(latestPerProduct(changed).length,2);
 }
});
