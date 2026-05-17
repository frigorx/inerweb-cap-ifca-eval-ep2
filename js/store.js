/* store.js — abstraction localStorage + cache JSON
   Toutes les données métier passent par ces helpers. */

(function() {
  'use strict';

  const PREFIX = 'inerweb.cap-ifca.';

  window.Store = {
    get(key, def = null) {
      try {
        const v = localStorage.getItem(PREFIX + key);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch (e) {}
    },
    remove(key) {
      try { localStorage.removeItem(PREFIX + key); } catch (e) {}
    },
    clear() {
      const all = Object.keys(localStorage);
      all.forEach(k => { if (k.startsWith(PREFIX)) localStorage.removeItem(k); });
    }
  };

  // Cache JSON catalogs (one fetch per session)
  const _cache = {};
  window.Catalog = {
    async load(file) {
      if (_cache[file]) return _cache[file];
      try {
        const r = await fetch(`data/${file}?v=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        _cache[file] = j;
        return j;
      } catch (e) {
        console.error('[Catalog]', file, e);
        return null;
      }
    },
    /** Chargement silencieux d'un fichier optionnel (404 = pas d'erreur, retourne null). */
    async loadOptional(file) {
      if (_cache[file] !== undefined) return _cache[file];
      try {
        const r = await fetch(`data/${file}?v=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) { _cache[file] = null; return null; }
        const j = await r.json();
        _cache[file] = j;
        return j;
      } catch (e) {
        _cache[file] = null;
        return null;
      }
    }
  };

  // === Correspondance triple identité (LOCAL uniquement, jamais cloud) ===
  // idCloud (M01..) → pseudo (MFrédéric) → "Prénom NOM" (Frédéric MENDY)
  // - idCloud : ce qui part au Sheet, neutre
  // - pseudo : ce que voit le prof, lisible
  // - nom+prénom : surimpression côté prof seulement
  let _correspondance = null;
  let _byPseudo = {};
  let _byIdCloud = {};
  let _correspondanceLoaded = false;
  window.Correspondance = {
    async load() {
      if (_correspondanceLoaded) return _correspondance;
      _correspondanceLoaded = true;
      // Priorité 1 : localStorage (déjà déverrouillé sur ce poste)
      let c = Store.get('correspondance.local');
      // Priorité 2 : déchiffrement automatique avec mot de passe mémorisé
      if (!c) {
        const pwd = Store.get('correspondance.password');
        if (pwd) {
          try {
            c = await this.unlock(pwd);
          } catch (e) {
            console.warn('Mot de passe stocké invalide (peut-être changé) — purge auto');
            Store.remove('correspondance.password');
          }
        }
      }
      // Priorité 3 : fichier en clair sur le serveur (dev only — gitignored en prod)
      if (!c) c = await Catalog.loadOptional('correspondance_eleves.json');
      if (c && c.eleves) {
        _correspondance = c.eleves;
        c.eleves.forEach(e => {
          _byPseudo[e.pseudo] = e;
          if (e.idCloud) _byIdCloud[e.idCloud] = e;
        });
      }
      return _correspondance;
    },
    /** Tente de déchiffrer data/eleves_chiffre.json avec le mot de passe.
     *  Retourne {eleves:[...]} si OK, throw si mauvais mot de passe.
     *  Dispatch l'event 'correspondance-loaded' pour que tous les modules refresh. */
    async unlock(password) {
      if (!password) throw new Error('Mot de passe vide');
      const r = await fetch(`data/eleves_chiffre.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('Fichier chiffré introuvable');
      const enc = await r.json();
      const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
      const salt = fromB64(enc.salt);
      const iv = fromB64(enc.iv);
      const ct = fromB64(enc.ciphertext);
      const subtle = window.crypto.subtle;
      const pwdKey = await subtle.importKey('raw', new TextEncoder().encode(password),
        { name: 'PBKDF2' }, false, ['deriveKey']);
      const key = await subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        pwdKey,
        { name: 'AES-GCM', length: 256 },
        false, ['decrypt']
      );
      let plaintext;
      try {
        const buf = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        plaintext = new TextDecoder().decode(buf);
      } catch (e) {
        throw new Error('Mot de passe incorrect');
      }
      const data = JSON.parse(plaintext);
      // Mémorise le password pour les ouvertures suivantes
      Store.set('correspondance.password', password);
      // Reset cache + populate
      _correspondance = data.eleves;
      _byPseudo = {};
      _byIdCloud = {};
      data.eleves.forEach(e => {
        _byPseudo[e.pseudo] = e;
        if (e.idCloud) _byIdCloud[e.idCloud] = e;
      });
      /* Notifier tous les modules : refresh de leurs sélecteurs, grilles, bandeaux */
      try {
        document.dispatchEvent(new CustomEvent('correspondance-loaded', { detail: { count: data.eleves.length } }));
      } catch (e) {}
      return data;
    },
    /** Import depuis un fichier JSON utilisateur. Stocké en localStorage. */
    importFromJson(jsonData) {
      if (!jsonData || !jsonData.eleves || !Array.isArray(jsonData.eleves)) {
        throw new Error('Format invalide : attendu { eleves: [...] }');
      }
      Store.set('correspondance.local', jsonData);
      // Reset cache
      _correspondance = jsonData.eleves;
      _byPseudo = {};
      _byIdCloud = {};
      jsonData.eleves.forEach(e => {
        _byPseudo[e.pseudo] = e;
        if (e.idCloud) _byIdCloud[e.idCloud] = e;
      });
      return jsonData.eleves.length;
    },
    /** Retire la correspondance de ce poste (mot de passe + données). */
    clear() {
      Store.remove('correspondance.local');
      Store.remove('correspondance.password');
      _correspondance = null;
      _byPseudo = {};
      _byIdCloud = {};
    },
    /** Convertit pseudo → idCloud (ce qui part au Sheet). Fallback : retourne le pseudo. */
    toIdCloud(pseudo) {
      if (!pseudo) return pseudo;
      const e = _byPseudo[pseudo];
      return (e && e.idCloud) ? e.idCloud : pseudo;
    },
    /** Convertit idCloud → pseudo (ce que voit le prof). Fallback : retourne l'idCloud. */
    toPseudo(idCloud) {
      if (!idCloud) return idCloud;
      const e = _byIdCloud[idCloud];
      return e ? e.pseudo : idCloud;
    },
    /** Retourne "Prénom NOM" si correspondance dispo. Accepte idCloud OU pseudo. */
    label(idOrPseudo) {
      if (!idOrPseudo) return idOrPseudo;
      const e = _byPseudo[idOrPseudo] || _byIdCloud[idOrPseudo];
      return e ? `${e.prenom} ${e.nom}` : idOrPseudo;
    },
    /** Retourne objet élève complet ou null. */
    get(idOrPseudo) {
      return _byPseudo[idOrPseudo] || _byIdCloud[idOrPseudo] || null;
    },
    available() {
      return _correspondance && _correspondance.length > 0;
    }
  };

  // Profs — fallback hardcodé, surchargé par data/profs.json si présent (chargement async)
  window.PROFS = [
    { code: 'FH', nom: 'F. Henninot',  prenom: 'Franck', couleur: '#1b3a63', role: 'admin' },
    { code: 'PW', nom: 'P. Whart',     prenom: '',       couleur: '#ff6b35', role: 'prof'  },
    { code: 'ZN', nom: 'ZN',           prenom: '',       couleur: '#2d8659', role: 'prof'  },
    { code: 'TM', nom: 'TM',           prenom: '',       couleur: '#6b3a8a', role: 'prof'  }
  ];
  /** Promise résolue quand data/profs.json est chargé (ou que le fallback est confirmé). */
  window.PROFS_READY = (async () => {
    try {
      const j = await Catalog.loadOptional('profs.json');
      if (j && Array.isArray(j.profs) && j.profs.length) {
        window.PROFS = j.profs;
      }
    } catch (e) { /* fallback hardcodé déjà en place */ }
    return window.PROFS;
  })();

  window.NIVEAUX = [
    { code: 'NA',  label: 'Non acquis',   score: 0, couleur: '#c53030' },
    { code: 'ECA', label: 'En cours',     score: 1, couleur: '#dd6b20' },
    { code: 'A',   label: 'Acquis',       score: 2, couleur: '#38a169' },
    { code: 'M',   label: 'Maîtrisé',     score: 3, couleur: '#1b3a63' }
  ];

  // Toast
  window.toast = function(msg, kind = 'info', ms = 3000) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'error' ? ' err' : '');
    el.textContent = msg;
    if (kind === 'error') el.style.background = '#c53030';
    if (kind === 'success') el.style.background = '#38a169';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  };

  // Sync badge
  window.setSync = function(state, label) {
    const el = document.getElementById('sync-badge');
    const ic = el.querySelector('.icon');
    const lb = document.getElementById('sync-label');
    el.className = 'sync-badge ' + state;
    if (state === 'sync') ic.textContent = '🟢';
    else if (state === 'buffer') ic.textContent = '🟡';
    else if (state === 'error') ic.textContent = '🔴';
    if (label) lb.textContent = label;
  };

})();
