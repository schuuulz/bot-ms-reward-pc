// Chamadas ao Windows pelo PowerShell 5.1 que ja vem no sistema (sem dependencias).
// O executavel e chamado pelo caminho completo em System32, nunca procurado no PATH. Parametros
// vao por variavel de ambiente e dados por stdin: nada sensivel aparece na linha de comando.

import { execFile } from 'node:child_process';
import path from 'node:path';

const SYSTEM32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
export const POWERSHELL = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Roda um script e resolve com o stdout (sem espacos nas pontas). Rejeita com a 1a linha do erro. */
export function powershell(script, { env = {}, input, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ...env }, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout.trim());
        reject(new Error(stderr.trim().split('\n')[0] || `PowerShell saiu com codigo ${err.code}`));
      },
    );
    child.stdin.end(input ?? '');
  });
}

const DPAPI = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$data = [Convert]::FromBase64String([Console]::In.ReadToEnd())
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
if ($env:MSR_DPAPI -eq 'protect') { $out = [Security.Cryptography.ProtectedData]::Protect($data, $null, $scope) }
else { $out = [Security.Cryptography.ProtectedData]::Unprotect($data, $null, $scope) }
[Console]::Out.Write([Convert]::ToBase64String($out))
`;

const dpapi = async (mode, buffer) =>
  Buffer.from(await powershell(DPAPI, { env: { MSR_DPAPI: mode }, input: buffer.toString('base64') }), 'base64');

/**
 * Protecao de dados do Windows (DPAPI): so o mesmo usuario do Windows, neste PC, consegue abrir.
 * Um arquivo protegido copiado para outra maquina ou outra conta nao serve para nada.
 */
export const protect = (buffer) => dpapi('protect', buffer);
export const unprotect = (buffer) => dpapi('unprotect', buffer);
