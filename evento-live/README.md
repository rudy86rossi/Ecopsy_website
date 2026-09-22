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
3. Run `setup()` once from the editor. It creates `Config`, `Risposte`, `Temi`,
   `Voti`, `Log`. The first run asks for authorisation: *Avanzate → Apri progetto
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
{ "ok": true, "phase": "collecting", "title": "…", "question": "…", "topN": 3,
  "responses": 14, "ballots": 0,
  "cloud": [["ansia", 7], ["scuola", 5]],
  "themes": [{ "id": "t1", "label": "…", "description": "…" }],
  "results": null, "rev": "collecting-14-0-0", "serverTime": 1770000000000 }
```

`results` stays `null` until the facilitator closes the vote: a tally that moves
while people vote steers everyone who votes late. `rev` changes only when
something changed, so the projector can skip a redraw.

`POST <exec>` — one action per call:

| action | body | phase required |
|---|---|---|
| `submit` | `{voterId, text}` | `collecting` |
| `ballot` | `{voterId, ranking:["t2","t1","t5"]}` | `voting` |
| `phase` | `{key, to}` | facilitator key |
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

`collecting` → `analysing` → `themes` → `voting` → `results`, driven by the
facilitator from the page (`#k=<chiave>`) or from the **EcoPsy** menu.

The `Temi` tab is what the voting screen reads. The model is one way to fill it;
typing five rows by hand is another, and the session cannot tell the difference.
That is why a failed API call is an inconvenience, not the end of the event.

## Le pagine

Nel sito, fuori da questa cartella:

| file | chi lo apre |
|---|---|
| `evento-config.js` | nessuno — contiene solo l’URL `/exec`, da incollare una volta |
| `evento.html` | i partecipanti dal telefono |
| `evento.html?screen=1` | il proiettore |
| `evento-regia.html#k=<chiave>` | il facilitatore |

Una sola pagina per i partecipanti: cambia da sola al cambio di fase, quindi un
solo link (e un solo QR) per tutta la sessione. Non sono collegate al menu del
sito e portano `noindex`.

## Config tab

| key | what it does |
|---|---|
| `phase` | current step; everything reads this |
| `title`, `question` | shown on every screen |
| `provider`, `model` | `anthropic` + `claude-opus-5`, or `gemini` + `gemini-2.5-flash` |
| `max_themes` | hard cap, 6. Above 7 the ranking UI collapses on a phone |
| `top_n` | how many themes each participant ranks (Borda: 3/2/1) |
| `min_word_len`, `max_cloud_words` | word cloud shape |
| `blocklist` | words to drop — put the question's own vocabulary here, everyone echoes it. Blocking a singular blocks its plural |
| `synonyms` | `from=to` pairs for what the plural rule cannot reach, e.g. `problema=problemi` |

## Rehearsal

From the editor: `provaRiempi()` (eight fake answers), `provaStato()` (the GET
payload, cloud included), `provaAnalisi()` (the real model call, writes `Temi`).
Then `menuReset` / the *Azzera sessione* menu item.

Before the event, on the deployed site and from a phone on cellular data:
one GET, one POST reading its reply, a partial ballot, a re-submission from the
same `voterId`, and the facilitator page without the key (the phase buttons must
be refused server-side, not merely hidden).

## Known edges

- The plural fold pairs `o→i`, `a→e`, `e→i`. Irregulars (`problema/problemi`)
  need a `synonyms` entry.
- The cloud counts single words. "social media" shows up as two.
- Twenty short answers often produce a cloud where every count is 1. Below a
  threshold the projector should show the answers, not a tag cloud.
