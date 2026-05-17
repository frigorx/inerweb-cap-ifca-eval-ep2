/**
 * inerweb-collecteur-v2.gs — Apps Script Web App pour collecter les saisies inerWeb
 *
 * Compatible avec les modules : CCF-EP3, TP-EVAL, AFFECT, TP-USER, TEST-PING
 * Stocke chaque module dans un onglet dédié de la Sheet, avec tous les champs
 * envoyés par le client (pas de filtre, pas de schéma figé).
 *
 * DÉPLOIEMENT (5 min) :
 *  1. Ouvre script.google.com (compte inerweb.fh@gmail.com)
 *  2. Nouveau projet → colle ce code
 *  3. Configure SHEET_ID en haut (ID de ta Google Sheet)
 *  4. Déployer → Nouveau déploiement → Type "Application Web"
 *     - Exécuter en tant que : moi
 *     - Accès : N'importe qui (anonyme OK pour quotas)
 *  5. Copie l'URL https://script.google.com/macros/s/AKfyc.../exec
 *  6. Colle cette URL dans js/inerweb-results.js → COLLECTEUR_URL
 *  7. git push → GitHub Pages se déploie tout seul
 */

const SHEET_ID = 'À_REMPLIR_AVEC_TON_ID_SHEET';
const MODULE_KEY = 'eval-cap-ifca';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.module !== MODULE_KEY) {
      return jsonOut({ ok: false, error: 'Module inconnu : ' + body.module });
    }
    if (body.action === 'write' && body.row) {
      const row = body.row;
      const sheetName = (row.Module || 'INCONNU').replace(/[^A-Z0-9_-]/gi, '');
      const sh = getOrCreateSheet(sheetName);
      const cols = ensureColumns(sh, Object.keys(row));
      const values = cols.map(c => row[c] != null ? String(row[c]) : '');
      /* Cherche une ligne existante pour cette clé naturelle (Pseudo+TpId si présents) */
      const matchIdx = findMatchingRow(sh, cols, row);
      if (matchIdx > 0) {
        sh.getRange(matchIdx, 1, 1, values.length).setValues([values]);
      } else {
        sh.appendRow(values);
      }
      return jsonOut({ ok: true });
    }
    return jsonOut({ ok: false, error: 'action inconnue' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  try {
    const params = e.parameter || {};
    if (params.module !== MODULE_KEY) {
      return jsonOut({ ok: false, error: 'Module inconnu' });
    }
    if (params.action !== 'read') {
      return jsonOut({ ok: false, error: 'action inconnue' });
    }
    /* Lit TOUS les onglets et concatène les rows en ajoutant le champ Module */
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const all = [];
    ss.getSheets().forEach(sh => {
      const data = sh.getDataRange().getValues();
      if (data.length < 2) return;
      const headers = data[0];
      for (let i = 1; i < data.length; i++) {
        const obj = {};
        headers.forEach((h, j) => obj[h] = data[i][j]);
        if (!obj.Module) obj.Module = sh.getName();
        all.push(obj);
      }
    });
    return jsonOut({ ok: true, data: all });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  return sh;
}

function ensureColumns(sh, neededKeys) {
  const lastCol = sh.getLastColumn();
  let headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  let modified = false;
  neededKeys.forEach(k => {
    if (!headers.includes(k)) { headers.push(k); modified = true; }
  });
  if (modified) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return headers;
}

function findMatchingRow(sh, cols, row) {
  /* Clé naturelle = Pseudo + TpId (si présents) sinon on append toujours. */
  if (!row.Pseudo) return -1;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const data = sh.getRange(2, 1, lastRow - 1, cols.length).getValues();
  const colPseudo = cols.indexOf('Pseudo');
  const colTpId = cols.indexOf('TpId');
  for (let i = 0; i < data.length; i++) {
    if (data[i][colPseudo] !== row.Pseudo) continue;
    if (colTpId >= 0 && row.TpId && data[i][colTpId] !== row.TpId) continue;
    if (colTpId >= 0 && !row.TpId && data[i][colTpId]) continue;
    return i + 2;
  }
  return -1;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
