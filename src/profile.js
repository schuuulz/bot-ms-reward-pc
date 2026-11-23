// Perfil do Edge do bot: medir, conferir e limpar.
// O perfil serve so para manter o login (cookies). Extensoes, dados sincronizados do Edge
// pessoal (favoritos, senhas, historico, preenchimento automatico) e caches nao tem uso para o
// bot e sao o que ocupa espaco. O que guarda o login fica: Network/Cookies, Local Storage,
// Preferences e Local State.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Relativo a pasta Default do perfil.
const SYNCED_DIRS = [
  'Extensions', 'Extension State', 'Extension Rules', 'Extension Scripts', 'Local Extension Settings',
  'Sync Extension Settings', 'Sync App Settings', 'Managed Extension Settings', 'DNR Extension Rules',
  'Sync Data', 'Collections', 'Sessions', 'Workspaces', 'EdgeWallet', 'EdgeCoupons',
];
// Arquivos de Default cujo nome comeca com um destes (inclui -journal, .bak etc.).
const SYNCED_FILES = [
  'Bookmarks', 'EncryptedBookmarks', 'Login Data', 'Web Data', 'History', 'Top Sites', 'Favicons',
  'Shortcuts', 'Visited Links',
];
const CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Service Worker/CacheStorage', 'Service Worker/ScriptCache'];
// Relativo a raiz do perfil: componentes baixados pelo Edge e caches globais.
const ROOT_DIRS = [
  'component_crx_cache', 'extensions_crx_cache', 'ProvenanceData', 'WidevineCdm', 'Edge Entity Extraction', 'Edge Wallet',
  'Subresource Filter', 'GrShaderCache', 'ShaderCache', 'GraphiteDawnCache', 'BrowserMetrics',
];

const profile = (...parts) => path.join(config.profileDir, ...parts);

export function dirSize(target) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += fs.statSync(full, { throwIfNoEntry: false })?.size ?? 0;
  }
  return total;
}

const syncedFiles = () => list(profile('Default')).filter((name) => SYNCED_FILES.some((p) => name.startsWith(p)));

const list = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

/** Extensoes instaladas de verdade (pasta <id>/<versao>/manifest.json), fora as internas do Edge. */
function installedExtensions() {
  const root = profile('Default', 'Extensions');
  return list(root).filter((id) => list(path.join(root, id)).some((v) => fs.existsSync(path.join(root, id, v, 'manifest.json'))));
}

/** Tamanho do perfil e sinais de que ha algo alem do login dentro dele. */
export function profileInfo() {
  return {
    bytes: dirSize(config.profileDir),
    extensions: installedExtensions().length,
    // O bot nunca cria favoritos: um arquivo de favoritos com conteudo so aparece se o perfil
    // sincronizou com o Edge pessoal.
    syncedData: list(profile('Default'))
      .filter((name) => /^(Encrypted)?Bookmarks/.test(name))
      .some((name) => fs.statSync(profile('Default', name)).size > 2048),
  };
}

/**
 * Deixa o perfil com os idiomas `languages` ("pt-BR,pt,en"). Um perfil novo herda o idioma de
 * exibicao do Windows, que pode nao ser o da conta: ai o Rewards mostra outro conjunto de cards.
 * O Edge precisa estar fechado (ele regrava o Preferences ao sair). Retorna true se alterou.
 */
export function setProfileLanguages(languages, dir = config.profileDir) {
  const file = path.join(dir, 'Default', 'Preferences');
  let prefs = {};
  try {
    prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') return false; // ilegivel: melhor nao mexer do que perder o login
  }
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return false;
  const intl = prefs.intl && typeof prefs.intl === 'object' ? prefs.intl : {};
  if (intl.accept_languages === languages && intl.selected_languages === languages) return false;
  prefs.intl = { ...intl, accept_languages: languages, selected_languages: languages };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prefs));
  return true;
}

/**
 * Apaga tudo que nao e necessario para o login. O Edge do bot precisa estar fechado.
 * Retorna quantos bytes foram liberados.
 */
export function cleanProfile() {
  const before = dirSize(config.profileDir);
  const targets = [
    ...[...SYNCED_DIRS, ...CACHE_DIRS, ...syncedFiles()].map((p) => profile('Default', p)),
    ...ROOT_DIRS.map((p) => profile(p)),
  ];
  for (const target of targets) fs.rmSync(target, { recursive: true, force: true });
  return before - dirSize(config.profileDir);
}
