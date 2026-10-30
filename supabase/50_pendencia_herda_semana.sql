-- ============================================================================
-- MIGRATION 50 — a pendência HERDA a semana de trabalho da origem (30/10/2026)
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. IDEMPOTENTE.
--
-- CONTEXTO (relatório "Recebido & Horas"): a linha aparece como
--   "29/10/2026 · Pagamento da semana 40 · R$ 2.050,00 · R$ 0,00"
-- em vez de
--   "29/10/2026 · referente ao período de 28/09/26 a 04/10/26 · R$ 2.050,00 · R$ 400,00"
--
-- CAUSA: o relatório monta o "referente ao período" e o rateio dos extras a
-- partir das COLUNAS GRAVADAS ano_semana_trabalho/semana_trabalho
-- (migration 28). Mas `migrar_atraso` (38) e a pendência da realização parcial
-- (realizar_planejamento) criam a linha filha SEM copiar essas colunas. A
-- migration 48 corrigiu só o TEXTO da descrição (pela cadeia de origem); as
-- colunas continuaram NULL → sem `referente`, o relatório cai no fallback
-- (mostra a descrição) e a semana não casa → extras R$ 0,00.
--
-- CORREÇÃO em duas frentes:
--   1. TRIGGER BEFORE INSERT: toda linha com `origem_atraso_id` herda a semana
--      de trabalho da CADEIA DE ORIGEM (mesma regra da 48: a semana gravada na
--      própria linha vence; senão sobe até a primeira ocorrência com semana).
--      Vale para migrar_atraso, para a pendência da realização parcial e para
--      qualquer caminho futuro — sem reescrever as RPCs.
--   2. BACKFILL das linhas já existentes com a mesma regra.
--
-- Só preenche coluna NULL: nada que já tenha semana gravada é sobrescrito.
-- Não mexe em descricao/valor/estado/datas. Não toca 'historico_planilha'
-- (essas linhas não têm origem_atraso_id).
--
-- TESTES no fim do arquivo (bloco DO autocontido que cria e limpa o cenário).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper: semana de trabalho resolvida pela cadeia de origem
-- ----------------------------------------------------------------------------
-- Devolve (ano, semana) da PRIMEIRA ocorrência da cadeia que tem semana
-- gravada (a própria linha primeiro). Sem semana em nenhum nível → nenhuma
-- linha. Função interna: só o trigger a chama (sem GRANT para o cliente).
create or replace function public.semana_trabalho_da_cadeia(p_id uuid)
returns table (ano smallint, semana smallint)
language sql
stable
security definer
set search_path = public
as $$
    with recursive cadeia as (
        select p.id,
               p.ano_semana_trabalho,
               p.semana_trabalho,
               p.origem_atraso_id,
               0 as nivel
          from public.planejamentos p
         where p.id = p_id
        union all
        select p.id,
               p.ano_semana_trabalho,
               p.semana_trabalho,
               p.origem_atraso_id,
               c.nivel + 1
          from cadeia c
          join public.planejamentos p on p.id = c.origem_atraso_id
         where (c.semana_trabalho is null or c.ano_semana_trabalho is null)
           and c.origem_atraso_id is not null
           and c.nivel < 32
    )
    select c.ano_semana_trabalho, c.semana_trabalho
      from cadeia c
     where c.semana_trabalho is not null
       and c.ano_semana_trabalho is not null
     order by c.nivel
     limit 1
$$;

revoke all on function public.semana_trabalho_da_cadeia(uuid) from public;

-- ----------------------------------------------------------------------------
-- 2. Trigger: a linha filha herda a semana de trabalho da origem
-- ----------------------------------------------------------------------------
create or replace function public.planejamentos_herda_semana_trabalho()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ano smallint;
    v_sem smallint;
begin
    if new.origem_atraso_id is not null
       and (new.semana_trabalho is null or new.ano_semana_trabalho is null) then
        select c.ano, c.semana
          into v_ano, v_sem
          from public.semana_trabalho_da_cadeia(new.origem_atraso_id) c;

        if v_sem is not null and v_ano is not null then
            new.ano_semana_trabalho := coalesce(new.ano_semana_trabalho, v_ano);
            new.semana_trabalho     := coalesce(new.semana_trabalho, v_sem);
        end if;
    end if;
    return new;
end;
$$;

revoke all on function public.planejamentos_herda_semana_trabalho() from public;

drop trigger if exists trg_planejamentos_herda_semana_trabalho
    on public.planejamentos;

create trigger trg_planejamentos_herda_semana_trabalho
    before insert on public.planejamentos
    for each row
    execute function public.planejamentos_herda_semana_trabalho();

