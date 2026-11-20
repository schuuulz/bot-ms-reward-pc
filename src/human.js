// Primitivas de comportamento "humano": pausas irregulares, digitacao, mouse e rolagem.

let timeScale = 1;
export const setTimeScale = (s) => { timeScale = s; };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const chance = (p) => Math.random() < p;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Pausa "de comportamento" (encurtada pelo --fast). */
export const pause = (min, max = min) => sleep(rand(min, max) * timeScale);

/** Amostra log-normal: maioria perto da mediana, de vez em quando bem mais longa. */
export function logNormal(median, sigma, min, max) {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(max, Math.max(min, median * Math.exp(sigma * z)));
}

const mousePos = new WeakMap();

/** Move o mouse numa curva (bezier quadratica) com velocidade variavel. */
export async function moveMouse(page, x, y) {
  const from = mousePos.get(page) ?? { x: rand(200, 700), y: rand(150, 450) };
  const dist = Math.hypot(x - from.x, y - from.y);
  const steps = Math.max(8, Math.min(40, Math.round(dist / 25) + randInt(4, 10)));
  const cx = (from.x + x) / 2 + rand(-0.2, 0.2) * dist;
  const cy = (from.y + y) / 2 + rand(-0.2, 0.2) * dist;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t * t * (3 - 2 * t); // acelera e desacelera
    const px = (1 - e) ** 2 * from.x + 2 * (1 - e) * e * cx + e ** 2 * x;
    const py = (1 - e) ** 2 * from.y + 2 * (1 - e) * e * cy + e ** 2 * y;
    await page.mouse.move(px, py);
    await sleep(rand(4, 16));
  }
  mousePos.set(page, { x, y });
}

/** Clique com movimento ate um ponto aleatorio dentro do elemento. */
export async function humanClick(page, locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 8000 });
  await pause(250, 700);
  const box = await locator.boundingBox();
  if (!box) throw new Error('elemento nao esta visivel');
  const x = box.x + box.width * rand(0.25, 0.75);
  const y = box.y + box.height * rand(0.3, 0.7);
  await moveMouse(page, x, y);
  await pause(80, 260);
  await page.mouse.down();
  await sleep(rand(40, 130));
  await page.mouse.up();
}

const NEIGHBORS = {
  a: 'sq', b: 'vn', c: 'xv', d: 'sf', e: 'wr', f: 'dg', g: 'fh', h: 'gj', i: 'uo', j: 'hk', l: 'k',
  m: 'n', n: 'bm', o: 'ip', p: 'o', r: 'et', s: 'ad', t: 'ry', u: 'yi', v: 'cb',
};

/** Digita caractere por caractere, com ritmo irregular e erros corrigidos de vez em quando. */
export async function humanType(page, text, { typoRate = 0.025 } = {}) {
  for (const ch of text) {
    if (NEIGHBORS[ch] && chance(typoRate)) {
      await page.keyboard.type(pick([...NEIGHBORS[ch]]));
      await sleep(rand(140, 450));
      await page.keyboard.press('Backspace');
      await sleep(rand(90, 260));
    }
    await page.keyboard.type(ch);
    await sleep(ch === ' ' ? rand(90, 330) : rand(45, 190));
    if (chance(0.03)) await sleep(rand(300, 1200)); // parou para pensar
  }
}

/** Rola a pagina em "puxadas", as vezes voltando um pouco. */
export async function humanScroll(page, { times = randInt(2, 5) } = {}) {
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, rand(220, 720));
    await pause(500, 1900);
  }
  if (chance(0.3)) {
    await page.mouse.wheel(0, -rand(200, 600));
    await pause(400, 1200);
  }
}
