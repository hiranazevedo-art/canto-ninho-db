const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const {execFileSync}=require('node:child_process');
const modules='home birds tree reproduction tasks feedings health events stock expenses revenues reports facilities trips tournaments documents knowledge settings'.split(' ');
const url=process.env.CANTO_URL||'http://127.0.0.1:8770';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 let failures=0;
 console.log('Chromium '+browser.version());
 for(const [device,width,height,mobile] of [['Desktop',1440,900,false],['Celular',390,844,true],['Celular estreito',320,740,true]]){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width,height},isMobile:mobile,hasTouch:mobile});
  await context.route('**/api/**',r=>r.fulfill(r.request().url().endsWith('/account')?{json:{account:'owner'}}:{status:503,json:{}}));
  await context.route('**/*',r=>r.request().url().startsWith(url)?r.fallback():r.abort());
  await context.addInitScript(()=>{
   const key='caboclinho_manager_v04';
   if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({version:4,settings:{name:'CRIADOURO FICTÍCIO',setupComplete:true},birds:[
    {id:'father',name:'PAI TESTE',sex:'MACHO',ring:'0001',scientific:'Cyanoloxia brissonii'},
    {id:'mother',name:'MÃE TESTE',sex:'FÊMEA',ring:'0002',scientific:'Cyanoloxia brissonii'},
    {id:'child',name:'AVE TESTE',sex:'MACHO',ring:'0003',father:'father',mother:'mother',scientific:'Cyanoloxia brissonii'}
   ],stock:[{id:'seed',name:'PEPINO',category:'VERDURAS',quantity:5,unit:'KG'}]}));
  });
  const p=await context.newPage();
  console.log(device+' | '+width+'×'+height+' CSS px');
  p.setDefaultTimeout(3500);
  const errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  p.on('dialog',d=>d.accept());
  const click=async l=>mobile?l.tap():l.click();
  const go=async module=>{
   if(mobile)await click(p.locator('#mobileMore'));
   await click(p.locator('#navigation [data-page="'+module+'"]'));
  };
  const check=async(name,fn)=>{try{await fn();console.log(device+' | OK | '+name)}catch(e){failures++;console.log(device+' | FALHA | '+name+' | '+e.message.split('\n').slice(0,8).join(' ')); await p.keyboard.press('Escape').catch(()=>{})}};
  const balance=async expected=>{
   await click(p.locator('[data-sub=stock]').first());
   const quantity=await p.locator('#content .data-table tbody tr').filter({hasText:'PEPINO'}).first().locator('td').nth(2).innerText();
   assert.equal(Number(quantity.replace(',','.')),expected);
  };
  const feedback=()=>p.locator('#recordForm .form-feedback').innerText();
  await p.goto(url);
  const tiny=new Set(),over=[],unnamed=new Set();
  for(const module of modules){
   await check(module,async()=>{
    await go(module);
    assert.ok(await p.locator('#content h2').first().isVisible());
    const results=await p.evaluate(mobile=>({
     over:document.documentElement.scrollWidth>innerWidth,
     tiny:mobile?[...document.querySelectorAll('#content button,#mobileNav button')].filter(b=>b.getClientRects().length&&!b.disabled&&(b.offsetHeight<44||b.offsetWidth<44)).map(b=>b.innerText.trim()||b.getAttribute('aria-label')||b.outerHTML.slice(0,100)):[],
     unnamed:[...document.querySelectorAll('#content input:not([type=hidden]),#content select')].filter(e=>e.getClientRects().length&&!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).map(e=>e.outerHTML.slice(0,125))
    }),mobile);
    if(results.over)over.push(module);
    results.tiny.forEach(x=>tiny.add(x));
    results.unnamed.forEach(x=>unnamed.add(x));
   });
  }
  console.log(device+' | largura excedida '+JSON.stringify(over)+' | alvos <44px '+JSON.stringify([...tiny])+' | sem rótulo '+JSON.stringify([...unnamed]));
  await check('largura, rótulos dos campos e alvos de toque',()=>{assert.deepEqual(over,[]);assert.deepEqual([...tiny],[]);assert.deepEqual([...unnamed],[])});
  await check('dez temas, persistência e contraste do texto principal',async()=>{
   await go('settings');
   const radios=p.locator('[name=appPalette]');
   assert.equal(await radios.count(),10);
   const colors=new Set();
   const contrasts=[];
   for(const radio of await radios.all()){
    const value=await radio.getAttribute('value');
    await click(p.locator('.palette-option').filter({has:p.locator('[name=appPalette][value="'+value+'"]')}));
    await p.reload(); await p.locator('#pageTitle').waitFor();
    assert.equal(await p.locator('meta[name=theme-color]').getAttribute('content'),await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()));
    await go('settings');
    assert.equal(await p.locator('[name=appPalette]:checked').inputValue(),value);
    const {accent,contrast}=await p.evaluate(()=>{
     const css=getComputedStyle(document.documentElement);
     const accent=css.getPropertyValue('--accent').trim();
     const lum=hex=>hex.match(/[\da-f]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
     const ratio=(fg,bg)=>{const a=lum(fg),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
     return {accent,contrast:Math.min(ratio('#ffffff',accent),ratio(css.getPropertyValue('--text'),css.getPropertyValue('--cream')),ratio(accent,css.getPropertyValue('--banner-beige')))};
    });
    assert.ok(contrast>=4.5,'Contraste '+value+': '+contrast);
    colors.add(accent);
    contrasts.push(value+' '+contrast.toFixed(2)+':1');
    if(value!=='current'){
     for(const selector of mobile?['.sidebar','.topbar','.mobile-nav']:['.sidebar','.topbar']){
      const color=await p.locator(selector).evaluate(el=>getComputedStyle(el).backgroundColor);
      assert.equal(color,await p.locator('.sidebar').evaluate(el=>getComputedStyle(el).backgroundColor));
     }
    }
   }
   assert.equal(colors.size,10);
   console.log(device+' | contraste mínimo por tema | '+contrasts.join(', '));
  });
  await check('foco, Tab, Shift+Tab e Escape',async()=>{
   await go('health');
   assert.equal(await p.locator(':focus').getAttribute('id'),'pageTitle');
   if(mobile){
    await p.locator('#mobileMore').focus();
    await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(()=>document.activeElement.id),'menuClose');
    await p.keyboard.press('Escape');
    assert.equal(await p.evaluate(()=>document.activeElement.id),'mobileMore');
   }
   const trigger=p.locator('[data-action="new:health"]');
   await trigger.focus();
   await p.keyboard.press('Enter');
   assert.equal(await p.locator(':focus').getAttribute('aria-label'),'Fechar');
   assert.equal(await p.locator(':focus').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
   await p.keyboard.press('Shift+Tab');
   assert.equal(await p.locator(':focus').innerText(),'Salvar registro');
   await p.keyboard.press('Tab');
   assert.equal(await p.locator(':focus').getAttribute('aria-label'),'Fechar');
   await p.keyboard.press('Escape');
   assert.equal(await p.locator(':focus').getAttribute('data-action'),'new:health');
  });
  await check('Saúde: registrar, rejeitar período inválido, concluir e consultar',async()=>{
   await go('health');
   await click(p.locator('[data-action="new:health"]'));
   const f=p.locator('#recordForm');
   await f.locator('[name=bird][value=child]').check();
   await f.locator('[name=date]').fill('2026-02-01');
   await f.locator('[name=endDate]').fill('2026-01-30');
   await f.locator('[name=type]').selectOption('SINAL OBSERVADO');
   await f.locator('[name=description]').fill('Observação fictícia');
   await f.locator('[name=alert]').selectOption('SIM');
   await click(f.locator('[type=submit]'));
   assert.match(await feedback(),/NÃO PODE ANTECEDER/);
   const plannedEnd=await p.evaluate(()=>{
    const tomorrow=new Date(Date.now()+2*86400000);
    return tomorrow.toLocaleDateString('en-CA',{timeZone:'America/Fortaleza'});
   });
   await f.locator('[name=endDate]').fill(plannedEnd);
   await click(f.locator('[type=submit]'));
   await f.waitFor({state:'hidden'});
   assert.equal(await p.locator('[data-edit=health]').count(),1);
   await go('events');
   assert.match(await p.locator('#agendaAutomatic').innerText(),/Término previsto de saúde/);
   await go('health');
   await click(p.locator('[data-edit=health]'));
   await f.locator('[name=completedDate]').fill('2026-02-03');
   await click(f.locator('[type=submit]'));
   await f.waitFor({state:'hidden'});
   assert.match(await p.locator('#content tbody').innerText(),/03\/02\/2026/);
   await p.locator('#search').fill('Ave Teste');
   assert.equal(await p.locator('[data-edit=health]').count(),1);
   await p.locator('#search').blur();
   await go('home');
   assert.equal(await p.locator('.mini-list li').filter({hasText:'Alertas de saúde'}).locator('strong').innerText(),'0');
   await go('events');
   assert.doesNotMatch(await p.locator('#agendaAutomatic').innerText(),/Término previsto de saúde/);
  });
  await check('Estoque: compra decimal, consumo, saldo insuficiente e estorno',async()=>{
   await go('stock');
   await click(p.locator('[data-action=quickPurchase]').first());
   await p.locator('#purchaseProduct').selectOption('seed');
   await click(p.locator('#purchaseRoute [type=submit]'));
   const f=p.locator('#recordForm');
   const submit=f.locator('[type=submit]');
   assert.equal(await f.locator('[name=stock]').inputValue(),'seed');
   await f.locator('[name=date]').fill('2026-02-02');
   await f.locator('[name=quantity]').fill('1,5');
   await f.locator('[name=cost]').fill('12,50');
   await click(submit);
   await f.waitFor({state:'hidden'});
   await balance(6.5);
   await go('expenses');
   assert.match(await p.locator('#content tbody').innerText(),/12,50/);
   await go('stock');
   await click(p.locator('[data-action=quickConsumption]').first());
   await f.locator('[name=stock]').selectOption('seed');
   await f.locator('[name=date]').fill('2026-02-03');
   await f.locator('[name=quantity]').fill('8');
   await click(submit);
   assert.match(await feedback(),/SALDO DISPONÍVEL INSUFICIENTE/);
   await f.locator('[name=quantity]').fill('2');
   await click(submit);
   await f.waitFor({state:'hidden'});
   await balance(4.5);
   await click(p.locator('[data-sub=movements]').first());
   await click(p.locator('#content tbody tr').filter({hasText:'SAÍDA'}).locator('[data-delete=movements]'));
   await balance(6.5);
   await p.reload();
   await go('stock');
   await balance(6.5);
  });
  await check('Pedigree: selecionar ave e baixar PDF com pais e anilha',async()=>{
   await go('tree');
   await p.locator('#treeSelect').focus();
   await p.locator('#treeSelect').selectOption('father');
   const retainedFocus=await p.evaluate(()=>document.activeElement.id);
   await p.locator('#treeSelect').selectOption('child');
   const pending=p.waitForEvent('download');
   await click(p.locator('[data-pedigree-pdf=child]'));
   const download=await pending;
   assert.equal(download.suggestedFilename(),'pedigree-ave-teste.pdf');
   const path=await download.path();
   assert.equal((await readFile(path)).subarray(0,5).toString(),'%PDF-');
   const content=execFileSync('pdftotext',[path,'-'],{encoding:'utf8'});
   for(const term of ['AVE TESTE','PAI TESTE','MÃE TESTE','0003'])assert.ok(content.includes(term),term);
   assert.equal(retainedFocus,'treeSelect');
  });
  await check('sem exceções de JavaScript',()=>assert.deepEqual(errors,[]));
  await context.close();
 }
 await browser.close();
 process.exitCode=Number(failures>0);
})().catch(e=>{console.error(e);process.exit(1)});
