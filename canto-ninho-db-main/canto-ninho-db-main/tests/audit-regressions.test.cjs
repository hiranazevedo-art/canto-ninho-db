const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { createContext, runInContext } = require('node:vm');
const { webcrypto } = require('node:crypto');

const read = path => readFileSync(join(__dirname, '..', path), 'utf8');

async function loadApp() {
 const storage = new Map(), elements = new Map();
 const context = createContext({
  console, AbortSignal, URL, URLSearchParams, navigator:{ onLine:false }, setInterval(){},
  fetch:async()=>({ok:true,json:async()=>({account:'owner'})}),
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
  document:{
   body:{appendChild(){}},
   getElementById(key){if(!elements.has(key))elements.set(key,{});return elements.get(key)},
   addEventListener(){},createElement:()=>({addEventListener(){}})
  },
  window:{crypto:webcrypto,addEventListener(){},history:{replaceState(){}},location:{href:'http://localhost/'},
   matchMedia:()=>({matches:false,addEventListener(){}})}
 });
 runInContext(read('public/sync-core.js'),context);
 const html=read('public/index.html');
 const script=html.match(/<script>\s*'use strict';[\s\S]*?<\/script>/)[0].slice(8,-9);
 new (require('node:vm').Script)(script);
 const beforeStartup=script.slice(0,script.lastIndexOf("if('serviceWorker'in navigator"));
 await runInContext(beforeStartup+`
  globalThis.app={defaults:defaultDB,validateFacilityChange,validateBackupObject,
   generic,facilityCatalog,stockPage,syncCageUnits,saveSale,changeSaleReturn,financeTotals,paymentOpen,
   prepare(data){db=data;cloudState.meta={revision:1,dirty:true};},
   snapshot:()=>JSON.parse(JSON.stringify(db))};
 })();`,context);
 return {app:context.app,sync:context.CantoSync};
}

test('a gaiola individual bloqueia sobreposição no cadastro, na mesclagem e no servidor',async()=>{
 const {app,sync}=await loadApp();
 const data=app.defaults();
 data.stock=[{id:'stock',name:'GAIOLA INDIVIDUAL'}];
 data.facilities=[
  {id:'manual',name:'Unidade A',type:'GAIOLA',cageType:'INDIVIDUAL'},
  {id:'linked',name:'Unidade B',type:'GAIOLA',cageStockId:'stock'},
  {id:'legacy',name:'Gaiola individual 10',type:'GAIOLA'},
  {id:'transport',name:'Transporte 1',type:'GAIOLA'}
 ];
 data.transfers=data.facilities.map(({id})=>({id:'old-'+id,facility:id,bird:'a',start:'2026-11-02',end:'2026-11-04'}));
 app.prepare(data);
 for(const facility of ['manual','linked','legacy']){
  const candidate={id:'new',facility,bird:'b',start:'2026-11-03',end:'2026-11-05'};
  assert.match(app.validateFacilityChange('transfers',candidate),/ocupação/);
  assert.equal(app.validateFacilityChange('transfers',{...candidate,start:'2026-11-04'}),'');
  const invalid={...data,transfers:[...data.transfers,candidate]};
  assert.ok(sync.integrityIssues(data,invalid).some(issue=>issue.reason==='cage-overlap'));
  assert.equal(sync.integrityIssues(invalid,invalid).length,0);
 }
 const [entry,...others]=data.transfers;
 const base={...data,transfers:others};
 const local={...base,transfers:[...others,entry]};
 const remote={...base,transfers:[...others,{...entry,id:'new',bird:'other'}]};
 assert.ok(sync.merge(base,local,remote).conflicts.length);
 assert.equal(app.validateFacilityChange('transfers',{facility:'transport',start:'2026-11-03',end:''}),'');
 assert.ok(sync.cageKind(data.facilities[1],data.stock[0].name)==='INDIVIDUAL');
});

