/* sync.js — synchronisation cross-poste 4 profs via Google Sheet
   Source de vérité = la Sheet (Apps Script collecteur).
   Chaque save local → push immédiat. Chaque login + polling → pull + merge.
   Conflit = last-write-wins par UpdatedAt.
*/

(function() {
  'use strict';

  let lastPullAt = 0;

  /** Lit toutes les rows du Sheet (déjà cachées par inerwebResults) et applique le merge.
   *  Doit être appelé : au login, et à chaque émission d'update via inerwebResults.onUpdate. */
  function applyMerge() {
    if (!window.inerwebResults) return { ccf: 0, tpeval: 0, affect: 0 };
    const rows = inerwebResults.getAllRows() || [];
    let ccf = 0, tpeval = 0, affect = 0;

    let userTP = 0;
    rows.forEach(row => {
      if (!row || !row.Module) return;
      try {
        if (row.Module === 'CCF-EP3') {
          if (mergeCCF(row)) ccf++;
        } else if (row.Module === 'TP-EVAL') {
          if (mergeTPEval(row)) tpeval++;
        } else if (row.Module === 'AFFECT') {
          if (mergeAffect(row)) affect++;
        } else if (row.Module === 'TP-USER') {
          if (mergeUserTP(row)) userTP++;
        }
      } catch (e) {
        console.warn('[sync] merge row', e, row);
      }
    });

    lastPullAt = Date.now();
    refreshIndicator();
    /* Notifier les vues actives pour qu'elles se redessinent */
    if (ccf || tpeval || affect) {
      try { document.dispatchEvent(new CustomEvent('sync-merged', { detail: { ccf, tpeval, affect } })); } catch (e) {}
    }
    return { ccf, tpeval, affect };
  }

  function mergeCCF(row) {
    if (!row.Pseudo || !row.SaisieJSON) return false;
    let saisie;
    try { saisie = JSON.parse(row.SaisieJSON); } catch (e) { return false; }
    if (!window.CCF) return false;
    const local = CCF.get('ep3', row.Pseudo);
    if (local && local.updatedAt && row.UpdatedAt && local.updatedAt >= row.UpdatedAt) {
      return false; /* local plus récent ou égal */
    }
    /* Merge : remplace par la version distante */
    Store.set(`ccf.ep3.${row.Pseudo}`, {
      idCloud: row.Pseudo,
      saisie,
      signataire: row.Evaluateur || '',
      updatedAt: row.UpdatedAt || new Date().toISOString()
    });
    return true;
  }

  function mergeTPEval(row) {
    if (!row.Pseudo || !row.TpId) return false;
    let comp = {};
    if (row.CompJSON) {
      try { comp = JSON.parse(row.CompJSON); } catch (e) {}
    }
    const localKey = `tpeval.${row.TpId}.${row.Pseudo}`;
    const local = Store.get(localKey);
    if (local && local.updatedAt && row.UpdatedAt && local.updatedAt >= row.UpdatedAt) {
      return false;
    }
    Store.set(localKey, {
      pseudo: row.Pseudo,
      tpId: row.TpId,
      comp,
      commentaire: row.Commentaire || '',
      date: row.DateExec || null,
      evaluateur: row.Evaluateur || '',
      updatedAt: row.UpdatedAt || new Date().toISOString()
    });
    return true;
  }

  function mergeUserTP(row) {
    if (!row.TpId) return false;
    const localKey = `tp.user.${row.TpId}`;
    const local = Store.get(localKey);
    if (local && local.updatedAt && row.UpdatedAt && local.updatedAt >= row.UpdatedAt) {
      return false;
    }
    let comp = [];
    if (row.CompJSON) {
      try { comp = JSON.parse(row.CompJSON); } catch (e) {}
    }
    /* On garde le dataUrl local s'il existe (le contenu reste local au poste qui l'a importé) */
    Store.set(localKey, Object.assign({}, local || {}, {
      id: row.TpId,
      titre: row.Titre || (local && local.titre) || row.TpId,
      semaine: row.Semaine || (local && local.semaine) || 'S-',
      duree: row.Duree || (local && local.duree) || '?',
      comp,
      importPar: row.ImportPar || '',
      tailleKo: row.TailleKo || (local && local.tailleKo) || 0,
      typeFichier: row.TypeFichier || (local && local.typeFichier) || '',
      isUser: true,
      updatedAt: row.UpdatedAt || new Date().toISOString()
      /* dataUrl conservé tel quel s'il était présent en local */
    }));
    return true;
  }

  function mergeAffect(row) {
    if (!row.Pseudo || !row.TpId) return false;
    const localKey = `affect.${row.TpId}.${row.Pseudo}`;
    const local = Store.get(localKey);
    /* Pas d'updatedAt pour l'affect → on prend si distant a un statut "plus avancé" */
    const cycle = ['todo', 'encours', 'fait', 'valide'];
    const localIdx = local ? cycle.indexOf(local.statut) : -1;
    const remoteIdx = cycle.indexOf(row.Statut);
    if (local && local.updatedAt && row.UpdatedAt && local.updatedAt >= row.UpdatedAt && localIdx >= remoteIdx) {
      return false;
    }
    Store.set(localKey, {
      pseudo: row.Pseudo,
      tpId: row.TpId,
      statut: row.Statut || 'encours',
      distribueLe: row.DistribueLe || null,
      dateExecution: row.DateExecution || null,
      seanceId: row.SeanceId || null,
      distribuePar: row.DistribuePar || row.Evaluateur || '',
      updatedAt: row.UpdatedAt || new Date().toISOString()
    });
    return true;
  }

  /** Push d'une saisie TPEval. Appelé par TPEval.set après chaque modif. */
  function pushTPEval(pseudo, tpId, data) {
    if (!window.inerwebResults) return Promise.resolve({ ok: false });
    const row = {
      Module: 'TP-EVAL',
      Pseudo: pseudo,
      TpId: tpId,
      CompJSON: JSON.stringify(data.comp || {}),
      Commentaire: data.commentaire || '',
      DateExec: data.date || '',
      Evaluateur: data.evaluateur || (Store.get('prof.current') || ''),
      UpdatedAt: data.updatedAt || new Date().toISOString()
    };
    return inerwebResults.write(row);
  }

  /** Push d'une affectation. Appelé par Affectations.set. */
  function pushAffect(pseudo, tpId, data) {
    if (!window.inerwebResults) return Promise.resolve({ ok: false });
    const row = {
      Module: 'AFFECT',
      Pseudo: pseudo,
      TpId: tpId,
      Statut: data.statut || 'encours',
      DistribueLe: data.distribueLe || '',
      DateExecution: data.dateExecution || '',
      SeanceId: data.seanceId || '',
      DistribuePar: data.distribuePar || (Store.get('prof.current') || ''),
      Evaluateur: Store.get('prof.current') || '',
      UpdatedAt: new Date().toISOString()
    };
    return inerwebResults.write(row);
  }

  /** Force une lecture immédiate de la Sheet + merge. */
  async function pullNow() {
    if (!window.inerwebResults) return null;
    refreshIndicator('pulling');
    await inerwebResults.read();
    const r = applyMerge();
    refreshIndicator();
    if (window.toast) toast(`✅ Sync OK · ${r.ccf} CCF · ${r.tpeval} évals TP · ${r.affect} TP distribués`, 'success');
    /* Refresh des vues affichées */
    if (window.ClasseOverview && ClasseOverview.render) ClasseOverview.render();
    if (window.Calendrier && Calendrier.render)         Calendrier.render();
    if (window.CCFUI && CCFUI.onShown)                  CCFUI.onShown();
    return r;
  }

  function refreshIndicator(state) {
    const el = document.getElementById('sync-badge');
    if (!el) return;
    const ic = el.querySelector('.icon');
    const lb = document.getElementById('sync-label');
    const buf = (window.inerwebResults && inerwebResults.bufferCount()) || 0;
    if (state === 'pulling') {
      el.className = 'sync-badge sync';
      if (ic) ic.textContent = '🔄';
      if (lb) lb.textContent = 'Sync…';
    } else if (buf > 0) {
      el.className = 'sync-badge buffer';
      if (ic) ic.textContent = '🟡';
      if (lb) lb.textContent = `Buffer (${buf})`;
    } else {
      el.className = 'sync-badge sync';
      if (ic) ic.textContent = '🟢';
      const dt = lastPullAt > 0 ? new Date(lastPullAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
      if (lb) lb.textContent = dt ? `Sync ${dt}` : 'Sync';
    }
  }

  /** Initialisation : à appeler après login.
   *  - Lance le polling inerwebResults
   *  - Branche le merge à chaque update du polling
   *  - Fait un pull immédiat */
  function init() {
    if (!window.inerwebResults) return;
    inerwebResults.onUpdate(() => {
      applyMerge();
    });
    /* Ne PAS doubler le polling : inerwebResults.startPolling() est déjà appelé par App.onLogin.
       On s'abonne seulement, on déclenche une lecture explicite. */
    pullNow();
    /* Indicateur ré-actualisé toutes les 30s même sans nouvelle data */
    setInterval(refreshIndicator, 30000);
  }

  window.Sync = { init, pullNow, applyMerge, pushTPEval, pushAffect };
})();
