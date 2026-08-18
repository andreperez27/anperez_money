-- ============================================================================
-- FASE 1 — Schema do MVP: contas + movimentacoes
-- ============================================================================
-- Como usar: entre no seu projeto Supabase, vá em "SQL Editor" (menu lateral),
-- cole este arquivo inteiro e clique em Run. Ele cria as duas tabelas do MVP
-- já com as regras de segurança (RLS) ativadas.
--
-- Se algo der errado no meio, pode rodar de novo sem medo: os comandos
-- "drop ... if exists" no topo limpam qualquer tentativa anterior antes de
-- recriar do zero.
-- ============================================================================

drop table if exists public.movimentacoes cascade;
drop table if exists public.contas cascade;


-- ----------------------------------------------------------------------------
-- TABELA: contas
-- ----------------------------------------------------------------------------
-- Equivalente à tabela "contas" do seu dados.db, com duas diferenças
-- importantes: o "id" agora é um uuid (padrão do Supabase, gerado
-- automaticamente, praticamente impossível de colidir) em vez de um inteiro
-- sequencial, e existe uma coluna "user_id" que não existia antes.
--
-- O user_id é o coração da segurança do app inteiro. Toda vez que alguém
-- fizer login, o Supabase Auth atribui um ID único (auth.uid()) a essa
-- sessão. Guardando esse ID em cada linha, conseguimos depois criar uma
-- regra que diz "só mostra essa linha pro dono dela". Sem essa coluna, não
-- teria como diferenciar seus dados dos de qualquer outra pessoa que um dia
-- crie conta no sistema.

create table public.contas (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    nome        text not null,
    tipo        text not null default 'corrente',
    saldo_atual numeric(12, 2) not null default 0,
    ativa       boolean not null default true,
    criado_em   timestamptz not null default now()
);

comment on table public.contas is 'Contas bancárias/carteiras do usuário (equivalente à tabela contas do dados.db)';


-- ----------------------------------------------------------------------------
-- TABELA: movimentacoes
-- ----------------------------------------------------------------------------
-- Equivalente à tabela "movimentacoes" do seu dados.db. A diferença principal,
-- como falei antes de gerar este arquivo: "conta" deixou de ser texto solto e
-- virou "conta_id", uma referência de verdade pra tabela contas. Isso tem um
-- efeito prático: se você tentar inserir uma movimentação apontando pra uma
-- conta que não existe, o banco recusa a operação sozinho. Hoje, no SQLite,
-- nada impede esse tipo de erro silencioso.

create table public.movimentacoes (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references auth.users(id) on delete cascade,
    conta_id            uuid not null references public.contas(id) on delete cascade,
    data                date not null,
    descricao           text not null,
    valor               numeric(12, 2) not null,
    categoria           text,
    tipo_op             text not null check (tipo_op in ('Entrada', 'Saida')),
    criado_em           timestamptz not null default now()
);

comment on table public.movimentacoes is 'Extrato de movimentações (equivalente à tabela movimentacoes do dados.db)';

-- Um índice na coluna de data acelera qualquer consulta que filtre por
-- período (ex.: "gastos de agosto"), que vai ser a consulta mais comum do
-- app. Sem índice, o banco teria que olhar linha por linha; com índice, ele
-- pula direto pro trecho certo, como o índice remissivo de um livro.
create index idx_movimentacoes_data on public.movimentacoes(data);
create index idx_movimentacoes_user on public.movimentacoes(user_id);


-- ============================================================================
-- ROW LEVEL SECURITY (RLS) — a parte que garante que seus dados são só seus
-- ============================================================================
-- Por padrão, uma tabela no Postgres não tem RLS ativado, o que significa
-- que qualquer chave de acesso válida (mesmo a anon key pública) consegue ler
-- e escrever livremente. Ativar RLS muda o comportamento padrão pra "negar
-- tudo, a menos que exista uma política explícita liberando".

alter table public.contas enable row level security;
alter table public.movimentacoes enable row level security;

-- Política pra "contas": cada usuário só pode enxergar e mexer nas próprias
-- linhas. O "using" controla o que aparece em SELECT/UPDATE/DELETE, e o
-- "with check" controla o que é permitido gravar em INSERT/UPDATE. Os dois
-- juntos garantem que ninguém lê OU escreve fora do próprio user_id, mesmo
-- que tente forçar isso manualmente na requisição.

create policy "usuario_ve_apenas_suas_contas"
    on public.contas
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "usuario_ve_apenas_suas_movimentacoes"
    on public.movimentacoes
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- A partir daqui, mesmo que alguém pegue sua anon key pública (que vai estar
-- visível no código do site, isso é normal e esperado), a única coisa que
-- essa pessoa consegue fazer sem estar logada como você é ver uma lista
-- vazia. É o banco de dados aplicando a regra, não o código React. Isso é
-- importante: a segurança não depende de "esconder" nada no front-end.
