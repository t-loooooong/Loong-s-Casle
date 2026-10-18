import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ensureTokenHelper } from './build-auth.mjs';
import { spawnSync } from 'node:child_process';
test('publisher no longer starts PowerShell scripts or changes security policies', async()=>{
  const publisher=await readFile(new URL('./publisher.mjs',import.meta.url),'utf8');
  assert.ok(!publisher.includes('powershell.exe'));
  assert.ok(!publisher.includes('ExecutionPolicy'));
  assert.match(publisher,/spawnSync\(helper,\['save'\]/);
  assert.match(publisher,/spawnSync\(helper,\['read'\]/);
});
test('token helper masks user input and refuses interactive plaintext output',async()=>{
  const source=await readFile(new URL('./TokenStore.cs',import.meta.url),'utf8');
  assert.match(source,/UseSystemPasswordChar=true/);
  assert.match(source,/if \(!Console.IsOutputRedirected\) return 3/);
  assert.match(source,/DataProtectionScope.CurrentUser/);
  assert.ok(!source.includes('DataProtectionScope.LocalMachine'));
  assert.match(source,/github-token.v2.dpapi/);
});
test('CMD launchers are ASCII/CRLF and use an explicit Node runtime',async()=>{
  for(const name of ['开始每日采集.cmd','首次连接GitHub.cmd']){
    const bytes=await readFile(new URL('./'+name,import.meta.url));
    assert.ok(bytes.every(b=>b<128),'Launcher must remain ASCII-only');
    const source=bytes.toString('ascii');
    assert.ok(!/(?<!\r)\n/.test(source),'CMD needs CRLF line endings');
    assert.match(source,/GUNPLA_NODE=/);
    assert.match(source,/%GUNPLA_NODE%/);
    assert.ok(!source.includes('chcp'));
  }
});
test('publisher allows asynchronous network cleanup on exit',async()=>{
  const source=await readFile(new URL('./publisher.mjs',import.meta.url),'utf8');
  assert.ok(!/process\.exit\s*\(/.test(source));
  assert.match(source,/main\(\)\.catch/);
});
test('Windows helper compilation and synthetic-only encryption check',async t=>{
  if(process.platform!=='win32'){t.skip('Windows-only DPAPI; no credential files touched.');return;}
  const exe=await ensureTokenHelper();
  const result=spawnSync(exe,['selftest'],{encoding:'utf8',windowsHide:true});
  if(result.status===4 && /CryptographicException/.test(result.stderr || '')){
    t.skip('Current restricted test session cannot use Windows user-profile encryption; requires a normal local user session.');return;
  }
  assert.equal(result.status,0);
  assert.match(result.stdout,/synthetic data only/);
});
