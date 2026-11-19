/* MSWQ-owned test adaptation of MS_KHMB document API. Do not deploy separately. */
(()=>{
const RESP_HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const respond=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...RESP_HEADERS,'Content-Type':'application/json; charset=utf-8'}});
const error=(message,status=400)=>respond({error:message},status);
const parse=async request=>{try{return await request.json();}catch{return null;}};
const safeName=v=>String(v||'').replace(/\.docx$/i,'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim().slice(0,150);
const textHash=async value=>{const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')};
async function authSettings(env){const row=await env.DB.prepare('SELECT value FROM app_state WHERE key = ?').bind('admin').first();const p=row?JSON.parse(row.value):null;if(!p?.salt||!p?.hash||!p.version)throw new Error('管理员密码尚未初始化');return p;}
// MSWQ test backend only. Authentication is enforced by MSWQ's /api/admin routing.
async function checkAdmin(request,env){return true;}
async function templates(env){const row=await env.DB.prepare('SELECT value FROM app_state WHERE key = ?').bind('templates').first();const a=row?JSON.parse(row.value):[];return Array.isArray(a)?a:[];}
async function setTemplates(env,a){await env.DB.prepare('INSERT INTO app_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('templates',JSON.stringify(a)).run();}
const sorted=a=>a.sort((x,y)=>(x.order??0)-(y.order??0)||(x.createdAt??0)-(y.createdAt??0));
function binaryResponse(ab,meta){return new Response(ab,{status:200,headers:{...RESP_HEADERS,'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':'inline; filename="template.docx"','Content-Length':String(ab.byteLength),'X-Template-Version':String(meta.contentVersion||1)}});}
const backend = {async fetch(request,env,ctx){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 // Independent visitor log: never interrupt the editor.
 if(method==='GET' && (path==='/' || path==='/index.html') && env.VISIT_DB){
   try{
     const rawId=url.searchParams.get('template')||'';
     const templateId=/^[a-f0-9-]{16,60}$/i.test(rawId)?rawId:'';
     const page='/MS-KHMB'+path+(templateId?'?template='+templateId:'');
     const ip=String(request.headers.get('CF-Connecting-IP')||'unknown').slice(0,64);
     const country=String((request.cf&&request.cf.country)||'XX').slice(0,2);
     const userAgent=String(request.headers.get('User-Agent')||'').slice(0,400);
     const write=env.VISIT_DB.prepare('INSERT INTO visits (visited_at,ip,country,path,user_agent,referer) VALUES (?,?,?,?,?,?)').bind(new Date().toISOString(),ip,country,page,userAgent,'').run();
     if(ctx&&typeof ctx.waitUntil==='function')ctx.waitUntil(write.catch(()=>{}));
     else await write.catch(()=>{});
   }catch(_){}
 }
 try {
  if(method==='GET'&&(path==='/'||path==='/index.html'))return new Response(HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
  if(method==='GET'&&path==='/favicon.ico')return new Response(null,{status:204});
  if(path==='/api/health'&&method==='GET')return respond({ok:true,name:'MS_KHMB',storage:'cloudflare-kv'});
  if(path==='/api/templates'&&method==='GET')return respond({templates:sorted(await templates(env))});
  // Public version probe; it returns no private visitor content.
  const versionRoute=path.match(/^\/api\/templates\/([a-f0-9-]{16,60})\/version$/);
  if(method==='GET'&&versionRoute){
    const id=versionRoute[1],list=await templates(env),meta=list.find(x=>x.id===id);
    if(!meta)return error('此模板已被管理员删除',404);
    return respond({id,contentVersion:meta.contentVersion||1,updatedAt:meta.updatedAt||null});
  }
  const fileRoute=path.match(/^\/api\/templates\/([a-f0-9-]{16,60})\/docx$/);
  if(method==='GET'&&fileRoute){
   const id=fileRoute[1],list=await templates(env),meta=list.find(x=>x.id===id);
   if(!meta)return error('未找到指定模板',404);
   const ab=await env.KHMB.get(meta.fileKey||('doc:'+id),'arrayBuffer');
   if(!ab)return error('模板文件缺失',404);
   return binaryResponse(ab,meta);
  }
  if(path==='/api/login'&&method==='POST'){
   const json=await parse(request);
   if(typeof json?.password!=='string'||json.password.length>512)return error('密码格式错误');
   const settings=await authSettings(env);
   const hash=await textHash(settings.salt+':'+json.password);
   if(hash!==settings.hash)return error('管理员密码错误',401);
   const token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
   await env.KHMB.put('session:'+token,settings.version,{expirationTtl:43200});
   return respond({token,expiresIn:43200});
  }
  if(path==='/api/session'&&method==='GET')return respond({admin:await checkAdmin(request,env)});
  if(path==='/api/logout'&&method==='POST'){
   const header=request.headers.get('Authorization')||'',token=header.startsWith('Bearer ')?header.slice(7):'';
   if(/^[a-f0-9]{64}$/.test(token))await env.KHMB.delete('session:'+token);
   return respond({ok:true});
  }
  if(!path.startsWith('/api/'))return error('页面不存在',404);
  if(!await checkAdmin(request,env))return error('需要管理员权限',401);
  if(path==='/api/password'&&method==='POST'){
   const json=await parse(request);
   if(typeof json?.oldPassword!=='string'||typeof json?.newPassword!=='string'||json.newPassword.length<6||json.newPassword.length>128)return error('新密码应为 6–128 位');
   const old=await authSettings(env);
   if(await textHash(old.salt+':'+json.oldPassword)!==old.hash)return error('原密码错误',403);
   const newSalt=[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
   const newVersion=crypto.randomUUID();
   await env.DB.prepare('INSERT INTO app_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('admin',JSON.stringify({salt:newSalt,hash:await textHash(newSalt+':'+json.newPassword),version:newVersion})).run();
   return respond({ok:true});
  }
  if(path==='/api/templates'&&method==='POST'){
   const name=safeName(url.searchParams.get('name')),filename=String(url.searchParams.get('filename')||'template.docx').slice(0,255);
   if(!name)return error('模板名称不能为空');
   const len=Number(request.headers.get('Content-Length')||0);
   if(len>MAX_SIZE)return error('DOCX 不能超过 8MB',413);
   const bytes=await request.arrayBuffer();
   if(!bytes.byteLength||bytes.byteLength>MAX_SIZE)return error('DOCX 不能为空或超过 8MB',413);
   const b=new Uint8Array(bytes);
   if(b[0]!==0x50||b[1]!==0x4b)return error('无效的 DOCX 文件格式');
   const list=await templates(env);
   if(list.length>=200) return error('共享模板上限为 200 份',409);
   const id=crypto.randomUUID(),createdAt=Date.now();
   const meta={id,name,filename,size:bytes.byteLength,outputName:'',order:list.length,createdAt,updatedAt:createdAt,contentVersion:1};
   await env.KHMB.put('doc:'+id,bytes);
   try{list.push(meta);await setTemplates(env,list);}catch(e){await env.KHMB.delete('doc:'+id).catch(()=>{});throw e;}
   return respond({id,template:meta},201);
  }
  // Undo the most recent shared DOCX content replacement; admin only.
  const revertRoute=path.match(/^\/api\/templates\/([a-f0-9-]{16,60})\/rollback$/);
  if(revertRoute&&method==='POST'){
    const id=revertRoute[1],list=await templates(env),idx=list.findIndex(x=>x.id===id);
    if(idx<0)return error('模板不存在',404);
    const currentVersion=list[idx].contentVersion||1;
    if(Number(request.headers.get('X-Template-Version'))!==currentVersion)return error('线上版本已更新，请刷新后再试',409);
    const old=await env.KHMB.get('previous-doc:'+id,'arrayBuffer');
    if(!old)return error('没有可恢复的上一个版本',404);
    const oldMeta=JSON.parse(await env.KHMB.get('previous-meta:'+id)||'{}');
    const meta={...list[idx]};
    const nowDoc=await env.KHMB.get(meta.fileKey||('doc:'+id),'arrayBuffer');
    if(!nowDoc)return error('当前模板内容缺失',404);
    await env.KHMB.put('previous-doc:'+id,nowDoc);
    await env.KHMB.put('previous-meta:'+id,JSON.stringify(meta));
    const newKey='doc:'+id+':v'+(currentVersion+1);
    await env.KHMB.put(newKey,old);
    list[idx]={...meta,size:old.byteLength,filename:oldMeta.filename||meta.filename,updatedAt:Date.now(),contentVersion:currentVersion+1,hasPrevious:true,fileKey:newKey};
    await setTemplates(env,list);
    return respond({ok:true,template:list[idx]});
  }
  const itemRoute=path.match(/^\/api\/templates\/([a-f0-9-]{16,60})(?:\/docx)?$/);
  if(itemRoute){
   const id=itemRoute[1],list=await templates(env),idx=list.findIndex(x=>x.id===id);
   if(idx<0)return error('模板不存在',404);
   // Save or replace the shared Word master. Never change template ID/order/output name.
   // Content-version precondition protects against overwriting another admin's edits.
   if(method==='PUT'&&path.endsWith('/docx')){
    const expected=Number(request.headers.get('X-Template-Version'));
    const current=list[idx].contentVersion||1;
    if(!Number.isSafeInteger(expected)||expected!==current)return error('模板已被其他管理操作更新，请重新打开最新版本后再保存',409);
    const length=Number(request.headers.get('Content-Length')||0);
    if(length>MAX_SIZE)return error('模板文件超过 8MB',413);
    const bytes=await request.arrayBuffer();
    if(!bytes.byteLength||bytes.byteLength>MAX_SIZE)return error('模板文件为空或超过 8MB',413);
    const v=new Uint8Array(bytes);
    if(v[0]!==0x50||v[1]!==0x4b)return error('文件不是有效 DOCX 格式');
    const prior=await env.KHMB.get(list[idx].fileKey||('doc:'+id),'arrayBuffer');
    if(!prior)return error('原模板文件不存在，无法执行安全覆盖',404);
    const priorMeta={...list[idx]};
    await env.KHMB.put('previous-doc:'+id,prior);
    await env.KHMB.put('previous-meta:'+id,JSON.stringify(priorMeta));
    const nextKey='doc:'+id+':v'+(current+1);
    await env.KHMB.put(nextKey,bytes);
    const now=Date.now();
    list[idx]={...list[idx],size:bytes.byteLength,
      filename:String(url.searchParams.get('filename')||list[idx].filename||'template.docx').slice(0,255),
      updatedAt:now,contentVersion:current+1,hasPrevious:true,fileKey:nextKey};
    try{await setTemplates(env,list);}
    catch(e){await env.KHMB.delete(nextKey).catch(()=>{});throw e;}
    return respond({ok:true,template:list[idx],previousVersion:current});
   }
   if(method==='PATCH'){
    const json=await parse(request);
    if(!json||typeof json!=='object'||Array.isArray(json))return error('模板设置格式无效');
    const hasName=Object.prototype.hasOwnProperty.call(json,'name');
    const hasOutput=Object.prototype.hasOwnProperty.call(json,'outputName');
    const hasHint=Object.prototype.hasOwnProperty.call(json,'hintKey')||Object.prototype.hasOwnProperty.call(json,'hintText');
    if(!hasName&&!hasOutput&&!hasHint)return error('请提供模板名称、固定输出文件名或字段填写提示');
    const changes={};
    if(hasHint){
      if(typeof json.hintKey!=='string'||typeof json.hintText!=='string')return error('字段提示格式无效');
      const key=json.hintKey;
      const note=json.hintText.trim();
      if(!key||key.length>200||/[\u0000-\u001f\u007f]/.test(key))return error('字段标识无效');
      if(note.length>400||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note))return error('字段提示最多 400 字且不能包含控制字符');
      const hints={...(list[idx].fieldHints||{})};
      if(note)hints[key]=note;else delete hints[key];
      if(Object.keys(hints).length>400)return error('字段填写提示数量超过限制');
      changes.fieldHints=hints;
    }
    if(hasName){
      if(typeof json.name!=='string')return error('模板名称必须是文字');
      const displayName=json.name.trim();
      if(!displayName||displayName.length>150||/[\u0000-\u001f\u007f]/.test(displayName))return error('模板名称须为 1–150 字符且不能包含控制字符');
      changes.name=displayName;
    }
    if(hasOutput){
      if(typeof json.outputName!=='string')return error('固定输出文件名格式错误');
      changes.outputName=safeName(json.outputName);
    }
    // Metadata-only rename: original Word file, stable template ID, order and
    // contentVersion deliberately remain unchanged.
    list[idx]={...list[idx],...changes,updatedAt:Date.now()};
    await setTemplates(env,list);
    return respond({ok:true,template:list[idx]});
   }
   if(method==='DELETE'){
    const oldFileKey=list[idx].fileKey;
    list.splice(idx,1);list.forEach((t,i)=>t.order=i);
    await setTemplates(env,list);
    await env.KHMB.delete('doc:'+id);
    if(oldFileKey)await env.KHMB.delete(oldFileKey).catch(()=>{});
    await env.KHMB.delete('previous-doc:'+id).catch(()=>{});
    await env.KHMB.delete('previous-meta:'+id).catch(()=>{});
    return respond({ok:true});
   }
  }
  if(path==='/api/order'&&method==='POST'){
   const json=await parse(request),list=await templates(env);
   const ids=json?.ids;
   if(!Array.isArray(ids)||ids.length!==list.length||new Set(ids).size!==list.length||list.some(t=>!ids.includes(t.id)))return error('排序列表无效');
   const order=new Map(ids.map((id,i)=>[id,i]));
   for(const t of list)t.order=order.get(t.id);
   await setTemplates(env,sorted(list));
   return respond({ok:true});
  }
  return error('接口不存在',404);
 }catch(e){return error('服务处理失败：'+String(e?.message||'unknown'),500);}
}};
return backend;
})()
