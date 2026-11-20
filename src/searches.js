// Sessao de buscas no Bing imitando uma pessoa: digita na caixa de busca, as vezes aceita uma
// sugestao, rola os resultados, de vez em quando abre um resultado, continua o assunto por
// "pesquisas relacionadas", e espera tempos irregulares entre uma busca e outra.

import { config } from './config.js';
import { chance, humanClick, humanScroll, humanType, logNormal, pause, pick, randInt, sleep } from './human.js';
import { QueryPlanner, usable } from './queries.js';
import { dismissCookieBanner, readSearchProgress } from './rewards.js';

const S = config.search;
const BOX = '#sb_form_q';
const SKIP_EXT = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|exe|msi|apk|dmg)(\?|$)/i;

async function waitForResults(page, before) {
  await page.waitForURL((u) => u.href !== before && u.pathname.startsWith('/search'), { timeout: 20000 });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.locator('#b_results').waitFor({ timeout: 15000 }).catch(() => {});
}

/** Digita a busca; as vezes para no meio e clica numa sugestao. Retorna o texto buscado. */
async function typedSearch(page, query, history) {
  const before = page.url();
  await humanClick(page, page.locator(BOX));
  await page.keyboard.press('Control+A');
  await pause(120, 400);

  let typed = 0;
  if (query.length > 8 && chance(S.suggestChance)) {
    typed = Math.ceil(query.length * pick([0.5, 0.6, 0.7]));
    await humanType(page, query.slice(0, typed), { typoRate: S.typoRate });
    await pause(700, 1800);
    const items = page.locator('#sa_ul li.sa_sg:visible');
    const n = Math.min(await items.count().catch(() => 0), 5);
    for (let i = 0; i < n; i++) {
      const item = items.nth(i);
      const text = ((await item.getAttribute('query')) ?? (await item.innerText())).split('\n')[0].trim();
      if (!usable(text) || history.has(text) || !chance(0.6)) continue;
      await humanClick(page, item);
      await waitForResults(page, before);
      return text;
    }
    // Nenhuma sugestao serviu: termina de digitar.
  }

  await humanType(page, query.slice(typed), { typoRate: S.typoRate });
  await pause(250, 900);
  await page.keyboard.press('Enter');
  await waitForResults(page, before);
  return query;
}

