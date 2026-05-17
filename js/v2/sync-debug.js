/* sync-debug.js — panneau diagnostic + sauvegarde manuelle JSON
   Permet à Franck de comprendre ce qui se passe et de récupérer
   ses données même si la sync cloud est cassée. */

(function() {
  'use strict';

  function open() {
    closeIfOpen();
    const overlay = document.createElement('div');
    overlay.id = 'syncdbg-overlay';
    overlay.className = 'syncdbg-overlay';
    overlay.innerHTML = `
      <div class="syncdbg-card">
        <header>
          <h2>🔍 État de la synchronisation</h2>
          <button class="btn-x" id="syncdbg-close" title="Fermer">×</button>
        </header>
        <div class="syncdbg-body" id="syncdbg-body">Chargement…</div>
        <footer class="syncdbg-footer">
          <button class="btn small ghost" id="syncdbg-refresh">↻ Rafraîchir</button>
          <button class="btn small secondary" id="syncdbg-test">🧪 Test push</button>
          <button class="btn small secondary" id="syncdbg-pull">🔄 Force pull</button>
          <button class="btn small" id="syncdbg-pushall" style="background:#dd6b20;color:#fff;border:0;">⬆ Re-pousser TOUT vers Sheet</button>
          <button class="btn small" id="syncdbg-resetcache" style="background:#805ad5;color:#fff;border:0;" title="Vide le cache des rows reçues du Sheet (pas tes saisies locales) et relance un pull complet. Utile si la sync est partielle.">♻ Purger cache &amp; re-pull</button>
          <button class="btn orange" id="syncdbg-export">💾 Sauvegarder JSON</button>
          <button class="btn" id="syncdbg-import" style="background:#38a169;color:#fff;border:0;">📥 Importer JSON</button>
        </footer>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('syncdbg-close').onclick = closeIfOpen;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeIfOpen(); });
    document.getElementById('syncdbg-refresh').onclick = renderState;
    document.getElementById('syncdbg-test').onclick = testPush;
    document.getElementById('syncdbg-pull').onclick = forcePull;
    document.getElementById('syncdbg-pushall').onclick = pushAllLocal;
    document.getElementById('syncdbg-resetcache').onclick = resetCacheAndPull;
    document.getElementById('syncdbg-export').onclick = exportAll;
    document.getElementById('syncdbg-import').onclick = triggerImport;

    renderState();
  }

  function renderState() {
    const body = document.getElementById('syncdbg-body');
    if (!body) return;

    const ccfKeys = listKeys('ccf.ep3.');
    const tpevalKeys = listKeys('tpeval.');
    const affectKeys = listKeys('affect.');
    const userTPKeys = listKeys('tp.user.');
    const buffer = Store.get('eval.buffer') || [];
    const remote = Store.get('eval.remote') || [];

    /* Compte par module dans remote */
    const byModule = {};
    remote.forEach(r => {
      const m = (r && r.Module) || '(sans Module)';
      byModule[m] = (byModule[m] || 0) + 1;
    });

    const cur = Store.get('prof.current') || '?';
    const corrOk = window.Correspondance && Correspondance.available();

    body.innerHTML = `
      <h3>📊 Stockage local sur ce poste</h3>
      <table class="syncdbg-table">
        <tr><td>Prof connecté</td><td><strong>${cur}</strong></td></tr>
        <tr><td>Correspondance déchiffrée</td><td><strong>${corrOk ? '✅ oui (24 noms)' : '❌ non (M01..M24)'}</strong></td></tr>
        <tr><td>CCF EP3 saisis</td><td><strong style="color:${ccfKeys.length > 0 ? '#38a169' : '#888'}">${ccfKeys.length}</strong></td></tr>
        <tr><td>Évaluations TP formatives</td><td><strong style="color:${tpevalKeys.length > 0 ? '#38a169' : '#888'}">${tpevalKeys.length}</strong></td></tr>
        <tr><td>Affectations TP</td><td><strong style="color:${affectKeys.length > 0 ? '#38a169' : '#888'}">${affectKeys.length}</strong></td></tr>
        <tr><td>TP user importés (drag-drop)</td><td><strong>${userTPKeys.length}</strong></td></tr>
      </table>

      <h3>☁ État Sheet (vue locale)</h3>
      <table class="syncdbg-table">
        <tr><td>Buffer offline (à renvoyer)</td><td><strong style="color:${buffer.length > 0 ? '#dd6b20' : '#38a169'}">${buffer.length}</strong></td></tr>
        <tr><td>Rows reçues du Sheet (cache)</td><td><strong>${remote.length}</strong></td></tr>
      </table>

      ${Object.keys(byModule).length > 0 ? `
        <h4>Détail par module reçu de la Sheet :</h4>
        <table class="syncdbg-table">
          ${Object.keys(byModule).map(m => `<tr><td>${m}</td><td><strong>${byModule[m]}</strong></td></tr>`).join('')}
        </table>
      ` : '<p class="syncdbg-warn">⚠ Aucune row récupérée du Sheet — le pull ne fonctionne pas, ou la Sheet est vide pour ce module.</p>'}

      ${buffer.length > 0 ? `
        <h4>📦 Buffer (push qui n'ont pas atteint la Sheet) :</h4>
        <pre class="syncdbg-pre">${escapeHtml(JSON.stringify(buffer.slice(0, 5), null, 2))}${buffer.length > 5 ? '\n... ('+ (buffer.length-5) +' de plus)' : ''}</pre>
        <p class="syncdbg-warn">→ Si tu vois des saisies ici, c'est que la Sheet refuse les nouveaux modules. Solution : utilise le bouton 💾 ci-dessous pour ne pas les perdre.</p>
      ` : ''}

      <h4>📋 Dernières rows reçues du Sheet (5 plus récentes) :</h4>
      ${remote.length > 0
        ? `<pre class="syncdbg-pre">${escapeHtml(JSON.stringify(remote.slice(-5), null, 2))}</pre>`
        : '<p class="syncdbg-warn">Aucune row.</p>'}
    `;
  }

  function listKeys(localPrefix) {
    const out = [];
    const fullPrefix = 'inerweb.cap-ifca.' + localPrefix;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(fullPrefix)) out.push(k);
    }
    return out;
  }

  async function testPush() {
    if (!window.inerwebResults) { alert('inerwebResults indisponible'); return; }
    const testRow = {
      Module: 'TEST-PING',
      Pseudo: 'TEST-' + Date.now().toString(36),
      Note: 'ping ' + new Date().toISOString(),
      Evaluateur: Store.get('prof.current') || ''
    };
    const res = await inerwebResults.write(testRow);
    if (res.ok) {
      alert('✅ Push test OK — la Sheet répond, vérifie maintenant si elle stocke bien le row.\n\nForce un pull (bouton 🔄) puis re-rafraîchis ce panneau pour voir si TEST-PING apparaît dans les modules reçus.');
    } else {
      alert('❌ Push KO — buffer offline. Code : ' + (res.error || 'inconnu') + '\nLa Sheet ne répond pas, ou rejette le row.');
    }
    setTimeout(renderState, 500);
  }

  async function forcePull() {
    if (window.Sync && Sync.pullNow) {
      await Sync.pullNow();
      setTimeout(renderState, 500);
    }
  }

  /** Re-pousse TOUTES les saisies locales vers la Sheet (utile après mise à niveau Code.gs).
   *  Force la propagation des SaisieJSON / CompJSON / Statut qui n'avaient pas été stockés. */
  async function pushAllLocal() {
    if (!confirm('Re-pousser TOUTES tes saisies locales vers la Google Sheet ?\n\nUtile après mise à niveau du backend pour que les autres profs voient enfin tes données.\n\nDurée : ~10-30 secondes.')) return;
    let ccfCount = 0, tpevalCount = 0, affectCount = 0, userTPCount = 0;
    /* CCF EP3 */
    const ccfPrefix = 'inerweb.cap-ifca.ccf.ep3.';
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ccfPrefix)) {
        const idCloud = k.substring(ccfPrefix.length);
        if (window.CCFExport && CCFExport.pushSheet) {
          try { await CCFExport.pushSheet(idCloud); ccfCount++; } catch (e) {}
        }
      }
    }
    /* TP-EVAL */
    if (window.TPEval && window.Sync && Sync.pushTPEval) {
      const evals = TPEval.list();
      for (const e of evals) {
        try { await Sync.pushTPEval(e.pseudo, e.tpId, e); tpevalCount++; } catch (err) {}
      }
    }
    /* AFFECT */
    if (window.Affectations && window.Sync && Sync.pushAffect) {
      const affects = Affectations.list();
      for (const a of affects) {
        try { await Sync.pushAffect(a.pseudo, a.tpId, a); affectCount++; } catch (err) {}
      }
    }
    /* TP-USER (méta seulement) */
    if (window.TPImport) {
      const tps = TPImport.listUserTPs();
      for (const meta of tps) {
        try { TPImport.save(meta); userTPCount++; } catch (e) {}
      }
    }
    if (window.toast) toast(`✅ Re-push : ${ccfCount} CCF · ${tpevalCount} TP-eval · ${affectCount} affect · ${userTPCount} TP user`, 'success');
    setTimeout(renderState, 1000);
  }

  /** Vide le cache des rows reçues du Sheet (eval.remote) puis relance un pull complet.
   *  Tes saisies locales (ccf.ep3.*, tpeval.*, affect.*, tp.user.*) ne sont PAS touchées.
   *  Utile quand la sync a importé partiellement (ex : bug de clé de dédoublonnage). */
  async function resetCacheAndPull() {
    if (!confirm('Vider le cache des rows reçues du Sheet et relancer une sync complète ?\n\nTes saisies locales (CCF, évals TP, affectations, TP importés) ne sont PAS supprimées.\n\nLe cache va être reconstruit depuis la Sheet. Recommandé après mise à jour.')) return;
    Store.set('eval.remote', []);
    if (window.toast) toast('🗑 Cache vidé · pull en cours…', 'info');
    if (window.Sync && Sync.pullNow) {
      await Sync.pullNow();
    }
    setTimeout(renderState, 800);
  }

  function exportAll() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('inerweb.cap-ifca.')) {
        data[k] = localStorage.getItem(k);
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dt = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `inerweb-backup-${dt}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    if (window.toast) toast(`✅ Backup ${Object.keys(data).length} clés exporté`, 'success');
  }

  function triggerImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        const txt = await f.text();
        const data = JSON.parse(txt);
        const keys = Object.keys(data);
        if (!confirm(`Importer ${keys.length} clés depuis ce fichier ? Les données existantes avec la même clé seront ÉCRASÉES.`)) return;
        keys.forEach(k => {
          if (k.startsWith('inerweb.cap-ifca.')) {
            localStorage.setItem(k, data[k]);
          }
        });
        if (window.toast) toast(`✅ ${keys.length} clés importées — recharge la page`, 'success');
        setTimeout(renderState, 500);
      } catch (e) {
        alert('❌ Erreur lecture fichier : ' + e.message);
      }
    };
    input.click();
  }

  function closeIfOpen() {
    const o = document.getElementById('syncdbg-overlay');
    if (o) o.remove();
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.SyncDebug = { open };
})();
