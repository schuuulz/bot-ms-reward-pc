// Logica pura: ritmo do dia, plano de execucao, historico, cookies, filtros de busca e menu.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { pendingCards } from '../src/activities.js';
import { userAgentFor } from '../src/browser.js';
import { outsideHome } from '../src/commands.js';
import { History, normalize } from '../src/history.js';
import { cookieHeader, storeCookies } from '../src/http.js';
import { move, select } from '../src/menu.js';
import { sessionQuota, targetFraction } from '../src/pacing.js';
import { headlineToPhrase, usable } from '../src/queries.js';
import { isEligible } from '../src/rewards.js';
import { plan } from '../src/run.js';
import { launchCommand } from '../src/schedule.js';
import { summarize } from '../src/stats.js';

const pacing = { startHour: 8, finishHour: 20, jitter: 0.2, minPerSession: 3 };
const at = (h, m = 0) => new Date(2026, 10, 20, h, m);
const quota = (earned, hour, random = () => 0.5) =>
  sessionQuota({ search: { earned, max: 60 }, pointsPerSearch: 3, pacing, now: at(hour), random });

test('ritmo: a meta cresce de startHour a finishHour', () => {
  assert.equal(targetFraction(at(7), pacing), 0);
  assert.equal(targetFraction(at(14), pacing), 0.5);
  assert.equal(targetFraction(at(21), pacing), 1);
});

test('ritmo: fatia do horario, sem passar do que falta', () => {
  assert.equal(quota(0, 7), 0); // antes do inicio do dia
  assert.equal(quota(0, 11), 5); // 25% de 20 buscas
  assert.equal(quota(15, 14), 5); // 5 feitas, meta 10
  assert.equal(quota(30, 14), 0); // ja esta na meta
  assert.equal(quota(60, 22), 0); // contador completo
  assert.equal(quota(0, 20), 20); // depois de finishHour: tudo
  assert.equal(quota(45, 21), 5);
});

test('ritmo: minimo por sessao, variacao aleatoria e sem restinho', () => {
  assert.equal(quota(0, 9), 3); // meta seria 2, sobe para o minimo
  assert.equal(quota(0, 14, () => 1), 12); // +20%
  assert.equal(quota(0, 14, () => 0), 8); // -20%
  assert.equal(quota(0, 19), 20); // meta 18: faz as 20 em vez de deixar um restinho de 2
});

const state = (search, cards = [], claimable = 0) => ({ balance: 1, search, cards, claimable });
const card = (over = {}) => ({ title: 'Card', points: 10, done: false, href: 'https://www.bing.com/search?q=x', ...over });

test('plano: nada pendente nao pede navegador', () => {
  const todo = plan(state({ earned: 60, max: 60 }, [card({ done: true })]), { parts: ['cards', 'searches'] });
  assert.deepEqual([todo.cards, todo.searches, todo.claim], [false, false, false]);
});

test('plano: buscas incompletas, quantidade exata e contador ilegivel', () => {
  assert.equal(plan(state({ earned: 30, max: 60 }), { parts: ['searches'] }).searches, true);
  const exact = plan(state({ earned: 60, max: 60 }), { parts: ['searches'], count: 5 });
  assert.deepEqual([exact.searches, exact.limit, exact.force], [true, 5, true]);
  assert.equal(plan(state(undefined), { parts: ['searches'] }).searches, true);
  assert.equal(plan(state({ earned: 0, max: 60 }), { parts: ['cards'] }).searches, false);
});

test('plano: reivindica so quando pedido e ha algo (ou nao da para saber)', () => {
  assert.equal(plan(state(null, [], 0), { parts: [], claim: true }).claim, false);
  assert.equal(plan(state(null, [], 1981), { parts: [], claim: true }).claim, true);
  assert.equal(plan({ balance: 1, cards: [] }, { parts: [], claim: true }).claim, true); // sem a info: tenta
  assert.equal(plan(state(null, [], 1981), { parts: [] }).claim, false);
});

test('cards: so os pendentes que dao ponto com clique, e nao os que ja falharam 2 vezes', () => {
  assert.equal(isEligible(card()), true);
  assert.equal(isEligible(card({ done: true })), false);
  assert.equal(isEligible(card({ points: 0 })), false);
  assert.equal(isEligible(card({ href: 'https://rewards.bing.com/redeem/sku/1' })), false);
  assert.equal(isEligible(card({ href: 'https://www.bing.com/apps/wallpaper?autodownload=1' })), false);
  assert.equal(isEligible(card({ href: 'https://example.com/' })), false);

  const failed = { 'Card|10': { count: 2, last: Date.now() } };
  assert.deepEqual(pendingCards([card(), card({ title: 'Outro' })], failed).map((c) => c.title), ['Outro']);
});

test('historico: normaliza e nao repete busca', () => {
  assert.equal(normalize('  Previsão do Tempo — São-Paulo! '), 'previsao do tempo sao paulo');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'msr-')), 'history.json');
  const history = new History(file);
  history.add('Receita de Pão');
  assert.equal(history.has('receita de pao'), true);
  assert.equal(new History(file).has('RECEITA DE PÃO'), true); // persistiu
  assert.equal(history.has('receita de bolo'), false);
});

