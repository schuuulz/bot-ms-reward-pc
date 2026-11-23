// Comandos do CLI. Cada um e fino: valida a entrada, chama o nucleo e imprime o resultado.
// Assinatura: (args posicionais, opcoes, log) -> codigo de saida (ou nada = 0).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pendingCards, setAsideCards } from './activities.js';
import { cdpAlive, findEdge } from './browser.js';
import { config, saveConfig } from './config.js';
import { History } from './history.js';
import { fetchState, httpIssue } from './http.js';
import { formatLine, logStore } from './logs.js';
import { pressEnter, select } from './menu.js';
import { notify } from './notify.js';
import { cleanProfile, dirSize, profileInfo } from './profile.js';
import { QueryPlanner } from './queries.js';
import { DASHBOARD, NotLoggedInError, readState } from './rewards.js';
import { parseRewards } from './rsc.js';
import { currentState, run, withBrowser } from './run.js';
import { installSchedule, removeSchedule, runScheduleNow, scheduleStatus } from './schedule.js';
import { loadDays } from './stats.js';
import { applyUpdate, checkUpdate, currentVersion } from './update.js';
import { num, paint, renderState, table } from './ui.js';

export const EXIT = { ok: 0, error: 1, notLoggedIn: 2, notCredited: 3 };

const mb = (bytes) => `${(bytes / 1048576).toFixed(0)} MB`;
const ok = (text) => `  ${paint('green', '✓')} ${text}`;
const warn = (text) => `  ${paint('yellow', '!')} ${text}`;

/**
 * O caminho esta fora da pasta do usuario? La fora (ex.: uma pasta criada em C:\) o Windows
 * costuma deixar qualquer conta do PC alterar os arquivos: outra pessoa poderia trocar o msr, e o
 * agendamento rodaria o arquivo dela na conta de quem agendou.
 */
export function outsideHome(target, home = os.homedir()) {
  const relative = path.relative(home, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/** Aviso se o msr (o exe, ou a pasta do checkout) esta num lugar que outras contas alcancam. */
function unsafePlaceWarning() {
  const place = config.packaged ? path.dirname(process.execPath) : config.root;
  if (!outsideHome(place)) return null;
  return `o msr esta em ${place}, fora da sua pasta de usuario: outras contas deste PC podem conseguir troca-lo. Mova para uma pasta dentro de ${os.homedir()} e ative o agendamento de novo`;
}

/**
 * O que fazer quando a conta nao esta logada. O Edge do bot entra sozinho na conta Microsoft em
 * que o Windows esta logado; o msr nunca pede login nem senha.
 */
export function accountHelp() {
  return [
    '  O msr usa a conta Microsoft em que o Windows está logado:',
    '    1. Abra Configurações > Contas > Suas informações',
    '    2. Escolha "Entrar com uma conta Microsoft" e conclua',
    '    3. Abra o msr de novo',
    ...(config.packaged ? [] : ['  No checkout também dá para entrar pela janela do Edge do bot: msr login']),
  ].join('\n');
}

/** Confere se o Edge do bot esta logado e salva a sessao. Retorna o estado, ou null se nao esta. */
async function checkAccount(opts) {
  console.log(paint('dim', '  verificando sua conta Microsoft (pode levar um minuto)...'));
  let reason;
  // Num perfil recem-criado a primeira visita pode nao carregar a tempo; a segunda da certo.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const state = await withBrowser(opts, (page) => readState(page));
      if (state) {
        console.log(ok(`conta detectada · saldo ${num(state.balance)}`));
        return state;
      }
      reason = 'a pagina veio sem os dados da conta';
    } catch (err) {
      reason = err instanceof NotLoggedInError ? 'o site pediu login' : err.message;
    }
  }
  console.log(`${warn(`conta Microsoft não detectada (${reason})`)}\n${accountHelp()}`);
  return null;
}

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
  const [pending, setAside] = [pendingCards(state.cards), setAsideCards(state.cards)];
  if (opts.json) return void console.log(JSON.stringify({ ...state, pending, setAside }, null, 2));
  console.log(`\n${renderState(state, pending, setAside)}\n  ${paint('dim', `lido por ${source}`)}\n`);
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

const keepLabel = () => (config.logDays > 0 ? `${config.logDays} dia(s)` : 'sempre');

