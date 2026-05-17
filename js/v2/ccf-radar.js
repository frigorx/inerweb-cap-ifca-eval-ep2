/* ccf-radar.js — toile d'araignée CCF EP3 par élève
   Lit les saisies CCF stockées localement, affiche un radar Chart.js
   par compétence (niveau moyen 0..3). */

(function() {
  'use strict';

  let chart = null;
  let bareme = null;
  let selectedEleve = null; /* préserve la sélection à travers les re-renders */

  async function init() {
    bareme = await CCF.load('ep3');
    if (!bareme) return;
    if (window.Correspondance && Correspondance.load) await Correspondance.load();
    renderShell();
    populateSelector();
  }

  function renderShell() {
    const root = document.getElementById('ccf-radar-root');
    if (!root) return;
    root.innerHTML = `
      <div class="ccf-radar-header">
        <div>
          <label>Élève</label>
          <select id="ccf-radar-eleve"></select>
        </div>
        <div class="ccf-radar-note">
          <span class="lab">Note CCF</span>
          <span class="big" id="ccf-radar-note">—</span>
          <span class="sur">/ 20</span>
        </div>
        <div class="ccf-radar-progress">
          <span class="lab">Tâches notées</span>
          <span class="big" id="ccf-radar-tot">0 / 0</span>
        </div>
        <div class="ccf-radar-actions">
          <button class="btn small orange" id="ccf-radar-mail" disabled title="Envoyer le bilan de cet élève à ton mail">📧 Mail bilan</button>
        </div>
      </div>
      <div class="ccf-radar-canvas-wrap">
        <canvas id="ccf-radar-canvas"></canvas>
      </div>
      <div class="ccf-radar-legend" id="ccf-radar-legend"></div>
    `;
    const selEl = document.getElementById('ccf-radar-eleve');
    selEl.onchange = (e) => {
      selectedEleve = e.target.value || null;
      updateRadar(selectedEleve);
    };
    /* Restaure si on revenait dessus après un sync-merged */
    if (selectedEleve) {
      selEl.value = selectedEleve;
      updateRadar(selectedEleve);
    }
    const btnMail = document.getElementById('ccf-radar-mail');
    if (btnMail) btnMail.onclick = () => {
      if (selectedEleve && window.CCFExport) CCFExport.mailBilanEleve(selectedEleve);
    };
  }

  /** Permet à un autre module d'ouvrir le radar avec un élève pré-sélectionné. */
  function openWithEleve(pseudo) {
    selectedEleve = pseudo;
    if (window.Layout && Layout.switchPole) {
      Layout.switchPole('evaluer');
      setTimeout(() => {
        const sub = document.getElementById('sub-tabs');
        const btn = sub && sub.querySelector('button[data-view="ccf-radar"]');
        if (btn) btn.click();
      }, 100);
    }
  }

  let _elevesCache = null;
  async function eleveOptions() {
    if (!_elevesCache) {
      const j = await Catalog.load('eleves_pseudo.json');
      _elevesCache = (j && j.eleves) || [];
    }
    const corrOk = window.Correspondance && Correspondance.available();
    return _elevesCache.map(e => {
      const realName = corrOk ? Correspondance.label(e.pseudo) : e.pseudo;
      return {
        id: e.pseudo,
        label: realName === e.pseudo ? e.pseudo : `${realName} (${e.pseudo})`
      };
    });
  }

  async function populateSelector() {
    const sel = document.getElementById('ccf-radar-eleve');
    if (!sel) return;
    const opts = await eleveOptions();
    sel.innerHTML = '<option value="">— Choisir un élève —</option>' +
      opts.map(o => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('');
  }

  function updateRadar(idCloud) {
    const noteEl = document.getElementById('ccf-radar-note');
    const totEl  = document.getElementById('ccf-radar-tot');
    const legend = document.getElementById('ccf-radar-legend');
    const canvas = document.getElementById('ccf-radar-canvas');
    if (!canvas) return;

    if (!idCloud) {
      if (chart) { chart.destroy(); chart = null; }
      if (noteEl) noteEl.textContent = '—';
      if (totEl)  totEl.textContent = '0 / 0';
      if (legend) legend.innerHTML = '';
      return;
    }

    const stored = CCF.get('ep3', idCloud);
    const saisie = (stored && stored.saisie) || {};
    const r = CCF.compute(bareme, saisie);
    const tachesTot = bareme.blocs.reduce((s, b) => s + b.taches.length, 0);
    const tachesFaites = Object.keys(saisie).length;

    if (noteEl) noteEl.textContent = tachesFaites > 0 ? r.note20.toFixed(1).replace('.', ',') : '—';
    if (totEl)  totEl.textContent  = `${tachesFaites} / ${tachesTot}`;
    const btnMail = document.getElementById('ccf-radar-mail');
    if (btnMail) btnMail.disabled = tachesFaites === 0;

    /* Données radar : 1 axe par compétence du barème */
    const compsKeys = Object.keys(bareme.competences);
    const labels = compsKeys.map(c => c);
    const niveauxData = compsKeys.map(c => {
      const v = r.niveauMoyenParComp[c];
      return v == null ? 0 : v; /* 0..3 */
    });

    if (chart) chart.destroy();
    chart = new Chart(canvas.getContext('2d'), {
      type: 'radar',
      data: {
        labels,
        datasets: [{
          label: `CCF EP3 — niveau moyen par compétence`,
          data: niveauxData,
          backgroundColor: 'rgba(27, 58, 99, 0.18)',
          borderColor: '#1b3a63',
          borderWidth: 2,
          pointBackgroundColor: '#ff6b35',
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            min: 0,
            max: 3,
            ticks: {
              stepSize: 1,
              callback: (v) => ['NA', 'EC', 'A', 'PA'][v] || v,
              backdropColor: 'rgba(255,255,255,0.7)',
              font: { size: 12 }
            },
            pointLabels: { font: { size: 13, weight: 'bold' } },
            grid: { color: 'rgba(0,0,0,0.1)' }
          }
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const c = compsKeys[ctx.dataIndex];
                const lab = bareme.competences[c];
                const niv = ctx.raw;
                const code = ['NA', 'EC', 'A', 'PA'][Math.round(niv)] || '—';
                return `${c} — ${lab}: ${niv.toFixed(2)} (${code})`;
              }
            }
          }
        }
      }
    });

    /* Légende détaillée des compétences */
    if (legend) {
      legend.innerHTML = compsKeys.map(c => {
        const v = r.niveauMoyenParComp[c];
        const code = (v == null) ? '—' : ['NA', 'EC', 'A', 'PA'][Math.round(v)];
        const cls = (v == null) ? 'na' : ['lvl-na', 'lvl-ec', 'lvl-a', 'lvl-pa'][Math.round(v)];
        return `<div class="legend-item ${cls}"><strong>${c}</strong> ${escapeHtml(bareme.competences[c])} <span class="lvl-tag">${code}</span></div>`;
      }).join('');
    }
  }

  function refreshCCF(idCloud) {
    /* Hook appelé par ccf-ui.js après chaque modif — si l'écran radar est visible, on re-render */
    if (document.getElementById('ccf-radar-canvas')) updateRadar(idCloud);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function onShown() {
    if (!bareme) init();
    else { renderShell(); populateSelector(); }
  }

  /* Refresh quand vrais noms arrivent OU sync 4 profs */
  ['correspondance-loaded', 'sync-merged'].forEach(ev => {
    document.addEventListener(ev, () => {
      _elevesCache = null;
      if (document.getElementById('ccf-radar-eleve')) {
        populateSelector();
        const sel = document.getElementById('ccf-radar-eleve');
        if (sel && sel.value) updateRadar(sel.value);
      }
    });
  });

  window.CCFRadar = { init, onShown, refreshCCF, openWithEleve };
  /* Compat : alias pour le hook depuis ccf-ui.js */
  window.RadarsEleve = window.RadarsEleve || {};
  window.RadarsEleve.refreshCCF = (idCloud) => refreshCCF(idCloud);
})();
