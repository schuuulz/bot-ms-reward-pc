// Atualizacao do msr pelas releases do GitHub.
//  - checkUpdate: consulta a ultima release. So e chamado ao abrir o menu, no doctor e em
//    `msr update`: execucoes agendadas nao consultam nada. A resposta fica em data/update.json
//    como reserva para quando a consulta falhar.
//  - applyUpdate: so quando a pessoa pede. Baixa o msr.exe.gz da release por https, confere o
//    SHA-256 com o que o GitHub informa para o arquivo, testa o exe novo e troca o atual por ele.
// O que isso garante: o arquivo instalado e exatamente o publicado no repositorio abaixo.

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { config } from './config.js';
import { POWERSHELL, powershell } from './win.js';

export const REPO = 'schuuulz/bot-ms-reward-pc';
const ASSET = 'msr.exe.gz';
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const ASSET_PREFIX = `https://github.com/${REPO}/releases/download/`;
// O GitHub redireciona o download para um destes hosts; qualquer outro destino e recusado.
const DOWNLOAD_HOSTS = /^(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)$/;
const MAX_EXE_BYTES = 400 * 1024 * 1024; // teto do exe descompactado (hoje ~110 MB)
const CACHE = path.join(config.dataDir, 'update.json');

export const currentVersion = () => JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')).version;

const parts = (v) => String(v).replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);

