/**
 * Code.gs — Backend Apps Script pour inerWeb CCF EP2 (CAP IFCA)
 *
 * Fonctionnalités :
 *   1. Auto-setup au 1er appel : crée les feuilles + dossier Drive si absents
 *   2. Append-only TOUJOURS (aucune ligne n'est jamais écrasée ou supprimée)
 *   3. Endpoints :
 *      - pushNote        : enregistre une saisie note (avec versionnage)
 *      - uploadPhoto     : enregistre une photo dans Drive + ligne Sheet
 *      - uploadSignature : enregistre une signature dans Drive + ligne Sheet
 *      - getCurrent      : retourne la dernière version pour un élève + épreuve
 *      - getAttachments  : retourne les pièces jointes pour un élève + épreuve
 *      - status          : healthcheck + diagnostic setup
 *
 * Sécurité :
 *   - Clé API simple (CLE_API ci-dessous, à changer après installation)
 *   - Pseudonymes uniquement, pas de vrais noms
 *
 * Auteur : F. Henninot · LP Privé Jacques Raynaud · Campus ÉQUATIO
 * Version : V1-2026-05-17
 */

/* ========== CONFIGURATION ========== */
var CLE_API = 'EP2-2026-fh-changeMe'; // ← À CHANGER après installation (cf. PROCEDURE_INSTALLATION.md)
var DRIVE_FOLDER_NAME = 'inerWeb_Photos_CCF_EP2_2026';

/* Noms des feuilles (auto-créées si absentes) */
var SHEETS = {
  NOTES: 'Notes',
  PHOTOS: 'Photos',
  SIGNATURES: 'Signatures',
  LOG: '_AUDIT_LOG'
};

/* Schémas des feuilles (entête colonnes) */
var SCHEMAS = {
  Notes: ['Timestamp', 'Eleve', 'Epreuve', 'TacheId', 'Niveau', 'Points', 'PointsMax', 'Comp', 'NoteFinale20', 'TotalBrut', 'TotalMax', 'Prof', 'Version', 'Saisie_JSON'],
  Photos: ['Timestamp', 'Eleve', 'Epreuve', 'Filename', 'DriveUrl', 'DriveFileId', 'Prof', 'Version'],
  Signatures: ['Timestamp', 'Eleve', 'Epreuve', 'TypeSig', 'DriveUrl', 'DriveFileId', 'Prof', 'Version'],
  '_AUDIT_LOG': ['Timestamp', 'Action', 'Eleve', 'Epreuve', 'Prof', 'Result', 'Detail']
};

/* ========== ROUTER ========== */
function doPost(e) {
  var resp = { ok: false, error: null };
  try {
    var payload = JSON.parse(e.postData.contents);

    /* Vérif clé API */
    if (payload.key !== CLE_API) {
      return _json({ ok: false, error: 'CLE_API_INVALIDE' });
    }

    /* Setup automatique au besoin */
    var ss = _ensureSetup();

    var action = payload.action || '';
    switch (action) {
      case 'pushNote':        resp = pushNote(ss, payload); break;
      case 'uploadPhoto':     resp = uploadPhoto(ss, payload); break;
      case 'uploadSignature': resp = uploadSignature(ss, payload); break;
      case 'getCurrent':      resp = getCurrent(ss, payload); break;
      case 'getAttachments':  resp = getAttachments(ss, payload); break;
      case 'status':          resp = status(ss); break;
      default: resp = { ok: false, error: 'ACTION_INCONNUE: ' + action };
    }
  } catch (err) {
    resp = { ok: false, error: 'EXCEPTION: ' + err.message + ' | stack: ' + (err.stack || '') };
    _logAudit(null, 'ERROR', '', '', '', 'FAIL', err.message);
  }
  return _json(resp);
}

function doGet(e) {
  return _json({
    ok: true,
    service: 'inerWeb CCF EP2 Backend',
    version: 'V1-2026-05-17',
    methods: ['pushNote', 'uploadPhoto', 'uploadSignature', 'getCurrent', 'getAttachments', 'status'],
    docs: 'Envoyer POST application/json avec { key, action, ...payload }'
  });
}

/* ========== AUTO-SETUP ========== */
/**
 * S'assure que le Spreadsheet conteneur a toutes les feuilles requises.
 * Crée celles qui manquent avec leur entête.
 * Crée aussi le dossier Drive si absent.
 */
function _ensureSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Aucun Spreadsheet actif (le script doit être lié à un Sheet).');

  /* Vérifier/créer chaque feuille */
  Object.keys(SCHEMAS).forEach(function(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      var headers = SCHEMAS[name];
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1b3a63').setFontColor('#fff');
      sh.setFrozenRows(1);
      sh.setColumnWidths(1, headers.length, 130);
    }
  });

  /* Vérifier/créer dossier Drive */
  _ensureDriveFolder();

  return ss;
}

