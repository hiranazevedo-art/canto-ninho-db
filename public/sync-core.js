// Funções de sincronização usadas pela PWA e pela API de dados.
(function () {
  'use strict';
  const collections = ['birds', 'food', 'feedings', 'couples', 'seasons', 'attempts', 'nests',
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
      if (other || dependsOnEdit || dependentWhileDeleting || sharedPhysicalAsset) {
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
    return { changes, result, conflicts };
  }

  globalThis.CantoSync = { same, differences, validChanges, apply, merge, collections };
})();
