// Product presentation data is separate from quote history and local collection state.
export function attachProductImages(records, products) {
  if(!Array.isArray(products))throw Error('Invalid product image catalog');
  const keys=new Set();
  for(const product of products){
    const image=product.image;
    if(!product.id || !product.grade || !product.scale || !Array.isArray(product.modelNames) || !product.modelNames.length || !image?.alt || !image.credit || !image.note || !image.caption)throw Error('Incomplete product image metadata');
    const url=new URL(image.url),source=new URL(image.sourceUrl);
    if(url.protocol!=='https:' || url.hostname!=='bandai-a.akamaihd.net' || source.protocol!=='https:' || source.hostname!=='www.bandaispirits.co.jp')throw Error('Unapproved product image source');
    for(const name of product.modelNames){const key=JSON.stringify([product.grade,name,product.scale]);if(keys.has(key))throw Error('Ambiguous product image mapping');keys.add(key);}
  }
  return records.map(record=>{
    const match=products.find(p=>p.grade===record.grade && p.scale===record.scale && p.modelNames.includes(record.modelName));
    return match ? {...record,productImage:{...match.image,productId:match.id}} : {...record};
  });
}
