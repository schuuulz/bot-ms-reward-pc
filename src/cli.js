// Entrada do CLI: interpreta os argumentos, despacha o comando e traduz erros em mensagem,
// notificacao e codigo de saida.

import { parseArgs } from 'node:util';
import { EXIT, accountHelp, commands } from './commands.js';
import { config } from './config.js';
import { setTimeScale } from './human.js';
import { createLogger, logError } from './logs.js';
import { notify } from './notify.js';
import { NotLoggedInError } from './rewards.js';
import { BusyError } from './run.js';
import { paint } from './ui.js';
import { cleanupOldExe, currentVersion } from './update.js';

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  show: { type: 'boolean' },
  'no-http': { type: 'boolean' },
  'keep-open': { type: 'boolean' },
  fast: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  notify: { type: 'boolean' },
  json: { type: 'boolean' },
  paced: { type: 'boolean' },
  preview: { type: 'boolean' },
  check: { type: 'boolean' },
  days: { type: 'string' },
  day: { type: 'string' },
  errors: { type: 'boolean' },
  tail: { type: 'string' },
  times: { type: 'string' },
  jitter: { type: 'string' },
};
const NUMERIC = ['days', 'tail', 'jitter'];

function help() {
  const width = Math.max(...Object.keys(commands).map((c) => c.length));
  return `
${paint('bold', 'msr')} v${currentVersion()} — missoes diarias do Microsoft Rewards

${paint('dim', 'uso')}  msr [comando] [opcoes]

${Object.entries(commands)
  .map(([name, c]) => `  ${paint('cyan', name.padEnd(width))}  ${c.summary}`)
  .join('\n')}

${paint('dim', 'opcoes')}
  --show        abre o Edge com janela (padrao: sem janela)
  --no-http     le o estado pelo navegador em vez de requisicao direta
  --keep-open   nao fecha o Edge no final
  --fast        encurta as pausas (so para testar; menos "humano")
  --quiet, -q   nao imprime o andamento (continua gravando o log)
  --notify      notificacao do Windows se algo falhar
  --json        saida em JSON (status)
  --help, -h    esta ajuda          --version, -v   versao

${paint('dim', 'saida')}  0 ok · 1 erro · 2 nao logado · 3 Bing nao creditou as buscas
`;
}

/** Normaliza as opcoes: nomes em camelCase e numeros convertidos. */
function readOptions(values) {
  const opts = {};
  for (const [key, value] of Object.entries(values)) {
    const name = key.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    opts[name] = NUMERIC.includes(key) ? Number(value) : value;
    if (NUMERIC.includes(key) && !Number.isFinite(opts[name])) throw new Error(`--${key} precisa de um numero`);
  }
  return opts;
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    console.error(`${paint('red', 'erro:')} ${err.message}\n       veja: msr --help`);
    return EXIT.error;
  }
  const [name = process.stdout.isTTY && process.stdin.isTTY ? 'menu' : 'help', ...args] = parsed.positionals;
  if (parsed.values.version) return void console.log(currentVersion());
  if (parsed.values.help || name === 'help') return void console.log(help());
  cleanupOldExe(); // resto da ultima atualizacao, se houver

  const command = commands[name];
  if (!command) {
    console.error(`${paint('red', 'erro:')} comando desconhecido "${name}"\n       veja: msr --help`);
    return EXIT.error;
  }

  let opts;
  try {
    opts = readOptions(parsed.values);
    if (opts.fast) setTimeScale(0.25);
    const log = createLogger({ quiet: opts.quiet });
    return (await command.action(args, opts, log)) ?? EXIT.ok;
  } catch (err) {
    if (err instanceof BusyError) {
      console.error(`${paint('yellow', 'aviso:')} ${err.message}`);
      return EXIT.error;
    }
    const notLogged = err instanceof NotLoggedInError;
    const message = notLogged ? 'conta Microsoft não detectada no Edge do bot; abra o msr para ver como resolver' : err.message;
    // Tela: mensagem curta. Log: mensagem + pilha, para diagnosticar depois (msr logs --errors).
    console.error(`${paint('red', 'erro:')} ${message}${notLogged ? `\n${accountHelp()}` : ''}`);
    logError(notLogged ? message : String(err.stack ?? err));
    if (opts?.notify && config.notify) await notify('Microsoft Rewards: o bot falhou', message);
    return notLogged ? EXIT.notLoggedIn : EXIT.error;
  }
}
