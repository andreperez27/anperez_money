# anperez-money — diário de bordo

Este é o **índice** do diário de bordo do projeto. Cada dia de trabalho tem
seu próprio arquivo em `diario/AAAA-MM-DD.md`, com o registro completo daquele
dia. Aqui você encontra o **resumo do estado atual** ("Onde estamos") e a
**lista cronológica** de todos os dias, com um resumo de cada um.

## Onde estamos

Projeto batizado: **anperez-money** — app financeiro pessoal em **React +
Vite + Supabase** (Postgres com RLS), com frontend responsivo (desktop e
mobile).

Módulos já implementados:
- **Autenticação** (Supabase Auth: login/cadastro) e **conta ativa** isolando
  os dados por usuário/conta.
- **Contas**: criação, saldo mantido pelo banco (triggers), edição/exclusão.
- **Movimentações / Extrato**: lançamentos com saldo progressivo, ordem
  bancária, filtros, reconciliação (saído do saldo de abertura/movimentações),
  corte de dia e editar/excluir.
- **Transferências**: entre contas próprias + para terceiros, com exclusão
  física segura (editar = excluir e relançar).
- **Caixinhas**: guardar/resgatar como conta própria, extrato próprio.
- **Planejamentos**: domínio completo (previsto → realizado em conta),
  séries parceladas/mensais/semanais, periodicidade, geradores (DAS-MEI,
  condomínio, recorrente mensal), direcionamento de destino (Conta/Cartão),
  média móvel — e a **fatura automática no Planejamento** com projeção
dinâmica por cartão (real + previstos, sem dupla contagem). Recorrência
   mensal em **série** (dia de vencimento + término/24 meses), **edição
   completa pré-preenchida** (salvando só o que mudou), **editar a série
   inteira só no futuro** (realizado/cancelado imutáveis) e **excluir série
   do banco** sem apagar movimentações reais; **escolha de conta no destino**
   na criação e na edição (`conta_destino_id`) e formulário recorrente que
   **limpa automaticamente** após gerar.
- **Cartões de Crédito**: lista, fatura (real de `v_faturas`), lançar compra,
  extrato do cartão, fluxo de pagamento da fatura, migração do histórico do
  app antigo — e linhas de fatura/extrato **responsivas no celular** (2
  níveis, sem cortar descrição/valor).
- **Ponto Inteligente** (módulo de jornada por **exceções** ao padrão): carga
  padrão constante (Seg–Sex 20:30→03:00, Sáb 20:30→02:00, Dom off) nunca é
  lançada; lança-se só o que foge — hora extra (HE = horas − base), trabalho
  em domingo/feriado (`domfer`, base 0, diária congelada pela hora de saída)
  e **férias** (agora por **intervalo** com **saldo de 15 dias/ano**, sem
  sobreposição, ex-férias avulsas migradas). Turno que
  cruza a meia-noite (saída ≤ entrada → +1 dia) e valores em R$ **congelados
  na gravação** (reajuste da config não retrocalcula) — lógica portada do app
  antigo (`Controle_Horas`), com `VALOR_FIXO_SEMANA` reajustado para 1650.
  Feriados viram tabela. Migration 22 + `pontoCalc.js` + `usePonto.js` +
  tela `Ponto.jsx` (31 testes→46). Fix RLS (`default auth.uid()` na
  `ponto_excecoes`, migration 23) + seed dos 12 feriados do app antigo para
  2026 e 2027 (móveis de 2027 calculados pela Páscoa: Sexta Santa 26/03 e
  Corpus Christi 27/05). Compensação (carga igual ao padrão + horário atípico
  = lança `he` he=0) e importação do histórico (migration 24, 98 lançamentos).
  Férias por intervalo (migration 25) e **valores na página Configurações**
  (`PontoConfig.jsx`). 8ª leva: lançamento virou "+ Lançar avulso" em modal
  padrão (o sistema analisa a data e classifica automaticamente hora
  extra / dom-fer / compensação, bloqueando o horário padrão), "Marcar férias"
  no mesmo modal, e feriados movidos para a Configurações (lista + excluir).
  9ª leva: linha do tempo **semanal** (SeletorPeriodo do Planejamento) e
  correção do card Domingos/feriados (o fechamento passou a ler as colunas
  snake_case do banco com fallback camelCase) — 47 testes.
  10ª leva: correção dos cards do resumo semanal (card "Férias" fora → 
  "Previsto a receber"; bug do saldo consertado usando `he` isolado, card
  renomeado "Carga horária" via `cargaCumpridaHoras`; ação "editar" na lista
  de lançamentos) e reorganização da Home (bottom nav/menu com Planejamento e
  Ponto; Configurações e troca de senha no menu de perfil com rota
  `/configuracoes/senha`; Configurações enxuta; cards Contas/Cartões ciclando
  e Ponto/Planejamento com valor real) — 48 testes.
  11ª leva: **desconto do fixo semanal por feriado** (`pontoCalc.js`: feriado
  de segunda a sábado desconta 1/6 do fixo dinamicamente de ponto_config;
  domingo não desconta; fonte única `previstoAReceberDaSemana` no card
  "Previsto a receber" e na reconciliação do Planejamento) — 57 testes.