/** Continua o assunto clicando numa "pesquisa relacionada". Retorna o texto ou null. */
async function relatedSearch(page, history) {
  const links = page.locator('.b_rs a:visible, #brsv3 a:visible');
  const n = await links.count().catch(() => 0);
  const candidates = [];
  for (let i = 0; i < Math.min(n, 8); i++) {
    const text = (await links.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (usable(text) && !history.has(text)) candidates.push({ i, text });
  }
  if (!candidates.length) return null;
  const { i, text } = pick(candidates);
  const before = page.url();
  await humanClick(page, links.nth(i));
  await waitForResults(page, before);
  return text;
}

/** Depois da busca: le, rola e as vezes abre um resultado por alguns segundos. */
async function browseResults(context, page) {
  await pause(1500, 4000);
  await humanScroll(page);
  if (!chance(S.clickResultChance)) return;

  const results = page.locator('#b_results li.b_algo h2 a:visible');
  const n = Math.min(await results.count().catch(() => 0), 5);
  if (!n) return;
  const link = results.nth(pick([0, 0, 0, 1, 1, 2, 3, 4].filter((i) => i < n)));
  const href = (await link.getAttribute('href')) ?? '';
  if (!/^https?:/.test(href) || SKIP_EXT.test(href)) return;

  const popup = context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
  const before = page.url();
  await humanClick(page, link);
  const tab = await popup;
  const target = tab ?? page;
  if (tab) {
    tab.on('dialog', (d) => d.dismiss().catch(() => {}));
    tab.on('download', (d) => d.cancel().catch(() => {}));
  }
  await target.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
  await pause(4000, 9000);
  await humanScroll(target).catch(() => {});
  await pause(2000, 16000);
  if (tab) await tab.close().catch(() => {});
  else if (page.url() !== before) await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.bringToFront();
}

/** Confere o contador numa aba separada, como quem abre o Rewards para ver os pontos. */
async function checkProgress(context, page) {
  const tab = await context.newPage();
  try {
    return await readSearchProgress(tab);
  } catch {
    return null;
  } finally {
    await tab.close().catch(() => {});
    await page.bringToFront();
  }
}

/**
 * Faz as buscas que faltam para fechar o contador do dia.
 *  - limit: teto de buscas desta sessao (ritmo do dia ou teste);
 *  - force: faz exatamente `limit` buscas mesmo com o contador completo (so para testar).
 * Retorna { done, progress, stalled }; stalled = o Bing nao creditou as buscas.
 */
export async function runSearches({ context, page, history, log, limit, force = false }) {
  let progress = await readSearchProgress(page);
  if (progress) log(`pontos de busca hoje: ${progress.earned}/${progress.max}`);
  else log('nao consegui ler o contador de buscas; usando quantidade padrao');
  if (progress && progress.earned >= progress.max && !force) {
    log('buscas de hoje ja estao completas');
    return { done: 0, progress, stalled: false };
  }

  let pps = S.pointsPerSearch;
  const needed = (p) => Math.ceil((p.max - p.earned) / pps);
  let budget = progress ? needed(progress) : S.fallbackCount;
  if (limit != null) budget = force ? limit : Math.min(budget, limit);
  const hardCap = limit ?? budget * 2 + 6;
  const first = progress;
  log(`plano: ~${budget} buscas`);

  const planner = new QueryPlanner(history, log);
  await planner.init();

  await page.goto('https://www.bing.com/', { waitUntil: 'domcontentloaded' });
  await page.locator(BOX).waitFor({ timeout: 20000 });
  await pause(1500, 3500);
  await dismissCookieBanner(page);

  let done = 0;
  let sinceCheck = 0;
  let nextCheck = randInt(...S.checkEvery);
  let cooldowns = 0;
  let finishing = false; // ja bateu o limite; so terminando as buscas "a mais"

  while (done < budget && done < hardCap) {
    const cluster = await planner.nextCluster();
    for (const step of cluster) {
      if (done >= budget || done >= hardCap) break;

      let text = null;
      try {
        if (step.related) text = await relatedSearch(page, history);
        const query = step.q ?? (text ? null : await planner.followUp(step.prev));
        if (!text && query) text = await typedSearch(page, query, history);
      } catch (err) {
        log(`busca falhou (${err.message.split('\n')[0]}); voltando para o Bing`);
        await page.goto('https://www.bing.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
        await pause(2000, 5000);
      }
      if (!text) continue;

      history.add(text);
      done++;
      sinceCheck++;
      log(`busca ${done}/${budget}: ${text}`);
      await dismissCookieBanner(page);
      await browseResults(context, page).catch((err) => log(`  (navegacao nos resultados: ${err.message.split('\n')[0]})`));

      if (!finishing && (sinceCheck >= nextCheck || done >= budget)) {
        const now = await checkProgress(context, page);
        if (now) {
          const gained = progress ? now.earned - progress.earned : 0;
          log(`pontos de busca hoje: ${now.earned}/${now.max}`);
          if (gained > 0) pps = Math.max(1, Math.round(gained / sinceCheck));
          if (now.earned >= now.max) {
            finishing = true;
            if (!force) budget = limit == null && chance(S.extraChance) ? done + randInt(1, 2) : done;
          } else if (progress && gained <= 0 && sinceCheck >= 3 && limit == null) {
            // Sessao sem teto: espera o cooldown do Bing passar e continua.
            if (cooldowns >= S.maxCooldowns) {
              log('o Bing nao esta creditando pontos; parando por hoje');
              return { done, progress: now, stalled: true };
            }
            cooldowns++;
            const minutes = randInt(...S.cooldownMin);
            log(`sem pontos nas ultimas ${sinceCheck} buscas; pausa de ${minutes} min (cooldown do Bing)`);
            await sleep(minutes * 60000);
          } else if (limit == null) {
            budget = Math.min(hardCap, done + needed(now));
          }
          progress = now;
        }
        sinceCheck = 0;
        nextCheck = randInt(...S.checkEvery);
      }

      if (done < budget) {
        await pause(logNormal(S.gapMedianSec, 0.6, S.gapMinSec, S.gapMaxSec) * 1000);
      }
    }
    if (done < budget && chance(S.longBreakChance)) {
      const secs = randInt(...S.longBreakSec);
      log(`pausa de ${secs}s antes do proximo assunto`);
      await pause(secs * 1000);
    }
  }

  if (!finishing) progress = (await checkProgress(context, page)) ?? progress;
  // Sessao com teto: nao espera cooldown; so avisa se nenhuma busca rendeu ponto.
  const gainedNothing = first && progress && progress.earned <= first.earned && first.earned < first.max;
  return { done, progress, stalled: Boolean(gainedNothing && done >= 3) };
}
