import '../automation/visual.test.mjs';
import '../automation/cleanup.test.mjs';
import '../automation/tests.test.mjs';
import '../automation/page-smoke.test.mjs';
import '../automation/auth.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import{spawnSync}from'node:child_process';
import{fileURLToPath}from'node:url';
test('OCR candidate parser rejects unsupported layouts and ambiguous conditions',()=>{
 const directory=fileURLToPath(new URL('../automation/ocr/',import.meta.url));
 const result=spawnSync('python',['-m','unittest','discover','-s',directory,'-p','test*.py'],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr||result.error?.message);
});
