// Orquestracao de uma execucao: le o estado (por requisicao, sem navegador, quando da), decide
// o que ha para fazer, e so entao abre o Edge. No fim grava o historico do dia.

import fs from 'node:fs';
import path from 'node:path';
import { pendingCards, runActivities } from './activities.js';
import { closeBrowser, openBrowser } from './browser.js';
import { config } from './config.js';
import { History } from './history.js';
import { exportSession, fetchState } from './http.js';
import { sessionQuota } from './pacing.js';
import { claimPoints, readState } from './rewards.js';
import { runSearches } from './searches.js';
import { recordDay } from './stats.js';

/** Ja existe outra execucao em andamento (agendada + manual ao mesmo tempo). */
export class BusyError extends Error {}

function acquireLock() {
  const file = path.join(config.dataDir, 'run.lock');
  fs.mkdirSync(config.dataDir, { recursive: true });
  try {
    process.kill(Number(fs.readFileSync(file, 'utf8')), 0); // lanca se o processo nao existe mais
  } catch {
    fs.writeFileSync(file, String(process.pid));
    return () => fs.rmSync(file, { force: true });
  }
  throw new BusyError('ja existe uma execucao do msr em andamento');
}

/** Abre o Edge do bot, roda fn(page, context) e fecha, sempre exportando os cookies no fim. */
export async function withBrowser({ show = false, keepOpen = false } = {}, fn) {
  const session = await openBrowser({ headless: !show && config.headless });
  const page = await session.context.newPage();
  try {
    return await fn(page, session.context);
  } finally {
    await exportSession(session.context, page).catch(() => {});
    await page.close().catch(() => {});
    if (keepOpen) await session.browser.close().catch(() => {}); // so desconecta
    else await closeBrowser(session);
  }
}

/** Estado atual: por requisicao se possivel, senao pelo navegador. Retorna { state, source }. */
export async function currentState(opts = {}) {
  const viaHttp = config.httpStatus && !opts.noHttp ? await fetchState() : null;
  if (viaHttp) return { state: viaHttp, source: 'requisicao' };
  return { state: await withBrowser(opts, (page) => readState(page)), source: 'navegador' };
}

/**
 * O que fazer a partir de um estado.
 *  - parts: quais partes foram pedidas ('cards', 'searches');
 *  - paced: so a fatia de buscas do horario; count: teto/quantidade exata (com force).
 */
export function plan(state, { parts, paced = false, count, claim = false }) {
  const todo = { cards: false, searches: false, limit: count, force: false, claim: false };
  todo.cards = parts.includes('cards') && pendingCards(state.cards).length > 0;
  todo.claim = claim && state.claimable !== 0;

  if (parts.includes('searches')) {
    if (count != null && !paced) {
      Object.assign(todo, { searches: count > 0, force: true }); // `msr search N`: exatamente N
    } else if (!state.search) {
      todo.searches = true; // contador ilegivel: tenta mesmo assim
    } else if (paced) {
      todo.limit = sessionQuota({ search: state.search, pointsPerSearch: config.search.pointsPerSearch, pacing: config.pacing });
      todo.searches = todo.limit > 0;
    } else {
      todo.searches = state.search.earned < state.search.max;
    }
  }
  return todo;
}

/**
 * Executa. Retorna { opened, before, after, cards, searches, stalled, issues }.
 * `opened: false` significa que nao havia nada a fazer e o navegador nem foi aberto.
 */
export async function run({ parts = ['cards', 'searches'], paced, count, claim, preview, noHttp, show, keepOpen, log }) {
  const release = acquireLock();
  try {
    const fullRun = parts.includes('cards') && parts.includes('searches');
    const wantClaim = claim || (fullRun && config.autoClaim);
    const options = { parts, paced, count, claim: wantClaim };
    const before = config.httpStatus && !noHttp ? await fetchState() : null;
    let todo = before && plan(before, options);

    const result = { opened: false, before, after: before, cards: 0, searches: 0, stalled: false, issues: [] };
    if (todo && !todo.cards && !todo.searches && !todo.claim) {
      recordDay(before);
      return result;
    }

    result.opened = true;
    await withBrowser({ show, keepOpen }, async (page, context) => {
      result.before ??= await readState(page);
      todo ??= plan(result.before, options);

      if (todo.cards) result.cards = await runActivities({ context, page, log });
      if (todo.searches) {
        if (paced) log(`ritmo do dia: ${todo.limit} busca(s) nesta sessao`);
        const s = await runSearches({ context, page, history: new History(), log, limit: todo.limit, force: todo.force });
        result.searches = s.done;
        result.stalled = s.stalled;
      }
      if (todo.claim) await claimPoints(page, log, { preview });
      result.after = await readState(page);
    });

    if (result.stalled) result.issues.push('buscas sem pontos');
    if (result.after && !result.after.search) result.issues.push('contador de buscas ilegivel');
    if (result.after) recordDay(result.after, result.issues);
    return result;
  } finally {
    release();
  }
}
