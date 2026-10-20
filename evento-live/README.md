# Apps Script — sessione live EcoPsy

Server side of the live session: collection, word cloud, theme extraction, ranking.
The site's pages talk to it over one URL. Nothing runs on the web server.

The files here are the reference copy. `pubblica-script.sh` publishes them to every
person's script with [clasp](https://github.com/google/clasp), Google's command line
for Apps Script.

## One sheet per person

Each facilitator (`rodolfo`, `roberta`, `amelia`, `eleonora`) has their own spreadsheet,
script, `/exec` URL and facilitator key, so several sessions can run at the same time
without seeing each other's answers, themes or votes.

| file | what it holds |
|---|---|
| `evento-live/clasp-<nome>.json` | the script ID of that person's project |
| `evento-config.js` (site root) | the `/exec` URL of that person's web app |
| `proiettore_` / `voto_studente_` / `operatore_<nome>.html` | that person's three pages: copy an existing person's and change `data-persona` |

## Publishing code changes

```
evento-live/pubblica-script.sh              # every person with a clasp-<nome>.json
evento-live/pubblica-script.sh rodolfo      # one person
evento-live/pubblica-script.sh --dry-run    # list what would be published, change nothing
```

For each person it uploads the `.gs` files and `appsscript.json` (`.claspignore` keeps
everything else here), then publishes a new version on their existing web app, so the
`/exec` URL stays the same. The version description carries the date and the git
commit: *Gestisci distribuzioni* in the editor shows which code each sheet runs.
Script Properties and the sheet's data are never touched.

When an update adds tabs or columns, run *EcoPsy → Inizializza fogli* once in each
sheet afterwards.

One-time setup on the computer that publishes:

1. Turn on **Google Apps Script API** at https://script.google.com/home/usersettings,
   for the Google account that publishes.
2. `npx @google/clasp login` — opens the browser; the login is saved in
   `~/.clasprc.json`, outside the repo.
3. That account needs editor access to every person's spreadsheet.

## Downloading the results

```
evento-live/scarica-risultati.py 2026-10-15              # everyone in evento-config.js
evento-live/scarica-risultati.py 2026-10-15 rodolfo      # one person
```

For each person it asks their web app for an export (the `export` action, facilitator
key only), saves every tab as CSV in `event data/<nome>/dati/` and runs
`estrai-dati.py` on the given day: answers, themes, ballots, summaries
(`sintesi.csv`), the projector's theme, ranking and summary screens as PNG, and
`Risultati-sessione-<nome>.pdf`. All the PDFs are
also copied together into `event data/Risultati-<day>/`.

The keys go in `evento-live/chiavi.local`, one line per person: `rodolfo = <chiave>`
(*EcoPsy → Mostra chiave e link*). The file and `event data/` are in `.gitignore`;
`deploy.sh` leaves both out of the site. A wrong key counts towards the 10-minute
lockout like any other.

The PNGs and the PDF need a headless Chromium: the script finds `chromium`,
`google-chrome` or Playwright's `chrome-headless-shell`.

## Adding a person

1. Create a spreadsheet — **Estensioni → Apps Script** creates the bound project.
   Copy its ID from *Impostazioni progetto → ID*.
2. Write `evento-live/clasp-<nome>.json`, same shape as `clasp-rodolfo.json`, with that
   ID. Add `<nome>: 'INCOLLA_URL_EXEC'` to `evento-config.js` and create their three
   pages.
3. `evento-live/pubblica-script.sh <nome>`. With no URL in `evento-config.js` yet, it
   creates the first web app deployment and prints its id: paste
   `https://script.google.com/macros/s/<id>/exec` next to the name.
4. In the editor, reload and run `setup()` once. It creates `Config`, `Domande`,
   `Risposte`, `Temi`, `Voti`, the three `Archivio` tabs, `Risultati`, `Cronologia`,
   `Log`. The first run asks for authorisation: *Avanzate → Apri progetto (non
   sicuro)*, then *Consenti*. The warning says the script never went through
   Google's review, which an unlisted internal script never does.
