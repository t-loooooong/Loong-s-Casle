const ORIGIN='https://bandaihobbysite.cn';
export const IMAGE_HOSTS=new Set(['bandai-a.akamaihd.net','staticcdn.bandaihobbysite.cn']);
export const SOURCE_HOSTS=new Set(['www.bandaispirits.co.jp','bandaihobbysite.cn']);
export function safeOfficialUrl(value,hosts){try{const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && !u.port && hosts.has(u.hostname);}catch{return false;}}
const decode=s=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
export function productIdentity(title){
  const clean=title.normalize('NFKC').trim();
  const match=clean.match(/^(MGSD|MGEX|PGU|RE\/?100|RG|MG|PG|EG|SD|FM|HG(?:UC|CE|BF|AC|AW|FC|AGE)?)(?=\s|\d|[^A-Za-z])/i);
  if(!match)return null;
  let grade=match[1].toUpperCase();if(grade.startsWith('HG'))grade='HG';if(grade==='RE100')grade='RE/100';
  const rest=clean.slice(match[0].length).trim();
  const scale=rest.match(/^(1\s*\/\s*\d+)\s*/)?.[1]?.replace(/\s/g,'') || (grade==='MGSD'?'SD':'未标比例');
  const name=rest.replace(/^1\s*\/\s*\d+\s*/,'').replace(/^[A-Z]{1,5}-[A-Z0-9-]+\s+/i,'').trim();
  return {grade,scale,name};
}
export const normalizeName=name=>name.normalize('NFKC').toLowerCase().replace(/(?:高达|敢达|钢弹)/g,'').replace(/[\s\-‐－・·]/g,'');
export function parseOfficialCards(html){
  const cards=[];
  for(const match of html.matchAll(/<a\b[^>]*href="([^"<>]*\/detail\/id\/\d+)"[^>]*class="c-card[^"<>]*"[^>]*>([\s\S]*?)<\/a>/g)){
    const image=match[2].match(/<img\b[^>]*src="([^"<>]+)"[^>]*alt="([^"<>]+)"/);
    if(!image)continue;
    const sourceUrl=new URL(decode(match[1]),ORIGIN).href,url=new URL(decode(image[1]),ORIGIN).href,title=decode(image[2]).trim();
    if(safeOfficialUrl(sourceUrl,SOURCE_HOSTS) && safeOfficialUrl(url,IMAGE_HOSTS))cards.push({title,sourceUrl,url,...productIdentity(title)});
  }
  return cards;
}
export async function searchOfficialProducts(keyword, fetcher=fetch){
  const response=await fetcher(`${ORIGIN}/item_all?keyword=${encodeURIComponent(keyword)}`,{signal:AbortSignal.timeout(6500)});
  if(!response.ok)throw Error(`Official catalog HTTP ${response.status}`);
  const text=await response.text();if(text.length>2000000)throw Error('Oversized catalog response');
  return parseOfficialCards(text);
}
export function selectExactProduct(record,cards,officialNames=[record.modelName]){
  if(record.grade==='OTHER')return null;
  const names=new Set(officialNames.map(normalizeName).filter(Boolean));
  if(!names.size)return null;
  const matched=cards.filter(c=>c.grade===record.grade && names.has(normalizeName(c.name || '')) && (!record.scale || c.scale===record.scale));
  const unique=[...new Map(matched.map(c=>[c.sourceUrl,c])).values()];
  return unique.length===1 ? unique[0] : null;
}
export function imageCatalogEntry(record,card){
  return {id:'official-cn-'+card.sourceUrl.match(/\/id\/(\d+)/)[1],grade:record.grade,modelNames:[record.modelName],scale:card.scale,allowUnknownScale:true,
    image:{url:card.url,alt:card.title,sourceUrl:card.sourceUrl,sourceName:'BANDAI HOBBY SITE（中国内地）',credit:'图片来源：万代官方商品资料；版权归各权利人所有',caption:'官方参考图，非卖家实拍',note:`参考商品：${card.title}；报价具体版本及盒况以原视频和卖家信息为准。`}};
}
export async function discoverProductImages(records,catalog,{fetcher=fetch,maxSearches=8,priorAttempts={},now=Date.now()}={}){
  const products=[...catalog.products], audit=[];let searches=0;
  const attempts={...priorAttempts},deadline=Date.now()+18000;
  const blocked=new Set((catalog.unresolved||[]).map(x=>JSON.stringify([x.grade,x.modelName])));
  const unique=[...new Map(records.map(r=>[JSON.stringify([r.grade,r.modelName]),r])).values()];
  for(const record of unique){
    if(products.some(p=>p.grade===record.grade&&p.modelNames.includes(record.modelName)))continue;
    if(blocked.has(JSON.stringify([record.grade,record.modelName])) || record.grade==='OTHER'){audit.push({grade:record.grade,modelName:record.modelName,status:'needs_identity'});continue;}
    const key=JSON.stringify([record.grade,record.modelName]);
    if(attempts[key] && now-Date.parse(attempts[key])<86400000){audit.push({grade:record.grade,modelName:record.modelName,status:'retry_later'});continue;}
    if(searches++>=maxSearches || Date.now()>deadline){audit.push({grade:record.grade,modelName:record.modelName,status:'search_budget'});continue;}
    attempts[key]=new Date(now).toISOString();
    try{const cards=await searchOfficialProducts(record.modelName,fetcher),match=selectExactProduct(record,cards);
      if(match){products.push(imageCatalogEntry(record,match));audit.push({grade:record.grade,modelName:record.modelName,status:'matched',sourceUrl:match.sourceUrl});}
      else audit.push({grade:record.grade,modelName:record.modelName,status:'no_unique_match'});
    }catch{audit.push({grade:record.grade,modelName:record.modelName,status:'source_unavailable'});}
  }
  return {products,audit,attempts};
}
