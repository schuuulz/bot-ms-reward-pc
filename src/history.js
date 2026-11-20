import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export const normalize = (q) =>
  q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local

/** Memoria das buscas ja feitas, para nunca repetir de um dia para o outro. */
export class History {
  constructor(file = path.join(config.dataDir, 'history.json')) {
    this.file = file;
    this.data = { queries: {}, stems: [] };
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      /* primeiro uso */
    }
    const cutoff = new Date(Date.now() - config.historyDays * 864e5).toLocaleDateString('sv-SE');
    for (const [q, date] of Object.entries(this.data.queries)) {
      if (date < cutoff) delete this.data.queries[q];
    }
  }

  has(query) {
    return normalize(query) in this.data.queries;
  }

  add(query) {
    const n = normalize(query);
    if (n) this.data.queries[n] = today();
    this.save();
  }

  /** "Moldes" de busca usados recentemente (receita de..., como fazer...), para variar o estilo. */
  stemRecent(stem) {
    return this.data.stems.includes(stem);
  }

  addStem(stem) {
    this.data.stems = [...this.data.stems.filter((s) => s !== stem), stem].slice(-45);
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1));
  }
}
