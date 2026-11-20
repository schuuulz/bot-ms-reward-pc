// Menu interativo de terminal (setas ou j/k, Enter, numeros 1-9, q/Esc para sair). Sem dependencias.

import readline from 'node:readline';
import { paint } from './ui.js';

/** Proximo indice selecionado para uma tecla (da a volta nas pontas). */
export function move(index, key, length) {
  if (key === 'up' || key === 'k') return (index - 1 + length) % length;
  if (key === 'down' || key === 'j') return (index + 1) % length;
  return index;
}

/** Mostra a lista e resolve com o indice escolhido, ou -1 se a pessoa saiu. */
export function select(items, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    let index = 0;
    const draw = (redraw) => {
      if (redraw) output.write(`\x1b[${items.length}A`);
      items.forEach((item, i) => {
        output.write(`\x1b[2K${i === index ? paint('cyan', `❯ ${item}`) : `  ${item}`}\n`);
      });
    };
    const finish = (value) => {
      input.off('keypress', onKey);
      input.setRawMode?.(false);
      input.pause();
      resolve(value);
    };
    const onKey = (text, key = {}) => {
      if (key.name === 'return' || key.name === 'enter') return finish(index);
      if (key.name === 'escape' || key.name === 'q' || (key.ctrl && key.name === 'c')) return finish(-1);
      const digit = Number(text);
      if (digit >= 1 && digit <= items.length) return finish(digit - 1);
      const next = move(index, key.name, items.length);
      if (next !== index) {
        index = next;
        draw(true);
      }
    };
    readline.emitKeypressEvents(input);
    input.setRawMode?.(true);
    input.resume();
    input.on('keypress', onKey);
    draw(false);
  });
}

/** Espera um Enter (para a pessoa ler o resultado antes de voltar ao menu). */
export function pressEnter(message, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}
