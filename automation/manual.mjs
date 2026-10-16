import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export const MANUAL_PRODUCER = 'gunpla-manual-v1';
export const emptyManual = () => ({schemaVersion:1,products:[],images:[],receipts:[]});
export const canonicalGrade = grade => ['RE','RE100','RE/100'].includes(grade) ? 'RE/100' : grade;
const grades = new Set(['HG','RG','MG','MGSD','MGEX','PG','PGU','EG','SD','RE/100','FM','OTHER']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const imagePath = value => typeof value === 'string' && /^\/uploads\/[a-f0-9]{64}\.jpg$/.test(value);
function text(value,max,required=false) {
  if(typeof value!=='string' || value.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (required&&!value.trim()))throw Error('手动数据字段为空、过长或格式无效');
  return value.trim();
}
export function manualTarget(value) {
  if(!value || !grades.has(canonicalGrade(value.grade)))throw Error('无效商品等级');
  const scale=text(value.scale??'',20);
  if(scale && !/^1\/\d{1,4}$/.test(scale))throw Error('比例请填写类似 1/144 或留空');
  return {modelName:text(value.modelName,120,true),grade:canonicalGrade(value.grade),scale};
}
export const targetKey = value => JSON.stringify([canonicalGrade(value.grade),value.modelName,(value.scale||'')]);
function product(value) {
  const target=manualTarget(value);
  if(value.priceCents!==null && (!Number.isSafeInteger(value.priceCents)||value.priceCents<=0||value.priceCents>100000000))throw Error('价格必须大于0且不超过100万元，或留空');
  if(typeof value.priceDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.priceDate)||!Number.isFinite(Date.parse(value.priceDate))||new Date(value.priceDate).toISOString().slice(0,10)!==value.priceDate)throw Error('无效报价日期');
  const sourceUrl=text(value.sourceUrl??'',1000);
  if(sourceUrl){let url;try{url=new URL(sourceUrl);}catch{throw Error('来源网址无效');}if(url.protocol!=='https:'||url.username||url.password)throw Error('来源网址仅支持不含账号密码的 HTTPS 链接');}
  return {...target,priceCents:value.priceCents,priceDate:value.priceDate,sourceUrl,notes:text(value.notes??'',1000)};
}
// Browser re-encodes photos as JPEG before export; never accept SVG, HTML or filenames/paths.
export function decodePhoto(value) {
  if(!value || typeof value.base64!=='string'||value.base64.length>1400000||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64))throw Error('商品照片格式无效或超过1MB');
  const bytes=Buffer.from(value.base64,'base64');
  if(bytes.length<20||bytes.length>1000000||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('仅接受网页处理后的 JPEG 照片');
  let dimensions=false;
  for(let pos=2;pos<bytes.length-2;) {
    if(bytes[pos++]!==255)throw Error('JPEG 数据损坏');
    while(bytes[pos]===255)pos++;
    const marker=bytes[pos++];if(marker===218)break;
    if(pos+2>bytes.length)throw Error('JPEG 数据损坏');
    const length=bytes.readUInt16BE(pos);
    if(length<2||pos+length>bytes.length)throw Error('JPEG 数据损坏');
    if([192,193,194].includes(marker)){
      if(length<8)throw Error('JPEG 数据损坏');
      const height=bytes.readUInt16BE(pos+3),width=bytes.readUInt16BE(pos+5);
      if(!width||!height||width>1600||height>1600)throw Error('照片尺寸超限');
      dimensions=true;
    }
    pos+=length;
  }
  if(!dimensions)throw Error('缺少 JPEG 尺寸信息');
  const hash=createHash('sha256').update(bytes).digest('hex');
  return {path:`uploads/${hash}.jpg`,url:`/uploads/${hash}.jpg`,base64:bytes.toString('base64')};
}
export function validateManualBundle(bundle) {
  if(!bundle||bundle.schemaVersion!==1||bundle.producer!==MANUAL_PRODUCER||!uuid.test(bundle.requestId)||!Number.isFinite(Date.parse(bundle.createdAt)))throw Error('不是有效的胶价雷达手动发布包');
  if(!['add-product','set-image'].includes(bundle.action))throw Error('不支持的手动操作');
  const result={schemaVersion:1,producer:MANUAL_PRODUCER,requestId:bundle.requestId,createdAt:bundle.createdAt,action:bundle.action};
  if(bundle.action==='add-product')result.product=product(bundle.product);
  else result.target=manualTarget(bundle.target);
  result.photo=bundle.image==null?null:decodePhoto(bundle.image);
  if(bundle.action==='set-image'&&!result.photo)throw Error('请选择商品照片');
  return result;
}
export function validateManualStore(store) {
  if(!store||store.schemaVersion!==1||!Array.isArray(store.products)||!Array.isArray(store.images)||!Array.isArray(store.receipts))throw Error('手动商品库格式无效');
  const ids=new Set(),targets=new Set(),images=new Set();
  for(const row of store.products){product(row);if(!uuid.test(row.requestId)||row.id!==`manual:${row.requestId}`||ids.has(row.id)||targets.has(targetKey(row)))throw Error('手动商品身份重复或无效');ids.add(row.id);targets.add(targetKey(row));}
  for(const row of store.images){manualTarget(row);if(!imagePath(row.url)||images.has(targetKey(row)))throw Error('手动图片路径重复或无效');images.add(targetKey(row));}
  if(store.receipts.some(id=>!uuid.test(id))||new Set(store.receipts).size!==store.receipts.length)throw Error('手动发布回执无效');
  return store;
}
export function mergeManual(store, clean, historyRecords=[]) {
  validateManualStore(store);
  if(store.receipts.includes(clean.requestId))return {store,duplicate:true};
  if(store.receipts.length>=10000)throw Error('手动发布次数已达上限，请联系维护人员归档');
  const next=structuredClone(store), target=clean.product||clean.target;
  const exists=[...historyRecords,...store.products].some(row=>targetKey(row)===targetKey(target));
  if(clean.action==='add-product'){
    if(exists)throw Error('相同等级、名称和比例的商品已存在，请使用更换图片入口');
    next.products.push({...clean.product,id:`manual:${clean.requestId}`,requestId:clean.requestId,createdAt:clean.createdAt});
  }else if(!exists)throw Error('目标商品不存在，请刷新网页后重新选择');
  if(clean.photo){
    next.images=next.images.filter(row=>targetKey(row)!==targetKey(target));
    next.images.push({...manualTarget(target),url:clean.photo.url,updatedAt:clean.createdAt});
  }
  next.receipts.push(clean.requestId);
  next.updatedAt=clean.createdAt;
  return {store:next,duplicate:false};
}
export function applyManual(records,store) {
  validateManualStore(store);
  const manualRows=store.products.map(row=>({id:row.id,modelName:row.modelName,grade:row.grade,scale:row.scale||null,priceCents:row.priceCents,priceType:'manual',publishedAt:`${row.priceDate}T00:00:00+08:00`,status:'manual',manual:true,notes:row.notes,sourceUrl:row.sourceUrl,videoTitle:'站长手动添加',videoUrl:null,confidence:0}));
  const photos=new Map(store.images.map(row=>[targetKey(row),row]));
  return [...records,...manualRows].map(row=>{
    const photo=photos.get(targetKey(row));
    return photo?{...row,productImageStatus:'manual',productImage:{url:photo.url,sourceUrl:photo.url,kind:'manual-upload',alt:row.modelName,credit:'站长上传',caption:'站长上传参考图，非官方核验',note:'图片由站长上传；版本、盒况与报价以实际商品为准'}}:row;
  });
}
export async function publishManual(api,bundle) {
  const clean=validateManualBundle(bundle);
  const jsonFile=async(path,head,fallback)=>{try{const blob=await api(`/contents/${path}?ref=${head}`);if(blob.encoding!=='base64')throw Error('远端数据格式无效');return JSON.parse(Buffer.from(blob.content,'base64').toString('utf8'));}catch(e){if(e.status===404&&fallback)return fallback;throw e;}};
  for(let attempt=0;attempt<3;attempt++){
    const head=(await api('/git/ref/heads/main')).object.sha;
    const commit=await api(`/git/commits/${head}`);
    const store=await jsonFile('data/manual-products.json',head,emptyManual());
    const history=await jsonFile('data/history.json',head);
    const merged=mergeManual(store,clean,history.records);
    if(merged.duplicate)return {duplicate:true,requestId:clean.requestId};
    const entries=[{path:'data/manual-products.json',mode:'100644',type:'blob',content:JSON.stringify(merged.store,null,2)+'\n'}];
    if(clean.photo){const blob=await api('/git/blobs',{method:'POST',body:{content:clean.photo.base64,encoding:'base64'}});entries.push({path:clean.photo.path,mode:'100644',type:'blob',sha:blob.sha});}
    const tree=await api('/git/trees',{method:'POST',body:{base_tree:commit.tree.sha,tree:entries}});
    const next=await api('/git/commits',{method:'POST',body:{message:`data: manual ${clean.action} (${clean.requestId})`,tree:tree.sha,parents:[head]}});
    try{await api('/git/refs/heads/main',{method:'PATCH',body:{sha:next.sha,force:false}});return {duplicate:false,requestId:clean.requestId,commit:next.sha};}
    catch(e){if(![409,422].includes(e.status)||attempt===2)throw e;}
  }
}

