// Leitor do site (src/rsc.js) contra paginas sinteticas com as mesmas estruturas que o Rewards
// embute no HTML. Se a Microsoft mudar o formato, e aqui que se reproduz e conserta.

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRewards } from '../src/rsc.js';

/** Monta um HTML com o payload dividido em chamadas self.__next_f.push, como o Next.js faz. */
const html = (...chunks) => chunks.map((c) => `<script>self.__next_f.push([1,${JSON.stringify(c)}])</script>`).join('\n');
const row = (id, value) => `${id}:${JSON.stringify(value)}\n`;

const dailyItem = (n, done) => ({
  date: '11/19/2026',
  description: 'descricao com "aspas" e \\ barra',
  destination: `https://www.bing.com/search?q=item+${n}&rnoreward=1`,
  hash: 'abc',
  isCompleted: done,
  isLocked: '$undefined',
  offerId: `Global_DailySet_20261119_Child${n}`,
  points: 10,
  title: `Diario ${n}`,
});

const BALANCE = row('49', ['$', '$L73', null, { balance: 12345, level: 3 }]);
const BREAKDOWN = row('80', ['$', '$L93', null, {
  type: 'pointbreakdown',
  model: { pointsCounters: { dailyOffer: 20, pc: { max: 60, progress: 39, originalMax: 60 }, totalPoints: 59 }, pointsHistory: {} },
}]);
const DAILY = row('81', ['$', '$L90', null, {
  type: 'dailyset',
  model: {
    streak: { partner: 'dailyset', activitiesCompleted: 1, activitiesTotal: 3, completedDays: 2, totalDays: 7 },
    dailySetItems: [dailyItem(1, true), dailyItem(2, false), dailyItem(3, false)],
  },
}]);
const MORE = row('82', ['$', '$L9a', null, {
  items: [
    { destination: 'https://www.bing.com/search?q=quiz', isCompleted: false, isPromotional: '$undefined', points: 5, title: 'Quiz', offerId: 'Offer_Quiz', hash: 'h1' },
    { destination: 'https://www.bing.com/search?q=feito', isCompleted: true, points: 10, title: 'Feito', offerId: 'Offer_Done', hash: 'h2' },
    { destination: '/redeem/sku/000', isCompleted: false, isPromotional: true, points: 0, title: 'Resgate', offerId: 'Offer_Promo', hash: 'h3' },
  ],
}]);
const CLAIM_NONE = row('83', ['$', '$L91', null, { type: 'pointsclaim', model: { pointClaim: null } }]);

test('pagina completa: saldo, contador, dia, cards e streaks', () => {
  const state = parseRewards(html(BALANCE, BREAKDOWN, DAILY, MORE, CLAIM_NONE));
  assert.equal(state.balance, 12345);
  assert.deepEqual(state.search, { earned: 39, max: 60 });
  assert.equal(state.mobileSearch, null);
  assert.equal(state.todayPoints, 59);
  assert.equal(state.day, '2026-11-19');
  assert.equal(state.claimable, 0);

  const daily = state.cards.filter((c) => c.section === 'dailyset');
  assert.deepEqual(daily.map((c) => c.done), [true, false, false]);
  const more = state.cards.filter((c) => c.section === 'more');
  assert.deepEqual(more.map((c) => c.title), ['Quiz', 'Feito', 'Resgate']);
  assert.equal(more[2].href, 'https://rewards.bing.com/redeem/sku/000'); // destino relativo vira absoluto
  assert.deepEqual(state.streaks, [{ name: 'dailyset', done: 1, total: 3, day: 2, days: 7 }]);
});

test('payload cortado no meio de um objeto entre dois push continua legivel', () => {
  const cut = Math.floor(BREAKDOWN.length / 2);
  const state = parseRewards(html(BALANCE, BREAKDOWN.slice(0, cut), BREAKDOWN.slice(cut)));
  assert.deepEqual(state.search, { earned: 39, max: 60 });
});

test('pagina deslogada (sem saldo) retorna null', () => {
  assert.equal(parseRewards('<html><body>Entrar</body></html>'), null);
  assert.equal(parseRewards(html(row('1', ['$', 'div', null, { children: 'Bem-vindo' }]))), null);
});

test('sem o painel de pontos o contador fica indefinido, sem derrubar o resto', () => {
  const state = parseRewards(html(BALANCE, DAILY));
  assert.equal(state.search, undefined);
  assert.equal(state.claimable, undefined);
  assert.equal(state.cards.length, 3);
});

test('contador separado de celular e lido quando a conta tem', () => {
  const both = row('80', ['$', '$L93', null, {
    type: 'pointbreakdown',
    model: { pointsCounters: { pc: { max: 90, progress: 30 }, mobile: { max: 60, progress: 0 }, totalPoints: 30 } },
  }]);
  const state = parseRewards(html(BALANCE, both));
  assert.deepEqual(state.search, { earned: 30, max: 90 });
  assert.deepEqual(state.mobileSearch, { earned: 0, max: 60 });
});

test('pontos a reivindicar: numero quando da para achar, true quando o formato e desconhecido', () => {
  const claim = (pointClaim) => row('83', ['$', '$L91', null, { type: 'pointsclaim', model: { pointClaim } }]);
  assert.equal(parseRewards(html(BALANCE, claim({ totalPoints: 1981, items: [] }))).claimable, 1981);
  assert.equal(parseRewards(html(BALANCE, claim({ algoNovo: 'x' }))).claimable, true);
});
