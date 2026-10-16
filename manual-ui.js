(() => {
  const $=selector=>document.querySelector(selector);
  const dialog=$('#manual-dialog'),form=$('#manual-form'),message=$('#manual-message'),submit=$('#manual-submit');
  const storageKey='gunpla.manual-pending.v1';
  let target=null,photo=null,imageLoading=false,imageVersion=0,previewUrl=null,busy=false,pollTimer=null,pollCount=0;
  let pending=[];
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))pending=saved.filter(row=>/^[a-f0-9-]{36}$/i.test(row.id)&&typeof row.name==='string').slice(-50);}catch{}
  const persist=()=>{try{localStorage.setItem(storageKey,JSON.stringify(pending));}catch{}};
  function publishStatus(meta=state.meta){
    const receipts=new Set(meta.manualReceipts||[]),published=pending.filter(row=>receipts.has(row.id));
    pending=pending.filter(row=>!receipts.has(row.id));persist();
    $('#manual-publish-status').textContent=published.length?`已确认全站发布：${published.map(row=>row.name).join('、')}${pending.length?`；另有 ${pending.length} 个发布包等待同步`:''}`:pending.length?`${pending.length} 个手动发布包等待同步。请确认文件在 Desktop\\SubBatchAuto，且本机发布程序已重新启动；同步成功后还需等待 EdgeOne 部署。`:'';
    if(!pending.length&&pollTimer){clearTimeout(pollTimer);pollTimer=null;}
  }
  globalThis.manualDataLoaded=publishStatus;
  async function poll(){
    pollTimer=null;
    if(!pending.length||pollCount++>=20)return;
    try{
      const response=await fetch('/data/prices.json',{cache:'no-store'});
      if(response.ok){
        const data=await response.json();
        if(Array.isArray(data.records)&&data.meta?.manualReceipts){
          const oldGrade=els.grade.value;
          state.quotes=data.records;state.meta=data.meta;setGrades();
          if([...els.grade.options].some(option=>option.value===oldGrade))els.grade.value=oldGrade;
          render();publishStatus(data.meta);
        }
      }
    }catch{ /* Do not label a saved package as published on network failure. */ }
    if(pending.length)pollTimer=setTimeout(poll,15000);
  }
  function schedulePoll(){pollCount=0;if(!pollTimer&&pending.length)pollTimer=setTimeout(poll,15000);}
  function clearPhoto(){photo=null;imageVersion++;imageLoading=false;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;$('#manual-preview').hidden=true;$('#manual-preview').removeAttribute('src');}
  function openEditor(item=null){
    if(busy)return;
    form.reset();clearPhoto();target=item?{modelName:item.modelName,grade:item.grade,scale:item.scale||''}:null;
    const isImage=!!target;
    $('#manual-title').textContent=isImage?'上传／更换商品照片':'添加商品';
    $('#manual-product-fields').hidden=isImage;
    $('#manual-product-fields').querySelectorAll('input,select,textarea').forEach(input=>{input.disabled=isImage;});
    $('#manual-target').hidden=!isImage;
    $('#manual-target').textContent=isImage?`${displayGrade(target.grade)} · ${target.modelName} · ${target.scale||'比例未标注'}。图片将应用于所有完全匹配的记录，原价格保持不变。`:'';
    $('#manual-photo').required=isImage;$('#manual-photo-optional').hidden=isImage;
    $('#manual-date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    message.textContent='';submit.disabled=false;dialog.showModal();
  }
  $('#add-product').addEventListener('click',()=>openEditor());
  $('#manual-close').addEventListener('click',()=>{if(!busy)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  els.rows.addEventListener('click',event=>{
    const button=event.target.closest('[data-image-record]');
    if(button){const item=state.quotes.find(row=>row.id===button.dataset.imageRecord);if(item)openEditor(item);}
  });
  $('#manual-photo').addEventListener('change',async()=>{
    clearPhoto();const file=$('#manual-photo').files[0];if(!file)return;
    const version=imageVersion;
    imageLoading=true;submit.disabled=true;message.textContent='正在处理照片…';
    let bitmap;
    try{
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw Error('请选择不超过15MB的 JPG、PNG 或 WebP 照片');
      bitmap=await createImageBitmap(file);
      if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>50000000)throw Error('照片像素过大，请先缩小');
      const ratio=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
      const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.84));
      if(blob?.size>1000000)blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.65));
      if(!blob||blob.size>1000000)throw Error('处理后的照片仍超过1MB，请换一张较小的照片');
      const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('照片读取失败'));reader.readAsDataURL(blob);});
      if(version!==imageVersion)return;
      photo={base64:dataUrl.split(',')[1]};previewUrl=URL.createObjectURL(blob);
      $('#manual-preview').src=previewUrl;$('#manual-preview').hidden=false;message.textContent=`照片已准备好（${Math.ceil(blob.size/1024)}KB），尚未发布。`;
    }catch(error){if(version===imageVersion){photo=null;message.textContent=error.message||'照片无法读取，请更换图片';$('#manual-photo').value='';}}
    finally{bitmap?.close();if(version===imageVersion){imageLoading=false;submit.disabled=false;}}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||imageLoading||!form.reportValidity())return;
    if(target&&!photo){message.textContent='请先选择商品照片';return;}
    let product;
    try{
      if(!target){
        const price=$('#manual-price').value.trim();
        if(price&&!/^\d+(?:\.\d{1,2})?$/.test(price))throw Error('价格最多保留两位小数');
        product={modelName:$('#manual-name').value.trim(),grade:$('#manual-grade').value,scale:$('#manual-scale').value.trim(),priceCents:price?Math.round(Number(price)*100):null,priceDate:$('#manual-date').value,sourceUrl:$('#manual-source').value.trim(),notes:$('#manual-notes').value.trim()};
        if(!product.modelName)throw Error('请填写商品名称');
        if(product.sourceUrl&&!safeSource(product.sourceUrl))throw Error('来源网址请使用不含账号密码的 HTTPS 链接');
        if(state.quotes.some(row=>displayGrade(row.grade)===displayGrade(product.grade)&&row.modelName===product.modelName&&(row.scale||'')===product.scale))throw Error('商品已存在，请关闭此窗口，使用该行的“上传／更换图片”');
      }
      const requestId=crypto.randomUUID();
      const bundle={schemaVersion:1,producer:'gunpla-manual-v1',requestId,createdAt:new Date().toISOString(),action:target?'set-image':'add-product',...(target?{target}:{product}),image:photo};
      const blob=new Blob([JSON.stringify(bundle)],{type:'application/json'}),filename=`manual-${requestId}.json`;
      busy=true;submit.disabled=true;
      let fallback=false;
      if(typeof showSaveFilePicker==='function'){
        // Keep picker in the submit gesture, before any asynchronous processing.
        const handle=await showSaveFilePicker({id:'gunpla-manual-publish',startIn:'desktop',suggestedName:filename,types:[{description:'胶价雷达全站发布包',accept:{'application/json':['.json']}}]});
        const stream=await handle.createWritable();await stream.write(blob);await stream.close();
      }else{
        fallback=true;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
      }
      const name=target?.modelName||product.modelName;
      pending.push({id:requestId,name});persist();publishStatus();schedulePoll();
      message.textContent=fallback?'已发起下载，尚未全站发布。请将下载的 manual-…json 移到 Desktop\\SubBatchAuto 文件夹。':'发布包已保存，尚未全站发布。若未保存到桌面的 SubBatchAuto 文件夹，请将文件移入；本机程序推送并完成部署后才对全站可见。';
      submit.hidden=true;
    }catch(error){message.textContent=error.name==='AbortError'?'已取消保存，没有提交发布。':error.message||'保存失败，请重试';}
    finally{busy=false;submit.disabled=false;}
  });
  dialog.addEventListener('close',()=>{clearPhoto();submit.hidden=false;});
  publishStatus();schedulePoll();
})();
