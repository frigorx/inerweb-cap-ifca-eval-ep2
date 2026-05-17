/**
 * pdf-export.js — Génère un bilan PDF complet (les 2 EP fusionnés) et le sauvegarde dans Drive.
 *
 * Stratégie :
 *   1. Construit un HTML imprimable propre (template séparé, ne réutilise pas l'UI live)
 *   2. Inclut : identité, notes, détail par tâche, compétences, signatures, liens photos
 *   3. Convertit via html2pdf.js (chargé depuis CDN)
 *   4. Upload base64 → Apps Script → Drive (sous-dossier PDFs/)
 *   5. Fallback : si backend non configuré, propose téléchargement local
 *
 * API publique : window.PdfExport
 *   - PdfExport.generateAndSave(eleve, baremes, saisies, opts) → Promise<{ok, driveUrl?, downloaded?}>
 *   - PdfExport.previewHtml(eleve, baremes, saisies) → string HTML (pour debug)
 */
;(function () {
  'use strict';

  var CDN_HTML2PDF = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  var _loadingPromise = null;

  /* Charger html2pdf.js depuis CDN une seule fois */
  function _ensureHtml2Pdf() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (_loadingPromise) return _loadingPromise;
    _loadingPromise = new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = CDN_HTML2PDF;
      s.onload = function() { resolve(window.html2pdf); };
      s.onerror = function() { reject(new Error('Échec chargement html2pdf.js')); };
      document.head.appendChild(s);
    });
    return _loadingPromise;
  }

  /* ========== TEMPLATE HTML DU BILAN ========== */
  function buildHtml(eleve, baremes, saisies, attachs, prof) {
    var rFaco = CCF.compute(baremes.ep2faco, saisies.ep2faco || {});
    var rElec = CCF.compute(baremes.ep2elec, saisies.ep2elec || {});
    var aFaco = Object.keys(saisies.ep2faco || {}).length > 0;
    var aElec = Object.keys(saisies.ep2elec || {}).length > 0;
    var n = 0, sum = 0;
    if (aFaco) { sum += rFaco.note20Brute; n++; }
    if (aElec) { sum += rElec.note20Brute; n++; }
    var noteFinale = n > 0 ? sum / n : 0;
    var dateFR = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    /* Signatures et photos */
    var sigEleve = (attachs.ep2faco || []).concat(attachs.ep2elec || []).filter(function(a) { return a.type === 'signature_eleve'; }).pop();
    var sigProf  = (attachs.ep2faco || []).concat(attachs.ep2elec || []).filter(function(a) { return a.type === 'signature_prof'; }).pop();
    var photos   = (attachs.ep2faco || []).concat(attachs.ep2elec || []).filter(function(a) { return a.type === 'photo'; });

    return [
      '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">',
      '<style>',
      '@page { size: A4 portrait; margin: 12mm; }',
      'body { font-family: Calibri, Arial, sans-serif; color: #1a2332; font-size: 11pt; line-height: 1.45; }',
      '.header { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #1b3a63; padding-bottom:8px; margin-bottom:14px; }',
      '.header .logo { font-family: "Trebuchet MS"; font-weight:bold; color:#1b3a63; font-size:16pt; }',
      '.header .logo .edu { background:#ff6b35; color:#fff; padding:1px 8px; border-radius:3px; font-size:10pt; margin:0 4px; }',
      '.header .lpp { text-align:right; font-size:10pt; color:#666; line-height:1.3; }',
      '.header .lpp strong { color:#1b3a63; }',
      'h1 { font-family:"Trebuchet MS"; color:#1b3a63; font-size:18pt; margin:0 0 4px; text-align:center; }',
      'h1 .sub { display:block; font-size:11pt; color:#666; font-weight:normal; margin-top:3px; }',
      'h2 { font-family:"Trebuchet MS"; color:#1b3a63; font-size:14pt; background:#f4f6fa; padding:6px 12px; border-left:5px solid #ff6b35; margin:14px 0 8px; }',
      'h3 { color:#1b3a63; font-size:12pt; margin:10px 0 4px; }',
      '.identite { display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:8px; margin-bottom:12px; }',
      '.identite .cell { border:1px solid #cbd5e0; padding:6px 10px; border-radius:4px; }',
      '.identite .lbl { font-size:9pt; color:#666; text-transform:uppercase; font-weight:bold; }',
      '.identite .val { font-size:12pt; font-weight:bold; color:#1b3a63; }',
      '.note-bloc { display:grid; grid-template-columns: 1fr 1fr 1.4fr; gap:8px; margin:10px 0 16px; }',
      '.note-cell { border:2px solid #1b3a63; padding:10px; border-radius:6px; text-align:center; background:#f4f6fa; }',
      '.note-cell.final { background:#1b3a63; color:#fff; }',
      '.note-cell .lbl { font-size:10pt; font-weight:bold; text-transform:uppercase; }',
      '.note-cell .val { font-size:28pt; font-weight:800; font-family:"Trebuchet MS"; line-height:1; margin:4px 0; }',
      '.note-cell .val .sur { font-size:14pt; font-weight:normal; opacity:0.7; }',
      '.note-cell .pts { font-size:9pt; color:#666; }',
      '.note-cell.final .pts { color:#cbd5e0; }',
      'table.detail { width:100%; border-collapse:collapse; margin:8px 0; font-size:10pt; }',
      'table.detail th { background:#1b3a63; color:#fff; padding:5px 8px; text-align:left; font-weight:bold; }',
      'table.detail td { padding:4px 8px; border-bottom:1px solid #e0e4ea; }',
      'table.detail .niv { font-weight:bold; text-align:center; padding:2px 8px; border-radius:3px; color:#fff; font-size:9pt; }',
      'table.detail .niv-NA { background:#c53030; }',
      'table.detail .niv-EC { background:#dd6b20; }',
      'table.detail .niv-A  { background:#38a169; }',
      'table.detail .niv-PA { background:#1b3a63; }',
      'table.detail .pts { text-align:right; font-weight:bold; color:#1b3a63; }',
      '.comp-grid { display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin:6px 0; }',
      '.comp-row { padding:5px 10px; background:#f4f6fa; border-left:4px solid #ccc; border-radius:3px; display:flex; justify-content:space-between; font-size:10pt; }',
      '.comp-row.lvl-NA { border-left-color:#c53030; }',
      '.comp-row.lvl-EC { border-left-color:#dd6b20; }',
      '.comp-row.lvl-A  { border-left-color:#38a169; }',
      '.comp-row.lvl-PA { border-left-color:#1b3a63; }',
      '.comp-row strong { color:#1b3a63; }',
      '.sig-block { display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:14px; }',
      '.sig-cell { border:1px solid #cbd5e0; border-radius:6px; padding:8px; }',
      '.sig-cell .lbl { font-size:10pt; font-weight:bold; color:#1b3a63; margin-bottom:4px; }',
      '.sig-cell img { max-width:100%; max-height:80px; display:block; margin:auto; }',
      '.sig-cell .empty { color:#aaa; font-style:italic; font-size:10pt; text-align:center; padding:20px 0; }',
      '.photos-list { display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; margin-top:6px; }',
      '.photo-cell { border:1px solid #cbd5e0; border-radius:4px; padding:4px; text-align:center; font-size:9pt; }',
      '.photo-cell img { width:100%; height:80px; object-fit:cover; border-radius:3px; }',
      '.photo-cell .meta { color:#666; font-size:8pt; margin-top:2px; }',
      '.footer { margin-top:20px; padding-top:8px; border-top:1px solid #cbd5e0; font-size:8.5pt; color:#666; text-align:center; line-height:1.5; }',
      '.footer strong { color:#1b3a63; }',
      '.rgpd { background:#fffbeb; border:1px solid #ed8936; padding:6px 10px; border-radius:4px; font-size:8.5pt; color:#7c2d12; margin-top:8px; }',
      '.partial-warn { background:#fff5f5; border:1px solid #c53030; padding:6px 10px; border-radius:4px; font-size:10pt; color:#9b2c2c; margin:8px 0; }',
      '</style></head><body>',

      /* En-tête */
      '<div class="header">',
      '  <div class="logo">❄ inerWeb<span class="edu">Édu</span></div>',
      '  <div class="lpp"><strong>LP Privé Jacques Raynaud</strong><br>Campus ÉQUATIO — Marseille<br>Filière Énergétique · CAP IFCA</div>',
      '</div>',

      '<h1>Bilan officiel CCF EP2<span class="sub">Façonnage + Raccordement Électrique — CAP IFCA 2025/26</span></h1>',

      /* Identité */
      '<div class="identite">',
      '  <div class="cell"><div class="lbl">Candidat (pseudo)</div><div class="val">' + esc(eleve) + '</div></div>',
      '  <div class="cell"><div class="lbl">Classe</div><div class="val">CAP IFCA 2</div></div>',
      '  <div class="cell"><div class="lbl">Date évaluation</div><div class="val">' + dateFR + '</div></div>',
      '  <div class="cell"><div class="lbl">Examinateur</div><div class="val">' + esc(prof || 'FH') + '</div></div>',
      '</div>',

      /* Note finale */
      n < 2 ? '<div class="partial-warn">⚠ Note partielle : seule ' + (aFaco ? 'EP2 Façonnage' : 'EP2 Électrique') + ' a été saisie. La note finale ci-dessous est calculée sur cette seule sous-épreuve.</div>' : '',

      '<div class="note-bloc">',
      '  <div class="note-cell"><div class="lbl">EP2 Façonnage</div>',
      '    <div class="val">' + (aFaco ? fmt(rFaco.note20Brute) : '—') + '<span class="sur"> /20</span></div>',
      '    <div class="pts">' + rFaco.totalBrut + ' / ' + rFaco.totalMax + ' pts</div></div>',
      '  <div class="note-cell"><div class="lbl">EP2 Électrique</div>',
      '    <div class="val">' + (aElec ? fmt(rElec.note20Brute) : '—') + '<span class="sur"> /20</span></div>',
      '    <div class="pts">' + rElec.totalBrut + ' / ' + rElec.totalMax + ' pts</div></div>',
      '  <div class="note-cell final"><div class="lbl">Note finale CCF EP2</div>',
      '    <div class="val">' + (n > 0 ? fmt(noteFinale) : '—') + '<span class="sur"> /20</span></div>',
      '    <div class="pts">= moyenne des 2 sous-épreuves</div></div>',
      '</div>',

      /* Détail Façonnage */
      aFaco ? renderDetail('Façonnage', baremes.ep2faco, saisies.ep2faco, rFaco) : '',

      /* Détail Électrique */
      aElec ? renderDetail('Électrique', baremes.ep2elec, saisies.ep2elec, rElec) : '',

      /* Compétences fusionnées */
      renderCompetencesFusion(baremes, saisies),

      /* Signatures */
      '<h2>✍ Signatures</h2>',
      '<div class="sig-block">',
      '  <div class="sig-cell"><div class="lbl">Signature candidat</div>',
      (sigEleve ? '<img src="' + sigEleve.data + '" alt="signature élève">' : '<div class="empty">— Non signé —</div>') +
      '  </div>',
      '  <div class="sig-cell"><div class="lbl">Signature examinateur (' + esc(prof || 'FH') + ')</div>',
      (sigProf ? '<img src="' + sigProf.data + '" alt="signature prof">' : '<div class="empty">— Non signé —</div>') +
      '  </div>',
      '</div>',

      /* Photos */
      photos.length > 0 ? renderPhotosBlock(photos) : '',

      /* Mention RGPD + Footer */
      '<div class="rgpd">',
      '  <strong>🔒 RGPD :</strong> Données traitées par F. Henninot, enseignant LP Jacques Raynaud. Pseudonymisation appliquée (le pseudo ' + esc(eleve) + ' correspond à un élève identifié dans la table locale sécurisée). Stockage chiffré. Droit d\'accès et suppression : fr.henninot@gmail.com. Données supprimées au 31/08 de chaque année.',
      '</div>',
      '<div class="footer">',
      '  <strong>inerWeb Édu</strong> — Système d\'évaluation par compétences CAP IFCA · Mapping référentiel officiel UP2<br>',
      '  Document généré automatiquement le ' + dateFR + ' · Archive Drive · Bilan v' + (Date.now() % 100000),
      '</div>',

      '</body></html>'
    ].join('\n');
  }

  function renderDetail(titre, bareme, saisie, r) {
    var rows = [];
    bareme.blocs.forEach(function(bloc) {
      rows.push('<tr style="background:#fafbfd;"><td colspan="5" style="font-weight:bold;color:' + bloc.couleur + ';padding:6px 8px;">Bloc ' + bloc.code + ' — ' + esc(bloc.label) + ' · ' + (r.pointsParBloc[bloc.code] || 0) + '/' + bloc.max + ' pts</td></tr>');
      bloc.taches.forEach(function(t) {
        var niv = saisie[t.id];
        var idx = niv ? bareme.niveaux.findIndex(function(n) { return n.code === niv; }) : -1;
        var pts = idx >= 0 ? t.niveaux[idx] : null;
        rows.push(
          '<tr>' +
          '<td style="width:40px;font-weight:bold;color:#1b3a63;">' + t.id + '</td>' +
          '<td>' + esc(t.intitule) + '<br><span style="color:#888;font-size:9pt;">📌 ' + esc(t.critere || '') + '</span></td>' +
          '<td style="width:50px;text-align:center;font-weight:bold;color:#1b3a63;">' + t.comp + '</td>' +
          '<td style="width:90px;text-align:center;">' + (niv ? '<span class="niv niv-' + niv + '">' + niv + '</span>' : '—') + '</td>' +
          '<td style="width:80px;" class="pts">' + (pts != null ? pts + ' / ' + t.max : '— / ' + t.max) + '</td>' +
          '</tr>'
        );
      });
    });
    return '<h2>Détail EP2 ' + titre + ' (note ' + fmt(r.note20Brute) + ' /20)</h2>' +
      '<table class="detail"><thead><tr><th>N°</th><th>Tâche &amp; critère</th><th>Comp</th><th>Niveau</th><th>Points</th></tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody></table>';
  }

  function renderCompetencesFusion(baremes, saisies) {
    var allComps = {};
    ['ep2faco', 'ep2elec'].forEach(function(ep) {
      var b = baremes[ep], s = saisies[ep] || {};
      var r = CCF.compute(b, s);
      Object.keys(r.maxParComp).forEach(function(c) {
        if (!allComps[c]) allComps[c] = { pts: 0, max: 0, libelle: (b.competences && b.competences[c]) || c };
        allComps[c].pts += r.pointsParComp[c] || 0;
        allComps[c].max += r.maxParComp[c];
      });
    });
    var keys = Object.keys(allComps).sort();
    if (keys.length === 0) return '';
    var rows = keys.map(function(c) {
      var a = allComps[c];
      var pct = a.max > 0 ? Math.round((a.pts / a.max) * 100) : 0;
      var lvl = pct >= 86 ? 'PA' : pct >= 61 ? 'A' : pct >= 26 ? 'EC' : 'NA';
      return '<div class="comp-row lvl-' + lvl + '">' +
        '<span><strong>' + c + '</strong> ' + esc(a.libelle) + '</span>' +
        '<span><strong>' + a.pts + '/' + a.max + ' (' + pct + '%) — ' + lvl + '</strong></span>' +
        '</div>';
    }).join('');
    return '<h2>🎯 Compétences mobilisées (référentiel CAP IFCA UP2)</h2><div class="comp-grid">' + rows + '</div>';
  }

  function renderPhotosBlock(photos) {
    var cells = photos.slice(0, 12).map(function(p) {
      var ep = (p.epreuve || '').replace('ep2', 'EP2 ').toUpperCase();
      var d = new Date(p.date).toLocaleDateString('fr-FR') + ' ' + new Date(p.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return '<div class="photo-cell"><img src="' + (p.thumb || p.data) + '" alt="photo"><div class="meta">' + ep + '<br>' + d + '</div></div>';
    }).join('');
    return '<h2>📷 Pièces jointes (' + photos.length + ' photo' + (photos.length > 1 ? 's' : '') + ')</h2><div class="photos-list">' + cells + '</div>';
  }

  function fmt(n) { return Number(n).toFixed(1).replace('.', ','); }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ========== GÉNÉRATION + UPLOAD ========== */

  /**
   * Génère le PDF et le sauvegarde dans Drive (si backend OK) sinon download local.
   * @param {string} eleve
   * @param {object} baremes - { ep2faco, ep2elec }
   * @param {object} saisies - { ep2faco, ep2elec }
   * @param {object} opts - { silent: bool } — si silent, pas d'alert visible
   * @returns Promise<{ok, driveUrl?, downloaded?}>
   */
  function generateAndSave(eleve, baremes, saisies, opts) {
    opts = opts || {};
    var prof = (window.Api && Api.getConfig() && Api.getConfig().prof) || 'FH';

    /* Récupérer les attachements (toutes EP confondues) */
    return Promise.all([
      window.Attach ? Attach.list(eleve, 'ep2faco') : Promise.resolve([]),
      window.Attach ? Attach.list(eleve, 'ep2elec') : Promise.resolve([])
    ]).then(function(attaArr) {
      var attachs = { ep2faco: attaArr[0], ep2elec: attaArr[1] };
      var html = buildHtml(eleve, baremes, saisies, attachs, prof);

      return _ensureHtml2Pdf().then(function(html2pdf) {
        /* Crée un container temporaire pour la génération */
        var container = document.createElement('div');
        container.innerHTML = html;
        container.style.cssText = 'position:absolute;left:-9999px;top:0;width:210mm;';
        document.body.appendChild(container);

        var rFaco = CCF.compute(baremes.ep2faco, saisies.ep2faco || {});
        var rElec = CCF.compute(baremes.ep2elec, saisies.ep2elec || {});
        var aFaco = Object.keys(saisies.ep2faco || {}).length > 0;
        var aElec = Object.keys(saisies.ep2elec || {}).length > 0;
        var n = 0, sum = 0;
        if (aFaco) { sum += rFaco.note20Brute; n++; }
        if (aElec) { sum += rElec.note20Brute; n++; }
        var noteFinale = n > 0 ? sum / n : 0;

        var filename = 'bilan_CCF_EP2_' + eleve + '_' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.pdf';

        var pdfOpts = {
          margin: 0,
          filename: filename,
          image: { type: 'jpeg', quality: 0.92 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        return html2pdf().from(container).set(pdfOpts).toPdf().output('datauristring').then(function(dataUri) {
          document.body.removeChild(container);
          /* Tentative upload Drive */
          if (window.Api && Api.isConfigured()) {
            return Api.call('uploadPdf', {
              eleve: eleve,
              prof: prof,
              noteFaco20: aFaco ? rFaco.note20Brute : '',
              noteElec20: aElec ? rElec.note20Brute : '',
              noteFinale20: n > 0 ? noteFinale.toFixed(2) : '',
              dataBase64: dataUri
            }).then(function(r) {
              if (r && r.ok) {
                _showToast('📄 Bilan PDF sauvé dans Drive ✓ (v' + r.version + ')', 'ok');
                return { ok: true, driveUrl: r.driveUrl, version: r.version };
              }
              throw new Error('API_KO: ' + (r && r.error));
            }).catch(function(err) {
              /* Fallback : download local */
              if (!opts.silent) _downloadLocal(dataUri, filename);
              _showToast('⚠ Upload Drive échoué — bilan téléchargé localement', 'warn');
              return { ok: true, downloaded: true, error: err.message };
            });
          } else {
            /* Pas configuré → download local */
            _downloadLocal(dataUri, filename);
            _showToast('📄 Bilan PDF téléchargé localement (backend non configuré)', 'warn');
            return { ok: true, downloaded: true };
          }
        });
      });
    });
  }

  function _downloadLocal(dataUri, filename) {
    var a = document.createElement('a');
    a.href = dataUri;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function _showToast(msg, kind) {
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'background:' + (kind === 'ok' ? '#38a169' : '#dd6b20') + ';color:#fff;' +
      'padding:12px 22px;border-radius:8px;font-weight:700;font-family:Calibri,sans-serif;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.3);z-index:10000;font-size:13pt;';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function() {
      t.style.transition = 'opacity 0.5s';
      t.style.opacity = '0';
      setTimeout(function() { document.body.removeChild(t); }, 500);
    }, 3000);
  }

  window.PdfExport = {
    generateAndSave: generateAndSave,
    buildHtml: buildHtml /* exposé pour debug/preview */
  };
})();