-- ----------------------------------------------------------------------------
-- 3. Backfill das linhas que já existem sem a semana (pendências antigas)
-- ----------------------------------------------------------------------------
with alvo as (
    select p.id, c.ano, c.semana
      from public.planejamentos p
      cross join lateral public.semana_trabalho_da_cadeia(p.id) c
     where p.origem_atraso_id is not null
       and (p.semana_trabalho is null or p.ano_semana_trabalho is null)
       and c.semana is not null
       and c.ano is not null
)
update public.planejamentos p
   set ano_semana_trabalho = coalesce(p.ano_semana_trabalho, a.ano),
       semana_trabalho     = coalesce(p.semana_trabalho, a.semana)
  from alvo a
 where p.id = a.id;

-- ============================================================================
-- TESTES (cenário sintético; assert aborta tudo e limpa no fim)
-- ============================================================================
do $$
declare
    v_uid   uuid;
    v_avo   uuid;
    v_pai   uuid;
    v_filho uuid;
    v_ano   smallint;
    v_sem   smallint;
    v_proprio uuid;
    v_raiz2 uuid;
    v_qtd   int;
begin
    select id into v_uid from auth.users order by created_at limit 1;
    if v_uid is null then
        raise exception 'TESTES 50: nenhum usuário em auth.users.';
    end if;

    delete from public.planejamentos
     where user_id = v_uid and descricao like 'TESTE_50%';

    -- Avó COM semana gravada (39), pai e filho SEM (cadeia de 2 níveis).
    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
         ano_semana, semana, ano_semana_trabalho, semana_trabalho)
    values
        (v_uid, 'Entrada', 'TESTE_50_AVO', 10, date '2026-10-01', 'migrado',
         'manual', 40, 40, 2026, 39)
    returning id into v_avo;

    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
         ano_semana, semana, origem_atraso_id)
    values
        (v_uid, 'Entrada', 'TESTE_50_PAI', 10, date '2026-10-08', 'migrado',
         'manual', 41, 41, v_avo)
    returning id into v_pai;

    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
         ano_semana, semana, origem_atraso_id)
    values
        (v_uid, 'Entrada', 'TESTE_50_FILHO', 10, date '2026-10-15', 'previsto',
         'manual', 42, 42, v_pai)
    returning id into v_filho;

    -- T1: o trigger fez o PAI herdar 39 da avó (nível 1).
    select ano_semana_trabalho, semana_trabalho into v_ano, v_sem
      from public.planejamentos where id = v_pai;
    if v_sem is distinct from 39 or v_ano is distinct from 2026 then
        raise exception 'TESTES 50 T1: pai ficou %/%, esperado 2026/39', v_ano, v_sem;
    end if;

    -- T2: o FILHO herdou 39 do pai (nível 2 — a cadeia já resolvida).
    select ano_semana_trabalho, semana_trabalho into v_ano, v_sem
      from public.planejamentos where id = v_filho;
    if v_sem is distinct from 39 or v_ano is distinct from 2026 then
        raise exception 'TESTES 50 T2: filho ficou %/%, esperado 2026/39', v_ano, v_sem;
    end if;

    -- T3: a semana GRAVADA na própria linha vence (não é sobrescrita).
    -- Raiz própria: o índice único ux_planejamentos_origem_atraso permite só
    -- UM filho por origem, então não dá para reaproveitar a avó do T1.
    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
         ano_semana, semana, ano_semana_trabalho, semana_trabalho)
    values
        (v_uid, 'Entrada', 'TESTE_50_RAIZ2', 10, date '2026-10-01', 'migrado',
         'manual', 40, 40, 2026, 39)
    returning id into v_raiz2;

    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
         ano_semana, semana, ano_semana_trabalho, semana_trabalho, origem_atraso_id)
    values
        (v_uid, 'Entrada', 'TESTE_50_PROPRIO', 10, date '2026-10-22', 'previsto',
         'manual', 43, 43, 2026, 37, v_raiz2)
    returning id into v_proprio;
    select semana_trabalho into v_sem
      from public.planejamentos where id = v_proprio;
    if v_sem is distinct from 37 then
        raise exception 'TESTES 50 T3: ficou %, esperado 37 (própria semana vence)', v_sem;
    end if;

    -- T4: depois do backfill, nenhuma linha com origem_atraso_id continua sem
    -- semana quando a cadeia tem uma.
    select count(*) into v_qtd
      from public.planejamentos p
      cross join lateral public.semana_trabalho_da_cadeia(p.id) c
     where p.origem_atraso_id is not null
       and (p.semana_trabalho is null or p.ano_semana_trabalho is null)
       and c.semana is not null;
    if v_qtd > 0 then
        raise exception 'TESTES 50 T4: % linha(s) ainda sem semana após o backfill', v_qtd;
    end if;

    -- Limpeza.
    delete from public.planejamentos
     where user_id = v_uid and descricao like 'TESTE_50%';
    raise notice 'TESTES 50 OK: T1–T4 passaram; cenário limpo.';
end $$;
