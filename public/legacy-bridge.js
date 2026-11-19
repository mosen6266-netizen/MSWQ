/* MSWQ bridge for the original user-supplied editor.
   Runs ONLY inside authenticated /admin/legacy-editor.
   Never publishes without the administrator pressing a publish button. */
(()=>{
'use strict';
const $=s=>document.querySelector(s),KEY='mswq.bridgeMap.v1';
const get=k=>{try{return JSON.parse(localStorage.getItem(k)||'null')}catch{return null}};
const mapped=()=>get(KEY)||{};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const typeLabels={personal:'个人流程',group:'群剧本'};
const modal=document.createElement('div');
modal.id='mswqBridgeModal';
modal.style.cssText='position:fixed;inset:0;z-index:999999;background:#000d;display:none;align-items:center;justify-content:center;padding:20px;font-family:system-ui,Microsoft YaHei,sans-serif';
document.body.appendChild(modal);
const btn=document.createElement('button');
btn.textContent='☁ 保存草稿 / 发布到前端';
btn.title='把当前编辑器中的群剧本或个人流程保存到 MSWQ 云端';
btn.style.cssText='position:fixed;right:22px;bottom:22px;z-index:99999;background:#176345;color:#fff;border:1px solid #53bf8c;border-radius:12px;padding:12px 17px;font-size:13px;font-weight:800;box-shadow:0 9px 30px #0008;cursor:pointer';
document.body.appendChild(btn);
btn.onclick=()=>{show();};
// Keep a visible publish control beside the personal-flow editing tools.
const personalActions=document.querySelector('.p-side-action-grid');
if(personalActions){
 const quick=document.createElement('button');
 quick.type='button';quick.className='p-btn small';quick.textContent='☁ 保存 / 发布到前端';
 quick.style.cssText='grid-column:1 / -1;background:#18563e;border:1px solid #4caf83;color:#f6fff8;font-weight:800';
 quick.onclick=show;personalActions.appendChild(quick);
}
// The multi-flow export dialog can also publish exactly the checked flows.
// Exporting HTML is deliberately kept separate from publishing.
const mergeExport=document.getElementById('pMergeReaderExport');
if(mergeExport){
 const mergePublish=document.createElement('button');
 mergePublish.id='mswqPublishSelected';
 mergePublish.type='button';mergePublish.className='p-btn green';
 mergePublish.textContent='☁ 发布所选到前端';
 mergePublish.title='把勾选的每一套个人流程发布为独立网页，可在MSWQ首页看到';
 mergeExport.insertAdjacentElement('afterend',mergePublish);
 const info=document.createElement('div');
 info.id='mswqMergePublishResults';
 info.style.cssText='font-size:12px;line-height:1.75;color:#b8e8cc;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto';
 mergeExport.closest('.p-dialog-body')?.insertBefore(info,mergeExport.parentElement);
 mergePublish.onclick=publishMergeSelected;
}

async function req(path,options={}){
 const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 const j=await r.json();if(!r.ok)throw new Error(j.error||'请求失败');
 return j;
}
function files(){
 const group=get('groupScriptManager.v6')?.scripts||[],personal=get('personalFlowWorkspace.v1')?.flows||[];
 return [...personal.map(v=>({kind:'personal',data:v})),...group.map(v=>({kind:'group',data:v}))];
}
function close(){modal.style.display='none';modal.innerHTML='';}
function show(){
 const all=files();
 modal.style.display='flex';
 modal.innerHTML='<div style="width:min(620px,94vw);max-height:88vh;overflow:auto;border:1px solid #595e5a;border-radius:17px;background:#222425;color:#f6f6f5;padding:22px;box-shadow:0 30px 80px #000c"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong style="font-size:18px">同步到 MSWQ 在线前台</strong><button id="mswqClose" style="border:1px solid #555;background:#333;color:white;border-radius:8px;padding:5px 10px">关闭</button></div><p style="color:#adb3b1;font-size:12px;line-height:1.7">选择要发布的流程，系统直接上传与本编辑器「导出纯查看版 HTML」一致的原版页面。不会改用 MSWQ 的其它阅读样式。已经发布过的旧流程也可在这里重新发布一次，公开链接不变。</p><select id="mswqBridgeChoose" style="width:100%;background:#191b1c;color:#fff;border:1px solid #515351;border-radius:9px;padding:12px;margin:10px 0 18px">'+(all.length?all.map((x,i)=>'<option value="'+i+'">'+typeLabels[x.kind]+' · '+esc(x.data.name||'未命名')+'</option>').join(''):'<option>没有找到编辑器数据</option>')+'</select><div style="display:flex;gap:9px;flex-wrap:wrap"><button id="mswqDraft" '+(all.length?'':'disabled')+' style="border:1px solid #797a7c;background:#383a3b;border-radius:10px;color:#fff;padding:10px 15px;cursor:pointer">保存到后台草稿</button><button id="mswqPublish" '+(all.length?'':'disabled')+' style="border:1px solid #56c991;background:#176b48;border-radius:10px;color:#fff;font-weight:bold;padding:10px 15px;cursor:pointer">立即发布到前台</button></div><div id="mswqBridgeMsg" style="white-space:pre-wrap;color:#acd9bd;font-size:12px;margin-top:15px;overflow-wrap:anywhere"></div></div>';
 $('#mswqClose').onclick=close;
 if(!all.length)return;
 $('#mswqDraft').onclick=()=>sync(all,false);
 $('#mswqPublish').onclick=()=>sync(all,true);
}
function report(text){const t=$('#mswqBridgeMsg');if(t)t.textContent=text;}
async function readPersonalBlob(id){
 return new Promise((resolve,reject)=>{
  const o=indexedDB.open('PersonalFlowFilesV1',1);
  o.onupgradeneeded=()=>{if(!o.result.objectStoreNames.contains('files'))o.result.createObjectStore('files')};
  o.onerror=()=>reject(o.error||new Error('附件数据库打开失败'));
  o.onsuccess=()=>{
   const db=o.result;
   const tx=db.transaction('files','readonly'),rq=tx.objectStore('files').get(id);
   rq.onsuccess=()=>resolve(rq.result||null);
   rq.onerror=()=>reject(rq.error);
   tx.oncomplete=()=>db.close();
  };
 });
}
async function uploadBlob(blob,name,type){
 if(!blob||blob.size>12000000)throw Error('附件丢失或超过12MB限制: '+name);
 const ext=name.split('.').pop()?.toLowerCase();
 const accepted=['image/jpeg','image/png','image/gif','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain','application/zip'];
 const mime=accepted.includes(type)?type:({docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',zip:'application/zip'}[ext]||blob.type);
 if(!accepted.includes(mime))throw Error('文件类型不支持: '+name);
 const saved=await req('/api/admin/assets',{method:'POST',headers:{'content-type':mime,'x-file-name':encodeURIComponent(name)},body:blob});
 return {id:saved.asset.id,name};
}
function convert(v,kind){
 const arr=(v.steps||[]).map(st=>{
  const types={speech:'bilingual',note:'hint',wait:'wait',attachment:'file',link:'button',section:'section',text:'text'};
  return {id:crypto.randomUUID(),type:types[st.type]||'text',
    title:st.title||({speech:'双语话术',note:'绿色提示',wait:'等待步骤',attachment:'附件',link:'链接按钮',section:'流程分段'}[st.type]||'内容'),
    text:st.content||st.text||st.wait||'',zh:st.contentZh||st.zh||'',en:st.contentForeign||st.en||'',
    seconds:Math.max(1,Number(st.seconds)||(String(st.wait||'').includes('分钟')?60*Number.parseFloat(st.wait):Number.parseFloat(st.wait))||60),
    speakerId:st.actorId||st.speakerId||'',url:st.url||'',links:st.links||[],assetId:'',files:[],
    _sourceFiles:st.files||[]};
 });
 return {kind,title:v.name||'未命名流程',status:'draft',
  description:v.description||v.note||'',category:v.category||'',tags:Array.isArray(v.tags)?v.tags:[],
  sort_order:1000,slug:kind+'-'+String(v.id||crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g,'-'),
  content:{blocks:arr,members:(v.members||[]).map(m=>({id:m.id,name:m.name,label:m.no||'',role:m.role||''})),
   keywords:v.keywords||[],legacyMeta:{navOrder:v.navOrder||[],navDisabled:v.navDisabled||[],customNavGroups:v.customNavGroups||[],lang:v.lang||''}}};
}
let bridgePublishing=false;
async function sync(all,publish){
 if(bridgePublishing)return;
 const choice=Number($('#mswqBridgeChoose')?.value||0);
 const selected=all[choice];if(!selected)return report('请先选择一套流程');
 bridgePublishing=true;
 $('#mswqPublish')?.setAttribute('disabled','');
 $('#mswqDraft')?.setAttribute('disabled','');
 try{await syncOne(selected,publish,report)}
 finally{
  bridgePublishing=false;
  $('#mswqPublish')?.removeAttribute('disabled');
  $('#mswqDraft')?.removeAttribute('disabled');
 }
}
async function syncOne(selected,publish,notify=report){
 if(!selected)return {ok:false,error:'流程不存在'};
 // The personal editor debounces local changes; flush immediately before reading.
 if(selected.kind==='personal'&&typeof window.mswqSavePersonalFlowNow==='function'){
  if(window.mswqSavePersonalFlowNow()===false){
   notify('编辑内容未能保存到本机，请先导出备份并检查存储空间');
   return {ok:false,error:'本地保存失败'};
  }
 }
 await sleep(350);
 const current=files().find(x=>x.kind===selected.kind&&x.data.id===selected.data.id)||selected;
 const {kind,data}=current;
 if(!data?.id){notify('没有有效流程标识，请先保存编辑器内容');return {ok:false,error:'流程ID缺失'}}
 const item=convert(data,kind),mapKey=kind+':'+data.id,remembered=mapped();
 let old=remembered[mapKey];
 const warnings=[];
 try{
  if(typeof window.mswqBuildExactExportHtml!=='function')throw new Error('原版 HTML 生成器尚未加载，请刷新编辑器后重试');
  notify('正在生成与离线导出完全相同的 HTML 查看版…');
  const exportedHtml=await window.mswqBuildExactExportHtml(kind,data);
  const exportBytes=new Blob([exportedHtml],{type:'text/html;charset=utf-8'}).size;
  if(exportBytes>35_000_000)throw new Error('原版 HTML 大于35MB，请精简附件后重新发布');
  notify('HTML 已生成，正在同步素材与内容…');
  for(let i=0;i<item.content.blocks.length;i++){
   const b=item.content.blocks[i],sourceFiles=b._sourceFiles||[];
   delete b._sourceFiles;
   for(const file of sourceFiles){
    try{
     let blob=null;
     if(kind==='personal')blob=await readPersonalBlob(file.id);
     else if(file.data?.startsWith('data:'))blob=await (await fetch(file.data)).blob();
     if(!blob)throw Error('原文件不可读取');
     const media=await uploadBlob(blob,file.name||'附件',file.type||blob.type);
     b.files.push(media);
    }catch(err){warnings.push((file.name||'附件')+': '+err.message)}
   }
  }
  // Recover an existing published record by its stable slug even when the
  // browser-side publish map was cleared. This preserves the original shared URL.
  const listing=await req('/api/admin/items');
  const known=(listing.items||[]).find(x=>x.id===old?.id&&x.kind===kind)||
   (listing.items||[]).find(x=>x.kind===kind&&x.slug===item.slug);
  old=known?{id:known.id,slug:known.slug}:null;
  // Keep content unlisted until the exact HTML has been saved successfully.
  item.status='draft';
  let response;
  if(old?.id){
   try{
    const snapshot=await req('/api/admin/items/'+old.id);
    const previous=snapshot.item;
    item.id=old.id;item.version=previous.version;item.slug=previous.slug;
    response=await req('/api/admin/items/'+old.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(item)});
   }catch(err){
    if(err.message.includes('不存在'))response=null;
    else throw err;
   }
  }
  if(!response)response=await req('/api/admin/items',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(item)});
  let saved=response.item;
  notify('正文已保存，正在发布原版 HTML 文件…');
  const upload=await req('/api/admin/items/'+saved.id+'/export-html',{
   method:'PUT',
   headers:{'content-type':'text/html; charset=utf-8','x-mswq-item-version':String(saved.version)},
   body:exportedHtml
  });
  if(!upload.stored||upload.backButton!==true)throw new Error('服务器未确认返回首页按钮，已阻止本次发布，请刷新重试');
  if(publish){
   const published={...saved,status:'published'};
   const result=await req('/api/admin/items/'+saved.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(published)});
   saved=result.item;
  }
  remembered[mapKey]={id:saved.id,slug:saved.slug};
  localStorage.setItem(KEY,JSON.stringify(remembered));
  const publicUrl=location.origin+'/view/'+encodeURIComponent(saved.slug);
  notify((publish?'原版 HTML 已成功发布':'原版 HTML 已保存为草稿')+'：'+saved.title+(warnings.length?'\\n⚠ '+warnings.length+' 个附件未同步，请在 MSWQ 素材库补充':'')+'\\n访问地址：'+publicUrl);
  if(notify===report){
   const target=$('#mswqBridgeMsg');
   if(target){
    const a=document.createElement('a');a.href=publicUrl;a.target='_blank';a.rel='noopener';
    a.textContent=publish?'查看已发布的前台页面 ↗':'流程链接（草稿尚未公开）';
    a.style.cssText='display:block;color:#92dcb4;margin-top:8px';target.appendChild(a);
   }
  }
  return {ok:true,saved,url:publicUrl,warnings};
 }catch(err){
  const message=err?.message||String(err);
  notify('同步失败：'+message);return {ok:false,error:message};
 }
}
async function publishMergeSelected(){
 if(bridgePublishing)return;
 const flowIds=typeof window.mswqSelectedPersonalFlowIds==='function'
  ?window.mswqSelectedPersonalFlowIds()
  :[...document.querySelectorAll('#pMergeReaderList [data-merge-id]:checked')].map(x=>x.dataset.mergeId);
 if(!flowIds.length){alert('请先勾选需要发布的个人流程');return}
 const all=files().filter(x=>x.kind==='personal');
 const selected=flowIds.map(id=>all.find(x=>x.data.id===id)).filter(Boolean);
 if(!selected.length){alert('所选流程尚未保存，请先保存内容');return}
 const info=$('#mswqMergePublishResults'),button=$('#mswqPublishSelected');
 const successes=[],failures=[];
 bridgePublishing=true;button.disabled=true;
 try{
  if(info)info.textContent='正在发布 '+selected.length+' 套个人流程…';
  for(let i=0;i<selected.length;i++){
   const result=await syncOne(selected[i],true,message=>{
    if(info)info.textContent='('+ (i+1) +'/'+selected.length+') '+message;
   });
   if(result.ok)successes.push(result);
   else failures.push((selected[i].data.name||'未命名')+'：'+result.error);
  }
  if(info){
   info.replaceChildren();
   const heading=document.createElement('div');
   heading.textContent='已发布 '+successes.length+' 套'+(failures.length?'，失败 '+failures.length+' 套':'')+'。每套流程都有独立访问链接：';
   info.appendChild(heading);
   for(const result of successes){
    const a=document.createElement('a');a.href=result.url;a.target='_blank';a.rel='noopener';
    a.textContent='↗ '+result.saved.title;
    a.style.cssText='display:block;color:#8fe1b0;text-decoration:underline;margin-top:5px';info.appendChild(a);
   }
   if(failures.length){
    const err=document.createElement('div');err.textContent=failures.join('\\n');
    err.style.color='#ffc5c5';info.appendChild(err);
   }
  }
 }finally{
  bridgePublishing=false;button.disabled=false;
 }
}

})();