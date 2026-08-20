# anperez-money — diário de bordo

Este arquivo vai crescer junto com o projeto. Cada vez que fecharmos uma
etapa, eu registro aqui o que foi feito e qual o próximo passo, pra você
sempre saber onde parou.

## Onde estamos

Projeto batizado: **anperez-money**.
Estrutura de pastas definida (veja `ESTRUTURA.md`).
Schema do banco criado no Supabase com sucesso (tabelas `contas` e
`movimentacoes`, RLS ativo).
`.gitignore` e `.env.example` criados, travando qualquer chave sensível
antes mesmo de existir uma linha de React.

Conexão com Supabase confirmada com sucesso.

Tela de Login/Cadastro criada (`src/pages/Login.jsx`), usando Supabase Auth.
Hook `useAuth` criado (`src/hooks/useAuth.js`), rastreando sessão em tempo
real. `App.jsx` agora decide entre Login e Dashboard com base nisso.
Dashboard ainda é um placeholder, só confirma o login e tem botão de sair.

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

Construir as telas de Contas e Movimentações de verdade, substituindo o
placeholder do Dashboard, já lendo e escrevendo no banco via Supabase.

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

---

## Etapa 01 — fundação do Git (18/08/2026)

### Objetivo
Eliminar o risco de vazar `.venv` (ambiente Python do projeto antigo) e
bancos locais para o GitHub, e criar o primeiro commit do projeto.

### Decisões
- `.gitignore` ganhou as seções "Ambientes locais" (`.venv/`, `venv/`,
  `env/`) e "Bancos de dados locais" (`*.db`, `*.sqlite`, `*.sqlite3`).
  Dados financeiros reais só devem viver no Supabase (com RLS) ou em
  backups fora do repositório, nunca no Git.
- Commit inicial `6aad0b8` criado e enviado para
  `https://github.com/andreperez27/anperez_money` (branch `master`).
- Problema de máquina resolvido: o `credential.helper` global apontava
  para `manager-core` (Git Credential Manager), que não está instalado.
  Ajustado para `wincred` (cofre de credenciais do Windows).

### Conceitos aprendidos
- Padrões de caminho no `.gitignore` (pasta `x/`, extensão `*.db`)
- Ciclo completo: `git status` → `git diff` → `git add` → `git commit` →
  `git push`
- `git check-ignore -v` para provar que arquivos sensíveis estão protegidos
- Auditoria de staging com `git grep --cached` buscando segredos
- `remote` vs `origin`; `git push -u` (upstream)
- `credential.helper` e o que é o cofre de credenciais do Windows

### Pendência registrada (para a etapa de deploy)
O repositório no GitHub se chama `anperez_money` (underscore), mas o
`vite.config.js` (base) e o `main.jsx` (basename) usam `/anperez-money/`
(hífen). Decisão de André: manter o underscore e ajustar o código na
etapa de deploy. Se o deploy for feito antes, o site quebra (CSS/JS 404).

### Próximo passo
Etapa 02: telas de Contas e Movimentações de verdade no Supabase,
substituindo o placeholder do Dashboard.

### Estado do banco original
`dados.db` (233 KB, 581 movimentações) preservado em
`C:\Users\andre\Desktop\contas\contabilidade total\App financeiro`.
Fonte futura de migração — não foi tocado.

---

## Etapa 02 — leitura de contas no Dashboard (18/08/2026)

### Objetivo
Dashboard deixou de ser placeholder e passou a listar as contas do
usuário logado, lidas do Supabase com RLS como única portaria.

### Arquivos
- `src/hooks/useContas.js` (novo) — busca centralizada com estados
  carregando/erro/dados e flag `ativo` no cleanup do useEffect.
- `src/pages/Dashboard.jsx` (modificado) — renderiza os 4 estados da
  tela (carregando, erro, vazio, lista) e formata saldo com
  `Intl.NumberFormat` (pt-BR).
- `DIARIO_DE_BORDO.md` (este registro).

### Decisões e lições
- A consulta NÃO filtra `user_id` no código: quem garante o isolamento
  é o RLS (política com `auth.uid()`), aplicado no banco a cada
  requisição. Filtro no cliente seria redundante, mascararia falha de
  RLS e criaria falsa sensação de segurança.
- Conceito importante: `auth.uid()` lê a variável de sessão
  `request.jwt.claim.sub`, injetada pelo PostgREST quando a requisição
  passa pela API com um JWT. No SQL Editor (papel `postgres`, acesso
  administrativo direto, ignora RLS) essa variável NÃO existe → o
  primeiro INSERT de teste falhou com NULL em `user_id` (barrado pela
  constraint NOT NULL — sorte que existe). Correção: id explícito via
  `select id, email from auth.users;`.
- Banco alterado com autorização: 2 contas fictícias de teste
  (`Teste Carteira` R$ 150,75 e `Teste Banco` R$ 2.500,00) para o
  user `6596eb4e-7fcf-4bc2-b340-ec43af57cfcb`
  (andre.270378@gmail.com). Removíveis com
  `delete from contas where nome like 'Teste %';`.
- Testes: `npm run build` OK; lista renderizada corretamente com
  formato monetário brasileiro; estado vazio OK. Pendente de testar
  manualmente: estado de erro (remover internet e recarregar).

### Próximo passo
Etapa 03: criação de conta pelo app (escrita no banco via `.insert()`),
com as mesmas garantias de RLS (policy `with check`).

---

## Etapa 03 — criação de contas pelo app (18/08/2026)

