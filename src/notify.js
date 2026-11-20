// Notificacao nativa do Windows (toast), sem dependencias: o PowerShell 5.1 que ja vem no
// sistema chama a API WinRT. Titulo e texto vao por variavel de ambiente para nao depender de
// escape de aspas na linha de comando.

import { execFile } from 'node:child_process';

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$esc = { param($s) [System.Security.SecurityElement]::Escape($s) }
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$(& $esc $env:MSR_TITLE)</text><text>$(& $esc $env:MSR_BODY)</text></binding></visual></toast>")
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
`;

/** Mostra um toast. Resolve true/false; nunca lanca (notificar e sempre "melhor esforco"). */
export function notify(title, body) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { env: { ...process.env, MSR_TITLE: title, MSR_BODY: body }, windowsHide: true, timeout: 20000 },
      (err) => resolve(!err),
    );
  });
}
