/**
 * notes-sync.js — Push des saisies de notes vers Apps Script (append-only).
 *
 * À chaque save complète d'une saisie, push une ligne SYNTHESE + N lignes détail
 * dans la feuille Notes du Sheet. Le serveur incrémente automatiquement le numéro de version.
 *
 * Stratégie :
 *   - Debounce : on attend que le prof finisse sa série de clics (2 s) avant de pousser
 *   - En cas d'échec : on garde la donnée en localStorage (déjà fait via Store), on retry plus tard
 *   - On push une "synthèse" + détail tâche par tâche (audit)
 *
 * Au chargement d'un élève : on récupère la version distante via getCurrent et on l'affiche
 * pour que le prof sache s'il a la dernière saisie.
 *
 * API publique : window.NotesSync
 */
;(function () {
  'use strict';

  var _debounceTimers = {};
  var DEBOUNCE_MS = 2000;

  /**
   * Marque une saisie comme à synchroniser. Sera poussée après debounce.
   */
  function schedulePush(eleve, epreuve, bareme, saisie) {
    if (!eleve || !epreuve || !bareme) return;
    if (!window.Api || !Api.isConfigured()) return; /* mode déconnecté, juste localStorage */

    var k = epreuve + '|' + eleve;
    if (_debounceTimers[k]) clearTimeout(_debounceTimers[k]);
    /* Fix #6: garder une snapshot pour pouvoir flush sans dépendre des refs */
    _pendingPushes[k] = { eleve: eleve, epreuve: epreuve, bareme: bareme, saisie: JSON.parse(JSON.stringify(saisie)) };
    _debounceTimers[k] = setTimeout(function() {
      var p = _pendingPushes[k];
      delete _pendingPushes[k];
      if (p) _pushNow(p.eleve, p.epreuve, p.bareme, p.saisie);
    }, DEBOUNCE_MS);
  }

  /* Fix #6: flush immédiat de tous les push en attente (appelé au switch d'élève et beforeunload) */
  function flushAll() {
    Object.keys(_debounceTimers).forEach(function(k) {
      clearTimeout(_debounceTimers[k]);
      delete _debounceTimers[k];
      var p = _pendingPushes[k];
      delete _pendingPushes[k];
      if (p) _pushNow(p.eleve, p.epreuve, p.bareme, p.saisie);
    });
  }

  /* Liste des pending pour flush */
  var _pendingPushes = {};

  /* beforeunload: si pending, tente un push sync (best effort, sendBeacon-like) */
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', function() {
      flushAll();
    });
  }

  function _pushNow(eleve, epreuve, bareme, saisie) {
    if (!window.CCF || !window.Api) return;
    var r = CCF.compute(bareme, saisie);
    var tachesDetail = [];
    bareme.blocs.forEach(function(bloc) {
      bloc.taches.forEach(function(t) {
        var niv = saisie[t.id];
        if (niv) {
          var idx = bareme.niveaux.findIndex(function(n) { return n.code === niv; });
          tachesDetail.push({
            id: t.id,
            niveau: niv,
            points: t.niveaux[idx],
            max: t.max,
            comp: t.comp
          });
        }
      });
    });

    var payload = {
      eleve: eleve,
      epreuve: epreuve,
      prof: _getCurrentProf(),
      noteFinale20: r.note20Brute,
      totalBrut: r.totalBrut,
      totalMax: r.totalMax,
      saisie: saisie,
      tachesDetail: tachesDetail
    };

    Api.call('pushNote', payload).then(function(resp) {
      if (resp && resp.ok) {
        console.log('[NotesSync] push OK', eleve, epreuve, 'v' + resp.version);
        _flashNotesSynced(resp.version);
      } else {
        console.warn('[NotesSync] échec push', resp);
      }
    }).catch(function(err) {
      console.warn('[NotesSync] erreur push', err.message);
      /* Pas de blocage — la donnée reste en localStorage */
    });
  }

  /**
   * Récupère la dernière version distante pour un élève + épreuve.
   * @returns Promise<{noteFinale20, version, prof, timestamp, saisie} | null>
   */
  function fetchCurrent(eleve, epreuve) {
    if (!window.Api || !Api.isConfigured()) return Promise.resolve(null);
    return Api.call('getCurrent', { eleve: eleve, epreuve: epreuve })
      .then(function(r) {
        if (r && r.ok) return r.current;
        return null;
      })
      .catch(function(err) {
        console.warn('[NotesSync] fetchCurrent échec', err.message);
        return null;
      });
  }

  function _getCurrentProf() {
    try {
      var c = Api.getConfig();
      return (c && c.prof) || 'FH';
    } catch (e) { return 'FH'; }
  }

  function _flashNotesSynced(version) {
    var tag = document.getElementById('saved-tag');
    if (tag) {
      tag.textContent = '☁ v' + version + ' sync';
      tag.classList.add('visible');
      setTimeout(function() { tag.classList.remove('visible'); tag.textContent = '💾 enregistré'; }, 1800);
    }
  }

  window.NotesSync = {
    schedulePush: schedulePush,
    fetchCurrent: fetchCurrent,
    flushAll: flushAll
  };
})();
