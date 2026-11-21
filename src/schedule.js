// Agendador de Tarefas do Windows: uma tarefa com varios gatilhos diarios, cada um com atraso
// aleatorio, chamando `msr run --paced`. Nenhum processo fica residente entre as execucoes.
// Os parametros vao por variavel de ambiente para o PowerShell (sem escape de aspas).

import path from 'node:path';
import { config } from './config.js';
import { powershell as run } from './win.js';

/**
 * Como o agendador chama o msr: o proprio msr.exe, ou node + script no checkout. No exe a pasta
 * do codigo extraido muda a cada versao, entao o script nunca entra no comando.
 */
export function launchCommand({ packaged, execPath, entry }) {
  return (packaged ? [execPath] : [execPath, entry]).map((p) => `"${p}"`).join(' ');
}

const currentLaunch = () =>
  launchCommand({ packaged: config.packaged, execPath: process.execPath, entry: path.join(config.root, 'bin', 'msr.js') });

const powershell = (script, env = {}) =>
  run(script, { env }).catch((err) => {
    throw new Error(`Agendador de Tarefas: ${err.message}`);
  });

// `conhost --headless` roda o node sem abrir janela de console a cada disparo.
const INSTALL = String.raw`
$ErrorActionPreference = 'Stop'
$delay = New-TimeSpan -Minutes ([int]$env:MSR_JITTER)
$triggers = $env:MSR_TIMES.Split(',') | ForEach-Object {
  if ([int]$env:MSR_JITTER -gt 0) { New-ScheduledTaskTrigger -Daily -At $_ -RandomDelay $delay } else { New-ScheduledTaskTrigger -Daily -At $_ }
}
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" -Argument ('--headless {0} run --paced --quiet --notify' -f $env:MSR_CMD) -WorkingDirectory $env:MSR_CWD
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $env:MSR_TASK -Action $action -Trigger $triggers -Settings $settings -Description 'Microsoft Rewards: buscas e cards (msr run --paced)' -Force | Out-Null
`;

const STATUS = String.raw`
$task = Get-ScheduledTask -TaskName $env:MSR_TASK -ErrorAction SilentlyContinue
if (-not $task) { exit 0 }
$info = $task | Get-ScheduledTaskInfo
$fmt = { param($d) if ($d -and $d.Year -gt 2000) { $d.ToString('yyyy-MM-dd HH:mm') } else { $null } }
@{
  state = [string]$task.State
  command = [string]$task.Actions[0].Arguments
  times = @($task.Triggers | ForEach-Object { ([datetime]$_.StartBoundary).ToString('HH:mm') })
  jitterMinutes = @($task.Triggers | ForEach-Object { if ($_.RandomDelay) { [System.Xml.XmlConvert]::ToTimeSpan($_.RandomDelay).TotalMinutes } else { 0 } })[0]
  lastRun = & $fmt $info.LastRunTime
  lastResult = $info.LastTaskResult
  nextRun = & $fmt $info.NextRunTime
} | ConvertTo-Json -Compress
`;

export async function installSchedule({ times = config.schedule.times, jitterMinutes = config.schedule.jitterMinutes } = {}) {
  for (const t of times) {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(`horario invalido: "${t}" (use HH:MM)`);
  }
  await powershell(INSTALL, {
    MSR_TASK: config.schedule.taskName,
    MSR_TIMES: times.join(','),
    MSR_JITTER: String(jitterMinutes),
    MSR_CMD: currentLaunch(),
    MSR_CWD: config.home,
  });
  return scheduleStatus();
}

export async function removeSchedule() {
  await powershell(
    'Unregister-ScheduledTask -TaskName $env:MSR_TASK -Confirm:$false -ErrorAction SilentlyContinue; exit 0',
    { MSR_TASK: config.schedule.taskName },
  );
}

/**
 * Retorna null se a tarefa nao existe. `stale`: a tarefa chama um caminho que nao e o deste msr
 * (o exe ou a pasta mudou de lugar depois de agendar) e precisa ser instalada de novo.
 */
export async function scheduleStatus() {
  const out = await powershell(STATUS, { MSR_TASK: config.schedule.taskName });
  if (!out) return null;
  const info = JSON.parse(out);
  return { ...info, stale: !info.command.toLowerCase().includes(currentLaunch().toLowerCase()) };
}

/** Dispara a tarefa agora (para testar o agendamento). */
export async function runScheduleNow() {
  await powershell('Start-ScheduledTask -TaskName $env:MSR_TASK', { MSR_TASK: config.schedule.taskName });
}
