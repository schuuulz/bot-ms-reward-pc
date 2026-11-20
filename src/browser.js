import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { config } from './config.js';
import { sleep } from './human.js';

const endpoint = () => `http://127.0.0.1:${config.port}`;

/** Ha um Edge do bot aberto (respondendo na porta de depuracao)? */
export async function cdpAlive() {
  try {
    const r = await fetch(`${endpoint()}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** User-agent que o Edge instalado usa em modo normal (a versao vem da pasta de instalacao). */
function normalUserAgent(exe) {
  const majors = fs
    .readdirSync(path.dirname(exe))
    .map((d) => Number((d.match(/^(\d+)\.\d+\.\d+\.\d+$/) ?? [])[1]))
    .filter(Boolean);
  if (!majors.length) return null;
  const v = Math.max(...majors);
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36 Edg/${v}.0.0.0`;
}

/**
 * Sem janela. O headless "cru" se entrega: o user-agent vira "HeadlessChrome/..." e a tela
 * aparece como 800x600. Estas flags devolvem o user-agent normal e uma tela de verdade.
 */
function headlessArgs(exe) {
  const ua = normalUserAgent(exe);
  if (!ua) throw new Error('nao consegui descobrir a versao do Edge para o modo headless; rode com --show');
  return ['--headless=new', `--user-agent=${ua}`, '--window-size=1366,900', `--screen-info={${config.headlessScreen}}`];
}

export const findEdge = () => config.edgePaths.find((p) => fs.existsSync(p));

// O perfil do bot existe so para estar logado na conta: nada do Edge pessoal e sincronizado para
// ele e nenhuma extensao carrega. Nenhuma destas flags e visivel para os sites.
const PROFILE_ARGS = [
  '--disable-sync',
  '--disable-extensions',
  '--disable-component-update', // nao baixa componentes que o bot nao usa (centenas de MB)
  '--disk-cache-size=52428800', // cache HTTP limitado a 50 MB
  '--no-first-run',
  '--no-default-browser-check',
];

/**
 * Abre o Edge de verdade (processo normal, sem flags de automacao) com o perfil do bot
 * e conecta via CDP. Se ja houver um Edge do bot aberto na porta, so conecta nele.
 */
export async function openBrowser({ headless = config.headless } = {}) {
  let spawned = false;
  if (!(await cdpAlive())) {
    const exe = findEdge();
    if (!exe) throw new Error('msedge.exe nao encontrado; ajuste edgePaths em data/config.json');
    fs.mkdirSync(config.profileDir, { recursive: true });
    spawn(
      exe,
      [
        `--remote-debugging-port=${config.port}`,
        `--user-data-dir=${config.profileDir}`,
        ...PROFILE_ARGS,
        ...(headless ? headlessArgs(exe) : []),
        'about:blank',
      ],
      { detached: true, stdio: 'ignore' },
    ).unref();
    spawned = true;
    const deadline = Date.now() + 30000;
    while (!(await cdpAlive())) {
      if (Date.now() > deadline) throw new Error(`Edge nao abriu a porta ${config.port}`);
      await sleep(500);
    }
  }
  const browser = await chromium.connectOverCDP(endpoint());
  const context = browser.contexts()[0];
  return { browser, context, spawned };
}

/** Fecha o Edge se foi o bot que abriu; senao so desconecta. */
export async function closeBrowser({ browser, spawned }) {
  if (spawned) {
    try {
      const session = await browser.newBrowserCDPSession();
      await session.send('Browser.close');
      return;
    } catch {
      /* cai para o disconnect */
    }
  }
  await browser.close().catch(() => {});
}