### Objetivo
Formulário no Dashboard cria contas no Supabase; a lista atualiza na
hora. O `user_id` é preenchido pelo próprio Postgres (DEFAULT), e a
policy RLS `with check` é a garantia de que ninguém insere conta para
outro usuário.

### Banco (alterações autorizadas, reversíveis)
1. `alter table public.contas alter column user_id set default auth.uid();`
   — coluna passa a ser preenchida pelo banco no momento do insert
   (avaliando o JWT da conexão). Reversível: `drop default`.
2. `grant insert on public.contas to authenticated;` — verificou-se
   depois que os grants já existiam no projeto (padrão antigo do
   Supabase concede tudo a anon/authenticated). Verificação por
   `information_schema` confirmou: `column_default = auth.uid()` e
   `authenticated` com INSERT/SELECT etc.

### Conceito-chave da etapa
"Fazer o Postgres preencher" = **DEFAULT na coluna** (preenche), não a
policy (valida) nem o grant (abre a porta). Os três são complementares.
O DEFAULT funciona via API porque a conexão carrega o JWT; no SQL
Editor (papel postgres) continuaria NULL — mesma lição da Etapa 02.

### Arquivos
- `src/hooks/useContas.js` — função `carregar()` extraída (usada na
  montagem e após criação) + `criarConta()`: insert SEM `user_id`,
  depois recarrega a lista.
- `src/pages/Dashboard.jsx` — formulário controlado (nome, tipo,
  saldo inicial), botão disabled durante envio, mensagens de
  sucesso/erro.
- `DIARIO_DE_BORDO.md` — este registro.

### Testes
- build: PASSOU (72 módulos, sem erro)
- criação normal pela UI: PASSOU — conta real "Nubank PJ" (R$ 158,69)
  criada pelo formulário, lista atualizou sem reload
- user_id nascido automaticamente: PASSOU — conferido por join com
  auth.users: a linha nasceu com andre.270378@gmail.com, sem o app
  enviar user_id (quem preencheu foi o DEFAULT auth.uid())
- teste negativo de adulteração pela API (with check): PASSOU — POST
  manual via fetch com user_id alheio respondeu `42501 new row
  violates row-level security policy for table "contas"`, e nenhuma
  linha foi criada em nenhuma das tentativas

### Observação de segurança (candidato a etapa futura)
Os grants do projeto concedem tudo (DELETE/TRUNCATE/UPDATE/etc.)
também para `anon`. Não é falha enquanto o RLS fecha a porta, mas o
princípio do menor privilégio sugere revogar de `anon` o que a app não
usa. Anotado, sem alteração nesta etapa.

---

## Etapa 04 — lançamentos com saldo mantido pelo banco (mês de referência: agosto/2026)

### Banco (alterações autorizadas, reversíveis)
1. `alter table public.movimentacoes alter column user_id set default
   auth.uid();` — mesmo padrão da Etapa 03. Verificado por
   information_schema: DEFAULT = auth.uid() e authenticated com INSERT.
2. Função `public.atualizar_saldo()` + trigger `trg_atualizar_saldo`
   (AFTER INSERT FOR EACH ROW): ajusta `saldo_atual` da conta
   registrada — Entrada soma, Saida subtrai — atomicamente com o
   insert (mesma transação). `security definer` + `set search_path =
   public`. Verificado em pg_trigger.
   Rollback: drop trigger / drop function / drop default.

### Decisão de arquitetura (por quê o trigger e não o app)
Duas chamadas separadas (insert + update) criam janela de
inconsistência: se o update falhar, saldo mente. O trigger roda na
mesma transação e o `saldo_atual = saldo_atual ± valor` é atômico
mesmo com clientes concorrentes. Pendência anotada: quando existirem
etapas de editar/excluir movimentação, o trigger precisará evoluir.

### Arquivos
- `src/hooks/useMovimentacoes.js` (novo) — busca das 10 recentes com
  embedding `.select('*, contas (nome)')` (join via PostgREST pela FK)
  + `criarMovimentacao()` (insert sem user_id).
- `src/hooks/useContas.js` — exposto `atualizar()`: recarrega contas
  após lançamento, porque o saldo muda no banco por fora do React.
- `src/pages/Dashboard.jsx` — formulário de movimentação (conta, tipo,
  valor, descrição, categoria opcional, data) e lista das recentes com
  cores (verde/vermelho) e data dd/mm/aaaa.

### Testes
- build: PASSOU (73 módulos)
- lançamento pela UI: PASSOU — Entrada de R$ 100,00 e Saída de
  R$ 50,00 criadas pelo formulário nas contas reais
- saldo pelo trigger: PASSOU — Nubank PJ partiu de R$ 158,69,
  somou 100 e subtraiu 50 (R$ 208,69), sem o React tocar no saldo
- user_id automático: PASSOU — as linhas apareceram no app logado
  (RLS só entrega linhas com o próprio user_id; DEFAULT preencheu)
- trio de redes de segurança (via API): PASSOU — 23514 (CHECK
  tipo_op), 23503 (FK conta inexistente), 42501 (RLS user_id alheio);
  nenhuma linha entrou

---

## Etapa 05 — navegação com React Router (18/08/2026)

### Objetivo
Organizar o app em rotas: / (resumo), /contas e /movimentacoes, com
layout compartilhado e proteção de rota reutilizando a sessão
existente. Sem alteração de banco, RLS, grants, trigger ou
comportamento financeiro — etapa de organização pura.

### Arquivos
- `src/lib/compartilhados.js` (novo) — estilos e formatadores
  compartilhados (valores idênticos aos inline da Etapa 04; zero
  mudança visual).
