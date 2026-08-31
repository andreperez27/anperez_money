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
  dinâmica por cartão (real + previstos, sem dupla contagem).
- **Cartões de Crédito**: lista, fatura (real de `v_faturas`), lançar compra,
  extrato do cartão, fluxo de pagamento da fatura, migração do histórico do
  app antigo.

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