/** `candidate` e uma versao maior que `current`? (x.y.z, comparado numero a numero) */
export function isNewer(candidate, current) {
  const [a, b] = [parts(candidate), parts(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/**
 * Tira da resposta da API o que o atualizador precisa. Retorna null se a release nao tiver o
 * binario, ou se a URL ou o hash nao forem do formato esperado (nada fora do repositorio).
 */
export function parseRelease(release) {
  const asset = release?.assets?.find((a) => a.name === ASSET);
  const version = String(release?.tag_name ?? '').replace(/^v/, '');
  const sha256 = (String(asset?.digest ?? '').match(/^sha256:([0-9a-f]{64})$/) ?? [])[1];
  if (!/^\d+\.\d+\.\d+$/.test(version) || !sha256 || !asset.browser_download_url?.startsWith(ASSET_PREFIX)) return null;
  return { version, url: asset.browser_download_url, sha256, size: asset.size };
}

/**
 * A ultima resposta guardada serve de reserva quando a consulta falha? So se foi gravada por
 * esta mesma versao do msr (depois de atualizar, o que estava guardado ja nao diz nada).
 */
export function cacheUsable(cache, current) {
  return Boolean(cache) && cache.current === current;
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Ha versao nova? Consulta o GitHub toda vez (e uma chamada so, ao abrir o menu, o doctor ou o
 * update): uma release recem-publicada aparece na hora. Se a consulta falhar (sem rede, limite
 * da API), vale a ultima resposta guardada. Retorna { current, latest, available }, com
 * latest = { version, url, sha256, size }, ou null se nao deu para saber. Nunca lanca.
 */
export async function checkUpdate() {
  const current = currentVersion();
  const result = (latest) => ({ current, latest, available: Boolean(latest) && isNewer(latest.version, current) });
  try {
    const res = await fetch(LATEST, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `msr/${current}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status !== 200 && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    const latest = res.status === 200 ? parseRelease(await res.json()) : null; // 404: ainda sem release
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify({ checkedAt: Date.now(), current, latest }));
    return result(latest);
  } catch {
    const cache = readCache();
    return cacheUsable(cache, current) ? result(cache.latest) : null;
  }
}

/** GET seguindo redirects a mao, para recusar qualquer salto fora do GitHub ou sem https. */
async function download(startUrl) {
  let url = startUrl;
  for (let hop = 0; hop < 5; hop++) {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:' || !DOWNLOAD_HOSTS.test(hostname)) throw new Error(`download recusado: endereco inesperado (${hostname})`);
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': `msr/${currentVersion()}` }, signal: AbortSignal.timeout(600000) });
    if (res.status >= 300 && res.status < 400) {
      url = new URL(res.headers.get('location') ?? '', url).href;
      continue;
    }
    if (!res.ok) throw new Error(`o GitHub respondeu HTTP ${res.status}`);
    return res;
  }
  throw new Error('redirecionamentos demais');
}

const exec = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, ...env }, windowsHide: true, timeout: 120000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.trim()),
    );
  });

/**
 * Troca o msr.exe em uso pela versao `latest` (de checkUpdate). So funciona no exe.
 * O exe em execucao nao pode ser sobrescrito no Windows, mas pode ser renomeado: ele vira
 * msr.exe.old (apagado sozinho assim que este processo fecha) e o novo entra no mesmo caminho,
 * entao o agendamento continua valendo. Login e dados nao sao tocados.
 */
export async function applyUpdate(latest, log = () => {}) {
  if (!config.packaged) throw new Error('a atualizacao automatica so existe no msr.exe; no checkout use: git pull && npm install');
  const exe = process.execPath;
  const fresh = `${exe.replace(/\.exe$/i, '')}.new.exe`; // precisa terminar em .exe para ser testado
  const old = `${exe}.old`;
  try {
    log(`baixando a versao ${latest.version} (${(latest.size / 1048576).toFixed(0)} MB)...`);
    const res = await download(latest.url);
    const hash = crypto.createHash('sha256');
    let written = 0;
    const hashing = new Transform({ transform: (chunk, _enc, done) => done(null, (hash.update(chunk), chunk)) });
    const capped = new Transform({
      transform: (chunk, _enc, done) => ((written += chunk.length) > MAX_EXE_BYTES ? done(new Error('arquivo maior que o esperado')) : done(null, chunk)),
    });
    await pipeline(Readable.fromWeb(res.body), hashing, zlib.createGunzip(), capped, fs.createWriteStream(fresh));
    if (hash.digest('hex') !== latest.sha256) throw new Error('o arquivo baixado nao confere com o hash publicado (SHA-256); nada foi alterado');

    log('conferido; testando o novo msr.exe...');
    const reported = await exec(fresh, ['--version']);
    if (reported !== latest.version) throw new Error(`o arquivo baixado diz ser a versao "${reported}", esperava ${latest.version}`);

    fs.rmSync(old, { force: true });
    fs.renameSync(exe, old);
    try {
      fs.renameSync(fresh, exe);
    } catch (err) {
      fs.renameSync(old, exe); // desfaz: o msr atual continua no lugar
      throw err;
    }
    await deleteWhenThisExits(old).catch(() => {}); // se falhar, a proxima abertura apaga (cleanupOldExe)
    fs.rmSync(CACHE, { force: true });
  } catch (err) {
    fs.rmSync(fresh, { force: true });
    throw err;
  }
}

// O ajudante: espera este processo terminar e apaga o arquivo de vez (sem lixeira). Tenta por
// 10 s, para o caso de o Windows ainda estar soltando o arquivo. Sem aspas duplas, porque vai
// dentro de um argumento entre aspas.
const DELETE_AFTER_EXIT =
  'Wait-Process -Id $env:MSR_PID -ErrorAction SilentlyContinue; ' +
  'for ($i = 0; $i -lt 20; $i++) { Remove-Item -LiteralPath $env:MSR_FILE -Force -ErrorAction SilentlyContinue; ' +
  'if (-not (Test-Path -LiteralPath $env:MSR_FILE)) { break }; Start-Sleep -Milliseconds 500 }';

// Um filho direto do msr morre junto com ele (o Node amarra os filhos ao proprio processo), e sem
// console o PowerShell nem inicia. Por isso o ajudante e criado pelo Start-Process, como um
// processo a parte e de janela escondida; ele herda as variaveis MSR_PID e MSR_FILE.
const START_HELPER = String.raw`
Start-Process -FilePath $env:MSR_PS -WindowStyle Hidden -ArgumentList ('-NoProfile -NonInteractive -Command "' + $env:MSR_HELPER + '"')
`;

/**
 * O exe antigo nao pode ser apagado enquanto este processo roda a partir dele. Um ajudante fica
 * esperando o msr fechar e apaga o arquivo em seguida, sem precisar abrir o msr de novo.
 */
const deleteWhenThisExits = (file) =>
  powershell(START_HELPER, { env: { MSR_PS: POWERSHELL, MSR_HELPER: DELETE_AFTER_EXIT, MSR_PID: String(process.pid), MSR_FILE: file } });

/**
 * Reserva do ajudante acima: se o msr.exe.old ainda existir ao abrir (outra execucao do exe antigo
 * estava em andamento na hora da troca), apaga agora.
 */
export function cleanupOldExe() {
  if (config.packaged) fs.rm(`${process.execPath}.old`, { force: true }, () => {});
}
