import webPush from 'web-push';
import {json} from '../functions/api/_security.js';
import {pushEndpoint} from '../functions/lib/push-subscription.js';
import {localClock,remindersForDay} from './reminders.js';

const configuration=env=>env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT&&env.DB;
function payload(reminder){
 const params=new URLSearchParams({lembrete:reminder.kind,ref:reminder.id,dia:reminder.date});
 if(reminder.extra)params.set('prev',reminder.extra);
 return {title:'Canto & Ninho',body:reminder.label+' · consulte a Agenda.',tag:reminder.key,hash:params.toString()};
}
async function deliver(env,device,message){
 const endpoint=pushEndpoint(device.endpoint);
 if(!endpoint)throw Error('Endpoint inválido.');
 const subscription={endpoint,keys:{p256dh:device.p256dh,auth:device.auth_key}};
 const vapidDetails={subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY};
 const details=webPush.generateRequestDetails(subscription,JSON.stringify(message),{vapidDetails,TTL:14400});
 const response=await fetch(endpoint,{method:'POST',headers:details.headers,body:details.body,
  redirect:'error',signal:AbortSignal.timeout(10000)});
 await response.body?.cancel();
 if(response.status===404||response.status===410){
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE owner_id=? AND device_id=? AND endpoint=?')
   .bind(device.owner_id,device.device_id,endpoint).run();
 }
 return response.ok;
}
async function sendTest(env,request){
 const {owner,device}=await request.json();
 if(typeof owner!=='string'||typeof device!=='string'||!/^[a-f0-9]{64}$/.test(device))
  return json({error:'Inscrição inválida.'},400);
 const now=Date.now();
 const target=await env.DB.prepare(`UPDATE push_subscriptions SET last_test_at=?
  WHERE owner_id=? AND device_id=? AND last_test_at<=? RETURNING *`)
  .bind(now,owner,device,now-60000).first();
 if(!target)return json({error:'Ative as notificações ou aguarde um minuto antes de testar novamente.'},409);
 const sent=await deliver(env,target,{title:'Canto & Ninho',body:'Notificação de teste',tag:'teste',hash:'lembrete=teste'});
 return sent?json({sent:true}):json({error:'O serviço do aparelho recusou a notificação.'},502);
}
async function sendScheduled(env,date){
 const owners=await env.DB.prepare('SELECT DISTINCT owner_id FROM push_subscriptions').all();
 for(const {owner_id:owner} of owners.results){
  const [head,records,devices,sent]=await env.DB.batch([
   env.DB.prepare('SELECT revision FROM sync_heads WHERE owner_id=?').bind(owner),
   env.DB.prepare(`SELECT collection,record_id,value FROM sync_records
    WHERE owner_id=? AND value IS NOT NULL AND (collection IN ('nests','eggs','chicks','documents','tournaments')
    OR (collection='settings' AND record_id='timezone'))`).bind(owner),
   env.DB.prepare('SELECT * FROM push_subscriptions WHERE owner_id=?').bind(owner),
   env.DB.prepare('SELECT device_id,reminder_key FROM push_deliveries WHERE owner_id=? AND created_at>=?')
    .bind(owner,date.getTime()-86400000)
  ]);
  const revision=head.results[0]?.revision;
  if(!revision)continue;
  const data={nests:[],eggs:[],chicks:[],documents:[],tournaments:[]};
  let timezone;
  for(const row of records.results){
   const value=JSON.parse(row.value);
   if(row.collection==='settings')timezone=value;
   else data[row.collection].push(value);
  }
  const {day,hour}=localClock(date,timezone);
  if(hour<8)continue;
  const delivered=new Set(sent.results.map(row=>JSON.stringify([row.device_id,row.reminder_key])));
  const jobs=[];
  for(const reminder of remindersForDay(data,day)){
   for(const device of devices.results){
    if(delivered.has(JSON.stringify([device.device_id,reminder.key])))continue;
    jobs.push({device,reminder});
   }
  }
  // Bound the work per run. Later ticks pick up other reminders.
  for(const {device,reminder} of jobs.slice(0,12)){
   const claim=await env.DB.prepare(`INSERT OR IGNORE INTO push_deliveries(owner_id,device_id,reminder_key,created_at)
    SELECT s.owner_id,s.device_id,?,? FROM push_subscriptions s JOIN sync_heads h ON h.owner_id=s.owner_id
    WHERE s.owner_id=? AND s.device_id=? AND h.revision=?`)
    .bind(reminder.key,date.getTime(),owner,device.device_id,revision).run();
   if(!claim.meta.changes)continue;
   // Keep the claim even after an uncertain response to avoid duplicate notifications.
   try{if(!await deliver(env,device,payload(reminder)))console.warn('Lembrete recusado pelo serviço push.');}
   catch(error){console.warn('Falha em envio de lembrete',error?.name);}
  }
 }
 await env.DB.prepare('DELETE FROM push_deliveries WHERE created_at<?').bind(date.getTime()-30*86400000).run();
}
export default {
 async fetch(request,env){
  if(!configuration(env))return json({error:'Chaves de notificação ainda não configuradas.'},503);
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path==='/key')return json({publicKey:env.VAPID_PUBLIC_KEY});
  if(request.method!=='POST'||path!=='/test')return json({error:'Rota inválida.'},404);
  try{return await sendTest(env,request);}
  catch(error){
   console.warn('Falha no teste push',error?.name);
   return json({error:'Não foi possível enviar o teste. Confira as chaves e a conexão do aparelho.'},502);
  }
 },
 async scheduled(event,env,ctx){
  if(!configuration(env)){console.warn('Web Push não configurado.');return;}
  ctx.waitUntil(sendScheduled(env,new Date(event.scheduledTime)));
 }
};
