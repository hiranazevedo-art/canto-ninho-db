const CACHE='canto-ninho-v41-mensagens';
const ASSETS=['./','./index.html','./icon-ninho-192.png','./icon-ninho-512.png','./manifest.webmanifest',
 './images/caboclinho.png','./images/azulao.png','./sync-core.js?v=17','./vendor/qrcode-generator.js','./vendor/jspdf.umd.min.js','./vendor/jsQR.js'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('canto-ninho-')&&key!==CACHE)
  .map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request, url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 event.respondWith(fetch(request).then(async response=>{
  if(response.ok)(await caches.open(CACHE)).put(request,response.clone()).catch(console.warn);
  return response;
 }).catch(async()=>{
  const cached=await caches.match(request);
  if(cached)return cached;
  if(request.mode==='navigate')return (await caches.match(new URL('./',self.registration.scope)))||Response.error();
  return Response.error();
 }));
});
function withAccountLock(operation){
 return self.navigator.locks?self.navigator.locks.request('canto-push-context',operation):operation();
}
async function validPushContext(data){
 if(!data||typeof data.account!=='string'||!['lembrete=agenda','lembrete=teste'].includes(data.hash))return false;
 try{
  const subscription=await self.registration.pushManager.getSubscription();
  if(!subscription)return false;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(subscription.endpoint));
  const device=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(device!==data.device)return false;
  const response=await fetch(new URL('/api/push',self.location.origin),{
   method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000),
   headers:{'content-type':'application/json','x-canto-account':data.account},
   body:JSON.stringify({action:'status',endpoint:subscription.endpoint})
  });
  return response.ok&&(await response.json()).enabled===true;
 }catch{return false}
}
self.addEventListener('push',event=>{
 let data;
 try{data=event.data?.json();}catch{return;}
 event.waitUntil(withAccountLock(async()=>{
  if(!await validPushContext(data))return;
  const test=data.hash==='lembrete=teste';
  await self.registration.showNotification('Canto & Ninho',{
   body:test?'Notificação de teste':'Você tem um lembrete. Consulte a Agenda.',
   tag:test?'teste':'agenda',icon:'./icon-ninho-192.png',
   data:{hash:data.hash,account:data.account,device:data.device}
  });
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const data=event.notification.data;
 event.waitUntil(withAccountLock(async()=>{
  if(!await validPushContext(data))return;
  const target=new URL('./',self.registration.scope);
  if(data.hash==='lembrete=agenda')target.hash=data.hash;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const app=windows.find(client=>{
   const url=new URL(client.url);
   return url.origin===target.origin&&[target.pathname,target.pathname+'index.html'].includes(url.pathname);
  });
  if(app){
   await app.focus();
   if(target.hash)app.postMessage({reminder:data.hash,account:data.account});
  }else await self.clients.openWindow(target.href);
 }));
});
