// Comandos do CLI. Cada um e fino: valida a entrada, chama o nucleo e imprime o resultado.
// Assinatura: (args posicionais, opcoes, log) -> codigo de saida (ou nada = 0).

import fs from 'node:fs';
import path from 'node:path';
import { pendingCards } from './activities.js';
import { cdpAlive, findEdge } from './browser.js';
import { config } from './config.js';
import { History } from './history.js';
import { fetchState, httpIssue } from './http.js';
import { pressEnter, select } from './menu.js';
import { notify } from './notify.js';
import { cleanProfile, dirSize, profileInfo } from './profile.js';
import { QueryPlanner } from './queries.js';
import { DASHBOARD } from './rewards.js';
import { parseRewards } from './rsc.js';
import { currentState, run, withBrowser } from './run.js';
import { installSchedule, removeSchedule, runScheduleNow, scheduleStatus } from './schedule.js';
import { loadDays } from './stats.js';
import { logFileFor, num, paint, renderState, table } from './ui.js';

export const EXIT = { ok: 0, error: 1, notLoggedIn: 2, notCredited: 3 };

const mb = (bytes) => `${(bytes / 1048576).toFixed(0)} MB`;
const ok = (text) => `  ${paint('green', '✓')} ${text}`;
const warn = (text) => `  ${paint('yellow', '!')} ${text}`;

/** Roda uma execucao e resume o resultado. Usado por run/search/cards/claim. */
async function execute(what, opts, log) {
  const result = await run({ ...opts, ...what, log });
  if (!result.opened) log('nada a fazer agora; o navegador nao foi aberto');
  if (result.after) {
    const gained = result.before ? result.after.balance - result.before.balance : 0;
    const search = result.after.search ? `${result.after.search.earned}/${result.after.search.max}` : '?';
    log(`saldo ${num(result.after.balance)} (${gained >= 0 ? '+' : ''}${gained}) · buscas ${search} · cards feitos ${result.cards} · buscas feitas ${result.searches}`);
  }
  for (const issue of result.issues) log(`atencao: ${issue}`);
  if (opts.notify && config.notify && result.issues.length) {
    await notify('Microsoft Rewards: verifique o bot', result.issues.join('; '));
  }
  return result.stalled ? EXIT.notCredited : EXIT.ok;
}

async function status(_args, opts) {
  const { state, source } = await currentState(opts);
  if (!state) throw new Error('nao consegui ler o estado do Rewards');
  if (opts.json) return void console.log(JSON.stringify({ ...state, pending: pendingCards(state.cards) }, null, 2));
  console.log(`\n${renderState(state, pendingCards(state.cards))}\n  ${paint('dim', `lido por ${source}`)}\n`);
}

function stats(_args, opts) {
  const days = loadDays();
  const today = new Date().toLocaleDateString('sv-SE');
  const keys = Object.keys(days).sort().slice(-(opts.days ?? 14));
  if (!keys.length) return void console.log('sem historico ainda; ele e gravado a cada execucao');
  const rows = keys.map((day) => {
    const d = days[day];
    const incomplete = d.search && d.search[0] < d.search[1] && day < today;
    const notes = [...(incomplete ? ['buscas nao fecharam'] : []), ...(d.issues ?? [])];
    return [day, num(d.balance), d.points == null ? '?' : `+${num(d.points)}`, d.search ? d.search.join('/') : '?', d.daily.join('/'), notes.join('; ')];
  });
  console.log(`\n${table(rows, { head: ['dia', 'saldo', 'pontos', 'buscas', 'diario', 'obs'] })}\n`);
}

function logs(_args, opts) {
  const dir = path.dirname(logFileFor());
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  if (!files.length) return void console.log('sem logs ainda');
  const file = fs.existsSync(logFileFor()) ? logFileFor() : path.join(dir, files.at(-1));
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  console.log(paint('dim', file));
  console.log(lines.slice(-(opts.tail ?? 40)).join('\n'));
}

