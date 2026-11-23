// Atualizacao (versoes, leitura da release, reserva guardada) e protecao DPAPI do Windows.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REPO, cacheUsable, extractZipEntry, isNewer, parseRelease } from '../src/update.js';
import { protect, unprotect } from '../src/win.js';

test('versoes: compara numero a numero, com ou sem "v"', () => {
  assert.equal(isNewer('2.1.0', '2.0.9'), true);
  assert.equal(isNewer('v2.10.0', '2.9.3'), true); // 10 > 9: nao e comparacao de texto
  assert.equal(isNewer('3.0.0', '2.99.99'), true);
  assert.equal(isNewer('2.1.0', '2.1.0'), false);
  assert.equal(isNewer('2.0.9', '2.1.0'), false);
  assert.equal(isNewer('lixo', '2.1.0'), false);
});

const sha = 'a'.repeat(64);
const asset = (over = {}) => ({
  name: 'msr.zip',
  size: 42000000,
  digest: `sha256:${sha}`,
  browser_download_url: `https://github.com/${REPO}/releases/download/v2.2.0/msr.zip`,
  ...over,
});

test('release: aceita so o msr.zip do proprio repositorio, com hash valido', () => {
  const release = (assets, tag = 'v2.2.0') => ({ tag_name: tag, assets });
  assert.deepEqual(parseRelease(release([{ name: 'msr.exe.gz' }, asset()])), {
    version: '2.2.0', url: asset().browser_download_url, sha256: sha, size: 42000000,
  });
  assert.equal(parseRelease(release([{ name: 'msr.exe.gz' }])), null); // sem o zip
  assert.equal(parseRelease(release([asset({ digest: null })])), null); // sem hash
  assert.equal(parseRelease(release([asset({ digest: 'sha256:abc' })])), null); // hash malformado
  assert.equal(parseRelease(release([asset({ browser_download_url: 'https://exemplo.com/msr.zip' })])), null);
  assert.equal(parseRelease(release([asset({ browser_download_url: 'https://github.com/outro/repo/releases/download/v9/msr.zip' })])), null);
  assert.equal(parseRelease(release([asset()], 'nightly')), null); // tag que nao e versao
  assert.equal(parseRelease(null), null);
});

test('zip: tira o exe de dentro conferindo tamanho e CRC, e recusa o que nao confere', { skip: process.platform !== 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msr-zip-'));
  const at = (name) => path.join(dir, name);
  // Conteudo que comprime bem no comeco e mal no fim, como um executavel de verdade.
  const content = Buffer.concat([Buffer.alloc(300000, 'msr'), crypto.randomBytes(200000)]);
  fs.writeFileSync(at('msr.exe'), content);
  fs.writeFileSync(at('leia.txt'), 'outro arquivo no mesmo zip');
  // O mesmo tar do Windows que monta o zip da release (scripts/package-release.js).
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-cf', 'msr.zip', 'leia.txt', 'msr.exe'], { cwd: dir });

  await extractZipEntry(at('msr.zip'), 'msr.exe', at('saida.exe'), 1e6);
  assert.deepEqual(fs.readFileSync(at('saida.exe')), content);

  await assert.rejects(extractZipEntry(at('msr.zip'), 'nao-existe.exe', at('x.exe'), 1e6), /nao tem nao-existe\.exe/);
  await assert.rejects(extractZipEntry(at('msr.zip'), 'msr.exe', at('x.exe'), 1000), /maior que o esperado/);
  await assert.rejects(extractZipEntry(at('msr.exe'), 'msr.exe', at('x.exe'), 1e6), /zip invalido/); // nao e um zip

  // Um byte trocado no meio dos dados: o CRC nao bate e nada fica no disco.
  const broken = fs.readFileSync(at('msr.zip'));
  broken[broken.length - 100000] ^= 0xff;
  fs.writeFileSync(at('quebrado.zip'), broken);
  await assert.rejects(extractZipEntry(at('quebrado.zip'), 'msr.exe', at('x.exe'), 1e6));
  assert.equal(fs.existsSync(at('x.exe')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cache: so serve de reserva se foi gravado pela versao em uso', () => {
  const cache = { checkedAt: Date.now(), current: '2.1.0', latest: null };
  assert.equal(cacheUsable(cache, '2.1.0'), true);
  assert.equal(cacheUsable(cache, '2.2.0'), false); // o msr foi atualizado desde entao
  assert.equal(cacheUsable(null, '2.1.0'), false);
});

test('dpapi: o que foi protegido volta igual e nao fica legivel', { skip: process.platform !== 'win32' }, async () => {
  const secret = Buffer.from(JSON.stringify({ cookies: [{ name: '_U', value: 'segredo-çã-123' }] }));
  const sealed = await protect(secret);
  assert.equal(sealed.includes(Buffer.from('segredo')), false);
  assert.deepEqual(await unprotect(sealed), secret);
  await assert.rejects(unprotect(Buffer.from('isto nao e um blob do DPAPI')));
});
