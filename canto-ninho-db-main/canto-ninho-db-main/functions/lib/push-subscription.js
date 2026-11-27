export function pushEndpoint(value){
 if(typeof value!=='string'||value.length>2048)return '';
 try{
  const url=new URL(value);
  const apple=url.hostname==='web.push.apple.com'||url.hostname.endsWith('.push.apple.com');
  const windows=url.hostname.endsWith('.notify.windows.com');
  const allowed=apple||windows||['fcm.googleapis.com','updates.push.services.mozilla.com'].includes(url.hostname);
  if(url.protocol==='https:'&&allowed&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname.length>1)
   return url.href;
 }catch{}
 return '';
}
export async function pushDeviceId(endpoint){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(endpoint));
 return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function subscriptionKeys(body){
 const {p256dh,auth}=body?.keys||{};
 if(typeof p256dh!=='string'||!/^[\w-]{87}$/.test(p256dh)||typeof auth!=='string'||!/^[\w-]{22}$/.test(auth))return false;
 return true;
}
