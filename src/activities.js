// Conjunto diario + "Continuar ganhando". No site novo o ponto e creditado quando o card e
// clicado (o clique dispara a server action reportActivity e abre o destino numa aba nova).
// O bot clica o card de verdade, fica um pouco na pagina aberta e, se for quiz, responde.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { chance, humanClick, humanScroll, pause, randInt } from './human.js';
import { DASHBOARD, EARN, dismissCookieBanner, gotoRewards, isEligible, listCards } from './rewards.js';

const SECTIONS = [
  { name: 'conjunto diario', url: DASHBOARD, selector: '#dailyset' },
  { name: 'continuar ganhando', url: EARN, selector: '#moreactivities' },
];

const QUIZ_OPTIONS = '.btq_opt a:visible';
const QUIZ_NEXT = '.btq_nxtQues button:visible';

/**
 * Quiz do Bing (card .btq_main): alternativas sao links .btq_opt; depois de responder aparece
 * a explicacao com o botao "Avancar". O WQSCORE na URL de cada alternativa e a pontuacao
 * acumulada se ela for escolhida, entao a correta e a de maior WQSCORE.
 */
async function answerQuiz(tab, log) {
  const label = await tab.locator('.btq_prog:visible, .btq_lbl:visible').first().innerText().catch(() => '');
  const total = Number((label.match(/\/\s*(\d+)/) ?? [])[1]) || 3;
  for (let question = 1; question <= total; question++) {
    const next = tab.locator(QUIZ_NEXT).first();
    if (await next.isVisible().catch(() => false)) {
      await pause(2000, 5000); // lendo a explicacao
      await humanClick(tab, next);
      await pause(800, 1800);
    }
    const options = tab.locator(QUIZ_OPTIONS);
    const count = await options.count();
    if (!count) return;
    await pause(3000, 8000); // lendo a pergunta
    const scores = await options.evaluateAll((links) =>
      links.map((a) => Number((decodeURIComponent(a.href).match(/WQSCORE:"(\d+)"/) ?? [])[1] ?? 0)),
    );
    const best = Math.max(...scores);
    const known = scores.filter((s) => s === best).length === 1;
    // Acerta a maioria, mas nao todas.
    const choice = known && !chance(0.2) ? scores.indexOf(best) : randInt(0, count - 1);
    const before = tab.url();
    await humanClick(tab, options.nth(choice));
    await tab.waitForURL((u) => u.href !== before, { timeout: 15000 }).catch(() => {});
    await tab.waitForLoadState('domcontentloaded').catch(() => {});
    log(`  quiz: pergunta ${question}/${total} respondida`);
    await pause(2000, 4500);
  }
}

// Card do Bing Image Creator ("crie um papel de parede..."): a pagina gera a imagem sozinha, mas
// o ponto so e creditado quando o botao "Definir como papel de parede" da imagem e clicado (e
// esse clique que chama reportactivity; data-sawofferid e a oferta do Rewards ligada ao botao).
const IMAGE_OFFER = 'aigc-action-bar[data-sawofferid]:not([data-sawofferid=""])';
const IMAGE_READY = 'aigc-media-viewer[data-status="success"]';

async function setAsWallpaper(tab, context, log) {
  await tab.locator(IMAGE_READY).first().waitFor({ timeout: 90000 }).catch(() => {});
  const button = tab.locator(`${IMAGE_OFFER} .aigc-wallpaper-btn button`).first();
  if (!(await button.isVisible().catch(() => false))) return log('  image creator: a imagem nao ficou pronta a tempo');
  await pause(3000, 8000); // olhando a imagem
  // O clique abre a pagina do app Bing Wallpaper. O bot so olha e fecha: nao baixa o app nem
  // aceita o aviso de "abrir aplicativo", entao o papel de parede do PC nao muda.
  const popup = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  await humanClick(tab, button);
  const upsell = await popup;
  if (upsell) {
    upsell.on('dialog', (d) => d.dismiss().catch(() => {}));
    await upsell.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
    await pause(2500, 6000);
    await upsell.close().catch(() => {});
  }
  log('  image creator: "definir como papel de parede" clicado');
  await pause(1500, 4000);
}

