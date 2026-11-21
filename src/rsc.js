// Parser do estado do Rewards a partir do HTML de /earn ou /dashboard.
// O site e Next.js: os dados vem embutidos no HTML em chamadas self.__next_f.push([1,"..."])
// (payload RSC). Daqui saem saldo, contador de busca, conjunto diario e cards, sem tocar no DOM.
// Serve tanto para HTML baixado por requisicao quanto para page.content() do navegador.

const PUSH = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;

function decodeRsc(html) {
  let out = '';
  for (const m of html.matchAll(PUSH)) {
    try {
      out += JSON.parse(`"${m[1]}"`);
    } catch {
      /* pedaco invalido: ignora */
    }
  }
  return out;
}

/** Todos os objetos {"type":"<type>","model":{...}} do payload. */
function models(rsc, type) {
  const tag = `"type":"${type}","model":`;
  const found = [];
  let from = 0;
  for (let i = rsc.indexOf(tag, from); i >= 0; i = rsc.indexOf(tag, from)) {
    const start = i + tag.length;
    let j = start;
    let depth = 0;
    let inString = false;
    for (; j < rsc.length; j++) {
      const c = rsc[j];
      if (inString) {
        if (c === '\\') j++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{' || c === '[') depth++;
      else if ((c === '}' || c === ']') && --depth === 0) break;
    }
    try {
      found.push(JSON.parse(rsc.slice(start, j + 1)));
    } catch {
      /* formato mudou: ignora */
    }
    from = j + 1;
  }
  return found;
}

/** Cards de atividade: objetos "planos" com offerId, points e isCompleted. */
function cards(rsc) {
  const byId = new Map();
  for (const m of rsc.matchAll(/\{[^{}]*"offerId":"[^"{}]+"[^{}]*\}/g)) {
    let o;
    try {
      o = JSON.parse(m[0]);
    } catch {
      continue;
    }
    if (typeof o.destination !== 'string' || !('isCompleted' in o) || !o.title) continue;
    byId.set(o.offerId, {
      section: o.date ? 'dailyset' : 'more',
      offerId: o.offerId,
      title: String(o.title).replace(/\p{Cc}+/gu, ' ').trim(), // vai para o terminal: sem caractere de controle
      points: Number(o.points) || 0,
      done: o.isCompleted === true,
      href: new URL(o.destination, 'https://rewards.bing.com').href,
    });
  }
  return [...byId.values()];
}

/**
 * Dia do Rewards (AAAA-MM-DD), tirado da data do conjunto diario. O dia do Rewards nao vira a
 * meia-noite local, entao isto e mais confiavel que o relogio para agrupar o historico.
 */
function rewardsDay(rsc) {
  const m = rsc.match(/"date":"(\d{1,2})\/(\d{1,2})\/(\d{4})"/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : undefined;
}

const counter = (c) => (c && Number.isFinite(c.max) ? { earned: c.progress ?? 0, max: c.max } : null);

/** Soma de pontos pendentes de reivindicacao (estrutura exata desconhecida: procura numeros). */
function claimable(model) {
  if (!model || model.pointClaim == null) return 0;
  const direct = JSON.stringify(model.pointClaim).match(/"(?:total[A-Za-z]*|points|amount)":(\d+)/);
  return direct ? Number(direct[1]) : true;
}

/**
 * Extrai o que der do HTML. Campos ausentes naquela pagina vem como undefined
 * (ex.: o contador de busca so existe em /earn; os pontos a reivindicar so em /dashboard).
 * Retorna null se o HTML nao for uma pagina logada do Rewards.
 */
export function parseRewards(html) {
  const rsc = decodeRsc(html);
  const balance = rsc.match(/"balance":(\d+)/);
  if (!balance) return null;

  const state = { balance: Number(balance[1]), cards: cards(rsc) };
  state.day = rewardsDay(rsc);

  const counters = models(rsc, 'pointbreakdown')[0]?.pointsCounters;
  if (counters) {
    state.search = counter(counters.pc);
    state.mobileSearch = counter(counters.mobile);
    state.todayPoints = counters.totalPoints;
  }
  const claim = models(rsc, 'pointsclaim')[0];
  if (claim) state.claimable = claimable(claim);

  state.streaks = [...models(rsc, 'streak'), ...models(rsc, 'dailyset')]
    .map((m) => m.streak)
    .filter(Boolean)
    .map((s) => ({ name: s.partner, done: s.activitiesCompleted, total: s.activitiesTotal, day: s.completedDays, days: s.totalDays }));
  return state;
}