Banco de dados: schema completo no Supabase (contas, movimentações,
caixinhas, planejamentos, cartões de crédito e views/funções/RPCs de
negócio), com RLS ativo.

Testes: suíte em `scripts/teste_*.mjs` (funções puras do domínio) + build de
produção (`npm run build`).

Os detalhes de cada etapa/dia estão em `diario/` (veja a lista abaixo).

## O que fazer agora, na sua máquina

1. Baixe os arquivos novos/atualizados: `src/App.jsx`, `src/hooks/useAuth.js`,
   `src/pages/Login.jsx`, `src/pages/Dashboard.jsx`.
2. Coloque `useAuth.js` dentro de `src/hooks/` e os dois `.jsx` dentro de
   `src/pages/` (crie essas pastas se ainda não existirem).
3. Se o `npm run dev` já estiver rodando, ele recarrega sozinho. Senão,
   roda `npm run dev` de novo.
4. Na tela, clique em "Ainda não tem conta? Criar uma", preencha um e-mail
   seu de verdade e uma senha (mínimo 6 caracteres), e clique em Criar conta.
5. Vá até o e-mail informado, ache a mensagem do Supabase e clique no link
   de confirmação.
6. Volte pro app, agora em modo "Entrar", e faça login com o mesmo
   e-mail/senha.
7. Você deve cair na tela do Dashboard, mostrando "Logado como:
   seu@email.com" e um botão Sair.

Se o e-mail de confirmação não chegar em alguns minutos, olha a caixa de
spam. Se ainda assim não chegar, me avisa que ajustamos a configuração no
painel do Supabase (Authentication → Settings).

## Próximo passo

Evoluir o projeto conforme as etapas registradas em `diario/`, validando cada
módulo com o André antes de commitar.

## O que fazer agora, na sua conta Supabase

1. Vá em [supabase.com](https://supabase.com) e crie um projeto novo (se
   ainda não tiver um). Pode ser do plano gratuito, é mais que suficiente
   pro seu volume de dados (581 movimentações hoje).
2. Escolha uma senha forte pro banco quando pedir (o Supabase gera uma
   sugestão, pode usar). Guarde essa senha num lugar seguro, ela não é a
   mesma coisa que a anon key, e você não vai precisar dela no dia a dia do
   app, só pra acesso administrativo direto ao Postgres se algum dia
   precisar.
3. Espere o projeto terminar de provisionar (leva 1-2 minutos).
4. No menu lateral, clique em **SQL Editor**.
5. Abra o arquivo `supabase/01_schema_contas_movimentacoes.sql` deste
   projeto, copie o conteúdo inteiro, cole no editor e clique em **Run**.
6. Confirme que apareceu "Success. No rows returned" e que, no menu
   **Table Editor**, agora existem as tabelas `contas` e `movimentacoes`.

## Duas informações que você vai precisar guardar

Ainda dentro do Supabase, vá em **Project Settings → API**. Você vai ver
duas coisas que vamos usar no próximo passo (conectar o React ao banco):

- **Project URL** (algo como `https://xxxxx.supabase.co`)
- **anon public key** (uma string longa)

Pode copiar as duas pra um bloco de notas por enquanto. Elas são públicas
(vão parar no código do site depois), então não tem problema anotar em texto
simples. A única chave que exige cuidado é a **service_role**, que a gente
nem vai usar nesta fase, e quando usar, eu aviso explicitamente.

