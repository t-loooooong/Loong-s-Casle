import { createHash } from 'node:crypto';
export function validateBundle(bundle) {
  if (bundle.schemaVersion !== 1 || bundle.producer !== 'subbatch-local-auto-v1' || !Array.isArray(bundle.videos) || bundle.videos.length > 2000 || !Number.isFinite(Date.parse(bundle.exportedAt))) throw Error('不是自动采集包');
  for (const v of bundle.videos) {
    if (v.sourceUid !== '382486276' || !/^BV[\da-zA-Z]{10}$/.test(v.bvid) || !/^\d+$/.test(String(v.cid)) || !Number.isInteger(v.page) || v.page < 1 || !Number.isFinite(Date.parse(v.publishedAt)) || typeof v.subtitleText !== 'string' || v.subtitleText.length > 1000000) throw Error('来源校验失败');
  }
}
export function appendCandidates(history, candidates, bundle) {
  validateBundle(bundle);
  const added = [];
  const groups = new Map();
  for (const c of candidates) {
    const source = bundle.videos.find(v => v.bvid === c.bvid && v.page === c.page && v.sourceUid === c.sourceUid);
    if (!source || !Number.isSafeInteger(c.priceCents) || c.priceCents < 100 || c.priceCents > 500000 || !c.evidence?.text) throw Error('候选证据无效');
    // Unassigned amounts stay in the private local audit, not an invented public model row.
    if (c.modelCandidates?.length !== 1) continue;
    const key = JSON.stringify([c.bvid,c.page,c.modelCandidates[0].grade,c.modelCandidates[0].modelName]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({c,source});
  }
  for (const group of groups.values()) {
    const eligible = group.filter(({c}) => c.currency === 'CNY' && c.issues.every(issue => issue === 'implicit_cny_unit' && c.modelMatch?.method === 'title_catalog_alias'));
    const direct = eligible.filter(({c}) => c.priceLabel !== '百亿（字幕原称）');
    const pool = direct.length ? direct : eligible;
    const uniqueAmounts = new Set(pool.map(({c})=>c.priceCents));
    const safe = pool.length > 0 && uniqueAmounts.size === 1;
    const {c,source} = (safe ? pool : group)[0];
    const model = c.modelCandidates[0];
    const alternatives = safe ? eligible.filter(row => row.c !== c && row.c.priceLabel === '百亿（字幕原称）').map(({c:alt})=>({label:alt.priceLabel,priceCents:alt.priceCents,quoteText:alt.evidence.text,startSeconds:alt.evidence.startSeconds,page:alt.page})) : [];
    const semantic = `${c.bvid}:${c.page}:${c.evidence.startSeconds}:${c.priceCents}:${model.grade}:${model.modelName}`;
    const id = `local-auto:${createHash('sha256').update(semantic).digest('hex').slice(0,24)}`;
    if (history.records.some(r => r.id === id)) continue;
    // Preserve existing human reviewed/title-crosschecked observations rather than supersede them.
    if (history.records.some(r => r.bvid === c.bvid && r.grade === model.grade && r.modelName === model.modelName && r.status !== 'pending')) continue;
    const record = { id, bvid: c.bvid, sourceUid: source.sourceUid, sourceAccount: source.sourceAccount,
      videoTitle: source.title, videoUrl: `https://www.bilibili.com/video/${c.bvid}/`,
      modelName: model.modelName, grade: model.grade, scale: null, priceCents: safe ? c.priceCents : null,
      originalPriceCents: null, priceType: c.priceType, status: safe ? 'extracted' : 'pending', confidence: safe ? 65 : 30,
      extractionMethod: 'local_auto_subtitle', publishedAt: source.publishedAt, observedAt: bundle.exportedAt,
      notes: safe ? `字幕与标题型号词表对应，${c.priceLabel || '视频报价'}；省略币种的口播金额按人民币理解，未核对原视频。等级沿用标题，同型号具体版本仍需确认。历史报价不保证仍可购买。${group.some(row=>!eligible.includes(row)) ? '另有盒况、历史价或其他条件不明的候选，未作为可用价格。' : ''}` : `候选金额 ${[...new Set(group.map(({c})=>c.priceCents/100))].join(' / ')} 元，待复核：${[...new Set(group.flatMap(({c})=>c.issues))].join('、') || '同型号多价格含义不明'}`,
      alternativePrices: alternatives.filter((alt,i,all)=>all.findIndex(a=>a.label===alt.label && a.priceCents===alt.priceCents)===i),
      evidence: { text: c.evidence.text, startSeconds: c.evidence.startSeconds, endSeconds: c.evidence.endSeconds,
        cid: source.cid, page: source.page, language: source.language, subtitleKind: source.subtitleKind } };
    history.records.push(record); added.push(record);
  }
  history.meta = { ...history.meta, lastLocalImportAt: bundle.exportedAt, lastLocalImportParts: bundle.videos.length,
    localCollection: { ok: bundle.collection?.ok === true, attemptedAt: bundle.collection?.attemptedAt || bundle.exportedAt,
      lastSuccessAt: bundle.collection?.lastSuccessAt || null } };
  return added;
}