function printSchedule(info) {
  if (!info) return void console.log('  sem agendamento. Para criar: msr schedule install');
  const failed = info.lastRun && info.lastResult !== 0;
  console.log(`  ${paint('dim', 'horarios')}   ${info.times.join(', ')}  ${paint('dim', `(+ ate ${info.jitterMinutes} min aleatorios)`)}`);
  console.log(`  ${paint('dim', 'estado')}     ${info.state}`);
  console.log(`  ${paint('dim', 'ultima')}     ${info.lastRun ?? 'nunca'}${failed ? paint('yellow', `  (codigo ${info.lastResult})`) : ''}`);
  console.log(`  ${paint('dim', 'proxima')}    ${info.nextRun ?? '-'}`);
}

async function schedule([action = 'status'], opts) {
  if (action === 'install') {
    const times = opts.times?.split(',').map((t) => t.trim());
    printSchedule(await installSchedule({ times, jitterMinutes: opts.jitter }));
  } else if (action === 'remove') {
    await removeSchedule();
    console.log('  agendamento removido');
  } else if (action === 'test') {
    await runScheduleNow();
    console.log('  tarefa disparada agora; acompanhe com: msr logs');
  } else if (action === 'status') {
    printSchedule(await scheduleStatus());
  } else {
    throw new Error(`acao desconhecida: schedule ${action} (use install, remove, status ou test)`);
  }
}

/** Abre o Edge do bot com janela e espera ate a conta estar logada no Rewards. */
async function login(_args, opts) {
  console.log('  abrindo o Edge do bot; faca login na conta Microsoft na janela (ate 5 min)...');
  const logged = await withBrowser({ ...opts, show: true }, async (page) => {
    await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded' }).catch(() => {});
    for (const deadline = Date.now() + 300000; Date.now() < deadline; ) {
      if (page.isClosed()) return false;
      if (parseRewards(await page.content().catch(() => ''))) return true;
      await page.waitForTimeout(2000).catch(() => {});
    }
    return false;
  });
  console.log(logged ? ok('logado; sessao salva') : warn('login nao detectado'));
  return logged ? EXIT.ok : EXIT.notLoggedIn;
}

async function clean() {
  if (await cdpAlive()) throw new Error('feche o Edge do bot antes de limpar o perfil');
  const freed = cleanProfile();
  console.log(ok(`perfil limpo: ${mb(freed)} liberados, agora ${mb(dirSize(config.profileDir))}`));
}

async function doctor(_args, opts) {
  console.log(`\n${ok(`Node ${process.version}`)}`);
  const edge = findEdge();
  console.log(edge ? ok(`Edge em ${edge}`) : warn('msedge.exe nao encontrado (ajuste edgePaths em data/config.json)'));

  const state = await fetchState();
  if (!state) {
    console.log(warn(`leitura por requisicao falhou: ${httpIssue}. A proxima execucao usa o navegador e renova a sessao; se persistir: msr login`));
  } else {
    console.log(ok(`sessao valida · saldo ${num(state.balance)}`));
    const missing = [['contador de buscas', state.search], ['dia do Rewards', state.day], ['cards', state.cards.length], ['pontos a reivindicar', state.claimable !== undefined]]
      .filter(([, found]) => !found)
      .map(([name]) => name);
    console.log(missing.length ? warn(`leitor do site nao achou: ${missing.join(', ')} (o formato pode ter mudado)`) : ok('leitor do site achou todos os campos'));
  }

  const info = profileInfo();
  const dirty = info.extensions > 0 || info.syncedData;
  console.log((dirty ? warn : ok)(`perfil do Edge: ${mb(info.bytes)}${info.extensions ? `, ${info.extensions} extensoes` : ''}${info.syncedData ? ', dados sincronizados do Edge pessoal' : ''}${dirty ? ' -> rode: msr clean' : ' (so login)'}`));
  console.log(ok(`dados do bot: ${mb(dirSize(config.dataDir))} em ${config.dataDir}`));

  const sched = await scheduleStatus().catch(() => null);
  console.log(sched ? ok(`agendado: ${sched.times.join(', ')} · proxima ${sched.nextRun ?? '-'}`) : warn('sem agendamento (msr schedule install)'));

  if (opts.notify) console.log((await notify('Microsoft Rewards', 'Teste de notificacao do msr.')) ? ok('notificacao enviada') : warn('nao consegui enviar a notificacao'));
  console.log('');
}

