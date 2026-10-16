// Guarded source patch. Does not read profiles, export cookies, or copy model files.
import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv.slice(2).find(x=>!x.startsWith('--')) || 'C:/Users/sepco3/Desktop/subbatch-local-v2.0.0');
const apply = process.argv.includes('--apply');
const manifest = JSON.parse(await readFile(resolve(target,'manifest.json'),'utf8'));
if (manifest.version !== '2.0.0' || manifest.background?.service_worker !== 'background.js') throw Error('Unsupported extension version');
const script = await readFile(resolve(target,'script.js'),'utf8');
const background = await readFile(resolve(target,'background.js'),'utf8');
const prefixEnd = script.indexOf('document.addEventListener("DOMContentLoaded"');
const suffixStart = script.indexOf('let frontendWhisperActiveLanguage=');
if (prefixEnd < 0 || suffixStart <= prefixEnd) throw Error('Whisper extraction anchors changed');
let whisper = script.slice(0,prefixEnd) + script.slice(suffixStart);
// Do not let the original frontend silently skip failed chunks.
const chunkCatch = /catch\((\w+)\)\{console\.(?:error|warn)\(`[^`]*块[^`]*`[^}]*\}/g;
const catches = [...whisper.matchAll(chunkCatch)];
if (catches.length !== 1) throw Error('Expected exactly one recover-and-skip chunk handler; inspect source before installing');
whisper = whisper.replace(chunkCatch, (text, variable) => `catch(${variable}){throw new Error("音频分块转写失败，未标记完成");}`);
new vm.Script(whisper);
const injection = `\n/* GUNPLA_AUTO_BUTTON_V1 */\ndocument.addEventListener('DOMContentLoaded',()=>{const button=document.createElement('button');button.textContent='打开每日自动采集';button.style.cssText='padding:12px;margin:12px;background:#28ccdf;border:0;border-radius:8px';button.onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('auto.html'),active:true});document.body.prepend(button);});\n`;
const bridge = '\n/* GUNPLA_AUTO_BRIDGE_V1 */\nimportScripts("auto-background.js");\n';
for (const name of ['getBilibiliVideoInfo','getBilibiliSubtitleTracks','getBilibiliSubtitleContentByTrack','fetchAudioStreamUrl','downloadAudioDirectly']) {
  if (!background.includes(`function ${name}(`)) throw Error(`Missing dependency ${name}`);
}
if (!apply) { console.log('Dry run passed. No files changed. Use --apply to install with backups.'); process.exit(0); }
for (const [name, contents, marker] of [['script.js',script,injection],['background.js',background,bridge]]) {
  if (contents.includes(name === 'script.js' ? 'GUNPLA_AUTO_BUTTON_V1' : 'GUNPLA_AUTO_BRIDGE_V1')) continue;
  const backup = resolve(target,`${name}.gunpla-auto-original`);
  try { await access(backup); throw Error(`Backup already exists: ${backup}; refusing overwrite`); } catch (e) { if(e.code !== 'ENOENT') throw e; }
  await copyFile(resolve(target,name),backup);
  await writeFile(resolve(target,name),contents+marker);
}
for (const name of ['auto.html','auto.css','auto-core.mjs','auto-page.js','auto-background.js']) await copyFile(resolve(here,'extension',name),resolve(target,name));
await writeFile(resolve(target,'auto-whisper.js'),whisper);
console.log('Installed. Reload SubBatch in Edge, reopen its panel, then choose 打开每日自动采集. Manifest and models unchanged.');
