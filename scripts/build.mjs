import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, initialize, readJson, writeJson, validateRecords, latestPerVideo, latestPerProduct } from "./dataset.mjs";
import { attachProductImages } from './product-images.mjs';
import {discoverProductImages}from'./official-product-search.mjs';
import {applyManual,emptyManual,imagePath}from'../automation/manual.mjs';
const history = await initialize();
validateRecords(history.records);
const config = await readJson("config/sources.json");
const check = await readJson("data/check-status.json", { lastAttemptAt: null, ok: null });
const imageCatalog = await readJson('config/product-images.json');
const cache=await readJson('data/product-image-cache.json',{schemaVersion:1,products:[],attempts:{}});
const curatedNames=new Set(imageCatalog.products.flatMap(p=>p.modelNames.map(name=>JSON.stringify([p.grade,name]))));
const cachedProducts=cache.products.filter(p=>p.modelNames.every(name=>!curatedNames.has(JSON.stringify([p.grade,name]))));
let products=[...imageCatalog.products,...cachedProducts], imageAudit=[];
const videoRecords=latestPerVideo(history.records);
const records=latestPerProduct(history.records);
if(process.argv.includes('--discover-images')){
  const discovered=await discoverProductImages(records,{...imageCatalog,products},{priorAttempts:cache.attempts});
  products=discovered.products;imageAudit=discovered.audit;
  await writeJson('data/product-image-cache.json',{schemaVersion:1,products:products.filter(p=>!imageCatalog.products.includes(p)),attempts:discovered.attempts});
}
const manual=await readJson('data/manual-products.json',emptyManual());
const enriched=latestPerProduct(applyManual(attachProductImages(history.records,products),manual));
const imageCoverage={withImage:enriched.filter(r=>r.productImage).length,total:enriched.length};
await mkdir(resolve(ROOT, "dist/data"), { recursive: true });
for (const file of ["index.html", "styles.css", "app.js", "manual-ui.js"]) await copyFile(resolve(ROOT, file), resolve(ROOT, "dist", file));
for(const url of new Set(manual.images.map(row=>row.url))){
  if(!imagePath(url))throw Error('Invalid manual image path');
  await mkdir(resolve(ROOT,'dist/uploads'),{recursive:true});
  await copyFile(resolve(ROOT,url.slice(1)),resolve(ROOT,'dist',url.slice(1)));
}
await writeJson("dist/data/prices.json", { schemaVersion: 1, records: enriched, meta: { ...history.meta, totalObservations: history.records.length, viewMode:'latest-per-product', hiddenOlderVideoRecords:videoRecords.length-records.length, scheduleLabel: config.scheduleLabel, check, imageCoverage, manualProducts:manual.products.length, manualReceipts:manual.receipts, manualUpdatedAt:manual.updatedAt||null } });
await writeJson('dist/data/product-image-report.json',{schemaVersion:1,coverage:imageCoverage,pending:enriched.filter(r=>!r.productImage).map(r=>({grade:r.grade,modelName:r.modelName,reason:imageCatalog.unresolved?.find(p=>p.grade===r.grade&&p.modelName===r.modelName)?.reason||'官方目录没有唯一匹配，等待补充商品名或版本'})),automaticSearch:imageAudit});
await writeJson("dist/data/history.json", history);
console.log(`Built static site: ${history.records.length} historical observations. No KV or server functions required.`);