- `src/components/Layout.jsx` (novo) — moldura: header com menu
  (NavLink + isActive), e-mail, Sair (mesma lógica de antes) e
  <Outlet/>.
- `src/pages/Contas.jsx` (novo) — extração pura: form + lista de
  contas (useContas).
- `src/pages/Movimentacoes.jsx` (novo) — extração pura: form de
  lançamento + lista (useMovimentacoes + useContas + atualizar).
- `src/pages/Dashboard.jsx` (modificado) — virou resumo: saldo
  total (reduce), contagem de contas, links rápidos e 3 últimas
  movimentações.
- `src/App.jsx` (modificado) — <Routes> real: /login pública com
  guardião SomenteDeslogado; "/" protegida por RequerLogin + Layout;
  rotas filhas index/contas/movimentacoes; catch-all "*".
- main.jsx INTACTO (BrowserRouter + basename já existiam).
- Hooks INTACTOS (não refatorados).

### Conceitos aprendidos
- <Routes>/<Route>, rota index, rotas filhas aninhadas, <Outlet/>
- <Navigate replace>, rota catch-all "*"
- NavLink (isActive) vs Link (navegação simples); prop "end"
- Rota protegida via wrapper reusando useAuth (UX) vs RLS
  (segurança real) — distinção validada por André na pergunta de
  verificação antes da implementação

### Testes
- build: pendente nesta escrita (confirmado ao fechar a etapa)
- suíte 1-12 definida pelo André (login, rotas, criações, trigger,
  logout, acesso direto sem sessão, refresh, menu): pendente

### Nota produção (registrada, fora do escopo)
No GitHub Pages, o refresh direto em /contas e /movimentacoes
exigirá SPA fallback (404 → index.html). Entra na etapa de deploy.

---

## Etapa 06 — hooks de cartões e caixinhas (19/08/2026)

### Objetivo
Criar os dois hooks que conectam as tabelas novas (`cartoes` e
`caixinhas`) ao app, seguindo exatamente o padrão dos hooks existentes
(`useContas`/`useMovimentacoes`): carregar() interno, useEffect com
flag "ativo", estados carregando/erro, atualização após criar e insert
sem user_id (DEFAULT auth.uid() preenche no banco). Etapa de
infraestrutura: nenhuma tabela, RLS, trigger ou página foi tocada.

### Verificação prévia (exigida pelo André)
Antes de escrever qualquer hook, confirmou-se que a migration
`supabase/02_schema_cartoes_caixinhas.sql` foi aplicada no projeto
Supabase REAL: consulta REST somente leitura (apikey anon) em
`/rest/v1/cartoes` e `/rest/v1/caixinhas` respondeu HTTP 200 (listas
vazias — RLS bloqueia leitura anônima, mas as relações existem). Sem
isso, os hooks só quebrariam em produção.

### Arquivos
- `src/hooks/useCartoes.js` (novo) — busca `cartoes` filtrando
  `.eq('conta_id', contaId)` e `.eq('ativo', true)`, ordenado por nome;
  `contaId` é parâmetro do hook (vem do contexto de conta ativa); sem
  conta selecionada (null/undefined) devolve lista vazia SEM chamar o
  Supabase; `criarCartao({ nome, limite, dia_fechamento,
  dia_vencimento })` insere com o conta_id do próprio hook (e recusa
  com erro claro se não houver conta selecionada).
- `src/hooks/useCaixinhas.js` (novo) — mesmo contrato, filtrando
  `caixinhas` por conta_id + ativa = true; `criarCaixinha({ nome,
  saldo, objetivo })` omite `objetivo` do payload quando vier vazio
  (banco grava NULL).
- `DIARIO_DE_BORDO.md` — este registro.

### Decisões
- Reexecução automática por troca de conta: o useEffect depende de
  `[contaId]` — trocar a conta ativa recarrega cartões/caixinhas dela
  sem recarregar a página.
- O guard "sem contaId não busca" evita uma consulta inútil (e um
  possível erro de FK vazia) toda vez que o app monta antes de o
  contexto de conta ativa decidir a conta.
- Padrão mantido fiel: RLS como única portaria de isolamento, insert
  sem user_id, flag "ativo" no cleanup.

### Testes
- build: PASSOU (78 módulos, sem erro)
- verificação remota de tabelas: PASSOU (HTTP 200 nas duas relações)
- Teste funcional pendente: criação de cartão/caixinha pela UI (as
  páginas ainda são placeholders — próxima etapa).

### Próximo passo
Tela de Cartões de Crédito (`/cartoes`) e Caixinhas (`/caixinhas`)
usando os hooks novos + o contexto de conta ativa para filtrar por
conta.

---

## Etapa 07 — conta ativa passa a isolar os dados (19/08/2026)

### Objetivo
O ContaAtivaContext já existia e funcionava como seletor visual no
cabeçalho, mas nada no app filtrava por ele — era decorativo. Nesta
etapa a troca de conta passou a isolar os dados de verdade, como um
app de banco troca de cartão/conta. Nenhuma alteração em RLS,
trigger de saldo ou nas tabelas cartoes/caixinhas.

### Arquivos
- `src/hooks/useMovimentacoes.js` (modificado) — passou a receber
  `contaId` como parâmetro e filtrar `.eq('conta_id', contaId)` na
  query; `contaId` null/undefined devolve lista vazia SEM chamar o
  Supabase (mesmo contrato dos hooks de cartões/caixinhas da Etapa
  06); efeito depende de `[contaId]`, então a troca de conta recarrega
  a lista automaticamente. Embedding `contas (nome)`,
  `criarMovimentacao` e o restante do padrão intactos.
