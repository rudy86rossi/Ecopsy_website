/* Una persona, un foglio: ogni nome qui sotto ha il proprio foglio Google con il
   proprio web app Apps Script, e le sue tre pagine (proiettore_<nome>.html,
   voto_studente_<nome>.html, operatore_<nome>.html) parlano solo con quello.
   Il nome deve combaciare con data-persona nelle tre pagine.

   Incolla per ognuno l'URL del suo web app (Distribuisci → Web app → /exec).
   Ridistribuendo usa sempre "Gestisci distribuzioni → matita → Nuova versione":
   una nuova distribuzione cambia l'URL e le pagine di quella persona smettono di
   funzionare. */
window.EVENTO_PERSONE = {
  rodolfo:     'https://script.google.com/macros/s/AKfycbwA7IO9bUp-pTUTdcIoAblcC9Ke5Rkqktl5erZMWAjRwK7sbPmur7hsdvJuro15W-hP/exec',
  roberta:     'INCOLLA_URL_EXEC',
  placeholder: 'INCOLLA_URL_EXEC'
};
