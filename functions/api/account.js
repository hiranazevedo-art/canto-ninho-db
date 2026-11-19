import {json,toHex,sign,derive,sameOrigin,sessionCookie,clearCookie} from './_security.js';
const passwordVersion='pbkdf2-sha256-100000:';
const currentIterations=100000;
const legacyIterations=180000;

export async function onRequest(context){
 try{return await handleAccount(context)}
 catch(error){
  console.error('Falha na operação de conta',error?.name);
  return json({error:'Não foi possível concluir a operação da conta. Consulte os logs da implantação.'},500);
 }
}

async function handleAccount(context){const {request,env}=context;if(request.method!=='POST')return json({error:'Método inválido'},405);if(!sameOrigin(request))return json({error:'Origem inválida'},403);if(!env.DB||!env.SESSION_SECRET)return json({error:'Configuração do servidor incompleta'},503);let d;try{d=await request.json()}catch{return json({error:'JSON inválido'},400)}
const action=d.action;if(action==='logout'){const response=json({ok:true});response.headers.append('Set-Cookie',clearCookie);return response}
if(action==='status'){const existing=await env.DB.prepare('SELECT id FROM accounts WHERE id=?').bind('owner').first();return json({registered:!!existing})}
if(action==='register'){
if(!env.OWNER_SETUP_CODE||typeof d.setupCode!=='string'||d.setupCode!==env.OWNER_SETUP_CODE)return json({error:'Código de criação inválido'},403);
if(typeof d.password!=='string'||d.password.length<12||d.password.length>128)return json({error:'Senha deve conter de 12 a 128 caracteres'},400);
const salt=toHex(crypto.getRandomValues(new Uint8Array(16)));const hash=passwordVersion+await derive(d.password,salt,currentIterations);
const result=await env.DB.prepare('INSERT OR IGNORE INTO accounts(id,password_salt,password_hash) VALUES(?,?,?)').bind('owner',salt,hash).run();
if(!result.meta?.changes)return json({error:'Conta proprietária já criada'},409);
const token=await sign(env.SESSION_SECRET,'owner');const response=json({ok:true},201);response.headers.append('Set-Cookie',sessionCookie(token));return response;
}
if(action==='login'){
const user=await env.DB.prepare('SELECT password_salt,password_hash FROM accounts WHERE id=?').bind('owner').first();if(!user)return json({error:'Conta ainda não configurada'},404);
if(typeof d.password!=='string'||d.password.length>128)return json({error:'Credenciais inválidas'},401);
const storedHash=user.password_hash;
const versioned=storedHash.startsWith(passwordVersion);
const expected=versioned?storedHash.slice(passwordVersion.length):storedHash;
if(!/^[a-f0-9]{64}$/.test(expected))return json({error:'Credenciais inválidas'},401);
const hash=await derive(d.password,user.password_salt,versioned?currentIterations:legacyIterations);
let diff=0;
for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^hash.charCodeAt(i);
if(diff)return json({error:'Credenciais inválidas'},401);
const token=await sign(env.SESSION_SECRET,'owner');const response=json({ok:true});response.headers.append('Set-Cookie',sessionCookie(token));return response;
}
return json({error:'Ação desconhecida'},400)
}