test('cookies: dominio, caminho e validade', () => {
  const now = Date.now() / 1000;
  const session = { cookies: [
    { name: 'a', value: '1', domain: '.bing.com', path: '/', expires: now + 60 },
    { name: 'b', value: '2', domain: 'rewards.bing.com', path: '/', expires: -1 },
    { name: 'c', value: '3', domain: 'www.bing.com', path: '/', expires: -1 },
    { name: 'd', value: '4', domain: '.bing.com', path: '/', expires: now - 60 }, // vencido
    { name: 'e', value: '5', domain: '.bing.com', path: '/account', expires: -1 },
  ] };
  assert.equal(cookieHeader(session, 'https://rewards.bing.com/earn'), 'a=1; b=2');
  assert.equal(cookieHeader(session, 'https://www.bing.com/account/x'), 'a=1; c=3; e=5');
});

test('buscas: texto com caractere de controle nunca e usado', () => {
  assert.equal(usable('receita de bolo'), true);
  assert.equal(usable('receita\x1b[2J de bolo'), false);
  assert.equal(usable('titulo\x07 qualquer'), false);
  assert.equal(usable('duas\nlinhas aqui'), false);
});

test('instalacao: reconhece quando o msr esta fora da pasta do usuario', () => {
  const home = path.join(os.homedir());
  assert.equal(outsideHome(path.join(home, 'msr'), home), false);
  assert.equal(outsideHome(path.join(home, 'Downloads', 'bot'), home), false);
  assert.equal(outsideHome(path.dirname(home), home), true); // a pasta de todos os usuarios
  assert.equal(outsideHome(path.join(path.parse(home).root, 'msr'), home), true); // C:\msr
  assert.equal(outsideHome(`${home}-outro`, home), true); // so o comeco do nome coincide
});

test('navegador: o user-agent leva a versao principal do Edge que sera aberto', () => {
  assert.equal(
    userAgentFor('157.0.4341.60'),
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0',
  );
  assert.equal(userAgentFor(''), null);
  assert.equal(userAgentFor('lixo'), null);
});

test('cookies: cookie Secure nunca sai numa URL sem https', () => {
  const session = { cookies: [
    { name: 'seguro', value: '1', domain: '.bing.com', path: '/', expires: -1, secure: true },
    { name: 'comum', value: '2', domain: '.bing.com', path: '/', expires: -1, secure: false },
  ] };
  assert.equal(cookieHeader(session, 'https://www.bing.com/'), 'seguro=1; comum=2');
  assert.equal(cookieHeader(session, 'http://www.bing.com/'), 'comum=2');
});

test('cookies: Set-Cookie substitui o cookie antigo e le os atributos', () => {
  const session = { cookies: [{ name: 'sid', value: 'velho', domain: 'rewards.bing.com', path: '/', expires: -1 }] };
  storeCookies(session, 'https://rewards.bing.com/earn', [
    'sid=novo; Path=/; HttpOnly; Secure',
    'u=1; Domain=bing.com; Max-Age=3600',
  ]);
  assert.deepEqual(session.cookies.map((c) => `${c.name}=${c.value}@${c.domain}`), ['sid=novo@rewards.bing.com', 'u=1@.bing.com']);
  assert.equal(session.cookies[0].httpOnly, true);
  assert.ok(session.cookies[1].expires > Date.now() / 1000 + 3500);
});

test('buscas: lista de bloqueio nao pega palavras inocentes', () => {
  for (const q of ['zoofilia', 'caso de assassinato', 'jogo do tigrinho', 'site de apostas', 'Sexo']) assert.equal(usable(q), false, q);
  for (const q of ['sexta-feira santa', 'final da libertadores', 'canal do youtube', 'drogaria são paulo', 'disputa de pênaltis', 'mata atlântica', 'alfabeto']) {
    assert.equal(usable(q), true, q);
  }
  assert.equal(usable('ab'), false);
  assert.equal(usable('x'.repeat(71)), false);
});

test('buscas: manchete vira o nome proprio principal', () => {
  assert.equal(headlineToPhrase('Pedro Sampaio fará show do intervalo na final da Libertadores'), 'Pedro Sampaio');
  assert.equal(headlineToPhrase('Volta Redonda confirma caso em homem de 28 anos'), 'Volta Redonda');
  assert.equal(headlineToPhrase('Chuva forte atinge cidades do interior'), null);
});

test('historico diario: resumo de um estado', () => {
  const cards = [card({ section: 'dailyset', done: true }), card({ section: 'dailyset' }), card({ section: 'more' })];
  assert.deepEqual(summarize({ balance: 100, todayPoints: 9, search: { earned: 9, max: 60 }, cards }), {
    balance: 100, points: 9, search: [9, 60], daily: [1, 2],
  });
});

test('menu: setas dao a volta e Enter escolhe', async () => {
  assert.equal(move(0, 'up', 3), 2);
  assert.equal(move(2, 'down', 3), 0);
  assert.equal(move(1, 'x', 3), 1);

  const pick = (keys) => {
    const input = new PassThrough();
    const result = select(['a', 'b', 'c'], { input, output: new PassThrough() });
    for (const k of keys) input.write(k);
    return result;
  };
  assert.equal(await pick(['\x1b[B', '\x1b[B', '\r']), 2);
  assert.equal(await pick(['2']), 1);
  assert.equal(await pick(['q']), -1);
});

test('agendamento: o exe chama a si mesmo; no checkout, node + script', () => {
  const execPath = 'C:/Program Files/nodejs/node.exe';
  assert.equal(launchCommand({ packaged: false, execPath, entry: 'C:/meu bot/bin/msr.js' }), '"C:/Program Files/nodejs/node.exe" "C:/meu bot/bin/msr.js"');
  assert.equal(launchCommand({ packaged: true, execPath: 'C:/Meus Apps/msr.exe', entry: 'C:/x/bin/msr.js' }), '"C:/Meus Apps/msr.exe"');
});
