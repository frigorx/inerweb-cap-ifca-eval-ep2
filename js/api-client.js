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

  function getConfig() {
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

  /* API publique */
  window.Api = {
    getConfig: getConfig,
    setConfig: setConfig,
    isConfigured: isConfigured,
    call: call,
    ping: ping
  };
})();
