import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,utimes} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {cleanupPublished} from './cleanup.mjs';
test('cleanup only published successful evidence and completed bundle, retains retry, manual and compact state',async()=>{
 const root=await mkdtemp(resolve(dirname(fileURLToPath(import.meta.url)),'.cleanup-test-'));
 try{
  const state=resolve(root,'state'),watch=resolve(root,'watch'),key='a'.repeat(24),other='b'.repeat(24),failed='c'.repeat(24);
  await mkdir(watch);await mkdir(resolve(state,'visual',key),{recursive:true});
  for(const [name,ok] of [[key,true],[other,true],[failed,false]]){
   const dir=resolve(state,'visual',name);await mkdir(dir,{recursive:true});
   await writeFile(resolve(dir,'result.json'),JSON.stringify({ok,candidates:[]}));
   await writeFile(resolve(dir,'frame-0001.jpg'),'test');await writeFile(resolve(dir,'unrelated.jpg'),'keep');
   await mkdir(resolve(dir,'frames'));await writeFile(resolve(dir,'frames','frame-0001.jpg'),'test');await writeFile(resolve(dir,'frames','unrelated.jpg'),'keep');
  }
  const name='bundle-123-test.json',raw='{"videos":[]}',input=resolve(watch,name);
  await writeFile(input,raw);await utimes(input,new Date(0),new Date(0));
  await writeFile(resolve(watch,'manual-test.json'),'keep');
  const hash=createHash('sha256').update(raw).update('test').digest('hex'),processed={[hash+':visual']:'published'};
  const options={state,watch,processed,parserRevision:'test',currentName:name,publishedVisualKeys:[key,failed]};
  assert.equal(await cleanupPublished(options),2);
  await assert.rejects(readFile(resolve(state,'visual',key,'frames','frame-0001.jpg')),{code:'ENOENT'});
  assert.equal(await readFile(resolve(state,'visual',key,'frames','unrelated.jpg'),'utf8'),'keep');
  assert.equal(await readFile(input,'utf8'),raw);
  for(const k of [other,failed])assert.equal(await readFile(resolve(state,'visual',k,'frame-0001.jpg'),'utf8'),'test');
  assert.equal(await cleanupPublished({...options,currentComplete:true}),1);
  await assert.rejects(readFile(input),{code:'ENOENT'});
  assert.equal(await readFile(resolve(watch,'manual-test.json'),'utf8'),'keep');
  assert.equal(JSON.parse(await readFile(resolve(state,'visual',key,'result.json'))).ok,true);
  assert.equal(await cleanupPublished({...options,currentComplete:true}),0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('older packages are removed only when a published snapshot contains identical payloads',async()=>{
 const root=await mkdtemp(resolve(dirname(fileURLToPath(import.meta.url)),'.cleanup-test-'));
 try{
  const state=resolve(root,'state'),watch=resolve(root,'watch');await mkdir(state);await mkdir(watch);
  const currentName='bundle-999-new.json',video={bvid:'BV19FJX6QEpk',subtitleText:'154元'};
  const base={producer:'subbatch-local-auto-v1',schemaVersion:1,videos:[video],visualTasks:[]};
  const raw=JSON.stringify(base),hash=createHash('sha256').update(raw).update('test').digest('hex');
  for(const [name,data] of [[currentName,base],['bundle-111-old.json',base],['bundle-222-different.json',{...base,videos:[{...video,subtitleText:'different'}]}]]){
   const path=resolve(watch,name);await writeFile(path,JSON.stringify(data));await utimes(path,new Date(0),new Date(0));
  }
  const options={state,watch,parserRevision:'test',currentName,processed:{}};
  assert.equal(await cleanupPublished(options),0);
  options.processed[hash+':cached']='published';assert.equal(await cleanupPublished(options),1);
  await assert.rejects(readFile(resolve(watch,'bundle-111-old.json')),{code:'ENOENT'});
  assert.ok(await readFile(resolve(watch,currentName)));assert.ok(await readFile(resolve(watch,'bundle-222-different.json')));
 }finally{await rm(root,{recursive:true,force:true});}
});
