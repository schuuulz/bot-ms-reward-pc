// Launcher do msr.exe (Node SEA; gerado por scripts/build-exe.js).
// O exe carrega o app como assets ("app/<caminho>"). Na primeira execucao de cada build eles sao
// extraidos para %LOCALAPPDATA%\msr\app\<build>\ e o app roda de la, como arquivos de verdade:
// o playwright-core nao funciona bundlado num arquivo so. Login e dados ficam em
// %LOCALAPPDATA%\msr\ (MSR_HOME), fora da pasta do build, e sobrevivem a troca do exe.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const sea = require('node:sea');

const home = process.env.MSR_HOME
  ? path.resolve(process.env.MSR_HOME)
  : path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'msr');
process.env.MSR_HOME = home;

const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Extrai o app se este build ainda nao foi extraido. Retorna a pasta do app. */
function extract() {
  const build = sea.getAsset('build-id', 'utf8').trim();
  const appRoot = path.join(home, 'app');
  const dir = path.join(appRoot, build);
  const marker = path.join(dir, '.complete');
  const done = () => fs.existsSync(marker);

  // Apaga builds de versoes anteriores, mas so os que ninguem abriu no ultimo dia: logo depois de
  // uma atualizacao, uma execucao agendada do exe antigo ainda pode estar rodando da pasta dele.
  const prune = () => {
    const stale = Date.now() - 864e5;
    for (const name of fs.readdirSync(appRoot)) {
      if (name.startsWith(build)) continue; // este build e as pastas temporarias dele
      const used = fs.statSync(path.join(appRoot, name, '.complete'), { throwIfNoEntry: false })?.mtimeMs ?? 0;
      if (used < stale) fs.rmSync(path.join(appRoot, name), { recursive: true, force: true });
    }
  };

  if (done()) {
    fs.utimesSync(marker, new Date(), new Date()); // marca este build como em uso
    prune();
    return dir;
  }

  // Extrai numa pasta temporaria e renomeia: duas execucoes ao mesmo tempo (agendador + duplo
  // clique) nao veem uma pasta pela metade.
  const tmp = `${dir}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of sea.getAssetKeys()) {
    if (!key.startsWith('app/')) continue;
    const file = path.join(tmp, key.slice(4));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, new Uint8Array(sea.getRawAsset(key)));
  }
  fs.writeFileSync(path.join(tmp, '.complete'), '');
  for (let attempt = 1; !done(); attempt++) {
    try {
      fs.renameSync(tmp, dir);
    } catch (err) {
      // Outra execucao terminou antes, ou o antivirus ainda segura os arquivos recem-gravados.
      if (done()) break;
      if (attempt === 10) throw err;
      wait(300);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  prune();
  return dir;
}

/** Sem isto a janela do duplo clique fecha antes de a pessoa ler o erro. */
function fail(err) {
  console.error(`\n  msr nao conseguiu iniciar: ${err?.stack ?? err}\n`);
  process.exitCode = 1;
  if (!process.stdin.isTTY) return;
  process.stdout.write('  Enter para fechar ');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(1));
}

try {
  const app = createRequire(path.join(extract(), 'package.json'));
  app('./src/cli.js')
    .main()
    .then((code) => {
      process.exitCode = code ?? 0;
    }, fail);
} catch (err) {
  fail(err);
}
