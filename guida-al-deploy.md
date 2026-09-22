# Guida al deploy

Come pubblicare il sito EcoPsy sul server di Tor Vergata.

## Cosa fa `deploy.sh`

Copia i file del sito sul server via SFTP. L'account non ha shell, quindi lo script
costruisce una copia pulita in una cartella temporanea, ne ricava un elenco esplicito di
comandi SFTP e lo esegue in un colpo solo.

| | |
|---|---|
| Server | `www-2026.ecopsy.uniroma2.it` |
| Utente | `pmpgcm00_local` |
| Chiave SSH | `~/.ssh/id_ed25519` |
| Cartella remota | `siti/www-2026_ecopsy_uniroma2_it_apache2_trixie/web/htdocs` |
| Sito pubblico | <https://www-2026.ecopsy.uniroma2.it> |

Ogni esecuzione carica **tutti** i file, non solo quelli modificati: al momento 32 file per
circa 46 MB, quindi metti in conto qualche minuto.

Lo script pubblica quello che si trova **nella cartella di lavoro**, non quello che è
committato su git. Due conseguenze pratiche:

- le modifiche non committate finiscono online;
- fare `git commit` o `git push` non pubblica niente, serve lanciare lo script.

## Prerequisiti

- La chiave SSH in `~/.ssh/id_ed25519`, autorizzata sull'account.
- `rsync`, `sftp`, `find`, `numfmt` e `bc` installati (gli ultimi due servono per il
  conteggio dei file e dei byte).

## I tre comandi

```bash
./deploy.sh --check     # mostra cosa c'è adesso sul server
./deploy.sh --dry-run   # stampa l'elenco SFTP esatto, non invia niente
./deploy.sh             # carica
```

Lancia sempre `--dry-run` prima di pubblicare. Ti dice quanti file e quanti MB partono, e
ti fa vedere se un file nuovo è incluso:

```bash
./deploy.sh --dry-run | grep nome-del-file
```

## Prima di pubblicare

Header e footer sono copiati a mano in ogni pagina HTML. Quando aggiungi o rinomini una
pagina, la navigazione va aggiornata in **tutte** le altre, altrimenti la pagina nuova
esiste ma non è raggiungibile.

Controlla che ogni pagina la linki (2 riferimenti nel menu + 1 nel footer = 3):

```bash
grep -c 'href="nuova-pagina.html"' *.html
```

Verifica poi che i link interni e le ancore `#...` puntino a qualcosa che esiste, e che
ogni testo abbia sia la versione `data-lang="it"` che quella `data-lang="en"`: una pagina
con le due lingue sbilanciate mostra buchi quando si preme il tasto EN/IT.

I file grossi (PDF, immagini) vanno messi in `assets/` o `docs/`: lo script li prende
automaticamente, non c'è niente da registrare.

## Verificare che sia andato a buon fine

Il server risponde in HTTP con un 302 verso HTTPS, quindi usa `https://` oppure `curl -L`,
altrimenti sembra che la pagina non ci sia.

Il controllo più solido è riscaricare la pagina e confrontarla con quella locale:

```bash
curl -sL https://www-2026.ecopsy.uniroma2.it/pagina.html -o /tmp/live.html
diff pagina.html /tmp/live.html && echo "identica"
```

## Messaggi che puoi ignorare

**`remote setstat ... index.html: Permission denied`**

Riguarda solo il `chmod` finale su `index.html`, che sul server appartiene a un altro
utente. Il caricamento del file è andato a buon fine: lo si verifica con il `diff` qui
sopra. Nello script quei comandi hanno il prefisso `-` proprio perché un errore del genere
non interrompa il resto.

## Cosa non viene pubblicato

Lo script esclude i file di servizio (`.git`, `.DS_Store`, `.Rhistory`, `.claude`, `*.tmp`,
i lock di LibreOffice), `TODO.md` e `deploy.sh` stesso. Restano fuori anche gli appunti di
lavoro (`PIANO-*.md`, `REVISIONE-*.md`) e la cartella `evento-live`, che contiene il codice
Apps Script della sessione live: gira su Google, non sul server, e non deve finire online.

Se aggiungi un documento che deve restare privato, mettilo nell'elenco `EXCLUDES` dentro
`deploy.sh` prima di lanciare il deploy.

## Limiti noti

**Niente cancellazione remota.** Lo script sovrascrive e aggiunge, ma non rimuove. Se
rinomini o elimini una pagina, la vecchia resta online e raggiungibile: va cancellata a
mano collegandosi via SFTP.

```bash
sftp -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes pmpgcm00_local@www-2026.ecopsy.uniroma2.it
# poi: cd siti/www-2026_ecopsy_uniroma2_it_apache2_trixie/web/htdocs
#      rm pagina-vecchia.html
```

**Permessi.** Apache gira con un altro utente e restituisce 403 su file non leggibili da
tutti. Lo script mette 755 sulle cartelle e 644 sui file per questo motivo.

**Peso del trasferimento.** I 46 MB sono quasi tutti immagini e PDF non compressi
(`EMA_Scuole.pdf` ~35 MB, `wallpaper.png` ~5,8 MB, due PNG da ~8 MB). Comprimerli
accorcia ogni deploy futuro; è già segnato in `TODO.md`.
