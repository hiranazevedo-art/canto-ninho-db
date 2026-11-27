const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const encoder=new TextEncoder();
const toHex=arr=>Array.from(arr,b=>b.toString(16).padStart(2,'0')).join('');
function fromHex(h){return Uint8Array.from(h.match(/.{2}/g)||[],v=>parseInt(v,16))}
function base64url(bytes){let s='';for(const x of bytes)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function fromBase64url(s){const b=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));return Uint8Array.from(b,c=>c.charCodeAt(0))}
async function hmac(secret,message){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(message)))}
async function sign(secret,sub){const payload=base64url(encoder.encode(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+60*60*24*14})));return payload+'.'+base64url(await hmac(secret,payload))}
async function auth(req,env){const cookie=(req.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('canto_session='));const token=(req.headers.get('authorization')||'').match(/^Bearer (.+)$/)?.[1]|| (cookie?cookie.slice('canto_session='.length):'');if(!token||!env.SESSION_SECRET)return null;const [raw,sig,...rest]=token.split('.');if(!raw||!sig||rest.length)return null;const good=await hmac(env.SESSION_SECRET,raw);let supplied;try{supplied=fromBase64url(sig)}catch{return null}if(good.length!==supplied.length)return null;let x=0;for(let i=0;i<good.length;i++)x|=good[i]^supplied[i];if(x)return null;try{const d=JSON.parse(new TextDecoder().decode(fromBase64url(raw)));return d.exp>Date.now()/1000?d.sub:null}catch{return null}}
async function derive(password,saltHex,iterations){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);return toHex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:fromHex(saltHex),iterations,hash:'SHA-256'},key,256)))}
function sameOrigin(req){const origin=req.headers.get('origin');return !origin||origin===new URL(req.url).origin}
const sessionCookie=token=>'canto_session='+encodeURIComponent(token)+'; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600';
const clearCookie='canto_session=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
const validDB=v=>v&&typeof v==='object'&&v.version===4&&v.settings&&Array.isArray(v.birds)&&Array.isArray(v.audit);
// Legacy clients operate only on the legacy owner account.
function accountMatches(request,account){
 const expected=request.headers.get('x-canto-account');
 return expected===account||(expected===null&&account==='owner');
}
export {accountMatches,json,toHex,sign,auth,derive,validDB,sameOrigin,sessionCookie,clearCookie};
