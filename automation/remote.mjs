// Compare-and-swap branch update; races retry from a fresh tree, never force-push.
export async function publishHistory(api, transform) {
  for(let attempt=0;attempt<3;attempt++) {
    const ref=await api('/git/ref/heads/main'), head=ref.object.sha;
    const commit=await api(`/git/commits/${head}`);
    const blob=await api(`/contents/data/history.json?ref=${head}`);
    if(blob.encoding!=='base64' || typeof blob.content!=='string')throw Error('远端数据格式异常');
    const history=JSON.parse(Buffer.from(blob.content,'base64').toString('utf8'));
    const count=transform(history);
    const tree=await api('/git/trees',{method:'POST',body:{base_tree:commit.tree.sha,tree:[{path:'data/history.json',mode:'100644',type:'blob',content:JSON.stringify(history,null,2)+'\n'}]}});
    const next=await api('/git/commits',{method:'POST',body:{message:`data: local subtitle check (${count} candidates)`,tree:tree.sha,parents:[head]}});
    try {await api('/git/refs/heads/main',{method:'PATCH',body:{sha:next.sha,force:false}});return count;}
    catch(e){if(![409,422].includes(e.status) || attempt===2)throw e;}
  }
}
