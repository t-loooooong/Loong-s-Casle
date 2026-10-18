import{readFile,writeFile,mkdir,rename,unlink,readdir,stat}from'node:fs/promises';
import{resolve,dirname}from'node:path';
import{fileURLToPath}from'node:url';
import{createHash}from'node:crypto';
import{execFile}from'node:child_process';
import{promisify}from'node:util';
const exec=promisify(execFile),HERE=dirname(fileURLToPath(import.meta.url));
export const VISUAL_REVISION='visual-2026-10-18.1';
const json=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
async function atomic(path,value){await writeFile(path+'.tmp',JSON.stringify(value,null,2)+'\n');await rename(path+'.tmp',path);}
function controlledError(message,blocked=false){const error=Error(message);error.blocked=blocked;return error;}
export async function publicVideo(source,{fetchImpl=fetch}={}){
  if(source.sourceUid!=='382486276'||!/^BV[0-9A-Za-z]{10}$/.test(source.bvid)||!/^\d+$/.test(String(source.cid)))throw controlledError('画面来源校验失败');
  const headers={'User-Agent':'Mozilla/5.0',Referer:`https://www.bilibili.com/video/${source.bvid}/`};
  async function api(path){
    let response;try{response=await fetchImpl('https://api.bilibili.com'+path,{headers,signal:AbortSignal.timeout(20000)});}catch{throw controlledError('画面接口网络超时');}
    if(!response.ok)throw controlledError(`画面接口 HTTP ${response.status}`, [401,403,412,429].includes(response.status));
    const body=await response.json();
    if(body.code!==0)throw controlledError('画面接口要求登录、验证或暂不可用',true);
    return body.data;
  }
  const info=await api(`/x/web-interface/view?bvid=${source.bvid}`);
  if(String(info.owner?.mid)!==source.sourceUid||info.bvid!==source.bvid||!Number.isFinite(Number(info.pubdate))||!Number.isFinite(Date.parse(source.publishedAt))||Math.abs(Number(info.pubdate)*1000-Date.parse(source.publishedAt))>1000)throw controlledError('公开视频作者或发布日期不匹配');
  if(info.rights?.download!==1||info.rights?.pay||info.rights?.ugc_pay||info.rights?.arc_pay||info.is_upower_exclusive)throw controlledError('此视频不允许下载或属于受限内容');
  const part=info.pages?.find(p=>String(p.cid)===String(source.cid)&&p.page===source.page);
  if(!part||part.duration<=0||part.duration>180)throw controlledError('画面OCR仅自动处理180秒以内的公开视频分P');
  const playback=await api(`/x/player/playurl?bvid=${source.bvid}&cid=${source.cid}&qn=64&fnval=16&fourk=0`);
  const streams=(playback.dash?.video||[]).filter(v=>v.width<=1920&&/^avc1/.test(v.codecs||''));
  streams.sort((a,b)=>b.width-a.width||a.bandwidth-b.bandwidth);
  const selected=streams[0];const address=selected?.baseUrl||selected?.base_url||playback.durl?.[0]?.url;
  let url;try{url=new URL(address);}catch{throw controlledError('没有可读取的公开视频流');}
  if(url.protocol!=='https:'||!/(^|\.)bilivideo\.(com|cn)$/.test(url.hostname))throw controlledError('视频流来源不在B站CDN白名单');
  let response;try{response=await fetchImpl(url.href,{headers,redirect:'error',signal:AbortSignal.timeout(45000)});}catch{throw controlledError('公开视频流下载失败');}
  if(!response.ok)throw controlledError(`公开视频流 HTTP ${response.status}`,[401,403,412,429].includes(response.status));
  if(Number(response.headers.get('content-length'))>30000000)throw controlledError('公开视频流超过30MB上限');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>30000000){await reader.cancel();throw controlledError('公开视频流超过30MB上限');}chunks.push(value);}}
  finally{reader.releaseLock();}
  return {bytes:Buffer.concat(chunks),info:{bvid:source.bvid,cid:String(source.cid),page:source.page,sourceUid:source.sourceUid,publishedAt:source.publishedAt,title:String(info.title),durationSeconds:part.duration,width:selected?.width||null,height:selected?.height||null}};
}
async function run(command,args,options={}){
  try{return await exec(command,args,{windowsHide:true,timeout:180000,maxBuffer:1000000,...options});}
  catch{throw controlledError(command==='python'?'本机视频解码或画面候选处理失败':'Windows中文OCR暂不可用');}
}
export async function diagnoseVisual(){
  await run('python',['-c','import cv2; print("OpenCV available")']);
  const code=await readFile(resolve(HERE,'ocr/recognize.ps1'),'utf8');
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{env:{...process.env,GUNPLA_OCR_DIAGNOSE:'1'},timeout:30000});
  return {ok:true,engine:'Windows.Media.Ocr',networkRequests:0,credentialsRead:false};
}
async function directorySize(path){
  let size=0;
  for(const row of await readdir(path,{withFileTypes:true})){const file=resolve(path,row.name);if(row.isSymbolicLink())continue;if(row.isDirectory())size+=await directorySize(file);else if(row.isFile())size+=(await stat(file)).size;}
  return size;
}
export async function analyzeVideo(source,{audit,catalog,log=()=>{},fetchImpl=fetch,localVideo}={}){
  await mkdir(audit,{recursive:true});
  let media;
  if(localVideo){media={bytes:await readFile(localVideo),info:{bvid:source.bvid,cid:String(source.cid),page:source.page,sourceUid:source.sourceUid,publishedAt:source.publishedAt,title:source.title,offlineTest:true}};}
  else{log(`下载公开画面：${source.bvid} P${source.page}`);media=await publicVideo(source,{fetchImpl});}
  await atomic(resolve(audit,'source.json'),media.info);
  const videoFile=resolve(audit,'video.mp4');await writeFile(videoFile,media.bytes);
  try{
    log(`抽帧：${source.bvid} P${source.page}`);
    await run('python',['-X','utf8',resolve(HERE,'ocr/frames.py'),'--video',videoFile,'--output',audit]);
    const code=await readFile(resolve(HERE,'ocr/recognize.ps1'),'utf8');
    log(`本机画面OCR：${source.bvid} P${source.page}`);
    await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{env:{...process.env,GUNPLA_OCR_DIAGNOSE:'0',GUNPLA_OCR_OUTPUT:audit}});
    await run('python',['-X','utf8',resolve(HERE,'ocr/candidates.py'),'--audit',audit,'--catalog',catalog]);
    const result=await json(resolve(audit,'visual-candidates.json'));
    return {ok:true,revision:VISUAL_REVISION,at:new Date().toISOString(),candidates:result.candidates,rejected:result.rejected.length};
  }finally{await unlink(videoFile).catch(()=>{});} // Only this function's newly generated private video; retain evidence frames.
}
export async function collectVisual(bundle,{root,catalog,enabled=true,budget=2,log=console.log,analyze=analyzeVideo}={}){
  const taskMap=new Map([...(bundle.visualTasks||[]),...bundle.videos].map(source=>[`${source.bvid}:${source.cid}`,source]));
  const summary={enabled,status:enabled?'queued':'disabled',checkedParts:0,totalParts:taskMap.size,failedParts:0,revision:VISUAL_REVISION};
  if(!enabled)return {candidates:[],summary,fingerprint:'disabled'};
  await mkdir(root,{recursive:true});
  let block=await json(resolve(root,'access-status.json'),{}),attempted=0;
  const all=[],fingerprints=[];
  const sources=[...taskMap.values()].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||a.page-b.page);
  let exhausted=false;
  for(const source of sources){
    const key=createHash('sha256').update(JSON.stringify([VISUAL_REVISION,source.bvid,source.cid,source.page,source.publishedAt])).digest('hex').slice(0,24);
    const audit=resolve(root,key);let cached=await json(resolve(audit,'result.json'),null);
    if(!cached?.ok&&Date.now()>=(cached?.retryAt||0)&&attempted<budget&&Date.now()>=(block.until||0)&&!exhausted){
      if(await directorySize(root)>1024*1024*1024){exhausted=true;}
      if(!exhausted){
      attempted++;
      try{cached=await analyze(source,{audit,catalog,log});}
      catch(error){
        cached={ok:false,at:new Date().toISOString(),retryAt:Date.now()+6*3600000,reason:error.blocked?'access_blocked':'unavailable'};
        log(`画面采集未完成：${source.bvid} P${source.page}。${error.message}；保留字幕结果，不绕过验证。`);
        if(error.blocked){block={until:Date.now()+6*3600000};await atomic(resolve(root,'access-status.json'),block);}
      }
      await mkdir(audit,{recursive:true});await atomic(resolve(audit,'result.json'),cached);
      }
    }
    if(cached?.ok){summary.checkedParts++;all.push(...cached.candidates);}
    else if(cached)summary.failedParts++;
    fingerprints.push([key,cached?.at||null,cached?.ok||false]);
  }
  summary.status=exhausted?'cache_full':Date.now()<(block.until||0)?'blocked':summary.checkedParts===summary.totalParts?'complete':summary.failedParts?'partial':'queued';
  const fingerprint=createHash('sha256').update(JSON.stringify([fingerprints,summary.status])).digest('hex');
  return {candidates:all,summary,fingerprint};
}
