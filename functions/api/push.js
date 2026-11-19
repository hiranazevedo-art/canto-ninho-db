import {auth,json,sameOrigin} from './_security.js';
import {pushEndpoint,pushDeviceId,subscriptionKeys} from '../lib/push-subscription.js';

export async function onRequest({request,env}){
 const {DB,PUSH}=env;
 if(!DB||!PUSH)return json({error:'Notificações ainda não configuradas no servidor.'},503);
 const owner=await auth(request,env);
 if(typeof owner!=='string'||!owner)return json({error:'Entre na conta para gerenciar notificações.'},401);
 try{
  if(request.method==='GET'){
   return await PUSH.fetch('https://push.internal/key');
  }
  if(request.method!=='POST')return json({error:'Método inválido.'},405);
  if(!sameOrigin(request))return json({error:'Origem inválida.'},403);
  const text=await request.text();
  if(text.length>4096)return json({error:'Inscrição muito grande.'},413);
  let body;
  try{body=JSON.parse(text)}catch{return json({error:'Inscrição inválida.'},400)}
  const endpoint=pushEndpoint(body?.endpoint);
  if(!endpoint)return json({error:'O navegador usa um serviço de notificações incompatível.'},400);
  const device=await pushDeviceId(endpoint);
  if(body.action==='disable'){
   await DB.prepare('DELETE FROM push_subscriptions WHERE owner_id=? AND device_id=?').bind(owner,device).run();
   return json({enabled:false});
  }
  if(body.action==='status'){
   const row=await DB.prepare('SELECT device_id FROM push_subscriptions WHERE owner_id=? AND device_id=?').bind(owner,device).first();
   return json({enabled:Boolean(row)});
  }
  if(body.action==='test'){
   return await PUSH.fetch('https://push.internal/test',{
    method:'POST',body:JSON.stringify({owner,device})
   });
  }
  if(body.action!=='enable'||!subscriptionKeys(body))return json({error:'Inscrição inválida.'},400);
  const result=await DB.prepare(`INSERT INTO push_subscriptions(owner_id,device_id,endpoint,p256dh,auth_key)
   SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM push_subscriptions WHERE owner_id=? AND device_id=?)
    OR (SELECT count(*) FROM push_subscriptions WHERE owner_id=?)<20
   ON CONFLICT(owner_id,device_id) DO UPDATE SET p256dh=excluded.p256dh,auth_key=excluded.auth_key`)
   .bind(owner,device,endpoint,body.keys.p256dh,body.keys.auth,owner,device,owner).run();
  return result.meta?.changes?json({enabled:true}):json({error:'Limite de 20 aparelhos atingido.'},409);
 }catch(error){
  console.warn('Falha na configuração Web Push',error?.name);
  return json({error:'Notificações indisponíveis. Confira a implantação e a migração do D1.'},503);
 }
}
