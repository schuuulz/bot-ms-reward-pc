// Empacota dist/msr.exe para a release (rodado pelo GitHub Actions depois do build:exe):
//   dist/msr.zip          para baixar a mao
//   dist/msr.exe.gz       para o atualizador do proprio msr (src/update.js)
//   dist/SHA256SUMS.txt   hashes dos arquivos, para quem quiser conferir
// Uso: npm run package

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

const dist = path.resolve(import.meta.dirname, '..', 'dist');
const file = (name) => path.join(dist, name);
if (!fs.existsSync(file('msr.exe'))) {
  console.error('dist/msr.exe nao existe; rode antes: npm run build:exe');
  process.exit(1);
}

await pipeline(fs.createReadStream(file('msr.exe')), zlib.createGzip({ level: 9 }), fs.createWriteStream(file('msr.exe.gz')));

// O tar que ja vem no Windows 10+ (bsdtar) grava .zip; pelo caminho completo, nao pelo PATH.
fs.rmSync(file('msr.zip'), { force: true });
const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(tar, ['-a', '-cf', 'msr.zip', 'msr.exe'], { cwd: dist, stdio: 'inherit' });

const sha256 = (name) => crypto.createHash('sha256').update(fs.readFileSync(file(name))).digest('hex');
const names = ['msr.zip', 'msr.exe.gz', 'msr.exe'];
fs.writeFileSync(file('SHA256SUMS.txt'), names.map((name) => `${sha256(name)}  ${name}\n`).join(''));

for (const name of [...names, 'SHA256SUMS.txt']) {
  console.log(`${(fs.statSync(file(name)).size / 1048576).toFixed(1).padStart(7)} MB  ${name}`);
}