- `src/pages/Movimentacoes.jsx` (modificado) — usa `useContaAtiva()`
  e passa `contaAtiva?.id` para o hook; o formulário perdeu o
  `<select>` livre de conta: a conta ativa aparece como texto
  informativo ("Conta: Nubank PJ — R$ ...") e o lançamento sempre cai
  nela; sem contas cadastradas, mostra mensagem com link "Ir para
  Contas" em vez do formulário; lista renderiza o nome da conta ativa
  no título da seção.
- `src/pages/Contas.jsx` (modificado) — continua listando TODAS as
  contas (tela é o gerenciador), mas a conta ativa é destacada: borda
  `#42A5F5` no item + selo "ativa" ao lado do nome.
- `DIARIO_DE_BORDO.md` — este registro.

### Decisões
- O lançamento passa pelo `contaAtiva.id` do contexto no momento do
  submit — impossível lançar em conta que não é a selecionada.
- A tela de Contas mantém visão completa de propósito (gerenciador),
  e o destaque visual usa o MESMO contexto do seletor do cabeçalho —
  nenhuma fonte duplicada de "qual é a ativa".

### Testes
- build: PASSOU (78 módulos)
- teste manual da Etapa 07 (feito por André): trocar de conta no
  seletor do cabeçalho deve trocar a lista de movimentações exibida
  (e o saldo informativo do formulário) — pendente de executar

### Próximo passo
Consumir a conta ativa nas telas de Cartões (`/cartoes`) e Caixinhas
(`/caixinhas`) usando os hooks da Etapa 06 — a primeira parte real
das telas novas.

---

## Etapa 07b — reorganização da navegação (19/08/2026)

### Objetivo
Fixar a dinâmica de navegação definida em conversa com o André:
TROCAR de conta (pílulas do cabeçalho) só muda o contexto — nunca
navega; ABRIR a conta ativa (cartão de saldo do Dashboard) leva ao
extrato daquela conta; GERENCIAR contas é ação rara e mora em
Configurações, não no menu de topo. Etapa de navegação pura: hooks,
tabelas e RLS intactos.

### Arquivos
- `src/components/Layout.jsx` (modificado) — menu reordenado para o
  uso real de app de banco: Início (/), Extrato (/movimentacoes),
  Cartão (/cartoes), Caixinhas (/caixinhas) e, separado por uma barra
  vertical, Configurações (/configuracoes). Saíram do menu: Dashboard
  (renomeado Início) e Contas (sem link — rota /contas continua
  funcionando por compatibilidade). Header ganhou flexWrap para telas
  estreitas.
- `src/pages/Configuracoes.jsx` (reescrito) — passou a abrigar a
  administração: seção de links para Relatórios e Ponto Inteligente
  (módulos de consulta menos frequente, fora do menu principal) +
  seção "Minhas Contas" que reaproveita o componente Contas.jsx
  inteiro (formulário + lista com selo da conta ativa).
- `src/pages/Dashboard.jsx` (modificado) — cartão de saldo da conta
  ativa como Link: toque → /movimentacoes (extrato da conta). Sem
  conta cadastrada, o cartão aponta para /configuracoes com o convite
  de cadastro. Dados reais já vêm do contexto; o design completo do
  cartão fica para a Etapa 11.

### Decisões
- "Contas" sai do menu mas a rota permanece (compatibilidade, sem
  link visível) — o caminho natural agora é Configurações → Minhas
  Contas.
- Relatórios e Ponto entram em Configurações como itens com link, não
  como páginas no menu principal.

### Testes
- build: PASSOU (78 módulos)
- manual (pendente): menu novo, cartão de saldo → extrato, seletor de
  conta continuando sem navegar

### Auditoria de contas (CONCLUÍDA em 19/08/2026)
Para limpar contas de teste sem risco: query read-only preparada
(contas + contagem de movimentacoes/cartoes/caixinhas vinculados,
lembrando que a FK é ON DELETE CASCADE). A anon key do .env.local não
enxerga nada (RLS) e não há service role no projeto — André rodou os
passos no SQL Editor e colou as saídas. Resultado:
- Candidatas identificadas (Passo 1): "Teste Carteira" (carteira,
  R$ 150,75) e "Teste Banco" (corrente, R$ 2.500,00) — as duas contas
  de teste documentadas na Etapa 02, ambas com 0 movimentações,
  0 cartões e 0 caixinhas vinculados.
- Exclusão (Passo 2, DELETE com guardas: só nomes de teste, Nubank%
  protegido, zero vínculos obrigatório, RETURNING como log) — saída:
  Teste Banco e Teste Carteira removidas. Nenhuma linha real tocada.
- Se uma das excluídas estivesse salva como conta ativa no
  localStorage, o ContaAtivaContext faria o fallback automático para a
  primeira conta ativa (comportamento já validado na Etapa 07).

### Próximo passo
Após a auditoria: excluir/renomear testes confirmados e seguir para
Cartões/Caixinhas reais (Etapa 08).

---

## Etapa 08 — conta ativa isolando dados (19/08/2026)

### Registro de entrega
O conteúdo desta etapa (filtro de movimentações por conta ativa +
isolamento real das telas) foi implementado no fluxo anterior e está
documentado nas entradas "Etapa 07 — hooks de cartões e caixinhas" e
"Etapa 07b — reorganização da navegação" acima. Confirmado nesta
entrada por inspeção do código e build verde:

