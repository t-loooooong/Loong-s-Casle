import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(resolve(ROOT, path), "utf8")); }
  catch (error) { if (error.code === "ENOENT" && fallback !== undefined) return fallback; throw error; }
}
export async function writeJson(path, value) {
  const target = resolve(ROOT, path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, target);
}
export const keyOf = (r) => JSON.stringify([r.sourceUid, r.bvid, r.grade, r.modelName]);
export function validateRecords(records) {
  if (!Array.isArray(records)) throw new Error("records must be an array");
  const ids = new Set();
  for (const r of records) {
    if (!r.modelName || !r.grade || !/^\d+$/.test(r.sourceUid) || !/^BV[\da-zA-Z]{10}$/.test(r.bvid)) throw new Error("Invalid quote identity");
    if (r.videoUrl !== `https://www.bilibili.com/video/${r.bvid}/`) throw new Error("Invalid video URL");
    if (!Number.isFinite(Date.parse(r.publishedAt))) throw new Error("Invalid publication date");
    if (r.priceCents !== null && (!Number.isSafeInteger(r.priceCents) || r.priceCents <= 0)) throw new Error("Invalid price");
    if (!["pending", "extracted", "verified"].includes(r.status)) throw new Error("Invalid status");
    if (r.status !== "pending" && r.priceCents === null) throw new Error("Missing confirmed/extracted price");
    if (ids.has(r.id)) throw new Error(`Duplicate quote ID: ${r.id}`);
    ids.add(r.id);
  }
}
// Preserve changed observations; missing prices never erase known prices.
export function mergeHistory(previous, discovered) {
  const records = [...previous];
  const latest = new Map();
  for (const record of records) latest.set(keyOf(record), record);
  for (const record of discovered) {
    const old = latest.get(keyOf(record));
    if (old && (old.status === "verified" || (old.priceCents !== null && record.priceCents === null))) continue;
    if (old && old.priceCents === record.priceCents && old.priceType === record.priceType && old.status === record.status) continue;
    const next = { ...record, id: `${record.bvid}:${record.grade}:${record.modelName}:${record.observedAt}` };
    records.push(next);
    latest.set(keyOf(next), next);
  }
  return records;
}
export function latestPerVideo(records) {
  const latest = new Map();
  for (const record of records) latest.set(keyOf(record), record);
  return [...latest.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}
export async function initialize() {
  const existing = await readJson("data/history.json", null);
  if (existing !== null) return existing;
  const seed = await readJson("seed.json");
  validateRecords(seed.records);
  const history = { schemaVersion: 1, records: seed.records, meta: { lastSyncAt: null, source: "initial_manual_records" } };
  await writeJson("data/history.json", history);
  return history;
}