## Próximo passo (quando você confirmar que o schema rodou)

Vamos montar o esqueleto do projeto React + Vite, conectar ele ao Supabase
usando essas duas informações, e construir a tela de login. Só depois disso
funcionando é que entramos na tela de contas e movimentações de fato.

Me avisa quando o SQL Editor mostrar sucesso e as tabelas aparecerem no
Table Editor, que eu libero o próximo arquivo.

## Diários por dia

Lista cronológica dos registros de cada dia. Cada arquivo contém o registro
completo daquele dia.

- [diario/2026-08-18.md](diario/2026-08-18.md) — Etapas 01 a 05: fundação do Git, leitura e criação de contas no Dashboard, lançamentos com saldo mantido pelo banco e navegação com React Router.
- [diario/2026-08-19.md](diario/2026-08-19.md) — Etapas 06, 07, 07b e 08: hooks de cartões/caixinhas e consolidação da conta ativa isolando os dados.
- [diario/2026-08-20.md](diario/2026-08-20.md) — Etapas 09 a 12 e 07c: telas sem rolagem, extrato estilo app antigo, caixinhas completas, editar/excluir lançamentos + migração do banco, e consolidação do menu.
- [diario/2026-08-21.md](diario/2026-08-21.md) — Etapa 13: responsividade móvel (breakpoint, CaberNaTela condicional e bottom nav).
- [diario/2026-08-22.md](diario/2026-08-22.md) — Etapas 14 e 15: transferências entre contas + para terceiros, exclusão física segura; Hotfix do botão flutuante do Extrato e Correção A+B+C da reconciliação (trigger não alterado).
- [diario/2026-08-23.md](diario/2026-08-23.md) — Correção do saldo de abertura no extrato, refinamento visual (modelo bancário), ordem bancária, Dashboard dark como HUB e início do domínio de Planejamentos (registro em atraso).
- [diario/2026-08-24.md](diario/2026-08-24.md) — Modelagem de planejamentos, séries parceladas e criação na tela; auditoria, infra de períodos e reorganização da tela.
- [diario/2026-08-27.md](diario/2026-08-27.md) — Módulo Cartões de Crédito (ETAPA C1/C2/C3): frontend da lista e fatura, edição de cartão, "lançar compra", extrato do cartão, fluxo de pagamento, fatura demonstrativa e rolagem no desktop.
- [diario/2026-08-28.md](diario/2026-08-28.md) — ETAPAS C4/C5/C7/C8 + Planejamento + Extrato: rolagem uniforme, formulários em modal, migração do histórico de cartões, efetivação previsto→realizado em conta, gerador de condomínio, reordenação manual do dia e periodicidade/recorrência/média móvel.
- [diario/2026-08-31.md](diario/2026-08-31.md) — Consolidação de Condomínio/DAS-MEI no formulário padrão, direcionamento Conta/Cartão e a fatura automática no Planejamento (projeção dinâmica por cartão, sem dupla contagem); correções: previsto de cartão nunca soma como saída direta e fim do furo compra/vencimento (a projeção respeita o dia de fechamento da fatura e aparece no período do vencimento, aceitando cartão de destino inativo).
- [diario/2026-09-01.md](diario/2026-09-01.md) — Recorrência no Planejamento vira SÉRIE mensal (dia de vencimento 1-31 + término opcional; indefinida = horizonte de 24 meses, prorrogável) com `repetirValorEmOcorrencias`/`montarLinhasRecorrentes`; edição completa em formulário pré-preenchido (`EditarPlanejamentoForm` + `montarAlteracoesEdicao`, salvando só o que mudou; série = só a ocorrência atual); migration 21 (`serie_data_termino`). 2ª leva: editar série inteira só no futuro + excluir série do banco (`CalcularRegeneraçãoRecorrente`/`excluirSerie`). 3ª leva: escolha de conta no destino na criação e edição, correção do payload camelCase da série, formulário recorrente limpa após gerar, fatura/extrato de cartões responsivos no celular e entrega commitada/publicada (`14e20cc`, `f50f98c`). 4ª leva: módulo PONTO INTELIGENTE por exceções (migration 22 + `pontoCalc.js`/`usePonto.js`/tela `Ponto.jsx`, 31 testes) — lógica portada do app antigo, reajuste do fixo semanal confirmado em 1650. 5ª leva: fix RLS (`default auth.uid()` na `ponto_excecoes`, migration 23) + seed dos feriados do app antigo (2026 e 2027). 6ª leva: análise do `registros` do app antigo e exportação para o modelo de exceções — migration 24 importa 98 lançamentos (74 `he` + 24 `domfer`; dias-padrão descartados) com `ehTurnoPadrao`/`classificarTurnoParaUI` e a NOVA REGRA DE COMPENSAÇÃO (carga igual à esperada com horário atípico = lança `he` he=0, registrando entrada/saída por controle); 38 testes. 7ª leva: FÉRIAS POR INTERVALO — migration 25 (`ponto_ferias`, saldo de 15 dias/ano, sem sobreposição via exclusion constraint, migra as férias avulsas) + `QUOTA_FERIAS_ANUAL`/helpers na lib (46 testes), `criarFerias`/`excluirFerias`/`saldoFerias` no hook, formulário início+fim e lista de férias na tela, e **valores movidos para a página Configurações** (`PontoConfig.jsx`, reajuste vale só para lançamentos novos). 8ª leva: lançamento virou "+ Lançar avulso" em modal padrão (sistema analisa a data e classifica hora extra / dom-fer / compensação, bloqueando o horário padrão), "Marcar férias" no mesmo modal, feriados movidos para a Configurações. 9ª leva: linha do tempo **semanal** (SeletorPeriodo do Planejamento) e correção do bug do card Domingos/feriados (`fecharPeriodo` lendo as colunas snake_case do banco) — 47 testes.
- [diario/2026-09-02.md](diario/2026-09-02.md) — Correção dos cards do Ponto (card "Férias" fora do resumo semanal → "Previsto a receber"; bug do "Saldo do período" consertado usando `he` isolado e card renomeado para "Carga horária" via helper puro `cargaCumpridaHoras`, 48 testes; ação
   "editar" na lista de lançamentos usando o `editarExcecao` que já existia) e
   reorganização da Home (bottom nav/menu com Planejamento e Ponto;
   Configurações e troca de senha no menu de perfil com nova rota
   `/configuracoes/senha`; Configurações enxuta; card Contas ciclando por todas
   as contas + patrimônio; card Cartões ciclando por limite disponível via RPC
   `calcular_limite_disponivel`/novo `useLimitesCartoes`; cards Ponto e
   Planejamento com valor real via `useResumoPonto`/`useResumoPlanejamento`).