1. `src/hooks/useMovimentacoes.js` — recebe `contaId` e filtra
   `.eq('conta_id', contaId)`; null → lista vazia sem chamar o
   Supabase; embedding `contas (nome)` e `criarMovimentacao` intactos.
2. `src/pages/Movimentacoes.jsx` — `useMovimentacoes(contaAtiva?.id)`;
   sem `<select>` de conta: conta ativa aparece como texto
   informativo no formulário; sem contas cadastradas, mensagem + link
   "Ir para Contas" em vez do formulário.
3. "Minhas Contas" em `Configuracoes.jsx` (via `Contas.jsx` movido na
   07b) — conta ativa destacada com borda `#42A5F5` + selo "ativa",
   usando o mesmo `useContaAtiva()`.

### Complemento (20/08/2026) — botão Extrato em Contas Correntes
- `src/pages/ContasCorrentes.jsx` — o botão "Extrato" (antes
  desabilitado com "em breve") foi ativado: `handleExtrato()` navega
  para `/movimentacoes` com a conta ativa do momento do clique (a
  página de extrato lê a MESMA fonte — `useContaAtiva()` — então não
  há estado a transportar, só navegar). Sem conta ativa, mostra a
  mensagem "Selecione uma conta primeiro (toque no card dela)" em vez
  de navegar; ganhou estilo próprio (`estilosAcao.ativo`) com
  `useNavigate` importado.

### Testes
- build: PASSOU (88 módulos)
- manual (pendente, executar por André):
  a) trocar de conta ativa tocando no card dela em Contas Correntes →
     ao abrir o Extrato, a lista de movimentações deve ser da conta
     selecionada (e o saldo informativo do formulário acompanha)
  b) trocar de conta nas pílulas do cabeçalho → a lista de
     movimentações em /movimentacoes deve trocar
  c) Extrato sem conta ativa → mensagem de aviso, sem navegar

---

## Etapa 09 — telas que cabem na tela, sem rolagem de página (20/08/2026)

### Objetivo
Todas as telas passaram a redimensionar para caber na viewport: a
página NUNCA rola; rolagem só existe dentro de áreas de texto longo
(listas) e, se o usuário der zoom no navegador, tudo amplia
proporcionalmente sem quebrar o encaixe.

### Mecanismo
- `src/styles/global.css` — classe `.tela-inteira`: altura = 100dvh
  (respeita a barra de endereço do celular, com 100vh de fallback),
  `overflow: hidden` (mata a rolagem de página) e flex em coluna.
- `src/components/CaberNaTela.jsx` (novo) — mede o conteúdo real
  (scrollWidth/Height, que ignoram transform) e aplica
  `transform: scale()` para caber em altura E largura disponíveis.
  transform não mexe no box de layout → medição estável, sem loop com
  o ResizeObserver (que re-mede quando o conteúdo muda de tamanho:
  formulários que abrem, listas que carregam, etc.). Prop `alinhamento`
  para telas que centralizam (Login) versus telas alinhadas ao topo.
- Locais onde foi aplicado: Layout (`<main>` envolve o Outlet,
  maxLargura 720), Dashboard (corpo, maxLargura 480) e Login (cartão,
  maxLargura 360, alinhamento center).
- `src/lib/compartilhados.js` — `lista` ganhou `maxHeight: 30vh` +
  `overflowY: auto` (texto longo rola DENTRO da lista, não a página);
  `conteudo` e `secao` com paddings/margens mais enxutos para as telas
  caberem com menos encolhimento.

### Complemento 2 (20/08/2026) — fonte da Contas menor e da Home maior
Ajustes finos de tamanho de texto nas duas telas principais:
- `src/components/CaberNaTela.jsx` — margem de segurança de 4px na
  altura + cálculo com floor (nunca arredonda para cima): com o encaixe
  perfeito o navegador cortava o último pixel da linha do rodapé da
  tela Contas; agora o texto final nunca encosta no corte.
- `src/pages/ContasCorrentes.jsx` — base da fonte reduzida para
  0.9rem (títulos, textos, botões e inputs herdam; valores fixos em
  rem como os cards do resumo continuam do mesmo tamanho) — a tela
  passar a caber com folga no rodapé.
- `src/pages/Dashboard.jsx` — base da fonte da tela inicial elevada
  para 1.05rem (saudação, cartão de saldo e cards do grid crescem um
  pouco; o encaixe continua automático).

---

## Etapa 10 — extrato estilo app antigo (20/08/2026)

### Objetivo
A tela de Movimentações virou um EXTRATO de verdade: abre mostrando os
10 últimos lançamentos da conta ativa (sem formulário ocupando a tela),
com seletor de período (Últimos 10 | Mês atual | Mês anterior |
Personalizado), resumo do período, saldo de abertura e o formulário de
lançamento escondido atrás de um botão flutuante.

### Arquivos
- `src/hooks/useMovimentacoes.js` (reescrito) — passa a receber UM
  objeto de filtros: `{ contaId, dataInicio, dataFim, limite }`;
  `carregar()` monta a query com `.gte('data', ...)` / `.lte('data',
  ...)` / `.limit(...)` conforme os filtros e o efeito depende de todos
  eles (trocar conta OU período recarrega sozinho). `criarMovimentacao`
  intacto (e recarrega com os filtros vigentes). Novo export
  `buscarSaldoAntesDe({ contaId, data })`: soma das movimentações com
  data ANTES de `data` (query enxuta: só tipo_op e valor) — o saldo de
  abertura do período.
- `src/components/SeletorPeriodo.jsx` (novo) — pílulas de período no
  estilo do app antigo + inputs de data quando "Personalizado".
