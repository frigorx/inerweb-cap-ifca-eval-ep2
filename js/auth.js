/* auth.js — écran login prof + persistence */

(function() {
  'use strict';

  /** Affiche le statut bandeau prof avec bouton actionnable si correspondance non chargée. */
  function renderBannerStatus(el) {
    if (!el) return;
    const corrOk = window.Correspondance && Correspondance.available();
    if (corrOk) {
      el.innerHTML = '<span style="color:#38a169;font-weight:700">🔒 24 élèves chargés (vrais noms visibles)</span>';
    } else {
      el.innerHTML = `
        <span style="color:#dd6b20;font-weight:700">⚠ Tu vois M01..M24 (codes anonymes)</span>
        <button id="banner-unlock-btn" class="banner-action-btn">🔓 Voir les vrais noms</button>
      `;
      const btn = document.getElementById('banner-unlock-btn');
      if (btn) btn.onclick = bannerUnlock;
    }
  }

  function bannerUnlock() {
    const pwd = prompt('Mot de passe pédagogique (donné par F. Henninot) pour voir les noms des 24 élèves :');
    if (!pwd) return;
    Correspondance.unlock(pwd).then(() => {
      window.toast && window.toast('✅ 24 élèves chargés', 'success');
      const status = document.getElementById('prof-banner-status');
      renderBannerStatus(status);
      /* L'event 'correspondance-loaded' est dispatché par Correspondance.unlock,
         tous les modules abonnés (Tournant, ClasseOverview, CCFUI, CCFRadar...) refresh tout seuls. */
    }).catch(() => {
      window.toast && window.toast('❌ Mot de passe incorrect', 'error');
    });
  }

  function renderProfs() {
    const grid = document.getElementById('profs-grid');
    grid.innerHTML = '';
    PROFS.forEach(p => {
      const btn = document.createElement('div');
      btn.className = 'prof-choice';
      btn.dataset.code = p.code;
      btn.innerHTML = `
        <div class="initials" style="color:${p.couleur}">${p.code}</div>
        <div class="full-name">${p.nom}</div>`;
      btn.onclick = () => {
        grid.querySelectorAll('.prof-choice').forEach(x => x.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('btn-login').dataset.profCode = p.code;
      };
      grid.appendChild(btn);
    });
  }

  async function login() {
    const code = document.getElementById('btn-login').dataset.profCode;
    const ical = document.getElementById('ical-url').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const err = document.getElementById('login-error');
    if (!code) {
      err.textContent = 'Sélectionner un enseignant.';
      return;
    }
    err.textContent = '';

    // Tenter le déverrouillage si mot de passe saisi
    if (password) {
      err.textContent = 'Déverrouillage de la liste élèves…';
      try {
        await Correspondance.unlock(password);
        err.style.color = 'var(--vert)';
        err.textContent = '✅ 24 élèves chargés';
      } catch (e) {
        err.style.color = 'var(--rouge)';
        err.textContent = '❌ Mot de passe incorrect';
        return;
      }
    }

    Store.set('prof.current', code);
    if (ical) Store.set(`ical.url.${code}`, ical);
    showApp(code);
  }

  function showApp(code) {
    const prof = PROFS.find(p => p.code === code);
    if (!prof) return;
    document.getElementById('view-login').classList.remove('visible');
    /* v1.9 : badge + ancienne barre d'onglets — conservés mais cachés */
    document.getElementById('tabs').hidden = true;
    document.getElementById('prof-badge').hidden = true;
    /* v2.0 : barre 4 pôles + bandeau prof */
    const polesBar = document.getElementById('poles-bar');
    const subTabs  = document.getElementById('sub-tabs');
    const banner   = document.getElementById('prof-banner');
    if (polesBar) polesBar.hidden = false;
    if (subTabs)  subTabs.hidden  = false;
    if (banner) {
      banner.hidden = false;
      const pill = document.getElementById('prof-banner-pill');
      const name = document.getElementById('prof-banner-name');
      const status = document.getElementById('prof-banner-status');
      if (pill) { pill.textContent = prof.code; pill.style.background = prof.couleur; }
      if (name) {
        const me = window.ProfMe && ProfMe.get(code);
        const fullName = me && me.prenom && me.nom ? `${me.prenom} ${me.nom}` : prof.nom;
        name.textContent = fullName;
      }
      if (status) {
        renderBannerStatus(status);
      }
    }

    /* Init nav 4 pôles */
    if (window.Layout && Layout.init) Layout.init();

    /* Profil incomplet → forcer écran paramètres au 1er passage */
    if (window.ProfMe && !ProfMe.isComplete(code)) {
      window.showProfileScreen(code, {
        canCancel: false,
        onSaved: () => {
          /* Refresh bandeau après save */
          const me = ProfMe.get(code);
          const name = document.getElementById('prof-banner-name');
          if (name && me && me.prenom && me.nom) name.textContent = `${me.prenom} ${me.nom}`;
          const status = document.getElementById('prof-banner-status');
          if (status) status.textContent = '🔒 Profil OK · ' + (Correspondance && Correspondance.available() ? '🔒 Élèves déchiffrés' : '🔓 Mode pseudonymes');
        }
      });
    }

    if (window.App && App.onLogin) App.onLogin(code);
  }

  function logout() {
    Store.remove('prof.current');
    location.reload();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    /* Attendre la liste profs chargée depuis data/profs.json (sinon fallback hardcodé) */
    if (window.PROFS_READY) { try { await PROFS_READY; } catch (e) {} }
    renderProfs();
    document.getElementById('btn-login').onclick = login;
    document.getElementById('btn-logout').onclick = logout;
    /* v2.0 : bandeau (changer de prof + modifier paramètres) */
    const btnBannerLogout = document.getElementById('btn-banner-logout');
    if (btnBannerLogout) btnBannerLogout.onclick = logout;
    const btnProfileEdit = document.getElementById('btn-profile-edit');
    if (btnProfileEdit) btnProfileEdit.onclick = () => {
      const cur = Store.get('prof.current');
      if (cur && window.showProfileScreen) window.showProfileScreen(cur, { canCancel: true });
    };
    /* Distribuer un TP — accessible partout depuis le bandeau prof */
    const btnBanDist = document.getElementById('btn-banner-distribute');
    if (btnBanDist) btnBanDist.onclick = () => {
      if (window.DistributeModal && DistributeModal.open) DistributeModal.open();
    };
    /* Forcer la sync 4 profs via Google Sheet */
    const btnBanSync = document.getElementById('btn-banner-sync');
    if (btnBanSync) btnBanSync.onclick = () => {
      if (window.Sync && Sync.pullNow) Sync.pullNow();
    };
    /* Panneau diagnostic + backup/restore manuel */
    const btnBanDbg = document.getElementById('btn-banner-debug');
    if (btnBanDbg) btnBanDbg.onclick = () => {
      if (window.SyncDebug && SyncDebug.open) SyncDebug.open();
    };
    document.getElementById('ical-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    document.getElementById('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    // Auto-login si déjà connecté
    const cur = Store.get('prof.current');
    if (cur) {
      const ic = Store.get(`ical.url.${cur}`, '');
      if (ic) document.getElementById('ical-url').value = ic;
      // Pré-sélectionne le bouton mais reste sur l'écran login si on veut changer
      document.querySelector(`.prof-choice[data-code="${cur}"]`)?.classList.add('selected');
      document.getElementById('btn-login').dataset.profCode = cur;
      // Auto-bascule directement sans forcer reclick
      showApp(cur);
    }
  });

  window.Auth = { login, logout, showApp };

})();
