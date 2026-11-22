// Isolated public origin for user-uploaded HTML tools. No database, session,
// admin routes, or privileged service bindings are available to this Worker.
// Same R2 policy file as the main MSWQ Worker. No D1 or admin access.
const IP_ACCESS_KEY='mswq-private/ip-allowlist-v1.json';
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
async function allowedIp(request,env){
 const ip=normalizedClientIP(request.headers.get('cf-connecting-ip'));
 if(!ip)return false;
 const file=await env.FILES.get(IP_ACCESS_KEY);
 if(!file)return false;
 try{
  const policy=JSON.parse(await file.text());
  return Array.isArray(policy.ips)&&policy.ips.includes(ip);
 }catch{return false}
}
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function response(file,mime,method){
 return new Response(method==='HEAD'?null:file.body,{status:200,headers:{
  'content-type':mime,
  'cache-control':'private, no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'cross-origin-opener-policy':'same-origin',
  'content-security-policy':"frame-ancestors 'none'"
 }});
}
export default {
 async fetch(request,env){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method Not Allowed',{status:405,headers:{allow:'GET, HEAD'}});
  if(!await allowedIp(request,env))return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>访问受限</title><body style="background:#141516;color:white;font:16px system-ui,sans-serif;text-align:center;padding:80px"><h1>403 · IP 未获授权</h1><p>请联系管理员将你的 IP 加入 MSWQ 白名单。</p></body></html>',{status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
  const url=new URL(request.url),match=url.pathname.match(/^\/html\/([a-f0-9-]{36})(?:\/(.*))?$/i);
  if(!match||!UUID.test(match[1]))return new Response('Not Found',{status:404});
  const id=match[1];
  if(!match[2]&&!url.pathname.endsWith('/')){url.pathname+='/';return Response.redirect(url.toString(),302)}
  const manifestFile=await env.FILES.get('html-packages/'+id+'/manifest.json');
  if(manifestFile){
   let manifest;
   try{manifest=JSON.parse(await manifestFile.text())}catch{return new Response('Package manifest unavailable',{status:503})}
   if(!manifest||!manifest.files||typeof manifest.files!=='object')return new Response('Package manifest invalid',{status:503});
   let path=match[2]||'';
   if(!path){
    path=manifest.entry;
    // Nested entry pages need their real URL so CSS, JS and images resolve
    // relative to the correct subdirectory without rewriting original HTML.
    if(path.includes('/')){
     url.pathname='/html/'+id+'/'+path.split('/').map(encodeURIComponent).join('/');
     return Response.redirect(url.toString(),302);
    }
   }else{
    try{path=decodeURIComponent(path)}catch{return new Response('Bad Request',{status:400})}
   }
   const info=Object.hasOwn(manifest.files,path)?manifest.files[path]:null;
   if(!info||!info.key||!info.mime)return new Response('Not Found',{status:404});
   const data=await env.FILES.get(info.key);
   if(!data)return new Response('Not Found',{status:404});
   return response(data,info.mime,request.method);
  }
  // Backwards compatibility: original standalone HTML stays at its UUID key.
  if(match[2]&&match[2]!=='index.html')return new Response('Not Found',{status:404});
  const file=await env.FILES.get(id);
  if(!file||!String(file.httpMetadata?.contentType||'').startsWith('text/html'))return new Response('Not Found',{status:404});
  return response(file,'text/html; charset=utf-8',request.method);
 }
};