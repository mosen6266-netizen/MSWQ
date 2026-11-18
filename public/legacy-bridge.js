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
btn.textContent='↗ 发布到 MSWQ';
btn.title='把当前编辑器中的群剧本或个人流程保存到 MSWQ 云端';
btn.style.cssText='position:fixed;right:22px;bottom:22px;z-index:99999;background:#176345;color:#fff;border:1px solid #53bf8c;border-radius:12px;padding:12px 17px;font-size:13px;font-weight:800;box-shadow:0 9px 30px #0008;cursor:pointer';
document.body.appendChild(btn);
btn.onclick=()=>{show();};
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
 modal.innerHTML='<div style="width:min(620px,94vw);max-height:88vh;overflow:auto;border:1px solid #595e5a;border-radius:17px;background:#222425;color:#f6f6f5;padding:22px;box-shadow:0 30px 80px #000c"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong style="font-size:18px">同步到 MSWQ 在线前台</strong><button id="mswqClose" style="border:1px solid #555;background:#333;color:white;border-radius:8px;padding:5px 10px">关闭</button></div><p style="color:#adb3b1;font-size:12px;line-height:1.7">选择你在本编辑器中创建的流程。点击“保存草稿”只保存到后台；点击“立即发布”会生成可分享的公开链接。重复同步同一流程会更新之前的版本。</p><select id="mswqBridgeChoose" style="width:100%;background:#191b1c;color:#fff;border:1px solid #515351;border-radius:9px;padding:12px;margin:10px 0 18px">'+(all.length?all.map((x,i)=>'<option value="'+i+'">'+typeLabels[x.kind]+' · '+esc(x.data.name||'未命名')+'</option>').join(''):'<option>没有找到编辑器数据</option>')+'</select><div style="display:flex;gap:9px;flex-wrap:wrap"><button id="mswqDraft" '+(all.length?'':'disabled')+' style="border:1px solid #797a7c;background:#383a3b;border-radius:10px;color:#fff;padding:10px 15px;cursor:pointer">保存到后台草稿</button><button id="mswqPublish" '+(all.length?'':'disabled')+' style="border:1px solid #56c991;background:#176b48;border-radius:10px;color:#fff;font-weight:bold;padding:10px 15px;cursor:pointer">立即发布到前台</button></div><div id="mswqBridgeMsg" style="white-space:pre-wrap;color:#acd9bd;font-size:12px;margin-top:15px;overflow-wrap:anywhere"></div></div>';
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
async function sync(all,publish){
 await sleep(350);
 const choice=Number($('#mswqBridgeChoose')?.value||0);
 // Re-read saved browser data to include last changes.
 const current=files().find(x=>x.kind===all[choice].kind&&x.data.id===all[choice].data.id)||all[choice];
 const {kind,data}=current;
 if(!data?.id)return report('没有有效流程标识，请先保存编辑器内容');
 const item=convert(data,kind),mapKey=kind+':'+data.id,remembered=mapped(),old=remembered[mapKey];
 $('#mswqPublish').disabled=true;$('#mswqDraft').disabled=true;
 const warnings=[];
 try{
  report('正在同步话术、步骤和图片附件…');
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
    }catch(err){warnings.push(file.name+': '+err.message)}
   }
  }
  if(publish)item.status='published';
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
  const saved=response.item;
  remembered[mapKey]={id:saved.id,slug:saved.slug};
  localStorage.setItem(KEY,JSON.stringify(remembered));
  const publicUrl=location.origin+'/view/'+encodeURIComponent(saved.slug);
  report((publish?'已成功发布':'已保存到草稿')+'：'+saved.title+(warnings.length?'\n⚠ '+warnings.length+' 个附件未同步，请在 MSWQ 内容管理中手动补上传':'')+'\n访问地址：'+publicUrl);
  const t=$('#mswqBridgeMsg');
  const a=document.createElement('a');a.href=publicUrl;a.target='_blank';a.rel='noopener';a.textContent='打开 '+(publish?'公开页面':'流程链接（草稿暂不可查看）')+' ↗';a.style.cssText='display:block;color:#92dcb4;margin-top:8px';
  t.appendChild(a);
 }catch(err){report('同步失败：'+(err?.message||String(err)))}
 finally{
  if($('#mswqPublish'))$('#mswqPublish').disabled=false;
  if($('#mswqDraft'))$('#mswqDraft').disabled=false;
 }
}
})();