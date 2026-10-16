// Product presentation data is separate from quote history and local collection state.
import{safeOfficialUrl,IMAGE_HOSTS,SOURCE_HOSTS}from'./official-product-search.mjs';
export function attachProductImages(records, products) {
  if(!Array.isArray(products))throw Error('Invalid product image catalog');
  const keys=new Set();
  for(const product of products){
    const image=product.image;
    if(!product.id || !product.grade || !product.scale || !Array.isArray(product.modelNames) || !product.modelNames.length || !image?.alt || !image.credit || !image.note || !image.caption)throw Error('Incomplete product image metadata');
    if(!safeOfficialUrl(image.url,IMAGE_HOSTS) || !safeOfficialUrl(image.sourceUrl,SOURCE_HOSTS))throw Error('Unapproved product image source');
    for(const name of product.modelNames){const key=JSON.stringify([product.grade,name,product.scale]);if(keys.has(key))throw Error('Ambiguous product image mapping');keys.add(key);}
  }
  return records.map(record=>{
    const matches=products.filter(p=>p.grade===record.grade && (p.scale===record.scale || (!record.scale&&p.allowUnknownScale===true)) && p.modelNames.includes(record.modelName));
    const match=matches.length===1?matches[0]:null;
    return match ? {...record,productImageStatus:'matched',productImage:{...match.image,productId:match.id}} : {...record,productImage:undefined,productImageStatus:'pending'};
  });
}
