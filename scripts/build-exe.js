// Gera dist/msr.exe: um executavel unico (Node SEA) para quem nao tem Node instalado.
// Uso: npm run build:exe
// O exe leva o runtime do Node e, como assets, so o que esta na lista abaixo. Login e dados
// (data/, .edge-profile/) nunca entram. Ver scripts/sea-main.cjs para o que acontece ao abrir.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 25 || (major === 25 && minor < 5)) {
  console.error(`build:exe precisa de Node 25.5+ (node --build-sea); este e o ${process.version}`);
  process.exit(1);
}

// Tudo que vai dentro do exe.
const INCLUDE = ['package.json', 'bin', 'src', ...Object.keys(pkg.dependencies).map((dep) => `node_modules/${dep}`)];

/** Arquivos de um caminho (arquivo ou pasta), relativos a raiz e com barra normal. */
function walk(rel) {
  const full = path.join(root, rel);
  if (!fs.statSync(full).isDirectory()) return [rel];
  return fs.readdirSync(full).flatMap((name) => walk(`${rel}/${name}`));
}

const files = INCLUDE.flatMap(walk).sort();
const hash = crypto.createHash('sha256');
for (const file of files) hash.update(file).update(fs.readFileSync(path.join(root, file)));
// Identifica o build: muda quando qualquer arquivo muda, e ai o exe extrai de novo.
const buildId = `${pkg.version}-${hash.digest('hex').slice(0, 12)}`;

fs.mkdirSync(dist, { recursive: true });
const buildIdFile = path.join(dist, 'build-id.txt');
const configFile = path.join(dist, 'sea-config.json');
const output = path.join(dist, 'msr.exe');
fs.writeFileSync(buildIdFile, buildId);
fs.writeFileSync(
  configFile,
  JSON.stringify({
    main: path.join(root, 'scripts', 'sea-main.cjs'),
    output,
    disableExperimentalSEAWarning: true,
    execArgvExtension: 'none', // NODE_OPTIONS da maquina nao afeta o exe
    assets: { 'build-id': buildIdFile, ...Object.fromEntries(files.map((file) => [`app/${file}`, path.join(root, file)])) },
  }),
);

execFileSync(process.execPath, ['--build-sea', configFile], { cwd: root, stdio: 'inherit' });

const mb = (fs.statSync(output).size / 1048576).toFixed(1);
console.log(`\n${output}\n  build ${buildId} · ${files.length} arquivos · ${mb} MB · Node ${process.version}`);
