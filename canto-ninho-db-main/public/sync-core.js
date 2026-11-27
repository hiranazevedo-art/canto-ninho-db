// Funções de sincronização usadas pela PWA e pela API de dados.
(function () {
  'use strict';
  const collections = ['birds', 'food', 'feedings', 'feedingPreferences', 'couples', 'seasons', 'attempts', 'nests',
    'eggs', 'chicks', 'tasks', 'health', 'trips', 'events', 'stock', 'movements', 'expenses',
    'revenues', 'facilities', 'transfers', 'documents', 'knowledge', 'pedigreeBirds', 'tournaments', 'audit'];
  const recordMap = rows => new Map((rows || []).map(row => [row.id, row]));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const field = (record, key) => Object.hasOwn(record || {}, key) ? record[key] : null;
  const normalizeRing = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const same = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
        a.every((item, index) => same(item, b[index]));
    }
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length &&
      keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
  };

  function differences(base, next) {
    const changes = [];
    for (const collection of collections) {
      const previous = recordMap(base[collection]);
      const current = recordMap(next[collection]);
      for (const [id, value] of current) {
        if (!same(previous.get(id), value)) changes.push({ collection, id, value });
      }
      if (collection === 'audit') continue;
      for (const id of previous.keys()) {
        if (!current.has(id)) changes.push({ collection, id, value: null });
      }
    }
    const settings = new Set([...Object.keys(base.settings || {}), ...Object.keys(next.settings || {})]);
    for (const id of settings) {
      const value = field(next.settings, id);
      if (!same(field(base.settings, id), value)) changes.push({ collection: 'settings', id, value });
    }
    return changes;
  }

  function validChanges(changes) {
    return Array.isArray(changes) && changes.length > 0 && changes.length <= 12000 &&
      changes.every(change => {
        if (!object(change) || typeof change.id !== 'string' || !change.id || change.id.length > 256 ||
          !Object.hasOwn(change, 'value')) return false;
        if (change.collection === 'settings') return !['__proto__', 'prototype', 'constructor'].includes(change.id);
        return collections.includes(change.collection) &&
          (change.value === null ? change.collection !== 'audit' :
            object(change.value) && change.value.id === change.id);
      });
  }

  function apply(base, changes) {
    const result = { ...base, settings: { ...base.settings } };
    const touched = new Map();
    for (const { collection, id, value } of changes) {
      if (collection === 'settings') {
        if (value === null) delete result.settings[id];
        else result.settings[id] = value;
        continue;
      }
      if (!touched.has(collection)) touched.set(collection, recordMap(base[collection]));
      const records = touched.get(collection);
      if (value === null) records.delete(id);
      else records.set(id, value);
    }
    for (const [collection, records] of touched) {
      const rows = [...records.values()];
      result[collection] = collection === 'audit'
        ? rows.sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))).slice(-1500)
        : rows;
    }
    return result;
  }

  const links = {
    birds: { sourceChick: 'chicks' },
    couples: { male: 'birds', female: 'birds' },
    seasons: { couple: 'couples' },
    attempts: { couple: 'couples', season: 'seasons', facility: 'facilities' },
    nests: { attempt: 'attempts' },
    eggs: { nest: 'nests' },
    chicks: { egg: 'eggs', nest: 'nests', couple: 'couples', plantelBirdId: 'birds' },
    feedings: { bird: 'birds', food: 'food' },
    feedingPreferences: { bird: 'birds', feeder: 'food', vitaminHolder: 'food' },
    tasks: { bird: 'birds', facility: 'facilities' },
    documents: { bird: 'birds' },
    events: { bird: 'birds', sourceNest: 'nests', sourceChick: 'chicks' },
    health: { bird: 'birds' },
    trips: { bird: 'birds' },
    transfers: { bird: 'birds', facility: 'facilities' },
    movements: { stock: 'stock', saleId: 'revenues' },
    facilities: { cageStockId: 'stock', cageSaleId: 'revenues' },
    expenses: { birdAcquisitionId: 'birds' }
  };

  function references(collection, row) {
    if (!row || !object(row)) return [];
    const fields = Object.entries(links[collection] || {});
    if (row.couple && !links[collection]?.couple && collection !== 'audit') fields.push(['couple', 'couples']);
    if (collection === 'birds' || collection === 'pedigreeBirds') {
      for (const key of ['father', 'mother']) {
        fields.push([key, String(row[key] || '').startsWith('ancestral_') ? 'pedigreeBirds' : 'birds']);
      }
    }
    if (collection === 'revenues') {
      if (row.kind === 'bird') fields.push(['itemId', 'birds']);
      if (row.kind === 'cage') fields.push(['itemId', 'stock'], ['cageFacilityIds', 'facilities']);
    }
    return fields.flatMap(([key, target]) => [row[key]].flat().filter(Boolean)
      .map(id => target + ':' + id));
  }

  function dependencyIndex(data) {
    const index = new Map();
    for (const collection of collections) {
      for (const row of data[collection] || []) {
        for (const ref of new Set(references(collection, row).map(ref => ref.toLowerCase()))) {
          if (!index.has(ref)) index.set(ref, []);
          index.get(ref).push({ collection, row });
        }
      }
    }
    return index;
  }

  function coupleDependents(data, id, index = dependencyIndex(data)) {
    const pending = ['couples:' + id.toLowerCase()];
    const visited = new Set(pending);
    const dependents = [];
    for (const parent of pending) {
      for (const entry of index.get(parent) || []) {
        const key = entry.collection + ':' + entry.row.id.toLowerCase();
        if (visited.has(key)) continue;
        visited.add(key);
        pending.push(key);
        dependents.push(entry);
      }
    }
    return dependents;
  }

  function coupleDependencyMessage(dependents) {
    if (!dependents.length) return '';
    const labels = { seasons: 'temporadas', attempts: 'tentativas', nests: 'ninhadas',
      eggs: 'ovos', chicks: 'filhotes', birds: 'fichas do Plantel', events: 'eventos da Agenda' };
    const groups = new Map();
    for (const { collection, row } of dependents) {
      const label = labels[collection] || 'outros registros vinculados';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(row.name || row.title || row.ring || row.start || row.date || row.id);
    }
    const summary = [...groups].map(([label, names]) =>
      names.length + ' ' + label + ' (' + names.slice(0, 3).join(', ') + (names.length > 3 ? ', …' : '') + ')');
    return 'Exclusão bloqueada. Confira os registros vinculados: ' + summary.join(', ') + '.';
  }

  function coupleIssues(previous, next) {
    if (!previous) return [];
    const ids = data => new Set((data.couples || []).map(row => row.id.toLowerCase()));
    const retained = ids(next);
    const current = recordMap(next.couples);
    const removed = (previous.couples || []).filter(row => !current.has(row.id));
    const issues = [];
    const issue = (id, label) => ({ collection: 'couples', id, label, reason: 'couple-link' });
    if (removed.length) {
      const before = dependencyIndex(previous), after = dependencyIndex(next);
      for (const couple of removed) {
        // A remoção simultânea dos dependentes não autoriza apagar o histórico.
        const label = coupleDependencyMessage(coupleDependents(previous, couple.id, before)) ||
          coupleDependencyMessage(coupleDependents(next, couple.id, after));
        if (label) issues.push(issue(couple.id, label));
      }
    }
    // Preserva vínculos legados incompletos e impede criar novas referências a um casal ausente.
    for (const collection of collections) {
      if (collection === 'audit') continue;
      const before = recordMap(previous[collection]);
      for (const row of next[collection] || []) {
        const absent = [row.couple].flat().filter(id => id && !retained.has(String(id).toLowerCase()));
        const existing = new Set([before.get(row.id)?.couple].flat().map(id => String(id).toLowerCase()));
        if (absent.some(id => !existing.has(String(id).toLowerCase()))) {
          issues.push({ collection, id: row.id, reason: 'couple-link',
            label: 'O registro faz referência a um casal ausente. Confira a Reprodução.' });
        }
      }
    }
    return issues;
  }

  function merge(base, local, remote) {
    const key = change => change.collection + ':' + change.id;
    const remoteEdits = new Map(differences(base, remote).map(change => [key(change), change]));
    const baseRows = new Map(collections.map(collection => [collection, recordMap(base[collection])]));
    const organization = new Map();
    const localKeys = new Map(differences(base, local).map(change => [key(change), change]));
    const remoteDeletes = new Set([...remoteEdits.values()].filter(change => change.value === null).map(key));
    for (const change of remoteEdits.values()) {
      if (change.collection === 'settings') continue;
      const previous = baseRows.get(change.collection).get(change.id);
      for (const ref of references(change.collection, change.value)) {
        if (!references(change.collection, previous).includes(ref)) organization.set(ref, change);
      }
    }

    const changes = [], conflicts = [];
    const localChanges = [...localKeys.values()];
    const localDeletes = new Set(localChanges.filter(change => change.value === null).map(key));
    for (const change of localChanges) {
      const id = key(change);
      const other = remoteEdits.get(id);
      if (other && same(other.value, change.value)) continue;
      const previous = baseRows.get(change.collection)?.get(change.id);
      const refs = references(change.collection, change.value);
      const strongDependencies = ['birds', 'pedigreeBirds', 'couples', 'chicks', 'transfers', 'revenues', 'movements', 'facilities'];
      const physicalCollections = ['revenues', 'transfers', 'facilities', 'movements'];
      const sharedPhysicalAsset = physicalCollections.includes(change.collection) &&
        [...refs, ...references(change.collection, previous)].some(ref => {
          const concurrent = organization.get(ref);
          return concurrent && !localDeletes.has(key(concurrent)) &&
            physicalCollections.includes(concurrent.collection);
        });
      const dependsOnEdit = refs.some(ref => remoteDeletes.has(ref) ||
        strongDependencies.includes(change.collection) && remoteEdits.has(ref) &&
        !same(localKeys.get(ref)?.value, remoteEdits.get(ref).value));
      const dependentWhileDeleting = change.value === null && organization.has(id) && !localDeletes.has(key(organization.get(id)));
      if (change.collection === 'couples' && change.value === null && dependentWhileDeleting) {
        conflicts.push({ ...change, label: coupleDependencyMessage(coupleDependents(remote, change.id)) });
      } else if (other || dependsOnEdit || dependentWhileDeleting || sharedPhysicalAsset) {
        conflicts.push({ ...change, label: (change.value || previous)?.name ||
          (change.value || previous)?.ring || (change.value || previous)?.title || change.id });
      } else {
        changes.push(change);
      }
    }
    const result = apply(remote, changes);
    for (const collection of ['birds', 'pedigreeBirds']) {
      const edited = new Set(changes.filter(change => change.collection === collection).map(change => change.id));
      const rings = new Map();
      for (const bird of result[collection] || []) {
        const ring = normalizeRing(bird.ring);
        if (!ring) continue;
        const existing = rings.get(ring);
        if (existing && (edited.has(existing) || edited.has(bird.id))) {
          conflicts.push({ collection, id: bird.id, label: 'Anilha em duplicidade: ' + bird.ring });
        }
        rings.set(ring, bird.id);
      }
    }
    for(const issue of integrityIssues(remote,result)){
      if(!['egg-outcome','feeding-period','cage-overlap','couple-link'].includes(issue.reason))continue;
      const change=localKeys.get(key(issue));
      if(change&&!conflicts.some(existing=>key(existing)===key(change)))
        conflicts.push({...change,label:issue.label});
    }
    return { changes, result, conflicts };
  }

  const cageKinds = [
      ['INDIVIDUAL', /\bindividua(?:l|is)\b/], ['TRANSPORTE', /\btransporte\b/],
      ['VOADEIRA', /\bvoadeiras?\b/], ['CAMPEADA', /\bcampeadas?\b/],
      ['REPRODUÇÃO', /\breproducao\b/], ['VIVEIRO', /\bviveiros?\b/]
  ];
  function cageKind(unit, productName, useDeclared = true) {
    if (String(unit?.type || '').trim().toUpperCase() !== 'GAIOLA') return '';
    if (useDeclared && (unit.cageType === 'OUTRO' || cageKinds.some(([key]) => key === unit.cageType))) {
      return unit.cageType;
    }
    const infer = value => {
      const name = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return cageKinds.find(([, pattern]) => pattern.test(name))?.[0];
    };
    return infer(productName) || infer(unit.name) || 'OUTRO';
  }

  function transferOverlaps(a, b) {
    return (!a.end || !a.start || a.start < a.end) &&
      (!b.end || !b.start || b.start < b.end) &&
      (!a.end || !b.start || b.start < a.end) &&
      (!b.end || !a.start || a.start < b.end);
  }

  function cageConflicts(data) {
    const normalizeId = value => String(value || '').toLowerCase();
    const stock = new Map((data.stock || []).map(row => [normalizeId(row.id), row.name]));
    const single = new Set((data.facilities || [])
      .filter(unit => cageKind(unit, stock.get(normalizeId(unit.cageStockId))) === 'INDIVIDUAL')
      .map(unit => normalizeId(unit.id)));
    const grouped = new Map();
    for (const row of data.transfers || []) {
      const unit = normalizeId(row.facility);
      if (!single.has(unit)) continue;
      if (!grouped.has(unit)) grouped.set(unit, []);
      grouped.get(unit).push(row);
    }
    const conflicts = new Map();
    for (const [unit, rows] of grouped) {
      rows.sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i], b = rows[j];
          if (a.end && b.start && b.start >= a.end) break;
          if (transferOverlaps(a, b)) conflicts.set(JSON.stringify([unit, ...[a.id, b.id].sort()]), [a, b]);
        }
      }
    }
    return conflicts;
  }

  function integrityIssues(previous, next) {
    function indexes(data) {
      const result = new Map();
      const add = (kind, value, collection, row, identity = row.id) => {
        if (!value) return;
        const key = kind + ':' + value;
        if (!result.has(key)) result.set(key, new Map());
        result.get(key).set(identity, { collection, id: row.id, label: value });
      };
      const birds = recordMap(data.birds), chicks = recordMap(data.chicks);
      const bySource = new Map([...birds.values()].filter(bird => bird.sourceChick).map(bird => [bird.sourceChick, bird]));
      for (const bird of birds.values()) add('ring', normalizeRing(bird.ring), 'birds', bird, 'bird:' + bird.id);
      for (const chick of chicks.values()) {
        const linked = birds.get(chick.plantelBirdId) || bySource.get(chick.id);
        add('ring', normalizeRing(chick.ring), 'chicks', chick, linked ? 'bird:' + linked.id : 'chick:' + chick.id);
        add('egg', String(chick.egg || '').toLowerCase(), 'chicks', chick);
        if (chick.plantelBirdId) add('plantel', chick.plantelBirdId, 'chicks', chick);
      }
      for (const bird of birds.values()) {
        if (chicks.has(bird.sourceChick)) add('source', bird.sourceChick, 'birds', bird);
      }
      for (const ancestor of recordMap(data.pedigreeBirds).values()) {
        add('ancestor', normalizeRing(ancestor.ring), 'pedigreeBirds', ancestor);
      }
      return result;
    }
    const old = indexes(previous || {}), updated = indexes(next);
    const issues = coupleIssues(previous, next);
    for (const [key, group] of updated) {
      if (group.size < 2 || [...group.keys()].every(id => old.get(key)?.has(id))) continue;
      const kind = key.split(':', 1)[0];
      const descriptions = {
        ring: 'Anilha em duplicidade', ancestor: 'Anilha em duplicidade',
        egg: 'Mais de um filhote vinculado ao mesmo ovo',
        plantel: 'Mais de um filhote vinculado à mesma ave do Plantel',
        source: 'Mais de uma ave no Plantel vinculada ao mesmo filhote'
      };
      for (const member of group.values()) {
        issues.push({ ...member, reason: 'integrity',
          label: descriptions[kind] + (kind === 'ring' || kind === 'ancestor' ? ': ' + member.label : '') });
      }
    }
    const unhatched = data => new Map((data.eggs || []).filter(egg=>egg.status==='NÃO ECLODIDO')
      .map(egg=>[String(egg.id).toLowerCase(),egg]));
    const before = unhatched(previous || {}), after = unhatched(next);
    const previousChicks = recordMap(previous?.chicks);
    for(const chick of next.chicks || []){
      const link = String(chick.egg || '').toLowerCase();
      const egg = after.get(link);
      if(!egg||before.has(link)&&String(previousChicks.get(chick.id)?.egg || '').toLowerCase()===link)continue;
      const label='Ovo marcado como não eclodido com filhote vinculado';
      issues.push({collection:'eggs',id:egg.id,label,reason:'egg-outcome'},
        {collection:'chicks',id:chick.id,label,reason:'egg-outcome'});
    }
    const periods=(next.feedingPreferences || []).slice().sort((a,b)=>String(a.start).localeCompare(String(b.start)));
    const latestEndByBird=new Map();
    for(const row of periods){
      if(typeof row.bird!=='string'||!row.bird||typeof row.start!=='string'||typeof row.end!=='string')continue;
      const bird=row.bird.toLowerCase(), latest=latestEndByBird.get(bird);
      if(latest&&latest.end>=row.start){
        for(const period of [latest,row])issues.push({collection:'feedingPreferences',id:period.id,
          reason:'feeding-period',label:'Há observações com períodos sobrepostos para a mesma ave'});
      }
      if(!latest||row.end>latest.end)latestEndByBird.set(bird,row);
    }
    const priorOccupations = cageConflicts(previous || {});
    for (const [key, rows] of cageConflicts(next)) {
      if (priorOccupations.has(key)) continue;
      for (const row of rows) issues.push({collection:'transfers',id:row.id,reason:'cage-overlap',
        label:'Esta gaiola individual já tem uma ocupação no período informado.'});
    }
    return issues;
  }

  const reviewFields = {
    birds: ['name', 'notes', 'condition'],
    pedigreeBirds: ['name', 'breeder'],
    food: ['name', 'notes', 'composition'],
    tasks: ['notes'], health: ['notes', 'description'], events: ['notes', 'title'],
    documents: ['notes', 'name'], knowledge: ['name', 'notes']
  };


  function reviewConflicts(base, local, remote) {
    const conflicts = merge(base, local, remote).conflicts;
    return conflicts.map(({collection,id,label}) => {
      const fields = Object.hasOwn(reviewFields, collection) ? reviewFields[collection] : null;
      if (!fields) return null;
      const rows = [base, local, remote].map(data => recordMap(data[collection]).get(id));
      if (rows.some(row => !row)) return null;
      const [before, here, there] = rows;
      const changed = [...new Set(rows.flatMap(Object.keys))].filter(key =>
        key !== 'updatedAt' && (!same(before[key],here[key]) || !same(before[key],there[key])));
      if (!changed.length || changed.some(key => !fields.includes(key))) return null;
      if (same(before,here) || same(before,there)) return null;
      return {collection,id,label,fields:changed,before,here,there};
    });
  }

  function resolveConflicts(base, local, remote, choices) {
    const review = reviewConflicts(base, local, remote);
    if (!review.length || review.length !== choices.length || review.some((row,index) =>
      !row || !['local','remote'].includes(choices[index]))) return null;
    const reverted = apply(local, review.map(({collection,id,before}) => ({collection,id,value:before})));
    const merged = merge(base,reverted,remote);
    if (merged.conflicts.length) return null;
    const selected = review.flatMap(({collection,id,here},index) =>
      choices[index] === 'local' ? [{collection,id,value:here}] : []);
    const result = apply(merged.result,selected);
    return integrityIssues(remote,result).length ? null : result;
  }

  globalThis.CantoSync = { same, differences, validChanges, apply, merge, collections, integrityIssues,
    cageKind, transferOverlaps, reviewConflicts, resolveConflicts, coupleDependents, coupleDependencyMessage };
})();
