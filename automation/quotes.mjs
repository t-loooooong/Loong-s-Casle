import { createHash } from 'node:crypto';
export function validateBundle(bundle) {
  if (bundle.schemaVersion !== 1 || bundle.producer !== 'subbatch-local-auto-v1' || !Array.isArray(bundle.videos) || bundle.videos.length > 2000 || !Number.isFinite(Date.parse(bundle.exportedAt))) throw Error('不是自动采集包');
  for (const v of bundle.videos) {
    if (v.sourceUid !== '382486276' || !/^BV[\da-zA-Z]{10}$/.test(v.bvid) || !/^\d+$/.test(String(v.cid)) || !Number.isInteger(v.page) || v.page < 1 || !Number.isFinite(Date.parse(v.publishedAt)) || typeof v.subtitleText !== 'string' || v.subtitleText.length > 1000000) throw Error('来源校验失败');
  }
  if(bundle.visualTasks!==undefined){
    if(!Array.isArray(bundle.visualTasks)||bundle.visualTasks.length>2000)throw Error('画面任务清单无效');
    for(const v of bundle.visualTasks)if(v.sourceUid!=='382486276'||!/^BV[\da-zA-Z]{10}$/.test(v.bvid)||!/^\d+$/.test(String(v.cid))||!Number.isInteger(v.page)||v.page<1||!Number.isFinite(Date.parse(v.publishedAt))||typeof v.title!=='string'||v.title.length>500)throw Error('画面任务来源校验失败');
  }
}
export function appendCandidates(history, candidates, bundle, options={}) {
  validateBundle(bundle);
  const added = [];
  const groups = new Map();
  for (const c of candidates) {
    const source = [...bundle.videos,...(bundle.visualTasks||[])].find(v => v.bvid === c.bvid && v.page === c.page && v.sourceUid === c.sourceUid);
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
    const hasVisual = group.some(({c})=>c.channels?.includes('visual'));
    const visualReview = group.some(({c})=>c.channels?.includes('visual') && c.issues.length>0);
    let safe = pool.length > 0 && uniqueAmounts.size === 1 && !visualReview;
    const {c,source} = (safe ? pool : hasVisual ? group.filter(({c})=>c.channels?.includes('visual')) : group)[0];
    const model = c.modelCandidates[0];
    const alternatives = safe ? eligible.filter(row => row.c !== c && row.c.priceLabel === '百亿（字幕原称）').map(({c:alt})=>({label:alt.priceLabel,priceCents:alt.priceCents,quoteText:alt.evidence.text,startSeconds:alt.evidence.startSeconds,page:alt.page})) : [];
    const semantic = `${c.bvid}:${c.page}:${c.evidence.startSeconds}:${c.priceCents}:${model.grade}:${model.modelName}`+(hasVisual?JSON.stringify(group.map(({c})=>[c.priceCents,c.channels,c.issues,c.evidence.text])):'');
    const id = `local-auto:${createHash('sha256').update(semantic).digest('hex').slice(0,24)}`;
    if (history.records.some(r => r.id === id)) continue;
    // Human review always wins. A new OCR conflict never silently overwrites an earlier known price.
    const same = history.records.filter(r => r.bvid === c.bvid && r.grade === model.grade && r.modelName === model.modelName);
    if (same.some(r=>r.status==='verified')) continue;
    const previous = [...same].reverse().find(r=>r.priceCents!==null&&r.status!=='pending');
    if (!hasVisual && previous) continue;
    if (hasVisual && previous && safe && previous.priceCents!==c.priceCents) safe=false;
    const preservePrice = hasVisual && !safe && previous ? previous.priceCents : null;
    const dual = hasVisual && group.some(({c})=>c.channels?.includes('subtitle'));
    const record = { id, bvid: c.bvid, sourceUid: source.sourceUid, sourceAccount: source.sourceAccount,
      videoTitle: source.title, videoUrl: `https://www.bilibili.com/video/${c.bvid}/`,
      modelName: model.modelName, grade: model.grade, scale: previous?.scale || null, priceCents: safe ? c.priceCents : preservePrice,
      originalPriceCents: null, priceType: c.priceType, status: safe ? 'extracted' : 'pending', confidence: safe ? 65 : 30,
      extractionMethod: hasVisual ? dual ? 'local_auto_dual' : 'local_auto_visual' : 'local_auto_subtitle', publishedAt: source.publishedAt, observedAt: options.observedAt || bundle.exportedAt,
      notes: safe ? `字幕与标题型号词表对应，${c.priceLabel || '视频报价'}；省略币种的口播金额按人民币理解，未核对原视频。等级沿用标题，同型号具体版本仍需确认。历史报价不保证仍可购买。${group.some(row=>!eligible.includes(row)) ? '另有盒况、历史价或其他条件不明的候选，未作为可用价格。' : ''}` : `候选金额 ${[...new Set(group.map(({c})=>c.priceCents/100))].join(' / ')} 元，待复核：${[...new Set(group.flatMap(({c})=>c.issues))].join('、') || '同型号多价格含义不明'}`,
      alternativePrices: alternatives.filter((alt,i,all)=>all.findIndex(a=>a.label===alt.label && a.priceCents===alt.priceCents)===i),
      evidence: { text: c.evidence.text, startSeconds: c.evidence.startSeconds, endSeconds: c.evidence.endSeconds,
        cid: source.cid, page: source.page, language: source.language, subtitleKind: source.subtitleKind,
        ...(hasVisual?{channels:dual?['subtitle','visual']:['visual'],visualFrames:group.flatMap(({c})=>c.evidence.visualFrames||[]).filter(f=>/^frame-\d{4}\.jpg$/.test(f.file)&&Number.isFinite(f.seconds)).map(f=>({file:f.file,seconds:f.seconds})).slice(0,12),subtitleEvidence:group.flatMap(({c})=>c.evidence.subtitleEvidence||[]).slice(0,20).map(e=>({text:String(e.text||'').slice(0,1000),startSeconds:e.startSeconds,endSeconds:e.endSeconds,priceCents:e.priceCents}))}:{}) } };
    if(hasVisual){
      record.evidence.text=[...new Set(group.map(({c})=>c.evidence.text))].join(' | ').slice(0,6000);
      record.confidence=safe?(dual?85:70):30;
      record.notes=`${dual?'字幕／转写与画面联合提取':'画面OCR提取'}，${c.priceLabel||'画面报价'}；${safe?'同一商品主价格区域在至少两张画面重复出现，仍非人工核对。':'条件、币种或字幕金额存在歧义，需人工复核。'}${preservePrice!==null?'保留此前已提取的价格，不用冲突金额覆盖；当前状态为待复核。':''}历史报价不保证仍可购买。截图仅保留在本机审计目录。`;
    }
    history.records.push(record); added.push(record);
  }
  history.meta = { ...history.meta, lastLocalImportAt: bundle.exportedAt, lastLocalImportParts: bundle.videos.length,
    localCollection: { ok: bundle.collection?.ok === true, attemptedAt: bundle.collection?.attemptedAt || bundle.exportedAt,
      lastSuccessAt: bundle.collection?.lastSuccessAt || null } };
  if(options.visualSummary)history.meta.visualCollection=options.visualSummary;
  return added;
}
