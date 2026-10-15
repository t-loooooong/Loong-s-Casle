import { setTimeout as delay } from "node:timers/promises";
import { initialize, readJson, writeJson, validateRecords, mergeHistory } from "./dataset.mjs";
import { extractArchive, toRecords } from "./extract.mjs";

export async function fetchFeed(account, config, knownVideos, fetchImpl = fetch) {
  const videos = new Map();
  let offset = "";
  const seenOffsets = new Set();
  const pagesLimit = config.maxPagesPerAccount;
  for (let page = 0; page < pagesLimit; page++) {
    const url = new URL("https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space");
    url.searchParams.set("host_mid", account.uid);
    url.searchParams.set("features", "itemOpusStyle");
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", Referer: `https://space.bilibili.com/${account.uid}/video`, "User-Agent": "Mozilla/5.0 (compatible; GunplaPriceRadar/2.0; daily-public-metadata)" },
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`Bilibili HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.code !== 0 || !Array.isArray(payload.data?.items)) throw new Error(`Bilibili code ${payload.code ?? "invalid response"}`);
    const batch = payload.data.items.map(item => extractArchive(item, account.uid)).filter(Boolean);
    for (const video of batch) videos.set(video.bvid, video);
    if (!payload.data.has_more) return { videos: [...videos.values()], pages: page + 1, coverage: "feed_end" };
    if (batch.length && batch.every(v => knownVideos.has(`${account.uid}:${v.bvid}`))) return { videos: [...videos.values()], pages: page + 1, coverage: "known_overlap" };
    const nextOffset = String(payload.data.offset || "");
    if (!payload.data.items.length || !nextOffset || seenOffsets.has(nextOffset)) throw new Error("Bilibili pagination stalled");
    seenOffsets.add(nextOffset);
    offset = nextOffset;
    if (page + 1 < pagesLimit) await delay(config.requestDelayMs);
  }
  return { videos: [...videos.values()], pages: pagesLimit, coverage: "recent_window_only" };
}
export async function collect() {
  const now = new Date().toISOString();
  const history = await initialize();
  try {
    const config = await readJson("config/sources.json");
    if (!Array.isArray(config.accounts) || !config.accounts.length || !Number.isInteger(config.maxPagesPerAccount) || config.maxPagesPerAccount < 1 || config.maxPagesPerAccount > 20) throw new Error("Invalid sources configuration");
    const manifest = await readJson("data/videos.json", { videos: [] });
    const known = new Map(manifest.videos.map(v => [`${v.sourceUid}:${v.bvid}`, v]));
    const discovered = [];
    const accounts = [];
    for (const account of config.accounts) {
      if (!/^\d+$/.test(account.uid) || !account.name) throw new Error("Invalid account");
      const result = await fetchFeed(account, config, known);
      for (const video of result.videos) {
        const key = `${account.uid}:${video.bvid}`;
        const previous = known.get(key);
        known.set(key, { ...video, firstSeenAt: previous?.firstSeenAt || now, lastSeenAt: now });
        discovered.push(...toRecords(video, account, now));
      }
      accounts.push({ uid: account.uid, videosChecked: result.videos.length, pages: result.pages, coverage: result.coverage });
      await delay(config.requestDelayMs);
    }
    const records = mergeHistory(history.records, discovered);
    validateRecords(records);
    await writeJson("data/history.json", { schemaVersion: 1, records, meta: { ...history.meta, lastSyncAt: now, source: "bilibili_public_video_metadata", accounts } });
    await writeJson("data/videos.json", { videos: [...known.values()] });
    await writeJson("data/check-status.json", { lastAttemptAt: now, ok: true, addedObservations: records.length - history.records.length, accounts });
    console.log(`Checked ${accounts.reduce((sum, a) => sum + a.videosChecked, 0)} videos; added ${records.length - history.records.length} observations.`);
  } catch (error) {
    await writeJson("data/check-status.json", { lastAttemptAt: now, ok: false, error: "本次采集未完成，保留上次数据；请查看 GitHub Actions 日志。" });
    throw error;
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/collect.mjs")) collect().catch(error => { console.error(error.message); process.exitCode = 1; });