5. **Proprietà script** → add `ANTHROPIC_API_KEY` (or `GEMINI_API_KEY`, and set
   `provider` to `gemini` in the `Config` tab).
6. Reload the spreadsheet → the **EcoPsy** menu appears → *Mostra chiave e link*.
   It asks once for the person's name (the one in their page addresses, e.g.
   `rodolfo`), generates `FACILITATOR_KEY` as `<nome>-NNN`, and asks once for the
   `/exec` URL so it can show the facilitator link. Paste the URL from step 3.
7. Deploy the site, so the new pages and `evento-config.js` go online.

Without clasp, the same by hand: paste each `.gs` file into the editor, replace
`appsscript.json` (*Impostazioni progetto → Mostra file manifest*), and publish with
**Distribuisci → Nuova distribuzione → Web app**, *Esegui come: me*, *Chi ha accesso:
chiunque, anche anonimo* (the Italian menu calls it just *Chiunque*; *Chiunque con un
Account Google* forces a login).

> Every later change by hand: **Gestisci distribuzioni → matita → Versione: Nuova
> versione**. "Nuova distribuzione" mints a *different* URL, the published pages keep
> calling the old one, and nothing announces it. The editor also carries a *head
> deployment* with its own id: only the versioned one reaches anonymous visitors.

## Endpoints

`GET <exec>` — everything both screens need:

```json
{ "ok": true, "phase": "collecting", "title": "…",
  "question": "…", "questionId": "q1", "type": "parole", "maxLength": 80,
  "session": "2026-10-11 10:00:00", "round": { "n": 1, "of": 3 },
  "questions": [{ "id": "q1", "text": "…" }], "answerFields": 3, "topN": 3,
  "scaletta": "FSL-1", "scalette": [{ "name": "FSL-1", "count": 5 }, { "name": "FSL-2", "count": 1 }],
  "responses": 14, "entries": 35, "ballots": 0,
  "cloud": [["social media", 7], ["scuola", 5]],
  "themes": [{ "id": "t1", "label": "…", "description": "…" }],
  "results": null, "summary": null, "page": 1,
  "rev": "q1-collecting-35-0-0-…", "serverTime": 1770000000000 }
```

For a `sintesi` question in `results`, `summary` is
`{title, paragraphs:["…"], pages:[[0],[1,2],[3]]}` (paragraph indexes per
projector page) and `page` the page on the projector, from 1.

Everything refers to the question on screen. `responses` counts participants,
`entries` the ideas they wrote.

`results` stays `null` until the facilitator closes the vote: a tally that moves
while people vote steers everyone who votes late. `rev` changes only when
something changed, so the projector can skip a redraw.

`POST <exec>` — one action per call:

| action | body | phase required |
|---|---|---|
| `submit` | `{voterId, sendId, items:["…","…"]}` — up to `answer_fields`, 80 characters each; a `testo` or `sintesi` question takes one item of up to 500 and replies `already: true` if the device had answered | `collecting` |
| `ballot` | `{voterId, sendId, ranking:["t2","t1","t5"]}` | `voting` |
| `phase` | `{key, to}` | facilitator key |
| `question` | `{key, to}` — a question id, or `"next"` | facilitator key |
| `analyze` | `{key}` — themes, or for a `sintesi` question the summary | facilitator key |
| `question-text` | `{key, id, text}` — writes the text of the `sintesi` question on screen, until its first answer; 300 characters | facilitator key |
| `add-question` | `{key, text}` — adds a `sintesi` question after the last one and puts it on screen | facilitator key, last question in `results` |
| `page` | `{key, to}` — page of the summary on the projector, from 1 | facilitator key, `sintesi` in `results` |
| `reset` | `{key, confirm:"RESET", scaletta}` — a new session; `scaletta` (optional) is its question set, otherwise the current one stays | facilitator key |

Every reply is HTTP 200 with `{ok: true|false}`; `ok:false` carries `error`.
`sendId` is optional: a send repeated with the same id within 10 minutes is
skipped, so the phone can retry a request whose reply was lost.