/** Fica na pagina aberta por um card e faz o que ela pede (quiz, imagem) ou so le um pouco. */
export async function visit(tab, context, log) {
  await tab.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await pause(2500, 5000);
  await dismissCookieBanner(tab);
  if (await tab.locator(QUIZ_OPTIONS).count()) {
    await answerQuiz(tab, log);
  } else if (await tab.locator(IMAGE_OFFER).count()) {
    await setAsWallpaper(tab, context, log);
  } else {
    await humanScroll(tab);
    await pause(3000, 9000);
  }
}

// Cards que continuam pendentes depois de clicados (exigem uma acao real, como criar uma imagem).
// Depois de 2 tentativas frustradas o bot deixa o card de lado por 30 dias.
const FAILED_FILE = path.join(config.dataDir, 'failed-cards.json');
const MAX_FAILS = 2;
const FORGET_DAYS = 30;

const failKey = (c) => `${c.title}|${c.points}`;

function loadFailed() {
  let failed = {};
  try {
    failed = JSON.parse(fs.readFileSync(FAILED_FILE, 'utf8'));
  } catch {
    /* primeiro uso */
  }
  const cutoff = Date.now() - FORGET_DAYS * 864e5;
  return Object.fromEntries(Object.entries(failed).filter(([, f]) => f?.last > cutoff));
}

/** Cards pendentes que valem a tentativa (serve para cards do DOM e do payload). */
export function pendingCards(cards, failed = loadFailed()) {
  return cards.filter((c) => isEligible(c) && (failed[failKey(c)]?.count ?? 0) < MAX_FAILS);
}

/** Cards que o bot deixou de lado: continuaram pendentes depois de MAX_FAILS tentativas. */
export function setAsideCards(cards, failed = loadFailed()) {
  return cards.filter((c) => isEligible(c) && (failed[failKey(c)]?.count ?? 0) >= MAX_FAILS);
}

export async function runActivities({ context, page, log }) {
  const failed = loadFailed();
  let done = 0;
  for (const section of SECTIONS) {
    // Dois cards diferentes podem apontar para a mesma URL; a chave inclui o titulo.
    const key = (c) => `${c.href}|${c.title}`;
    const attempted = new Set();
    for (;;) {
      await gotoRewards(page, section.url);
      const cards = await listCards(page, section.selector);
      const card = pendingCards(cards, failed).find((c) => !attempted.has(key(c)));
      if (!card) break;
      attempted.add(key(card));
      log(`${section.name}: "${card.title}" (+${card.points})`);

      const link = page.locator(`${section.selector} a[href]`).nth(card.index);
      const popup = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
      await humanClick(page, link);
      const tab = await popup;
      if (tab) {
        tab.on('dialog', (d) => d.dismiss().catch(() => {}));
        await visit(tab, context, log);
        await tab.close().catch(() => {});
      } else if (page.url() !== section.url) {
        await visit(page, context, log); // card que navega na mesma aba
      }
      done++;
      await page.bringToFront();
      await pause(2500, 7000);
    }

    // Confere o que ficou pendente depois das tentativas.
    await gotoRewards(page, section.url);
    const left = (await listCards(page, section.selector)).filter(isEligible);
    for (const c of left) {
      if (attempted.has(key(c))) {
        failed[failKey(c)] = { count: (failed[failKey(c)]?.count ?? 0) + 1, last: Date.now() };
      }
      const givenUp = (failed[failKey(c)]?.count ?? 0) >= MAX_FAILS;
      log(`${section.name}: ainda pendente "${c.title}" (+${c.points})${givenUp ? ' - nao completa so com clique, deixando de lado' : ''}`);
    }
    if (!left.length) log(`${section.name}: tudo concluido`);
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FAILED_FILE, JSON.stringify(failed, null, 1));
  return done;
}
