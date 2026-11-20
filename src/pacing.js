// Ritmo do dia: em vez de fazer todas as buscas num bloco so, cada execucao faz a fatia que
// corresponde ao horario. Sem estado: a conta usa so o relogio e o contador real do Rewards,
// entao uma execucao perdida (PC desligado) e compensada pela seguinte.

/** Fracao da meta diaria que ja deveria estar feita neste horario (0 a 1). */
export function targetFraction(now, { startHour, finishHour }) {
  const hour = now.getHours() + now.getMinutes() / 60;
  if (hour >= finishHour) return 1;
  if (hour <= startHour) return 0;
  return (hour - startHour) / (finishHour - startHour);
}

/**
 * Quantas buscas fazer agora. `search` e o contador { earned, max } em pontos.
 * Retorna 0 quando a meta do horario ja foi atingida.
 */
export function sessionQuota({ search, pointsPerSearch, pacing, now = new Date(), random = Math.random }) {
  const total = Math.ceil(search.max / pointsPerSearch);
  const remaining = Math.ceil((search.max - search.earned) / pointsPerSearch);
  if (remaining <= 0) return 0;

  const fraction = targetFraction(now, pacing);
  if (fraction >= 1) return remaining;

  const behind = fraction * total - (total - remaining);
  const wanted = Math.round(behind * (1 + (random() * 2 - 1) * pacing.jitter));
  if (wanted <= 0) return 0;

  const quota = Math.min(remaining, Math.max(pacing.minPerSession, wanted));
  // Nao deixa um restinho de 1-2 buscas para a proxima sessao.
  return remaining - quota < pacing.minPerSession ? remaining : quota;
}