function _ensureDriveFolder() {
  var iter = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (iter.hasNext()) return iter.next();
  return DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

function _getDriveSubFolder(eleve) {
  var parent = _ensureDriveFolder();
  var sub = parent.getFoldersByName(eleve);
  if (sub.hasNext()) return sub.next();
  return parent.createFolder(eleve);
}

/* ========== ACTIONS ========== */

/**
 * pushNote : ajoute une ligne dans Notes (append-only).
 * Payload :
 *   { eleve, epreuve, prof, noteFinale20, totalBrut, totalMax, saisie (obj), tachesDetail (array facultatif) }
 * Si tachesDetail fourni : 1 ligne par tâche dans le détail (audit fin). Sinon 1 ligne synthèse.
 */
function pushNote(ss, p) {
  var sh = ss.getSheetByName(SHEETS.NOTES);
  var ts = new Date();
  var version = _nextVersion(sh, p.eleve, p.epreuve);

  /* Ligne synthèse (toujours) */
  sh.appendRow([
    ts,
    p.eleve,
    p.epreuve,
    'SYNTHESE',
    'N/A',
    '',
    '',
    '',
    p.noteFinale20 || '',
    p.totalBrut || '',
    p.totalMax || '',
    p.prof || '',
    version,
    JSON.stringify(p.saisie || {})
  ]);

  /* Lignes détail tâche par tâche (audit fin) */
  if (Array.isArray(p.tachesDetail)) {
    p.tachesDetail.forEach(function(t) {
      sh.appendRow([
        ts,
        p.eleve,
        p.epreuve,
        t.id,
        t.niveau || '',
        t.points || 0,
        t.max || 0,
        t.comp || '',
        '',
        '',
        '',
        p.prof || '',
        version,
        ''
      ]);
    });
  }

  _logAudit(ss, 'pushNote', p.eleve, p.epreuve, p.prof, 'OK', 'v' + version + ' note=' + p.noteFinale20);
  return { ok: true, version: version, timestamp: ts.toISOString() };
}

/**
 * uploadPhoto : décode base64, sauve dans Drive, ajoute ligne Photos.
 * Payload : { eleve, epreuve, prof, filename, dataBase64 (avec ou sans préfixe data:) }
 */
function uploadPhoto(ss, p) {
  var sh = ss.getSheetByName(SHEETS.PHOTOS);
  var ts = new Date();
  var folder = _getDriveSubFolder(p.eleve);
  var fileName = (p.epreuve + '_' + ts.toISOString().replace(/[:.]/g, '-') + '_' + (p.filename || 'photo.jpg')).substring(0, 120);

  /* Décoder base64 */
  var b64 = (p.dataBase64 || '').replace(/^data:image\/\w+;base64,/, '');
  if (!b64) return { ok: false, error: 'DATA_VIDE' };
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', fileName);

  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); /* visible profs établissement */

  var version = _nextVersion(sh, p.eleve, p.epreuve);
  sh.appendRow([
    ts,
    p.eleve,
    p.epreuve,
    fileName,
    file.getUrl(),
    file.getId(),
    p.prof || '',
    version
  ]);

  _logAudit(ss, 'uploadPhoto', p.eleve, p.epreuve, p.prof, 'OK', 'fichier=' + fileName);
  return { ok: true, version: version, driveUrl: file.getUrl(), driveFileId: file.getId() };
}

/**
 * uploadSignature : idem photo mais pour signature_eleve / signature_prof.
 */
function uploadSignature(ss, p) {
  var sh = ss.getSheetByName(SHEETS.SIGNATURES);
  var ts = new Date();
  var folder = _getDriveSubFolder(p.eleve);
  var typeShort = (p.typeSig || 'sig').replace('signature_', '');
  var fileName = (p.epreuve + '_signature-' + typeShort + '_' + ts.toISOString().replace(/[:.]/g, '-') + '.png');

  var b64 = (p.dataBase64 || '').replace(/^data:image\/\w+;base64,/, '');
  if (!b64) return { ok: false, error: 'DATA_VIDE' };
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', fileName);

  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);

  var version = _nextVersion(sh, p.eleve, p.epreuve);
  sh.appendRow([
    ts,
    p.eleve,
    p.epreuve,
    p.typeSig || 'signature',
    file.getUrl(),
    file.getId(),
    p.prof || '',
    version
  ]);

  _logAudit(ss, 'uploadSignature', p.eleve, p.epreuve, p.prof, 'OK', 'type=' + p.typeSig);
  return { ok: true, version: version, driveUrl: file.getUrl(), driveFileId: file.getId() };
}

