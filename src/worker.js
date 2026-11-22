// MSWQ content API — Cloudflare Worker with isolated D1/R2 storage.
// Placeholders are replaced by the deployment build step; do not store secrets in this repository.
const ASSETS = __MSWQ_ASSETS__;
// MSWQ test adapter operating on shared DOCX D1/KV without modifying original service.
const DOCX_ADMIN_BACKEND = __MSWQ_DOCX_API__;
// Production admin is never accessible without a password and Google Authenticator TOTP.
const MSWQ_TEST_OPEN_ADMIN = false;
const HTML_VIEW_ORIGIN = 'https://mswq-html.mosen6266-ms007.workers.dev';
const encoder = new TextEncoder();
const enc = value => encoder.encode(value);
const CORS_SAME_ORIGIN_ONLY = true;
const CORE_TYPE_LABELS={personal:'个人流程',group:'群剧本',document:'DOCX 文档',page:'自定义页面',link:'外部工具',bookmarks:'网址收藏',profile:'个人名片'};
function allTypeIds(s){return [...Object.keys(CORE_TYPE_LABELS),...s.custom_types.map(x=>x.id)]}
function typeLabel(s,id){return s.custom_types.find(x=>x.id===id)?.name||s.type_labels[id]||CORE_TYPE_LABELS[id]||''}
function checkTypeName(s,id,raw){
 const name=String(raw??'').trim();
 if(!name||name.length>30||/[\u0000-\u001f\u007f<>]/.test(name))return '分类名称须为 1–30 个字符，不能有特殊控制字符';
 if(allTypeIds(s).some(k=>k!==id&&typeLabel(s,k).toLocaleLowerCase()===name.toLocaleLowerCase()))return '分类名称重复';
 return '';
}
function out(value,status=200,extra={}) {
  return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...extra}});
}
function fail(message,status=400){return out({ok:false,error:message},status);}
function html(value,isLegacy=false){
  const csp=isLegacy
    ? "default-src 'self' data: blob:; script-src 'unsafe-inline' 'self' blob:; style-src 'unsafe-inline' 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
    : "default-src 'self' data: blob: https:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; frame-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
  return new Response(value,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','content-security-policy':csp}});
}
// Only permit embedding standalone administrative tools in the same-origin MSWQ dashboard.
function adminEmbeddedHtml(value){
 const response=html(value,true),headers=new Headers(response.headers);
 headers.set('content-security-policy',(headers.get('content-security-policy')||'').replace("frame-ancestors 'none'","frame-ancestors 'self'"));
 return new Response(value,{status:200,headers});
}
// Static resources are immutable for a given content hash, but every browser
// revalidation still passes through the IP allowlist above. No shared caching.
async function serveStaticBrowserAsset(req,body,mime){
 const tag='"mswq-static-'+base64url((await digest(body)).slice(0,15))+'"';
 const headers={'content-type':mime,'cache-control':'private, no-cache',
  'etag':tag,'x-content-type-options':'nosniff'};
 const values=(req.headers.get('if-none-match')||'').split(',').map(x=>x.trim().replace(/^W\//i,''));
 if(values.includes(tag))return new Response(null,{status:304,headers});
 return new Response(body,{status:200,headers});
}
function base64url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function fromBase64url(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
async function digest(s){return new Uint8Array(await crypto.subtle.digest('SHA-256',enc(s)));}
async function sameSecret(a,b){const [x,y]=await Promise.all([digest(a),digest(b)]);return x.length===y.length&&x.every((v,i)=>v===y[i]);}
async function hmac(secret,text){
 const key=await crypto.subtle.importKey('raw',enc(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return new Uint8Array(await crypto.subtle.sign('HMAC',key,enc(text)));
}
// RFC 6238 / Google Authenticator, 6 digits, SHA-1, 30-second window.
// The shared base32 seed is a Cloudflare Worker secret, never exposed through the site.
async function googleTotpValid(base32,code){
 if(!/^\d{6}$/.test(String(code||'')))return false;
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
 const s=String(base32||'').toUpperCase().replace(/[\s=-]/g,'');
 let accumulator=0,bits=0,bytes=[];
 for(const char of s){
  const digit=alphabet.indexOf(char);
  if(digit<0)return false;
  accumulator=(accumulator<<5)|digit;bits+=5;
  if(bits>=8){
   bits-=8;
   bytes.push((accumulator>>>bits)&255);
   accumulator &= (1<<bits)-1;
  }
 }
 if(bytes.length<20)return false;
 const key=await crypto.subtle.importKey('raw',new Uint8Array(bytes),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const tick=Math.floor(Date.now()/30000);
 for(const offset of [-1,0,1]){
  const counter=new Uint8Array(8);
  new DataView(counter.buffer).setUint32(4,tick+offset,false);
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,counter));
  const p=signature[signature.length-1]&15;
  const value=(((signature[p]&127)<<24)|(signature[p+1]<<16)|(signature[p+2]<<8)|signature[p+3])%1000000;
  if(await sameSecret(String(code),String(value).padStart(6,'0')))return true;
 }
 return false;
}
async function sessionValid(req,env){
 if(!env.ADMIN_PASSWORD||!env.ADMIN_TOTP_SECRET||!env.SESSION_SECRET)return false;
 const token=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('mswq_session='));
 if(!token)return false;
 const pieces=token.slice(13).split('.');
 if(pieces.length!==2)return false;
 try{
  const payload=new TextDecoder().decode(fromBase64url(pieces[0]));
  const parsed=JSON.parse(payload);
  if(!parsed.exp || parsed.exp<Date.now() || parsed.exp>Date.now()+8*3600000)return false;
  const expected=await hmac(env.SESSION_SECRET||env.ADMIN_PASSWORD+':mswq-v1',pieces[0]);
  const received=fromBase64url(pieces[1]);
  return expected.length===received.length&&expected.every((v,i)=>v===received[i]);
 }catch{return false;}
}
async function newSession(env){
 const expires=Date.now()+8*3600000;
 const payload=base64url(enc(JSON.stringify({exp:expires,nonce:crypto.randomUUID()})));
 return payload+'.'+base64url(await hmac(env.SESSION_SECRET||env.ADMIN_PASSWORD+':mswq-v1',payload));
}
function cookie(token){return 'mswq_session='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800';}
function checkOrigin(req){const origin=req.headers.get('origin');return !origin||origin===new URL(req.url).origin;}
async function parse(req,limit=550000){
 const raw=await req.text();if(raw.length>limit)throw new Error('数据量过大');
 return JSON.parse(raw||'{}');
}
function iso(){return new Date().toISOString();}
function cleanString(x,n=300){return String(x??'').trim().slice(0,n);}
function makeSlug(s){
 let value=cleanString(s,120).toLowerCase().normalize('NFKC').replace(/[^a-z0-9\u4e00-\u9fff_-]+/g,'-').replace(/^-+|-+$/g,'');
 return value || crypto.randomUUID().slice(0,8);
}
function allowedUrl(raw){try{const url=new URL(raw);return ['http:','https:'].includes(url.protocol)}catch{return false;}}
function normalizeItem(incoming,id){
 const kind=['personal','group','document','page','link','bookmarks','profile','html'].includes(incoming.kind)||/^custom_[a-f0-9]{32}$/.test(incoming.kind||'')?incoming.kind:'page';
 const status=incoming.status==='published'?'published':'draft';
 const content=incoming.content&&typeof incoming.content==='object'?incoming.content:{blocks:[]};
 const blocks=Array.isArray(content.blocks)?content.blocks.slice(0,600):[];
 const members=Array.isArray(content.members)?content.members.slice(0,150):[];
 const normalized={...content,blocks,members};
 normalized.subgroupId=/^[a-f0-9-]{36}$/i.test(String(content.subgroupId||''))?String(content.subgroupId):'';
 const safeId=value=>/^[a-f0-9-]{32,40}$/i.test(String(value||''))?String(value):crypto.randomUUID();
 const safeAsset=value=>/^[a-f0-9-]{32,40}$/i.test(String(value||''))?String(value):'';
 if(kind==='bookmarks'){
  normalized.entries=(Array.isArray(content.entries)?content.entries:[]).slice(0,200).map(entry=>({
   id:safeId(entry?.id),title:cleanString(entry?.title,140),url:cleanString(entry?.url,2048),
   note:cleanString(entry?.note,1200),assetId:safeAsset(entry?.assetId)
  }));
 }
 if(kind==='profile'){
  normalized.fields=(Array.isArray(content.fields)?content.fields:[]).slice(0,200).map(entry=>({
   id:safeId(entry?.id),type:['text','link','image','video'].includes(entry?.type)?entry.type:'text',
   label:cleanString(entry?.label,120),value:cleanString(entry?.value,3500),
   assetId:safeAsset(entry?.assetId)
  }));
 }
 return {
   id:id||crypto.randomUUID(),kind,status,
   title:cleanString(incoming.title,160)||'未命名内容',
   slug:makeSlug(incoming.slug||incoming.title),
   description:cleanString(incoming.description,600),
   category:cleanString(incoming.category,80),
   tags:JSON.stringify(Array.isArray(incoming.tags)?incoming.tags.slice(0,20).map(x=>cleanString(x,40)):[]),
   sort_order:Number.isFinite(+incoming.sort_order)?Math.round(+incoming.sort_order):1000,
   thumbnail:cleanString(incoming.thumbnail,240),
   content:JSON.stringify(normalized),
 };
}
function validateSpecialContent(incoming){
 const body=incoming&&typeof incoming==='object'?incoming:{};
 const content=body.content&&typeof body.content==='object'&&!Array.isArray(body.content)?body.content:{};
 if(body.kind==='bookmarks'){
  if(content.entries!==undefined&&!Array.isArray(content.entries))return '网址收藏数据格式错误';
  const entries=content.entries||[];
  if(entries.length>200)return '每个收藏夹最多 200 个网址';
  if(body.status==='published'&&!entries.length)return '请先添加至少一个网址再发布';
  for(const entry of entries){
   if(!entry||typeof entry!=='object')return '收藏网址格式错误';
   if(String(entry.title||'').length>140||String(entry.note||'').length>1200)return '网址名称或备注过长';
   const address=String(entry.url||'').trim();
   if(address&&!allowedUrl(address))return '收藏网址必须是 http:// 或 https:// 开头的完整地址';
   if(body.status==='published'&&(!entry.title?.trim()||!address))return '发布前请填写每个收藏网址的名称和完整链接';
  }
 }
 if(body.kind==='profile'){
  if(content.fields!==undefined&&!Array.isArray(content.fields))return '名片字段格式错误';
  const fields=content.fields||[];
  if(fields.length>200)return '个人名片最多 200 个自定义项目';
  for(const f of fields){
   if(!f||typeof f!=='object')return '名片项目格式错误';
   if(String(f.label||'').length>120||String(f.value||'').length>3500)return '名片项目标签或内容过长';
   if(f.type==='link'&&f.value&&!allowedUrl(String(f.value)))return '名片网址必须使用 http:// 或 https://';
   if(f.type&&!['text','link','image','video'].includes(f.type))return '名片项目类型不支持';
  }
 }
 return '';
}
function mswqReaderAddBackLink(html){
 const home='https://mswq.mosen6266-ms007.workers.dev/';
 if(typeof html!=='string'||!html.toLowerCase().startsWith('<!doctype html>'))throw Error('原版 HTML 内容格式不正确');
 const css='\n.mswq-home-link{display:inline-flex;align-items:center;justify-content:center;width:max-content;max-width:100%;box-sizing:border-box;padding:8px 12px;margin:0 0 8px;color:#f1f1ef;background:#303234;border:1px solid #676a69;border-radius:9px;text-decoration:none;font-size:12px;font-weight:800;line-height:1.35;white-space:nowrap;cursor:pointer}.mswq-home-link:hover{color:#fff;border-color:#94b8a3;background:#3d4841}.mswq-home-link:focus-visible{outline:2px solid #71ce9c;outline-offset:3px}.top>.mswq-home-link{flex-shrink:0;margin:0 6px 0 0}\n';
 // Prefer the exact preceding browser-history entry. For direct/deep links, use the
 // same-origin referrer if available; the site homepage is only the final fallback.
 const backCode='if(document.referrer){if(history.length>1){history.back();return false;}try{var r=new URL(document.referrer);if(r.origin===location.origin&&r.href!==location.href){location.assign(r.href);return false;}}catch(e){}}return true;';
 const link='<a data-mswq-home="true" class="mswq-home-link" href="'+home+'" aria-label="返回" onclick="'+backCode+'">返回</a>';
 if(html.includes('data-mswq-home="true"')){
  const buttonPattern=/<a\s+data-mswq-home="true"[^>]*>[\s\S]*?<\/a>/i;
  if(!buttonPattern.test(html))throw Error('旧版返回按钮无法识别，拒绝覆盖');
  return html.replace(buttonPattern,link);
 }
 if(!html.includes('</style></head>'))throw Error('原版 HTML 缺少样式结束位置');
 let output=html.replace('</style></head>',css+'</style></head>');
 const personal='<div class="reader-header-main">';
 const group='<div class="top">';
 if(output.includes(personal))output=output.replace(personal,personal+link);
 else if(output.includes(group))output=output.replace(group,group+link);
 else throw Error('原版 HTML 顶部导航结构不受支持');
 return output;
}
// Decorate only ONLINE personal-flow pages. Keep original R2 HTML and groups unchanged.
const PERSONAL_SWITCH_STYLE = [
 '#mswqPersonalSwitch{display:flex;align-items:center;gap:8px;max-width:100%;min-height:40px;overflow-x:auto;overflow-y:hidden;white-space:nowrap;padding:4px 0 7px;scrollbar-width:thin;scrollbar-color:#6a6b70 #242527}',
 '#mswqPersonalSwitch[hidden]{display:none!important}',
 '#mswqPersonalSwitch::-webkit-scrollbar{height:6px}#mswqPersonalSwitch::-webkit-scrollbar-thumb{background:#77787b;border-radius:8px}',
 '#mswqPersonalSwitch .mswq-personal-link{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;max-width:260px;min-height:36px;padding:9px 15px;border:1px solid #505155;border-radius:11px;background:#303133;color:#e0e0df;font:850 13px/1.4 Inter,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .12s,border-color .12s}',
 '#mswqPersonalSwitch .mswq-personal-link:hover{background:#454649;border-color:#9a9b9d}',
 '#mswqPersonalSwitch .mswq-personal-link[aria-current="page"]{background:#eeeeec;border-color:#eeeeec;color:#161719;cursor:default}',
 '#mswqPersonalSwitch .mswq-personal-link:focus-visible{outline:2px solid #79d9ab;outline-offset:2px}',
 '#flowTabs.mswq-personal-hide-local{display:none!important}',
 '@media(max-width:650px){#mswqPersonalSwitch .mswq-personal-link{max-width:185px;font-size:12px;padding:9px 11px}}'
].join('');
function decoratePersonalFlowResponse(response,fast=false){
 const rewriter=new HTMLRewriter()
  .on('head',{element(element){
   element.append('<style id="mswq-personal-switch-style">'+PERSONAL_SWITCH_STYLE+'</style>',{html:true});
  }})
  .on('#flowTabs',{element(element){
   element.before('<nav id="mswqPersonalSwitch" aria-label="全部个人流程快速切换" hidden></nav>',{html:true});
  }})
  .on('body',{element(element){
   element.append('<script src="/assets/personal-switch.js" defer></script>',{html:true});
  }});
 // The legacy export includes a full, duplicated offline rendering of the
 // whole flow, then rebuilds it from the embedded pkg JSON on load. On quick
 // switching only, avoid downloading/parsing that duplicate several-MB HTML.
 // The original R2 bytes remain intact, and the normal URL keeps the offline
 // fallback for browsers without JavaScript.
 if(fast)rewriter.on('#flow',{element(element){
  element.setInnerContent('<div class="muted" style="padding:24px;text-align:center">正在打开个人流程…</div>',{html:true});
 }});
 return rewriter.transform(response);
}
function frontTabForItem(item){return ['document','html'].includes(item.kind)?(item.category||(item.kind==='html'?'page':'document')):item.kind;}
function htmlAssetLink(id){return /^[a-f0-9-]{36}$/i.test(String(id||''))?HTML_VIEW_ORIGIN+'/html/'+id+'/':'';}
async function verifyHtmlItem(env,item){
 if(item.kind!=='html')return '';
 const id=JSON.parse(item.content||'{}').htmlAssetId;
 if(!htmlAssetLink(id))return '请选择已上传的 HTML 文件';
 const row=await env.DB.prepare('SELECT mime FROM assets WHERE id=?').bind(id).first();
 return row?.mime==='text/html'?'':'关联的 HTML 文件不存在，请重新选择';
}
function record(r,includeContent=true){
 if(!r)return null;
 const z={id:r.id,kind:r.kind,status:r.status,title:r.title,slug:r.slug,description:r.description,category:r.category,tags:JSON.parse(r.tags||'[]'),sort_order:r.sort_order,thumbnail:r.thumbnail,created_at:r.created_at,updated_at:r.updated_at,version:r.version};
 const data=JSON.parse(r.content||'{}');
 z.subgroupId=/^[a-f0-9-]{36}$/i.test(String(data.subgroupId||''))?String(data.subgroupId):'';
 if(includeContent)z.content=data;
 // Already published, lightweight interactive pages: include their public data
 // in the homepage response to avoid another round trip before opening them.
 else if(['profile','bookmarks','document','link'].includes(r.kind))z.content=data;
 if(r.kind==='html')z.direct_url=htmlAssetLink(data.htmlAssetId);
 else if(!includeContent&&data.openStandalone===true&&typeof data.standaloneUrl==='string'&&allowedUrl(data.standaloneUrl))z.direct_url=data.standaloneUrl;
 return z;
}
async function config(env){
 const rows=await env.DB.prepare('SELECT key,value FROM settings').all();
 const out={brand:'MSWQ',headline:'内容与工具中心',description:'选择你需要查看的流程、剧本或文档',layout:'grid',footer:'',announcement:'',docx_url:'/docx',custom_types:[],hidden_types:[],type_labels:{},deleted_types:[],type_order:[],subgroups:[],item_subgroups:{}};
 for(const {key,value} of rows.results||[]){
  if(key==='custom_types'){
   try{
    const parsed=JSON.parse(value);
    if(Array.isArray(parsed))out.custom_types=parsed.filter(x=>x&&/^custom_[a-f0-9]{32}$/.test(x.id)&&typeof x.name==='string').slice(0,100);
   }catch{}
  }else if(key==='hidden_types'||key==='deleted_types'||key==='type_order'){
   try{
    const parsed=JSON.parse(value);
    if(Array.isArray(parsed))out[key]=[...new Set(parsed.filter(x=>typeof x==='string'&&(/^(?:personal|group|document|page|link|bookmarks|profile)$/.test(x)||/^custom_[a-f0-9]{32}$/.test(x))))].slice(0,150);
   }catch{}
  }else if(key==='subgroups'){
   try{
    const parsed=JSON.parse(value);
    if(Array.isArray(parsed))out.subgroups=parsed.slice(0,200).filter(x=>x&&/^[a-f0-9-]{36}$/i.test(x.id)&&typeof x.category==='string'&&typeof x.name==='string').map(x=>({id:x.id,category:x.category,name:cleanString(x.name,40)}));
   }catch{}
  }else if(key==='item_subgroups'){
   try{
    const parsed=JSON.parse(value);
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){
     for(const [id,subgroup] of Object.entries(parsed).slice(0,3000)){
      if(/^[a-f0-9-]{36}$/i.test(id)&&(subgroup===''||/^[a-f0-9-]{36}$/i.test(String(subgroup))))out.item_subgroups[id]=String(subgroup);
     }
    }
   }catch{}
  }else if(key==='type_labels'){
   try{
    const parsed=JSON.parse(value);
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){
     for(const id of Object.keys(CORE_TYPE_LABELS)){
      const name=String(parsed[id]||'').trim();
      if(name&&name.length<=30&&!/[\u0000-\u001f\u007f<>]/.test(name))out.type_labels[id]=name;
     }
    }
   }catch{}
  }else out[key]=value;
 }
 return out;
}
function resolvedItemSubgroup(item,settings){
 if(item&&Object.hasOwn(settings?.item_subgroups||{},item.id)){
  const assigned=settings.item_subgroups[item.id];
  item.subgroupId=assigned;
  if(item.content&&typeof item.content==='object')item.content.subgroupId=assigned;
 }
 return item;
}
async function fetchPublic(env){
 // Fetch independent homepage data in parallel instead of serial round-trips.
 const [items,settings]=await Promise.all([
  env.DB.prepare("SELECT * FROM items WHERE status='published' ORDER BY sort_order ASC, updated_at DESC").all(),
  config(env)
 ]);
 const publicSettings={...settings};delete publicSettings.item_subgroups;
 return {ok:true,settings:publicSettings,items:(items.results||[]).map(r=>resolvedItemSubgroup(record(r,false),settings))};
}
async function saveItem(env,item,old=null) {
 const now=iso();
 if(old) {
   await env.DB.prepare('INSERT INTO revisions(id,item_id,version,data,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),old.id,old.version,JSON.stringify(record(old)),now).run();
   await env.DB.prepare('UPDATE items SET kind=?, status=?, title=?, slug=?, description=?, category=?, tags=?, sort_order=?, thumbnail=?, content=?, updated_at=?, version=version+1 WHERE id=? AND version=?')
     .bind(item.kind,item.status,item.title,item.slug,item.description,item.category,item.tags,item.sort_order,item.thumbnail,item.content,now,item.id,old.version).run();
 } else {
   await env.DB.prepare('INSERT INTO items(id,kind,status,title,slug,description,category,tags,sort_order,thumbnail,content,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
     .bind(item.id,item.kind,item.status,item.title,item.slug,item.description,item.category,item.tags,item.sort_order,item.thumbnail,item.content,now,now).run();
 }
 return record(await env.DB.prepare('SELECT * FROM items WHERE id=?').bind(item.id).first());
}
async function importBundle(env,body){
 const payload=body?.payload||body;
 const isGroup=Array.isArray(payload.scripts);
 const isPersonal=Array.isArray(payload.flows);
 if(!isGroup&&!isPersonal)throw new Error('导入格式不正确，请从原编辑器导出 JSON 编辑备份');
 const inputs=isGroup?payload.scripts:payload.flows;
 if(inputs.length>100)throw new Error('每次最多导入100个流程');
 const done=[],warnings=[];
 for(const source of inputs){
  const blocks=[];
  for(const step of (source.steps||[]).slice(0,600)){
   const kind=String(step.type||'speech');
   const typemap={speech:'bilingual',note:'hint',wait:'wait',attachment:'file',link:'button',section:'section',text:'text'};
   let converted={id:crypto.randomUUID(),type:typemap[kind]||'text',title:step.title||'',zh:step.contentZh||step.zh||'',en:step.contentForeign||step.en||'',text:step.content||step.text||step.wait||'',seconds:Number(step.seconds)||(String(step.wait||'').includes('分钟')?60*Number.parseFloat(step.wait):Number.parseFloat(step.wait))||60,speakerId:step.memberId||step.speakerId||step.actorId||'',links:step.links||[],assetId:'',files:[]};
   if(step.files?.length){
    for(const file of step.files){
     const entry=payload.attachments?.[file.id];
     if(entry?.data && env.FILES){
      try{
       const raw=entry.data.split(',').pop();
       const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
       if(bytes.byteLength>12000000)throw new Error('file too large');
       const assetId=crypto.randomUUID(), key=assetId;
       const mime=/^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain|application\/vnd\.)/.test(file.type||'')?file.type:'application/octet-stream';
       await env.FILES.put(key,bytes,{httpMetadata:{contentType:mime}});
       await env.DB.prepare('INSERT INTO assets(id,name,mime,size,key,created_at) VALUES(?,?,?,?,?,?)').bind(assetId,cleanString(file.name,200),mime,bytes.byteLength,key,iso()).run();
       converted.files.push({id:assetId,name:file.name});
      }catch(e){warnings.push('附件未导入: '+file.name);}
     }else warnings.push('附件需要重新上传: '+file.name);
    }
   }
   blocks.push(converted);
  }
  const members=(source.members||[]).map(m=>({id:String(m.id||crypto.randomUUID()),name:m.name||m.no||'成员',label:m.no||'',role:m.role||'',gender:m.gender||''}));
  const item=normalizeItem({kind:isGroup?'group':'personal',title:source.name||'导入流程',description:source.description||source.note||'',category:source.category||'',tags:source.tags||[],content:{blocks,members,keywords:source.keywords||[],legacyMeta:{navOrder:source.navOrder||[],navDisabled:source.navDisabled||[],customNavGroups:source.customNavGroups||[],lang:source.lang||''},source:'legacy-import'},status:'draft'});
  item.slug+='-'+crypto.randomUUID().slice(0,5);
  done.push(await saveItem(env,item));
 }
 return {ok:true,count:done.length,items:done,warnings};
}

const HTML_PACKAGE_TYPES={
 html:'text/html',htm:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',json:'application/json',
 png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',gif:'image/gif',webp:'image/webp',
 ico:'image/x-icon',avif:'image/avif',bmp:'image/bmp',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',
 otf:'font/otf',eot:'application/vnd.ms-fontobject',wasm:'application/wasm',webmanifest:'application/manifest+json',
 xml:'application/xml',txt:'text/plain',map:'application/json',pdf:'application/pdf',mp3:'audio/mpeg',
 mp4:'video/mp4',webm:'video/webm',wav:'audio/wav',ogg:'audio/ogg'
};
const HTML_PACKAGE_UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function htmlPackagePath(raw){
 if(typeof raw!=='string'||!raw||raw.length>260||/[\u0000-\u001f\u007f?#]/.test(raw)||raw.startsWith('/')||raw.includes('\\')||/^[a-z]:/i.test(raw))return '';
 const bits=raw.split('/');
 if(bits.some(s=>!s||s==='.'||s==='..'||s.length>120))return '';
 return Object.hasOwn(HTML_PACKAGE_TYPES,(bits[bits.length-1].split('.').pop()||'').toLowerCase())?raw:'';
}
function htmlPackageMime(path){
 return HTML_PACKAGE_TYPES[path.split('.').pop().toLowerCase()]||'application/octet-stream';
}
function htmlPackageFileKey(id,version,path){return 'html-packages/'+id+'/'+version+'/'+path;}
function htmlPackageManifestKey(id){return 'html-packages/'+id+'/manifest.json';}
async function htmlPackageManifest(env,id){
 const obj=await env.FILES.get(htmlPackageManifestKey(id));
 if(!obj)return null;
 try{
  const manifest=JSON.parse(await obj.text());
  return manifest&&HTML_PACKAGE_UUID.test(manifest.version)&&manifest.files&&typeof manifest.files==='object'?manifest:null;
 }catch{return null}
}

function imageMime(type){return /^image\/(?:jpeg|png|gif|webp)$/i.test(type);}
function videoMime(type){return /^video\/(?:mp4|webm)$/i.test(type);}
async function serveAsset(env,id,request){
 const row=await env.DB.prepare('SELECT * FROM assets WHERE id=?').bind(id).first();
 if(!row)return fail('文件不存在',404);
 const url=new URL(request.url),download=url.searchParams.get('download')==='1';
 const mime=(imageMime(row.mime)||videoMime(row.mime))?row.mime:'application/octet-stream';
 const total=Number(row.size)||0;
 const canBrowserCache=imageMime(mime)&&!download;
 const tag=canBrowserCache?'"mswq-image-'+id+'-'+total+'-'+(row.created_at||'')+'"':'';
 const tags=(request.headers.get('if-none-match')||'').split(',').map(x=>x.trim().replace(/^W\//i,''));
 if(tag&&tags.includes(tag))return new Response(null,{status:304,headers:{
  'etag':tag,'cache-control':'private, no-cache','x-content-type-options':'nosniff'
 }});
 const rangeHeader=videoMime(mime)&&!download?request.headers.get('range'):null;
 let range=null;
 if(rangeHeader){
  const match=/^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'content-range':'bytes */'+total}});
  const start=match[1]?Number(match[1]):Math.max(0,total-Number(match[2]));
  const end=match[2]&&match[1]?Number(match[2]):total-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=total)return new Response(null,{status:416,headers:{'content-range':'bytes */'+total}});
  range={offset:start,length:Math.min(total-1,end)-start+1};
 }
 const obj=await env.FILES.get(row.key,range?{range}:undefined);
 if(!obj)return fail('文件不存在',404);
 const headers=new Headers({
  'content-type':mime,'x-content-type-options':'nosniff',
  'content-security-policy':"default-src 'none'; sandbox",
  'content-disposition':(download||(!imageMime(mime)&&!videoMime(mime))?'attachment':'inline')+"; filename*=UTF-8''"+encodeURIComponent(row.name),
  'cache-control':canBrowserCache?'private, no-cache':'private,no-store',
  'accept-ranges':videoMime(mime)?'bytes':'none'
 });
 if(tag)headers.set('etag',tag);
 if(range){
  headers.set('content-range','bytes '+range.offset+'-'+(range.offset+range.length-1)+'/'+total);
  headers.set('content-length',String(range.length));
 }else headers.set('content-length',String(total));
 return new Response(obj.body,{status:range?206:200,headers});
}
function publicDocxPage(value){
 const response=html(value,true),headers=new Headers(response.headers);
 headers.set('content-security-policy',"default-src 'self' data: blob:; script-src 'unsafe-inline' 'self' blob:; style-src 'unsafe-inline' 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-ancestors 'self'");
 return new Response(value,{status:200,headers});
}

/* Separate icon library and enforced public-site IP allowlist.
   Stored under dedicated keys in the existing R2 bucket, never in assets. */
const ICON_PREFIX='mswq-icons/v1/';
const THUMB_PREFIX='mswq-thumbnails/v1/';
const IP_ACCESS_KEY='mswq-private/ip-allowlist-v1.json';
const IP_UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function normalizedClientIP(value){
 const t=String(value||'').trim();
 if(t.includes(':')){
  if(!/^[0-9a-fA-F:.]+$/.test(t))return '';
  try{
   const host=new URL('http://['+t+']/').hostname;
   return host.startsWith('[')&&host.endsWith(']')?host.slice(1,-1).toLowerCase():'';
  }catch{return ''}
 }
 const parts=t.split('.');
 if(parts.length!==4||parts.some(x=>!/^(?:0|[1-9]\d{0,2})$/.test(x)||Number(x)>255))return '';
 return parts.map(Number).join('.');
}
async function siteIpList(env){
 const object=await env.FILES.get(IP_ACCESS_KEY);
 if(!object)return {ips:[],updatedAt:''};
 try{
  const data=JSON.parse(await object.text());
  if(!Array.isArray(data.ips))return {ips:[],updatedAt:''};
  return {ips:[...new Set(data.ips.map(normalizedClientIP).filter(Boolean))].slice(0,300),updatedAt:String(data.updatedAt||'')};
 }catch{return {ips:[],updatedAt:''}}
}
function protectedPublicPath(path){
 return path==='/'||path.startsWith('/view/')||path==='/docx'||path==='/docx/'||
  path==='/api/public'||path.startsWith('/api/public/')||path.startsWith('/api/docx/')||
  path.startsWith('/api/asset/')||path.startsWith('/api/icon/');
}
function deniedForIp(ip){
 return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>访问受限</title><body style="font:16px system-ui,sans-serif;background:#141516;color:#f2f2f2;padding:clamp(30px,8vw,100px);text-align:center"><h1>403 · 当前 IP 未获授权</h1><p>此网站仅允许管理员加入白名单的 IP 访问。</p><p style="color:#aab0b2">当前访问 IP：'+ip.replace(/[<&"']/g,'')+'</p><p>请联系管理员添加后重新访问。</p></body></html>',{
  status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','vary':'CF-Connecting-IP'}
 });
}
function iconKey(id){return ICON_PREFIX+id;}
function iconRecord(obj){
 const id=String(obj.key||'').slice(ICON_PREFIX.length);
 return {id,name:String(obj.customMetadata?.name||'图片'),mime:String(obj.httpMetadata?.contentType||'image/png'),
  size:obj.size||0,created_at:obj.customMetadata?.createdAt||'',url:'/api/icon/'+id};
}
async function iconFile(env,id,req){
 if(!IP_UUID.test(id))return fail('图标不存在',404);
 const object=await env.FILES.get(iconKey(id));
 if(!object)return fail('图标不存在',404);
 const mime=object.httpMetadata?.contentType||'application/octet-stream';
 if(!imageMime(mime))return fail('不是可预览的图片',415);
 const download=new URL(req.url).searchParams.get('download')==='1';
 const tag='"mswq-icon-'+id+'-'+String(object.etag||'')+'"';
 const cache=download?'private,no-store':'private, no-cache';
 const tags=(req.headers.get('if-none-match')||'').split(',').map(x=>x.trim().replace(/^W\//i,''));
 if(!download&&tags.includes(tag))return new Response(null,{status:304,headers:{
  'etag':tag,'cache-control':cache,'x-content-type-options':'nosniff'
 }});
 return new Response(req.method==='HEAD'?null:object.body,{headers:{
  'content-type':mime,'x-content-type-options':'nosniff','cache-control':cache,'etag':tag,
  'content-disposition':download?'attachment; filename*=UTF-8\''+'\''+encodeURIComponent(object.customMetadata?.name||id+'.png'):'inline'
 }});
}

// Server-stored small previews. The original R2 objects are never modified.
// Admin-only route: thumbnails are not exposed through the public IP-gated API.
async function handleAdminThumbnail(env,req,kind,id){
 if(!IP_UUID.test(id)||!['assets','icons'].includes(kind))return fail('预览编号无效',400);
 const img=kind==='icons'?await env.FILES.head(iconKey(id)):
   await env.DB.prepare('SELECT mime FROM assets WHERE id=?').bind(id).first();
 if(!img||(kind==='assets'&&!imageMime(img.mime)))return fail('图片素材不存在',404);
 if(kind==='icons'&&!imageMime(img.httpMetadata?.contentType||''))return fail('图标不存在',404);
 const key=THUMB_PREFIX+kind+'/'+id+'.webp';
 if(req.method==='PUT'){
  if(req.headers.get('content-type')!=='image/webp')return fail('只接受 WebP 缩略图',415);
  if(Number(req.headers.get('content-length')||0)>300000)return fail('缩略图尺寸超限',413);
  const bytes=new Uint8Array(await req.arrayBuffer());
  const sig=new TextDecoder().decode(bytes.slice(0,12));
  if(bytes.length<32||bytes.length>300000||sig.slice(0,4)!=='RIFF'||sig.slice(8,12)!=='WEBP')return fail('缩略图文件无效',400);
  await env.FILES.put(key,bytes,{httpMetadata:{contentType:'image/webp'}});
  return out({ok:true,id,size:bytes.byteLength});
 }
 if(!['GET','HEAD'].includes(req.method))return fail('不支持的操作',405);
 const obj=await env.FILES.get(key);
 if(!obj)return fail('预览尚未生成',404);
 const etag='"mswq-thumb-'+id+'-'+String(obj.etag||'')+'"';
 const headers={'content-type':'image/webp','cache-control':'private, no-cache','etag':etag,'x-content-type-options':'nosniff'};
 if((req.headers.get('if-none-match')||'').split(',').map(x=>x.trim().replace(/^W\//i,'')).includes(etag))
  return new Response(null,{status:304,headers});
 return new Response(req.method==='HEAD'?null:obj.body,{status:200,headers});
}

async function handler(req,env){
 const url=new URL(req.url),p=url.pathname,method=req.method;
 // Admin APIs remain reachable so administrators can safely change access IPs.
 if(protectedPublicPath(p)){
  const ip=normalizedClientIP(req.headers.get('cf-connecting-ip'));
  const policy=await siteIpList(env);
  if(!ip||!policy.ips.includes(ip))return deniedForIp(ip||'未知');
 }
 // Previously copied root template URLs now use the same MSWQ frame as new links.
 // Bare /docx (or /docx?embed=1) remains the underlying read-only workspace.
 if(method==='GET'&&p==='/'&&/^[a-f0-9-]{16,60}$/i.test(url.searchParams.get('template')||''))return html(ASSETS.html);
 // Render all published content within the MSWQ shell; the frontend selects the
 // full-width embedded DOCX view without redirecting or creating another tab.
 // Legacy flows use the exact exported HTML instead of being redrawn by the generic reader.
 if(method==='GET'&&p.startsWith('/view/')){
  const slug=decodeURIComponent(p.slice('/view/'.length));
  const item=await env.DB.prepare("SELECT id,kind,status,title,content,version FROM items WHERE slug=? AND status='published'").bind(slug).first();
  if(item?.kind==='html'){
   const direct=htmlAssetLink(JSON.parse(item.content||'{}').htmlAssetId);
   return direct?Response.redirect(direct,302):fail('HTML 页面缺少有效文件',404);
  }
  if(item&&['personal','group'].includes(item.kind)){
   const exact=await env.FILES.get('published-readers/'+item.id+'.html');
   if(exact){
    const signature=base64url(await digest(item.title+'\0'+item.content));
    let validExport=exact.customMetadata?.signature===signature&&exact.customMetadata?.kind===item.kind;
    // Renaming a card or changing its subgroup must not invalidate an unchanged
    // original HTML export. Validate the historic signed version AND require the
    // exported content to match the current functional content exactly.
    if(!validExport&&exact.customMetadata?.kind===item.kind){
     const storedVersion=Number(exact.customMetadata.version);
     if(Number.isSafeInteger(storedVersion)&&storedVersion>0&&storedVersion<item.version){
      const previous=await env.DB.prepare(
       'SELECT data FROM revisions WHERE item_id=? AND version=? ORDER BY created_at DESC LIMIT 1'
      ).bind(item.id,storedVersion).first();
      if(previous?.data){
       try{
        const original=JSON.parse(previous.data);
        const currentContent=JSON.parse(item.content||'{}');
        const before={...(original.content||{})},after={...currentContent};
        // subgroupId is a card-display property; never part of the flow script.
        delete before.subgroupId;delete after.subgroupId;
        validExport=original.kind===item.kind&&
          JSON.stringify(before)===JSON.stringify(after)&&
          base64url(await digest(original.title+'\0'+JSON.stringify(original.content||{})))===exact.customMetadata.signature;
       }catch{validExport=false}
      }
     }
    }
    if(validExport){
     const fast=item.kind==='personal'&&url.searchParams.get('fast')==='1';
     const embedded=fast&&url.searchParams.get('embedded')==='1';
     // Only signed/versioned navigation URLs are cacheable. An updated item
     // receives a new versioned URL, so buttons immediately show new content.
     const stableVersion=fast&&url.searchParams.get('v')===String(item.version);
     // Browser-only caching with mandatory revalidation: this must never be
     // cached by a shared CDN, and the Worker IP access gate still runs first.
     const cachePolicy='private, no-cache';
     const etag='"mswq-'+item.id+'-'+String(exact.etag||'')+'-'+String(item.version)+'-'+(fast?'fast':'full')+'"';
     const headers={
      'content-type':'text/html; charset=utf-8','cache-control':cachePolicy,
      'etag':etag,'x-content-type-options':'nosniff',
      'referrer-policy':'strict-origin-when-cross-origin',
      'content-security-policy':item.kind==='personal'
       ?"default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; img-src 'self' data: blob: https:; media-src data: blob: https:; font-src 'self' data:; connect-src 'self' data: blob:; prefetch-src 'self'; frame-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
       :"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob: https:; media-src data: blob: https:; font-src 'self' data:; connect-src data: blob:; frame-src data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
     };
     if(req.headers.get('if-none-match')?.split(',').map(x=>x.trim().replace(/^W\//i,'')).includes(etag)){
      return new Response(null,{status:304,headers});
     }
     if(embedded)headers['content-security-policy']=headers['content-security-policy'].replace("frame-ancestors 'none'","frame-ancestors 'self'");
     const originalResponse=new Response(exact.body,{status:200,headers});
     return item.kind==='personal'?decoratePersonalFlowResponse(originalResponse,fast):originalResponse;
    }
   }
  }
 }
 if(method==='GET'&&(p==='/'||p==='/admin'||p==='/admin/'||p.startsWith('/view/')))return html(ASSETS.html);
 if(method==='GET'&&p==='/assets/app.js')return serveStaticBrowserAsset(req,ASSETS.js,'application/javascript; charset=utf-8');
 if(method==='GET'&&p==='/assets/package-upload.js')return serveStaticBrowserAsset(req,ASSETS.packageUpload,'application/javascript; charset=utf-8');
 if(method==='GET'&&p==='/assets/html-package-ui.js')return serveStaticBrowserAsset(req,ASSETS.packageUI,'application/javascript; charset=utf-8');
 if(method==='GET'&&p==='/assets/app.css')return serveStaticBrowserAsset(req,ASSETS.css,'text/css; charset=utf-8');
 if(method==='GET'&&p==='/assets/personal-switch.js')return serveStaticBrowserAsset(req,ASSETS.personalSwitch,'application/javascript; charset=utf-8');
 if(method==='GET'&&p==='/assets/legacy-bridge.js')return serveStaticBrowserAsset(req,ASSETS.bridge,'application/javascript; charset=utf-8');
 if(method==='GET'&&(p==='/docx'||p==='/docx/')){
  if(url.searchParams.get('embed')!=='1'&&/^[a-f0-9-]{16,60}$/i.test(url.searchParams.get('template')||''))return html(ASSETS.html);
  return publicDocxPage(ASSETS.docx);
 }
 if(method==='GET'&&p==='/api/docx/session')return out({admin:false});
 // Public DOCX templates are served locally from MSWQ's own D1/KV, not through MS_KHMB.
 if(p.startsWith('/api/docx/')){
  if(method!=='GET')return fail('公开文档服务不支持管理操作',405);
  if(!/^\/api\/docx\/templates(?:\/[a-f0-9-]{16,60}\/(?:docx|version))?$/.test(p))return fail('文档接口不存在',404);
  if(!env.DOCX_DB||!env.DOCX_KV)return fail('MSWQ DOCX 独立模板存储未连接',503);
  const localPath=p.replace('/api/docx/','/api/');
  const target=new URL(localPath+url.search,url.origin);
  return DOCX_ADMIN_BACKEND.fetch(new Request(target,{method:'GET'}),{DB:env.DOCX_DB,KHMB:env.DOCX_KV},{});
 }
 if(method==='GET'&&p==='/api/health')return out({ok:true,app:'MSWQ',version:'1.5.3',testMode:false,twoFactor:true});
 if(method==='GET'&&p==='/api/public')return out(await fetchPublic(env));
 if(method==='GET'&&p.startsWith('/api/public/item/')){
  const slug=decodeURIComponent(p.slice('/api/public/item/'.length));
  const [row,settings]=await Promise.all([
   env.DB.prepare("SELECT * FROM items WHERE slug=? AND status='published'").bind(slug).first(),
   config(env)
  ]);
  return row?out({ok:true,item:resolvedItemSubgroup(record(row),settings)}):fail('页面不存在或尚未发布',404);
 }
 if(['GET','HEAD'].includes(method)&&p.startsWith('/api/asset/'))return serveAsset(env,p.split('/').pop(),req);
 if(['GET','HEAD'].includes(method)&&p.startsWith('/api/icon/'))return iconFile(env,p.split('/').pop(),req);
 if(method==='POST'&&p==='/api/admin/login'){
  if(MSWQ_TEST_OPEN_ADMIN)return out({ok:true,testMode:true});
  if(!checkOrigin(req))return fail('请求来源不合法',403);
  if(!env.ADMIN_PASSWORD||!env.ADMIN_TOTP_SECRET||!env.SESSION_SECRET)return fail('管理员双重验证配置未就绪，请联系管理员',503);
  const ip=req.headers.get('cf-connecting-ip')||'unknown';
  const ipHash=base64url(await digest('mswq-'+ip));
  let row=await env.DB.prepare('SELECT * FROM login_attempts WHERE ip=?').bind(ipHash).first();
  if(row?.locked_until>Date.now())return fail('尝试次数过多，请稍后重试',429);
  const body=await parse(req,10000);
  const matched=await sameSecret(String(body.password||''),env.ADMIN_PASSWORD);
  const twoFactor=matched&&await googleTotpValid(env.ADMIN_TOTP_SECRET,body.code);
  if(!matched||!twoFactor){
   const failures=(row?.failures||0)+1, lock=failures>=8?Date.now()+15*60000:0;
   await env.DB.prepare('INSERT INTO login_attempts(ip,failures,locked_until) VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until').bind(ipHash,failures,lock).run();
   return fail('管理员密码或谷歌动态验证码错误',401);
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip=?').bind(ipHash).run();
  return out({ok:true},200, {'set-cookie':cookie(await newSession(env))});
 }
 if(p.startsWith('/api/admin/')||p==='/admin/legacy-editor'||p==='/admin/docx-editor'){
  if(!MSWQ_TEST_OPEN_ADMIN && !await sessionValid(req,env))return fail('请先登录管理后台',401);
  if(!['GET','HEAD'].includes(method)&&!checkOrigin(req))return fail('请求来源不合法',403);
 }
 if(method==='GET'&&p==='/admin/legacy-editor'){
  // IMPORTANT: the legacy editor contains literal </body> sequences inside
  // exported reader HTML template strings. Inject ONLY at the final real
  // closing body tag; replacing the first match corrupts the editor scripts.
  const injected=ASSETS.legacy.replace(/<\/body>\s*<\/html>\s*$/i,'<script src="/assets/legacy-bridge.js" defer></script></body></html>');
  return adminEmbeddedHtml(injected);
 }
 if(method==='GET'&&p==='/admin/docx-editor'){
  // Always show edit/upload tools on MSWQ, but preserve the public visitor edition.
  const docx=ASSETS.docx
   .replace(/<style id="mswq-docx-public-only">[\s\S]*?<\/style>/,'')
   .replaceAll('/api/docx/','/api/admin/docx/')
   .replace(/\/api\/(login|logout|password|order)(?=[^a-zA-Z]|$)/g,'/api/admin/docx/$1')
   .replace('state.isAdmin=false;','state.isAdmin=true;')
   .replace("state.adminToken=sessionStorage.getItem('ms_khmb_admin_token')||'';","state.adminToken='';")
   .replace('</head>','<style>#adminToggle,#adminPassword,#adminLogout{display:none!important}</style></head>');
  return adminEmbeddedHtml(docx);
 }
 if(p.startsWith('/api/admin/docx/')){
  const apiPath=p.replace('/api/admin/docx/','/api/');
  if(method==='GET'&&apiPath==='/api/session')return out({admin:true});
  if(['/api/login','/api/logout','/api/password'].includes(apiPath))return fail('MSWQ 测试后台无须此操作',404);
  const validTemplate=/^\/api\/templates(?:\/[a-f0-9-]{16,60}(?:\/(?:docx|version|rollback))?)?$/i.test(apiPath);
  if(!validTemplate&&apiPath!=='/api/order')return fail('DOCX 管理接口不存在',404);
  if(!['GET','POST','PUT','PATCH','DELETE'].includes(method))return fail('不支持的方法',405);
  if(!env.DOCX_DB||!env.DOCX_KV)return fail('MSWQ DOCX 独立模板存储未连接',503);
  const target=new URL(apiPath+url.search,url.origin);
  return DOCX_ADMIN_BACKEND.fetch(new Request(target,req),{DB:env.DOCX_DB,KHMB:env.DOCX_KV},{});
 }


 if(method==='GET'&&p==='/api/admin/ip-access'){
  const policy=await siteIpList(env);
  return out({ok:true,...policy,currentIp:normalizedClientIP(req.headers.get('cf-connecting-ip'))||''});
 }
 if(method==='PUT'&&p==='/api/admin/ip-access'){
  const body=await parse(req,50000);
  if(!Array.isArray(body.ips)||body.ips.length>300)return fail('IP 白名单必须为数组，最多 300 个',400);
  const ips=[];
  for(const raw of body.ips){
   const ip=normalizedClientIP(raw);
   if(!ip)return fail('IP 格式无效：'+cleanString(raw,80),400);
   if(!ips.includes(ip))ips.push(ip);
  }
  const updatedAt=iso();
  await env.FILES.put(IP_ACCESS_KEY,JSON.stringify({ips,updatedAt}),{httpMetadata:{contentType:'application/json'}});
  return out({ok:true,ips,updatedAt,currentIp:normalizedClientIP(req.headers.get('cf-connecting-ip'))||''});
 }
 if(method==='GET'&&p==='/api/admin/icons'){
  let cursor,icons=[];
  do{
   const x=await env.FILES.list({prefix:ICON_PREFIX,limit:500,cursor,include:['httpMetadata','customMetadata']});
   icons.push(...(x.objects||[]).filter(item=>IP_UUID.test(item.key.slice(ICON_PREFIX.length))).map(iconRecord));
   cursor=x.truncated?x.cursor:null;
  }while(cursor&&icons.length<1000);
  icons.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  return out({ok:true,icons});
 }
 if(method==='POST'&&p==='/api/admin/icons'){
  const name=cleanString(decodeURIComponent(req.headers.get('x-file-name')||'图标.png'),200);
  const mime=cleanString(req.headers.get('content-type')||'',80);
  if(!imageMime(mime))return fail('仅支持 PNG、JPG、WEBP、GIF 图片',415);
  if(Number(req.headers.get('content-length')||0)>12000000)return fail('图片不能超过 12MB',413);
  const bytes=await req.arrayBuffer();
  if(!bytes.byteLength||bytes.byteLength>12000000)return fail('图片必须是非空文件，且不能超过 12MB',413);
  const id=crypto.randomUUID(),createdAt=iso();
  await env.FILES.put(iconKey(id),bytes,{httpMetadata:{contentType:mime},customMetadata:{name,createdAt}});
  return out({ok:true,icon:{id,name,mime,size:bytes.byteLength,created_at:createdAt,url:'/api/icon/'+id}},201);
 }
 if(method==='POST'&&p==='/api/admin/icons/import'){
  const body=await parse(req,2000),sourceId=String(body.assetId||'');
  if(!IP_UUID.test(sourceId))return fail('请选择有效的文件素材图片',400);
  const src=await env.DB.prepare('SELECT * FROM assets WHERE id=?').bind(sourceId).first();
  if(!src||!imageMime(src.mime))return fail('来源素材不存在或不是图片',404);
  if(Number(src.size)>12000000)return fail('图片不能超过 12MB',413);
  const object=await env.FILES.get(src.key);
  if(!object)return fail('来源素材缺失',404);
  const id=crypto.randomUUID(),createdAt=iso(),bytes=await object.arrayBuffer();
  await env.FILES.put(iconKey(id),bytes,{httpMetadata:{contentType:src.mime},customMetadata:{name:src.name,createdAt}});
  return out({ok:true,icon:{id,name:src.name,mime:src.mime,size:bytes.byteLength,created_at:createdAt,url:'/api/icon/'+id}},201);
 }
 const thumbnail=p.match(/^\/api\/admin\/thumb\/(assets|icons)\/([a-f0-9-]{36})$/i);
 if(thumbnail)return handleAdminThumbnail(env,req,thumbnail[1],thumbnail[2]);
 const iconAdminFile=p.match(/^\/api\/admin\/icons\/([a-f0-9-]{36})\/file$/i);
 if(iconAdminFile&&['GET','HEAD'].includes(method))return iconFile(env,iconAdminFile[1],req);
 const assetAdminFile=p.match(/^\/api\/admin\/assets\/([a-f0-9-]{36})\/file$/i);
 if(assetAdminFile&&['GET','HEAD'].includes(method))return serveAsset(env,assetAdminFile[1],req);
 const iconToDelete=p.match(/^\/api\/admin\/icons\/([a-f0-9-]{36})$/i);
 if(iconToDelete&&method==='DELETE'){
  const id=iconToDelete[1];
  if(!IP_UUID.test(id))return fail('图标不存在',404);
  const obj=await env.FILES.head(iconKey(id));
  if(!obj)return fail('图标不存在',404);
  const ref=await env.DB.prepare('SELECT id FROM items WHERE thumbnail LIKE ? LIMIT 1').bind('%/api/icon/'+id+'%').first();
  if(ref)return fail('此图标正在被前台卡片使用，请先更换该卡片封面',409);
  await Promise.all([env.FILES.delete(iconKey(id)),env.FILES.delete(THUMB_PREFIX+'icons/'+id+'.webp')]);
  return out({ok:true});
 }

 if(method==='GET'&&p==='/api/admin/me')return out({ok:true,admin:true,twoFactor:true});
 if(method==='POST'&&p==='/api/admin/logout')return out({ok:true},200,{'set-cookie':'mswq_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
 if(method==='POST'&&p==='/api/admin/types'){
  const body=await parse(req,10000),settings=await config(env),bad=checkTypeName(settings,'',body?.name);
  if(bad)return fail(bad,400);
  if(settings.custom_types.length>=100)return fail('自定义分类最多100个',409);
  const type={id:'custom_'+crypto.randomUUID().replace(/-/g,''),name:String(body.name).trim()};
  const custom_types=[...settings.custom_types,type];
  const type_order=[...new Set([...settings.type_order,...allTypeIds(settings)])].filter(id=>!settings.deleted_types.includes(id)).concat(type.id);
  await env.DB.batch([
   env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('custom_types',JSON.stringify(custom_types)),
   env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('type_order',JSON.stringify(type_order))
  ]);
  return out({ok:true,type,custom_types,type_order},201);
 }
 if(method==='PUT'&&p==='/api/admin/types/name'){
  const body=await parse(req,10000),id=String(body?.id||''),settings=await config(env);
  if(!allTypeIds(settings).includes(id))return fail('分类不存在',404);
  const bad=checkTypeName(settings,id,body?.name);if(bad)return fail(bad,400);
  const name=String(body.name).trim();
  let custom_types=settings.custom_types,type_labels=settings.type_labels;
  if(Object.hasOwn(CORE_TYPE_LABELS,id)){
   type_labels={...settings.type_labels,[id]:name};
   await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('type_labels',JSON.stringify(type_labels)).run();
  }else{
   custom_types=settings.custom_types.map(x=>x.id===id?{...x,name}:x);
   await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('custom_types',JSON.stringify(custom_types)).run();
  }
  return out({ok:true,custom_types,type_labels});
 }
 if(method==='PUT'&&p==='/api/admin/types/order'){
  const body=await parse(req,12000),settings=await config(env),order=body?.order;
  const ids=allTypeIds(settings).filter(id=>!settings.deleted_types.includes(id));
  if(!Array.isArray(order)||order.length!==ids.length||new Set(order).size!==ids.length||!ids.every(id=>order.includes(id)))return fail('分类已变化，请刷新后重试',409);
  await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('type_order',JSON.stringify(order)).run();
  return out({ok:true,type_order:order});
 }
 if(method==='PUT'&&p==='/api/admin/types/restore'){
  const body=await parse(req,10000),id=String(body?.id||''),settings=await config(env);
  if(!allTypeIds(settings).includes(id)||!settings.deleted_types.includes(id))return fail('没有找到已删除分类',404);
  const deleted_types=settings.deleted_types.filter(x=>x!==id),hidden_types=settings.hidden_types.filter(x=>x!==id);
  const active=allTypeIds(settings).filter(x=>!settings.deleted_types.includes(x)&&x!==id);
  const type_order=[...new Set([...settings.type_order,...active])].filter(x=>active.includes(x)).concat(id);
  await env.DB.batch([
   env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('deleted_types',JSON.stringify(deleted_types)),
   env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('hidden_types',JSON.stringify(hidden_types)),
   env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('type_order',JSON.stringify(type_order))
  ]);
  return out({ok:true,deleted_types,hidden_types,type_order});
 }
 if(method==='PUT'&&p==='/api/admin/types/visibility'){
  const body=await parse(req,10000),id=String(body?.id||''),hidden=body?.hidden,settings=await config(env);
  if(typeof hidden!=='boolean')return fail('请选择显示或隐藏',400);
  if(!allTypeIds(settings).includes(id)||settings.deleted_types.includes(id))return fail('分类不存在',404);
  const hidden_types=[...new Set(hidden?[...settings.hidden_types,id]:settings.hidden_types.filter(x=>x!==id))];
  await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('hidden_types',JSON.stringify(hidden_types)).run();
  return out({ok:true,hidden_types});
 }
 const typeDelete=p.match(/^\/api\/admin\/types\/(personal|group|document|page|link|bookmarks|profile|custom_[a-f0-9]{32})$/);
 if(method==='DELETE'&&typeDelete){
  const id=typeDelete[1],settings=await config(env);
  if(!allTypeIds(settings).includes(id))return fail('分类不存在',404);
  if(settings.deleted_types.includes(id))return fail('分类已删除',409);
  const deleted_types=[...settings.deleted_types,id],type_order=settings.type_order.filter(x=>x!==id);
  await env.DB.batch([
   env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('deleted_types',JSON.stringify(deleted_types)),
   env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('type_order',JSON.stringify(type_order))
  ]);
  return out({ok:true,deleted_types,type_order});
 }
 if(method==='PUT'&&p==='/api/admin/items/order'){
  const body=await parse(req,180000);
  const category=String(body?.category||''),order=body?.order,versions=body?.versions;
  if(!/^(?:personal|group|document|page|link|bookmarks|profile|custom_[a-f0-9]{32})$/.test(category))return fail('分类编号不正确',400);
  if(!Array.isArray(order)||order.length<2||order.length>500||order.some(id=>!(/^[a-f0-9-]{36}$/i.test(String(id))))||new Set(order).size!==order.length)return fail('排序内容列表无效',400);
  if(!versions||typeof versions!=='object'||Array.isArray(versions))return fail('排序版本信息缺失，请刷新列表',400);
  const existing=await env.DB.prepare('SELECT id,kind,category,version,sort_order FROM items').all();
  const group=(existing.results||[]).filter(item=>frontTabForItem(item)===category);
  if(group.length!==order.length||!group.every(item=>order.includes(item.id)))return fail('分类中的内容已变化，请刷新内容列表后重试',409);
  if(group.some(item=>!Number.isInteger(versions[item.id])||versions[item.id]!==item.version))return fail('有内容已被其他操作修改，请刷新后重新排序',409);
  const byId=new Map(group.map(item=>[item.id,item]));
  const statements=order.map((id,i)=>env.DB.prepare('UPDATE items SET sort_order=?, version=version+1 WHERE id=? AND version=?')
   .bind((i+1)*10,id,byId.get(id).version));
  const results=await env.DB.batch(statements);
  if(results.some(result=>Number(result.meta?.changes??0)!==1))return fail('排序更新未完全成功，请刷新列表核对',409);
  return out({ok:true,category,order});
 }
 // Assign card to a child group without touching its content or version.
 // This preserves signed original reader HTML and unchanged shared links.
 if(method==='PUT'&&p==='/api/admin/items/subgroup'){
  const body=await parse(req,3000),id=String(body?.itemId||''),
   subgroupId=String(body?.subgroupId??''),expected=String(body?.expectedSubgroupId??'');
  if(!/^[a-f0-9-]{36}$/i.test(id)||subgroupId&&!/^[a-f0-9-]{36}$/i.test(subgroupId)||
      expected&&!/^[a-f0-9-]{36}$/i.test(expected))return fail('无效的工具或子分组编号',400);
  const row=await env.DB.prepare('SELECT id,kind,category,content FROM items WHERE id=?').bind(id).first();
  if(!row)return fail('找不到这个工具，请刷新列表',404);
  const settings=await config(env),category=frontTabForItem(row);
  if(subgroupId&&!settings.subgroups.some(g=>g.id===subgroupId&&g.category===category))return fail('目标子分组不属于当前主分类',400);
  const existing=resolvedItemSubgroup(record(row,false),settings).subgroupId;
  if(existing!==expected)return fail('该工具已被其他操作移动，请刷新后重试',409);
  if(existing===subgroupId)return out({ok:true,itemId:id,subgroupId});
  const updated={...settings.item_subgroups,[id]:subgroupId};
  await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .bind('item_subgroups',JSON.stringify(updated)).run();
  return out({ok:true,itemId:id,subgroupId});
 }
 if(method==='GET'&&p==='/api/admin/items'){
  const [rows,settings]=await Promise.all([
   env.DB.prepare('SELECT * FROM items ORDER BY sort_order ASC,updated_at DESC').all(),config(env)
  ]);
  return out({ok:true,items:(rows.results||[]).map(r=>resolvedItemSubgroup(record(r),settings))});
 }
 if(method==='POST'&&p==='/api/admin/items'){
  const body=await parse(req);
  const invalid=validateSpecialContent(body);if(invalid)return fail(invalid,400);
  const item=normalizeItem(body);
  const availability=await config(env);
  if(['document','html'].includes(item.kind)){
   const displayCategory=item.category||(item.kind==='html'?'page':'document');
   if(!allTypeIds(availability).includes(displayCategory)||availability.deleted_types.includes(displayCategory))return fail('所选前台分类不存在或已删除，请重新选择',409);
   if(availability.hidden_types.includes(displayCategory))return fail('所选前台分类已隐藏，请先显示或更换分类',409);
  }else if((item.kind.startsWith('custom_')&&!availability.custom_types.some(t=>t.id===item.kind))||availability.deleted_types.includes(item.kind))return fail('分类已删除，请恢复后再创建',409);
  const htmlError=await verifyHtmlItem(env,item);if(htmlError)return fail(htmlError,400);
  try{return out({ok:true,item:await saveItem(env,item)},201)}catch(e){if(String(e).includes('UNIQUE'))return fail('访问路径重复，请更换 slug',409);throw e;}
 }
 const exactMatch=p.match(new RegExp('^/api/admin/items/([a-f0-9-]{32,40})/export-html$'));
 // Recover the exact editable group source stored inside the original HTML.
 // This endpoint is admin-only (same authorization gate as other /api/admin APIs).
 if(method==='GET'&&exactMatch){
  const row=await env.DB.prepare("SELECT id,kind FROM items WHERE id=?").bind(exactMatch[1]).first();
  if(!row||row.kind!=='group')return fail('找不到对应的群剧本',404);
  const file=await env.FILES.get('published-readers/'+row.id+'.html');
  if(!file)return fail('尚未找到保存的原版 HTML，可在原编辑器重新发布一次',404);
  return new Response(file.body,{status:200,headers:{
   'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'
  }});
 }
 if(method==='PUT'&&exactMatch){
  const id=exactMatch[1];
  const item=await env.DB.prepare('SELECT id,kind,version,title,content FROM items WHERE id=?').bind(id).first();
  if(!item)return fail('内容不存在',404);
  if(!['personal','group'].includes(item.kind))return fail('仅个人流程和群剧本支持原版 HTML 直发',400);
  if(req.headers.get('x-mswq-item-version')!==String(item.version))return fail('内容已更新，请重新发布以保证页面与最新数据一致',409);
  const declared=Number(req.headers.get('content-length')||0);
  if(declared>35_000_000)return fail('HTML 文件大于 35 MB，请减少附件后重试',413);
  const bytes=await req.arrayBuffer();
  if(bytes.byteLength<200||bytes.byteLength>35_000_000)return fail('HTML 导出内容为空或超过 35 MB',413);
  const head=new TextDecoder().decode(bytes.slice(0,250));
  const tail=new TextDecoder().decode(bytes.slice(-250));
  if(!head.trimStart().toLowerCase().startsWith('<!doctype html>')||!tail.trimEnd().toLowerCase().endsWith('</html>'))return fail('仅接受原编辑器生成的完整 HTML 文件',400);
  // Enforce the same return-home button as the shared original HTML export,
  // even if the publishing browser still has an older cached editor script.
  const incomingHtml=new TextDecoder().decode(bytes);
  let finalHtml;
  try{finalHtml=mswqReaderAddBackLink(incomingHtml)}
  catch(e){return fail('发布 HTML 缺少有效的导航结构，请刷新编辑器并重新发布：'+e.message,400)}
  const finalBytes=enc(finalHtml);
  if(finalBytes.byteLength>35_000_000)return fail('HTML 文件加上返回按钮后超过35MB',413);
  const signature=base64url(await digest(item.title+'\0'+item.content));
  await env.FILES.put('published-readers/'+id+'.html',finalBytes,{httpMetadata:{contentType:'text/html; charset=utf-8'},customMetadata:{signature,kind:item.kind,version:String(item.version),source:'original-editor-export'}});
  return out({ok:true,stored:true,bytes:finalBytes.byteLength,backButton:true,autoRepaired:finalBytes.byteLength!==bytes.byteLength,version:item.version});
 }
 const match=p.match(/^\/api\/admin\/items\/([a-f0-9-]{32,40})$/);
 if(match){
  const id=match[1],old=await env.DB.prepare('SELECT * FROM items WHERE id=?').bind(id).first();
  if(!old)return fail('内容不存在',404);
  if(method==='GET')return out({ok:true,item:resolvedItemSubgroup(record(old),await config(env))});
  if(method==='PUT'){
   const body=await parse(req);
   if(body.version!==old.version)return fail('版本已更新，请刷新后重试，避免覆盖其他修改',409);
   const invalid=validateSpecialContent(body);if(invalid)return fail(invalid,400);
   const item=normalizeItem(body,id);
   const availability=await config(env);
    if(['document','html'].includes(item.kind)){
     const displayCategory=item.category||(item.kind==='html'?'page':'document');
     if(!allTypeIds(availability).includes(displayCategory)||availability.deleted_types.includes(displayCategory))return fail('所选前台分类不存在或已删除，请重新选择',409);
     if(availability.hidden_types.includes(displayCategory))return fail('所选前台分类已隐藏，请先显示或更换分类',409);
    }else if((item.kind.startsWith('custom_')&&!availability.custom_types.some(t=>t.id===item.kind))||(availability.deleted_types.includes(item.kind)&&old.kind!==item.kind))return fail('分类已删除，请先恢复',409);
    const htmlError=await verifyHtmlItem(env,item);if(htmlError)return fail(htmlError,400);
   try{
    const result=await saveItem(env,item,old);
    if(Object.hasOwn(availability.item_subgroups,id)){
     const subgroupId=String(body?.content?.subgroupId||'');
     if(subgroupId!==availability.item_subgroups[id]){
      const updated={...availability.item_subgroups,[id]:subgroupId};
      await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
       .bind('item_subgroups',JSON.stringify(updated)).run();
     }
    }
    return out({ok:true,item:result});
   }catch(e){if(String(e).includes('UNIQUE'))return fail('访问路径重复，请使用其他公开路径（slug）',409);throw e;}
  }
  if(method==='DELETE'){
   await env.DB.prepare('INSERT INTO revisions(id,item_id,version,data,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,old.version,JSON.stringify(record(old)),iso()).run();
   await env.DB.prepare('DELETE FROM items WHERE id=?').bind(id).run();
   if(['personal','group'].includes(old.kind))await env.FILES.delete('published-readers/'+id+'.html');
   // Remove stale subgroup assignments for deleted items, including old test IDs.
   // These are independent display preferences, not part of the signed reader content.
   const cfg=await config(env),overrides=cfg.item_subgroups||{};
   if(Object.keys(overrides).length){
    const active=await env.DB.prepare('SELECT id FROM items').all();
    const valid=new Set((active.results||[]).map(row=>row.id));
    const remaining=Object.fromEntries(Object.entries(overrides).filter(([key])=>valid.has(key)));
    if(Object.keys(remaining).length!==Object.keys(overrides).length)
     await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind('item_subgroups',JSON.stringify(remaining)).run();
   }
   return out({ok:true});
  }
 }
 if(method==='GET'&&p==='/api/admin/settings')return out({ok:true,settings:await config(env)});
 if(method==='PUT'&&p==='/api/admin/settings'){
  const body=await parse(req,80000);
  const keys=['brand','headline','description','layout','footer','announcement','docx_url'];
  for(const key of keys)if(body[key]!==undefined){
   const val=cleanString(body[key],key==='description'?1200:500);
   if(key==='docx_url'&&val&&!allowedUrl(val)&&!val.startsWith('/docx'))return fail('文档工具网址必须是 /docx 或 HTTPS/HTTP 地址');
   await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,val).run();
  }
  if(body.subgroups!==undefined){
   if(!Array.isArray(body.subgroups)||body.subgroups.length>200)return fail('子分组数据无效或超过 200 个',400);
   const cfg=await config(env),valid=new Set([...Object.keys(CORE_TYPE_LABELS),'html',...(cfg.custom_types||[]).map(x=>x.id)]);
   const usedId=new Set(),usedName=new Set(),outGroups=[];
   for(const x of body.subgroups){
    const id=String(x?.id||''),category=String(x?.category||''),name=cleanString(x?.name||'',40).trim();
    if(!/^[a-f0-9-]{36}$/i.test(id)||!valid.has(category)||!name||/[<>\u0000-\u001f]/.test(name))return fail('子分组 ID、名称或父级分类无效',400);
    const code=category+'\0'+name.toLocaleLowerCase();
    if(usedId.has(id)||usedName.has(code))return fail('子分组不能重复',400);
    usedId.add(id);usedName.add(code);outGroups.push({id,category,name});
   }
   await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('subgroups',JSON.stringify(outGroups)).run();
  }
  return out({ok:true,settings:await config(env)});
 }
 if(method==='GET'&&p==='/api/admin/revisions'){
  const id=url.searchParams.get('id');
  if(!id)return fail('缺少 id');
  const rows=await env.DB.prepare('SELECT id,item_id,version,created_at FROM revisions WHERE item_id=? ORDER BY created_at DESC LIMIT 30').bind(id).all();
  return out({ok:true,revisions:rows.results||[]});
 }
 if(method==='POST'&&p==='/api/admin/restore'){
  const body=await parse(req,2000);
  const revision=await env.DB.prepare('SELECT * FROM revisions WHERE id=?').bind(String(body.id||'')).first();
  if(!revision)return fail('历史版本不存在',404);
  const old=await env.DB.prepare('SELECT * FROM items WHERE id=?').bind(revision.item_id).first();
  if(!old)return fail('内容已被删除，请从备份重新导入',404);
  const restore=JSON.parse(revision.data),normalized=normalizeItem(restore,old.id);
  return out({ok:true,item:await saveItem(env,normalized,old)});
 }
 if(method==='POST'&&p==='/api/admin/import')return out(await importBundle(env,await parse(req,10000000)));

 // Upload and activate complete HTML tool packages. Keep the same HTML asset ID
 // when replacing a package so front-end cards and direct links do not change.
 if(method==='POST'&&p==='/api/admin/html-packages/file'){
  const id=req.headers.get('x-package-id')||'',version=req.headers.get('x-package-version')||'';
  let path='';
  try{path=htmlPackagePath(decodeURIComponent(req.headers.get('x-package-path')||''))}catch{}
  if(!HTML_PACKAGE_UUID.test(id)||!HTML_PACKAGE_UUID.test(version)||!path)return fail('工具包文件名或上传标识不合法',400);
  const limit=/\.(?:mp4|webm)$/i.test(path)?50000000:35000000;
  if(Number(req.headers.get('content-length')||0)>limit)return fail('单个工具文件超过上传限制',413);
  const bytes=await req.arrayBuffer();
  if(bytes.byteLength>limit)return fail('单个工具文件超过 '+Math.round(limit/1000000)+'MB',413);
  const key=htmlPackageFileKey(id,version,path);
  await env.FILES.put(key,bytes,{httpMetadata:{contentType:htmlPackageMime(path)}});
  return out({ok:true,path,size:bytes.byteLength});
 }
 if(method==='POST'&&p==='/api/admin/html-packages/archive'){
  const id=req.headers.get('x-package-id')||'',version=req.headers.get('x-package-version')||'';
  if(!HTML_PACKAGE_UUID.test(id)||!HTML_PACKAGE_UUID.test(version))return fail('压缩包上传标识无效');
  if(Number(req.headers.get('content-length')||0)>70000000)return fail('ZIP 超过 70MB',413);
  const bytes=await req.arrayBuffer();
  if(!bytes.byteLength||bytes.byteLength>70000000)return fail('ZIP 超过限制',413);
  await env.FILES.put(htmlPackageFileKey(id,version,'__original.zip'),bytes,{httpMetadata:{contentType:'application/zip'}});
  return out({ok:true,size:bytes.byteLength});
 }
 if(method==='POST'&&p==='/api/admin/html-packages/publish'){
  const body=await parse(req,100000);
  const id=String(body.id||''),version=String(body.version||''),entry=htmlPackagePath(body.entry);
  const name=cleanString(body.name||'HTML 工具包',200).trim();
  if(!HTML_PACKAGE_UUID.test(id)||!HTML_PACKAGE_UUID.test(version)||!entry||!/.html?$/i.test(entry)||!name)return fail('工具包名称或入口页面不合法');
  if(!Array.isArray(body.files)||!body.files.length||body.files.length>300)return fail('工具包必须包含 1 至 300 个文件');
  const old=await env.DB.prepare('SELECT * FROM assets WHERE id=?').bind(id).first();
  if(old&&old.mime!=='text/html')return fail('只能覆盖原来的 HTML 类型文件',409);
  const manifestFiles={},used=new Set();let total=0;
  for(const f of body.files){
   const path=htmlPackagePath(f.path),size=Number(f.size);
   if(!path||used.has(path.toLowerCase())||!Number.isSafeInteger(size)||size<0||size>50000000)return fail('工具包中包含重复或非法文件路径',400);
   used.add(path.toLowerCase());
   const key=htmlPackageFileKey(id,version,path),obj=await env.FILES.head(key);
   if(!obj||obj.size!==size)return fail('文件缺失或上传不完整: '+path,409);
   total+=size;
   if(total>150000000)return fail('工具包总容量不能超过 150MB',413);
   manifestFiles[path]={key,size,mime:htmlPackageMime(path)};
  }
  if(!manifestFiles[entry])return fail('入口 HTML 不在所上传文件列表中',400);
  let archiveKey='';
  if(body.hasArchive===true){
   archiveKey=htmlPackageFileKey(id,version,'__original.zip');
   if(!await env.FILES.head(archiveKey))return fail('ZIP 压缩包未上传完整',409);
  }
  const oldManifest=await htmlPackageManifest(env,id);
  const manifest={version,entry,files:manifestFiles,archiveKey,name,updatedAt:iso(),previousVersion:oldManifest?.version||null};
  const entryKey=manifestFiles[entry].key,entrySize=manifestFiles[entry].size;
  if(old){
   await env.DB.prepare('UPDATE assets SET name=?,size=?,key=? WHERE id=?').bind(name,entrySize,entryKey,id).run();
  }else{
   await env.DB.prepare('INSERT INTO assets(id,name,mime,size,key,created_at) VALUES(?,?,?,?,?,?)')
    .bind(id,name,'text/html',entrySize,entryKey,iso()).run();
  }
  // Publish the version pointer last: old pages remain intact until all files are present.
  await env.FILES.put(htmlPackageManifestKey(id),JSON.stringify(manifest),{httpMetadata:{contentType:'application/json'}});
  return out({ok:true,id,entry,totalSize:total,count:body.files.length,url:htmlAssetLink(id),replaced:!!old});
 }

 // Only manifest-listed files of the active version may be downloaded.
 const packageFile=p.match(/^\/api\/admin\/html-packages\/([a-f0-9-]{36})\/file$/i);
 if(packageFile&&method==='GET'&&HTML_PACKAGE_UUID.test(packageFile[1])){
  const id=packageFile[1],row=await env.DB.prepare('SELECT mime FROM assets WHERE id=?').bind(id).first();
  if(row?.mime!=='text/html')return fail('HTML 文件不存在',404);
  const m=await htmlPackageManifest(env,id);
  if(!m)return fail('该 HTML 没有关联资源文件',404);
  const filePath=htmlPackagePath(url.searchParams.get('path')||'');
  if(!filePath||!Object.hasOwn(m.files,filePath))return fail('文件不在工具包清单中',404);
  const f=m.files[filePath],obj=await env.FILES.get(f.key);
  if(!obj)return fail('源文件不存在',404);
  return new Response(obj.body,{headers:{
   'content-type':'application/octet-stream','x-content-type-options':'nosniff',
   'content-security-policy':"default-src 'none'; sandbox",
   'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(filePath.split('/').pop()),
   'cache-control':'private,no-store','content-length':String(f.size)
  }});
 }
 const packageInfo=p.match(/^\/api\/admin\/html-packages\/([a-f0-9-]{36})(?:\/(download))?$/i);
 if(packageInfo&&HTML_PACKAGE_UUID.test(packageInfo[1])&&method==='GET'){
  const id=packageInfo[1],row=await env.DB.prepare('SELECT id,name,mime FROM assets WHERE id=?').bind(id).first();
  if(!row||row.mime!=='text/html')return fail('HTML 工具不存在',404);
  const m=await htmlPackageManifest(env,id);
  if(!m)return fail('这是独立 HTML 文件，不是多文件工具包',404);
  if(packageInfo[2]==='download'){
   if(!m.archiveKey)return fail('此工具包未保存 ZIP 下载副本',404);
   const obj=await env.FILES.get(m.archiveKey);
   if(!obj)return fail('ZIP 文件不存在',404);
   return new Response(obj.body,{headers:{'content-type':'application/zip','cache-control':'private,no-store',
    'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(row.name.replace(/\.zip$/i,'')+'.zip')}});
  }
  return out({ok:true,id,name:row.name,entry:m.entry,version:m.version,hasArchive:!!m.archiveKey,
   url:htmlAssetLink(id),files:Object.entries(m.files).map(([path,f])=>({path,size:f.size,mime:f.mime}))});
 }


 // Renaming preserves the original asset ID, package bytes and published links.
 const renameAsset=p.match(/^\/api\/admin\/assets\/([a-f0-9-]{36})$/i);
 if(renameAsset&&method==='PATCH'&&HTML_PACKAGE_UUID.test(renameAsset[1])){
  const id=renameAsset[1];
  const row=await env.DB.prepare('SELECT id,name,mime FROM assets WHERE id=?').bind(id).first();
  if(!row||row.mime!=='text/html')return fail('HTML 文件不存在',404);
  const body=await parse(req,2048);
  let name=cleanString(body.name||'',200).trim();
  if(!name)return fail('请填写文件名称',400);
  const m=await htmlPackageManifest(env,id);
  if(!m&&!/\.html?$/i.test(name))name+=/\.htm$/i.test(row.name)?'.htm':'.html';
  await env.DB.prepare('UPDATE assets SET name=? WHERE id=?').bind(name,id).run();
  return out({ok:true,id,name});
 }
 if(method==='GET'&&p==='/api/admin/assets'){
  const rows=await env.DB.prepare('SELECT * FROM assets ORDER BY created_at DESC LIMIT 500').all();
  return out({ok:true,assets:(rows.results||[]).map(x=>({id:x.id,name:x.name,mime:x.mime,size:x.size,created_at:x.created_at,url:'/api/asset/'+x.id}))});
 }
 if(method==='POST'&&p==='/api/admin/assets'){
  const name=cleanString(decodeURIComponent(req.headers.get('x-file-name')||'file'),200);
  const mime=cleanString(req.headers.get('content-type')||'application/octet-stream',100);
  const allowed=['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain','application/zip','text/html'];
  if(!allowed.includes(mime))return fail('不支持的文件类型。支持图片、MP4/WebM 视频及常用文档');
  if(mime==='text/html'&&!/\.html?$/i.test(name))return fail('HTML 文件后缀必须是 .html 或 .htm');
  const sizeLimit=videoMime(mime)?50000000:mime==='text/html'?35000000:12000000;
  const stated=Number(req.headers.get('content-length')||0);
  if(stated>sizeLimit)return fail(mime==='text/html'?'HTML 不能超过 35MB':videoMime(mime)?'视频不能超过 50MB':'单个文件不能超过 12MB',413);
  const bytes=await req.arrayBuffer();
  if(bytes.byteLength>sizeLimit)return fail(mime==='text/html'?'HTML 不能超过 35MB':videoMime(mime)?'视频不能超过 50MB':'单个文件不能超过 12MB',413);
  if(!bytes.byteLength)return fail('空文件不能上传');
  if(mime==='text/html'){
   const start=new TextDecoder().decode(bytes.slice(0,8192)),end=new TextDecoder().decode(bytes.slice(-8192));
   if(!/<html[\s>]/i.test(start)||!/<\/html\s*>/i.test(end))return fail('请选择包含完整 HTML 页面结构的文件',400);
  }
  const id=crypto.randomUUID();
  await env.FILES.put(id,bytes,{httpMetadata:{contentType:mime}});
  try{await env.DB.prepare('INSERT INTO assets(id,name,mime,size,key,created_at) VALUES(?,?,?,?,?,?)').bind(id,name,mime,bytes.byteLength,id,iso()).run()}
  catch(e){await env.FILES.delete(id);throw e;}
  return out({ok:true,asset:{id,name,mime,size:bytes.byteLength,url:'/api/asset/'+id}},201);
 }
 if(method==='DELETE'&&p.startsWith('/api/admin/assets/')){
  const id=p.split('/').pop();
  const row=await env.DB.prepare('SELECT * FROM assets WHERE id=?').bind(id).first();
  if(!row)return fail('资源不存在',404);
  // Avoid deleting referenced assets: content holds opaque asset IDs.
  const ref=await env.DB.prepare('SELECT id FROM items WHERE content LIKE ? OR thumbnail LIKE ? LIMIT 1').bind('%'+id+'%','%/api/asset/'+id+'%').first();
  if(ref)return fail('有内容或卡片封面正在使用此文件，请先取消关联',409);
  const bundle=await htmlPackageManifest(env,id);
  if(bundle){
   let cursor;
   do{
    const listed=await env.FILES.list({prefix:'html-packages/'+id+'/',limit:500,cursor});
    if(listed.objects.length)await env.FILES.delete(listed.objects.map(x=>x.key));
    cursor=listed.truncated?listed.cursor:undefined;
   }while(cursor);
  }
  await Promise.all([env.FILES.delete(row.key),env.FILES.delete(THUMB_PREFIX+'assets/'+id+'.webp')]);
  // Older standalone HTML versions might still exist at the legacy UUID key.
  if(bundle&&row.key!==id)await env.FILES.delete(id);
  await env.DB.prepare('DELETE FROM assets WHERE id=?').bind(id).run();
  return out({ok:true});
 }
 if(method==='GET'&&p==='/api/admin/export'){
  const rows=await env.DB.prepare('SELECT * FROM items ORDER BY sort_order,created_at').all();
  return out({app:'MSWQ',version:1,exportedAt:iso(),settings:await config(env),items:(rows.results||[]).map(record=>({
   ...record,content:JSON.parse(record.content||'{}'),tags:JSON.parse(record.tags||'[]')
  }))});
 }
 return fail('接口不存在',404);
}
export default {async fetch(req,env){
 try{
  if(!env.DB||!env.FILES)return fail('MSWQ 存储绑定未配置',503);
  return await handler(req,env);
 }catch(err){
  console.error('MSWQ error',err);
  return fail('服务端处理失败，请稍后重试',500);
 }
}};