- [diario/2026-09-04.md](diario/2026-09-04.md) — Planejamento vinculado ao Ponto (migration 28, reconciliação automática do valor real quando a semana de trabalho fecha, badge coral "Ajustado pelo Ponto"); badge vermelho "Atrasado" com precedência sobre "Disponível"; seletor Entrada/Despesa na recorrência; tag "n/N" e mês também removidas para origem `jornada`; Configurações → Contas sem saldo nem marcar ativa; design flat (sem sombras e sem anel de foco no clique) + refino do design system; **desconto do fixo semanal por feriado** (regra 04/09/2026: feriado de seg–sáb desconta 1/6 do fixo, domingo não; fonte única `previstoAReceberDaSemana` no card e na reconciliação). Migration 28 **aplicada** no Supabase.
- **Planejamento vinculado ao Ponto** (migration 28): a série recorrente semanal
  pode nascer "Vincular ao Ponto" (`origem='jornada'`); cada ocorrência guarda a
  semana de trabalho e, quando ela fecha, o valor real (fixo + HE +
  domingo/feriado) substitui a estimativa — reconciliação lazy no carregamento
  (`reconciliacaoPonto.js` + `usePlanejamentos`), badge coral "Ajustado pelo
  Ponto" (comum.js/Lancamentos/VisaoGeral). Badge vermelho "Atrasado" para
  previsto com data no passado (precedência sobre "Disponível"). Seletor
  **Entrada/Despesa** no formulário recorrente (`permiteTipoOp`; Condomínio/
  DAS-MEI seguem Saída fixa). Tag "n/N" e mês removidas também para origem
  `jornada`. Configurações → Contas sem saldo nem marcação de ativa. Design
  flat: remoção de sombras e do anel de foco no clique. Refino do design system
  (tokens, tipografia, Login, navegação, modal).
