/* ccf-export.js — J3 : envoi mail CCF + export CSV ED + push Sheet
   - mailBilanEleve(idCloud)    : ouvre mailto: prêt à envoyer pour 1 élève
   - mailBilanClasse()          : mailto: avec tableau complet de la classe
   - exportCSV()                : télécharge un CSV format compatible ED (anonymisé)
   - pushSheet(idCloud)         : POST vers Apps Script (déjà exposé via inerwebResults)
*/

(function() {
  'use strict';

  let _bareme = null;
  let _eleves = null;

  async function ensureLoaded() {
    if (!_bareme) _bareme = await CCF.load('ep3');
    if (!_eleves) {
      const j = await Catalog.load('eleves_pseudo.json');
      _eleves = (j && j.eleves) || [];
    }
  }

  function profMail() {
    const code = Store.get('prof.current');
    const me = window.ProfMe && ProfMe.get(code);
    return (me && me.mailCCF) || '';
  }

  function profIdentite() {
    const code = Store.get('prof.current');
    const me = window.ProfMe && ProfMe.get(code);
    if (me && me.prenom && me.nom) return `${me.prenom} ${me.nom} (${code})`;
    return code || '—';
  }

  function fmtNote(r) {
    if (!r || r.totalBrut === 0) return '—';
    return r.note20.toFixed(1).replace('.', ',');
  }

  function dateNowFR() {
    const d = new Date();
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /* ============ MAIL : bilan d'UN élève ============ */
  async function mailBilanEleve(idCloud) {
    await ensureLoaded();
    const mail = profMail();
    if (!mail) {
      alert('Renseigne d\'abord ton mail CCF dans ✎ Mes paramètres.');
      return;
    }
    const stored = CCF.get('ep3', idCloud);
    const saisie = (stored && stored.saisie) || {};
    const r = CCF.compute(_bareme, saisie);
    const tot = _bareme.blocs.reduce((s, b) => s + b.taches.length, 0);
    const fait = Object.keys(saisie).length;

    /* Bilan par bloc */
    const blocsTxt = _bareme.blocs.map(b =>
      `  Bloc ${b.code} ${b.label.padEnd(34)} ${(r.pointsParBloc[b.code] || 0).toString().padStart(3)} / ${b.max} pts`
    ).join('\n');

    /* Bilan par compétence (niveau moyen) */
    const compsKeys = Object.keys(_bareme.competences);
    const compsTxt = compsKeys.map(c => {
      const v = r.niveauMoyenParComp[c];
      const code = (v == null) ? '—' : ['NA', 'EC', 'A', 'PA'][Math.round(v)];
      return `  ${c.padEnd(6)} ${_bareme.competences[c].padEnd(38)} ${code}`;
    }).join('\n');

    const subject = `[CCF EP3 ${dateNowFR()}] Bilan ${idCloud} — note ${fmtNote(r)}/20`;
    const body = [
      `Bilan CCF EP3 — CAP IFCA`,
      `LP Privé Jacques Raynaud · Campus ÉQUATIO`,
      ``,
      `Élève     : ${idCloud}  (pseudo)`,
      `Évaluateur: ${profIdentite()}`,
      `Date      : ${dateNowFR()}`,
      ``,
      `─── NOTE FINALE ───────────────────────────────────`,
      `   ${fmtNote(r)} / 20    (${r.totalBrut} pts bruts / 280 · ${fait}/${tot} tâches)`,
      ``,
      `─── DÉTAIL PAR BLOC ───────────────────────────────`,
      blocsTxt,
      ``,
      `─── NIVEAU PAR COMPÉTENCE ─────────────────────────`,
      compsTxt,
      ``,
      `─── RGPD ──────────────────────────────────────────`,
      `Données pseudonymisées (idCloud ${idCloud}). Le vrai nom`,
      `de l'élève n'est pas transmis dans ce mail.`,
      ``,
      `--`,
      `inerWeb Eval CAP IFCA · v2.0`,
    ].join('\n');

    location.href = `mailto:${encodeURIComponent(mail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  /* ============ MAIL : bilan COMPLET classe ============ */
  async function mailBilanClasse() {
    await ensureLoaded();
    const mail = profMail();
    if (!mail) {
      alert('Renseigne d\'abord ton mail CCF dans ✎ Mes paramètres.');
      return;
    }
    const tot = _bareme.blocs.reduce((s, b) => s + b.taches.length, 0);
    const lignes = _eleves.map(e => {
      const stored = CCF.get('ep3', e.pseudo);
      const saisie = (stored && stored.saisie) || {};
      const r = CCF.compute(_bareme, saisie);
      const fait = Object.keys(saisie).length;
      return `  ${e.pseudo.padEnd(14)} ${fmtNote(r).padStart(5)}/20  ${fait.toString().padStart(2)}/${tot} tâches  (${r.totalBrut}/280 pts)`;
    }).join('\n');

    /* Stats classe */
    const evalues = _eleves.filter(e => {
      const s = CCF.get('ep3', e.pseudo);
      return s && Object.keys(s.saisie || {}).length > 0;
    });
    const moy = evalues.length > 0
      ? (evalues.reduce((s, e) => s + CCF.compute(_bareme, CCF.get('ep3', e.pseudo).saisie).note20, 0) / evalues.length)
      : null;

    const subject = `[CCF EP3 ${dateNowFR()}] Bilan classe CAP IFCA 2 — ${evalues.length}/${_eleves.length} évalués`;
    const body = [
      `Bilan CCF EP3 — CAP IFCA 2 (classe complète)`,
      `LP Privé Jacques Raynaud · Campus ÉQUATIO`,
      ``,
      `Évaluateur: ${profIdentite()}`,
      `Date      : ${dateNowFR()}`,
      `Effectif  : ${_eleves.length}`,
      `Évalués   : ${evalues.length}`,
      `Moyenne   : ${moy != null ? moy.toFixed(2).replace('.', ',') : '—'} / 20`,
      ``,
      `─── DÉTAIL PAR ÉLÈVE (pseudonymisé) ───────────────`,
      lignes,
      ``,
      `─── RGPD ──────────────────────────────────────────`,
      `Données pseudonymisées. Aucun vrai prénom dans ce mail.`,
      ``,
      `--`,
      `inerWeb Eval CAP IFCA · v2.0`,
    ].join('\n');

    location.href = `mailto:${encodeURIComponent(mail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  /* ============ CSV — format compatible import ED ============ */
  async function exportCSV() {
    await ensureLoaded();
    const lignes = ['Pseudo;Note20;TotalBrut;TachesNotees;TachesTotal;Date;Evaluateur'];
    const tot = _bareme.blocs.reduce((s, b) => s + b.taches.length, 0);
    const dt = new Date().toISOString().slice(0, 10);
    const ev = profIdentite().replace(/;/g, ',');
    _eleves.forEach(e => {
      const stored = CCF.get('ep3', e.pseudo);
      const saisie = (stored && stored.saisie) || {};
      const r = CCF.compute(_bareme, saisie);
      const fait = Object.keys(saisie).length;
      lignes.push(`${e.pseudo};${fmtNote(r).replace('—', '')};${r.totalBrut};${fait};${tot};${dt};${ev}`);
    });
    const csv = lignes.join('\r\n');
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bilan_ccf_ep3_${dt}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    window.toast && window.toast(`✅ ${_eleves.length} lignes exportées`, 'success');
  }

  /* ============ Push complet vers Sheet (sync 4 profs) ============
   * Envoie la saisie ENTIÈRE en JSON pour permettre la reconstitution
   * sur n'importe quel poste après pull. */
  async function pushSheet(idCloud) {
    await ensureLoaded();
    if (!window.inerwebResults) return { ok: false, reason: 'inerwebResults indisponible' };
    const stored = CCF.get('ep3', idCloud);
    if (!stored) return { ok: false, reason: 'pas de saisie' };
    const r = CCF.compute(_bareme, stored.saisie || {});
    const row = {
      Module: 'CCF-EP3',
      Pseudo: idCloud,
      SaisieJSON: JSON.stringify(stored.saisie || {}),  /* clé : permet le pull */
      Note20: fmtNote(r).replace('—', '0'),
      TotalBrut: r.totalBrut,
      TachesNotees: Object.keys(stored.saisie || {}).length,
      Bloc0: r.pointsParBloc['0'] || 0,
      BlocA: r.pointsParBloc['A'] || 0,
      BlocB: r.pointsParBloc['B'] || 0,
      BlocC: r.pointsParBloc['C'] || 0,
      Evaluateur: stored.signataire || (Store.get('prof.current') || ''),
      UpdatedAt: stored.updatedAt || new Date().toISOString()
    };
    return inerwebResults.write(row);
  }

  window.CCFExport = { mailBilanEleve, mailBilanClasse, exportCSV, pushSheet };
})();
