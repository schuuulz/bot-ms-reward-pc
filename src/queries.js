// Gerador de buscas. A ideia e parecer uma pessoa de verdade:
//  - os assuntos mudam todo dia (tendencias do Google BR, mais lidos da Wikipedia, manchetes do G1);
//  - o resto vem de "moldes" do dia a dia (receita de..., como fazer...) completados pelas
//    sugestoes reais do Bing, ou seja, frases que as pessoas realmente digitam;
//  - as buscas vem em "assuntos": 1 a 4 buscas encadeadas refinando o mesmo tema;
//  - nada se repete: tudo passa pelo historico (data/history.json).

import { config } from './config.js';
import { chance, pick, shuffle } from './human.js';
import { normalize } from './history.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

async function getText(url, ms = 8000) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

/** Sugestoes de autocompletar do Bing para um prefixo. */
export async function suggest(prefix) {
  try {
    const url = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(prefix)}&market=pt-BR`;
    const json = JSON.parse(await getText(url, 5000));
    return Array.isArray(json[1]) ? json[1] : [];
  } catch {
    return [];
  }
}

const decodeXml = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const rssTitles = (xml) =>
  [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g)].map((m) =>
    decodeXml(m[1]).trim(),
  );

/**
 * Transforma manchete em algo que uma pessoa digitaria: so o nome proprio principal
 * ("Pedro Sampaio fara show do intervalo na final da Libertadores" -> "Pedro Sampaio").
 */
function headlineToPhrase(headline) {
  const words = headline.replace(/["'“”‘’:;,|?!]/g, ' ').split(/\s+/).filter(Boolean);
  const isCap = (w) => /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ-]+$/.test(w);
  const isJoin = (w) => /^(de|da|do|das|dos|e)$/.test(w);
  const runs = [];
  for (let i = 0; i < words.length; i++) {
    if (!isCap(words[i])) continue;
    let j = i;
    while (j + 1 < words.length && (isCap(words[j + 1]) || (isJoin(words[j + 1]) && isCap(words[j + 2] ?? '')))) j++;
    // Palavra sozinha no inicio da frase nao conta: toda manchete comeca com maiuscula.
    if (j > i || (i > 0 && words[i].length >= 4)) runs.push(words.slice(i, j + 1));
    i = j;
  }
  runs.sort((a, b) => b.length - a.length);
  return runs[0] ? runs[0].slice(0, 5).join(' ') : null;
}

const SOURCES = {
  async trends() {
    return rssTitles(await getText('https://trends.google.com/trending/rss?geo=BR'));
  },
  async wikipedia() {
    const d = new Date(Date.now() - 864e5);
    const ymd = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
    const json = JSON.parse(await getText(`https://pt.wikipedia.org/api/rest_v1/feed/featured/${ymd}`));
    return (json.mostread?.articles ?? [])
      .map((a) => a.normalizedtitle)
      .filter((t) => t && !t.includes(':') && !/^(Wikip|Página principal)/.test(t))
      .slice(0, 30);
  },
  async g1() {
    return rssTitles(await getText('https://g1.globo.com/rss/g1/'))
      .slice(0, 40)
      .map(headlineToPhrase)
      .filter(Boolean);
  },
};

// Moldes do dia a dia. O Bing completa com o que as pessoas realmente pesquisam.
const STEMS = [
  'receita de', 'como fazer', 'como funciona', 'o que é', 'o que significa', 'quanto custa', 'melhor',
  'melhores', 'preço', 'previsão do tempo', 'onde assistir', 'resultado', 'horário', 'significado de',
  'sintomas de', 'filme', 'série', 'letra', 'notícias', 'cotação', 'tabela', 'passagem para',
  'o que fazer em', 'hotel em', 'restaurante', 'como tirar', 'como limpar', 'como instalar',
  'como configurar', 'diferença entre', 'review', 'ficha técnica', 'treino de', 'dieta', 'benefícios',
  'calendário', 'feriado', 'concurso', 'vagas', 'curso de', 'tradução', 'sinônimo de', 'calculadora de',
  'conversor de', 'jogo do', 'escalação', 'classificação', 'história de', 'quem foi', 'capital',
  'população', 'distância entre', 'como chegar', 'telefone', 'endereço', 'promoção', 'cupom',
  'frases de', 'nomes de', 'ideias de', 'dicas de', 'tutorial', 'download', 'atualização', 'lançamento',
  'trailer', 'elenco', 'resumo', 'idade', 'altura', 'quando é', 'quando começa', 'como plantar',
  'como cuidar de', 'remédio para', 'chá de', 'exercícios para', 'simulado', 'inscrição', 'boleto',
  'segunda via', 'consulta', 'rastreamento', 'aluguel', 'carro', 'moto', 'celular', 'notebook', 'tv',
  'tênis', 'presente para', 'decoração', 'reforma', 'planta', 'cachorro', 'gato', 'viagem', 'praia',
  'trilha', 'museu', 'show', 'ingresso', 'jogo', 'campeonato', 'placar', 'tabela do', 'mapa de',
];
const LETTERS = 'aaaabbcccddeeefgghijlmmmnoppprrssstttuv';