- `src/pages/Movimentacoes.jsx` (reescrito) — extrato: título
  "Extrato · [conta]", badge "Conta ativa", seletor, cards de resumo
  (Entradas/Saídas/Saldo do período), linha "SALDO DE ABERTURA" no topo
  da lista (só quando o período tem início), lista com data ·
  descrição · categoria · valor colorido (verde/vermelho), e o
  formulário de lançamento em seção expansível via botão flutuante
  "＋ Nova movimentação" (canto inferior direito). Personalizado
  incompleto mostra aviso em vez da lista.
- `src/pages/ContasCorrentes.jsx` (modificado) — chamada do hook na
  assinatura nova (`{ contaId: contaAtiva?.id }`), só para o
  criarMovimentacao da tela.

### Decisões
- Meses: "Mês atual" vai do dia 1 até HOJE; "Mês anterior" do dia 1 ao
  último dia do mês anterior (datas ISO calculadas no front).
- Saldo de abertura calculado por query adicional (soma antes da data
  de início), e não a partir de saldo_atual: funciona independente do
  limite e do tamanho do período.
- Lista reaproveita `estilosComuns.lista` (maxHeight 30vh + rolagem
  interna) — período longo rola dentro da área, a página continua
  sem rolar.
- Resumo do período usa os lançamentos exibidos (nos períodos com
  data, isso é o período inteiro; em "Últimos 10", o resumo desses 10).

### Testes
- build: PASSOU (90 módulos)
- manual (pendente, executar por André):
  a) /movimentacoes → lista abre com os 10 últimos da conta ativa
  b) pílula "Mês atual" e "Mês anterior" → lista recarrega filtrada
  c) "Personalizado" com datas → lista filtrada; sem uma das datas →
     aviso
  d) resumo e saldo de abertura corretos conferindo com os valores
  e) trocar a conta ativa no cabeçalho → extrato troca de conta
  f) "＋ Nova movimentação" abre o formulário e lança na conta ativa

### Próximo passo
Investimento & Caixinhas e Cartões de Crédito reais (Etapa 11),
vivendo dentro de Contas Correntes e com a conta ativa filtrando.

---

## Etapa 11 — caixinhas completas: detalhe, guardar/resgatar e extrato (20/08/2026)

### Objetivo
As caixinhas deixaram de ser só cadastro: agora têm tela de detalhe
(estilo Nubank), ações Guardar/Resgatar movendo dinheiro entre a conta
corrente dona e a caixinha, e extrato próprio. Sem formulário livre —
só as duas ações de negócio.

### Banco — `supabase/03_caixinha_movimentacoes.sql` (RODAR NO SQL EDITOR)
- Tabela `caixinha_movimentacoes` (id, caixinha_id FK cascade, user_id,
  tipo check ['guardar','resgatar','rendimento'], valor > 0, descricao,
  data default current_date, criado_em) + índices + RLS (user_id) +
  grants.
- Função `caixinha_guardar(p_caixinha_id, p_conta_id, p_valor,
  p_descricao)` — security definer, search_path public, TUDO numa
  transação: valida caixinha (dona+conta+ativa, for update), valida
  conta e saldo suficiente, insere Saída na conta (trigger debita),
  credita a caixinha, registra o movimento.
- Função `caixinha_resgatar(...)` — espelho: valida saldo da caixinha,
  debita a caixinha, insere Entrada na conta (trigger credita), registra
  o movimento.
- Por que funções: Guardar/Resgatar mexem em 3 tabelas; duas chamadas
  separadas do app criariam janela de inconsistência (conta saindo sem
  caixinha creditar). A função é a MESMA filosofia do trigger de saldo:
  o Postgres garante a atomicidade, o front só chama o RPC e trata erro.

### Arquivos
- `src/hooks/useCaixinhas.js` — `guardar()`/`resgatar()` chamam os RPCs
  do banco com contaId do hook; `atualizar()` exposto; novo
  `useCaixinhaMovimentos(caixinhaId)` (lista ordenada data desc,
  criado_em desc, guard sem id → vazio).
- `src/pages/CaixinhaDetalhe.jsx` (novo) — rota protegida
  `/caixinhas/:id`: nome, total bruto em destaque, "Total líquido"
  (igual ao bruto — sem campo de rendimento ainda), botões
  Resgatar/Guardar/Extrato; formulário simples (valor obrigatório +
  descrição opcional) com validação de saldo ANTES (feedback rápido) e
  no banco (autoridade); extrato em seção expansível com data ·
  descrição · valor (verde guardar/rendimento, vermelho resgatar). Sem
  rendimento e sem programação/investimentos (não existem no schema).
- `src/pages/Caixinhas.jsx` (reescrito) — lista real das caixinhas da
  CONTA ATIVA, cards clicáveis (nome + saldo + meta) → `/caixinhas/:id`.
- `src/pages/ContasCorrentes.jsx` — linhas da seção consolidada de
  caixinhas viraram links para o detalhe.
- `src/App.jsx` — rota `/caixinhas/:id` (RequerLogin + Layout +
  ContaAtivaProvider).

### Regras de negócio validadas no banco (não só no front)
- Caixinha pertence a UMA conta (contas.validação por user_id +
  conta_id dentro da função; `for update` trava contra concorrência).
- Só caixinhas da conta ativa aparecem (hooks filtram conta_id; RLS
  filtra user_id).
- As funções só movimentam entre a conta DONA e a caixinha dela.
- Sem lançamento livre: o app não expõe insert genérico em caixinhas.

