// Leitura do site novo do Rewards (rewards.bing.com, Next.js). Tudo por estrutura
// (ids de secao, padroes numericos), sem depender do idioma da pagina.

import { config } from './config.js';
import { humanClick, pause } from './human.js';
import { parseRewards } from './rsc.js';

export const DASHBOARD = 'https://rewards.bing.com/dashboard';
export const EARN = 'https://rewards.bing.com/earn';

const digits = (s) => Number(String(s).replace(/\D/g, '') || 0);

export class NotLoggedInError extends Error {}

export async function gotoRewards(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.locator('main section').first().waitFor({ timeout: 25000 });
  } catch {
    if (!/rewards\.bing\.com\/(dashboard|earn)/.test(page.url())) {
      throw new NotLoggedInError(
        `o Rewards redirecionou para ${page.url()}; a conta nao esta logada no Edge do bot (msr login)`,
      );
    }
    throw new Error('O dashboard do Rewards nao carregou');
  }
  await dismissCookieBanner(page);
  await pause(800, 1800);
}

/** Banner de cookies (Bing: #bnp_btn_*, Rewards: banner WCP da Microsoft). */
export async function dismissCookieBanner(page) {
  const reject = config.cookieBanner === 'reject';
  const candidates = [
    page.locator(reject ? '#bnp_btn_reject' : '#bnp_btn_accept'),
    page.locator('#wcpConsentBannerCtrl button').nth(reject ? 1 : 0),
    page.locator('[role="alert"] button').nth(reject ? 1 : 0),
  ];
  for (const btn of candidates) {
    try {
      if (await btn.isVisible()) {
        await humanClick(page, btn);
        await pause(500, 1200);
        return;
      }
    } catch {
      /* banner sumiu sozinho */
    }
  }
}

/** Botoes do topo do <main> (fora das secoes): pontos de hoje, nivel, reivindicar... */
const topButtons = (page) => page.locator('main button:not(section button)');

async function closeDialog(page) {
  await page.keyboard.press('Escape');
  await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}

/**
 * Contador de pontos de busca de hoje, lido no painel "Detalhamento de pontos" da aba Ganhar.
 * Retorna { earned, max } (ex.: 39/60) ou null se nao achar.
 */
export async function readSearchProgress(page) {
  await gotoRewards(page, EARN);
  const parsed = parseRewards(await page.content())?.search;
  if (parsed) {
    await pause(1500, 4000);
    return parsed;
  }
  // Formato dos dados embutidos mudou: le pelo painel, como uma pessoa faria.
  const dialog = page.locator('[role="dialog"]');
  for (let i = 0; i < 2; i++) {
    const btn = topButtons(page).nth(i);
    if (!(await btn.isVisible().catch(() => false))) break;
    await humanClick(page, btn);
    try {
      await dialog.filter({ hasText: /\d\s*\/\s*\d/ }).waitFor({ timeout: 12000 });
    } catch {
      await closeDialog(page);
      continue;
    }
    const m = (await dialog.innerText()).match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/);
    await pause(900, 2200);
    await closeDialog(page);
    if (m) return { earned: digits(m[1]), max: digits(m[2]) };
  }
  return null;
}

/**
 * Estado completo lido pelo navegador (mesmo formato de fetchState em http.js):
 * saldo, contador de busca, cards e pontos a reivindicar.
 */
export async function readState(page) {
  await gotoRewards(page, EARN);
  const earn = parseRewards(await page.content());
  await gotoRewards(page, DASHBOARD);
  const dashboard = parseRewards(await page.content());
  return earn ? { ...earn, claimable: dashboard?.claimable } : dashboard;
}

/**
 * Cards de uma secao (#dailyset no dashboard, #moreactivities na aba Ganhar).
 * Card pendente termina em "+N"; card concluido mostra so "N" e o texto de concluido.
 */
export async function listCards(page, section) {
  return page.locator(`${section} a[href]`).evaluateAll((links) =>
    links.map((a, index) => {
      const lines = a.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
      const m = lines.join(' ').match(/\+\s*(\d+)\s*$/);
      return { index, href: a.href, title: lines[0] ?? '', points: m ? Number(m[1]) : null };
    }),
  );
}

/**
 * So cards pendentes que dao pontos com um clique + visita; nada de download, resgate ou compra.
 * Aceita cards do DOM (listCards) e do payload (parseRewards).
 */
export function isEligible(card) {
  if (card.done || !card.points) return false;
  let url;
  try {
    url = new URL(card.href);
  } catch {
    return false;
  }
  if (!/(^|\.)bing\.com$/.test(url.hostname)) return false;
  return !/autodownload|\/redeem|apps\/wallpaper/i.test(card.href);
}

/**
 * Reivindica os pontos pendentes ("Pronto para reivindicar"). No site novo os bonus
 * precisam ser reivindicados ou expiram. Retorna quantos pontos reivindicou.
 */
export async function claimPoints(page, log = () => {}, { preview = false } = {}) {
  await gotoRewards(page, DASHBOARD);
  const dialog = page.locator('[role="dialog"]');
  const count = Math.min(await topButtons(page).count(), 4);
  for (let i = 0; i < count; i++) {
    const btn = topButtons(page).nth(i);
    const amount = digits(await btn.innerText().catch(() => ''));
    if (!amount) continue;
    // O botao certo e o que abre um painel com um botao mostrando exatamente o mesmo valor.
    await humanClick(page, btn);
    try {
      await dialog.waitFor({ timeout: 6000 });
      await pause(1500, 3000);
    } catch {
      continue;
    }
    const inner = dialog.locator('button:not([aria-label])');
    let claimBtn = null;
    for (let j = 0; j < (await inner.count()); j++) {
      if (digits(await inner.nth(j).innerText()) === amount) claimBtn = inner.nth(j);
    }
    if (!claimBtn) {
      await closeDialog(page);
      continue;
    }
    if (preview) {
      log(`${amount} pontos prontos para reivindicar (--preview: nao cliquei)`);
      await closeDialog(page);
      return 0;
    }
    await humanClick(page, claimBtn);
    await pause(3000, 5000);
    await closeDialog(page);
    log(`reivindicados ${amount} pontos pendentes`);
    return amount;
  }
  log('nada pendente para reivindicar');
  return 0;
}
