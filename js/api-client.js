/**
 * api-client.js — Client HTTP vers le backend Apps Script CCF EP2.
 *
 * Lit la config (URL + clé API) depuis localStorage.
 * Méthodes : Api.call(action, payload) → Promise<response>
 * Retries automatiques (3 tentatives avec backoff exponentiel).
 *
 * Buffer offline : si le call échoue (réseau ou serveur), on stocke dans IndexedDB
 * via Attach._buffer (réutilise le même store). Géré par sync-drive.js.
 *
 * API publique : window.Api
 */
;(function () {
  'use strict';

  var CFG_KEY = 'inerweb.cap-ifca-ep2.config';

  /** Auto-config via URL fragment #cfg=base64({apiUrl,apiKey,prof}) */
  function _autoConfigFromUrl() {
    var hash = window.location.hash || '';
    if (hash.indexOf('#cfg=') !== 0) return false;
    try {
      var b64 = decodeURIComponent(hash.substring(5));
      var cfg = JSON.parse(atob(b64));
      if (cfg && cfg.apiUrl && cfg.apiKey) {
        localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
        /* Nettoyer le hash de la barre d'adresse pour ne pas exposer la clé */
        history.replaceState(null, '', window.location.pathname + window.location.search);
        console.log('[Api] Auto-configuré via #cfg= (clé hash nettoyée de l\'URL)');
        return true;
      }
    } catch (e) {
      console.warn('[Api] Échec parse #cfg=', e.message);
    }
    return false;
  }

  var _autoCfgChecked = false; /* Fix #8: déclaré AVANT son usage */

  function getConfig() {
    /* Au tout 1er appel, tenter l'auto-config via #cfg= */
    if (!_autoCfgChecked) { _autoConfigFromUrl(); _autoCfgChecked = true; }
    try {
      var raw = localStorage.getItem(CFG_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setConfig(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    return cfg;
  }

  function isConfigured() {
    var c = getConfig();
    return !!(c && c.apiUrl && c.apiKey);
  }

  /**
   * Appel API avec retries.
   * @param {string} action — pushNote / uploadPhoto / uploadSignature / getCurrent / getAttachments / status
   * @param {object} payload — données à envoyer (le champ key est ajouté automatiquement)
   * @returns {Promise<object>} réponse parsée
   */
  function call(action, payload) {
    var cfg = getConfig();
    if (!cfg || !cfg.apiUrl || !cfg.apiKey) {
      return Promise.reject(new Error('NOT_CONFIGURED'));
    }
    var body = Object.assign({}, payload || {}, {
      action: action,
      key: cfg.apiKey
    });

    return _fetchWithRetry(cfg.apiUrl, body, 3);
  }

  function _fetchWithRetry(url, body, attempts) {
    var attempt = 0;
    function tryOnce() {
      attempt++;
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, /* text/plain pour éviter preflight CORS */
        body: JSON.stringify(body),
        redirect: 'follow'
      })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP_' + r.status);
        return r.text();
      })
      .then(function(txt) {
        try { return JSON.parse(txt); }
        catch (e) { throw new Error('JSON_PARSE: ' + txt.substring(0, 200)); }
      })
      .catch(function(err) {
        if (attempt < attempts) {
          var delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.warn('[Api] tentative', attempt, 'échouée:', err.message, '— retry dans', delay, 'ms');
          return new Promise(function(resolve) { setTimeout(resolve, delay); }).then(tryOnce);
        }
        throw err;
      });
    }
    return tryOnce();
  }

  /**
   * Test rapide du backend : appel ?action=status.
   */
  function ping() {
    return call('status', {}).then(function(r) {
      return r && r.ok ? r : Promise.reject(new Error('STATUS_NOT_OK: ' + JSON.stringify(r)));
    });
  }

  /**
   * warmup : ping silencieux et NON-bloquant pour réveiller Apps Script au démarrage.
   * Si le script dormait (cold start), ce premier appel "absorbe" les 5-10 sec de réveil
   * et les requêtes suivantes (notes/photos) sont rapides (~1-2 s).
   * Le keepAlive trigger Apps Script (toutes les 5 min) maintient ensuite l'éveil.
   */
  function warmup() {
    if (!isConfigured()) return Promise.resolve({ skipped: true });
    var t0 = Date.now();
    return call('status', {}).then(function(r) {
      var dt = Date.now() - t0;
      console.log('[Api] warmup terminé en ' + dt + 'ms', r && r.ok ? '(ok)' : '(ko)');
      return { ok: true, latency: dt };
    }).catch(function(err) {
      console.warn('[Api] warmup échoué:', err.message);
      return { ok: false, error: err.message };
    });
  }

  /* API publique */
  window.Api = {
    getConfig: getConfig,
    setConfig: setConfig,
    isConfigured: isConfigured,
    call: call,
    ping: ping,
    warmup: warmup
  };

  /* Auto-warmup au chargement (background, ne bloque pas l'UI) */
  if (typeof window !== 'undefined') {
    window.addEventListener('load', function() {
      /* Délai 500ms pour laisser l'UI s'afficher d'abord */
      setTimeout(function() { warmup(); }, 500);
    });
  }
})();
