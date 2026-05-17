/**
 * attachments.js — Module unifié photos + signatures pour CCF EP2
 *
 * Inspiré de PROG-PLUS/js/photos.js + signatures.js, mais autonome (pas de dép pfmpData/students).
 * Stockage IndexedDB local + file d'attente pour sync Drive (phase 3).
 *
 * Schéma d'un enregistrement :
 *   { id, eleve, epreuve, type, date, data, thumb, driveUrl, syncedAt, version }
 *   - type : 'photo' | 'signature_eleve' | 'signature_prof'
 *   - epreuve : 'ep2faco' | 'ep2elec'
 *
 * API publique : window.Attach
 *   - Attach.list(eleve, epreuve)            → Promise<[{...}]>
 *   - Attach.addPhoto(eleve, epreuve, file)  → Promise<record>
 *   - Attach.addSignature(eleve, epreuve, type, dataUrl) → Promise<record>
 *   - Attach.remove(id)                       → Promise<bool>
 *   - Attach.openSignatureModal(eleve, epreuve, type) → Promise (résout après save/cancel)
 *   - Attach.viewFullscreen(id)               → modal plein écran
 *   - Attach.pendingSync()                    → Promise<count> (non encore Drive)
 */
;(function () {
  'use strict';

  /* ========== CONFIG ========== */
  var DB_NAME = 'inerweb-ep2-attach';
  var DB_VERSION = 1;
  var STORE = 'attachments';
  var MAX_PHOTO_WIDTH = 1200;
  var THUMB_WIDTH = 160;
  var MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 Mo (un peu plus large que PROG-PLUS car photos atelier)
  var SIG_TYPES = ['signature_eleve', 'signature_prof'];

  /* ========== IndexedDB ========== */
  var _db = null;

  function _openDB() {
    return new Promise(function(resolve, reject) {
      if (_db) { resolve(_db); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          os.createIndex('eleve', 'eleve', { unique: false });
          os.createIndex('eleveEpreuve', ['eleve', 'epreuve'], { unique: false });
          os.createIndex('syncedAt', 'syncedAt', { unique: false });
        }
      };
      req.onsuccess = function(e) { _db = e.target.result; resolve(_db); };
      req.onerror = function(e) { reject(e.target.error); };
    });
  }

  function _tx(mode) {
    return _openDB().then(function(db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  /* ========== CRUD ========== */
  function list(eleve, epreuve) {
    return _tx('readonly').then(function(os) {
      return new Promise(function(resolve) {
        var idx = os.index('eleveEpreuve');
        var req = idx.getAll([eleve, epreuve]);
        req.onsuccess = function() { resolve(req.result || []); };
        req.onerror = function() { resolve([]); };
      });
    });
  }

  function remove(id) {
    return _tx('readwrite').then(function(os) {
      return new Promise(function(resolve) {
        var req = os.delete(id);
        req.onsuccess = function() { resolve(true); };
        req.onerror = function() { resolve(false); };
      });
    });
  }

  function _save(record) {
    return _tx('readwrite').then(function(os) {
      return new Promise(function(resolve) {
        var req = os.add(record);
        req.onsuccess = function() { record.id = req.result; resolve(record); };
        req.onerror = function() { resolve(null); };
      });
    });
  }

  function getById(id) {
    return _tx('readonly').then(function(os) {
      return new Promise(function(resolve) {
        var req = os.get(id);
        req.onsuccess = function() { resolve(req.result || null); };
        req.onerror = function() { resolve(null); };
      });
    });
  }

  function pendingSync() {
    return _tx('readonly').then(function(os) {
      return new Promise(function(resolve) {
        var count = 0;
        var req = os.openCursor();
        req.onsuccess = function(e) {
          var cur = e.target.result;
          if (cur) {
            if (!cur.value.syncedAt) count++;
            cur.continue();
          } else {
            resolve(count);
          }
        };
        req.onerror = function() { resolve(0); };
      });
    });
  }

  /* ========== IMAGE PROCESSING ========== */
  function _resizeImage(file, maxW) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
          var w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function _makeThumb(dataUrl) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var w = img.width, h = img.height;
        if (w > THUMB_WIDTH) { h = Math.round(h * THUMB_WIDTH / w); w = THUMB_WIDTH; }
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = function() { resolve(''); };
      img.src = dataUrl;
    });
  }

  /* ========== ADD PHOTO ========== */
  function addPhoto(eleve, epreuve, file) {
    if (!file) return Promise.resolve(null);
    if (file.size > MAX_FILE_SIZE) {
      alert('Photo trop volumineuse (max 8 Mo). Réduis la qualité ou la taille.');
      return Promise.resolve(null);
    }
    return _resizeImage(file, MAX_PHOTO_WIDTH).then(function(data) {
      return _makeThumb(data).then(function(thumb) {
        return _save({
          eleve: eleve,
          epreuve: epreuve,
          type: 'photo',
          date: new Date().toISOString(),
          data: data,
          thumb: thumb,
          filename: file.name || 'photo.jpg',
          driveUrl: null,
          syncedAt: null,
          version: 1
        });
      });
    });
  }

  /* ========== ADD SIGNATURE ========== */
  function addSignature(eleve, epreuve, type, dataUrl) {
    if (SIG_TYPES.indexOf(type) === -1) return Promise.reject('Type signature invalide');
    if (!dataUrl) return Promise.resolve(null);
    return _save({
      eleve: eleve,
      epreuve: epreuve,
      type: type,
      date: new Date().toISOString(),
      data: dataUrl,
      thumb: dataUrl, /* signature = déjà petite */
      driveUrl: null,
      syncedAt: null,
      version: 1
    });
  }

  /* ========== SIGNATURE MODAL ========== */
  function openSignatureModal(eleve, epreuve, type) {
    return new Promise(function(resolve) {
      var label = type === 'signature_eleve' ? "Signature de l'élève" : "Signature du prof évaluateur";
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';

      var modal = document.createElement('div');
      modal.style.cssText = 'background:#fff;border-radius:12px;padding:20px;max-width:680px;width:100%;';
      modal.innerHTML =
        '<h3 style="margin:0 0 12px;font-family:Trebuchet MS,sans-serif;color:#1b3a63;">✍ ' + label + '</h3>' +
        '<p style="margin:0 0 10px;color:#555;font-size:12pt;">Élève <strong>' + escapeHtml(eleve) + '</strong> · Épreuve <strong>' + epreuve.toUpperCase() + '</strong></p>' +
        '<div style="border:2px solid #1b3a63;border-radius:6px;background:#fff;">' +
        '  <canvas id="sig-canvas" width="600" height="180" style="display:block;width:100%;height:180px;touch-action:none;cursor:crosshair;background:#fff;"></canvas>' +
        '</div>' +
        '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' +
        '  <button id="sig-clear" style="flex:1;padding:10px;font-size:12pt;border:1px solid #cbd5e0;background:#f4f6fa;border-radius:6px;cursor:pointer;">↺ Effacer</button>' +
        '  <button id="sig-cancel" style="flex:1;padding:10px;font-size:12pt;border:1px solid #c53030;background:#fff;color:#c53030;border-radius:6px;cursor:pointer;">Annuler</button>' +
        '  <button id="sig-save" style="flex:2;padding:10px;font-size:13pt;background:#ff6b35;color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:700;">✓ Valider la signature</button>' +
        '</div>' +
        '<p style="margin:8px 0 0;font-size:10pt;color:#888;">💡 Signe au doigt sur écran tactile ou à la souris sur PC.</p>';

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      var canvas = modal.querySelector('#sig-canvas');
      var ctx = canvas.getContext('2d');
      _prepareCanvas(canvas, ctx);
      _attachDrawing(canvas, ctx);

      modal.querySelector('#sig-clear').onclick = function() { _prepareCanvas(canvas, ctx); };
      modal.querySelector('#sig-cancel').onclick = function() {
        document.body.removeChild(overlay);
        resolve(null);
      };
      modal.querySelector('#sig-save').onclick = function() {
        if (!_hasDrawing(canvas)) {
          alert('Le canvas est vide — signe avant de valider.');
          return;
        }
        var dataUrl;
        try { dataUrl = canvas.toDataURL('image/png'); }
        catch (err) { alert('Erreur capture signature : ' + err.message); return; }
        addSignature(eleve, epreuve, type, dataUrl).then(function(rec) {
          document.body.removeChild(overlay);
          resolve(rec);
        });
      };
    });
  }

  function _prepareCanvas(canvas, ctx) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#000000'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }

  function _attachDrawing(canvas, ctx) {
    var enCours = false;
    function coords(e) {
      var rect = canvas.getBoundingClientRect();
      var src = e.touches && e.touches.length > 0 ? e.touches[0] : e;
      return {
        x: (src.clientX - rect.left) * (canvas.width / rect.width),
        y: (src.clientY - rect.top) * (canvas.height / rect.height)
      };
    }
    function debut(e) { e.preventDefault(); enCours = true; var p = coords(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
    function mvt(e)   { if (!enCours) return; e.preventDefault(); var p = coords(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    function fin()    { enCours = false; }
    canvas.addEventListener('mousedown', debut);
    canvas.addEventListener('mousemove', mvt);
    canvas.addEventListener('mouseup', fin);
    canvas.addEventListener('mouseleave', fin);
    canvas.addEventListener('touchstart', debut, { passive: false });
    canvas.addEventListener('touchmove', mvt,   { passive: false });
    canvas.addEventListener('touchend', fin);
  }

  function _hasDrawing(canvas) {
    try {
      var ctx = canvas.getContext('2d');
      var img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      var n = 0;
      for (var i = 0; i < img.length; i += 16) {
        if (img[i] < 250 || img[i+1] < 250 || img[i+2] < 250) {
          n++;
          if (n >= 50) return true;
        }
      }
      return false;
    } catch (e) { return true; }
  }

  /* ========== VIEWER PLEIN ÉCRAN ========== */
  function viewFullscreen(id) {
    getById(id).then(function(rec) {
      if (!rec) return;
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:10001;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;cursor:zoom-out;';
      overlay.innerHTML =
        '<img src="' + rec.data + '" style="max-width:96vw;max-height:84vh;object-fit:contain;border-radius:4px;">' +
        '<div style="color:#fff;margin-top:12px;font-size:12pt;text-align:center;">' +
        '  <strong>' + escapeHtml(rec.eleve) + '</strong> · ' + rec.epreuve.toUpperCase() + ' · ' + rec.type + '<br>' +
        '  <span style="opacity:0.7;font-size:10pt;">' + new Date(rec.date).toLocaleString('fr-FR') + '</span>' +
        '</div>';
      overlay.onclick = function() { document.body.removeChild(overlay); };
      document.body.appendChild(overlay);
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * listMerged : combine attachements LOCAUX (IndexedDB) + DISTANTS (Drive via Apps Script).
   * Permet à un PC de voir les photos prises depuis un téléphone (et inversement).
   * Dédoublonne par driveFileId.
   *
   * @returns Promise<[{...}]> avec champ "source" = 'local' | 'remote'
   */
  function listMerged(eleve, epreuve) {
    return list(eleve, epreuve).then(function(localItems) {
      /* Marquer source = local */
      localItems.forEach(function(it) { it.source = 'local'; });
      /* Tenter de récupérer la liste distante (si backend configuré) */
      if (!window.Api || !window.Api.isConfigured()) return localItems;
      return window.Api.call('getAttachments', { eleve: eleve, epreuve: epreuve })
        .then(function(r) {
          if (!r || !r.ok) return localItems;
          var remoteItems = [];
          /* Photos distantes */
          (r.photos || []).forEach(function(p) {
            remoteItems.push({
              id: 'remote-photo-' + p.driveFileId,
              eleve: eleve,
              epreuve: epreuve,
              type: 'photo',
              date: p.timestamp,
              thumb: p.thumbUrl,
              data: p.thumbUrl, /* fallback pour viewFullscreen */
              driveUrl: p.driveUrl,
              driveFileId: p.driveFileId,
              filename: p.filename,
              prof: p.prof,
              version: p.version,
              source: 'remote'
            });
          });
          /* Signatures distantes */
          (r.signatures || []).forEach(function(s) {
            remoteItems.push({
              id: 'remote-sig-' + s.driveFileId,
              eleve: eleve,
              epreuve: epreuve,
              type: s.typeSig || 'signature_eleve',
              date: s.timestamp,
              thumb: s.thumbUrl,
              data: s.thumbUrl,
              driveUrl: s.driveUrl,
              driveFileId: s.driveFileId,
              prof: s.prof,
              version: s.version,
              source: 'remote'
            });
          });
          /* Dédoublonnage : un item local déjà synchronisé a un driveUrl,
             on garde la version LOCALE (plus riche en data base64 pour aperçu) */
          var localDriveIds = new Set(localItems.filter(function(it) { return it.driveFileId; }).map(function(it) { return it.driveFileId; }));
          var uniqueRemote = remoteItems.filter(function(it) { return !localDriveIds.has(it.driveFileId); });
          return localItems.concat(uniqueRemote);
        })
        .catch(function(err) {
          console.warn('[Attach.listMerged] échec récup distant:', err.message);
          return localItems; /* fallback : on garde au moins le local */
        });
    });
  }

  /* ========== API ========== */
  window.Attach = {
    list: list,
    listMerged: listMerged,
    remove: remove,
    addPhoto: addPhoto,
    addSignature: addSignature,
    openSignatureModal: openSignatureModal,
    viewFullscreen: viewFullscreen,
    pendingSync: pendingSync,
    getById: getById
  };
})();
