# msr — bot do Microsoft Rewards (PC)

Faz as missões diárias do Microsoft Rewards pelo site (`rewards.bing.com`), usando o Edge de
verdade com um perfil só do bot. Roda no Windows 10/11.

- **Cards**: conjunto diário e "Continuar ganhando", incluindo quizzes e os cards do Image Creator.
- **Buscas no Bing**: lê o contador do dia (ex.: 39/60) e faz só as que faltam, espalhadas ao longo do dia.
- **Reivindicar pontos**: os bônus do site ficam "pendentes" e expiram; `msr claim` reivindica.

> Automatizar o Rewards é contra os termos de uso da Microsoft. O bot tenta se comportar como uma
> pessoa, mas o risco de restrição ou banimento da conta existe e é seu.

## Instalar (`msr.exe`, sem instalar mais nada)

Só precisa do Windows com o Edge, que já vem instalado. O navegador que você usa no dia a dia não
importa e não é alterado.

1. **Conta**: o Windows precisa estar logado com a sua conta Microsoft (Configurações > Contas >
   Suas informações). O bot usa essa conta sozinho; o msr nunca pede login nem senha.
2. Baixe o `msr.zip` da [última versão](https://github.com/schuuulz/bot-ms-reward-pc/releases/latest),
   descompacte o `msr.exe` numa pasta fixa **dentro da sua pasta de usuário** (ex.:
   `C:\Users\<você>\msr`) e abra com dois cliques. Evite pastas na raiz do disco, como `C:\msr`:
   ali outras contas do PC conseguem alterar arquivos. O exe não tem assinatura digital, então o
   Windows avisa na primeira vez: "Mais informações" > "Executar assim mesmo".
3. Ao abrir, o msr confere a conta e mostra o saldo. Veja se é a conta certa.
4. No menu, **Agendamento > Ativar** para rodar sozinho todo dia. Se mover o `msr.exe` depois,
   ative de novo (o Diagnóstico avisa).

Se a conta não for detectada, o msr só mostra as instruções do passo 1; não há tela de login. Quem
usa conta local no Windows, ou quer usar uma conta Microsoft diferente da do Windows, não consegue
usar o exe.

Login e dados ficam em `%LOCALAPPDATA%\msr\`. Para remover tudo: Agendamento > Desativar, depois
apague o exe e essa pasta.

### Atualizar

O menu mostra a versão em uso (`msr v2.1.2`). Toda vez que é aberto, o msr consulta a última
versão publicada no GitHub. Havendo versão nova, aparece o aviso e a opção **Quero Atualizar** no
menu. Nada é atualizado sem você escolher, e as execuções agendadas não consultam nada.

Ao atualizar, o msr baixa o binário da release, confere o SHA-256 com o que o GitHub informa para
o arquivo, testa o exe novo e só então troca o atual. Login, dados e agendamento continuam como
estavam. Pela linha de comando: `msr update` (ou `msr update --check` para só conferir).

## Uso

O `msr.exe` aberto com dois cliques mostra o menu. Pela linha de comando:

```
msr                      menu interativo
msr run                  faz o que falta (cards + buscas)
msr run --paced          só a fatia de buscas deste horário (é o que o agendador chama)
msr status [--json]      saldo, buscas, conjunto diário, cards, pontos a reivindicar
msr search [n]           só buscas; com n faz exatamente n (teste)
msr cards                só os cards
msr claim [--preview]    reivindica os pontos pendentes
msr stats [--days N]     histórico de pontos por dia
msr logs [--day AAAA-MM-DD] [--tail N] [--errors]    log do último dia, de outro dia, ou só os erros
msr logs days | keep <dias|sempre> | export [arquivo] | clear
msr schedule [install|remove|status|test] [--times 09:30,14:30,20:30] [--jitter 90]
msr update [--check]     atualiza para a última versão publicada
msr doctor [--notify]    diagnóstico: versão, Edge, sessão, perfil, agendamento
msr clean                apaga extensões, dados sincronizados e caches do perfil do bot
msr queries              exemplos de buscas que seriam feitas
msr login                (só no checkout) abre o Edge do bot com janela para entrar na conta
```

Opções: `--show` (Edge com janela), `--no-http`, `--keep-open`, `--fast`, `--quiet`, `--notify`,
`--version`. Códigos de saída: `0` ok · `1` erro · `2` não logado · `3` Bing não creditou as buscas.

## Como funciona

**Sem processo residente.** Nada fica rodando em segundo plano. O agendamento é uma tarefa no
Agendador do Windows com três gatilhos diários, cada um com atraso aleatório. Cada disparo lê o
estado por requisição e só abre o Edge se houver trabalho.

**Leitura por requisição.** Saldo, contador, cards e pontos a reivindicar vêm embutidos no HTML de
`/earn` e `/dashboard`. O bot baixa essas páginas com os cookies exportados do Edge. Se a sessão
expirar, cai sozinho para o navegador e renova. Clicar nos cards e buscar no Bing é sempre feito
pelo navegador de verdade.

**Edge sem janela.** O headless "cru" se identifica (`HeadlessChrome` no user-agent, tela 800x600);
o bot passa `--user-agent` e `--screen-info` para ficar igual ao Edge normal. O Edge é um processo
comum controlado por CDP, sem flags de automação (`navigator.webdriver` continua `false`).

**Perfil só para login.** O perfil do Edge do bot existe apenas para manter a conta logada. Abre
sempre com `--disable-sync` e `--disable-extensions`: nada do seu Edge pessoal (extensões,
favoritos, senhas, histórico) é sincronizado para ele. `msr doctor` mostra o tamanho e avisa se
houver algo além do login; `msr clean` remove restos e caches sem perder o login.

**Ritmo do dia (`--paced`).** A meta de buscas cresce de 0% às 8h até 100% às 20h. Cada execução
faz `meta do horário − já feito`, com variação aleatória e mínimo de 3 buscas; depois das 20h faz
tudo o que falta. Se o PC estava desligado, a execução seguinte compensa.

**Cards.** O bot clica o card, fica um pouco na página e faz o que ela pede: responde quizzes e,
nos cards do Image Creator ("crie um papel de parede..."), espera a imagem e clica em "Definir
como papel de parede", que é o que credita. Ele não instala o app Bing Wallpaper nem muda o papel
de parede do PC. Card que continua pendente depois de duas tentativas (exige instalar um app,
comprar algo) é deixado de lado por 30 dias, e o `msr status` mostra quais são.

**Logs em SQLite.** Cada execução grava suas linhas em `logs.db`, usando o SQLite que já vem no
Node. Por padrão ficam 30 dias; `msr logs keep <dias|sempre>` (ou o menu Logs) muda isso, e
`msr logs export` gera um arquivo de texto para ler ou mandar a alguém.

**Aviso de falha.** Execuções agendadas mandam uma notificação do Windows se a conta deslogar, se
o Bing parar de creditar as buscas, se o formato do site mudar ou se der erro.

## Como as buscas evitam parecer robô

- **Nunca repete**: toda busca vai para `history.json` e não é usada de novo por 180 dias.
- **Assuntos mudam todo dia**: tendências do Google no Brasil e manchetes do G1, misturados com
  buscas do dia a dia ("receita de…", "como fazer…") completadas pelas sugestões reais do Bing.
- **Buscas encadeadas**: 1 a 4 buscas sobre o mesmo assunto, refinando, como uma pessoa faz.
- **Interação real**: digita letra por letra (com erros corrigidos), às vezes clica numa sugestão,
  rola a página, abre um resultado, clica em "pesquisas relacionadas".
- **Ritmo irregular**: 10 s a 4 min entre buscas, pausas longas entre assuntos, sessões em horários
  diferentes a cada dia.
- **Lista de bloqueio**: termos de sexo, violência, crime, drogas e apostas nunca são buscados,
  venham das fontes, das sugestões ou das pesquisas relacionadas (`src/queries.js`).

## Segurança

- **Sem senha**: o msr nunca vê nem pede a senha da conta. O Edge do bot entra pela conta do Windows.
- **Cookies protegidos**: a sessão exportada (`session.json`) é gravada com a proteção de dados
  do Windows (DPAPI). Só o mesmo usuário, no mesmo PC, consegue abrir; o arquivo copiado para outro
  lugar não serve. Isso não protege contra um programa malicioso rodando na sua própria sessão
  do Windows, que alcança os dados do bot como alcançaria os do seu navegador.
- **Navegador do bot**: nunca baixa arquivos, não carrega extensões e roda com a sandbox normal
  do Edge. O bot só controla o Edge do perfil dele: se outro navegador estiver usando a mesma
  porta de depuração, ele recusa em vez de agir no navegador errado.
- **Cards**: só clica em cards que levam ao `bing.com`; nada de resgate, compra ou download.
- **Atualização**: só baixa do repositório oficial, por https, e confere o SHA-256 antes de
  trocar o exe. As releases são imutáveis: depois de publicadas, os arquivos não podem ser
  trocados. Isso garante que o arquivo é o publicado aqui; não substitui uma assinatura digital,
  que o exe não tem (por isso o aviso do SmartScreen).
- **Onde instalar**: dentro da sua pasta de usuário. Fora dela, outra conta do PC pode conseguir
  trocar o `msr.exe`, e o agendamento rodaria o arquivo dela na sua conta. O Diagnóstico avisa.
- **PC compartilhado**: enquanto o bot roda, o Edge dele aceita controle por uma porta local
  (`127.0.0.1:9222`) sem senha. Sites não alcançam essa porta, mas qualquer programa do próprio
  PC, inclusive de outra conta do Windows, alcança e controla o navegador logado. Não use o msr
  num PC dividido com pessoas em quem você não confia.
- **Texto de fora**: buscas e títulos vindos de sites têm os caracteres de controle removidos
  antes de irem para o terminal e para o log.
- **O que fica no seu PC**: o perfil do Edge do bot (login), a sessão, o histórico de buscas e os
  logs. Nada é enviado a ninguém além da Microsoft (o próprio uso do Rewards) e das consultas de
  versão ao GitHub.

## Desenvolvimento

Requer Node 26+ e Microsoft Edge. A única dependência é `playwright-core` (não baixa navegador).

```
npm install
npm link            # instala o comando global `msr`, rodando direto do código
npm test
npm run build:exe   # gera dist/msr.exe (~109 MB)
npm run package     # dist/msr.zip, dist/msr.exe.gz e dist/SHA256SUMS.txt
```

No checkout, login e dados ficam na pasta do projeto (`.edge-profile/` e `data/`, fora do git); a
variável `MSR_HOME` muda esse lugar. Não compartilhe essas pastas.

**Lançar uma versão**: suba o número em `package.json` e dê push na `main`. O GitHub Actions
(`.github/workflows/release.yml`) roda os testes, gera o exe e publica a release `v<versão>`; quem
já usa o msr passa a ver "Quero Atualizar". Push sem mudar a versão só roda os testes.

**O exe** é o próprio Node com o app dentro (Node SEA, sem dependência extra). Entram só
`package.json`, `bin/`, `src/` e `playwright-core`: login e dados nunca vão junto. Na primeira
execução de cada versão o app é extraído para `%LOCALAPPDATA%\msr\app\` (14 MB, cerca de 5 s).

Ajustes pessoais vão em `data/config.json` e sobrepõem os padrões de `src/config.js`, por exemplo:

```json
{ "autoClaim": true, "pacing": { "startHour": 9, "finishHour": 22 } }
```

```
bin/msr.js        entrada do comando
src/cli.js        argumentos, ajuda, códigos de saída      src/commands.js   comandos e menus
src/run.js        orquestração de uma execução              src/menu.js       seletor do menu
src/rsc.js        leitor do estado embutido no HTML         src/http.js       leitura por requisição
src/rewards.js    páginas do Rewards no navegador           src/activities.js cards, quizzes, Image Creator
src/searches.js   sessão de buscas                          src/queries.js    gerador de buscas
src/pacing.js     ritmo do dia                              src/schedule.js   Agendador de Tarefas
src/browser.js    Edge + CDP                                src/profile.js    tamanho/limpeza do perfil
src/stats.js      histórico diário                          src/notify.js     notificação do Windows
src/logs.js       logs em SQLite                            src/ui.js         cores, tabela, painel
src/update.js     versão e atualização pelas releases       src/win.js        PowerShell e DPAPI
scripts/          build-exe.js, package-release.js e sea-main.cjs (o que roda ao abrir o exe)
test/             node:test
```

## O que o bot não faz

- **Busca mobile**: nas contas testadas o site mostra um contador único de busca, então emular
  celular não rende nada a mais. Se a conta tiver contador separado, `msr status` mostra.
- **Check-in do app Bing/Rewards e "Buscas" (quests)**: dependem do app de celular ou de compras.
- **Resgates, compras e instalação de apps**: o bot nunca faz.
