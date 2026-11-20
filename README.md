# msr — bot do Microsoft Rewards (PC)

CLI que faz as missões diárias do Microsoft Rewards pelo site (`rewards.bing.com`), usando o Edge
de verdade com um perfil só do bot.

- **Cards**: conjunto diário e "Continuar ganhando", incluindo os quizzes.
- **Buscas no Bing**: lê o contador do dia (ex.: 39/60) e faz só as que faltam, espalhadas ao longo do dia.
- **Reivindicar pontos**: os bônus do site novo ficam "pendentes" e expiram; `msr claim` reivindica.

> Automatizar o Rewards é contra os termos de uso da Microsoft. O bot tenta se comportar como uma
> pessoa, mas o risco de restrição ou banimento da conta existe e é seu.

## Instalação

```
npm install
npm link        # instala o comando global `msr`
msr doctor      # confere Edge, sessão, perfil e agendamento
```

Requer Node 22+ e Microsoft Edge. A única dependência é `playwright-core` (sem baixar navegador).

## Uso

```
msr                      menu interativo
msr run                  faz o que falta (cards + buscas)
msr run --paced          só a fatia de buscas deste horário (é o que o agendador chama)
msr status [--json]      saldo, buscas, conjunto diário, cards, pontos a reivindicar
msr search [n]           só buscas; com n faz exatamente n (teste)
msr cards                só os cards
msr claim [--preview]    reivindica os pontos pendentes
msr stats [--days N]     histórico de pontos por dia
msr logs [--tail N]      log de hoje
msr schedule [install|remove|status|test] [--times 09:30,14:30,20:30] [--jitter 90]
msr login                abre o Edge do bot com janela para fazer login
msr clean                apaga extensões, dados sincronizados e caches do perfil do bot
msr doctor [--notify]    diagnóstico (com --notify, manda uma notificação de teste)
msr queries              exemplos de buscas que seriam feitas
```

Opções: `--show` (Edge com janela), `--no-http`, `--keep-open`, `--fast`, `--quiet`, `--notify`.
Códigos de saída: `0` ok · `1` erro · `2` não logado · `3` Bing não creditou as buscas.

## Como funciona

**Sem processo residente.** Nada fica rodando em segundo plano. `msr schedule install` cria uma
tarefa no Agendador do Windows com três gatilhos diários, cada um com atraso aleatório. Cada disparo
lê o estado por requisição (~1 s) e só abre o Edge se houver trabalho.

**Leitura por requisição.** Saldo, contador, cards e pontos a reivindicar vêm embutidos no HTML de
`/earn` e `/dashboard` (payload do Next.js). O bot baixa essas páginas com os cookies exportados do
Edge em `data/session.json`. Se a sessão expirar, cai sozinho para o navegador e renova. Clicar nos
cards e buscar no Bing é sempre feito pelo navegador de verdade.

**Edge sem janela.** O headless "cru" se identifica (`HeadlessChrome` no user-agent, tela 800x600);
o bot passa `--user-agent` e `--screen-info` para ficar igual ao Edge normal. O Edge é um processo
comum controlado por CDP, sem flags de automação (`navigator.webdriver` continua `false`).

**Perfil só para login.** O perfil em `.edge-profile/` existe apenas para manter a conta logada.
Abre sempre com `--disable-sync` e `--disable-extensions`: nada do seu Edge pessoal (extensões,
favoritos, senhas, histórico) é sincronizado para ele. Fica na faixa de 50–70 MB; `msr clean`
remove qualquer resto e os caches, sem perder o login.

**Ritmo do dia (`--paced`).** A meta de buscas cresce de 0% às 8h até 100% às 20h. Cada execução
faz `meta do horário − já feito`, com variação aleatória e mínimo de 3 buscas; depois das 20h faz
tudo o que falta. Se o PC estava desligado, a execução seguinte compensa.

**Aviso de falha.** Execuções agendadas mandam uma notificação do Windows se a conta deslogar, se
o Bing parar de creditar as buscas, se o formato do site mudar ou se der erro.

## Como as buscas evitam parecer robô

- **Nunca repete**: toda busca vai para `data/history.json` e não é usada de novo por 180 dias.
- **Assuntos mudam todo dia**: tendências do Google no Brasil e manchetes do G1, misturados com
  buscas do dia a dia ("receita de…", "como fazer…") completadas pelas sugestões reais do Bing.
- **Buscas encadeadas**: 1 a 4 buscas sobre o mesmo assunto, refinando, como uma pessoa faz.
- **Interação real**: digita letra por letra (com erros corrigidos), às vezes clica numa sugestão,
  rola a página, abre um resultado, clica em "pesquisas relacionadas".
- **Ritmo irregular**: 10 s a 4 min entre buscas, pausas longas entre assuntos, sessões em horários
  diferentes a cada dia.
- **Lista de bloqueio**: termos de sexo, violência, crime, drogas e apostas nunca são buscados,
  venham das fontes, das sugestões ou das pesquisas relacionadas (`src/queries.js`).

## Arquivos

```
bin/msr.js        entrada do comando
src/cli.js        argumentos, ajuda, códigos de saída      src/commands.js   comandos
src/run.js        orquestração de uma execução              src/menu.js       menu interativo
src/rsc.js        leitor do estado embutido no HTML         src/http.js       leitura por requisição
src/rewards.js    páginas do Rewards no navegador           src/activities.js cards e quizzes
src/searches.js   sessão de buscas                          src/queries.js    gerador de buscas
src/pacing.js     ritmo do dia                              src/schedule.js   Agendador de Tarefas
src/browser.js    Edge + CDP                                src/profile.js    tamanho/limpeza do perfil
src/stats.js      histórico diário                          src/notify.js     notificação do Windows
test/             node:test (npm test)
```

Dados locais, fora do git: `.edge-profile/` (login) e `data/` (`session.json` com os cookies da
conta, `history.json`, `days.json`, `logs/` dos últimos 30 dias). Não compartilhe essas pastas.

Ajustes pessoais vão em `data/config.json` e sobrepõem os padrões de `src/config.js`, por exemplo:

```json
{ "autoClaim": true, "pacing": { "startHour": 9, "finishHour": 22 } }
```

## O que o bot não faz

- **Busca mobile**: nesta conta o site mostra um contador único de busca, então emular celular não
  rende nada a mais. Se a conta passar a ter contador separado, `msr status` mostra.
- **Check-in do app Bing/Rewards e "Buscas" (quests)**: dependem do app de celular ou de compras.
- **Cards que exigem ação real** (ex.: criar imagem no Image Creator): depois de duas tentativas
  sem crédito, o bot deixa o card de lado por 30 dias.
