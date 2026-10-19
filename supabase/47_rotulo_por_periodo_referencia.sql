-- ============================================================================
-- MIGRATION 47 — legenda pelo PERÍODO DE REFERÊNCIA (19/10/2026)
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. IDEMPOTENTE.
--
-- CONTEXTO: a migration 46 rotulou os lançamentos antigos pela DATA DE
-- RECEBIMENTO (semana ISO anterior à data_prevista). Mas cada pagamento é
-- referente a uma SEMANA DE TRABALHO que deve acompanhar o Ponto — e essa
-- semana independe da semana em que o dinheiro caiu (pagamento atrasado).
--
-- REGRA (mesma do relatório "Recebido & horas", relatorioRecebidoHoras.js):
--   1) semana de trabalho GRAVADA na linha (ano_semana_trabalho/semana_trabalho,
--      o "referente" do relatório) — tem PRECEDÊNCIA;
--   2) senão, o PERÍODO DE REFERÊNCIA da nota de atraso
--      "Pendente (atraso da semana de DD/MM)": DD/MM é a SEGUNDA-FEIRA da
--      semana em que o pagamento era devido; a semana de TRABALHO é a semana
--      ISO ANTERIOR (data de referência - 7 dias), a mesma relação "paga-se a
--      semana passada" do Ponto.
--
-- Só o TEXTO (descricao) muda; valor, estado, origem, datas e colunas de
-- trabalho ficam intactos (não mexe nas colunas para não afetar o rateio de
-- extras do relatório). Não toca 'historico_planilha' (descrição própria).
--
-- TESTES no fim do arquivo (bloco DO autocontido que se limpa).
-- ============================================================================

with base as (
    select id,
           semana_trabalho,
           data_prevista,
           regexp_match(observacao, 'semana de (\d{2})/(\d{2})') as m
      from public.planejamentos
     where tipo_op = 'Entrada'
       and descricao like 'Pagamento da semana%'
),
calc as (
    select b.id,
           case
               -- (1) semana de trabalho já gravada manda.
               when b.semana_trabalho is not null then b.semana_trabalho
               -- (2) senão, deriva da segunda-feira da nota de atraso.
               when b.m is not null then extract(week from (
                        make_date(
                            extract(year from b.data_prevista)::int,
                            b.m[2]::int,  -- MM
                            b.m[1]::int   -- DD
                        ) - interval '7 days'
                    ))::int
               else null
           end as semana
      from base b
)
update public.planejamentos p
   set descricao = format('Pagamento da semana %s', c.semana)
  from calc c
 where p.id = c.id
   and c.semana is not null
   and p.descricao <> format('Pagamento da semana %s', c.semana);

-- ============================================================================
-- TESTES (bloco DO autocontido: valida a regra e LIMPA; assert aborta tudo)
-- ============================================================================
do $$
declare
    v_sem int;
    v_uid uuid;
begin
    select id into v_uid from auth.users order by created_at limit 1;
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    if v_uid is null then
        raise exception 'TESTES 47: nenhum usuário em auth.users.';
    end if;

    -- T1: período de referência "28/09" (segunda) → semana de TRABALHO anterior
    -- (21/09 = semana 39), independente da data de recebimento (07/10).
    select extract(week from (
               make_date(
                   extract(year from date '2026-10-07')::int,
                   (regexp_match('Pendente (atraso da semana de 28/09)',
                       'semana de (\d{2})/(\d{2})'))[2]::int,
                   (regexp_match('Pendente (atraso da semana de 28/09)',
                       'semana de (\d{2})/(\d{2})'))[1]::int
               ) - interval '7 days'
           ))::int
      into v_sem;
    if v_sem <> 39 then
        raise exception 'TESTES 47 T1: esperado 39, veio %', v_sem;
    end if;

    -- T2: semana de trabalho GRAVADA tem precedência sobre a nota
    -- (linha de 05/10 com semana_trabalho=38 fica 38, não 39).
    select case
               when t.semana_trabalho is not null then t.semana_trabalho
               when t.m is not null then extract(week from (
                        make_date(extract(year from t.data_prevista)::int,
                                  t.m[2]::int, t.m[1]::int) - interval '7 days'
                    ))::int
               else null
           end
      into v_sem
      from (
          select 38::smallint as semana_trabalho,
                 date '2026-10-05' as data_prevista,
                 regexp_match('Pendente (atraso da semana de 28/09)',
                     'semana de (\d{2})/(\d{2})') as m
      ) t;
    if v_sem <> 38 then
        raise exception 'TESTES 47 T2: esperado 38, veio %', v_sem;
    end if;

    raise notice 'TESTES 47 OK: T1–T2 passaram.';
end $$;
