import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');

const defaults = {
  port: 9222, // porta de depuracao (CDP) do Edge do bot
  edgePaths: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],

  // true: Edge sem janela (headless). false: janela visivel. --show muda por execucao.
  headless: true,
  // Tela que o Edge headless declara aos sites (resolucao e altura da barra de tarefas).
  headlessScreen: '1920x1080 workAreaBottom=48',

  // true: le o estado (saldo, contador, cards) por requisicao HTTP com os cookies salvos em
  // data/session.json, e so abre o navegador se houver algo a fazer. false: sempre pelo navegador.
  httpStatus: true,

  // Banner de cookies do Bing/Rewards: 'reject' ou 'accept'.
  cookieBanner: 'reject',

  // Reivindicar sozinho os pontos pendentes ("Pronto para reivindicar") no fim de cada execucao.
  autoClaim: false,

  // Notificacao do Windows quando uma execucao agendada falha.
  notify: true,

  search: {
    pointsPerSearch: 3, // palpite inicial; o bot corrige pelo contador real
    fallbackCount: 20, // quantas buscas fazer se nao conseguir ler o contador
    extraChance: 0.35, // chance de fazer 1-2 buscas alem do limite (ninguem para exatamente no limite)
    checkEvery: [4, 6], // confere o contador de pontos a cada N buscas
    gapMedianSec: 40, // intervalo tipico entre buscas (distribuicao log-normal)
    gapMinSec: 10,
    gapMaxSec: 240,
    longBreakChance: 0.2, // pausa longa entre assuntos
    longBreakSec: [90, 300],
    clickResultChance: 0.28, // abrir um resultado e ler um pouco
    suggestChance: 0.15, // digitar so parte e clicar numa sugestao do Bing
    relatedChance: 0.3, // continuar o assunto clicando em "pesquisas relacionadas"
    stripAccentsChance: 0.3, // digitar sem acento, como muita gente faz
    typoRate: 0.025,
    cooldownMin: [15, 19], // pausa (minutos) quando o Bing para de dar pontos
    maxCooldowns: 2,
  },

  // Ritmo do dia para `msr run --paced`: a meta de buscas cresce de 0% em startHour ate 100% em
  // finishHour; depois de finishHour faz tudo o que falta.
  pacing: { startHour: 8, finishHour: 20, jitter: 0.2, minPerSession: 3 },

  // Padroes de `msr schedule install`.
  schedule: { taskName: 'MsRewardsBot', times: ['09:30', '14:30', '20:30'], jitterMinutes: 90 },

  historyDays: 180, // nunca repete uma busca dentro desse periodo
  statsDays: 400, // dias guardados em data/days.json
  logDays: 30, // logs mais antigos sao apagados
};

/** Mescla o override sobre os padroes (objetos por chave; listas e valores sao substituidos). */
function merge(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over ?? {})) {
    const both = [base[key], value].every((v) => v && typeof v === 'object' && !Array.isArray(v));
    out[key] = both ? merge(base[key], value) : value;
  }
  return out;
}

function readOverrides() {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

// Ajustes pessoais vao em data/config.json (fora do git), ex.: { "autoClaim": true }.
export const config = {
  ...merge(defaults, readOverrides()),
  root,
  dataDir,
  // Perfil do Edge exclusivo do bot: serve so para estar logado na conta (ver browser.js).
  profileDir: path.join(root, '.edge-profile'),
};