const BLOCKED = /(porn|xvideos|xnxx|sexo|nudes?\b|onlyfans|hentai|putaria|estupr|suic[ií]d|pedofil|acompanhantes)/i;

const usable = (q) => q && q.length >= 3 && q.length <= 70 && !BLOCKED.test(q);

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Do jeito que se digita na barra de busca: minusculas, as vezes sem acento. */
function stylize(q) {
  let s = q.toLowerCase().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ').trim();
  if (chance(config.search.stripAccentsChance)) s = stripAccents(s);
  return s;
}

export class QueryPlanner {
  constructor(history, log = () => {}) {
    this.history = history;
    this.log = log;
    this.topical = [];
    this.planned = new Set();
  }

  async init() {
    const results = await Promise.allSettled(Object.values(SOURCES).map((f) => f()));
    const names = Object.keys(SOURCES);
    const lists = results.map((r, i) => {
      const items = r.status === 'fulfilled' ? r.value : [];
      this.log(`fonte ${names[i]}: ${items.length} assuntos${r.status === 'rejected' ? ` (falhou: ${r.reason.message})` : ''}`);
      return items;
    });
    // Tendencias ja sao buscas reais, entram todas; das outras fontes, uma amostra.
    const sample = lists.flatMap((items, i) => (names[i] === 'trends' ? items : shuffle(items).slice(0, 12)));
    this.topical = shuffle(sample).filter((q) => this.fresh(q));
  }

  fresh(q) {
    return usable(q) && !this.history.has(q) && !this.planned.has(normalize(q));
  }

  take(q) {
    this.planned.add(normalize(q));
    return q;
  }

  /** Uma frase vinda de um molde + letra aleatoria, completada pelo Bing. */
  async evergreen() {
    for (let i = 0; i < 6; i++) {
      const stem = pick(STEMS);
      if (this.history.stemRecent(stem)) continue;
      const prefix = chance(0.25) ? `${stem} ` : `${stem} ${pick([...LETTERS])}`;
      const options = (await suggest(prefix)).filter((q) => this.fresh(q));
      if (!options.length) continue;
      this.history.addStem(stem);
      return pick(options.slice(0, 10));
    }
    return null;
  }

  /** Refinamento do assunto anterior (o que o Bing sugere depois da busca + espaco). */
  async followUp(prev) {
    const p = normalize(prev);
    const options = (await suggest(`${prev} `)).filter((q) => normalize(q) !== p && this.fresh(q));
    return options.length ? stylize(this.take(pick(options.slice(0, 8)))) : null;
  }

  /**
   * Proximo "assunto": lista de 1 a 4 passos. Cada passo e { q } (digitar) ou
   * { related: true } (clicar numa pesquisa relacionada na pagina de resultados).
   */
  async nextCluster() {
    for (let attempt = 0; attempt < 12; attempt++) {
      let base = null;
      if (this.topical.length && chance(0.45)) {
        base = this.topical.pop();
        // Manchetes e titulos viram a forma popular da busca, quando existe.
        if (chance(0.5)) base = (await suggest(base)).filter((q) => this.fresh(q))[0] ?? base;
      } else {
        base = await this.evergreen();
      }
      if (!base || !this.fresh(base)) continue;

      const cluster = [{ q: stylize(this.take(base)) }];
      const size = pick([1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 4]);
      let prev = base;
      for (let i = 1; i < size; i++) {
        if (chance(config.search.relatedChance)) {
          cluster.push({ related: true, prev });
          continue;
        }
        const next = await this.followUp(prev);
        if (!next) break;
        cluster.push({ q: next });
        prev = next;
      }
      return cluster;
    }
    // Sem rede ou sem sugestoes: ultimo recurso, combina moldes locais.
    const tails = ['hoje', 'perto de mim', 'online', 'gratis', 'passo a passo', 'em casa', 'barato', 'simples'];
    const combos = shuffle(STEMS).flatMap((s) => tails.map((t) => `${s} ${t}`));
    return [{ q: stylize(this.take(combos.find((q) => this.fresh(q)) ?? combos[0])) }];
  }
}
