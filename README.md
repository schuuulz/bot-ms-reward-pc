# Bot Microsoft Rewards (PC)

Faz as missões diárias do Microsoft Rewards pelo site (`rewards.bing.com`), usando o Edge de
verdade com um perfil só do bot.

- **Cards**: conjunto diário (dashboard) e "Continuar ganhando" (aba Ganhar), incluindo os quizzes.
- **Buscas no Bing**: lê o contador do dia (ex.: 39/60) e faz só as buscas que faltam.
- **Reivindicar pontos**: os bônus do site novo ficam "pendentes" e expiram; `--claim` reivindica.

> Automatizar o Rewards é contra os termos de uso da Microsoft. O bot tenta se comportar como uma
> pessoa, mas o risco de restrição ou banimento da conta existe e é seu.

## Uso

```
npm install
node src/index.js                    # confere o estado e faz o que estiver pendente (cards + buscas)
node src/index.js --status           # saldo, contador de buscas e cards pendentes, sem abrir o navegador
node src/index.js --show             # igual ao primeiro, mas com a janela do Edge visível
node src/index.js --dry-run          # só imprime exemplos de buscas (não abre o navegador)
node src/index.js --searches --max-searches 3
node src/index.js --claim --preview  # mostra quanto há para reivindicar, sem clicar
node src/index.js --claim            # reivindica os pontos pendentes
node src/index.js --help
```

Para rodar todo dia sozinho (horário varia a cada dia):

```
powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1
powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1 -Remove
```

O PC precisa estar ligado e com a sessão aberta. O bot usa mouse e teclado virtuais dentro do Edge
dele (não mexe no seu mouse nem no seu Edge normal).

## Sem janela e sem navegador

- **Leitura por requisição**: o estado (saldo, contador de buscas, cards, pontos a reivindicar) vem
  embutido no HTML de `rewards.bing.com/earn` e `/dashboard`. O bot baixa essas páginas direto com
  os cookies salvos em `data/session.json` (exportados do Edge no fim de cada execução). Assim
  `--status` responde em ~1 s, e a execução normal só abre o navegador se houver algo pendente.
  Se a sessão salva expirar, ele cai automaticamente para o navegador e renova os cookies.
- **Headless**: quando precisa do navegador, o Edge abre sem janela (`headless: true` no config).
  O headless "cru" se identifica (`HeadlessChrome` no user-agent, tela 800x600); o bot passa
  `--user-agent` e `--screen-info` para ficar igual ao Edge normal. `--show` abre com janela.
- **Só leitura por requisição**: clicar nos cards e buscar no Bing continua sendo feito pelo
  navegador de verdade. Fazer isso por requisição direta é exatamente o padrão que denuncia robô.
- `data/session.json` contém os cookies de login da sua conta: não compartilhe essa pasta.
- Para desligar: `httpStatus: false` / `headless: false` em `src/config.js`, ou `--no-http` / `--show`.

## Login

O perfil do bot fica em `.edge-profile/`. Na primeira abertura o Edge entra sozinho na conta
Microsoft do Windows. Se o bot avisar que não está logado, abra com janela e faça login uma vez:

```
node src/index.js --status --no-http --show --keep-open
```

## Como as buscas evitam parecer robô

- **Nunca repete**: toda busca feita vai para `data/history.json` e não é usada de novo por 180 dias.
- **Assuntos mudam todo dia**: tendências do Google no Brasil, artigos mais lidos da Wikipédia e
  manchetes do G1, misturados com buscas do dia a dia ("receita de…", "como fazer…") completadas
  pelas sugestões reais do Bing. Os "moldes" usados recentemente também não se repetem.
- **Buscas encadeadas**: 1 a 4 buscas sobre o mesmo assunto, refinando, como uma pessoa faz.
- **Interação real**: digita na caixa do Bing letra por letra (com erros corrigidos), às vezes
  clica numa sugestão, rola a página, abre um resultado, clica em "pesquisas relacionadas".
- **Ritmo irregular**: intervalos de ~10 s a 4 min entre buscas, pausas longas entre assuntos.
- **Navegador normal**: o Edge é aberto como processo comum (sem flags de automação) e controlado
  por CDP; `navigator.webdriver` continua `false`, com ou sem janela.
- **Cooldown**: se o contador para de subir, espera ~15 min antes de continuar.

Ajustes em `src/config.js`.

## O que o bot não faz

- **Busca mobile**: nesta conta o site mostra um contador único de busca (não há pontos separados
  de PC e celular), então emular celular não rende nada a mais.
- **Check-in do app Bing/Rewards e "Buscas" (quests)**: dependem do app de celular, do app desktop
  ou de compras.
- **Cards que exigem ação real** (ex.: criar imagem no Image Creator): o bot clica e visita, mas
  se o card continuar pendente ele só registra no log.
