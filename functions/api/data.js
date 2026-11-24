import {json,auth,validDB,sameOrigin,toHex} from './_security.js';
import '../../public/sync-core.js';

const {collections,validChanges,integrityIssues,apply}=globalThis.CantoSync;
const encoder=new TextEncoder();
const maxRequest=1_500_000;
const maxDelta=1_400_000;
const headSQL='SELECT revision,changed_at FROM sync_heads WHERE owner_id=?';
const revisionGuard='EXISTS(SELECT 1 FROM sync_heads WHERE owner_id=? AND revision=?)';
const unsafeKey=key=>['__proto__','prototype','constructor'].includes(key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const size=text=>encoder.encode(text).length;
const conflict=revision=>json({error:'Os dados da nuvem mudaram. Atualize a revisão antes de enviar.',revision},409);

function exportRecords(data){
 const rows=[];
 for(const collection of collections){
  if(data[collection]===undefined)continue;
  if(!Array.isArray(data[collection]))throw new TypeError('Coleção inválida');
  const ids=new Set();
  for(const value of data[collection]){
   if(!object(value)||typeof value.id!=='string'||!value.id.trim()||value.id.length>256||ids.has(value.id))
    throw new TypeError('Identificador de registro inválido ou duplicado');
   ids.add(value.id);
   rows.push({collection,id:value.id,value});
  }
 }
 if(!object(data.settings))throw new TypeError('Configurações inválidas');
 for(const [id,value] of Object.entries(data.settings)){
  if(unsafeKey(id)||!id||id.length>256)throw new TypeError('Chave inválida');
  rows.push({collection:'settings',id,value});
 }
 const extra=Object.fromEntries(Object.entries(data).filter(([key])=>!['version','settings',...collections].includes(key)));
 if(Object.keys(extra).some(unsafeKey))throw new TypeError('Chave inválida');
 if(Object.keys(extra).length)rows.push({collection:'metadata',id:'extra',value:extra});
 return rows;
}

function unpack(records){
 const data={version:4,settings:{},...Object.fromEntries(collections.map(name=>[name,[]]))};
 for(const row of records){
  const value=JSON.parse(row.value);
  if(row.collection==='settings')Object.defineProperty(data.settings,row.record_id,{value,enumerable:true,writable:true,configurable:true});
  else if(row.collection==='metadata')Object.assign(data,value);
  else data[row.collection].push(value);
 }
 return data;
}

function insertRows(db,owner,rows,revision,guardRevision,{updates=false}={}){
 // One SQL statement per batch. JSON functions expand records without hundreds of bindings.
 const valueSQL=updates
  ? "CASE WHEN json_type(j.value,'$.value')='null' THEN NULL ELSE j.value -> '$.value' END"
  : "j.value -> '$.value'";
 const onConflict=updates?`ON CONFLICT(owner_id,collection,record_id) DO UPDATE SET
  value=excluded.value,revision=excluded.revision,
  position=CASE WHEN sync_records.value IS NULL THEN excluded.position ELSE sync_records.position END`:'';
 return db.prepare(`INSERT INTO sync_records(owner_id,collection,record_id,value,revision,position)
  SELECT ?,json_extract(j.value,'$.collection'),json_extract(j.value,'$.id'),${valueSQL},?,?+CAST(j.key AS INTEGER)
  FROM json_each(?) j WHERE ${revisionGuard} ${onConflict}`)
  .bind(owner,revision,revision*1_000_000,JSON.stringify(rows),owner,guardRevision);
}

async function initialize(db,owner){
 const current=await db.prepare(headSQL).bind(owner).first();
 if(current)return;
 const old=await db.prepare('SELECT payload,revision FROM snapshots WHERE owner_id=?').bind(owner).first();
 const rows=old?exportRecords(JSON.parse(old.payload)):[];
 const expected=old?.revision||0;
 // A competing initializer cannot write any rows after the first transaction commits.
 const [created]=await db.batch([
  db.prepare(`INSERT INTO sync_heads(owner_id,revision)
    SELECT ?, -1 WHERE ?=COALESCE((SELECT revision FROM snapshots WHERE owner_id=?),0)
    ON CONFLICT(owner_id) DO NOTHING`).bind(owner,expected,owner),
  insertRows(db,owner,rows,expected,-1),
  db.prepare('UPDATE sync_heads SET revision=? WHERE owner_id=? AND revision=-1').bind(expected,owner)
 ]);
 if(!created.meta?.changes&&!await db.prepare(headSQL).bind(owner).first())
  throw new Error('A cópia legada mudou durante a migração');
}

async function fullData(db,owner){
 const [head,records]=await db.batch([
  db.prepare(headSQL).bind(owner),
  db.prepare('SELECT collection,record_id,value FROM sync_records WHERE owner_id=? AND value IS NOT NULL ORDER BY position,record_id').bind(owner)
 ]);
 const {revision,changed_at:changedAt}=head.results[0];
 return {revision,changedAt,data:revision?unpack(records.results):null,incremental:true};
}

async function readData(db,owner,since){
 if(since!==null){
  const [head,history]=await db.batch([
   db.prepare(headSQL).bind(owner),
   db.prepare(`SELECT revision,changes FROM sync_operations
    WHERE owner_id=? AND revision>? AND revision<=? ORDER BY revision`).bind(owner,since,since+16)
  ]);
  const {revision}=head.results[0];
  if(since<=revision&&revision-since===history.results.length&&
    history.results.every((row,index)=>row.changes!==null&&row.revision===since+index+1)&&
    history.results.reduce((total,row)=>total+row.changes.length,0)<=maxRequest){
   return json({revision,incremental:true,batches:history.results.map(row=>JSON.parse(row.changes))});
  }
 }
 return json(await fullData(db,owner));
}

function appendOperation(db,owner,revision,operationId,digest,changes){
 return db.prepare(`INSERT INTO sync_operations(owner_id,revision,operation_id,digest,changes)
  SELECT ?,?,?,?,? WHERE ${revisionGuard}`)
  .bind(owner,revision+1,operationId,digest,changes,owner,revision);
}

function advanceHead(db,owner,revision){
 return db.prepare("UPDATE sync_heads SET revision=revision+1,changed_at=datetime('now') WHERE owner_id=? AND revision=?")
  .bind(owner,revision);
}

async function writeDelta(db,owner,req){
 const {revision,operationId,changes}=req;
 if(revision<1||typeof operationId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)||!validChanges(changes))
  return json({error:'Alterações inválidas'},400);
 const keys=new Set(changes.map(change=>JSON.stringify([change.collection,change.id])));
 if(keys.size!==changes.length)return json({error:'Registros duplicados no lote'},400);
 const payload=JSON.stringify(changes);
 if(size(payload)>maxDelta)return json({error:'Lote acima de 1,4 MB'},413);
 const digest=toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify([revision,changes])))));
 const operation=()=>db.prepare('SELECT revision,digest FROM sync_operations WHERE owner_id=? AND operation_id=?').bind(owner,operationId).first();
 const responseForReplay=previous=>previous.digest===digest?json({revision:previous.revision}):json({error:'Identificador de operação já utilizado'},409);
 const previous=await operation();
 if(previous)return responseForReplay(previous);
 const head=await db.prepare(headSQL).bind(owner).first();
 if(head.revision!==revision){
  const replay=await operation();
  return replay?responseForReplay(replay):conflict(head.revision);
 }
 const protectedCollections=['birds','chicks','pedigreeBirds','eggs','feedingPreferences'];
 if(changes.some(change=>protectedCollections.includes(change.collection))){
  const oldRecords=await db.prepare(`SELECT collection,record_id,value FROM sync_records
   WHERE owner_id=? AND collection IN ('birds','chicks','pedigreeBirds','eggs','feedingPreferences') AND value IS NOT NULL`).bind(owner).all();
  const original=unpack(oldRecords.results);
  const issues=integrityIssues(original,apply(original,changes));
  if(issues.length)return json({error:issues[0].label},422);
 }
 const results=await db.batch([
  appendOperation(db,owner,revision,operationId,digest,payload),
  insertRows(db,owner,changes,revision+1,revision,{updates:true}),
  db.prepare(`DELETE FROM sync_records WHERE owner_id=? AND collection='audit'
   AND ${revisionGuard} AND record_id IN (
    SELECT record_id FROM sync_records WHERE owner_id=? AND collection='audit'
    ORDER BY json_extract(value,'$.at') DESC,position DESC LIMIT -1 OFFSET 1500
   )`).bind(owner,owner,revision,owner),
  // Keep operation receipts for retries while bounding retained change payloads.
  db.prepare(`UPDATE sync_operations SET changes=NULL
   WHERE owner_id=? AND revision=? AND changes IS NOT NULL AND ${revisionGuard}`)
   .bind(owner,revision-31,owner,revision),
  advanceHead(db,owner,revision)
 ]);
 if(results.at(-1).meta?.changes)return json({revision:revision+1});
 const replay=await operation();
 return replay?responseForReplay(replay):conflict((await db.prepare(headSQL).bind(owner).first()).revision);
}