test('a Agenda e os históricos exibem datas em ordem e o backup inválido é recusado',async()=>{
 const {app}=await loadApp();
 const data=app.defaults();
 data.events=[
  {id:'event-late',title:'TARDE',date:'2026-12-24',time:'14:00'},
  {id:'event-tomorrow',title:'AMANHÃ',date:'2026-12-25',time:'08:00'},
  {id:'event-early',title:'CEDO',date:'2026-12-24',time:'06:00'}
 ];
 data.health=[
  {id:'old',date:'2026-11-20',bird:[],type:'ANTIGO'},
  {id:'new',date:'2026-12-20',bird:[],type:'RECENTE'}
 ];
 data.tasks=[{id:'t',name:'ÁGUA',date:'2026-12-25'}];
 app.prepare(data);
 const ids=html=>[...html.matchAll(/data-edit="[^"]+" data-id="([^"]+)"/g)].map(match=>match[1]);
 assert.deepEqual(ids(app.generic('events')),['event-early','event-late','event-tomorrow']);
 assert.deepEqual(ids(app.generic('health')),['new','old']);
 const original=JSON.stringify(app.snapshot());
 assert.throws(()=>app.validateBackupObject({...data,tasks:[{id:'t',name:'ÁGUA',date:20261225}]}),/ÁGUA.*data válida/);
 assert.throws(()=>app.validateBackupObject({...data,events:[{id:'x',date:'2026-02-30'}]}),/data válida/);
 assert.equal(app.validateBackupObject(data).tasks[0].date,'2026-12-25');
 assert.equal(JSON.stringify(app.snapshot()),original);
});

test('a escolha por ficha preserva alterações independentes e recusa mudanças estruturais',async()=>{
 const {sync,app}=await loadApp();
 const base={...app.defaults(),birds:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}]};
 const local={...base,birds:[{id:'a',name:'Local'},{id:'b',name:'Também local'},base.birds[2]]};
 const remote={...base,birds:[{id:'a',name:'Remoto'},base.birds[1],{id:'c',name:'Também remoto'}]};
 const [row]=sync.reviewConflicts(base,local,remote);
 assert.equal(row.here.name,'Local');
 assert.equal(row.there.name,'Remoto');
 for(const choice of ['local','remote']){
  const result=sync.resolveConflicts(base,local,remote,[choice]);
  assert.deepEqual(Array.from(result.birds,b=>b.name),[choice==='local'?'Local':'Remoto','Também local','Também remoto']);
 }
 const structural={...local,birds:[{...local.birds[0],father:'b'},...local.birds.slice(1)]};
 assert.equal(sync.resolveConflicts(base,structural,remote,['local']),null);
});

test('compra registrada, ocupação, venda e devolução preservam estoque e financeiro',async()=>{
 const {app}=await loadApp();
 const data=app.defaults(), date='2026-11-05';
 const item={id:'stock',name:'GAIOLA INDIVIDUAL',category:'GAIOLAS',quantity:2,unit:'UN'};
 data.stock=[item];
 data.movements=[{id:'purchase',stock:item.id,type:'ENTRADA',quantity:2,date,cost:80}];
 app.prepare(data);
 assert.equal(app.syncCageUnits(item),'');
 const [occupied,available]=app.snapshot().facilities;
 data.transfers.push({id:'occupation',facility:occupied.id,bird:'existing',start:date,end:''});
 assert.equal(app.saveSale({kind:'cage',itemId:item.id,date,deliveryDate:date,unitPrice:100,
  quantity:1,paymentStatus:app.paymentOpen},'',false,[available.id]),'');
 let saved=app.snapshot();
 const [sale]=saved.revenues;
 assert.equal(saved.stock[0].quantity,1);
 assert.equal(saved.facilities.find(unit=>unit.id===available.id).cageSaleId,sale.id);
 assert.equal(app.changeSaleReturn(sale.id,'2026-11-06',true),'');
 saved=app.snapshot();
 assert.equal(saved.stock[0].quantity,2);
 assert.deepEqual(Array.from(saved.movements,m=>m.type),['ENTRADA','SAÍDA','ENTRADA']);
 assert.equal(saved.facilities.find(unit=>unit.id===available.id).cageSaleId,undefined);
 assert.equal(saved.transfers[0].facility,occupied.id);
 assert.equal(app.financeTotals('2026-11').paid,8000);
});

