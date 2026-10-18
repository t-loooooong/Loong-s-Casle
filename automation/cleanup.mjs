import {readdir,readFile,lstat,realpath,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';

// Delete only known generated regular files. Never follow junctions/symlinks,
// recurse, or remove user/manual uploads, credentials, compact results or receipts.
async function regularDirectory(path){
  try{return (await lstat(path)).isDirectory() && !(await lstat(path)).isSymbolicLink() &&
    (await realpath(path)).toLowerCase()===resolve(path).toLowerCase();}
  catch(e){if(e.code==='ENOENT')return false;throw e;}
}
async function removeFile(root,name){
  const path=resolve(root,name);
  if(dirname(path)!==resolve(root))throw Error('清理路径越界');
  try{const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink())return 0;await unlink(path);return 1;}
  catch(e){if(e.code==='ENOENT')return 0;throw e;}
}
export async function cleanupPublished({state,watch,processed,parserRevision,currentName,currentComplete=false,publishedVisualKeys=[]}){
  let removed=0;
  const published=hash=>Object.keys(processed).some(key=>key.startsWith(hash+':'));
  if(await regularDirectory(state)){
    const visual=resolve(state,'visual');
    if(await regularDirectory(visual))for(const name of await readdir(visual)){
      if(!/^[a-f0-9]{24}$/.test(name)||!publishedVisualKeys.includes(name))continue;
      const directory=resolve(visual,name);if(!await regularDirectory(directory))continue;
      // Caller invokes only after successful publication; result.json remains the
      // compact resumable OCR cache. Failed jobs retain their debugging evidence.
      let result;try{result=JSON.parse(await readFile(resolve(directory,'result.json'),'utf8'));}catch{continue;}
      if(!result.ok)continue;
      for(const file of await readdir(directory))if(/^(frame-\d{4}\.jpg|video\.mp4|frames\.json|ocr-results\.json|visual-candidates\.json|source\.json)$/.test(file))removed+=await removeFile(directory,file);
      const frames=resolve(directory,'frames');
      if(await regularDirectory(frames))for(const file of await readdir(frames))if(/^frame-\d{4}\.jpg$/.test(file))removed+=await removeFile(frames,file);
    }
    for(const name of await readdir(state)){
      if(!/^[a-f0-9]{64}$/.test(name)||!published(name))continue;
      const directory=resolve(state,name);if(!await regularDirectory(directory))continue;
      // Retain candidates.json for resumable subtitle fusion.
      for(const file of ['combined-candidates.json','report.md','report.json'])removed+=await removeFile(directory,file);
    }
  }
  // A published cumulative snapshot replaces older packages only when every
  // transcript/task object is present verbatim. Unknown/changed data is retained.
  let current;
  if(currentName&&/^bundle-[\w-]+\.json$/.test(currentName)&&await regularDirectory(watch)){
    const path=resolve(watch,currentName);
    try{const s=await lstat(path);if(s.isFile()&&!s.isSymbolicLink()&&s.size<=25000000){
      const raw=await readFile(path),hash=createHash('sha256').update(raw).update(parserRevision).digest('hex');
      if(published(hash))current=JSON.parse(raw);
    }}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  if(await regularDirectory(watch))for(const name of await readdir(watch)){
    if(!/^bundle-[\w-]+\.json$/.test(name))continue;
    const path=resolve(watch,name),s=await lstat(path);
    if(!s.isFile()||s.isSymbolicLink()||s.size>25000000||Date.now()-s.mtimeMs<2000)continue;
    const hash=createHash('sha256').update(await readFile(path)).update(parserRevision).digest('hex');
    // Older snapshots may contain unfinished tasks: don't assume a newer
    // cumulative snapshot covers them. Remove only explicit completed receipts.
    let superseded=false;
    if(current&&name!==currentName){
      try{
        const old=JSON.parse(await readFile(path,'utf8'));
        const subset=field=>Array.isArray(old[field]||[])&&Array.isArray(current[field]||[])&&(old[field]||[]).every(row=>(current[field]||[]).some(v=>JSON.stringify(v)===JSON.stringify(row)));
        superseded=old.producer===current.producer&&old.schemaVersion===current.schemaVersion&&subset('videos')&&subset('visualTasks');
      }catch{/* Invalid/unrecognized packages are never deleted. */}
    }
    if(superseded || processed['cleanup:'+hash] || (name===currentName&&currentComplete&&published(hash))){
      if(!superseded)processed['cleanup:'+hash]=true;
      removed+=await removeFile(watch,name);
    }
  }
  return removed;
}
