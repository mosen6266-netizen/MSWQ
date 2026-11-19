// MSWQ content API — Cloudflare Worker with isolated D1/R2 storage.
// Placeholders are replaced by the deployment build step; do not store secrets in this repository.
const ASSETS = __MSWQ_ASSETS__;
// MSWQ test adapter operating on shared DOCX D1/KV without modifying original service.
const DOCX_ADMIN_BACKEND = __MSWQ_DOCX_API__;
// Temporary development mode. Set to false when MSWQ needs authentication.
const MSWQ_TEST_OPEN_ADMIN = true;
const encoder = new TextEncoder();
const enc = value => encoder.encode(value);
const CORS_SAME_ORIGIN_ONLY = true;
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
function base64url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function fromBase64url(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
async function digest(s){return new Uint8Array(await crypto.subtle.digest('SHA-256',enc(s)));}
async function sameSecret(a,b){const [x,y]=await Promise.all([digest(a),digest(b)]);return x.length===y.length&&x.every((v,i)=>v===y[i]);}
async function hmac(secret,text){
 const key=await crypto.subtle.importKey('raw',enc(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return new Uint8Array(await crypto.subtle.sign('HMAC',key,enc(text)));
}
async function sessionValid(req,env){
 if(!env.ADMIN_PASSWORD)return false;
 const token=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('mswq_session='));
 if(!token)return false;
 const pieces=token.slice(13).split('.');
 if(pieces.length!==2)return false;
 try{
  const payload=new TextDecoder().decode(fromBase64url(pieces[0]));
  const parsed=JSON.parse(payload);
  if(!parsed.exp || parsed.exp<Date.now() || parsed.exp>Date.now()+8*86400000)return false;
  const expected=await hmac(env.SESSION_SECRET||env.ADMIN_PASSWORD+':mswq-v1',pieces[0]);
  const received=fromBase64url(pieces[1]);
  return expected.length===received.length&&expected.every((v,i)=>v===received[i]);
 }catch{return false;}
}
async function newSession(env){
 const expires=Date.now()+7*86400000;
 const payload=base64url(enc(JSON.stringify({exp:expires,nonce:crypto.randomUUID()})));
 return payload+'.'+base64url(await hmac(env.SESSION_SECRET||env.ADMIN_PASSWORD+':mswq-v1',payload));
}
function cookie(token){return 'mswq_session='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800';}
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
 const kind=['personal','group','document','page','link'].includes(incoming.kind)?incoming.kind:'page';
 const status=incoming.status==='published'?'published':'draft';
 const content=incoming.content&&typeof incoming.content==='object'?incoming.content:{blocks:[]};
 const blocks=Array.isArray(content.blocks)?content.blocks.slice(0,600):[];
 const members=Array.isArray(content.members)?content.members.slice(0,150):[];
 const normalized={...content,blocks,members};
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
function record(r,includeContent=true){
 if(!r)return null;
 const z={id:r.id,kind:r.kind,status:r.status,title:r.title,slug:r.slug,description:r.description,category:r.category,tags:JSON.parse(r.tags||'[]'),sort_order:r.sort_order,thumbnail:r.thumbnail,created_at:r.created_at,updated_at:r.updated_at,version:r.version};
 if(includeContent)z.content=JSON.parse(r.content||'{}');
 return z;
}
async function config(env){
 const rows=await env.DB.prepare('SELECT key,value FROM settings').all();
 const out={brand:'MSWQ',headline:'内容与工具中心',description:'选择你需要查看的流程、剧本或文档',layout:'grid',footer:'',announcement:'',docx_url:'/docx'};
 for(const {key,value} of rows.results||[])out[key]=value;
 return out;
}
async function fetchPublic(env){
 const items=await env.DB.prepare("SELECT * FROM items WHERE status='published' ORDER BY sort_order ASC, updated_at DESC").all();
 return {ok:true,settings:await config(env),items:(items.results||[]).map(r=>record(r,false))};
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
function imageMime(type){return /^image\/(?:jpeg|png|gif|webp)$/i.test(type);}
async function serveAsset(env,id){
 const row=await env.DB.prepare('SELECT * FROM assets WHERE id=?').bind(id).first();
 if(!row)return fail('文件不存在',404);
 const obj=await env.FILES.get(row.key);
 if(!obj)return fail('文件不存在',404);
 const type=imageMime(row.mime)?row.mime:'application/octet-stream';
 const filename=encodeURIComponent(row.name);
 return new Response(obj.body,{headers:{'content-type':type,'content-length':String(row.size),'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'content-disposition':(imageMime(row.mime)?'inline':'attachment')+"; filename*=UTF-8''"+filename,'cache-control':'public,max-age=86400'}});
}
function publicDocxPage(value){
 const response=html(value,true),headers=new Headers(response.headers);
 headers.set('content-security-policy',"default-src 'self' data: blob:; script-src 'unsafe-inline' 'self' blob:; style-src 'unsafe-inline' 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-ancestors 'self'");
 return new Response(value,{status:200,headers});
}
async function handler(req,env){
 const url=new URL(req.url),p=url.pathname,method=req.method;
 // Compatibility for old template links mistakenly generated as /?template=<id>.
 // Serve the selected DOCX template in place, without redirecting to another page.
 if(method==='GET'&&p==='/'&&/^[a-f0-9-]{16,60}$/i.test(url.searchParams.get('template')||''))return publicDocxPage(ASSETS.docx);
 // Render all published content within the MSWQ shell; the frontend selects the
 // full-width embedded DOCX view without redirecting or creating another tab.
 if(method==='GET'&&(p==='/'||p==='/admin'||p==='/admin/'||p.startsWith('/view/')))return html(ASSETS.html);
 if(method==='GET'&&p==='/assets/app.js')return new Response(ASSETS.js,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 if(method==='GET'&&p==='/assets/app.css')return new Response(ASSETS.css,{headers:{'content-type':'text/css; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 if(method==='GET'&&p==='/assets/legacy-bridge.js')return new Response(ASSETS.bridge,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 if(method==='GET'&&(p==='/docx'||p==='/docx/'))return publicDocxPage(ASSETS.docx);
 if(method==='GET'&&p==='/api/docx/session')return out({admin:false});
 if(p.startsWith('/api/docx/')){
  if(method!=='GET')return fail('公开文档服务不支持管理操作',405);
  if(!/^\/api\/docx\/templates(?:\/[a-f0-9-]{16,60}\/(?:docx|version))?$/.test(p))return fail('文档接口不存在',404);
  const target='https://ms-khmb.mosen6266-ms007.workers.dev'+p.replace('/api/docx/','/api/')+url.search;
  const remote=env.DOCX_SERVICE?await env.DOCX_SERVICE.fetch(new Request(target,{method:'GET'})):await fetch(target);
  const headers=new Headers({'cache-control':'no-store','x-content-type-options':'nosniff'});
  for(const key of ['content-type','x-template-version','content-disposition','content-length']){
   const value=remote.headers.get(key);if(value)headers.set(key,value);
  }
  return new Response(remote.body,{status:remote.status,headers});
 }
 if(method==='GET'&&p==='/api/health')return out({ok:true,app:'MSWQ',version:'1.0.8',testMode:MSWQ_TEST_OPEN_ADMIN});
 if(method==='GET'&&p==='/api/public')return out(await fetchPublic(env));
 if(method==='GET'&&p.startsWith('/api/public/item/')){
  const slug=decodeURIComponent(p.slice('/api/public/item/'.length));
  const row=await env.DB.prepare("SELECT * FROM items WHERE slug=? AND status='published'").bind(slug).first();
  return row?out({ok:true,item:record(row)}):fail('页面不存在或尚未发布',404);
 }
 if(method==='GET'&&p.startsWith('/api/asset/'))return serveAsset(env,p.split('/').pop());
 if(method==='POST'&&p==='/api/admin/login'){
  if(MSWQ_TEST_OPEN_ADMIN)return out({ok:true,testMode:true});
  if(!checkOrigin(req))return fail('请求来源不合法',403);
  if(!env.ADMIN_PASSWORD)return fail('请先在 Cloudflare Worker 中设置 ADMIN_PASSWORD 密钥',503);
  const ip=req.headers.get('cf-connecting-ip')||'unknown';
  const ipHash=base64url(await digest('mswq-'+ip));
  let row=await env.DB.prepare('SELECT * FROM login_attempts WHERE ip=?').bind(ipHash).first();
  if(row?.locked_until>Date.now())return fail('尝试次数过多，请稍后重试',429);
  const body=await parse(req,10000);
  const matched=env.ADMIN_PASSWORD&&await sameSecret(String(body.password||''),env.ADMIN_PASSWORD);
  if(!matched){
   const failures=(row?.failures||0)+1, lock=failures>=8?Date.now()+15*60000:0;
   await env.DB.prepare('INSERT INTO login_attempts(ip,failures,locked_until) VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until').bind(ipHash,failures,lock).run();
   return fail('密码错误',401);
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip=?').bind(ipHash).run();
  return out({ok:true},200, {'set-cookie':cookie(await newSession(env))});
 }
 if(p.startsWith('/api/admin/')||p==='/admin/legacy-editor'||p==='/admin/docx-editor'){
  if(!MSWQ_TEST_OPEN_ADMIN && !await sessionValid(req,env))return fail('请先登录管理后台',401);
  if(!['GET','HEAD'].includes(method)&&!checkOrigin(req))return fail('请求来源不合法',403);
 }
 if(method==='GET'&&p==='/admin/legacy-editor')return adminEmbeddedHtml(ASSETS.legacy.replace('</body>','<script src="/assets/legacy-bridge.js" defer></script></body>'));
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
  if(!env.DOCX_DB||!env.DOCX_KV)return fail('DOCX 原模板存储未连接',503);
  const target=new URL(apiPath+url.search,url.origin);
  return DOCX_ADMIN_BACKEND.fetch(new Request(target,req),{DB:env.DOCX_DB,KHMB:env.DOCX_KV},{});
 }

 if(method==='GET'&&p==='/api/admin/me')return out({ok:true,admin:true,testMode:MSWQ_TEST_OPEN_ADMIN});
 if(method==='POST'&&p==='/api/admin/logout')return out({ok:true,testMode:MSWQ_TEST_OPEN_ADMIN},200,{'set-cookie':'mswq_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
 if(method==='GET'&&p==='/api/admin/items'){
  const rows=await env.DB.prepare('SELECT * FROM items ORDER BY sort_order ASC,updated_at DESC').all();
  return out({ok:true,items:(rows.results||[]).map(r=>record(r))});
 }
 if(method==='POST'&&p==='/api/admin/items'){
  const body=await parse(req);
  const item=normalizeItem(body);
  try{return out({ok:true,item:await saveItem(env,item)},201)}catch(e){if(String(e).includes('UNIQUE'))return fail('访问路径重复，请更换 slug',409);throw e;}
 }
 const match=p.match(/^\/api\/admin\/items\/([a-f0-9-]{32,40})$/);
 if(match){
  const id=match[1],old=await env.DB.prepare('SELECT * FROM items WHERE id=?').bind(id).first();
  if(!old)return fail('内容不存在',404);
  if(method==='GET')return out({ok:true,item:record(old)});
  if(method==='PUT'){
   const body=await parse(req);
   if(body.version!==old.version)return fail('版本已更新，请刷新后重试，避免覆盖其他修改',409);
   const item=normalizeItem(body,id);
   try{return out({ok:true,item:await saveItem(env,item,old)})}catch(e){if(String(e).includes('UNIQUE'))return fail('访问路径重复，请使用其他公开路径（slug）',409);throw e;}
  }
  if(method==='DELETE'){
   await env.DB.prepare('INSERT INTO revisions(id,item_id,version,data,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,old.version,JSON.stringify(record(old)),iso()).run();
   await env.DB.prepare('DELETE FROM items WHERE id=?').bind(id).run();
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
 if(method==='GET'&&p==='/api/admin/assets'){
  const rows=await env.DB.prepare('SELECT * FROM assets ORDER BY created_at DESC LIMIT 500').all();
  return out({ok:true,assets:(rows.results||[]).map(x=>({id:x.id,name:x.name,mime:x.mime,size:x.size,created_at:x.created_at,url:'/api/asset/'+x.id}))});
 }
 if(method==='POST'&&p==='/api/admin/assets'){
  const name=cleanString(decodeURIComponent(req.headers.get('x-file-name')||'file'),200);
  const mime=cleanString(req.headers.get('content-type')||'application/octet-stream',100);
  const allowed=['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain','application/zip'];
  if(!allowed.includes(mime))return fail('不支持的文件类型。请上传图片、PDF、DOCX、XLSX、PPTX、TXT 或 ZIP');
  const stated=Number(req.headers.get('content-length')||0);
  if(stated>12000000)return fail('单个文件不能超过 12MB',413);
  const bytes=await req.arrayBuffer();
  if(bytes.byteLength>12000000)return fail('单个文件不能超过 12MB',413);
  if(!bytes.byteLength)return fail('空文件不能上传');
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
  const ref=await env.DB.prepare('SELECT id FROM items WHERE content LIKE ? LIMIT 1').bind('%'+id+'%').first();
  if(ref)return fail('有内容仍在使用此文件，请先移除引用',409);
  await env.FILES.delete(row.key);
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
