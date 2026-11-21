// Banco de logs (SQLite): gravar e ler, retencao escolhida pela pessoa e importacao do formato antigo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LogStore, formatLine, parseLegacyLog } from '../src/logs.js';

/** Roda fn com um banco numa pasta temporaria e limpa no fim. */
function withStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msr-logs-'));
  const store = new LogStore(path.join(dir, 'logs.db'));
  try {
    return fn(store, dir);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const at = (day, time) => new Date(`${day}T${time}`);
const messages = (found) => found.rows.map((r) => r.message);

test('logs: le o ultimo dia por padrao, com tail e filtro de erros', () => {
  withStore((store) => {
    store.add('ontem', { date: at('2026-11-19', '10:00:00') });
    store.add('a', { date: at('2026-11-20', '09:00:00') });
    store.add('falhou', { date: at('2026-11-20', '09:00:05'), level: 'error' });
    store.add('c', { date: at('2026-11-20', '09:00:09') });

    assert.equal(store.read().day, '2026-11-20');
    assert.deepEqual(messages(store.read()), ['a', 'falhou', 'c']);
    assert.deepEqual(messages(store.read({ tail: 2 })), ['falhou', 'c']);
    assert.deepEqual(messages(store.read({ day: '2026-11-19' })), ['ontem']);
    assert.deepEqual(messages(store.read({ day: '2026-11-20', errors: true })), ['falhou']);
    assert.equal(store.read({ errors: true }).day, null); // erros de todos os dias
    assert.deepEqual(store.days().map((d) => [d.day, d.lines, d.errors]), [['2026-11-19', 1, 0], ['2026-11-20', 3, 1]]);
    assert.equal(formatLine(store.read({ errors: true }).rows[0]), '[09:00:05] ERRO: falhou');
  });
});

test('logs: banco vazio nao quebra a leitura', () => {
  withStore((store) => {
    assert.deepEqual(store.read(), { day: null, rows: [] });
    assert.deepEqual(store.days(), []);
  });
});

test('logs: retencao apaga so o que passou do prazo; 0 guarda sempre', () => {
  withStore((store) => {
    const now = at('2026-11-21', '12:00:00').getTime();
    store.add('velho', { date: at('2026-10-01', '12:00:00') });
    store.add('recente', { date: at('2026-11-20', '12:00:00') });

    assert.equal(store.prune(0, now), 0);
    assert.equal(store.days().length, 2);
    assert.equal(store.prune(30, now), 1);
    assert.deepEqual(messages(store.read()), ['recente']);
    store.clear();
    assert.deepEqual(store.days(), []);
  });
});

test('logs: importa os arquivos .log antigos, juntando a pilha de erro na mesma linha', () => {
  const text = '[00:29:52] fonte g1: 31 assuntos\n[00:29:55] ERRO: Error: falhou\n    at algum.js:1:1\n\n[00:30:25] nada a fazer\n';
  const parsed = parseLegacyLog(text, '2026-11-20');
  assert.deepEqual(parsed.map((e) => [e.level, e.message]), [
    ['info', 'fonte g1: 31 assuntos'],
    ['error', 'Error: falhou\n    at algum.js:1:1'],
    ['info', 'nada a fazer'],
  ]);
  assert.equal(parsed[0].date.getTime(), at('2026-11-20', '00:29:52').getTime());

  withStore((store, dir) => {
    const legacy = path.join(dir, 'logs');
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, '2026-11-20.log'), text);
    assert.equal(store.importLegacy(legacy), 3);
    assert.equal(fs.existsSync(legacy), false);
    assert.deepEqual(messages(store.read({ day: '2026-11-20', errors: true })), ['Error: falhou\n    at algum.js:1:1']);
    assert.equal(store.importLegacy(legacy), 0); // ja importado: a pasta nao existe mais
  });
});
