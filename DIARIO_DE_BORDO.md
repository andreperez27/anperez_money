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
