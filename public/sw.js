const CACHE='canto-ninho-v8-mobile-push';
const ASSETS=['./','./index.html','./icon.svg','./manifest.webmanifest',
 './images/caboclinho.png','./sync-core.js','./vendor/qrcode-generator.js','./vendor/jspdf.umd.min.js','./vendor/jsQR.js'];
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
self.addEventListener('push',event=>{
 let data;
 try{data=event.data?.json();}catch{return;}
 if(!data||typeof data.body!=='string'||typeof data.hash!=='string')return;
 event.waitUntil(self.registration.showNotification('Canto & Ninho',{
  body:data.body,tag:data.tag,icon:'./icon.svg',data:{hash:data.hash}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const hash=event.notification.data?.hash;
 if(typeof hash!=='string'||!new URLSearchParams(hash).has('lembrete'))return;
 const target=new URL('./',self.registration.scope);
 target.hash=hash;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const app=windows.find(client=>{
   const url=new URL(client.url);
   return url.origin===target.origin&&[target.pathname,target.pathname+'index.html'].includes(url.pathname);
  });
  if(app){await app.focus();app.postMessage({reminder:hash});}
  else await self.clients.openWindow(target.href);
 })());
});
