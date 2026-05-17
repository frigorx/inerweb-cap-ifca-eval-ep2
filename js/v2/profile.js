/* profile.js — paramètres locaux de chaque prof
   Stockés en localStorage de SON navigateur uniquement.
   Jamais commités, jamais envoyés au cloud, jamais transmis aux autres profs. */

(function() {
  'use strict';

  const KEY = (code) => `prof.me.${code}`;

  const ProfMe = {
    /** Retourne le profil local (saisi par CE prof sur CE poste). null si pas encore saisi. */
    get(code) {
      if (!code) return null;
      return Store.get(KEY(code));
    },
    /** Sauvegarde / met à jour le profil local. */
    save(code, data) {
      const clean = {
        code: code,
        prenom: (data.prenom || '').trim(),
        nom: (data.nom || '').trim(),
        mailCCF: (data.mailCCF || '').trim(),
        edLogin: (data.edLogin || '').trim(),
        edPassword: (data.edPassword || ''),
        updatedAt: new Date().toISOString()
      };
      Store.set(KEY(code), clean);
      return clean;
    },
    /** Profil renseigné = mailCCF présent (le minimum vital). */
    isComplete(code) {
      const me = this.get(code);
      return !!(me && me.mailCCF);
    },
    /** Wipe local — bouton Config "Effacer mes paramètres". */
    clear(code) {
      Store.remove(KEY(code));
    }
  };

  /** Affiche l'écran "Mes paramètres". Appelé si profil incomplet OU sur demande explicite. */
  function showProfileScreen(code, opts = {}) {
    const prof = (window.PROFS || []).find(p => p.code === code);
    if (!prof) return;
    const me = ProfMe.get(code) || {};
    const overlay = document.createElement('div');
    overlay.id = 'profile-overlay';
    overlay.className = 'profile-overlay';
    overlay.innerHTML = `
      <div class="profile-card">
        <header>
          <span class="prof-pill" style="background:${prof.couleur}">${prof.code}</span>
          <h2>Mes paramètres</h2>
          ${opts.canCancel ? '<button class="btn-x" id="profile-x" title="Fermer">×</button>' : ''}
        </header>
        <p class="profile-intro">
          Ces informations restent <strong>uniquement sur ce navigateur</strong>.
          Elles ne sont jamais envoyées au cloud, jamais partagées avec les autres profs.
          Tu peux les modifier à tout moment depuis ⚙ Config.
        </p>

        <div class="profile-row">
          <label>Prénom</label>
          <input type="text" id="me-prenom" value="${escapeAttr(me.prenom || prof.prenom || '')}" placeholder="Marie" autocomplete="given-name" />
        </div>
        <div class="profile-row">
          <label>Nom</label>
          <input type="text" id="me-nom" value="${escapeAttr(me.nom || '')}" placeholder="Dupont" autocomplete="family-name" />
        </div>

        <h3>📧 Mail destinataire des bilans CCF <span class="req">*</span></h3>
        <p class="profile-hint">
          C'est à <strong>cette adresse</strong> que t'arriveront les bilans CCF de tes élèves.
          Les notes ne partent PAS dans École Directe — uniquement à toi par mail.
        </p>
        <div class="profile-row">
          <input type="email" id="me-mail" value="${escapeAttr(me.mailCCF || '')}" placeholder="ton.mail@etablissement.fr" autocomplete="email" required />
        </div>

        <h3>🏫 École Directe (optionnel — pour pousser le cahier de texte)</h3>
        <p class="profile-hint">
          Si tu veux que l'app pousse les contenus de séance dans <strong>ton</strong> cahier de texte ED.
          Sinon laisse vide : tu auras un export CSV à importer manuellement.
        </p>
        <div class="profile-row">
          <label>Identifiant ED</label>
          <input type="text" id="me-ed-login" value="${escapeAttr(me.edLogin || '')}" placeholder="prenom.nom" autocomplete="off" />
        </div>
        <div class="profile-row">
          <label>Mot de passe ED</label>
          <input type="password" id="me-ed-pwd" value="${escapeAttr(me.edPassword || '')}" placeholder="••••••••" autocomplete="off" />
        </div>

        <div class="profile-actions">
          <button class="btn orange" id="profile-save">💾 Enregistrer sur ce poste</button>
          <span id="profile-status"></span>
        </div>

        <p class="profile-rgpd">
          🔒 RGPD — Tes paramètres ED sont stockés en <code>localStorage</code> de ce navigateur.
          Bouton "Effacer" disponible dans Config. Aucune fuite vers le serveur GitHub Pages.
        </p>
      </div>
    `;
    document.body.appendChild(overlay);

    const closeOverlay = () => {
      const el = document.getElementById('profile-overlay');
      if (el) el.remove();
    };

    const xBtn = document.getElementById('profile-x');
    if (xBtn) xBtn.onclick = closeOverlay;

    document.getElementById('profile-save').onclick = () => {
      const data = {
        prenom: document.getElementById('me-prenom').value,
        nom:    document.getElementById('me-nom').value,
        mailCCF: document.getElementById('me-mail').value,
        edLogin: document.getElementById('me-ed-login').value,
        edPassword: document.getElementById('me-ed-pwd').value
      };
      if (!data.mailCCF) {
        document.getElementById('profile-status').textContent = '⚠ Mail CCF obligatoire';
        document.getElementById('profile-status').style.color = 'var(--rouge)';
        return;
      }
      ProfMe.save(code, data);
      document.getElementById('profile-status').textContent = '✅ Enregistré';
      document.getElementById('profile-status').style.color = 'var(--vert)';
      setTimeout(() => {
        closeOverlay();
        if (typeof opts.onSaved === 'function') opts.onSaved();
      }, 600);
    };
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  window.ProfMe = ProfMe;
  window.showProfileScreen = showProfileScreen;
})();
