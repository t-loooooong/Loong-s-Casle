import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile}from'node:fs/promises';
import vm from'node:vm';
const source=await readFile(new URL('../manual-ui.js',import.meta.url),'utf8');
function ui({cancel=false,fallback=false,storageThrows=false}={}){
  const elements=new Map(),saved=[],objects=[],storage=new Map();let pickers=0,draws=0;
  const element=key=>{
    if(!elements.has(key))elements.set(key,{value:'',hidden:false,disabled:false,textContent:'',files:[],listeners:{},options:[],addEventListener(type,fn){this.listeners[type]=fn;},removeAttribute(){},querySelectorAll(){return ['#manual-name','#manual-grade','#manual-scale','#manual-price','#manual-date','#manual-source','#manual-notes'].map(element);},reset(){for(const input of this.querySelectorAll())input.value='';element('#manual-grade').value='HG';},reportValidity(){return true;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},click(){this.clicked=true;}});
    return elements.get(key);
  };
  const state={meta:{},quotes:[]};
  const context=vm.createContext({document:{querySelector:element,createElement:tag=>tag==='canvas'?{getContext:()=>({fillRect(){},drawImage(){draws++;}}),toBlob(fn){fn(new Blob(['jpeg-bytes'],{type:'image/jpeg'}));}}:element('anchor')},state,els:{rows:element('#rows'),grade:element('#grade')},displayGrade:value=>value==='RE/100'?'RE':value,safeSource:value=>value.startsWith('https://')?value:null,setGrades(){},render(){},Intl,Date,Set,Blob,crypto:{randomUUID:()=> '12345678-1234-4123-8123-123456789abc'},URL:{createObjectURL(blob){objects.push(blob);return'blob:mock';},revokeObjectURL(){}},localStorage:{getItem(key){if(storageThrows)throw Error('blocked');return storage.get(key)||null;},setItem(key,value){if(storageThrows)throw Error('blocked');storage.set(key,value);}},setTimeout:()=>1,clearTimeout(){},createImageBitmap:async()=>({width:2400,height:1600,close(){}}),FileReader:class{readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result='data:image/jpeg;base64,'+Buffer.from(buffer).toString('base64');this.onload();});}},...(!fallback?{showSaveFilePicker:async options=>{pickers++;if(cancel){const e=Error('cancelled');e.name='AbortError';throw e;}return{createWritable:async()=>({async write(blob){saved.push({options,data:JSON.parse(await blob.text())});},async close(){}})};}}:{})});
  vm.runInContext(source,context);
  return{element,state,saved,objects,pickers:()=>pickers,draws:()=>draws,context,open(){element('#add-product').listeners.click();},async submit(){await element('#manual-form').listeners.submit({preventDefault(){}});},fill(){element('#manual-name').value='手动商品';element('#manual-grade').value='RE';element('#manual-scale').value='1/100';element('#manual-date').value='2026-10-16';element('#manual-price').value='123.45';}};
}
test('add form saves a valid, credential-free package and does not pretend it is already public',async()=>{
  const p=ui();p.open();p.fill();await p.submit();
  assert.equal(p.saved.length,1);assert.equal(p.saved[0].data.product.priceCents,12345);assert.equal(p.saved[0].data.action,'add-product');assert.equal(p.saved[0].data.image,null);
  assert.match(p.saved[0].options.suggestedName,/^manual-[a-f0-9-]{36}\.json$/);assert.equal(p.saved[0].options.startIn,'desktop');
  assert.match(p.element('#manual-message').textContent,/尚未全站发布/);assert.equal(p.state.quotes.length,0);
  p.context.manualDataLoaded({manualReceipts:[p.saved[0].data.requestId]});assert.match(p.element('#manual-publish-status').textContent,/已确认全站发布：手动商品/);
  assert.doesNotMatch(JSON.stringify(p.saved),/Authorization|github_pat_|Cookie/);
});
test('cancelled save does not enqueue publication or hide retry button',async()=>{
  const p=ui({cancel:true});p.open();p.fill();await p.submit();
  assert.equal(p.saved.length,0);assert.match(p.element('#manual-message').textContent,/已取消/);assert.equal(p.element('#manual-publish-status').textContent,'');assert.equal(p.element('#manual-submit').disabled,false);
});
test('duplicate add is stopped before download and the user can upload to an existing row',async()=>{
  const p=ui();p.state.quotes.push({id:'a',grade:'RE/100',modelName:'手动商品',scale:'1/100'});p.open();p.fill();await p.submit();
  assert.equal(p.pickers(),0);assert.match(p.element('#manual-message').textContent,/已存在/);
  p.element('#rows').listeners.click({target:{closest:()=>({dataset:{imageRecord:'a'}})}});
  assert.equal(p.element('#manual-product-fields').hidden,true);assert.equal(p.element('#manual-name').disabled,true);
  await p.submit();assert.match(p.element('#manual-message').textContent,/请选择商品照片|请先选择商品照片/);
});
test('photo is re-encoded before export, retains exact target, and never exports the original filename',async()=>{
  const p=ui();p.state.quotes.push({id:'a',grade:'HG',modelName:'测试',scale:null});
  p.element('#rows').listeners.click({target:{closest:()=>({dataset:{imageRecord:'a'}})}});
  p.element('#manual-photo').files=[{type:'image/png',size:10000,name:'private-location-photo.png'}];
  await p.element('#manual-photo').listeners.change();await p.submit();
  assert.equal(p.draws(),1);assert.equal(p.saved[0].data.action,'set-image');assert.deepEqual(p.saved[0].data.target,{modelName:'测试',grade:'HG',scale:''});
  assert.ok(p.saved[0].data.image.base64);assert.doesNotMatch(JSON.stringify(p.saved),/private-location/);
});
test('SVG and oversized originals are rejected before drawing',async()=>{
  const p=ui();p.open();
  for(const file of [{type:'image/svg+xml',size:10},{type:'image/jpeg',size:16*1024*1024}]){
    p.element('#manual-photo').files=[file];await p.element('#manual-photo').listeners.change();assert.match(p.element('#manual-message').textContent,/15MB/);
  }
  assert.equal(p.draws(),0);
});
test('unsupported save picker falls back to download with explicit folder instructions',async()=>{
  const p=ui({fallback:true,storageThrows:true});p.open();p.fill();await p.submit();
  assert.equal(p.element('anchor').clicked,true);assert.match(p.element('#manual-message').textContent,/移到 Desktop\\SubBatchAuto/);
  assert.equal(JSON.parse(await p.objects[0].text()).product.modelName,'手动商品');
});
