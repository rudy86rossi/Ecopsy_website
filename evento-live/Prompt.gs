/**
 * The prompt. Versioned, so a change in the shape of the themes is traceable.
 */

const PROMPT_VERSION = 'v2';

function buildPrompt_(cfg, answers) {
  // One line per participant, their ideas separated by " | ", so the model can
  // tell five people saying the same thing from one person saying it five times.
  const order = [], byVoter = {};
  answers.forEach(function (a) {
    if (!byVoter[a.voterId]) { byVoter[a.voterId] = []; order.push(a.voterId); }
    byVoter[a.voterId].push(a.text.replace(/\s+/g, ' '));
  });
  const numbered = order.map(function (v, i) {
    return (i + 1) + '. ' + byVoter[v].join(' | ');
  }).join('\n');

  return [
    'Sei il facilitatore di una sessione di lavoro con ' + order.length + ' partecipanti.',
    '',
    'La domanda posta era:',
    '"' + cfg.question.text + '"',
    '',
    'Ogni partecipante ha scritto fino a ' + cfg.answer_fields + ' idee brevi. ' +
    'Queste sono tutte le risposte, una riga per partecipante, idee separate da " | ":',
    numbered,
    '',
    'Estrai i temi ricorrenti, al massimo ' + cfg.max_themes + '.',
    '',
    'Regole:',
    '- Un tema deve raggruppare idee di persone diverse, non riformulare una singola idea.',
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
