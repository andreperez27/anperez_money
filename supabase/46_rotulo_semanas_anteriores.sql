-- ============================================================================
-- MIGRATION 46 — rótulo das SEMANAS ANTERIORES do Ponto (19/10/2026)
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. IDEMPOTENTE.
--
-- CONTEXTO: as linhas automáticas de origem 'jornada' já foram renomeadas
-- (migration 45), mas sobraram lançamentos ANTIGOS com o rótulo legado
-- "Pagamento Semanal" em origens 'manual'/'recorrente' — sobras da série
-- semanal antiga. Esta migration substitui esse texto por
-- "Pagamento da semana N", derivando N da própria data do pagamento:
-- a semana de TRABALHO é a semana ISO ANTERIOR à data_prevista (mesma regra
-- de src/lib/reconciliacaoPonto.js -> semanaDeTrabalhoDaData).
--
-- Só o TEXTO muda: valor, estado, origem, datas e vínculos ficam intactos.
-- Não toca 'historico_planilha' (relatório histórico) nem nomes já ajustados.
--
-- TESTES no fim do arquivo (bloco DO autocontido que se limpa).
-- ============================================================================

update public.planejamentos
   set descricao = format(
           'Pagamento da semana %s',
           extract(week from (data_prevista - interval '7 days'))::int
       )
 where descricao = 'Pagamento Semanal'
   and origem in ('manual', 'recorrente', 'jornada')
   and data_prevista is not null;

-- ============================================================================
-- TESTES (bloco DO autocontido: valida a regra e LIMPA; assert aborta tudo)
-- ============================================================================
do $$
declare
    v_id   uuid;
    v_uid  uuid;
    v_desc text;
begin
    select id into v_uid from auth.users order by created_at limit 1;
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    if v_uid is null then
        raise exception 'TESTES 46: nenhum usuário em auth.users.';
    end if;

    -- T1: a regra deriva a semana de TRABALHO (ISO anterior) da data paga.
    -- 21/10/2026 (quarta) paga a semana 42.
    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
         ano_semana, semana)
    values
        (v_uid, 'Entrada', 'Pagamento Semanal', 1, date '2026-10-21',
         'previsto', 'manual',
         extract(isoyear from date '2026-10-21')::smallint,
         extract(week from date '2026-10-21')::smallint)
    returning id into v_id;

    update public.planejamentos
       set descricao = format(
               'Pagamento da semana %s',
               extract(week from (data_prevista - interval '7 days'))::int
           )
     where id = v_id;

    select descricao into v_desc from public.planejamentos where id = v_id;
    if v_desc <> 'Pagamento da semana 42' then
        raise exception 'TESTES 46 T1: esperado "Pagamento da semana 42", veio "%"', v_desc;
    end if;

    -- T2: não sobrou o rótulo legado nas origens tratadas.
    if exists (
        select 1
          from public.planejamentos
         where descricao = 'Pagamento Semanal'
           and origem in ('manual', 'recorrente', 'jornada')
    ) then
        raise exception 'TESTES 46 T2: ainda há "Pagamento Semanal" legado.';
    end if;

    -- Limpeza do cenário de teste.
    delete from public.planejamentos where id = v_id;
    raise notice 'TESTES 46 OK: T1–T2 passaram; cenário limpo.';
end $$;
