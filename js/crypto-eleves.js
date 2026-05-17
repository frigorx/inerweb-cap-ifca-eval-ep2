/**
 * crypto-eleves.js — Déchiffrement de la table de correspondance E0X → pseudo lisible.
 *
 * Format du fichier data/eleves_chiffre.json :
 *   {
 *     "_meta": {...},
 *     "salt":       "base64",   ← 16 bytes random (généré par chiffrer.html)
 *     "iv":         "base64",   ← 12 bytes random
 *     "ciphertext": "base64"    ← AES-GCM ciphertext + tag
 *   }
 *
 * Algorithme : PBKDF2 (100 000 itérations, SHA-256) + AES-256-GCM.
 * Implémentation : Web Crypto API native (aucune librairie externe).
 *
 * Stockage du mot de passe :
 *   - Par défaut : session storage uniquement (perdu à la fermeture de l'onglet)
 *   - Optionnel : localStorage (case "se souvenir sur ce poste")
 *
 * API publique : window.CryptoEleves
 *   - CryptoEleves.unlock(password, remember=false) → Promise<corresp obj>
 *   - CryptoEleves.relock()                          → vide la mémoire
 *   - CryptoEleves.isUnlocked()                      → bool
 *   - CryptoEleves.tryAutoUnlock()                   → tente le déchiffrement automatique si pw mémorisé
 *   - CryptoEleves.getCorresp()                      → la table déchiffrée (ou {} si verrouillé)
 */
;(function () {
  'use strict';

  var STORAGE_KEY = 'inerweb.cap-ifca-ep2.crypto-pw';
  var SESSION_KEY = 'inerweb.cap-ifca-ep2.crypto-pw-session';
  var ITERATIONS = 100000;
  var KEY_LEN = 256;

  var _corresp = {};       /* table E0X → nom (déchiffrée) */
  var _unlocked = false;
  var _meta = null;

  /* ========== UTILS BASE64 ========== */
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function bytesToB64(bytes) {
    var bin = '';
    var arr = new Uint8Array(bytes);
    for (var i = 0; i < arr.byteLength; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  /* ========== DERIVATION CLEF PBKDF2 ========== */
  function deriveKey(password, saltBytes) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    ).then(function (baseKey) {
      return crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: saltBytes,
          iterations: ITERATIONS,
          hash: 'SHA-256'
        },
        baseKey,
        { name: 'AES-GCM', length: KEY_LEN },
        false,
        ['encrypt', 'decrypt']
      );
    });
  }

  /* ========== DÉCHIFFREMENT ========== */
  function decrypt(payload, password) {
    var salt = b64ToBytes(payload.salt);
    var iv = b64ToBytes(payload.iv);
    var ct = b64ToBytes(payload.ciphertext);
    return deriveKey(password, salt).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    }).then(function (plainBytes) {
      var txt = new TextDecoder().decode(plainBytes);
      return JSON.parse(txt);
    });
  }

  /* ========== CHIFFREMENT (utilisé par chiffrer.html) ========== */
  function encrypt(corresp, password) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var data = new TextEncoder().encode(JSON.stringify(corresp));
    return deriveKey(password, salt).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data);
    }).then(function (ctBytes) {
      return {
        _meta: {
          description: 'Table E0X → pseudo lisible (chiffrée AES-256-GCM).',
          algo: 'AES-256-GCM avec PBKDF2(100000 itérations, SHA-256)',
          nb_eleves: Object.keys(corresp).length,
          chiffre_le: new Date().toISOString()
        },
        salt: bytesToB64(salt),
        iv: bytesToB64(iv),
        ciphertext: bytesToB64(ctBytes)
      };
    });
  }

  /* ========== UNLOCK / LOCK ========== */
  function unlock(password, remember) {
    if (!password) return Promise.reject(new Error('PASSWORD_VIDE'));
    return fetch('data/eleves_chiffre.json')
      .then(function (r) {
        if (!r.ok) throw new Error('FICHIER_CHIFFRE_404');
        return r.json();
      })
      .then(function (payload) {
        _meta = payload._meta;
        return decrypt(payload, password);
      })
      .then(function (corresp) {
        _corresp = corresp || {};
        _unlocked = true;
        if (remember) {
          try { localStorage.setItem(STORAGE_KEY, password); } catch (e) {}
        } else {
          try { sessionStorage.setItem(SESSION_KEY, password); } catch (e) {}
        }
        return _corresp;
      })
      .catch(function (err) {
        var msg = err.message || String(err);
        if (msg.indexOf('OperationError') >= 0 || msg.indexOf('decrypt') >= 0) {
          throw new Error('MOT_DE_PASSE_INCORRECT');
        }
        throw err;
      });
  }

  function relock(clearAll) {
    _corresp = {};
    _unlocked = false;
    if (clearAll) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    }
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function tryAutoUnlock() {
    var pw = null;
    try { pw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (!pw) return Promise.resolve(false);
    return unlock(pw, !!localStorage.getItem(STORAGE_KEY))
      .then(function () { return true; })
      .catch(function () {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
        return false;
      });
  }

  function isUnlocked() { return _unlocked; }
  function getCorresp() { return _corresp; }
  function getMeta() { return _meta; }

  /* API publique */
  window.CryptoEleves = {
    unlock: unlock,
    relock: relock,
    tryAutoUnlock: tryAutoUnlock,
    isUnlocked: isUnlocked,
    getCorresp: getCorresp,
    getMeta: getMeta,
    /* Exposé pour la page chiffrer.html */
    encrypt: encrypt
  };
})();
