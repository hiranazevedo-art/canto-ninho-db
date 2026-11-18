const CACHE='canto-ninho-v7-persistencia';
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
