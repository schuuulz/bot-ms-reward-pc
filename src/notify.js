// Notificacao nativa do Windows (toast), sem dependencias: o PowerShell 5.1 que ja vem no
// sistema chama a API WinRT. Titulo e texto vao por variavel de ambiente para nao depender de
// escape de aspas na linha de comando.

import { powershell } from './win.js';

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
export const notify = (title, body) =>
  powershell(SCRIPT, { env: { MSR_TITLE: title, MSR_BODY: body }, timeout: 20000 }).then(
    () => true,
    () => false,
  );
