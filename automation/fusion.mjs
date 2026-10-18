const key=c=>JSON.stringify([c.bvid,c.page,c.modelCandidates?.[0]?.grade,c.modelCandidates?.[0]?.modelName]);
function near(a,b){
  const x=a.evidence?.startSeconds,y=a.evidence?.endSeconds??x,u=b.evidence?.startSeconds,v=b.evidence?.endSeconds??u;
  return [x,y,u,v].every(Number.isFinite)&&x<=v+3&&u<=y+3;
}
export function fuseCandidates(subtitles,visuals){
  const output=subtitles.map(c=>({...c,channels:['subtitle']})),used=new Set();
  for(const picture of visuals){
    if(picture.modelCandidates?.length!==1)continue;
    const peers=output.filter(c=>c.channels.length===1&&c.channels[0]==='subtitle'&&c.priceLabel!=='百亿（字幕原称）'&&key(c)===key(picture)&&near(c,picture));
    const current=peers.filter(c=>!c.issues.some(issue=>['historical_or_expired_price','availability_or_payment_conditions','range_or_discount_conditions','bundle_not_individual_price'].includes(issue)));
    const match=current.find(c=>c.priceCents===picture.priceCents&&c.currency==='CNY');
    const conflict=current.some(c=>c.priceCents!==picture.priceCents||c.currency!=='CNY');
    const channels=peers.length?['subtitle','visual']:['visual'];
    const issues=[...new Set([...(picture.issues||[]),...(conflict?['subtitle_screen_conflict']:[])])];
    if(match)issues.push(...match.issues.filter(issue=>issue!=='implicit_cny_unit'&&issue!=='multiple_prices'));
    // A subtitle price under ambiguous box/deposit conditions must not silently validate a screen amount.
    if(!match&&peers.length&&!current.length)issues.push('subtitle_conditions_need_review');
    const fused={...picture,channels,issues:[...new Set(issues)],evidence:{...picture.evidence,
      subtitleEvidence:peers.map(c=>({text:c.evidence.text,startSeconds:c.evidence.startSeconds,endSeconds:c.evidence.endSeconds,priceCents:c.priceCents,issues:c.issues})),
      text:picture.evidence.text+(peers.length?' | 字幕：'+peers.map(c=>c.evidence.text).join(' / '):'')},
      modelMatch:{method:match?'subtitle_screen_crosscheck':'screen_title_catalog'}};
    peers.forEach(c=>used.add(c));output.push(fused);
  }
  return output.filter(c=>!used.has(c));
}
