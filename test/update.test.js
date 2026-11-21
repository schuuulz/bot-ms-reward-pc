// Atualizacao (versoes, leitura da release, validade do cache) e protecao DPAPI do Windows.

import assert from 'node:assert/strict';
import test from 'node:test';
import { REPO, cacheFresh, isNewer, parseRelease } from '../src/update.js';
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
  name: 'msr.exe.gz',
  size: 42000000,
  digest: `sha256:${sha}`,
  browser_download_url: `https://github.com/${REPO}/releases/download/v2.2.0/msr.exe.gz`,
  ...over,
});

test('release: aceita so o binario do proprio repositorio, com hash valido', () => {
  const release = (assets, tag = 'v2.2.0') => ({ tag_name: tag, assets });
  assert.deepEqual(parseRelease(release([{ name: 'msr.zip' }, asset()])), {
    version: '2.2.0', url: asset().browser_download_url, sha256: sha, size: 42000000,
  });
  assert.equal(parseRelease(release([{ name: 'msr.zip' }])), null); // sem o binario
  assert.equal(parseRelease(release([asset({ digest: null })])), null); // sem hash
  assert.equal(parseRelease(release([asset({ digest: 'sha256:abc' })])), null); // hash malformado
  assert.equal(parseRelease(release([asset({ browser_download_url: 'https://exemplo.com/msr.exe.gz' })])), null);
  assert.equal(parseRelease(release([asset({ browser_download_url: 'https://github.com/outro/repo/releases/download/v9/msr.exe.gz' })])), null);
  assert.equal(parseRelease(release([asset()], 'nightly')), null); // tag que nao e versao
  assert.equal(parseRelease(null), null);
});

test('cache: vale por 12 h e so para a versao em uso', () => {
  const now = Date.now();
  const cache = { checkedAt: now - 3600e3, current: '2.1.0', latest: null };
  assert.equal(cacheFresh(cache, '2.1.0', now), true);
  assert.equal(cacheFresh(cache, '2.2.0', now), false); // o msr foi atualizado: consulta de novo
  assert.equal(cacheFresh({ ...cache, checkedAt: now - 13 * 3600e3 }, '2.1.0', now), false);
  assert.equal(cacheFresh(null, '2.1.0', now), false);
});

test('dpapi: o que foi protegido volta igual e nao fica legivel', { skip: process.platform !== 'win32' }, async () => {
  const secret = Buffer.from(JSON.stringify({ cookies: [{ name: '_U', value: 'segredo-çã-123' }] }));
  const sealed = await protect(secret);
  assert.equal(sealed.includes(Buffer.from('segredo')), false);
  assert.deepEqual(await unprotect(sealed), secret);
  await assert.rejects(unprotect(Buffer.from('isto nao e um blob do DPAPI')));
});
