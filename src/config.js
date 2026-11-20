import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  // Perfil exclusivo do bot. O Edge entra sozinho na conta Microsoft do Windows (SSO).
  profileDir: path.join(root, '.edge-profile'),
  dataDir: path.join(root, 'data'),
  port: Number(process.env.MSR_PORT || 9222),
  edgePaths: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],

  // true: Edge sem janela (headless). false: janela visivel. --show / --headless mudam por execucao.
  headless: true,
  // Tela que o Edge headless declara aos sites (resolucao e altura da barra de tarefas).
  headlessScreen: '1920x1080 workAreaBottom=48',

  // true: le o estado (saldo, contador, cards) por requisicao HTTP com os cookies salvos em
  // data/session.json, e so abre o navegador se houver algo a fazer. false: sempre pelo navegador.
  httpStatus: true,

  // Banner de cookies do Bing/Rewards: 'reject' ou 'accept'.
  cookieBanner: 'reject',

  // Reivindicar sozinho os pontos pendentes ("Pronto para reivindicar") no fim de cada execucao.
  // Com false, so reivindica quando voce roda com --claim.
  autoClaim: false,

  search: {
    pointsPerSearch: 3, // usado so como palpite inicial; o bot corrige pelo contador real
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

  historyDays: 180, // nunca repete uma busca dentro desse periodo
};
