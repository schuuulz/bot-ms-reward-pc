import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { config } from './config.js';
import { sleep } from './human.js';
import { setProfileLanguages } from './profile.js';
import { powershell } from './win.js';

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

/** User-agent que o Edge de uma versao ("157.0.4341.60") usa em modo normal; null se ilegivel. */
export function userAgentFor(version) {
  const major = Number((String(version).match(/^(\d+)\./) ?? [])[1]);
  if (!major) return null;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`;
}

/**
 * Versao do msedge.exe que vai ser aberto, lida do proprio arquivo. A pasta de instalacao nao
 * serve de fonte: com uma atualizacao do Edge pendente ela ja tem a pasta da versao seguinte, e o
 * bot anunciaria uma versao diferente da que o navegador informa nos outros cabecalhos.
 */
async function edgeVersion(exe) {
  try {
    return await powershell('(Get-Item -LiteralPath $env:MSR_EXE).VersionInfo.ProductVersion', { env: { MSR_EXE: exe }, timeout: 15000 });
  } catch {
    // Sem PowerShell: a maior pasta de versao e o melhor palpite (certo quando nao ha atualizacao pendente).
    const versions = fs.readdirSync(path.dirname(exe)).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d));
    return versions.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)).at(-1) ?? '';
  }
}

/**
 * Sem janela. O headless "cru" se entrega: o user-agent vira "HeadlessChrome/..." e a tela
 * aparece como 800x600. Estas flags devolvem o user-agent normal e uma tela de verdade.
 */
async function headlessArgs(exe) {
  const ua = userAgentFor(await edgeVersion(exe));
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
    setProfileLanguages(config.languages); // o Edge esta fechado: e a hora de acertar o idioma
    spawn(
      exe,
      [
        `--remote-debugging-port=${config.port}`,
        `--user-data-dir=${config.profileDir}`,
        ...PROFILE_ARGS,
        ...(headless ? await headlessArgs(exe) : []),
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
  const cdp = await browser.newBrowserCDPSession();
  // Quem responde na porta precisa ser o Edge do bot (o do perfil dele). Outro navegador aberto
  // com depuracao na mesma porta nao pode ser controlado por engano.
  const { commandLine = '' } = await cdp.send('SystemInfo.getInfo').catch(() => ({}));
  if (!commandLine.toLowerCase().includes(config.profileDir.toLowerCase())) {
    await browser.close().catch(() => {}); // so desconecta
    throw new Error(`a porta ${config.port} esta em uso por outro navegador, nao pelo Edge do bot; feche-o ou mude "port" em data/config.json`);
  }
  // O bot nunca baixa nada: nem resultado de busca, nem pagina de card.
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
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
