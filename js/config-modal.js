/**
 * config-modal.js — Modal de configuration backend (URL Apps Script + clé API + prof).
 *
 * Au premier lancement : ouverture automatique si non configuré.
 * Bouton "🔧" dans le header pour réouvrir à tout moment.
 *
 * Stockage : localStorage clé 'inerweb.cap-ifca-ep2.config'
 *
 * API publique : window.ConfigModal
 */
;(function () {
  'use strict';

  function open() {
    if (document.getElementById('config-overlay')) return; /* déjà ouverte */
    var cfg = (window.Api && Api.getConfig()) || {};

    var overlay = document.createElement('div');
    overlay.id = 'config-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(27,58,99,0.7);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:30px 15px;overflow-y:auto;';

    var modal = document.createElement('div');
    modal.style.cssText = 'background:#fff;border-radius:12px;padding:24px 28px;max-width:680px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.3);';
    modal.innerHTML = [
      '<h2 style="margin:0 0 16px;color:#1b3a63;font-family:Trebuchet MS,sans-serif;font-size:18pt;">🔧 Configuration backend EP2</h2>',
      '<p style="margin:0 0 16px;color:#555;font-size:11pt;line-height:1.5;">',
      '  Cette app a besoin d\'une URL Apps Script (déployée comme webapp) et d\'une clé API pour pousser les notes et les photos dans ton Google Sheet et Drive.',
      '  <br><a href="PROCEDURE_INSTALLATION.html" target="_blank" style="color:#ff6b35;font-weight:700;">📖 Voir la procédure d\'installation (5 minutes)</a>',
      '</p>',
      '<div style="margin-bottom:14px;">',
      '  <label style="display:block;font-weight:700;font-size:11pt;color:#1b3a63;margin-bottom:4px;">URL Apps Script (déploiement webapp)</label>',
      '  <input type="url" id="cfg-url" value="' + escapeAttr(cfg.apiUrl || '') + '" placeholder="https://script.google.com/macros/s/AKfycbz.../exec" style="width:100%;padding:9px 11px;border:1px solid #cbd5e0;border-radius:4px;font-family:Consolas,monospace;font-size:10pt;">',
      '  <p style="margin:4px 0 0;font-size:10pt;color:#888;">Donnée par Apps Script après "Déployer > Nouveau déploiement > Application Web". Doit finir par <code>/exec</code></p>',
      '</div>',
      '<div style="margin-bottom:14px;">',
      '  <label style="display:block;font-weight:700;font-size:11pt;color:#1b3a63;margin-bottom:4px;">Clé API (cf. CLE_API dans Code.gs)</label>',
      '  <input type="text" id="cfg-key" value="' + escapeAttr(cfg.apiKey || '') + '" placeholder="EP2-2026-fh-changeMe" style="width:100%;padding:9px 11px;border:1px solid #cbd5e0;border-radius:4px;font-family:Consolas,monospace;font-size:11pt;">',
      '  <p style="margin:4px 0 0;font-size:10pt;color:#888;">Doit correspondre à la valeur <code>CLE_API</code> dans le code Apps Script (modifie-la après installation).</p>',
      '</div>',
      '<div style="margin-bottom:18px;">',
      '  <label style="display:block;font-weight:700;font-size:11pt;color:#1b3a63;margin-bottom:4px;">Examinateur par défaut</label>',
      '  <select id="cfg-prof" style="padding:9px 11px;border:1px solid #cbd5e0;border-radius:4px;font-weight:700;font-size:12pt;font-family:inherit;min-width:140px;">',
      '    <option value="FH"' + (cfg.prof === 'FH' || !cfg.prof ? ' selected' : '') + '>FH</option>',
      '    <option value="ZN"' + (cfg.prof === 'ZN' ? ' selected' : '') + '>ZN</option>',
      '    <option value="TW"' + (cfg.prof === 'TW' ? ' selected' : '') + '>TW</option>',
      '    <option value="TM"' + (cfg.prof === 'TM' ? ' selected' : '') + '>TM</option>',
      '  </select>',
      '  <p style="margin:4px 0 0;font-size:10pt;color:#888;">Sera modifiable à tout moment dans le bandeau principal. Tracé dans la colonne "Prof" du Sheet et le PDF.</p>',
      '</div>',
      '<div id="cfg-test-result" style="margin-bottom:14px;font-size:11pt;"></div>',
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">',
      '  <button id="cfg-test" type="button" style="flex:1;min-width:140px;padding:11px 14px;background:#fff;color:#1b3a63;border:2px solid #1b3a63;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit;font-size:12pt;">🔍 Tester la connexion</button>',
      '  <button id="cfg-cancel" type="button" style="padding:11px 14px;background:#fff;color:#888;border:1px solid #cbd5e0;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12pt;">Annuler</button>',
      '  <button id="cfg-save" type="button" style="flex:1;min-width:140px;padding:11px 14px;background:#ff6b35;color:#fff;border:0;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit;font-size:13pt;">💾 Enregistrer</button>',
      '</div>',
      '<details style="margin-top:18px;font-size:10pt;color:#888;">',
      '  <summary style="cursor:pointer;color:#1b3a63;font-weight:700;">⚙ Options avancées</summary>',
      '  <div style="padding:8px 0;">',
      '    <button id="cfg-clear" type="button" style="padding:7px 12px;background:#fff;color:#c53030;border:1px solid #c53030;border-radius:4px;cursor:pointer;font-size:10pt;">🗑 Supprimer toute la config (et tout est sauvé localement)</button>',
      '    <p style="margin-top:6px;">L\'app continuera de marcher en mode 100% local (notes dans localStorage, photos dans IndexedDB). Tu pourras tout rebrancher quand tu veux.</p>',
      '  </div>',
      '</details>'
    ].join('\n');

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var urlInp = modal.querySelector('#cfg-url');
    var keyInp = modal.querySelector('#cfg-key');
    var profInp = modal.querySelector('#cfg-prof');
    var resultEl = modal.querySelector('#cfg-test-result');

    modal.querySelector('#cfg-cancel').onclick = function() {
      document.body.removeChild(overlay);
    };

    modal.querySelector('#cfg-test').onclick = function() {
      var tmpCfg = { apiUrl: urlInp.value.trim(), apiKey: keyInp.value.trim(), prof: profInp.value };
      if (!tmpCfg.apiUrl || !tmpCfg.apiKey) {
        resultEl.innerHTML = '<span style="color:#c53030;">⚠ Remplis l\'URL et la clé avant de tester.</span>';
        return;
      }
      resultEl.innerHTML = '<span style="color:#888;">🔄 Test en cours…</span>';
      /* Fix #16: sauvegarder l'ancienne config pour rollback si test échoue */
      var oldCfg = Api.getConfig();
      Api.setConfig(tmpCfg);
      Api.ping().then(function(info) {
        var rows = Object.keys(info.sheets || {}).map(function(k) {
          return k + ' (' + (info.sheets[k].exists ? info.sheets[k].rows + ' lignes' : 'absente') + ')';
        }).join(', ');
        resultEl.innerHTML = '<div style="background:#f0fff4;border:1px solid #38a169;border-radius:4px;padding:10px;color:#2f855a;">' +
          '✓ <strong>Connexion OK !</strong><br>' +
          '<small>Dossier Drive : <a href="' + info.driveFolderUrl + '" target="_blank">' + info.driveFolder + '</a></small><br>' +
          '<small>Feuilles : ' + rows + '</small>' +
          '</div>';
      }).catch(function(err) {
        /* Fix #16: rollback si test échoue */
        if (oldCfg) Api.setConfig(oldCfg);
        else localStorage.removeItem('inerweb.cap-ifca-ep2.config');
        resultEl.innerHTML = '<div style="background:#fff5f5;border:1px solid #c53030;border-radius:4px;padding:10px;color:#c53030;">' +
          '✗ <strong>Échec :</strong> ' + err.message +
          '<br><small>Vérifie l\'URL (doit finir par /exec) et la clé API (= CLE_API dans le code). Ta config précédente a été restaurée.</small>' +
          '</div>';
      });
    };

    modal.querySelector('#cfg-save').onclick = function() {
      var cfg = { apiUrl: urlInp.value.trim(), apiKey: keyInp.value.trim(), prof: profInp.value };
      if (!cfg.apiUrl || !cfg.apiKey) {
        alert('URL et clé sont obligatoires.');
        return;
      }
      Api.setConfig(cfg);
      document.body.removeChild(overlay);
      if (window.SyncDrive && SyncDrive.syncAll) {
        SyncDrive.syncAll(); /* push immédiat des attachements en attente */
      }
      _updateConfigBadge();
    };

    modal.querySelector('#cfg-clear').onclick = function() {
      if (!confirm('Supprimer toute la config backend ? L\'app continuera en mode local seulement.')) return;
      localStorage.removeItem('inerweb.cap-ifca-ep2.config');
      document.body.removeChild(overlay);
      _updateConfigBadge();
    };
  }

  function _updateConfigBadge() {
    var btn = document.getElementById('btn-config');
    if (!btn) return;
    if (Api.isConfigured()) {
      btn.title = 'Configuré ✓';
      btn.style.background = '#38a169';
      btn.textContent = '✓ Config';
    } else {
      btn.title = 'Backend non configuré (mode local seulement)';
      btn.style.background = '#dd6b20';
      btn.textContent = '⚠ Config';
    }
  }

  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  /** Auto-ouverture si pas configuré au démarrage. */
  function autoOpenIfNeeded() {
    if (!window.Api) return;
    if (!Api.isConfigured()) {
      setTimeout(open, 500);
    }
    _updateConfigBadge();
  }

  window.ConfigModal = {
    open: open,
    autoOpenIfNeeded: autoOpenIfNeeded,
    updateBadge: _updateConfigBadge
  };
})();