async function replaceData(db,owner,req){
 const {revision,data}=req;
 const optional=new Set(['revenues','pedigreeBirds','tournaments','feedingPreferences']);
 if(!validDB(data)||!collections.every(name=>Array.isArray(data[name])||(optional.has(name)&&data[name]===undefined)))
  return json({error:'Dados incompatíveis'},400);
 let rows;
 try{rows=exportRecords(data)}catch(error){return json({error:error.message},422)}
 const head=await db.prepare(headSQL).bind(owner).first();
 if(head.revision!==revision)return conflict(head.revision);
 if(revision>0){
  const original=await fullData(db,owner);
  if(original.revision!==revision)return conflict(original.revision);
  const issues=integrityIssues(original.data,data);
  if(issues.length)return json({error:issues[0].label},422);
 }else{
  const issue=integrityIssues(null,data).find(issue=>['egg-outcome','feeding-period'].includes(issue.reason));
  if(issue)return json({error:issue.label},422);
 }
 const [, , , updated]=await db.batch([
  appendOperation(db,owner,revision,crypto.randomUUID(),'replacement',null),
  db.prepare(`DELETE FROM sync_records WHERE owner_id=? AND ${revisionGuard}`).bind(owner,owner,revision),
  insertRows(db,owner,rows,revision+1,revision),
  advanceHead(db,owner,revision)
 ]);
 return updated.meta?.changes?json({revision:revision+1,incremental:true}):conflict((await db.prepare(headSQL).bind(owner).first()).revision);
}