/** Mostra as linhas de um dia (padrao: o ultimo com log) ou, com errors e sem dia, todos os erros. */
function showLogs({ day, tail = 40, errors = false } = {}) {
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`dia invalido: "${day}" (use AAAA-MM-DD)`);
  const found = logStore().read({ day, tail, errors });
  if (!found.rows.length) return void console.log(errors ? '  nenhum erro registrado' : '  sem logs para mostrar');
  console.log(paint('dim', `  ${found.day ?? 'erros de todos os dias'} · ${found.rows.length} linha(s)`));
  console.log(found.rows.map((row) => formatLine(row, { withDay: !found.day })).join('\n'));
}

/** Por quanto tempo guardar os logs: um numero de dias, ou "sempre". */
function keepLogs(value) {
  const days = /^(sempre|0)$/i.test(value ?? '') ? 0 : Number(value);
  if (!Number.isInteger(days) || days < 0) throw new Error('use: msr logs keep <dias|sempre>');
  saveConfig({ logDays: days });
  const removed = logStore().prune(days);
  console.log(ok(`logs guardados por: ${keepLabel()}${removed ? ` (${removed} linha(s) antigas apagadas)` : ''}`));
}

/** Todos os logs num arquivo de texto (o banco nao abre no Bloco de Notas). */
function exportLogs(target) {
  const store = logStore();
  const text = store.days().flatMap(({ day }) => [`# ${day}`, ...store.read({ day }).rows.map((row) => formatLine(row)), '']).join('\n');
  if (!text) return void console.log('  sem logs para exportar');
  const file = path.resolve(target ?? path.join(config.dataDir, 'msr-logs.txt'));
  fs.writeFileSync(file, text);
  console.log(ok(`logs exportados para ${file}`));
}

function logs([action = 'show', arg], opts) {
  if (action === 'show') {
    showLogs({ day: opts.day, tail: opts.tail, errors: opts.errors });
  } else if (action === 'days') {
    const days = logStore().days();
    if (!days.length) return void console.log('  sem logs ainda');
    console.log(`\n${table(days.map((d) => [d.day, d.lines, d.errors || '']), { head: ['dia', 'linhas', 'erros'] })}\n\n  ${paint('dim', `guardados por: ${keepLabel()}`)}\n`);
  } else if (action === 'keep') {
    keepLogs(arg);
  } else if (action === 'export') {
    exportLogs(arg);
  } else if (action === 'clear') {
    logStore().clear();
    console.log(ok('todos os logs foram apagados'));
  } else {
    throw new Error(`acao desconhecida: logs ${action} (use days, keep, export ou clear)`);
  }
}

/** Submenu dos logs: ver, escolher por quanto tempo guardar, exportar e apagar. */
async function logsMenu() {
  const choose = async (entries) => entries[await select(entries.map(([label]) => label))]?.[1];
  const action = await choose([
    ['Ver o último dia', () => showLogs()],
    ['Ver outro dia', async () => {
      const days = logStore().days().reverse().slice(0, 14);
      const day = await choose([...days.map((d) => [`${d.day}  (${d.lines} linhas)`, d.day]), ['Voltar', null]]);
      return day ? showLogs({ day, tail: 0 }) : false;
    }],
    ['Só erros', () => showLogs({ errors: true })],
    [`Guardar por... (agora: ${keepLabel()})`, async () => {
      const value = await choose([['7 dias', '7'], ['30 dias', '30'], ['90 dias', '90'], ['Sempre', 'sempre'], ['Voltar', null]]);
      return value ? keepLogs(value) : false;
    }],
    ['Exportar para arquivo de texto', () => exportLogs()],
    ['Apagar todos os logs', async () => {
      if (!(await choose([['Não, voltar', false], ['Sim, apagar tudo', true]]))) return false;
      logs(['clear'], {});
    }],
    ['Voltar', null],
  ]);
  if (!action) return false;
  console.log('');
  return action();
}

function printSchedule(info) {
  if (!info) return void console.log('  sem agendamento. Para criar: "Ativar" no menu Agendamento, ou msr schedule install');
  const failed = info.lastRun && info.lastResult !== 0;
  console.log(`  ${paint('dim', 'horarios')}   ${info.times.join(', ')}  ${paint('dim', `(+ ate ${info.jitterMinutes} min aleatorios)`)}`);
  console.log(`  ${paint('dim', 'estado')}     ${info.state}`);
  console.log(`  ${paint('dim', 'ultima')}     ${info.lastRun ?? 'nunca'}${failed ? paint('yellow', `  (codigo ${info.lastResult})`) : ''}`);
  console.log(`  ${paint('dim', 'proxima')}    ${info.nextRun ?? '-'}`);
  if (info.stale) console.log(warn(STALE_SCHEDULE));
}

