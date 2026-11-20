// Leitura do estado do Rewards por requisicao HTTP, sem abrir o navegador.
// Usa os cookies que o bot exporta do Edge (data/session.json) no fim de cada execucao.
// So faz GET de leitura em rewards.bing.com; clicar em cards e buscar no Bing continua
// sendo feito pelo navegador de verdade.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { parseRewards } from './rsc.js';

const SESSION_FILE = path.join(config.dataDir, 'session.json');
const ORIGINS = ['https://rewards.bing.com/', 'https://www.bing.com/'];

function loadSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveSession(session) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session));
}

/** Copia os cookies do navegador aberto para data/session.json. */
export async function exportSession(context, page) {
  const cookies = await context.cookies(ORIGINS);
  const userAgent = await page.evaluate(() => navigator.userAgent);
  saveSession({ savedAt: new Date().toISOString(), userAgent, cookies });
}

export function cookieHeader(session, url) {
  const { hostname, pathname } = new URL(url);
  const now = Date.now() / 1000;
  return session.cookies
    .filter((c) => {
      const domain = c.domain.replace(/^\./, '');
      const hostOk = hostname === domain || (c.domain.startsWith('.') && hostname.endsWith(`.${domain}`));
      return hostOk && pathname.startsWith(c.path || '/') && (c.expires < 0 || c.expires > now);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** Aplica os Set-Cookie da resposta no jar (o site renova cookies de sessao curtos). */
export function storeCookies(session, url, setCookies) {
  const host = new URL(url).hostname;
  for (const line of setCookies) {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const cookie = { name: pair.slice(0, eq), value: pair.slice(eq + 1), domain: host, path: '/', expires: -1 };
    for (const attr of attrs) {
      const [k, v = ''] = attr.split(/=(.*)/s);
      const key = k.toLowerCase();
      if (key === 'domain') cookie.domain = v.startsWith('.') ? v : `.${v}`;
      else if (key === 'path') cookie.path = v;
      else if (key === 'max-age') cookie.expires = Date.now() / 1000 + Number(v);
      else if (key === 'expires' && cookie.expires < 0) cookie.expires = Date.parse(v) / 1000;
      else if (key === 'httponly') cookie.httpOnly = true;
      else if (key === 'secure') cookie.secure = true;
    }
    session.cookies = session.cookies.filter(
      (c) => !(c.name === cookie.name && c.domain === cookie.domain && (c.path || '/') === cookie.path),
    );
    session.cookies.push(cookie);
  }
}

/** GET com os mesmos cabecalhos de uma navegacao do Edge; segue redirects so dentro do bing.com. */
async function get(session, startUrl) {
  const major = (session.userAgent.match(/Edg\/(\d+)/) ?? [])[1] ?? '140';
  let url = startUrl;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent': session.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'sec-ch-ua': `"Not-A.Brand";v="99", "Microsoft Edge";v="${major}", "Chromium";v="${major}"`,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        Cookie: cookieHeader(session, url),
      },
    });
    storeCookies(session, url, res.headers.getSetCookie());
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get('location') ?? '', url);
      if (!/(^|\.)bing\.com$/.test(next.hostname)) throw new Error('sessao expirada (o site pediu login)');
      url = next.href;
      continue;
    }
    if (!res.ok) throw new Error(`o site respondeu HTTP ${res.status}`);
    return res.text();
  }
  throw new Error('redirecionamentos demais');
}

/** Por que a ultima leitura por requisicao falhou (para o `msr doctor`); null se deu certo. */
export let httpIssue = null;

/**
 * Estado completo (saldo, buscas, cards, pontos a reivindicar) via HTTP.
 * Retorna null se nao der (sem sessao salva, sessao expirada, site fora); ai o chamador usa o
 * navegador, que tambem renova a sessao.
 */
export async function fetchState() {
  httpIssue = null;
  try {
    const session = loadSession();
    if (!session) throw new Error('ainda nao ha sessao salva');
    const earn = parseRewards(await get(session, 'https://rewards.bing.com/earn'));
    if (!earn) throw new Error('a pagina veio sem os dados da conta');
    const dashboard = parseRewards(await get(session, 'https://rewards.bing.com/dashboard'));
    saveSession(session);
    return { ...earn, claimable: dashboard?.claimable };
  } catch (err) {
    httpIssue = err.message;
    return null;
  }
}