async function readBody(request){
 const reader=request.body?.getReader();
 if(!reader)return '';
 const decoder=new TextDecoder('utf-8',{fatal:true});
 let body='',bytes=0;
 while(true){
  const {value,done}=await reader.read();
  if(done)return body+decoder.decode();
  bytes+=value.byteLength;
  if(bytes>maxRequest){await reader.cancel();return null;}
  body+=decoder.decode(value,{stream:true});
 }
}

export async function onRequest({request,env}){
 if(!env.DB||!env.SESSION_SECRET)return json({error:'Configuração incompleta'},503);
 const owner=await auth(request,env);
 if(typeof owner!=='string'||!owner)return json({error:'Faça login para sincronizar'},401);
 const {method}=request;
 const db=env.DB;
 if(!['GET','PATCH','PUT'].includes(method))return json({error:'Método inválido'},405);
 if(method!=='GET'&&!sameOrigin(request))return json({error:'Origem inválida'},403);
 try{
  if(method==='GET'){
   const raw=new URL(request.url).searchParams.get('since');
   const since=raw===null?null:Number(raw);
   if(since!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(since)||since>Number.MAX_SAFE_INTEGER-16))
    return json({error:'Revisão inválida'},400);
   await initialize(db,owner);
   return await readData(db,owner,since);
  }
  let req;
  try{
   const body=await readBody(request);
   if(body===null)return json({error:'Requisição excede 1,5 MB'},413);
   req=JSON.parse(body);
  }catch{return json({error:'JSON inválido'},400)}
  if(!req||!Number.isSafeInteger(req.revision)||req.revision<0)return json({error:'Revisão inválida'},400);
  if(method==='PUT'&&req.mode!==(req.revision===0?'initialize':'restore'))
   return json({error:'Atualize o aplicativo. A gravação integral requer inicialização ou restauração explícita.'},409);
  await initialize(db,owner);
  return method==='PATCH'?await writeDelta(db,owner,req):await replaceData(db,owner,req);
 }catch(error){
  console.warn('Falha na persistência D1',error?.name);
  return json({error:'Armazenamento indisponível. Os dados locais podem ser exportados antes de tentar novamente.'},503);
 }
}
