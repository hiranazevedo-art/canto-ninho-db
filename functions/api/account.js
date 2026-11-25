import {auth,json,toHex,sign,derive,sameOrigin,sessionCookie,clearCookie,accountMatches} from './_security.js';
import {pushEndpoint,pushDeviceId} from '../lib/push-subscription.js';

const passwordVersion='pbkdf2-sha256-100000:';
const currentIterations=100000;
const legacyIterations=180000;
const inviteLifetime=7*24*60*60;
const pilotLimit=3;
const validLogin=login=>/^[a-z0-9][a-z0-9_-]{2,31}$/.test(login)&&login!=='owner';
const normalizeLogin=value=>typeof value==='string'?value.trim().toLowerCase():'';
const tokenHash=async token=>toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))));

async function newCredentials(password){
 const salt=toHex(crypto.getRandomValues(new Uint8Array(16)));
 return [salt,passwordVersion+await derive(password,salt,currentIterations)];
}
async function startSession(env,account,status=200){
 const response=json({ok:true,account},status);
 response.headers.append('Set-Cookie',sessionCookie(await sign(env.SESSION_SECRET,account)));
 return response;
}

export async function onRequest(context){
 try{return await handleAccount(context)}
 catch(error){
  console.error('Falha na operação de conta',error?.name);
  return json({error:'Não foi possível concluir a operação da conta. Consulte os logs da implantação.'},500);
 }
}

async function handleAccount({request,env}){
 if(!env.DB||!env.SESSION_SECRET)return json({error:'Configuração do servidor incompleta'},503);
 const db=env.DB;
 const active=await auth(request,env);
 if(request.method==='GET')return json({account:active});
 if(request.method!=='POST')return json({error:'Método inválido'},405);
 if(!sameOrigin(request))return json({error:'Origem inválida'},403);
 let d;
 try{d=await request.json()}catch{return json({error:'JSON inválido'},400)}
 if(!d||typeof d!=='object')return json({error:'JSON inválido'},400);
 const action=d.action;
 if(action==='logout'){
  if(active&&!accountMatches(request,active))return json({error:'A conta ativa mudou. Reabra o aplicativo.'},409);
  const endpoint=pushEndpoint(d.endpoint);
  if(active&&endpoint)await db.prepare('DELETE FROM push_subscriptions WHERE owner_id=? AND device_id=?')
   .bind(active,await pushDeviceId(endpoint)).run();
  const response=json({ok:true});
  response.headers.append('Set-Cookie',clearCookie);
  return response;
 }
 if(action==='status'){
  const existing=await db.prepare('SELECT id FROM accounts WHERE id=?').bind('owner').first();
  return json({registered:!!existing});
 }
 if(action==='createInvite'){
  if(active!=='owner')return json({error:'Somente a conta proprietária pode criar convites.'},403);
  const login=normalizeLogin(d.login);
  if(!validLogin(login))return json({error:'Use de 3 a 32 caracteres: letras sem acento, números, hífen ou sublinhado.'},400);
  const token=toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt=Math.floor(Date.now()/1000)+inviteLifetime;
  const result=await db.prepare(`INSERT INTO pilot_invites(login,token_hash,expires_at)
   SELECT ?,?,? WHERE
    (SELECT count(*) FROM pilot_invites WHERE redeemed_at IS NOT NULL OR expires_at>unixepoch())<?
   ON CONFLICT(login) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at
   WHERE pilot_invites.redeemed_at IS NULL AND pilot_invites.expires_at<=unixepoch()`)
   .bind(login,await tokenHash(token),expiresAt,pilotLimit).run();
  if(!result.meta?.changes)return json({error:'Identificador já convidado ou limite de três vagas atingido.'},409);
  return json({login,token,expiresAt},201);
 }
 const login=normalizeLogin(d.login);
 if(action==='register'||action==='redeem'){
  if(active)return json({error:'Saia da conta ativa antes de cadastrar outro acesso.'},409);
  if(typeof d.password!=='string'||d.password.length<12||d.password.length>128)
   return json({error:'Senha deve conter de 12 a 128 caracteres'},400);
  if(action==='register'){
   if(!env.OWNER_SETUP_CODE||typeof d.setupCode!=='string'||d.setupCode!==env.OWNER_SETUP_CODE)
    return json({error:'Código de criação inválido'},403);
   const credentials=await newCredentials(d.password);
   const result=await db.prepare('INSERT OR IGNORE INTO accounts(id,password_salt,password_hash) VALUES(?,?,?)')
    .bind('owner',...credentials).run();
   if(!result.meta?.changes)return json({error:'Conta proprietária já criada'},409);
   return startSession(env,'owner',201);
  }
  if(typeof d.token!=='string'||!/^[a-f0-9]{64}$/.test(d.token))
   return json({error:'Convite inválido, expirado ou já utilizado.'},400);
  const digest=await tokenHash(d.token);
  const invite=await db.prepare('SELECT login FROM pilot_invites WHERE token_hash=? AND redeemed_at IS NULL AND expires_at>unixepoch()')
   .bind(digest).first();
  if(!invite)return json({error:'Convite inválido, expirado ou já utilizado.'},400);
  const credentials=await newCredentials(d.password);
  // The insert and redemption trigger run in the same SQLite statement.
  const created=await db.prepare(`INSERT INTO accounts(id,password_salt,password_hash)
   SELECT 'pilot:'||login,?,? FROM pilot_invites WHERE token_hash=? AND redeemed_at IS NULL AND expires_at>unixepoch()
   ON CONFLICT(id) DO NOTHING RETURNING id`).bind(...credentials,digest).first();
  if(!created)return json({error:'Convite inválido, expirado ou já utilizado.'},409);
  return startSession(env,created.id,201);
 }
 if(action==='login'){
  const account=login?'pilot:'+login:'owner';
  const invalid=()=>json({error:'Credenciais inválidas'},401);
  if((login&&!validLogin(login))||typeof d.password!=='string'||d.password.length>128)return invalid();
  if(active&&active!==account)return json({error:'Saia da conta ativa antes de entrar em outra.'},409);
  const user=await db.prepare('SELECT password_salt,password_hash FROM accounts WHERE id=?').bind(account).first();
  if(!user)return invalid();
  const storedHash=user.password_hash;
  const versioned=storedHash.startsWith(passwordVersion);
  const expected=versioned?storedHash.slice(passwordVersion.length):storedHash;
  if(!/^[a-f0-9]{64}$/.test(expected))return invalid();
  const hash=await derive(d.password,user.password_salt,versioned?currentIterations:legacyIterations);
  let diff=0;
  for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^hash.charCodeAt(i);
  return diff?invalid():startSession(env,account);
 }
 return json({error:'Ação desconhecida'},400);
}
