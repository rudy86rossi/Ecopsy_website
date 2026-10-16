/**
 * Export: every tab the analysis needs, for evento-live/scarica-risultati.py.
 *
 * Facilitator key only: the answers are the participants' own words. Dates go
 * out as 'yyyy-MM-dd HH:mm:ss' in the script's time zone, the same format as
 * the session ids, so the latest answer or ballot of a device can be told by
 * its time.
 */

const EXPORT_TABS = ['CONFIG', 'DOMANDE', 'RISPOSTE', 'TEMI', 'VOTI',
  'ARCHIVIO_RISPOSTE', 'ARCHIVIO_TEMI', 'ARCHIVIO_VOTI', 'RISULTATI', 'CRONOLOGIA'];

function actionExport_(body) {
  requireKey_(body.key);
  const tz = Session.getScriptTimeZone();
  const tabs = {};
  EXPORT_TABS.forEach(function (k) {
    const sh = sheet_(k);
    const rows = sh.getLastRow() && sh.getLastColumn()
      ? sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues()
      : [];
    tabs[SHEETS[k]] = rows.map(function (r) {
      return r.map(function (v) {
        return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss') : cellText_(v);
      });
    });
  });
  log_('export', Object.keys(tabs).length + ' tabs', 'ok');
  return { ok: true, exported: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'), tabs: tabs };
}
