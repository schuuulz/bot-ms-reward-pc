// Historico diario (data/days.json): um registro por dia do Rewards, atualizado a cada execucao.
// Serve para o `msr stats` e para perceber cedo quando as buscas param de fechar.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const FILE = path.join(config.dataDir, 'days.json');

export function loadDays() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Resumo de um estado (parseRewards) no formato guardado por dia. */
export function summarize(state) {
  const daily = state.cards.filter((c) => c.section === 'dailyset');
  return {
    balance: state.balance,
    points: state.todayPoints ?? null,
    search: state.search ? [state.search.earned, state.search.max] : null,
    daily: [daily.filter((c) => c.done).length, daily.length],
  };
}

/** Grava o registro do dia. `issues` acumula entre as execucoes do mesmo dia. */
export function recordDay(state, issues = []) {
  const days = loadDays();
  const day = state.day ?? new Date().toLocaleDateString('sv-SE');
  const previous = days[day]?.issues ?? [];
  days[day] = { ...summarize(state), issues: [...new Set([...previous, ...issues])] };

  const keep = Object.keys(days).sort().slice(-config.statsDays);
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(keep.map((d) => [d, days[d]])), null, 1));
}