const STALE_SCHEDULE = 'o agendamento chama o msr em outro caminho (ele mudou de lugar?); ative o agendamento de novo';

/** Submenu do agendamento: no msr.exe nao ha linha de comando para `msr schedule install`. */
async function scheduleMenu(opts) {
  const entries = [
    ['Ver agendamento', 'status'],
    [`Ativar (todo dia, perto de ${config.schedule.times.join(', ')})`, 'install'],
    ['Desativar', 'remove'],
    ['Disparar agora (teste)', 'test'],
    ['Voltar', null],
  ];
  const action = entries[await select(entries.map(([label]) => label))]?.[1];
  if (!action) return false;
  console.log('');
  await schedule([action], opts);
}

async function schedule([action = 'status'], opts) {
  if (action === 'install') {
    const times = opts.times?.split(',').map((t) => t.trim());
    printSchedule(await installSchedule({ times, jitterMinutes: opts.jitter }));
    if (unsafePlaceWarning()) console.log(warn(unsafePlaceWarning()));
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

const versionLabel = () => `msr v${currentVersion()}${config.packaged ? '' : ' (checkout)'}`;

/**
 * Atualiza para a ultima release do GitHub (so quando a pessoa pede). Retorna true se o msr.exe
 * foi trocado: dali em diante e preciso abrir o msr de novo.
 */
async function update(_args, opts) {
  const news = await checkUpdate();
  if (!news) throw new Error('nao consegui consultar as versoes no GitHub (sem internet?)');
  if (!news.available) return void console.log(ok(`${versionLabel()} ja e a versao mais recente`));
  console.log(`  ${versionLabel()} -> nova versao v${news.latest.version} disponivel`);
  if (opts.check) return;
  if (!config.packaged) return void console.log('  no checkout, atualize com: git pull && npm install');
  await applyUpdate(news.latest, (message) => console.log(`  ${message}`));
  console.log(ok(`atualizado para v${news.latest.version}; abra o msr de novo`));
  return true;
}

async function doctor(_args, opts) {
  console.log(`\n${ok(`${versionLabel()} · Node ${process.version}`)}`);
  const news = await checkUpdate();
  if (news?.available) console.log(warn(`nova versao v${news.latest.version} disponivel (msr update, ou "Quero Atualizar" no menu)`));
  else console.log(news ? ok('esta e a versao mais recente') : warn('nao consegui consultar se ha versao nova'));
  if (unsafePlaceWarning()) console.log(warn(unsafePlaceWarning()));
  const edge = findEdge();
  console.log(edge ? ok(`Edge em ${edge}`) : warn('msedge.exe nao encontrado (ajuste edgePaths em data/config.json)'));

  const state = await fetchState();
  if (!state) {
    console.log(warn(`leitura por requisicao falhou: ${httpIssue}. A proxima execucao usa o navegador e renova a sessao; se persistir:\n${accountHelp()}`));
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
  if (!sched) console.log(warn('sem agendamento (msr schedule install, ou "Agendamento" no menu)'));
  else console.log(sched.stale ? warn(STALE_SCHEDULE) : ok(`agendado: ${sched.times.join(', ')} · proxima ${sched.nextRun ?? '-'}`));

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

/**
 * Liga ou desliga o auto claim (config.autoClaim, gravado em data/config.json): com ele ligado,
 * toda execucao completa, inclusive as agendadas, reivindica os pontos pendentes no fim.
 */
function toggleAutoClaim() {
  saveConfig({ autoClaim: !config.autoClaim });
  console.log(ok(config.autoClaim
    ? 'auto claim ligado: os pontos pendentes serão reivindicados no fim de cada execução completa, inclusive as agendadas'
    : 'auto claim desligado: os pontos pendentes só são reivindicados quando você escolher "Reivindicar pontos"'));
  return false; // volta direto ao menu, que ja mostra o novo estado
}

async function menu(_args, opts, log) {
  // O texto de uma entrada pode ser uma funcao, para refletir um estado que muda com o menu aberto.
  const entries = [
    ['Rodar tudo que falta', () => execute({}, opts, log)],
    ['Rodar só a fatia deste horário', () => execute({ paced: true }, opts, log)],
    ['Só buscas', () => execute({ parts: ['searches'] }, opts, log)],
    ['Só cards', () => execute({ parts: ['cards'] }, opts, log)],
    ['Reivindicar pontos', () => execute({ parts: [], claim: true }, opts, log)],
    [() => `Auto claim: ${config.autoClaim ? 'ligado' : 'desligado'} (Enter para ${config.autoClaim ? 'desligar' : 'ligar'})`, toggleAutoClaim],
    ['Histórico de pontos', () => stats([], opts)],
    ['Agendamento', () => scheduleMenu(opts)],
    ['Logs', () => logsMenu()],
    ['Diagnóstico', () => doctor([], opts)],
    ['Verificar conta', () => checkAccount(opts)],
  ];
  // Ao abrir: ve se ha versao nova (uma consulta ao GitHub) e, sem sessao (primeira
  // vez ou sessao expirada), confere a conta antes do menu.
  const [news, logged] = await Promise.all([checkUpdate(), fetchState()]);
  if (!logged) await checkAccount(opts);
  let updated = false;
  if (news?.available) {
    entries.push([`Quero Atualizar (v${news.current} → v${news.latest.version})`, async () => {
      updated = (await update([], {})) === true;
    }]);
  }
  entries.push(['Sair', null]);

  for (;;) {
    const state = await fetchState();
    console.log(`\n  ${paint('bold', 'Microsoft Rewards')}  ${paint('dim', `· ${versionLabel()}`)}`);
    if (news?.available) console.log(`  ${paint('yellow', `nova versão v${news.latest.version} disponível: escolha "Quero Atualizar"`)}`);
    console.log('');
    console.log(state ? renderState(state, pendingCards(state.cards), setAsideCards(state.cards)) : `  ${paint('dim', 'conta não detectada; veja "Verificar conta"')}`);
    console.log('');
    const choice = await select(entries.map(([label]) => (typeof label === 'function' ? label() : label)));
    const action = entries[choice]?.[1];
    if (!action) return;
    console.log('');
    let pause = true;
    try {
      pause = (await action()) !== false; // false: a acao so voltou, nao ha o que ler
    } catch (err) {
      console.log(warn(err instanceof NotLoggedInError ? `conta Microsoft não detectada\n${accountHelp()}` : err.message));
    }
    if (pause) await pressEnter(paint('dim', updated ? '\n  Enter para fechar ' : '\n  Enter para voltar ao menu '));
    if (updated) return; // o exe foi trocado: este processo ainda e o antigo
  }
}

export const commands = {
  run: { summary: 'faz o que falta (cards + buscas); --paced faz so a fatia do horario', action: (_a, o, log) => execute({ paced: o.paced }, o, log) },
  status: { summary: 'saldo, buscas, conjunto diario, cards e pontos a reivindicar', action: status },
  search: { summary: 'so buscas; "msr search 5" faz exatamente 5 (teste)', action: ([n], o, log) => execute({ parts: ['searches'], count: n == null ? undefined : Number(n) }, o, log) },
  cards: { summary: 'so os cards (conjunto diario + continuar ganhando)', action: (_a, o, log) => execute({ parts: ['cards'] }, o, log) },
  claim: { summary: 'reivindica os pontos pendentes; --preview so mostra', action: (_a, o, log) => execute({ parts: [], claim: true, preview: o.preview }, o, log) },
  stats: { summary: 'historico de pontos por dia (--days N)', action: stats },
  logs: { summary: 'logs (--day AAAA-MM-DD, --tail N, --errors) | days | keep <dias|sempre> | export | clear', action: logs },
  schedule: { summary: 'agendamento: install | remove | status | test (--times, --jitter)', action: schedule },
  // No msr.exe nao ha login pelo app: o Edge do bot entra sozinho pela conta do Windows.
  ...(config.packaged ? {} : { login: { summary: 'abre o Edge do bot com janela para fazer login', action: login } }),
  clean: { summary: 'apaga extensoes, dados sincronizados e caches do perfil do bot', action: clean },
  update: { summary: 'atualiza para a ultima versao publicada no GitHub; --check so confere', action: async (a, o) => void (await update(a, o)) },
  doctor: { summary: 'confere versao, Edge, sessao, leitor do site, perfil e agendamento', action: doctor },
  queries: { summary: 'exemplos de buscas que seriam feitas', action: queries },
  menu: { summary: 'menu interativo (padrao quando nao ha comando)', action: menu },
};
