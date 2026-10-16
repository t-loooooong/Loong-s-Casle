export const UID = '382486276';
export const day = (now = new Date()) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
export function due(state, now = new Date()) {
  const cn = new Date(now.getTime() + 8 * 3600000);
  return !state.paused && state.lastDay !== day(now) && cn.getUTCHours() * 60 + cn.getUTCMinutes() >= 497;
}
export function partsOf(info) {
  if (!info?.success || String(info.full_data?.owner?.mid) !== UID) throw Error('视频作者校验失败');
  if (info.isChargeExclusive) throw Error('充电专属视频不能自动采集');
  const pages = info.full_data?.pages;
  if (!Array.isArray(pages) || !pages.length) throw Error('视频分P信息缺失');
  return pages.map(p => {
    if (!Number.isSafeInteger(Number(p.cid)) || !Number.isInteger(p.page) || p.page < 1 || p.duration > 1800) throw Error('分P无效或超过30分钟，需人工处理');
    return { cid: String(p.cid), page: p.page, part: String(p.part || '') };
  });
}
export function videoRecord(info, part, result, now = new Date()) {
  const published = new Date(Number(info.full_data.pubdate) * 1000);
  if (!/^BV[0-9A-Za-z]{10}$/.test(info.bvid) || !Number.isFinite(published.getTime())) throw Error('来源信息不完整');
  if (typeof result.subtitleText !== 'string' || !result.subtitleText.trim() || result.subtitleText.length > 1000000) throw Error('字幕为空或过大');
  return { bvid: info.bvid, cid: part.cid, page: part.page, part: part.part, title: String(info.title), sourceUid: UID,
    sourceAccount: String(info.full_data.owner.name || info.author || ''), publishedAt: published.toISOString(),
    videoUrl: `https://www.bilibili.com/video/${info.bvid}/`, subtitleText: result.subtitleText,
    subtitleKind: result.subtitleKind, language: result.language, collectedAt: now.toISOString() };
}
export const taskKey = (bvid, part) => `${bvid}:${part.cid}`;
export function cleanBundle(state) {
  // Explicit whitelist. Never serialize runtime replies, cookie storage, or track/audio URLs.
  return { schemaVersion: 1, producer: 'subbatch-local-auto-v1', exportedAt: new Date().toISOString(),
    videos: Object.values(state.videos || {}).map(v => ({ bvid:v.bvid, cid:v.cid, page:v.page, part:v.part, title:v.title,
      sourceUid:v.sourceUid, sourceAccount:v.sourceAccount, publishedAt:v.publishedAt, videoUrl:v.videoUrl,
      subtitleText:v.subtitleText, subtitleKind:v.subtitleKind, language:v.language, collectedAt:v.collectedAt })),
    skipped: [], collection: { ok: state.scanComplete === true, lastSuccessAt: state.lastSuccessAt || null,
      attemptedAt: state.attemptedAt, message: state.publicMessage || '采集中' } };
}