test('o agendador tenta novamente após 503 e preserva a marca depois do sucesso',async()=>{
 const {remindersForDay,localClock}=await import('../push-worker/reminders.js');
 const clock=Date.parse('2026-11-26T13:00:00Z'), device={owner_id:'owner',device_id:'phone',endpoint:'https://example.invalid/'};
 const claims=new Map(), statuses=[503,201];
 const context=createContext({
  webPush:{generateRequestDetails:()=>({})},pushEndpoint:value=>value,localClock,remindersForDay,
  AbortSignal,console:{warn(){}},fetch:async()=>({status:statuses.shift(),body:null})
 });
 const worker=read('push-worker/worker.js').replace(/^import .*;$/gm,'').replace('export default {','globalThis.worker = {');
 runInContext(worker,context);
 const DB={
  prepare(sql){
   const bound=(...args)=>({
    all:async()=>({results:[{owner_id:'owner'}]}),
    run:async()=>{
     if(sql.includes('INSERT OR IGNORE')){
      if(claims.has(args[0]))return {meta:{changes:0}};
      claims.set(args[0],args[1]);return {meta:{changes:1}};
     }
     if(sql.includes('reminder_key=?')&&claims.get(args[2])===args[3])claims.delete(args[2]);
     return {meta:{changes:1}};
    }
   });
   return {...bound(),bind:bound};
  },
  async batch(){
   return [{results:[{revision:1}]},{results:[{collection:'health',
    value:JSON.stringify({id:'health',date:'2026-11-20',endDate:'2026-11-27'})}]},
    {results:[device]},{results:[...claims.keys()].map(reminder_key=>({device_id:'phone',reminder_key}))}];
  }
 };
 const env={DB,VAPID_PUBLIC_KEY:'x',VAPID_PRIVATE_KEY:'x',VAPID_SUBJECT:'x'};
 const tick=async time=>{
  let work;
  await context.worker.scheduled({scheduledTime:time},env,{waitUntil:promise=>{work=promise}});
  await work;
 };
 await tick(clock);
 assert.equal(claims.size,0);
 await tick(clock+60000);
 assert.equal(claims.size,1);
 await tick(clock+120000);
 assert.equal(statuses.length,0);
 assert.equal(claims.size,1);
});

test('a exclusão é bloqueada se outro aparelho criar um vínculo com o casal', async () => {
 const { app, sync } = await loadApp();
 const base = app.defaults();
 base.couples = [{ id: 'casal' }];
 const local = { ...base, couples: [] };
 const remote = { ...base, chicks: [{ id: 'filhote-legado', name: 'Filhote legado', couple: 'CASAL' }] };
 const conflict = sync.merge(base, local, remote).conflicts[0];
 assert.equal(conflict.id, 'casal');
 assert.match(conflict.label, /filhotes.*Filhote legado/);
 // Uma gravação desatualizada também não pode criar um vínculo após a exclusão.
 assert.equal(sync.integrityIssues(local, { ...local, chicks: remote.chicks })[0].reason, 'couple-link');
 assert.equal(sync.integrityIssues({ ...local, chicks: remote.chicks }, {
  ...local, chicks: [{ ...remote.chicks[0], notes: 'Anotação em ficha legada' }]
 }).length, 0);
});

test('a reprodução protege toda a cadeia de vínculos e recusa backup incompleto', async () => {
 const {app,sync}=await loadApp();
 const base=app.defaults();
 Object.assign(base,{
  couples:[{id:'casal'}],seasons:[{id:'temporada',couple:'CASAL'}],
  attempts:[{id:'tentativa',season:'temporada'}],nests:[{id:'ninhada',attempt:'tentativa'}],
  eggs:[{id:'ovo',nest:'ninhada'}],chicks:[{id:'filhote',egg:'ovo'}],
  events:[{id:'lembrete',sourceChick:'filhote'}]
 });
 assert.equal(sync.reproductionIssues(null,base).length,0);
 assert.equal(app.validateBackupObject(base).chicks[0].id,'filhote');
 const broken={...base,seasons:[]};
 assert.match(sync.integrityIssues(base,broken)[0].label,/tentativa.*temporada ausente/);
 assert.throws(()=>app.validateBackupObject(broken),/temporada ausente/);
 assert.equal(sync.integrityIssues(broken,{...broken,attempts:[{...broken.attempts[0],notes:'legado'}]}).length,0);
 const emptySeason={...base,attempts:[],nests:[],eggs:[],chicks:[],events:[]};
 const local={...emptySeason,seasons:[]};
 const remote={...emptySeason,attempts:[{id:'tentativa',season:'TEMPORADA'}]};
 assert.ok(sync.merge(emptySeason,local,remote).conflicts.some(row=>row.collection==='seasons'));
 assert.ok(sync.merge(emptySeason,remote,local).conflicts.some(row=>row.collection==='attempts'));
});
