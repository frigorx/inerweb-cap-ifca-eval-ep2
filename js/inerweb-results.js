/* inerweb-results.js — collecteur universel inerWeb
   Endpoint Apps Script avec POST write + GET read + buffer offline + retry auto */

(function() {
  'use strict';

  const COLLECTEUR_URL = "https://script.google.com/macros/s/AKfycbz5Bkn1tacs98bJezjnnYt38Yuy6QiHh7qWuEk1KRxS4UMIjl0yFOA0FVakLwCAJhZ5/exec";
  const MODULE_KEY = "eval-cap-ifca";
  const BUFFER_KEY = 'eval.buffer';
  const REMOTE_KEY = 'eval.remote';
  const POLL_INTERVAL_MS = 8000;
  const RETRY_INTERVAL_MS = 30000;

  const API = {
    COLLECTEUR_URL,
    MODULE_KEY,
    _polling: null,
    _retrying: null,
    _listeners: new Set(),

    onUpdate(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); },
    _emit() { this._listeners.forEach(cb => { try { cb(); } catch (e) { console.error(e); } }); },

    /** Push une évaluation. Si fetch fail → buffer offline.
     *  TRADUCTION TRANSPARENTE : si Correspondance dispo, pseudo → idCloud (Sheet ne voit JAMAIS le prénom).
     */
    async write(row) {
      const cloudRow = { ...row, _timestamp: new Date().toISOString() };
      // Pseudo → idCloud avant envoi cloud
      if (window.Correspondance && Correspondance.available() && cloudRow.Pseudo) {
        const id = Correspondance.toIdCloud(cloudRow.Pseudo);
        if (id !== cloudRow.Pseudo) {
          cloudRow.Pseudo = id; // ce qui part au Sheet : M14 (pas MFrédéric)
        }
      }
      const payload = {
        action: 'write',
        module: MODULE_KEY,
        row: cloudRow
      };
      try {
        const r = await fetch(COLLECTEUR_URL, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        // Optimiste : ajoute aussi en cache local
        this._appendLocal(payload.row);
        setSync('sync', 'Sync');
        return { ok: true };
      } catch (e) {
        console.warn('[write] échec — buffer offline', e);
        this._bufferAdd(payload);
        setSync('buffer', `Buffer (${this._bufferCount()})`);
        return { ok: false, buffered: true, error: String(e) };
      }
    },

    /** Lit toutes les évaluations existantes côté Sheet. */
    async read({ since } = {}) {
      const url = new URL(COLLECTEUR_URL);
      url.searchParams.set('action', 'read');
      url.searchParams.set('module', MODULE_KEY);
      if (since) url.searchParams.set('since', since);
      try {
        const r = await fetch(url.toString(), { method: 'GET', mode: 'cors', cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        // Si endpoint read pas encore déployé → status ok service mais pas de data
        if (Array.isArray(j.data)) {
          this._setRemote(j.data);
          setSync('sync', 'Sync');
          this._emit();
          return j.data;
        }
        // Pas d'erreur mais pas de data → endpoint read pas encore en place
        return null;
      } catch (e) {
        console.warn('[read] échec', e);
        setSync('error', 'Lecture KO');
        return null;
      }
    },

    /** Boucle de polling 8 s. */
    startPolling() {
      if (this._polling) return;
      this.read();
      this._polling = setInterval(() => this.read(), POLL_INTERVAL_MS);
      // Retry buffer toutes les 30 s
      this._retrying = setInterval(() => this.retryBuffer(), RETRY_INTERVAL_MS);
    },
    stopPolling() {
      if (this._polling) clearInterval(this._polling);
      if (this._retrying) clearInterval(this._retrying);
      this._polling = this._retrying = null;
    },

    /** Vide le buffer en relançant chaque item. */
    async retryBuffer() {
      const buf = Store.get(BUFFER_KEY, []);
      if (!buf.length) return { sent: 0, remaining: 0 };
      let sent = 0;
      const remaining = [];
      for (const payload of buf) {
        try {
          const r = await fetch(COLLECTEUR_URL, {
            method: 'POST', mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          sent++;
          this._appendLocal(payload.row);
        } catch (e) {
          remaining.push(payload);
        }
      }
      Store.set(BUFFER_KEY, remaining);
      if (remaining.length === 0) setSync('sync', 'Sync OK');
      else setSync('buffer', `Buffer (${remaining.length})`);
      this._emit();
      return { sent, remaining: remaining.length };
    },

    _bufferAdd(payload) {
      const buf = Store.get(BUFFER_KEY, []);
      buf.push(payload);
      Store.set(BUFFER_KEY, buf);
    },
    _bufferCount() { return (Store.get(BUFFER_KEY, []) || []).length; },
    bufferCount() { return this._bufferCount(); },
    clearBuffer() { Store.set(BUFFER_KEY, []); setSync('sync','Sync'); this._emit(); },

    _appendLocal(row) {
      const all = Store.get(REMOTE_KEY, []);
      // En cache local on garde le pseudo (pas l'idCloud) pour que les vues affichent direct
      const localRow = { ...row };
      if (window.Correspondance && Correspondance.available() && localRow.Pseudo) {
        localRow.Pseudo = Correspondance.toPseudo(localRow.Pseudo);
      }
      all.push(localRow);
      Store.set(REMOTE_KEY, all);
    },
    _setRemote(data) {
      // data = matrice [headers, ...rows] OR [{...}, {...}]
      let rows = [];
      if (data.length && Array.isArray(data[0])) {
        const headers = data[0];
        rows = data.slice(1).map(r => {
          const o = {};
          headers.forEach((h, i) => o[h] = r[i]);
          return o;
        });
      } else {
        rows = data;
      }
      // Traduction inverse idCloud → pseudo (ce que voit le prof)
      if (window.Correspondance && Correspondance.available()) {
        rows = rows.map(r => {
          if (r && r.Pseudo) {
            const p = Correspondance.toPseudo(r.Pseudo);
            if (p !== r.Pseudo) return { ...r, Pseudo: p };
          }
          return r;
        });
      }
      // Last-write-wins : merge avec local
      const local = Store.get(REMOTE_KEY, []);
      const merged = mergeLastWrite(local, rows);
      Store.set(REMOTE_KEY, merged);
    },

    getAllRows() { return Store.get(REMOTE_KEY, []) || []; }
  };

  function mergeLastWrite(local, remote) {
    const idx = new Map();
    [...local, ...remote].forEach(row => {
      if (!row) return;
      // Schéma V2 (Module + TpId + Pseudo) avec fallback vers anciens champs V1.
      // Inclure Module évite que TP-EVAL, AFFECT, CCF-EP3, TP-USER d'un même élève
      // s'écrasent entre eux.
      const mod   = row.Module   || '';
      const pse   = row.Pseudo   || '';
      const tp    = row.TpId     || row.TP || '';
      const sub   = row.Critere  || row.Phase || row.Code || '';
      const key   = `${mod}|${pse}|${tp}|${sub}`;
      const ts = row.UpdatedAt || row._timestamp || row.Date || '';
      const cur = idx.get(key);
      if (!cur || (ts && ts > (cur.UpdatedAt || cur._timestamp || cur.Date || ''))) {
        idx.set(key, row);
      }
    });
    return Array.from(idx.values());
  }

  window.inerwebResults = API;
  window.inerwebRetryAll = () => API.retryBuffer();

})();