### Testes
- build: PASSOU (91 módulos)
- pendente de rodar no SQL Editor (André): `supabase/03_...sql` —
  ANTES disso, Guardar/Resgatar/Extrato respondem erro (função/tabela
  não existem no banco real; a lista e a criação continuam funcionando).
- manual (pendente): clicar numa caixinha abre o detalhe; Guardar debita
  a conta e credita a caixinha (e vice-versa); extrato mostra o
  histórico; trocar a conta ativa troca a lista; saldo insuficiente em
  cada lado é barrado com mensagem clara.

### Próximo passo
Cartões de Crédito reais (fatura, limite, dia de fechamento) — Etapa 12.

---

## Etapa 12 — editar/excluir lançamentos + script de migração do banco antigo (20/08/2026)

### Objetivo
Dois pedidos do André: (B) poder EDITAR e EXCLUIR lançamentos no extrato,
mantendo o saldo sempre coerente; (A) um script para migrar os dados do
app antigo (dados.db, SQLite) para o Supabase, com análise prévia,
idempotência e correção de saldos.

---

### PARTE B — Editar/Excluir no extrato

#### Banco — `supabase/03_triggers_editar_excluir_movimentacoes.sql` (RODAR NO SQL EDITOR)
- `atualizar_saldo()` foi evoluída para os 3 eventos no MESMO trigger:
  - INSERT: Entrada soma, Saída subtrai (comportamento da Etapa 04);
  - DELETE: REVERTE o efeito (Entrada subtrai, Saída soma de volta);
  - UPDATE: desfaz o efeito da linha ANTIGA e aplica o da NOVA; se a
    movimentação TROCOU de conta, desfaz na conta antiga e aplica na
    nova (dois updates). Só uma query é feita quando nada mudou de
    efeito (v_delta = 0).
- Trigger recriado: `after insert or update or delete on movimentacoes`.
- Rollback documentado no arquivo (rodar o SQL da Etapa 04 de novo).

#### Front
- `src/hooks/useMovimentacoes.js` — `editarMovimentacao(id, alteracoes)`
  (update por id) e `excluirMovimentacao(id)` (delete por id); ambos
  recarregam a lista com os filtros vigentes e limpam erro.
- `src/pages/Movimentacoes.jsx` — coluna "Ações" nova na tabela
  (grid 88px 1fr 92px 92px 78px): botões Editar/Excluir por linha.
  - Editar → o MESMO formulário da nova movimentação, pré-preenchido
    (título "Editar movimentação", botão "Salvar alterações", ✕ para
    cancelar); o handler decide entre criar e editar por `movEmEdicao`.
  - Excluir → confirma com window.confirm antes de chamar o hook.
  - Depois de editar/excluir: `atualizar()` (saldo do card) +
    `pulsoAbertura` (recalcula o saldo de abertura do período).
  - Movimentações com `categoria = 'caixinha'` (criadas pelas funções
    caixinha_guardar/resgatar) NÃO têm botões: mostram 🔒 com tooltip
    "gerencie pela caixinha" — edição direta quebraria o vínculo.

### Testes (Parte B)
- build: PASSOU (91 módulos, sem erro)
- pendente (André): rodar o SQL acima no SQL Editor; editar um valor/tipo
  e conferir o saldo; excluir e conferir o saldo; trocar a conta de um
  lançamento pelo banco (RPC) e conferir que os DOIS saldos ajustam;
  lançamento de caixinha sem botões de ação.

---

### PARTE A — Script de migração do banco antigo

#### `scripts/migrar_dados_antigos.py` (Python puro, sem dependências)
Fluxo em 3 passos, com o relatório em `scripts/relatorio_migracao.md`
(gerado na análise, já com os dados reais do dados.db):

1. **ANÁLISE** (padrão, só leitura local): lista o catálogo do SQLite,
   classifica as contas (ativa/inativa/caixinha/órfã), soma movimentações
   por conta, identifica transferências por PAR (mesma data+valor, Saída
   X e Entrada Y — o app antigo não preenche id_transferencia) e compara
   a soma do extrato com `saldos_conta`.
2. **IMPORTAR** (`--importar`): autentica no Supabase como o DONO dos
   dados (REST /auth/v1/token com email/senha — nenhuma operação com
   service_role; todas respeitam RLS). Cria contas ativas que faltarem
   (mapeia tipo "Conta Corrente"→"corrente"), insere movimentações em
   ORDEM CRONOLÓGICA, pulando as já existentes (idempotente por
   data+descricao+valor+tipo_op). Contas inativas/caixinhas ficam de
   fora por padrão (`--incluir-inativas` / `--incluir-caixinhas`).
3. **CORRIGIR SALDOS** (`--corrigir-saldos`): o histórico antigo é
   PARCIAL (soma do extrato ≠ saldo registrado — ver relatório), então
   fixa `saldo_atual` das contas ativas no valor de `saldos_conta` do
   app antigo (Nubank PJ R$ 2.315,06; Nubank PF R$ 1.214,83).

#### Achados da análise (relatorio_migracao.md)
- 582 movimentações (01/01 a 20/08/2026); 82 transferências = 41 pares.
- Bradesco MEI está `ativa=0`: fora da migração por padrão.
- Caixinhas antigas (APÊ/PJ/PF) têm gestão própria no app novo.
- Nenhuma transferência de conta inativa/caixinha impacta o saldo das
  contas ativas: a perna da conta ativa já está nas movimentações dela.
- Saldos: o extrato antigo não fecha com saldos_conta → a opção 3
  (corrigir saldo) é recomendada SEMPRE após o import.

