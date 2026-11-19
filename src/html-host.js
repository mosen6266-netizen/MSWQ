// Public, isolated origin for complete user-uploaded HTML pages.
// This Worker has no MSWQ database, session, or private service bindings.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export default {
 async fetch(request,env){
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method Not Allowed',{status:405,headers:{allow:'GET, HEAD'}});
  const match=new URL(request.url).pathname.match(/^\/html\/([a-f0-9-]{36})(?:\/|\/index\.html)?$/i);
  if(!match||!UUID.test(match[1]))return new Response('Not Found',{status:404});
  const file=await env.FILES.get(match[1]);
  if(!file||!String(file.httpMetadata?.contentType||'').startsWith('text/html'))return new Response('Not Found',{status:404});
  const headers={
   'content-type':'text/html; charset=utf-8',
   'cache-control':'public, max-age=60',
   'x-content-type-options':'nosniff',
   'referrer-policy':'no-referrer',
   'cross-origin-opener-policy':'same-origin',
   'content-security-policy':"frame-ancestors 'none'"
  };
  return new Response(request.method==='HEAD'?null:file.body,{status:200,headers});
 }
};