const retryAfter=new Map();
export async function scanManualUploads(watch,processed,api,save,log=console.log) {
  const files=(await readdir(watch)).filter(name=>/^manual-[a-f0-9-]{36}(?: \(\d+\))?\.json$/i.test(name)).sort();
  let attempts=0;
  for(const filename of files){
    const path=resolve(watch,filename);
    let raw;
    try{
      const details=await stat(path);
      if(details.size>2000000||Date.now()-details.mtimeMs<2000)continue;
      raw=await readFile(path);
    }catch{continue;} // File may still be written, locked or moved; don't stop subtitle collection.
    const hash='manual:'+createHash('sha256').update(raw).digest('hex');
    if(processed[hash]||Date.now()<(retryAfter.get(hash)||0))continue;
    if(++attempts>20)break;
    try{
      const result=await publishManual(api,JSON.parse(raw.toString('utf8')));
      processed[hash]=new Date().toISOString();await save();
      log(`手动商品${result.duplicate?'已处理，无需重复发布':'已推送，等待 EdgeOne 部署'} · ${result.requestId}`);
    }catch(error){
      retryAfter.set(hash,Date.now()+60000);
      // Only controlled error messages; never print raw files or GitHub response bodies.
      log(`手动发布未完成：${error instanceof SyntaxError?'发布包 JSON 格式错误':error.message}。采集继续运行，1分钟后可重试。`);
    }
  }
}
