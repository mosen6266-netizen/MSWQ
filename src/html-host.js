// Isolated public origin for user-uploaded HTML tools. No database, session,
// admin routes, or privileged service bindings are available to this Worker.
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function response(file,mime,method){
 return new Response(method==='HEAD'?null:file.body,{status:200,headers:{
  'content-type':mime,
  'cache-control':mime.startsWith('text/html')?'public, max-age=30':'public, max-age=120',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'cross-origin-opener-policy':'same-origin',
  'content-security-policy':"frame-ancestors 'none'"
 }});
}
export default {
 async fetch(request,env){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method Not Allowed',{status:405,headers:{allow:'GET, HEAD'}});
  const url=new URL(request.url),match=url.pathname.match(/^\/html\/([a-f0-9-]{36})(?:\/(.*))?$/i);
  if(!match||!UUID.test(match[1]))return new Response('Not Found',{status:404});
  const id=match[1];
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