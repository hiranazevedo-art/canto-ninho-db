import {json,auth,validDB,sameOrigin} from './_security.js';
export async function onRequest(context){const {request,env}=context;if(!env.DB||!env.SESSION_SECRET)return json({error:'Configuração incompleta'},503);const owner=await auth(request,env);if(!owner)return json({error:'Faça login para sincronizar'},401);
if(request.method==='GET'){
const row=await env.DB.prepare('SELECT revision,payload,changed_at FROM snapshots WHERE owner_id=?').bind(owner).first();return json(row?{revision:row.revision,data:JSON.parse(row.payload),changedAt:row.changed_at}:{revision:0,data:null});
}
if(request.method==='PUT'){if(!sameOrigin(request))return json({error:'Origem inválida'},403);
const text=await request.text();if(text.length>1500000)return json({error:'Arquivo excede 1,5 MB de dados. Faça backup e reduza anexos.'},413);
let req;try{req=JSON.parse(text)}catch{return json({error:'JSON inválido'},400)}
if(!Number.isInteger(req.revision)||req.revision<0||!validDB(req.data))return json({error:'Dados incompatíveis'},400);
const payload=JSON.stringify(req.data);
let result;
if(req.revision===0)result=await env.DB.prepare('INSERT OR IGNORE INTO snapshots(owner_id,revision,payload) VALUES(?,1,?)').bind(owner,payload).run();
else result=await env.DB.prepare("UPDATE snapshots SET revision=revision+1,payload=?,changed_at=datetime('now') WHERE owner_id=? AND revision=?").bind(payload,owner,req.revision).run();
if(!result.meta?.changes){const row=await env.DB.prepare('SELECT revision FROM snapshots WHERE owner_id=?').bind(owner).first();return json({error:'Conflito: existem alterações mais recentes em outro dispositivo.',revision:row?.revision||0},409)}
return json({revision:req.revision+1});
}
return json({error:'Método inválido'},405)
}
