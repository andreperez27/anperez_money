-- ============================================================================
-- ETAPA 08 — Férias por INTERVALO (data início/fim) + saldo anual de 15 dias
-- ============================================================================
-- Como usar: SQL Editor do Supabase → cole o arquivo inteiro → Run.
-- Roda DEPOIS das migrations 22, 23 e 24 (tabelas do Ponto já existem).
-- Aditiva + migração de dados:
--   1) Cria public.ponto_ferias: UM registro por período de férias, com
--      data_inicio e data_fim (intervalo de um dia = início igual ao fim),
--      sem sobreposição entre períodos (exclusion constraint com btree_gist).
--   2) Copia para lá lançamentos 'ferias' herdados do modelo diário da
--      migration 22 (intervalos de 1 dia) e os REMOVE de ponto_excecoes —
--      férias deixa de ser exceção diária e passa a ser intervalo com
--      controle de saldo (15 dias por ano) feito no app.
--
-- user_id segue o padrão do projeto (default auth.uid(); hooks nunca enviam)
-- e a RLS isola por usuário, como nas demais tabelas.
-- ============================================================================

create extension if not exists btree_gist;

create table public.ponto_ferias (
    id          uuid          primary key default gen_random_uuid(),
    user_id     uuid          not null default auth.uid() references auth.users(id) on delete cascade,
    data_inicio date          not null,
    data_fim    date          not null,
    obs         text,
    criado_em   timestamptz   not null default now(),
    constraint ponto_ferias_intervalo_valido check (data_fim >= data_inicio),
    constraint ponto_ferias_sem_sobreposicao exclude using gist (
        user_id with =,
        daterange(data_inicio, data_fim, '[]') with &&
    )
);

comment on table public.ponto_ferias is
    'Férias por INTERVALO (início/fim; dia único = início igual a fim). Saldo de 15 dias/ano controlado no app; períodos não podem se sobrepor (exclusion constraint)';

create index idx_ponto_ferias_user on public.ponto_ferias(user_id);
create index idx_ponto_ferias_datas on public.ponto_ferias(data_inicio, data_fim);

alter table public.ponto_ferias enable row level security;

create policy "usuario_ve_e_edita_suas_ferias"
    on public.ponto_ferias
    for all
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Migra exceções 'ferias' (modelo diário antigo da migration 22) para
-- intervalos de 1 dia na nova tabela e limpa as exceções diárias.
insert into public.ponto_ferias (user_id, data_inicio, data_fim)
select user_id, data, data
from public.ponto_excecoes
where tipo = 'ferias';

delete from public.ponto_excecoes where tipo = 'ferias';