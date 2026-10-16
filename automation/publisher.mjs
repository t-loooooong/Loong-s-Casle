import { readFile, writeFile, mkdir, readdir, stat, rename, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendCandidates, validateBundle } from './quotes.mjs';
import { publishHistory } from './remote.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)), STATE = resolve(HERE,'state');
async function firstExisting(paths) {for(const path of paths){try{await access(path);return path;}catch(e){if(e.code!=='ENOENT')throw e;}}throw Error('缺少采集依赖文件，请保留完整源码目录。');}
const {validateRecords} = await import(pathToFileURL(await firstExisting([resolve(HERE,'../edgeone-gunpla-price-radar/scripts/dataset.mjs'),resolve(HERE,'../scripts/dataset.mjs')])));
const setup = process.argv.includes('--setup'), once = process.argv.includes('--once');
const config = JSON.parse(await readFile(resolve(HERE,'config.json'),'utf8'));
const watch = resolve(process.argv.find(x => x.startsWith('--downloads='))?.slice(12) || resolve(process.env.USERPROFILE,config.downloadsRelative));
const parser = await firstExisting([resolve(HERE,'../subbatch-price-collector/scripts/collect_prices.py'),resolve(HERE,'parser/collect_prices.py')]);
const json = async (path, fallback) => { try { return JSON.parse(await readFile(path,'utf8')); } catch(e) { if(e.code==='ENOENT' && fallback!==undefined)return fallback; throw e; } };
async function atomic(path, object) { await writeFile(path+'.tmp',JSON.stringify(object,null,2)+'\n'); await rename(path+'.tmp',path); }
await mkdir(STATE,{recursive:true});
if (setup) {
  const result = spawnSync('powershell.exe',['-NoProfile','-File',resolve(HERE,'token.ps1'),'-Mode','save'],{stdio:'inherit'});
  if(result.status!==0)process.exit(1);
}
// DPAPI decryption stays in memory. Never log child stdout / credential error payloads.
const secret = spawnSync('powershell.exe',['-NoProfile','-File',resolve(HERE,'token.ps1'),'-Mode','read'],{encoding:'utf8',windowsHide:true});
if(secret.status!==0 || !/^github_pat_[A-Za-z0-9_]+$/.test(secret.stdout.trim())) {
  console.error('尚未连接 GitHub。请先运行“首次连接GitHub.cmd”，在本机输入仅限此仓库的 fine-grained token（不要发给聊天）。'); process.exit(1);
}
const token = secret.stdout.trim();
async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/t-loooooong/Loong-s-Casle${path}`,{
    method:options.method || 'GET', signal:AbortSignal.timeout(60000), headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'gunpla-local-collector'},
    ...(options.body ? {body:JSON.stringify(options.body)} : {})
  });
  if(!response.ok){const error=Error(`GitHub HTTP ${response.status}：检查网络、令牌权限 / 有效期或并发更新。`);error.status=response.status;throw error;}
  return response.json();
}
if(setup){await api('/git/ref/heads/main');console.log('令牌已加密保存，仓库读取成功；写入权限将在首次发布时验证。');process.exit(0);}
await mkdir(watch,{recursive:true});
const { createServer } = await import('node:net');
const lock = createServer(socket => socket.destroy());
await new Promise((ok,fail) => {lock.once('error',()=>fail(Error('发布程序已运行，或端口47381被占用')));lock.listen(47381,'127.0.0.1',ok);});
const processed = await json(resolve(STATE,'processed.json'),{});
async function cycle() {
  // Extension snapshots are cumulative; only process newest to avoid dozens of commits
  // and prevent an old failure snapshot from replacing a newer success status.
  const files = (await readdir(watch)).filter(n => /^bundle-[\w-]+\.json$/.test(n)).sort().reverse().slice(0,1);
  for (const filename of files) {
    const input = resolve(watch,filename), details = await stat(input);
    if (details.size > 25000000 || Date.now()-details.mtimeMs<2000) continue;
    const raw = await readFile(input), hash = createHash('sha256').update(raw).update(config.parserRevision).digest('hex');
    if (processed[hash]) continue;
    const bundle = JSON.parse(raw.toString('utf8')); validateBundle(bundle);
    const audit = resolve(STATE,hash); await mkdir(audit,{recursive:true});
    try { await stat(resolve(audit,'candidates.json')); } catch(e) {
      if(e.code!=='ENOENT')throw e;
      const result=spawnSync('python',['-X','utf8',parser,input,'--output',audit],{encoding:'utf8',windowsHide:true,maxBuffer:1000000});
      if(result.error || result.status!==0)throw Error('本地字幕解析失败；请保留采集包与 state 审计目录。');
    }
    const candidates = (await json(resolve(audit,'candidates.json'))).candidates;
    const added = await publishHistory(api, history => {const rows=appendCandidates(history,candidates,bundle);validateRecords(history.records);return rows.length;});
    processed[hash] = new Date().toISOString(); await atomic(resolve(STATE,'processed.json'),processed);
    console.log(`${new Date().toLocaleString()} 已推送 ${added} 条候选；等待 EdgeOne 自动部署。`);
  }
}
console.log(`监控目录：${watch}\n可以继续使用电脑。不要关闭 Edge 采集页；关闭此窗口会停止网站发布。`);
try {do {await cycle();if(!once)await new Promise(r=>setTimeout(r,10000));}while(!once);}
catch(error){console.error(error.message);process.exitCode=1;}finally{lock.close();}
