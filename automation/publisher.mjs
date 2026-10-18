import { readFile, writeFile, mkdir, readdir, stat, rename, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendCandidates, validateBundle } from './quotes.mjs';
import { publishHistory } from './remote.mjs';
import { ensureTokenHelper } from './build-auth.mjs';
import { scanManualUploads } from './manual.mjs';
import { collectVisual, diagnoseVisual } from './visual.mjs';
import { fuseCandidates, extractionCoverage } from './fusion.mjs';
import { cleanupPublished } from './cleanup.mjs';
async function main() {
const HERE = dirname(fileURLToPath(import.meta.url)), STATE = resolve(HERE,'state');
async function firstExisting(paths) {for(const path of paths){try{await access(path);return path;}catch(e){if(e.code!=='ENOENT')throw e;}}throw Error('缺少采集依赖文件，请保留完整源码目录。');}
const {validateRecords} = await import(pathToFileURL(await firstExisting([resolve(HERE,'../edgeone-gunpla-price-radar/scripts/dataset.mjs'),resolve(HERE,'../scripts/dataset.mjs')])));
const setup = process.argv.includes('--setup'), once = process.argv.includes('--once');
const config = JSON.parse(await readFile(resolve(HERE,'config.json'),'utf8'));
const watch = resolve(process.argv.find(x => x.startsWith('--downloads='))?.slice(12) || resolve(process.env.USERPROFILE,config.downloadsRelative));
const parser = await firstExisting([resolve(HERE,'../subbatch-price-collector/scripts/collect_prices.py'),resolve(HERE,'parser/collect_prices.py')]);
if(process.argv.includes('--diagnose')) {
  const python=spawnSync('python',['--version'],{encoding:'utf8',windowsHide:true});
  if(python.status!==0)throw Error('Python runtime not found.');
  await access(watch);
  const visual=config.visualEnabled===false?{enabled:false}:await diagnoseVisual();
  console.log(JSON.stringify({ok:true,node:process.version,python:python.stdout.trim(),watch,parser,visual,credentialsRead:false,networkRequests:0}));
  return;
}
const json = async (path, fallback) => { try { return JSON.parse(await readFile(path,'utf8')); } catch(e) { if(e.code==='ENOENT' && fallback!==undefined)return fallback; throw e; } };
async function atomic(path, object) { await writeFile(path+'.tmp',JSON.stringify(object,null,2)+'\n'); await rename(path+'.tmp',path); }
await mkdir(STATE,{recursive:true});
const helper = await ensureTokenHelper();
if (setup) {
  const cryptoCheck=spawnSync(helper,['selftest'],{encoding:'utf8',windowsHide:true});
  if(cryptoCheck.status!==0){console.error('当前会话无法使用 Windows 用户加密。请双击本机“首次连接GitHub.cmd”运行，不要修改执行策略或关闭安全保护。');process.exitCode=1;return;}
  const result = spawnSync(helper,['save'],{stdio:'inherit'});
  if(result.status!==0){console.error('授权未保存（窗口已取消或程序被阻止）。无需重新生成令牌；没有修改系统安全设置。');process.exitCode=1;return;}
}
// DPAPI decryption stays in memory. Never log child stdout / credential error payloads.
const secret = spawnSync(helper,['read'],{encoding:'utf8',windowsHide:true});
const tokenText=typeof secret.stdout==='string' ? secret.stdout.trim() : '';
if(secret.status!==0 || !/^github_pat_[A-Za-z0-9_]+$/.test(tokenText)) {
  console.error('尚未连接 GitHub。请先运行“首次连接GitHub.cmd”，在本机输入仅限此仓库的 fine-grained token（不要发给聊天）。'); process.exitCode=1;return;
}
const token = tokenText;
async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/t-loooooong/Loong-s-Casle${path}`,{
    method:options.method || 'GET', signal:AbortSignal.timeout(60000), headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'gunpla-local-collector'},
    ...(options.body ? {body:JSON.stringify(options.body)} : {})
  });
  if(!response.ok){const error=Error(`GitHub HTTP ${response.status}：检查网络、令牌权限 / 有效期或并发更新。`);error.status=response.status;throw error;}
  return response.json();
}
if(setup){
  try {await api('/git/ref/heads/main');console.log('令牌已加密保存，仓库读取成功；写入权限将在首次发布时验证。下一步运行“开始每日采集.cmd”。');return;}
  catch(error){console.error('令牌已在本机加密保存，但连接 GitHub 失败。请检查令牌权限/有效期及网络；不要公开完整令牌。');process.exitCode=1;return;}
}
await mkdir(watch,{recursive:true});
const { createServer } = await import('node:net');
const lock = createServer(socket => socket.destroy());
await new Promise((ok,fail) => {lock.once('error',()=>fail(Error('发布程序已运行，或端口47381被占用')));lock.listen(47381,'127.0.0.1',ok);});
const processed = await json(resolve(STATE,'processed.json'),{});
async function cycle() {
  await scanManualUploads(watch,processed,api,()=>atomic(resolve(STATE,'processed.json'),processed));
  // Extension snapshots are cumulative; only process newest to avoid dozens of commits
  // and prevent an old failure snapshot from replacing a newer success status.
  const files = (await readdir(watch)).filter(n => /^bundle-[\w-]+\.json$/.test(n)).sort().reverse().slice(0,1);
  for (const filename of files) {
    const input = resolve(watch,filename), details = await stat(input);
    if (details.size > 25000000 || Date.now()-details.mtimeMs<2000) continue;
    const raw = await readFile(input), hash = createHash('sha256').update(raw).update(config.parserRevision).digest('hex');
    const bundle = JSON.parse(raw.toString('utf8')); validateBundle(bundle);
    // Removing the newest completed download must not expose an older snapshot
    // as a fresh update and roll the website's collection status backwards.
    if(Date.parse(bundle.exportedAt)<Date.parse(processed.latestBundleExportedAt||'1970-01-01'))continue;
    const audit = resolve(STATE,hash); await mkdir(audit,{recursive:true});
    try { await stat(resolve(audit,'candidates.json')); } catch(e) {
      if(e.code!=='ENOENT')throw e;
      const result=spawnSync('python',['-X','utf8',parser,input,'--output',audit],{encoding:'utf8',windowsHide:true,maxBuffer:1000000});
      if(result.error || result.status!==0)throw Error('本地字幕解析失败；请保留采集包与 state 审计目录。');
    }
    const candidates = (await json(resolve(audit,'candidates.json'))).candidates;
    let visual;
    try{visual=await collectVisual(bundle,{root:resolve(STATE,'visual'),catalog:resolve(dirname(parser),'model_catalog.json'),enabled:config.visualEnabled!==false,budget:Math.max(1,Math.min(3,Number(config.visualPartsPerCycle)||2))});}
    catch{console.log('画面缓存或本机OCR暂不可用，本轮继续字幕发布；未把画面标记为成功。');visual={candidates:[],summary:{status:'partial',checkedParts:0,totalParts:bundle.videos.length,enabled:true},fingerprint:'visual-unavailable'};}
    const publicationHash=hash+':'+visual.fingerprint;
    if(processed[publicationHash]){
      const removed=await cleanupPublished({state:STATE,watch,processed,parserRevision:config.parserRevision,publishedVisualKeys:visual.cacheKeys,currentName:filename,currentComplete:bundle.collection?.ok===true&&['complete','disabled'].includes(visual.summary.status)});
      await atomic(resolve(STATE,'processed.json'),processed);
      if(removed)console.log(`自动清理 ${removed} 个已处理文件；保留去重状态、文字证据及失败任务。`);
      continue;
    }
    const combined=fuseCandidates(candidates,visual.candidates);
    const coverage=extractionCoverage(candidates,visual.candidates);
    await atomic(resolve(audit,'combined-candidates.json'),{candidates:combined,visual:visual.summary,coverage});
    console.log(`提取完整性检查：${coverage.subtitleQuotes}条字幕金额候选，${coverage.visualQuotes}条画面候选；${coverage.unassignedSubtitleQuotes}条字幕金额未归属型号（流程完成不代表商品无漏项）。`);
    const observedAt=new Date().toISOString();
    const added = await publishHistory(api, history => {const rows=appendCandidates(history,combined,bundle,{visualSummary:visual.summary,observedAt});validateRecords(history.records);return rows.length;});
    processed[publicationHash] = new Date().toISOString();
    processed.latestBundleExportedAt=bundle.exportedAt;
    await atomic(resolve(STATE,'processed.json'),processed);
    console.log(`画面检查 ${visual.summary.checkedParts}/${visual.summary.totalParts} · ${visual.summary.status}`);
    console.log(`${new Date().toLocaleString()} 已推送 ${added} 条候选；等待 EdgeOne 自动部署。`);
    const removed=await cleanupPublished({state:STATE,watch,processed,parserRevision:config.parserRevision,publishedVisualKeys:visual.cacheKeys,currentName:filename,currentComplete:bundle.collection?.ok===true&&['complete','disabled'].includes(visual.summary.status)});
    await atomic(resolve(STATE,'processed.json'),processed);
    if(removed)console.log(`自动清理 ${removed} 个已处理文件；保留去重状态、文字证据及失败任务。`);
  }
}
console.log(`监控目录：${watch}\n可以继续使用电脑。不要关闭 Edge 采集页；关闭此窗口会停止网站发布。`);
console.log('手动商品和照片发布已启用：接收此目录中的 manual-…json 发布包。');
console.log('自动清理已启用：推送后删除成功任务截图；全部完成后删除采集包，失败任务保留重试。');
console.log(config.visualEnabled===false?'画面OCR已关闭。':'字幕／转写＋本机画面OCR已启用；每轮处理最多2个分P，画面失败不停止字幕发布。');
try {do {await cycle();if(!once)await new Promise(r=>setTimeout(r,10000));}while(!once);}
catch(error){console.error(error.message);process.exitCode=1;}finally{lock.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
