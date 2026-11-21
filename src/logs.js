// Logs das execucoes em SQLite (data/logs.db), com o node:sqlite que ja vem no Node.
// Uma linha por mensagem: quando (ts, day), de qual execucao (run) e o nivel (info | error).
// Por quanto tempo guardar e escolha da pessoa: config.logDays dias, ou 0 para guardar sempre.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { paint } from './ui.js';

const dayOf = (date) => date.toLocaleDateString('sv-SE'); // AAAA-MM-DD, hora local
const RUN = Date.now(); // identifica esta execucao: todas as linhas do processo levam o mesmo valor

/**
 * Le um arquivo de log antigo (data/logs/AAAA-MM-DD.log, linhas "[HH:MM:SS] mensagem").
 * Linhas sem hora (a pilha de um erro) continuam a mensagem anterior.
 */
export function parseLegacyLog(text, day) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\] (.*)$/);
    if (m) {
      const error = m[2].startsWith('ERRO: ');
      entries.push({ date: new Date(`${day}T${m[1]}`), level: error ? 'error' : 'info', message: error ? m[2].slice(6) : m[2] });
    } else if (entries.length && line) {
      entries.at(-1).message += `\n${line}`;
    }
  }
  return entries;
}

export class LogStore {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // timeout: espera ate 5 s se outra execucao (agendada + manual) estiver gravando.
    this.db = new DatabaseSync(file, { timeout: 5000 });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS log (
        id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, day TEXT NOT NULL, run INTEGER NOT NULL,
        level TEXT NOT NULL, message TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS log_day ON log (day);
    `);
    this.insert = this.db.prepare('INSERT INTO log (ts, day, run, level, message) VALUES (?, ?, ?, ?, ?)');
  }

  add(message, { level = 'info', date = new Date(), run = RUN } = {}) {
    this.insert.run(date.getTime(), dayOf(date), run, level, String(message));
  }

  /**
   * Linhas de um dia, as `tail` ultimas (0 = todas). Sem `day`: o ultimo dia com log. Com
   * `errors` e sem `day`: os erros de todos os dias. Retorna { day, rows }; day null = varios dias.
   */
  read({ day, tail = 0, errors = false } = {}) {
    const allDays = errors && !day;
    if (!allDays) day ??= this.db.prepare('SELECT max(day) AS day FROM log').get().day;
    const where = [...(allDays ? [] : ['day = ?']), ...(errors ? ["level = 'error'"] : [])].join(' AND ') || '1';
    const rows = this.db
      .prepare(`SELECT * FROM (SELECT id, ts, level, message FROM log WHERE ${where} ORDER BY id DESC LIMIT ?) ORDER BY id`)
      .all(...(allDays ? [] : [day ?? '']), tail > 0 ? tail : -1);
    return { day: allDays ? null : (day ?? null), rows };
  }

  /** Dias guardados: [{ day, lines, errors }], do mais antigo ao mais novo. */
  days() {
    return this.db.prepare("SELECT day, count(*) AS lines, sum(level = 'error') AS errors FROM log GROUP BY day ORDER BY day").all();
  }

  /** Apaga o que tem mais de `keepDays` dias (0 = guarda sempre). Retorna quantas linhas apagou. */
  prune(keepDays, now = Date.now()) {
    if (!(keepDays > 0)) return 0;
    return Number(this.db.prepare('DELETE FROM log WHERE ts < ?').run(now - keepDays * 864e5).changes);
  }

  clear() {
    this.db.exec('DELETE FROM log; VACUUM;');
  }

  /** Importa os arquivos .log de `dir` (formato antigo) e apaga a pasta. Retorna quantas linhas. */
  importLegacy(dir) {
    if (!fs.existsSync(dir)) return 0;
    // Renomeia antes de ler: se duas execucoes abrirem juntas, so uma importa.
    const claimed = `${dir}.importando-${process.pid}`;
    try {
      fs.renameSync(dir, claimed);
    } catch {
      return 0;
    }
    let count = 0;
    this.db.exec('BEGIN');
    for (const name of fs.readdirSync(claimed).sort()) {
      const day = (name.match(/^(\d{4}-\d{2}-\d{2})\.log$/) ?? [])[1];
      if (!day) continue;
      for (const entry of parseLegacyLog(fs.readFileSync(path.join(claimed, name), 'utf8'), day)) {
        this.add(entry.message, { level: entry.level, date: entry.date, run: 0 });
        count++;
      }
    }
    this.db.exec('COMMIT');
    fs.rmSync(claimed, { recursive: true, force: true });
    return count;
  }

  close() {
    this.db.close();
  }
}

/** Linha como aparece na tela e no arquivo exportado. `withDay` quando ha varios dias juntos. */
export function formatLine(row, { withDay = false } = {}) {
  const date = new Date(row.ts);
  const when = `${withDay ? `${dayOf(date)} ` : ''}${date.toLocaleTimeString('pt-BR')}`;
  return `[${when}] ${row.level === 'error' ? 'ERRO: ' : ''}${row.message}`;
}

let store;

/** O banco de logs do msr, aberto no primeiro uso. */
export function logStore() {
  if (!store) {
    store = new LogStore(path.join(config.dataDir, 'logs.db'));
    store.importLegacy(path.join(config.dataDir, 'logs'));
    process.once('exit', () => store.close());
  }
  return store;
}

let warned = false;

/** Grava sem derrubar a execucao se o banco estiver inacessivel (avisa uma vez). */
function write(message, level) {
  try {
    logStore().add(message, { level });
  } catch (err) {
    if (!warned) console.error(`${paint('yellow', 'aviso:')} nao consegui gravar o log (${err.message})`);
    warned = true;
  }
}

export const logError = (message) => write(message, 'error');

/** Logger das execucoes: grava no banco e (se nao --quiet) mostra hora + mensagem na tela. */
export function createLogger({ quiet = false } = {}) {
  try {
    logStore().prune(config.logDays);
  } catch {
    /* o aviso sai na primeira gravacao */
  }
  return (message) => {
    write(message, 'info');
    if (!quiet) console.log(`${paint('dim', new Date().toLocaleTimeString('pt-BR'))}  ${message}`);
  };
}
