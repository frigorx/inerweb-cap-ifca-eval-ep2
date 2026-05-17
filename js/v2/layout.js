/* layout.js — refonte 4 pôles V6-style + sous-onglets
   Pôles :
     📅 Atelier      = accueil (calendrier + séance du jour + biblio TP)
     🗺 Carte        = progression (vue année)
     ✅ Évaluer      = par tâches du TP (Progression / CCF)
     📊 Élèves       = fiches individuelles (radar progression + radar CCF)
   Conserve les vues v1.9 existantes en les regroupant sous les pôles. */

(function() {
  'use strict';

  const POLES = [
    {
      id: 'atelier',
      label: '📅 Atelier',
      title: 'Atelier — séance du jour',
      tabs: [
        { view: 'calendrier',  label: '📅 Calendrier' },
        { view: 'notes-jour',  label: '📝 Notes du jour' },
        { view: 'biblio-tp',   label: '📚 Bibliothèque TP' },
        { view: 'tournant',    label: '🔁 TP-056 tournant' }
      ],
      defaultTab: 'calendrier'
    },
    {
      id: 'evaluer',
      label: '✅ Évaluer',
      title: 'Évaluation CCF EP3 + radars',
      tabs: [
        { view: 'ccf',             label: '✅ CCF EP3' },
        { view: 'ccf-radar',       label: '🎯 Radar CCF (élève)' },
        { view: 'radar-formatif',  label: '🌱 Radar formatif (élève)' },
        { view: 'radar-classe',    label: '📊 Radar classe' },
        { view: 'bulletin',        label: '🖨 Bulletin' }
      ],
      defaultTab: 'ccf'
    },
    {
      id: 'eleves',
      label: '📊 Élèves',
      title: 'Élèves — fiches individuelles',
      tabs: [
        { view: 'eleves', label: '👥 Fiches' }
      ],
      defaultTab: 'eleves'
    },
    {
      id: 'config',
      label: '⚙',
      title: 'Configuration',
      tabs: [
        { view: 'config', label: '⚙ Paramètres app' }
      ],
      defaultTab: 'config'
    }
  ];

  let currentPole = 'atelier';

  function renderPolesBar() {
    const bar = document.getElementById('poles-bar');
    if (!bar) return;
    bar.innerHTML = '';
    POLES.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'pole-btn' + (p.id === currentPole ? ' active' : '');
      btn.dataset.pole = p.id;
      btn.textContent = p.label;
      btn.onclick = () => switchPole(p.id);
      bar.appendChild(btn);
    });
  }

  function renderSubTabs() {
    const sub = document.getElementById('sub-tabs');
    const pole = POLES.find(p => p.id === currentPole);
    if (!sub || !pole) return;
    sub.innerHTML = '';
    /* Si le pôle n'a qu'un seul onglet, on cache la barre */
    if (pole.tabs.length <= 1) {
      sub.style.display = 'none';
      return;
    }
    sub.style.display = 'flex';
    pole.tabs.forEach(t => {
      const btn = document.createElement('button');
      btn.dataset.view = t.view;
      btn.textContent = t.label;
      sub.appendChild(btn);
    });
  }

  function switchPole(poleId) {
    const pole = POLES.find(p => p.id === poleId);
    if (!pole) return;
    currentPole = poleId;
    renderPolesBar();
    renderSubTabs();
    /* Affiche la vue par défaut du pôle */
    showView(pole.defaultTab);
    /* Active le bouton sous-onglet correspondant */
    const sub = document.getElementById('sub-tabs');
    if (sub) {
      sub.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.view === pole.defaultTab);
      });
    }
  }

  function showView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('visible'));
    const target = document.getElementById('view-' + viewName);
    if (target) target.classList.add('visible');
    /* Hook v2.0 : init lazy des modules quand leur vue s'ouvre */
    try {
      if (viewName === 'ccf'             && window.CCFUI          && CCFUI.onShown)          CCFUI.onShown();
      if (viewName === 'ccf-radar'       && window.CCFRadar       && CCFRadar.onShown)       CCFRadar.onShown();
      if (viewName === 'radar-formatif'  && window.RadarFormatif  && RadarFormatif.onShown)  RadarFormatif.onShown();
      if (viewName === 'radar-classe'    && window.RadarClasse    && RadarClasse.onShown)    RadarClasse.onShown();
      if (viewName === 'eleves'     && window.ClasseOverview && ClasseOverview.onShown) ClasseOverview.onShown();
      if (viewName === 'calendrier' && window.Calendrier     && Calendrier.onShown)     Calendrier.onShown();
      if (viewName === 'notes-jour' && window.NotesJour      && NotesJour.onShown)      NotesJour.onShown();
      if (viewName === 'biblio-tp'  && window.BiblioTP       && BiblioTP.onShown)       BiblioTP.onShown();
      /* Hooks legacy v1.9 : refresh des écrans Dashboard/Agenda/Radar/Bulletin */
      if (viewName === 'aujourdhui' && window.Dashboard && Dashboard.renderAujourdhui)  Dashboard.renderAujourdhui();
      if (viewName === 'progression'&& window.Dashboard && Dashboard.renderProgression) Dashboard.renderProgression();
      if (viewName === 'agenda'     && window.Agenda    && Agenda.refresh)              Agenda.refresh();
      if (viewName === 'radar'      && window.Radar     && Radar.render)                Radar.render();
      if (viewName === 'bulletin'   && window.Bulletin  && Bulletin.render)             Bulletin.render();
    } catch (e) { console.warn('[Layout] hook view error:', viewName, e); }
    /* Hook général App.onViewShown si présent */
    if (window.App && typeof window.App.onViewShown === 'function') {
      try { window.App.onViewShown(viewName); } catch (e) { console.warn(e); }
    }
  }

  /** Initialise la nav 4 pôles. Appelé après login. */
  function init() {
    /* Cache l'ancienne barre d'onglets, n'utilise plus que le double niveau */
    const oldTabs = document.getElementById('tabs');
    if (oldTabs) oldTabs.style.display = 'none';

    renderPolesBar();
    renderSubTabs();

    /* Délégation : clics sur sous-onglets */
    const sub = document.getElementById('sub-tabs');
    if (sub) {
      sub.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-view]');
        if (!btn) return;
        sub.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        showView(btn.dataset.view);
      });
    }

    /* Démarre sur le pôle Atelier > Calendrier interactif (porte d'entrée v2.0) */
    switchPole('atelier');
  }

  window.Layout = { init, switchPole, showView, POLES };
})();
