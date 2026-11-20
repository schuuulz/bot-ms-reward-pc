// Saida do terminal: cores, barras, tabela e o logger (tela + arquivo diario).

import fs from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';
import { config } from './config.js';

const colors = process.stdout.isTTY && !process.env.NO_COLOR;
export const paint = (style, text) => (colors ? styleText(style, String(text)) : String(text));
export const num = (n) => (n == null ? '?' : n.toLocaleString('pt-BR'));

export function bar(done, total, width = 12) {
  const filled = total > 0 ? Math.round((Math.min(done, total) / total) * width) : 0;
  return paint(done >= total ? 'green' : 'yellow', '█'.repeat(filled)) + paint('dim', '░'.repeat(width - filled));
}

/** Linhas alinhadas em colunas. `rows` e uma lista de listas de strings (sem cor). */
export function table(rows, { head } = {}) {
  const all = head ? [head, ...rows] : rows;
  const widths = all[0].map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)));
  const line = (r) => r.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ').trimEnd();
  return [...(head ? [paint('dim', line(head))] : []), ...rows.map(line)].join('\n');
}

const logDir = path.join(config.dataDir, 'logs');
export const logFileFor = (date = new Date()) => path.join(logDir, `${date.toLocaleDateString('sv-SE')}.log`);

/** Apaga logs mais antigos que config.logDays. */
function pruneLogs() {
  const cutoff = Date.now() - config.logDays * 864e5;
  for (const name of fs.existsSync(logDir) ? fs.readdirSync(logDir) : []) {
    const file = path.join(logDir, name);
    if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
  }
}

/** Logger das execucoes: hora + mensagem no arquivo do dia e (se nao --quiet) na tela. */
export function createLogger({ quiet = false } = {}) {
  fs.mkdirSync(logDir, { recursive: true });
  pruneLogs();
  return (message) => {
    const time = new Date().toLocaleTimeString('pt-BR');
    fs.appendFileSync(logFileFor(), `[${time}] ${message}\n`);
    if (!quiet) console.log(`${paint('dim', time)}  ${message}`);
  };
}

const ratio = (c) => (c ? `${c.earned}/${c.max}` : '?');

/** Painel do estado do Rewards (saida de `msr status` e cabecalho do menu). */
export function renderState(state, pending) {
  const daily = state.cards.filter((c) => c.section === 'dailyset');
  const dailyDone = daily.filter((c) => c.done).length;
  const rows = [
    ['Saldo', `${paint('bold', num(state.balance))} pts`, state.todayPoints != null ? paint('dim', `+${num(state.todayPoints)} hoje`) : ''],
    ['Buscas', ratio(state.search), state.search ? bar(state.search.earned, state.search.max) : ''],
  ];
  if (state.mobileSearch) rows.push(['Buscas mobile', ratio(state.mobileSearch), bar(state.mobileSearch.earned, state.mobileSearch.max)]);
  if (daily.length) rows.push(['Conjunto diário', `${dailyDone}/${daily.length}`, bar(dailyDone, daily.length)]);
  rows.push(['Cards', pending.length ? paint('yellow', `${pending.length} pendente(s)`) : paint('green', 'nenhum pendente'), '']);
  if (state.claimable) rows.push(['A reivindicar', paint('yellow', state.claimable === true ? 'sim' : `${num(state.claimable)} pts`), paint('dim', 'msr claim')]);

  const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length; // largura sem os codigos de cor
  const label = Math.max(...rows.map((r) => r[0].length));
  const value = Math.max(...rows.filter((r) => r[2]).map((r) => visible(r[1])));
  const lines = rows.map(
    ([k, v, extra]) => `  ${paint('dim', k.padEnd(label))}  ${v}${extra ? `${' '.repeat(value - visible(v))}  ${extra}` : ''}`,
  );
  for (const c of pending) lines.push(`  ${' '.repeat(label)}  ${paint('dim', `· ${c.title} (+${c.points})`)}`);
  return lines.join('\n');
}
