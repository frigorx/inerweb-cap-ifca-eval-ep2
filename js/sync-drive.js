/**
 * sync-drive.js — Sync IndexedDB (attachments locaux) → Apps Script + Drive.
 *
 * Stratégie :
 *   1. Liste toutes les pièces non encore synchronisées (syncedAt === null)
 *   2. Pour chaque : appel API uploadPhoto / uploadSignature
 *   3. En cas de succès : marque syncedAt + driveUrl sur l'enreg local
 *   4. En cas d'échec : laisse en file d'attente, retry au prochain syncAll()
 *
 * Déclenchement :
 *   - Auto au démarrage (5 s après chargement)
 *   - Auto après chaque addPhoto / addSignature (via évènement)
 *   - Manuel via bouton "🔄 Sync maintenant" dans la config
 *   - Auto toutes les 60 s (background)
 *
 * API publique : window.SyncDrive
 */
;(function () {
  'use strict';

  var _inProgress = false;
  var _lastSync = null;
  var _autoSyncTimer = null;

  function syncAll() {
    if (_inProgress) return Promise.resolve({ skipped: true, reason: 'already_in_progress' });
    if (!window.Api || !window.Attach) return Promise.resolve({ skipped: true, reason: 'modules_missing' });
    if (!Api.isConfigured()) return Promise.resolve({ skipped: true, reason: 'not_configured' });

    _inProgress = true;
    _setStatus('🔄 Sync en cours…');

    return _getAllUnsynced().then(function(items) {
      if (items.length === 0) {
        _inProgress = false;
        _lastSync = new Date();
        _setStatus('✓ Tout est sync (' + _timeAgo(_lastSync) + ')');
        return { synced: 0, total: 0 };
      }
      console.log('[SyncDrive] À synchroniser :', items.length);
      var okCount = 0, koCount = 0;
      var chain = Promise.resolve();
      items.forEach(function(it) {
        chain = chain.then(function() {
          return _syncOne(it).then(function() { okCount++; }).catch(function(e) {
            console.warn('[SyncDrive] échec item', it.id, e.message);
            koCount++;
          });
        });
      });
      return chain.then(function() {
        _inProgress = false;
        _lastSync = new Date();
        var msg = okCount === items.length
          ? '✓ ' + okCount + ' pièce' + (okCount > 1 ? 's' : '') + ' sync (' + _timeAgo(_lastSync) + ')'
          : '⚠ ' + okCount + '/' + items.length + ' sync — ' + koCount + ' restant';
        _setStatus(msg);
        return { synced: okCount, failed: koCount, total: items.length };
      });
    }).catch(function(err) {
      _inProgress = false;
      _setStatus('⚠ Sync échouée : ' + err.message);
      throw err;
    });
  }

  function _syncOne(item) {
    var action, payload;
    if (item.type === 'photo') {
      action = 'uploadPhoto';
      payload = {
        eleve: item.eleve,
        epreuve: item.epreuve,
        prof: _getCurrentProf(),
        filename: item.filename || 'photo.jpg',
        dataBase64: item.data
      };
    } else if (item.type === 'signature_eleve' || item.type === 'signature_prof') {
      action = 'uploadSignature';
      payload = {
        eleve: item.eleve,
        epreuve: item.epreuve,
        prof: _getCurrentProf(),
        typeSig: item.type,
        dataBase64: item.data
      };
    } else {
      return Promise.reject(new Error('TYPE_INCONNU: ' + item.type));
    }

    return Api.call(action, payload).then(function(r) {
      if (!r || !r.ok) throw new Error('API_KO: ' + (r && r.error ? r.error : 'unknown'));
      /* Marquer comme synchronisé */
      return _markSynced(item.id, r.driveUrl);
    });
  }

  function _getAllUnsynced() {
    return new Promise(function(resolve) {
      var req = indexedDB.open('inerweb-ep2-attach', 1);
      req.onsuccess = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('attachments')) { resolve([]); return; }
        var tx = db.transaction('attachments', 'readonly');
        var os = tx.objectStore('attachments');
        var out = [];
        os.openCursor().onsuccess = function(ev) {
          var cur = ev.target.result;
          if (cur) {
            if (!cur.value.syncedAt) out.push(cur.value);
            cur.continue();
          } else {
            resolve(out);
          }
        };
      };
      req.onerror = function() { resolve([]); };
    });
  }

  function _markSynced(id, driveUrl) {
    return new Promise(function(resolve) {
      var req = indexedDB.open('inerweb-ep2-attach', 1);
      req.onsuccess = function(e) {
        var db = e.target.result;
        var tx = db.transaction('attachments', 'readwrite');
        var os = tx.objectStore('attachments');
        var g = os.get(id);
        g.onsuccess = function() {
          var rec = g.result;
          if (rec) {
            rec.syncedAt = new Date().toISOString();
            rec.driveUrl = driveUrl || rec.driveUrl;
            os.put(rec);
          }
          resolve(true);
        };
        g.onerror = function() { resolve(false); };
      };
    });
  }

  function _getCurrentProf() {
    try {
      var c = Api.getConfig();
      return (c && c.prof) || 'FH';
    } catch (e) { return 'FH'; }
  }

  function _setStatus(msg) {
    var el = document.getElementById('sync-pending');
    if (el) el.textContent = msg;
  }

  function _timeAgo(d) {
    if (!d) return '';
    var s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'à l\'instant';
    if (s < 3600) return 'il y a ' + Math.floor(s / 60) + ' min';
    return 'il y a ' + Math.floor(s / 3600) + ' h';
  }

  function startAuto() {
    if (_autoSyncTimer) return;
    /* Premier sync 3 s après le chargement (laisse l'app se rendre) */
    setTimeout(function() { syncAll(); }, 3000);
    /* Puis toutes les 60 s */
    _autoSyncTimer = setInterval(function() {
      if (Api.isConfigured()) syncAll();
    }, 60000);
  }

  /* Hook : si Attach déclenche un événement custom 'attach-added', lance un sync rapide */
  window.addEventListener('attach-added', function() {
    setTimeout(syncAll, 800);
  });

  window.SyncDrive = {
    syncAll: syncAll,
    startAuto: startAuto,
    isInProgress: function() { return _inProgress; },
    lastSync: function() { return _lastSync; }
  };
})();
