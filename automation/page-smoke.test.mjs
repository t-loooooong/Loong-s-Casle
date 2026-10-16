import test from 'node:test';
import assert from 'node:assert/strict';
test('page integration: two parts, failed final export, persisted resume without retranscription', async () => {
  const original={chrome:globalThis.chrome,document:globalThis.document,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),interval:globalThis.setInterval};
  let stored={videos:{},done:{},paused:true}, downloads=0, contentCalls=0;
  const elements = Object.fromEntries(['status','run','pause','audio'].map(id=>['#'+id,{textContent:'',checked:true}]));
  const exported=[];
  globalThis.document={querySelector:id=>elements[id]};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(name,options,fn)=>fn({name})}}});
  globalThis.setInterval=()=>0;
  globalThis.chrome={
    storage:{local:{get:async()=>({gunplaAutoV1:structuredClone(stored)}),set:async data=>{stored=structuredClone(data.gunplaAutoV1);}}},
    runtime:{sendMessage:async message=>{
      if(message.action==='fetchUserVideoList')return{success:true,data:{medias:[{bvid:'BV1sKJ26WEFk',created:Date.now()/1000}],page:{count:1}}};
      if(message.action==='fetchBilibiliInfo')return{success:true,bvid:'BV1sKJ26WEFk',title:'HG测试',aid:1,full_data:{pubdate:Math.floor(Date.now()/1000),owner:{mid:382486276,name:'test'},pages:[{cid:1,page:1,duration:10},{cid:2,page:2,duration:20}]}};
      if(message.action==='gunplaAutoTracks')return{success:true,subtitleTracks:[{lan:'ai-zh'}]};
      if(message.action==='gunplaAutoContent'){contentCalls++;return{success:true,subtitleText:'1\n00:00:01,000 --> 00:00:02,000\nHG元祖100元'};}
      throw Error(message.action);
    }},
    downloads:{download:async options=>{downloads++;exported.push(await(await fetch(options.url)).json());return downloads;},search:async({id})=>[{state:id===3?'interrupted':'complete'}]}
  };
  try {
    await import(`./extension/auto-page.js?test=${Date.now()}`);
    await elements['#run'].onclick();
    assert.equal(contentCalls,2);assert.equal(Object.keys(stored.done).length,2);
    assert.equal(stored.lastSuccessAt,undefined);assert.equal(stored.paused,true);assert.equal(exported.at(-1).collection.ok,false);
    await elements['#run'].onclick();
    assert.equal(contentCalls,2);assert.equal(stored.scanComplete,true);assert.ok(stored.lastSuccessAt);
    assert.equal(exported.at(-1).collection.ok,true);assert.equal(exported.at(-1).videos.length,2);
  } finally {
    globalThis.chrome=original.chrome;globalThis.document=original.document;globalThis.setInterval=original.interval;
    if(original.navigator)Object.defineProperty(globalThis,'navigator',original.navigator);else delete globalThis.navigator;
  }
});