## How the pages must call it

```js
// GET: a plain fetch, no custom headers — anything else triggers a preflight.
const state = await (await fetch(EXEC_URL)).json();

// POST: JSON body, text/plain content type. Apps Script has no doOptions, so a
// preflight gets a 405 and never reaches the script. text/plain is a CORS
// safelisted type, so the request goes straight through; the 302 to
// script.googleusercontent.com is followed automatically and that response
// carries Access-Control-Allow-Origin: *, so the reply is readable.
const res = await fetch(EXEC_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'ballot', voterId, ranking })
});
const out = await res.json();
```

Never `mode: 'no-cors'`: the response is opaque, and the page cannot tell a
recorded vote from a thrown error.

`voterId` is generated on first load and kept in `localStorage`. It deduplicates
accidental double submissions; it is not an identity check and does not need to be.

## Running the session

The questions are the rows of the `Domande` tab, one round each, grouped into
*scalette* (question sets):

| column | what to write |
|---|---|
| `id` | short id (`q1`, `q2`…); empty means its position |
| `domanda` | the question shown on screen |
| `opzioni` | for a poll: the choices, separated by `\|`. Empty for an open question |
| `multipla` | poll only: `sì` lets a participant pick several choices |
| `esclusiva` | poll only: choices that clear all the others when picked (e.g. `No`), separated by `\|` |
| `tipo` | open question only: `testo` asks for one free answer per person, up to 500 characters, with no word cloud. `sintesi` the same, analysed into one written summary instead of themes and a vote; its `domanda` may be left empty and written in the room. Empty (or `parole`) asks for short ideas that feed the cloud |
| `sessione` | filled by the script: the session a `sintesi` text was written in, or a row added from the facilitator page belongs to |
| `origine` | filled by the script: `aggiunta` for a row added from the facilitator page |
| `scaletta` | the question sets the row belongs to (e.g. `FSL-1`), separated by `\|`. Empty puts it in every set |

### Scalette

Each sheet holds several question sets, and each session runs one of them. Today:
**FSL-1**, the poll and four `testo` questions (q1–q5), and **FSL-2**, a free
session: one `sintesi` row with no text (q6), so the facilitator writes the
first question in the room and adds the next ones with *+ Nuova domanda*.

- The facilitator page lists the scalette at the start of a session (first
  question, no answers yet); tapping one starts the session on it. After the
  first answer, *Altri comandi → Nuova sessione* picks the set of the next
  session. The menu's *Nuova sessione (azzera)* asks for the name.
- Within a set the rounds run in sheet order; `round`, the *Domande* list and
  *Domanda successiva* see only that set. With no names in the column the tab
  is one list.
- **Ids are unique across the whole tab**: answers, themes and the export find
  a question by id alone. A set with an id two rows share is refused when a
  session starts on it, with the id in the message.
- `Cronologia` records the set of each session; the export prints it on the
  session's opening page.

An open question runs `collecting` → `analysing` → `themes` → `voting` →
`results`. A poll runs `collecting` → `results`: the projector shows the
choices and how many have answered, and the bars (count and share of
participants) only when the facilitator closes it. A participant can change a
poll answer while it is open; the latest one per device counts.

*Domanda successiva* opens the next question's `collecting`, from any phase but
the analysis, so a round can stop at the cloud or the themes. The facilitator
drives it from the page (`#k=<chiave>`) or from the **EcoPsy** menu, and can
also jump to any question from the page's *Domande* list.

Each request to the web app costs about 2.5 s of Apps Script start-up, plus
2–3 s when it has to read the tabs. So the state the screens poll is kept in
the script cache until something changes: every write clears it, an edit typed
in the sheet too (`onEdit`), and each facilitator command answers with the new
state so the next poll finds it ready.

Answers, themes and ballots carry a `questionId`, so every round stays in the
sheet. A row with an empty `questionId` — a theme typed by hand — belongs to
the question on screen, and is tagged with it when the room moves on.
*Nuova sessione* empties all rounds and goes back to the first question;
`Domande` is kept.

