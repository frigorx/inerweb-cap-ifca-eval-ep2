/* ccf-ui.js — écran de saisie CCF EP3
   Rend la grille bloc par bloc, gère la saisie radio NA/EC/A/PA, calcule en temps réel.
   Cible : <section id="view-ccf"> dans index.html. */

(function() {
  'use strict';

  let bareme = null;
  let saisie = {};
  let currentEleve = null; /* idCloud */
  const DEBOUNCE_MS = 400;
  let saveTimer = null;

  async function init() {
    bareme = await CCF.load('ep3');
    if (!bareme) {
      const root = document.getElementById('ccf-root');
      if (root) root.innerHTML = '<p style="color:var(--rouge)">⚠ Barème CCF EP3 introuvable (data/ccf_ep3_bareme.json)</p>';
      return;
    }
    if (window.Correspondance && Correspondance.load) await Correspondance.load();
    renderHeader();
    renderEleveSelector();
  }

  let _elevesCache = null;
  async function eleves() {
    if (!_elevesCache) {
      const j = await Catalog.load('eleves_pseudo.json');
      _elevesCache = (j && j.eleves) || [];
    }
    const corrOk = window.Correspondance && Correspondance.available();
    return _elevesCache.map(e => {
      const realName = corrOk ? Correspondance.label(e.pseudo) : e.pseudo;
      const anonyme = realName === e.pseudo;
      return {
        idCloud: e.pseudo,
        label: anonyme ? e.pseudo : `${realName} (${e.pseudo})`
      };
    });
  }

  function renderHeader() {
    const root = document.getElementById('ccf-root');
    if (!root) return;
    root.innerHTML = `
      <div class="ccf-toolbar">
        <div class="ccf-titre">
          <strong>${bareme.epreuve}</strong> — ${bareme.intitule}
          <span class="ccf-meta">Session ${bareme.session} · ${bareme.duree_h}h · coef ${bareme.coef}</span>
        </div>
        <div class="ccf-eleve-pick">
          <label>Élève évalué</label>
          <select id="ccf-eleve"></select>
        </div>
      </div>

      <div class="ccf-note-banner" id="ccf-note-banner">
        <div class="ccf-note-big">
          <span id="ccf-note-val">—</span><span class="ccf-note-sur">/ ${bareme.ramene_sur}</span>
        </div>
        <div class="ccf-note-detail" id="ccf-note-detail">
          Sélectionne un élève et coche les niveaux pour calculer.
        </div>
        <div class="ccf-note-actions">
          <button class="btn small orange" id="ccf-mail" title="Envoyer le bilan de cet élève à ton mail" disabled>📧 Mail bilan</button>
          <button class="btn small ghost" id="ccf-reset" title="Effacer cette saisie">↺ Effacer</button>
          <button class="btn small secondary" id="ccf-print" title="Imprimer">🖨 Imprimer</button>
        </div>
      </div>

      <div class="ccf-recap-card" id="ccf-recap-card" hidden>
        <h3 class="ccf-recap-titre">📊 Détail par sous-épreuve (coef total ${bareme.coef})</h3>
        <table class="ccf-recap-table">
          <thead>
            <tr>
              <th>Sous-épreuve</th>
              <th>Points</th>
              <th>Note /20</th>
              <th>Coef</th>
              <th>Note × Coef</th>
              <th>Avancement</th>
            </tr>
          </thead>
          <tbody id="ccf-recap-tbody"></tbody>
          <tfoot>
            <tr class="ccf-recap-total">
              <td colspan="3" style="text-align:right;font-weight:700;">Note finale pondérée /20 (épreuve complète) :</td>
              <td id="ccf-recap-coeftotal">—</td>
              <td id="ccf-recap-finale" style="font-weight:700;color:var(--bleu);font-size:14pt;">—</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <p class="ccf-recap-help" id="ccf-recap-help">Tant que les 3 sous-épreuves ne sont pas saisies, la note finale est partielle (calculée sur les sous-épreuves remplies uniquement, affichée en orange).</p>
      </div>

      <div class="ccf-blocs" id="ccf-blocs"></div>
    `;
    document.getElementById('ccf-eleve').onchange = (e) => switchEleve(e.target.value);
    document.getElementById('ccf-reset').onclick = resetSaisie;
    document.getElementById('ccf-print').onclick = () => window.print();
    const btnMail = document.getElementById('ccf-mail');
    if (btnMail) btnMail.onclick = () => {
      if (currentEleve && window.CCFExport) CCFExport.mailBilanEleve(currentEleve);
    };
  }

  async function renderEleveSelector() {
    const sel = document.getElementById('ccf-eleve');
    if (!sel) return;
    const list = await eleves();
    sel.innerHTML = '<option value="">— Choisir un élève —</option>' +
      list.map(e => `<option value="${e.idCloud}">${escapeHtml(e.label)}</option>`).join('');
  }

  function switchEleve(idCloud) {
    currentEleve = idCloud || null;
    saisie = {};
    if (currentEleve) {
      const stored = CCF.get('ep3', currentEleve);
      if (stored && stored.saisie) saisie = stored.saisie;
    }
    renderBlocs();
    refreshNote();
  }

  function renderBlocs() {
    const wrap = document.getElementById('ccf-blocs');
    if (!wrap) return;
    if (!currentEleve) { wrap.innerHTML = '<p class="ccf-empty">↑ Choisis un élève pour démarrer la saisie.</p>'; return; }
    wrap.innerHTML = bareme.blocs.map(bloc => `
      <section class="ccf-bloc" style="border-left-color:${bloc.couleur}">
        <header class="ccf-bloc-hdr">
          <div>
            <strong style="color:${bloc.couleur}">Bloc ${bloc.code}</strong>
            <span class="ccf-bloc-titre">${bloc.label}</span>
          </div>
          <div class="ccf-bloc-pts" data-bloc="${bloc.code}">— / ${bloc.max} pts</div>
        </header>
        <p class="ccf-bloc-intro">${bloc.intro}</p>
        <table class="ccf-grille">
          <thead>
            <tr>
              <th class="col-id">N°</th>
              <th class="col-titre">Tâche</th>
              <th class="col-comp">Comp.</th>
              ${bareme.niveaux.map(n => `<th class="col-niv" style="color:${n.couleur}">${n.code}</th>`).join('')}
              <th class="col-pts">Pts</th>
            </tr>
          </thead>
          <tbody>
            ${bloc.taches.map(t => renderTacheRow(t)).join('')}
          </tbody>
        </table>
      </section>
    `).join('');

    /* Délégation click pour les radio-cells */
    wrap.querySelectorAll('.ccf-niv-cell').forEach(cell => {
      cell.onclick = () => {
        const tid = cell.dataset.tache;
        const niv = cell.dataset.niveau;
        if (saisie[tid] === niv) {
          delete saisie[tid]; /* clic re-clic = désélectionner */
        } else {
          saisie[tid] = niv;
        }
        markSelectedCells(tid);
        scheduleSave();
        refreshNote();
      };
    });

    /* Marquer les cellules déjà sélectionnées */
    Object.keys(saisie).forEach(tid => markSelectedCells(tid));
  }

  function renderTacheRow(t) {
    const niveauxBtns = bareme.niveaux.map((n, idx) => `
      <td class="col-niv ccf-niv-cell" data-tache="${t.id}" data-niveau="${n.code}" data-pts="${t.niveaux[idx]}" title="${n.label} — ${t.niveaux[idx]} pts">
        <span class="niv-pts">${t.niveaux[idx]}</span>
      </td>
    `).join('');
    return `
      <tr data-tache="${t.id}">
        <td class="col-id">${t.id}</td>
        <td class="col-titre">${escapeHtml(t.intitule)}</td>
        <td class="col-comp"><span class="ccf-comp-badge">${t.comp}</span></td>
        ${niveauxBtns}
        <td class="col-pts" data-pts-tache="${t.id}">— / ${t.max}</td>
      </tr>
    `;
  }

  function markSelectedCells(tid) {
    const wrap = document.getElementById('ccf-blocs');
    if (!wrap) return;
    const cells = wrap.querySelectorAll(`.ccf-niv-cell[data-tache="${CSS.escape(tid)}"]`);
    cells.forEach(c => c.classList.toggle('selected', c.dataset.niveau === saisie[tid]));
    /* Met à jour le compteur points par tâche */
    const ptsCell = wrap.querySelector(`[data-pts-tache="${CSS.escape(tid)}"]`);
    if (ptsCell) {
      const t = findTache(tid);
      if (saisie[tid]) {
        const idx = bareme.niveaux.findIndex(n => n.code === saisie[tid]);
        const pts = t.niveaux[idx];
        ptsCell.textContent = `${pts} / ${t.max}`;
        ptsCell.classList.add('done');
      } else {
        ptsCell.textContent = `— / ${t.max}`;
        ptsCell.classList.remove('done');
      }
    }
  }

  function findTache(tid) {
    for (const b of bareme.blocs) {
      const t = b.taches.find(x => x.id === tid);
      if (t) return t;
    }
    return null;
  }

  function refreshNote() {
    const r = CCF.compute(bareme, saisie);
    const aSaisie = r.totalBrut > 0;
    const seSaisies = (r.sousEpreuves || []).filter(s => s.saisi);
    const ep3Complet = seSaisies.length === (r.sousEpreuves || []).length && seSaisies.length > 0;
    /* Note grande = note pondérée officielle si tout est saisi, sinon pondérée partielle (en orange) */
    const noteAffichee = ep3Complet ? r.note20Officielle : r.note20Ponderee;
    const val = document.getElementById('ccf-note-val');
    if (val) {
      val.textContent = aSaisie ? noteAffichee.toFixed(1).replace('.', ',') : '—';
      val.style.color = aSaisie && !ep3Complet ? 'var(--orange)' : '';
    }
    /* Activer / désactiver le bouton "Mail bilan" selon qu'il y a une saisie */
    const btnMail = document.getElementById('ccf-mail');
    if (btnMail) btnMail.disabled = (Object.keys(saisie).length === 0) || !currentEleve;
    /* Détail */
    const det = document.getElementById('ccf-note-detail');
    if (det) {
      const tachesFaites = Object.keys(saisie).length;
      const tachesTot = bareme.blocs.reduce((s, b) => s + b.taches.length, 0);
      const labelNote = ep3Complet ? 'note finale officielle' : `note partielle (${seSaisies.length}/${r.sousEpreuves?.length || 3} sous-épreuves)`;
      det.innerHTML = `
        <span>${tachesFaites} / ${tachesTot} tâches notées</span>
        <span>·</span>
        <span>${r.totalBrut} pts bruts / ${r.totalMax}</span>
        <span>·</span>
        <span>${labelNote} : <strong>${aSaisie ? noteAffichee.toFixed(1).replace('.', ',') : '—'}</strong> / ${bareme.ramene_sur}</span>
      `;
    }
    /* Compteurs par bloc */
    bareme.blocs.forEach(b => {
      const el = document.querySelector(`.ccf-bloc-pts[data-bloc="${b.code}"]`);
      if (el) el.textContent = `${r.pointsParBloc[b.code] || 0} / ${b.max} pts`;
    });
    /* Tableau récap des 3 sous-épreuves */
    renderRecap(r, ep3Complet);
    /* Hook radar : appel à update si présent */
    if (window.RadarsEleve && typeof window.RadarsEleve.refreshCCF === 'function' && currentEleve) {
      try { window.RadarsEleve.refreshCCF(currentEleve, r); } catch (e) {}
    }
  }

  function renderRecap(r, ep3Complet) {
    const card = document.getElementById('ccf-recap-card');
    const tbody = document.getElementById('ccf-recap-tbody');
    const finaleEl = document.getElementById('ccf-recap-finale');
    const coeftotalEl = document.getElementById('ccf-recap-coeftotal');
    const helpEl = document.getElementById('ccf-recap-help');
    if (!card || !tbody || !r.sousEpreuves) return;
    card.hidden = false;
    tbody.innerHTML = r.sousEpreuves.map(se => {
      const pct = se.ptsMax > 0 ? Math.round((se.ptsObtenus / se.ptsMax) * 100) : 0;
      const couleurBar = se.saisi ? (se.couleur || '#1b3a63') : '#cbd5e0';
      const noteCell = se.saisi ? `<strong style="color:${se.couleur || '#1b3a63'};font-size:13pt;">${se.note20.toFixed(1).replace('.', ',')}</strong> / 20` : '<span style="color:#a0aec0;">—</span>';
      const ponderee = se.saisi ? `<strong>${se.notePondere.toFixed(2).replace('.', ',')}</strong>` : '<span style="color:#a0aec0;">—</span>';
      return `<tr>
        <td><strong style="color:${se.couleur || '#1b3a63'};">${se.code}</strong> ${escapeHtml(se.label)}<br/><span style="font-size:10pt;color:var(--text-soft);">${se.nbTachesNotees}/${se.nbTachesTot} tâches</span></td>
        <td style="text-align:center;">${se.ptsObtenus} / ${se.ptsMax}</td>
        <td style="text-align:center;">${noteCell}</td>
        <td style="text-align:center;font-weight:700;">${(se.coef || 0).toFixed(1).replace('.', ',')}</td>
        <td style="text-align:center;">${ponderee}</td>
        <td><div style="background:#edf2f7;border-radius:6px;height:14px;width:100%;overflow:hidden;"><div style="background:${couleurBar};height:100%;width:${pct}%;transition:width .3s;"></div></div><span style="font-size:10pt;color:var(--text-soft);">${pct}%</span></td>
      </tr>`;
    }).join('');
    if (coeftotalEl) coeftotalEl.textContent = (r.coefTotal || 0).toFixed(1).replace('.', ',');
    if (finaleEl) {
      const noteFinale = ep3Complet ? r.note20Officielle : r.note20Ponderee;
      const couleur = ep3Complet ? 'var(--bleu)' : 'var(--orange)';
      finaleEl.style.color = couleur;
      finaleEl.innerHTML = r.totalBrut > 0
        ? `${noteFinale.toFixed(1).replace('.', ',')} / 20${ep3Complet ? ' ✓' : ' (partielle)'}`
        : '—';
    }
    if (helpEl) {
      helpEl.textContent = ep3Complet
        ? '✓ Les 3 sous-épreuves sont saisies — note finale officielle de l\'EP3 (transmissible en CCF).'
        : `${(r.sousEpreuves || []).length - (r.sousEpreuves || []).filter(s => s.saisi).length} sous-épreuve(s) en attente — note finale en orange = moyenne pondérée des sous-épreuves déjà saisies.`;
    }
  }

  function scheduleSave() {
    if (!currentEleve) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const prof = Store.get('prof.current') || '';
      CCF.save('ep3', currentEleve, saisie, prof);
      flashSavedIndicator();
      /* Push Sheet en arrière-plan (anonymisé idCloud, jamais le vrai nom) */
      if (window.CCFExport && CCFExport.pushSheet) {
        CCFExport.pushSheet(currentEleve).catch(() => {});
      }
    }, DEBOUNCE_MS);
  }

  function flashSavedIndicator() {
    const det = document.getElementById('ccf-note-detail');
    if (!det) return;
    const tag = document.createElement('span');
    tag.className = 'saved-flash';
    tag.textContent = '💾 enregistré';
    det.appendChild(tag);
    setTimeout(() => tag.remove(), 1200);
  }

  function resetSaisie() {
    if (!currentEleve) return;
    if (!confirm('Effacer toute la saisie CCF EP3 pour cet élève ?')) return;
    saisie = {};
    CCF.remove('ep3', currentEleve);
    renderBlocs();
    refreshNote();
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Hook appelé par layout.js quand l'utilisateur arrive sur view-ccf */
  function onShown() {
    if (!bareme) init();
    else if (!document.getElementById('ccf-eleve')) renderHeader(), renderEleveSelector();
  }

  /* Refresh quand vrais noms arrivent OU sync 4 profs (autre prof a poussé) */
  ['correspondance-loaded', 'sync-merged'].forEach(ev => {
    document.addEventListener(ev, () => {
      _elevesCache = null;
      if (document.getElementById('ccf-eleve')) {
        renderEleveSelector();
        /* Si un élève est déjà sélectionné, recharger sa saisie depuis le store mergé */
        if (currentEleve) switchEleve(currentEleve);
      }
    });
  });

  window.CCFUI = { init, onShown };
  document.addEventListener('DOMContentLoaded', () => {
    /* lazy : init seulement quand la vue est ouverte */
  });
})();