async function queries(_args, _opts, log) {
  const planner = new QueryPlanner(new History(), log);
  await planner.init();
  for (let i = 1; i <= 8; i++) {
    const cluster = await planner.nextCluster();
    console.log(`  ${i}. ${cluster.map((s) => s.q ?? paint('dim', '(clica em pesquisa relacionada)')).join(paint('dim', '  ->  '))}`);
  }
}

async function menu(_args, opts, log) {
  const entries = [
    ['Rodar tudo que falta', () => execute({}, opts, log)],
    ['Rodar só a fatia deste horário', () => execute({ paced: true }, opts, log)],
    ['Só buscas', () => execute({ parts: ['searches'] }, opts, log)],
    ['Só cards', () => execute({ parts: ['cards'] }, opts, log)],
    ['Reivindicar pontos', () => execute({ parts: [], claim: true }, opts, log)],
    ['Histórico de pontos', () => stats([], opts)],
    ['Agendamento', () => schedule([], opts)],
    ['Log de hoje', () => logs([], opts)],
    ['Diagnóstico', () => doctor([], opts)],
    ['Sair', null],
  ];
  for (;;) {
    const state = await fetchState();
    console.log(`\n  ${paint('bold', 'Microsoft Rewards')}\n`);
    console.log(state ? renderState(state, pendingCards(state.cards)) : `  ${paint('dim', 'estado indisponivel por requisicao; rode "Rodar tudo" ou msr login')}`);
    console.log('');
    const choice = await select(entries.map(([label]) => label));
    const action = entries[choice]?.[1];
    if (!action) return;
    console.log('');
    try {
      await action();
    } catch (err) {
      console.log(warn(err.message));
    }
    await pressEnter(paint('dim', '\n  Enter para voltar ao menu '));
  }
}

export const commands = {
  run: { summary: 'faz o que falta (cards + buscas); --paced faz so a fatia do horario', action: (_a, o, log) => execute({ paced: o.paced }, o, log) },
  status: { summary: 'saldo, buscas, conjunto diario, cards e pontos a reivindicar', action: status },
  search: { summary: 'so buscas; "msr search 5" faz exatamente 5 (teste)', action: ([n], o, log) => execute({ parts: ['searches'], count: n == null ? undefined : Number(n) }, o, log) },
  cards: { summary: 'so os cards (conjunto diario + continuar ganhando)', action: (_a, o, log) => execute({ parts: ['cards'] }, o, log) },
  claim: { summary: 'reivindica os pontos pendentes; --preview so mostra', action: (_a, o, log) => execute({ parts: [], claim: true, preview: o.preview }, o, log) },
  stats: { summary: 'historico de pontos por dia (--days N)', action: stats },
  logs: { summary: 'log de hoje (--tail N)', action: logs },
  schedule: { summary: 'agendamento: install | remove | status | test (--times, --jitter)', action: schedule },
  login: { summary: 'abre o Edge do bot com janela para fazer login', action: login },
  clean: { summary: 'apaga extensoes, dados sincronizados e caches do perfil do bot', action: clean },
  doctor: { summary: 'confere Edge, sessao, leitor do site, perfil e agendamento', action: doctor },
  queries: { summary: 'exemplos de buscas que seriam feitas', action: queries },
  menu: { summary: 'menu interativo (padrao quando nao ha comando)', action: menu },
};
