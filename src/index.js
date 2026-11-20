#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pendingCards, runActivities } from './activities.js';
import { closeBrowser, openBrowser } from './browser.js';
import { config } from './config.js';
import { History } from './history.js';
import { exportSession, fetchState } from './http.js';
import { rand, setTimeScale, sleep } from './human.js';
import { QueryPlanner } from './queries.js';
import { claimPoints, readState } from './rewards.js';
import { runSearches } from './searches.js';

const HELP = `Uso: node src/index.js [opcoes]

Sem opcoes: confere o estado por requisicao (sem abrir o navegador) e, se houver algo a fazer,
abre o Edge sem janela e faz os cards do dashboard e as buscas no Bing
(e reivindica os pontos pendentes, se autoClaim estiver ligado em src/config.js).

  --status           so mostra saldo, contador de buscas e cards pendentes
  --activities       so os cards (conjunto diario + continuar ganhando)
  --searches         so as buscas no Bing
  --claim            so reivindica os pontos pendentes
  --preview          com --claim: mostra quanto ha para reivindicar, sem clicar
  --show             abre o Edge com janela visivel (padrao: sem janela, ver headless no config)
  --headless         forca o Edge sem janela
  --no-http          nao usa requisicao direta; le tudo pelo navegador
  --dry-run          so imprime exemplos de buscas que seriam feitas
  --max-searches N   faz exatamente N buscas (para testar)
  --jitter MIN       espera um tempo aleatorio de 0 a MIN minutos antes de comecar
  --fast             encurta as pausas (so para testar; menos "humano")
  --keep-open        nao fecha o Edge no final
`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : undefined);

const logFile = path.join(config.dataDir, 'logs', `${new Date().toLocaleDateString('sv-SE')}.log`);
function log(msg) {
  const line = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
  console.log(line);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${line}\n`);
}

/** Impede duas execucoes ao mesmo tempo (tarefa agendada + manual). */
function acquireLock() {
  const file = path.join(config.dataDir, 'run.lock');
  fs.mkdirSync(config.dataDir, { recursive: true });
  try {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    process.kill(pid, 0); // lanca erro se o processo nao existe mais
    return null;
  } catch {
    fs.writeFileSync(file, String(process.pid));
    return () => fs.rmSync(file, { force: true });
  }
}

const ratio = (c) => (c ? `${c.earned}/${c.max}` : '?');

function printState(state, source) {
  if (!state) return log('nao consegui ler o estado do Rewards');
  const mobile = state.mobileSearch ? ` | buscas mobile: ${ratio(state.mobileSearch)}` : '';
  log(`[${source}] saldo: ${state.balance} | buscas: ${ratio(state.search)}${mobile} | pontos hoje: ${state.todayPoints ?? '?'}`);
  const daily = state.cards.filter((c) => c.section === 'dailyset');
  if (daily.length) log(`conjunto diario: ${daily.filter((c) => c.done).length}/${daily.length}`);
  const pending = pendingCards(state.cards);
  log(`cards pendentes: ${pending.length ? pending.map((c) => `"${c.title}" (+${c.points})`).join(', ') : 'nenhum'}`);
  if (state.claimable) log(`pontos a reivindicar: ${state.claimable === true ? 'sim' : state.claimable} (use --claim)`);
}

async function dryRun() {
  const planner = new QueryPlanner(new History(), log);
  await planner.init();
  for (let i = 0; i < 8; i++) {
    const cluster = await planner.nextCluster();
    log(`assunto ${i + 1}: ${cluster.map((s) => s.q ?? '(clica em pesquisa relacionada)').join('  ->  ')}`);
  }
}

/** Abre o navegador, roda fn(page, context) e fecha, sempre salvando os cookies para o modo HTTP. */
async function withBrowser(fn) {
  const headless = flag('--show') ? false : flag('--headless') || config.headless;
  const session = await openBrowser({ headless });
  const page = await session.context.newPage();
  try {
    return await fn(page, session.context);
  } finally {
    await exportSession(session.context, page).catch(() => {});
    await page.close().catch(() => {});
    if (flag('--keep-open')) await session.browser.close().catch(() => {});
    else await closeBrowser(session);
  }
}

async function main() {
  if (flag('--help') || flag('-h')) return console.log(HELP);
  if (flag('--fast')) setTimeScale(0.25);
  if (flag('--dry-run')) return dryRun();

  const useHttp = config.httpStatus && !flag('--no-http');

  if (flag('--status')) {
    const viaHttp = useHttp ? await fetchState() : null;
    if (viaHttp) return printState(viaHttp, 'requisicao');
    return printState(await withBrowser((page) => readState(page)), 'navegador');
  }

  const release = acquireLock();
  if (!release) return log('ja existe uma execucao em andamento; saindo');
  try {
    const jitter = value('--jitter');
    if (jitter) {
      const minutes = rand(0, jitter);
      log(`aguardando ${minutes.toFixed(1)} min antes de comecar`);
      await sleep(minutes * 60000);
    }

    const only = ['--activities', '--searches', '--claim'].filter(flag);
    const want = (name) => !only.length || only.includes(name);
    const maxSearches = value('--max-searches');

    // Pre-checagem sem navegador: decide o que ha para fazer hoje.
    const before = useHttp ? await fetchState() : null;
    if (before) printState(before, 'requisicao');
    const todo = {
      activities: want('--activities') && (!before || pendingCards(before.cards).length > 0),
      searches:
        want('--searches') && (maxSearches != null || !before?.search || before.search.earned < before.search.max),
      claim: (flag('--claim') || (!only.length && config.autoClaim)) && before?.claimable !== 0,
    };
    if (!todo.activities && !todo.searches && !todo.claim) {
      return log('nada a fazer agora; o navegador nao foi aberto');
    }

    await withBrowser(async (page, context) => {
      const start = before ?? (await readState(page));
      if (!before) printState(start, 'navegador');

      if (todo.activities) {
        const n = await runActivities({ context, page, log });
        log(`cards feitos: ${n}`);
      }
      if (todo.searches) {
        const { done } = await runSearches({ context, page, history: new History(), log, maxSearches });
        log(`buscas feitas: ${done}`);
      }
      if (todo.claim) await claimPoints(page, log, { preview: flag('--preview') });

      const end = await readState(page);
      printState(end, 'final');
      if (start && end) log(`saldo: ${start.balance} -> ${end.balance} (${end.balance - start.balance >= 0 ? '+' : ''}${end.balance - start.balance})`);
    });
  } finally {
    release();
  }
}

main().catch((err) => {
  log(`ERRO: ${err.stack ?? err}`);
  process.exitCode = 1;
});