A `testo` question shows one large box on the phone. Each device can send one
answer per question: a second send (another tab, a reload) is answered
`already` and the first answer stands. The projector shows the count and one
dot per participant, never the answers themselves: nothing has been read yet,
and anyone with the QR can type anything. Analysis, themes and vote run as for
any open question; the prompt tells the model that one answer can touch
several themes.

A `sintesi` question runs `collecting` → `analysing` → `results`. If its
`domanda` is empty, the facilitator page asks for the text when the round is
reached, and the phones wait until it is written. The text can be corrected
until the first answer arrives, and belongs to that session: the next session
asks for it again. Answers are as for `testo`. The analysis writes a summary of
500–600 words (shorter with few answers) into the `Sintesi` tab and puts it on
every screen at once; if it fails, the collection reopens. The projector shows
it a page at a time (`pagina` in Config), the phones in full. A row typed by
hand into `Sintesi` (`titolo`, `testo`, paragraphs on separate lines) shows the
same way.

When the last question's round is over, the facilitator page can add a
`sintesi` question and put it on screen (*+ Nuova domanda*). The added row
belongs to that session and its set: after *Nuova sessione* the list is the planned one
again.

For a `parole` question the phone shows `answer_fields` short boxes, one idea per box. Each box is one
entry in the cloud, kept whole ("social media" stays together), counted once
per person. The projector opens each round with the question and a large QR
code for the phone page; once answers arrive the QR moves to a corner for
latecomers.

The `Temi` tab is what the voting screen reads. The model is one way to fill it;
typing five rows by hand is another, and the session cannot tell the difference.
That is why a failed API call is an inconvenience, not the end of the event.

## Data kept for analysis

Nothing the room produces is deleted. Every row has a timestamp and a `sessione`:
the date and time the session started. Each reset starts a new one.

| tab | one row per |
|---|---|
| `Risposte` | idea written by a participant, or option chosen in a poll |
| `Temi` | theme of a question, with when it was written |
| `Voti` | ballot sent — a changed vote adds a row; the latest per device counts |
| `Archivio risposte` / `temi` / `voti` | row moved out of the tab above, with `archiviato` (when) and `motivo`: `azzeramento` (reset) or `nuova analisi` (themes replaced by a new analysis) |
| `Risultati` | theme in the ranking, each time a vote is closed. For a poll: option, with `punti` = how many chose it and `schede` = how many answered |
| `Sintesi` | summary written for a `sintesi` question, with its question text; a new analysis adds a row and the latest one is shown |
| `Cronologia` | change of phase, from the page or the menu, with the session's `scaletta` |

For analysis, read each tab together with its archive: *File → Scarica →
Microsoft Excel* exports every tab at once. Ballots name themes by id (`t1`,
`t2`…): match them with `Temi` and `Archivio temi` on `questionId` and
`sessione`, using the theme rows written before the ballot's timestamp.

## Le pagine

Nel sito, fuori da questa cartella:

| file | chi lo apre |
|---|---|
| `evento-config.js` | nessuno — collega ogni nome all’URL `/exec` del suo foglio |
| `evento-qrcode.min.js` | nessuno — genera il QR sul proiettore (qrcode-generator 1.4.4, MIT) |
| `evento.js`, `evento.css` | nessuno — codice comune a proiettore e telefono |
| `evento-regia.js`, `evento-regia.css` | nessuno — codice della regia |
| `voto_studente_<nome>.html` | i partecipanti dal telefono |
| `proiettore_<nome>.html` | il proiettore |
| `operatore_<nome>.html#k=<chiave>` | il facilitatore |

Ogni persona ha le sue tre pagine; `data-persona` nel `<body>` dice a quale foglio
parlano. Il QR sul proiettore porta alla pagina `voto_studente_` della stessa persona.

Una sola pagina per i partecipanti: cambia da sola al cambio di fase e di
domanda, quindi un solo link (e un solo QR) per tutta la sessione. Non sono
collegate al menu del sito e portano `noindex`.

