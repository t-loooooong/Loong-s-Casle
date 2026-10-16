import { UID, day, due, partsOf, videoRecord, taskKey, cleanBundle } from './auto-core.mjs';
const KEY = 'gunplaAutoV1', out = document.querySelector('#status');
let state = (await chrome.storage.local.get(KEY))[KEY] || { videos: {}, done: {}, paused: false };
let busy = false, pauseRequested = false;
const show = text => { out.textContent = `${text}\n已保存分P：${Object.keys(state.videos).length}\n上次完整检查：${state.lastSuccessAt || '尚无'}`; };
const save = () => chrome.storage.local.set({ [KEY]: state });
const delay = ms => new Promise(r => setTimeout(r, ms));
async function request(action, args = {}) {
  let timer;
  try {
    const result = await Promise.race([chrome.runtime.sendMessage({ action, ...args }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('请求超时，已暂停')), 240000); })]);
    if (!result?.success) throw Error(result?.message || '请求失败，请检查B站登录 / 验证状态');
    return result;
  } finally { clearTimeout(timer); }
}
async function download(value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  try {
    const id = await chrome.downloads.download({ url, filename: `SubBatchAuto/bundle-${Date.now()}-${crypto.randomUUID().slice(0,8)}.json`, saveAs: false, conflictAction: 'uniquify' });
    // Check actual completion before considering export durable; no event race.
    for (let n = 0; n < 90; n++) {
      const [entry] = await chrome.downloads.search({ id });
      if (entry?.state === 'complete') return;
      if (entry?.state === 'interrupted') throw Error('下载被中断');
      await delay(1000);
    }
    throw Error('下载未完成；断点仍保存在扩展中');
  } finally { URL.revokeObjectURL(url); }
}
async function transcript(info, part) {
  const tracks = await request('gunplaAutoTracks', { bvid: info.bvid, cid: part.cid });
  const track = (tracks.subtitleTracks || []).find(t => /^zh(?:-|$)/.test(t.lan)) || (tracks.subtitleTracks || []).find(t => /^ai-zh/.test(t.lan));
  if (track) {
    const result = await request('gunplaAutoContent', { bvid: info.bvid, cid: part.cid, aid: info.aid, track });
    return { subtitleText: result.subtitleText, subtitleKind: track.lan.startsWith('ai-') ? 'bilibili-ai' : 'bilibili', language: track.lan };
  }
  if (!document.querySelector('#audio').checked) throw Error('没有中文字幕，且未启用本地转写；未标记完成');
  show(`下载音频：${info.bvid} P${part.page}`);
  const data = await request('gunplaAutoAudio', { bvid: info.bvid, cid: part.cid });
  const context = new AudioContext();
  let buffer;
  try { buffer = await context.decodeAudioData(Uint8Array.from(data.audioData).buffer); } finally { await context.close(); }
  const result = await transcribeAudioInFrontend(buffer, (p, text) => show(`${info.bvid} P${part.page} · ${Math.round(p)}% ${text}`));
  const text = convertToSRT(result.chunks);
  if (!text) throw Error('转写没有有效时间戳，需人工检查');
  return { subtitleText: text, subtitleKind: 'local-whisper', language: result.language || 'unknown' };
}
async function collect(manual = false) {
  if (busy || (!manual && !due(state))) return;
  busy = true; pauseRequested = false;
  try {
    await navigator.locks.request('gunpla-auto-collector', { ifAvailable: true }, async lock => {
      if (!lock) { show('另一个采集页正在工作'); return; }
      state = (await chrome.storage.local.get(KEY))[KEY] || state;
      const previousWatermark = { lastSuccessAt: state.lastSuccessAt, lastDay: state.lastDay };
      // Keep the extension storage bounded; old observations remain in the website history.
      for (const [key, video] of Object.entries(state.videos)) {
        if (Date.parse(video.publishedAt) < Date.now()-30*86400000) { delete state.videos[key]; delete state.done[key]; }
      }
      state.paused = false; state.scanComplete = false; state.attemptedAt = new Date().toISOString();
      state.publicMessage = '采集中'; await save();
      try {
        // A failed full scan does not advance watermark. Bound archive catch-up explicitly.
        const cutoff = Math.max(Date.now() - 30*86400000, state.lastSuccessAt ? Date.parse(state.lastSuccessAt)-86400000 : Date.now()-3*86400000);
        let complete = false, parts = 0;
        for (let page = 1; page <= 10; page++) {
          show(`检查账号更新，第 ${page} 页`);
          const list = await request('fetchUserVideoList', { mid: UID, page, pageSize: 30 });
          const rows = list.data?.medias;
          if (!Array.isArray(rows)) throw Error('视频列表响应不完整');
          for (const row of rows) {
            if (!Number.isFinite(Number(row.created))) throw Error('视频发布日期缺失');
            if (Number(row.created)*1000 < cutoff) continue;
            const info = await request('fetchBilibiliInfo', { videoId: row.bvid });
            for (const part of partsOf(info)) {
              const key = taskKey(info.bvid, part);
              if (state.done[key]) continue;
              if (pauseRequested) throw Error('用户暂停；下次从断点继续');
              if (++parts > 30) throw Error('达到每轮30个分P上限，请点击继续补采');
              show(`采集 ${info.title} · P${part.page}`);
              const result = await transcript(info, part);
              state.videos[key] = videoRecord(info, part, result);
              // Atomic checkpoint first; an unsuccessful download is retried on next run.
              await save(); await download(cleanBundle(state));
              state.done[key] = true; await save(); await delay(4000);
            }
          }
          const total = Number(list.data?.page?.count);
          if (!rows.length || (Number.isFinite(total) && page*30 >= total) || (rows.length && rows.every(r => Number(r.created)*1000 < cutoff))) { complete = true; break; }
          await delay(4000);
        }
        if (!complete) throw Error('达到列表分页上限；不能确认完整扫描');
        state.scanComplete = true; state.lastSuccessAt = state.attemptedAt; state.lastDay = day();
        state.publicMessage = '账号最近更新及所有分P检查完成';
        await download(cleanBundle(state)); await save(); show(state.publicMessage);
      } catch (error) {
        state.lastSuccessAt = previousWatermark.lastSuccessAt;
        state.lastDay = previousWatermark.lastDay;
        state.paused = true; state.scanComplete = false;
        // No backend error text/URL/credential details are exported.
        state.publicMessage = '检查未完成，请在本机采集页查看并处理后重试';
        await save(); show(`已暂停：${String(error.message).slice(0,240)}\n已完成的分P不会重复转写。`);
        try { await download(cleanBundle(state)); } catch { /* persisted checkpoint remains */ }
      }
    });
  } finally { busy = false; }
}
document.querySelector('#run').onclick = () => collect(true);
document.querySelector('#pause').onclick = async () => { pauseRequested = true; state.paused = true; await save(); show('已请求暂停，当前分P完成后停止'); };
show('采集页已就绪；首次请点击“开始 / 继续检查”');
setInterval(() => collect(), 60000);
// Opening this dedicated page next morning catches up without affecting active Bilibili tabs.
collect();
