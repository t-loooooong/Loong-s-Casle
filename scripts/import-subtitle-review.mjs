import { readFile } from 'node:fs/promises';
import { initialize, readJson, writeJson, validateRecords } from './dataset.mjs';
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/import-subtitle-review.mjs <original-bundle.json>');
const bundle = JSON.parse(await readFile(input, 'utf8'));
const review = await readJson('data/imports/subbatch-20261016-review.json');
if (bundle.exportedAt !== review.sourceExportedAt) throw new Error('This review belongs to a different source export');
const history = await initialize();
const existing = new Set(history.records.map(r => r.id));
let added = 0;
for (const item of review.observations) {
  const video = bundle.videos.find(v => v.bvid === item.bvid && v.page === 1);
  if (!video || video.sourceUid !== review.sourceUid || !video.subtitleText.includes(item.quoteText)) throw new Error('Evidence/source mismatch');
  for (const alt of item.alternatives || []) if (!video.subtitleText.includes(alt.quoteText)) throw new Error('Alternative price evidence missing');
  const id = `subtitle:${item.bvid}:p1:${item.grade}:${item.modelName}:${bundle.exportedAt}`;
  if (existing.has(id)) continue;
  history.records.push({
    id, sourceAccount: video.sourceAccount, sourceUid: video.sourceUid,
    bvid: video.bvid, videoTitle: video.title, videoUrl: video.videoUrl,
    modelName: item.modelName, grade: item.grade, scale: null,
    priceCents: item.priceCents, originalPriceCents: null, priceType: 'observed',
    status: item.priceCents === null ? 'pending' : 'extracted', confidence: item.priceCents === null ? 45 : 72,
    extractionMethod: 'subtitle_title_crosscheck', publishedAt: video.publishedAt, observedAt: bundle.exportedAt,
    notes: item.notes, alternativePrices: item.alternatives || [],
    evidence: { text: item.quoteText, startSeconds: item.start, endSeconds: item.end, page: 1, cid: video.cid, language: video.language, subtitleKind: video.subtitleKind, reviewMethod: review.reviewMethod },
  });
  existing.add(id);
  added++;
}
validateRecords(history.records);
history.meta = { ...history.meta, lastSubtitleImportAt: bundle.exportedAt, lastSubtitleImportVideos: bundle.videos.length };
await writeJson('data/history.json', history);
console.log(JSON.stringify({ added, total: history.records.length, priced: history.records.filter(r => r.priceCents !== null).length, verified: history.records.filter(r => r.status === 'verified').length }));