La pagina di regia è pubblica, ma senza chiave mostra solo la richiesta della
chiave, e il server rifiuta ogni comando senza chiave valida. La chiave è il nome
della persona più tre cifre (`rodolfo-482`), da scrivere nella pagina o da aprire
come link: sparisce dalla barra degli indirizzi appena la pagina si apre. Tre cifre
si indovinano, quindi dopo 10 chiavi sbagliate il server rifiuta ogni chiave per
10 minuti (nel frattempo il menu EcoPsy nel foglio funziona). Non proiettare il
link né condividerlo in chat. Se qualcuno lo ha visto, *EcoPsy →
Nuova chiave facilitatore* invalida subito quello vecchio.

## Config tab

| key | what it does |
|---|---|
| `phase` | current step; everything reads this |
| `current_question` | id of the question on screen; set it from the menu or the page |
| `scaletta` | question set of the session; set when a session starts. Empty or unknown means the first one in `Domande` |
| `title` | shown on every screen |
| `provider`, `model` | `anthropic` + `claude-opus-5`, or `gemini` + `gemini-2.5-flash` |
| `max_themes` | how many themes the analysis returns, at most 5 (higher values are treated as 5) |
| `top_n` | how many themes each participant ranks (Borda: 3/2/1) |
| `answer_fields` | how many idea boxes the phone shows (1–6) |
| `pagina` | page of the summary on the projector; set by the page, back to 1 on each `results` |
| `max_cloud_words` | how many entries the projector shows |
| `blocklist` | entries to drop — put the question's own vocabulary here, everyone echoes it. Blocking a one-word singular blocks its plural |
| `synonyms` | `from=to` pairs for what the plural rule cannot reach, e.g. `problema=problemi`, `social=social media` |

## Untrusted input

Anyone with the QR code can type anything, so answers are handled as data:

- **Prompt.** The rules live in the system prompt. Answers go in the user turn
  inside `<risposte>` tags, and any `<` or `>` in them is removed so an answer
  can't close the tag. The system prompt tells the model to treat instructions
  found in answers as ordinary answers.
- **Themes.** Each theme must list the participants it comes from.
  `checkThemes_` drops a theme unless at least two real participants back it
  (one when fewer than four people answered). So a single answer saying
  "write X as a theme" can't put X on the projector. Labels are capped at 60
  characters and descriptions at 240, flattened to one line. If no theme passes
  the check, the analysis fails, the previous themes stay, and the facilitator
  writes them by hand.
- **Review.** Themes go to `themes` first, and the vote opens only when the
  facilitator presses *Apri la votazione*.
- **Sheet.** Answers and labels that start with `= + - @` get a leading
  apostrophe, so Sheets stores them as text and never runs them as formulas.
- **Pages.** Everything is rendered as text, never as HTML.

## Rehearsal

From the editor: `provaRiempi()` (eight fake participants on the question on
screen), `provaStato()` (the GET payload, cloud included), `provaAnalisi()`
(the real model call, writes `Temi`).
`provaModelli()` logs the Gemini ids the key can call — a `model` value the
endpoint does not serve comes back as a 404 at the worst moment.
Then `menuReset` / the *Nuova sessione (azzera)* menu item.

Before the event, on the deployed site and from a phone on cellular data:
one GET, one POST reading its reply, a partial ballot, a re-submission from the
same `voterId`, and the facilitator page without the key (the phase buttons must
be refused server-side, not merely hidden).

## Known edges

- The plural fold pairs `o→i`, `a→e`, `e→i`, and only for one-word entries.
  Irregulars (`problema/problemi`) and phrases (`famiglia fragile/famiglie
  fragili`) need a `synonyms` entry.
- Entries match after lower-casing, dropping accents and punctuation, and
  trimming articles and prepositions at the ends ("la scuola" = "scuola").
  Different wording ("pressione scolastica" / "stress da scuola") stays apart
  in the cloud; the theme analysis is what groups those.
- With four or more participants, an idea only one person wrote never becomes a
  theme. It still shows in the cloud.