/**
 * getCurrent : retourne la DERNIÈRE version de la ligne SYNTHESE pour un élève + épreuve.
 * Payload : { eleve, epreuve }
 */
function getCurrent(ss, p) {
  var sh = ss.getSheetByName(SHEETS.NOTES);
  var data = sh.getDataRange().getValues();
  var lastRow = null;
  for (var i = data.length - 1; i >= 1; i--) {
    var r = data[i];
    if (r[1] === p.eleve && r[2] === p.epreuve && r[3] === 'SYNTHESE') {
      lastRow = {
        timestamp: r[0],
        eleve: r[1],
        epreuve: r[2],
        noteFinale20: r[8],
        totalBrut: r[9],
        totalMax: r[10],
        prof: r[11],
        version: r[12],
        saisie: r[13] ? JSON.parse(r[13]) : {}
      };
      break;
    }
  }
  return { ok: true, current: lastRow };
}

/**
 * getAttachments : retourne les photos et signatures pour un élève + épreuve.
 */
function getAttachments(ss, p) {
  var shP = ss.getSheetByName(SHEETS.PHOTOS);
  var shS = ss.getSheetByName(SHEETS.SIGNATURES);
  var photos = _filterAndMap(shP, p.eleve, p.epreuve, ['timestamp', 'eleve', 'epreuve', 'filename', 'driveUrl', 'driveFileId', 'prof', 'version']);
  var signatures = _filterAndMap(shS, p.eleve, p.epreuve, ['timestamp', 'eleve', 'epreuve', 'typeSig', 'driveUrl', 'driveFileId', 'prof', 'version']);
  return { ok: true, photos: photos, signatures: signatures };
}

function _filterAndMap(sh, eleve, epreuve, keys) {
  var data = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (r[1] === eleve && r[2] === epreuve) {
      var obj = {};
      keys.forEach(function(k, idx) { obj[k] = r[idx]; });
      out.push(obj);
    }
  }
  return out;
}

/**
 * status : healthcheck + diagnostic.
 */
function status(ss) {
  var info = {
    ok: true,
    sheets: {},
    driveFolder: DRIVE_FOLDER_NAME,
    timestamp: new Date().toISOString()
  };
  Object.keys(SCHEMAS).forEach(function(name) {
    var sh = ss.getSheetByName(name);
    info.sheets[name] = sh ? { exists: true, rows: sh.getLastRow() - 1 } : { exists: false };
  });
  var folder = _ensureDriveFolder();
  info.driveFolderId = folder.getId();
  info.driveFolderUrl = folder.getUrl();
  return info;
}

/* ========== UTILS ========== */

/**
 * Calcule la prochaine version pour un élève + épreuve dans une feuille.
 * Lit la dernière ligne avec ce couple, +1.
 */
function _nextVersion(sh, eleve, epreuve) {
  var data = sh.getDataRange().getValues();
  var maxV = 0;
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (r[1] === eleve && r[2] === epreuve) {
      var v = parseInt(r[r.length === 14 ? 12 : 7], 10); /* col 12 pour Notes, col 7 pour Photos/Sig */
      if (v > maxV) maxV = v;
    }
  }
  return maxV + 1;
}

function _logAudit(ss, action, eleve, epreuve, prof, result, detail) {
  try {
    if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEETS.LOG);
    if (!sh) return; /* pas encore créée */
    sh.appendRow([new Date(), action, eleve || '', epreuve || '', prof || '', result, detail || '']);
  } catch (e) { /* silencieux */ }
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ========== FONCTION DE TEST MANUEL ==========
 * À exécuter manuellement dans l'éditeur Apps Script pour tester le setup.
 * Menu : Exécuter > selectFunction > testSetup > Exécuter
 */
function testSetup() {
  var ss = _ensureSetup();
  var info = status(ss);
  Logger.log(JSON.stringify(info, null, 2));
  return info;
}

function testPushNote() {
  var ss = _ensureSetup();
  var r = pushNote(ss, {
    eleve: 'TEST_ABadis',
    epreuve: 'ep2faco',
    prof: 'FH',
    noteFinale20: 14.5,
    totalBrut: 145,
    totalMax: 200,
    saisie: { 'A-1': 'PA', 'A-2': 'A' },
    tachesDetail: [
      { id: 'A-1', niveau: 'PA', points: 5, max: 5, comp: 'C3.1' },
      { id: 'A-2', niveau: 'A', points: 4, max: 5, comp: 'C3.1' }
    ]
  });
  Logger.log(JSON.stringify(r, null, 2));
}
