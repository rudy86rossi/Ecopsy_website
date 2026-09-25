# Apps Script — sessione live EcoPsy

Server side of the live session: collection, word cloud, theme extraction, ranking.
The site's pages talk to it over one URL. Nothing runs on the web server.

The files here are the reference copy. Paste them into the Apps Script editor
(no `clasp` — seven files that change a handful of times a year do not justify a
second OAuth login and an npm toolchain).

## Setup, in order

1. Create a spreadsheet — **Estensioni → Apps Script** creates the bound project.
2. Paste each `.gs` file in, and replace `appsscript.json` (visible after
   *Impostazioni progetto → Mostra file manifest*).
3. Run `setup()` once from the editor. It creates `Config`, `Domande`, `Risposte`,
   `Temi`, `Voti`, `Log`. The first run asks for authorisation: *Avanzate → Apri progetto
   (non sicuro)*, then *Consenti*. The warning says the script never went through
   Google's review, which an unlisted internal script never does.
4. **Proprietà script** → add `ANTHROPIC_API_KEY` (or `GEMINI_API_KEY`, and set
   `provider` to `gemini` in the `Config` tab).
5. **Distribuisci → Nuova distribuzione → Web app**, *Esegui come: me*,
   *Chi ha accesso: chiunque, anche anonimo* — the Italian menu calls this option
   just *Chiunque*; *Chiunque con un Account Google* forces a login. Record the
   `/exec` URL.
6. Reload the spreadsheet → the **EcoPsy** menu appears → *Mostra chiave e link*.
   It generates `FACILITATOR_KEY`, and asks once for the `/exec` URL so it can
   show the facilitator link. Paste the URL from step 5: the editor also carries a
   *head deployment* with its own id, and only the versioned one reaches anonymous
   visitors.

> Every later change: **Gestisci distribuzioni → matita → Versione: Nuova versione**.
> "Nuova distribuzione" mints a *different* URL, the published pages keep calling
> the old one, and nothing announces it.

## Endpoints

`GET <exec>` — everything both screens need:

```json
{ "ok": true, "phase": "collecting", "title": "…",
  "question": "…", "questionId": "q1", "round": { "n": 1, "of": 3 },
  "questions": [{ "id": "q1", "text": "…" }], "answerFields": 3, "topN": 3,
  "responses": 14, "entries": 35, "ballots": 0,
  "cloud": [["social media", 7], ["scuola", 5]],
  "themes": [{ "id": "t1", "label": "…", "description": "…" }],
  "results": null, "rev": "q1-collecting-35-0-0", "serverTime": 1770000000000 }
```

Everything refers to the question on screen. `responses` counts participants,
`entries` the ideas they wrote.

`results` stays `null` until the facilitator closes the vote: a tally that moves
while people vote steers everyone who votes late. `rev` changes only when
something changed, so the projector can skip a redraw.

`POST <exec>` — one action per call:

| action | body | phase required |
|---|---|---|
| `submit` | `{voterId, items:["…","…"]}` — up to `answer_fields`, 80 characters each | `collecting` |
| `ballot` | `{voterId, ranking:["t2","t1","t5"]}` | `voting` |
| `phase` | `{key, to}` | facilitator key |
| `question` | `{key, to}` — a question id, or `"next"` | facilitator key |
| `analyze` | `{key}` | facilitator key |
| `reset` | `{key, confirm:"RESET"}` | facilitator key |

Every reply is HTTP 200 with `{ok: true|false}`; `ok:false` carries `error`.

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

The questions are the rows of the `Domande` tab (`id`, `domanda`), one round
each. A round runs `collecting` → `analysing` → `themes` → `voting` → `results`;
*Domanda successiva* then opens the next question's `collecting`. The facilitator
drives it from the page (`#k=<chiave>`) or from the **EcoPsy** menu, and can
also jump to any question from the page's *Domande* list.

Answers, themes and ballots carry a `questionId`, so every round stays in the
sheet. A row with an empty `questionId` — a theme typed by hand — belongs to
the question on screen, and is tagged with it when the room moves on.
*Azzera sessione* empties all rounds and goes back to the first question;
`Domande` is kept.

The phone shows `answer_fields` short boxes, one idea per box. Each box is one
entry in the cloud, kept whole ("social media" stays together), counted once
per person. The projector opens each round with the question and a large QR
code for the phone page; once answers arrive the QR moves to a corner for
latecomers.

The `Temi` tab is what the voting screen reads. The model is one way to fill it;
typing five rows by hand is another, and the session cannot tell the difference.
That is why a failed API call is an inconvenience, not the end of the event.

## Le pagine

Nel sito, fuori da questa cartella:

| file | chi lo apre |
|---|---|
| `evento-config.js` | nessuno — contiene solo l’URL `/exec`, da incollare una volta |
| `evento-qrcode.min.js` | nessuno — genera il QR sul proiettore (qrcode-generator 1.4.4, MIT) |
| `evento.html` | i partecipanti dal telefono |
| `evento.html?screen=1` | il proiettore |
| `evento-regia.html#k=<chiave>` | il facilitatore |

Una sola pagina per i partecipanti: cambia da sola al cambio di fase e di
domanda, quindi un solo link (e un solo QR) per tutta la sessione. Non sono
collegate al menu del sito e portano `noindex`.

La pagina di regia è pubblica, ma senza chiave mostra solo la richiesta della
chiave, e il server rifiuta ogni comando senza chiave valida. La chiave è di 64
caratteri e sparisce dalla barra degli indirizzi appena la pagina si apre: non
proiettare il link né condividerlo in chat. Se qualcuno lo ha visto, *EcoPsy →
Nuova chiave facilitatore* invalida subito quello vecchio.

## Config tab

| key | what it does |
|---|---|
| `phase` | current step; everything reads this |
| `current_question` | id of the question on screen; set it from the menu or the page |
| `title` | shown on every screen |
| `provider`, `model` | `anthropic` + `claude-opus-5`, or `gemini` + `gemini-2.5-flash` |
| `max_themes` | hard cap, 6. Above 7 the ranking UI collapses on a phone |
| `top_n` | how many themes each participant ranks (Borda: 3/2/1) |
| `answer_fields` | how many idea boxes the phone shows (1–6) |
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
Then `menuReset` / the *Azzera sessione* menu item.

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
