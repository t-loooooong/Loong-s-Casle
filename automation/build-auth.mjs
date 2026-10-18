import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
export async function ensureTokenHelper() {
  if(process.platform!=='win32')throw Error('本机授权窗口仅适用于 Windows。');
  const source=resolve(here,'TokenStore.cs'), directory=resolve(here,'state/native');
  const exe=resolve(directory,'TokenStore.exe'), marker=resolve(directory,'build.json');
  const hash=createHash('sha256').update(await readFile(source)).digest('hex');
  try {const built=JSON.parse(await readFile(marker,'utf8'));await access(exe);if(built.sourceHash===hash)return exe;}catch(e){if(e.code!=='ENOENT')throw e;}
  let compiler;
  for(const platform of ['Framework64','Framework']) {
    const candidate=resolve(process.env.WINDIR || 'C:/Windows','Microsoft.NET',platform,'v4.0.30319/csc.exe');
    try {await access(candidate);compiler=candidate;break;}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  if(!compiler)throw Error('找不到 Windows .NET 编译组件；未改变系统设置，请联系我处理。');
  await mkdir(directory,{recursive:true});
  const result=spawnSync(compiler,['/nologo','/target:exe','/codepage:65001','/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Security.dll',`/out:${exe}`,source],{encoding:'utf8',windowsHide:true});
  if(result.error || result.status!==0)throw Error('本机授权程序编译失败：'+(result.stderr || result.stdout || 'compiler unavailable'));
  await writeFile(marker,JSON.stringify({sourceHash:hash,compiledAt:new Date().toISOString()})+'\n');
  return exe;
}
if(process.argv.includes('--self-test')) {
  const exe=await ensureTokenHelper();
  const result=spawnSync(exe,['selftest'],{encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw Error('Windows 用户加密自检失败；请在本人登录的本机桌面会话运行。'+result.stderr.trim());
  console.log(result.stdout.trim());
}