### Como rodar (na máquina do André)
```
.venv\Scripts\python.exe scripts\migrar_dados_antigos.py            # 1. análise
.venv\Scripts\python.exe scripts\migrar_dados_antigos.py --importar  # 2. import (pede e-mail/senha)
.venv\Scripts\python.exe scripts\migrar_dados_antigos.py --corrigir-saldos  # 3. saldos
```

### Próximo passo
Cartões de Crédito reais (fatura, limite, dia de fechamento) — Etapa 13.

### Decisões
- Preferência por transform:scale em vez da propriedade CSS `zoom`
  (mais simples literalmente, porém não suportada em navegadores
  antigos/alguns engines e com métricas não padronizadas); transform
  tem comportamento de medição determinístico.
- A rolagem por zoom do navegador vira ampliação proporcional (a escala
  é relativa à tela) — o conteúdo continua cabendo ao dar zoom, que é a
  intenção da regra ("rolagem só em texto longo ou zoom").

### Complemento (20/08/2026) — preencher a tela, não só encaixar
A pedido do André, a escala deixou de ter teto 1: em telas grandes
(desktop/tablet) o conteúdo agora AMPLIA para ocupar toda a altura
disponível, sem espaço sobrando (e continua encolhendo quando não
cabe). Ajustes no `CaberNaTela`:
- fator = min(altura da tela/conteúdo, LARGURA da tela/conteúdo): o
  segundo termo garante que o ampliar nunca ultrapassa a largura real
  da tela (nada é cortado nas laterais);
- o palco (que corta o que sobra) passou a ser a tela INTEIRA, não a
  coluna de conteúdo — no Dashboard o `CaberNaTela` saiu de dentro de
  `corpo` (que virou só a coluna visual 480px) para envolver a página
  inteira;
- quando f > 1 o conteúdo ancora no topo (centralizar cortaria o cartão
  na metade do zoom);
- em telas mais estreitas que maxLargura o conteúdo reflui (largura
  100%) e o limite passa a ser só a altura — comportamento móvel
  preservado.

### Testes
- build: PASSOU (89 módulos)
- manual (pendente): em cada tela (Login, Dashboard, Contas Correntes,
  Movimentações, Configurações e placeholders) conferir que tudo cabe
  sem barra de rolagem, que listas longas rolam internamente e que o
  redimensionamento da janela reajusta a escala.
- manual Desktop (pendente): redimensionar a janela do navegador →
  conteúdo deve ampliar até preencher a altura (e encolher quando a
  janela fica pequena), sem cortes laterais.

### Próximo passo
Consumir o contexto de conta ativa nas telas de Cartões e Caixinhas
reais (Etapa 10), que viverão dentro de Contas Correntes.

---

## Etapa 07c — consolidação do menu principal (20/08/2026)

### Objetivo
Enxugar a navegação para o uso real: o menu do cabeçalho (Layout) passa
a listar apenas Início | Contas Correntes | Cartões | Configurações.
Extrato e Caixinhas saem do menu — agora vivem DENTRO de Contas
Correntes (o extrato é a seção "Extrato" e as caixinhas estão
disponíveis pelo botão de atalho da tela) — e a bottom navigation
(Home | Busca | Ajuda) do Dashboard, que era só visual, foi removida.
Os 3 ícones dela (`IconeHome`, `IconeBusca`, `IconeAjuda`) foram
apagados do `HomeCard.jsx`.

### Arquivos
- `src/components/Layout.jsx` (modificado) — menu agora tem Início,
  Contas Correntes (/contas), Cartões (/cartoes) e, após a barra
  separadora, Configurações. Saíram: Extrato, Cartão (sing.),
  Caixinhas e Contas (este já estava sem link desde a 07b).
- `src/pages/Dashboard.jsx` (modificado) — removida a bottom navigation
  fixa; o cartão da conta ativa agora abre /contas ("Abrir conta", não
  mais "Ver extrato") e a página perdeu o padding reservado à barra.
  Sem contas, o cartão continua convidando a ir a Configurações.
- `src/components/HomeCard.jsx` (modificado) — removidos os ícones da
  bottom nav (Home, Busca, Ajuda).
- `src/App.jsx` (modificado) — rota /contas agora renderiza a página
  `ContasCorrentes.jsx` (lista todas as contas em cards de dados vivos,
  com seções de caixinhas e atalho para lançar movimentação);
  comentário do mapa de rotas atualizado.
- `src/pages/ContasCorrentes.jsx` (modificado) — destructuring limpo no
  uso de `useCaixinhas` (só `criarCaixinha`, a lista exibida na seção é
  a consolidada).
- `DIARIO_DE_BORDO.md` — este registro.

### Decisões
- "/contas" deixa de ser compatibilidade muda: é o destino da seção
  principal do app. Transições pendentes: Contas (gestão) em
  Configurações e o placeholder Caixinhas (/caixinhas) vão ser unidos
  a esta tela nas próximas etapas.
- As rotas antigas (/movimentacoes, /caixinhas, /relatorios, /ponto)
  continuam funcionando sem link visível no menu enquanto as telas
  respectivas não são absorvidas.

### Testes
- build: PASSOU (88 módulos, sem erro)
- manual (pendente, executar por André): menu novo nas telas escuras;
  cartão do Dashboard abrindo /contas; ausência da barra de baixo.

### Próximo passo
Unificar a gestão de contas (hoje fragmentada entre Configurações e
ContasCorrentes) e consumir cá/cartões com o contexto de conta ativa
nas telas novas, consolidando em Contas Correntes o que hoje vive nos
placeholders.
