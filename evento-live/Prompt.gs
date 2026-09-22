/**
 * The prompt. Versioned, so a change in the shape of the themes is traceable.
 */

const PROMPT_VERSION = 'v1';

function buildPrompt_(cfg, answers) {
  const numbered = answers.map(function (a, i) {
    return (i + 1) + '. ' + a.text.replace(/\s+/g, ' ');
  }).join('\n');

  return [
    'Sei il facilitatore di una sessione di lavoro con ' + answers.length + ' partecipanti.',
    '',
    'La domanda posta era:',
    '"' + cfg.question + '"',
    '',
    'Queste sono tutte le risposte raccolte:',
    numbered,
    '',
    'Estrai i temi ricorrenti, al massimo ' + cfg.max_themes + '.',
    '',
    'Regole:',
    '- Un tema deve raggruppare risposte di persone diverse, non riformulare una singola risposta.',
    '- Ordina i temi dal più ricorrente al meno ricorrente.',
    '- "label": 3-5 parole, in italiano, leggibile da lontano su un proiettore.',
    '- "description": una frase che dice cosa hanno effettivamente scritto i partecipanti.',
    '- Usa le parole dei partecipanti dove puoi; non introdurre concetti che nessuno ha nominato.',
    '- Se le risposte sono in lingue diverse, i temi restano in italiano.',
    '- Se ci sono meno temi distinti del massimo consentito, restituiscine di meno.',
    '',
    'I partecipanti sceglieranno fra questi temi, quindi devono essere distinguibili fra loro.'
  ].join('\n');
}

/** What we want back. Kept in one place; each provider adapts it to its own dialect. */
function themeSchema_() {
  return {
    type: 'object',
    properties: {
      themes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            description: { type: 'string' }
          },
          required: ['label', 'description'],
          additionalProperties: false
        }
      }
    },
    required: ['themes'],
    additionalProperties: false
  };
}
