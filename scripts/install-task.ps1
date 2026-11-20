# Registra uma tarefa diaria no Agendador de Tarefas do Windows para rodar o bot.
# O horario real varia a cada dia (RandomDelay), para nao rodar sempre no mesmo minuto.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1                 # 19:00 + ate 3h de atraso
#   powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1 -Time 12:30 -RandomDelayMinutes 90
#   powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1 -Remove
param(
    [string]$Time = '19:00',
    [int]$RandomDelayMinutes = 180,
    [string]$TaskName = 'MsRewardsBot',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarefa '$TaskName' removida."
    exit
}

$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source

$action = New-ScheduledTaskAction -Execute $node -Argument 'src\index.js' -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $Time -RandomDelay (New-TimeSpan -Minutes $RandomDelayMinutes)
# StartWhenAvailable: se o PC estava desligado no horario, roda quando ligar.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

# Sem -User: roda como o usuario atual e so com a sessao aberta (o Edge precisa da area de trabalho).
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Bot do Microsoft Rewards (buscas no Bing + cards do dashboard)' -Force | Out-Null

Write-Host "Tarefa '$TaskName' registrada: todo dia as $Time (+ ate $RandomDelayMinutes min aleatorios)."
Write-Host "Logs em: $root\data\logs"
