const unavailable=new Set(['INFÉRTIL','NÃO ECLODIDO','ECLODIDO']);
const rowKey=id=>String(id||'').toLowerCase();
function validDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function daysFrom(date,days){
 if(!validDate(date)||!Number.isInteger(days)||Math.abs(days)>365)return '';
 const value=new Date(date+'T00:00:00Z');
 value.setUTCDate(value.getUTCDate()+days);
 return value.toISOString().slice(0,10);
}
export function localClock(date,timezone){
 let formatter;
 const options={year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'};
 try{formatter=new Intl.DateTimeFormat('en-CA',{...options,timeZone:timezone||'America/Fortaleza'});}
 catch{formatter=new Intl.DateTimeFormat('en-CA',{...options,timeZone:'America/Fortaleza'});}
 const parts=Object.fromEntries(formatter.formatToParts(date).map(part=>[part.type,part.value]));
 return {day:parts.year+'-'+parts.month+'-'+parts.day,hour:Number(parts.hour)};
}
export function remindersForDay(data,day){
 const items=[];
 const add=(date,kind,id,label,extra='')=>{
  if(date===day&&typeof id==='string'&&id)items.push({key:JSON.stringify([kind,id,date,extra]),kind,id,date,label,extra});
 };
 const nests=new Map(data.nests.map(nest=>[rowKey(nest.id),nest]));
 const eggs=new Map(data.eggs.map(egg=>[rowKey(egg.id),egg]));
 for(const nest of data.nests){
  if(nest.closedAt)continue;
  const timing=nest.timing||{};
  const waiting=data.eggs.filter(egg=>rowKey(egg.nest)===rowKey(nest.id)&&!egg.hatchedAt&&!unavailable.has(egg.status));
  if(waiting.some(egg=>['REGISTRADO','DESCONHECIDO',''].includes(egg.status||'')))
   add(daysFrom(nest.incubationStart,timing.check),'ovoscopy',nest.id,'Ovoscopia');
  const expected=daysFrom(nest.incubationStart,timing.hatch);
  if(waiting.length&&expected)add(daysFrom(expected,-1),'hatching',nest.id,'Véspera da eclosão',expected);
 }
 for(const chick of data.chicks){
  if(chick.ring)continue;
  const nestId=chick.egg?eggs.get(rowKey(chick.egg))?.nest:chick.nest;
  const {ringStart,ringEnd}=nests.get(rowKey(nestId))?.timing||{};
  if(Number.isInteger(ringEnd))add(daysFrom(chick.date,ringStart),'ringing',chick.id,'Anilhamento');
 }
 for(const doc of data.documents){
  const advance=Number(doc.noticeDays||0);
  add(daysFrom(doc.expiresAt,-advance),'document',doc.id,'Vencimento de documento');
 }
 for(const tournament of data.tournaments){
  if(tournament.status==='AGENDADO')add(tournament.date,'tournament',tournament.id,'Torneio agendado');
 }
 for(const record of data.health||[]){
  if(record.completedDate||!validDate(record.date)||!validDate(record.endDate)||record.endDate<record.date)continue;
  const reminderDate=record.date===record.endDate?record.endDate:daysFrom(record.endDate,-1);
  add(reminderDate,'health',record.id,'Término previsto de saúde',record.endDate);
 }
 const pending=(data.tasks||[]).filter(task=>task?.date===day&&
  !['CONCLUÍDA','CANCELADA'].includes(task.status)&&
  (task.status||!task.done&&!task.completedAt)).length;
 if(pending){
  const count=pending===1?'1 atividade':pending+' atividades';
  add(day,'management','daily','Você tem '+count+' de manejo para hoje');
 }
 return items;
}
