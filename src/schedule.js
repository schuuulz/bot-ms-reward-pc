// Agendador de Tarefas do Windows: uma tarefa com varios gatilhos diarios, cada um com atraso
// aleatorio, chamando `msr run --paced`. Nenhum processo fica residente entre as execucoes.
// Os parametros vao por variavel de ambiente para o PowerShell (sem escape de aspas).

import { execFile } from 'node:child_process';
import path from 'node:path';
import { config } from './config.js';

const ENTRY = path.join(config.root, 'bin', 'msr.js');

function powershell(script, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 30000 },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout.trim());
        const detail = stderr.trim().split('\n')[0] || `PowerShell saiu com codigo ${err.code}`;
        reject(new Error(`Agendador de Tarefas: ${detail}`));
      },
    );
  });
}

// `conhost --headless` roda o node sem abrir janela de console a cada disparo.
const INSTALL = String.raw`
$ErrorActionPreference = 'Stop'
$delay = New-TimeSpan -Minutes ([int]$env:MSR_JITTER)
$triggers = $env:MSR_TIMES.Split(',') | ForEach-Object {
  if ([int]$env:MSR_JITTER -gt 0) { New-ScheduledTaskTrigger -Daily -At $_ -RandomDelay $delay } else { New-ScheduledTaskTrigger -Daily -At $_ }
}
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" -Argument ('--headless "{0}" "{1}" run --paced --quiet --notify' -f $env:MSR_NODE, $env:MSR_ENTRY) -WorkingDirectory $env:MSR_ROOT
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
    MSR_NODE: process.execPath,
    MSR_ENTRY: ENTRY,
    MSR_ROOT: config.root,
  });
  return scheduleStatus();
}

export async function removeSchedule() {
  await powershell(
    'Unregister-ScheduledTask -TaskName $env:MSR_TASK -Confirm:$false -ErrorAction SilentlyContinue; exit 0',
    { MSR_TASK: config.schedule.taskName },
  );
}

/** Retorna null se a tarefa nao existe. */
export async function scheduleStatus() {
  const out = await powershell(STATUS, { MSR_TASK: config.schedule.taskName });
  return out ? JSON.parse(out) : null;
}

/** Dispara a tarefa agora (para testar o agendamento). */
export async function runScheduleNow() {
  await powershell('Start-ScheduledTask -TaskName $env:MSR_TASK', { MSR_TASK: config.schedule.taskName });
}
