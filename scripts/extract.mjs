const GRADE = "MGSD|MGEX|PGU|RE\\/?100|HG|RG|MG|PG|EG|SD|FM";
export function parseMentions(value) {
  const text = String(value || "").normalize("NFKC");
  const regex = new RegExp(`(?:^|[\\s，、,。；;（(：:])(${GRADE})\\s*([A-Za-z0-9\\p{Script=Han}·ⅡⅢ\\-]{1,30})`, "giu");
  const found = [];
  for (const match of text.matchAll(regex)) {
    const grade = match[1].toUpperCase().replace(/^RE\/?100$/, "RE/100");
    const modelName = match[2].replace(/(?:到上次再版价格|到再版价格|券后|到手|现价|价格|背刺|降价|补款|再版|预定|到货|现货|等).*$/u, "").trim();
    if (modelName.length >= 2 && !found.some(r => r.grade === grade && r.modelName === modelName)) found.push({ grade, modelName });
  }
  return found;
}
export function findPrices(value) {
  const text = String(value || "").normalize("NFKC");
  if (/\d\s*(?:-|~|～|至|到)\s*\d|满\s*\d|减\s*\d|日元|JPY|美元|USD|港币|HKD/i.test(text)) return [];
  const regex = /(?:[¥￥]\s*(\d{1,5}(?:\.\d{1,2})?)|(?<![\d.])(\d{1,5}(?:\.\d{1,2})?)\s*(?:元|块))/g;
  return [...new Set([...text.matchAll(regex)].map(m => Math.round(Number(m[1] || m[2]) * 100)).filter(v => v >= 2000 && v <= 500000))];
}
export function extractArchive(item, uid) {
  const archive = item?.modules?.module_dynamic?.major?.archive;
  if (!archive) return null;
  const author = item.modules?.module_author;
  if (String(author?.mid) !== String(uid)) return null;
  const bvid = archive.bvid || archive.jump_url?.match(/BV[\da-zA-Z]{10}/)?.[0];
  const published = Number(author?.pub_ts);
  if (!/^BV[\da-zA-Z]{10}$/.test(bvid || "") || !Number.isFinite(published) || published <= 0) return null;
  return { bvid, sourceUid: String(uid), title: String(archive.title || ""), description: String(archive.desc || ""), publishedAt: new Date(published * 1000).toISOString() };
}
export function toRecords(video, account, now) {
  const text = `${video.title} ${video.description}`;
  const mentions = parseMentions(text);
  const prices = findPrices(text);
  // Multiple ungraded items often follow the first model. Never assign their prices to it.
  const listLike = /[、,，;；\n]|(?:以及|还有|和|等)/.test(text);
  const unique = mentions.length === 1 && prices.length === 1 && !listLike;
  return mentions.map(({ grade, modelName }) => ({
    id: `${video.bvid}:${grade}:${modelName}:${now}`,
    sourceAccount: account.name, sourceUid: account.uid,
    bvid: video.bvid, videoTitle: video.title, videoUrl: `https://www.bilibili.com/video/${video.bvid}/`,
    modelName, grade,
    scale: ["HG", "RG", "EG"].includes(grade) ? "1/144" : ["MG", "MGEX", "FM", "RE/100"].includes(grade) ? "1/100" : ["PG", "PGU"].includes(grade) ? "1/60" : null,
    priceCents: unique ? prices[0] : null, originalPriceCents: null,
    priceType: unique && /券后|到手/.test(text) ? "coupon" : "observed",
    status: unique ? "extracted" : "pending", confidence: unique ? 82 : 58,
    extractionMethod: unique ? "metadata_price_regex" : "metadata_model_regex",
    publishedAt: video.publishedAt, observedAt: now,
    evidence: { text, source: "public_video_metadata" },
    notes: unique ? "标题或简介中单一型号与单一价格自动匹配，尚未人工核对" : "已识别型号；画面、语音或多型号价格需要进一步复核",
  }));
}
