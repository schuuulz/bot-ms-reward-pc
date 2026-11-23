// Empacota dist/msr.exe para a release (rodado pelo GitHub Actions depois do build:exe).
// Tudo o que vai para o GitHub fica em dist/release/, e e um arquivo so:
//   dist/release/msr.zip   o msr.exe zipado: para baixar a mao e para o atualizador (src/update.js)
// O hash de conferencia nao precisa de arquivo: o GitHub informa o SHA-256 de cada arquivo da release.
// Uso: npm run package

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const release = path.join(dist, 'release');
const exe = path.join(dist, 'msr.exe');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!fs.existsSync(exe)) {
  console.error('dist/msr.exe nao existe; rode antes: npm run build:exe');
  process.exit(1);
}

fs.rmSync(release, { recursive: true, force: true });
fs.mkdirSync(release);

// O tar que ja vem no Windows 10+ (bsdtar) grava .zip; pelo caminho completo, nao pelo PATH.
const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(tar, ['-a', '-cf', path.join('release', 'msr.zip'), 'msr.exe'], { cwd: dist, stdio: 'inherit' });

// Ponte para quem esta no msr 2.1.2 ou anterior: o atualizador dessas versoes so enxerga uma
// release que tenha um arquivo chamado msr.exe.gz. Ele sai so na versao abaixo, para essas pessoas
// chegarem a ela pelo menu; dela em diante o atualizador usa o msr.zip. Quando a versao do
// package.json passar desta, o arquivo deixa de ser gerado e este bloco pode ser apagado.
const GZ_BRIDGE_VERSION = '2.1.3';
if (version === GZ_BRIDGE_VERSION) {
  await pipeline(fs.createReadStream(exe), zlib.createGzip({ level: 9 }), fs.createWriteStream(path.join(release, 'msr.exe.gz')));
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
console.log(`release v${version} (dist/release):`);
for (const name of fs.readdirSync(release)) {
  const file = path.join(release, name);
  console.log(`${(fs.statSync(file).size / 1048576).toFixed(1).padStart(7)} MB  ${name}  sha256 ${sha256(file)}`);
}
