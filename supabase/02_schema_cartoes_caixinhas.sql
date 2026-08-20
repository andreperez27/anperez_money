-- ============================================================================
-- FASE 2 — Schema de cartões de crédito + caixinhas (pockets de reserva)
-- ============================================================================
-- Como usar: igual ao 01_schema_contas_movimentacoes.sql — cole no SQL Editor
-- do Supabase e clique em Run. Este arquivo é ADITIVO: ele cria apenas as
-- tabelas novas (cartoes e caixinhas) e NÃO mexe nas tabelas contas e
-- movimentacoes que já estão em produção.
--
-- Conceito central: cada conta corrente é um universo isolado. O coração
-- disso é o par (user_id, conta_id): o RLS garante que ninguém enxerga nada
-- fora do próprio user_id, e a referência conta_id (com on delete cascade)
-- garante que cartões e caixinhas só existem atrelados a uma conta real.
--
-- Se algo der errado no meio, pode rodar de novo sem medo: os comandos
-- "drop ... if exists" no topo limpam qualquer tentativa anterior antes de
-- recriar do zero (mesmo padrão da Fase 1).
-- ============================================================================

drop table if exists public.caixinhas cascade;
drop table if exists public.cartoes cascade;


-- ----------------------------------------------------------------------------
-- TABELA: cartoes
-- ----------------------------------------------------------------------------
-- Cada cartão de crédito pertence a UMA conta corrente: o dinheiro que paga
-- a fatura sai dessa conta. Por isso o "conta_id" é obrigatório e com
-- on delete cascade — se a conta for eliminada, os cartões dela vão junto
-- (o app não pode ter cartão órfão apontando pra conta que não existe).
--
-- Campos de negócio:
--   limite        — limite total aprovado pelo banco (começa zerado; você
--                   ajusta quando for cadastrar o cartão real)
--   fatura_atual  — valor da fatura em aberto do mês atual. Nesta fase o app
--                   ainda não tem uma tabela de faturas, então este campo é
--                   mantido pelo próprio app; numa fase futura ele passará a
--                   ser derivado das faturas reais.
--   dia_fechamento / dia_vencimento — regras de fechamento da fatura, usados
--                   para calcular em que mês cada compra entra.
--   ativo         — "false" para cartão cancelado/pago sem apagar o histórico.

create table public.cartoes (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
    conta_id        uuid not null references public.contas(id) on delete cascade,
    nome            text not null,
    limite          numeric(12, 2) not null default 0,
    fatura_atual    numeric(12, 2) not null default 0,
    dia_fechamento  int,
    dia_vencimento  int,
    ativo           boolean not null default true,
    criado_em       timestamptz not null default now()
);

comment on table public.cartoes is 'Cartões de crédito de cada conta corrente (um cartão pertence a uma conta)';


-- ----------------------------------------------------------------------------
-- TABELA: caixinhas
-- ----------------------------------------------------------------------------
-- Caixinha = pocket de investimento/reserva criado dentro de UMA conta
-- corrente (ex.: "Caixinha PJ", "Caixinha APÊ"). O dinheiro investido não
-- deixa de existir: ele sai da conta e fica na caixinha, vinculada à mesma
-- conta — por isso também com on delete cascade em conta_id.
--
--   saldo     — quanto a caixinha tem investido hoje (match com o extrato
--               real do banco; nunca inventado por cálculo de CDI)
--   objetivo  — meta opcional da reserva (ex.: R$ 10.000,00); NULL = sem meta

create table public.caixinhas (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
    conta_id    uuid not null references public.contas(id) on delete cascade,
    nome        text not null,
    saldo       numeric(12, 2) not null default 0,
    objetivo    numeric(12, 2),
    ativa       boolean not null default true,
    criado_em   timestamptz not null default now()
);

comment on table public.caixinhas is 'Pockets de investimento/reserva vinculados a uma conta corrente';


-- ----------------------------------------------------------------------------
-- ÍNDICES
-- ----------------------------------------------------------------------------
-- As consultas mais comuns serão "cartões/caixinhas da conta X" e "dados do
-- usuário Y". Os dois índices abaixo aceleram exatamente esses dois filtros.
-- (O user_id também é usado pelo RLS em toda consulta, então indexá-lo ajuda
-- a segurança a ser barata em vez de cara.)

create index idx_cartoes_conta on public.cartoes(conta_id);
create index idx_cartoes_user on public.cartoes(user_id);
create index idx_caixinhas_conta on public.caixinhas(conta_id);
create index idx_caixinhas_user on public.caixinhas(user_id);


-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- Mesma filosofia da Fase 1: por padrão o Postgres deixaria qualquer chave
-- (inclusive a anon key pública do front-end) ler e escrever à vontade.
-- Ativar RLS inverte o padrão: nega tudo, e a política abaixo libera apenas
-- as linhas cujo user_id bate com o usuário autenticado (auth.uid()).

alter table public.cartoes enable row level security;
alter table public.caixinhas enable row level security;

-- Políticas idênticas às de contas/movimentacoes: "for all" cobre
-- SELECT/INSERT/UPDATE/DELETE de uma vez; "using" controla leitura/edição/
-- exclusão e "with check" controla gravação — juntos, ninguém lê nem
-- escreve fora do próprio user_id, mesmo forçando manualmente na requisição.

create policy "usuario_ve_apenas_seus_cartoes"
    on public.cartoes
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "usuario_ve_apenas_suas_caixinhas"
    on public.caixinhas
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Observação: o default auth.uid() nas colunas user_id é só uma mão na roda
-- para inserts feitos pelo app — a segurança REAL continua sendo o RLS, que
-- roda no banco e vale até para quem tentar contornar o front-end.