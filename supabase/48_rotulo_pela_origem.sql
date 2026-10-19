-- ============================================================================
-- MIGRATION 48 — legenda pela CADEIA DE ORIGEM (19/10/2026)
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. IDEMPOTENTE.
--
-- CONTEXTO: a migration 47 tentou deduzir a semana de trabalho da nota
-- "Pendente (atraso da semana de DD/MM) - 7 dias", mas a nota carrega a data
-- do lançamento que gerou a pendência, não a semana de trabalho. Resultado:
-- pares com a MESMA legenda em semanas diferentes (ex.: 12/10 e 14/10 ambos
-- "semana 40"; 19/10 e 21/10 ambos "semana 41").
--
-- REGRA ESCOLHIDA pelo André (19/10/2026): a semana vem da CADEIA DE ORIGEM.
--   1) semana GRAVADA na própria linha (ano_semana_trabalho/semana_trabalho)
--      tem precedência;
--   2) senão, sobe por origem_atraso_id até a PRIMEIRA ocorrência com semana
--      gravada e usa essa semana. Ex.: 12/10 -> 07/10 -> 30/09 (semana 39).
--   Se a cadeia não tiver nenhuma semana gravada, a legenda não é alterada.
--
-- Só o TEXTO (descricao) muda; valor, estado, origem, datas e colunas de
-- trabalho ficam intactos (não mexe nas colunas para não afetar o rateio de
-- extras do relatório). Não toca 'historico_planilha'.
--
-- TESTES no fim do arquivo (bloco DO autocontido com dados sintéticos).
-- ============================================================================

with recursive base as (
    select p.id,
           p.semana_trabalho,
           p.origem_atraso_id,
           0 as nivel
      from public.planejamentos p
     where p.tipo_op = 'Entrada'
       and p.descricao like 'Pagamento da semana%'
),
cadeia as (
    -- nível 0: a própria linha
    select b.id as raiz_id,
           b.semana_trabalho,
           b.origem_atraso_id,
           b.nivel
      from base b
    union all
    -- sobe enquanto a linha corrente não tiver semana gravada
    select c.raiz_id,
           p.semana_trabalho,
           p.origem_atraso_id,
           c.nivel + 1
      from cadeia c
      join public.planejamentos p on p.id = c.origem_atraso_id
     where c.semana_trabalho is null
       and c.origem_atraso_id is not null
       and c.nivel < 32
),
resolvido as (
    -- a recursão para na primeira semana não nula, então só ela entra aqui
    select raiz_id,
           max(semana_trabalho) as semana
      from cadeia
     group by raiz_id
)
update public.planejamentos p
   set descricao = format('Pagamento da semana %s', r.semana)
  from resolvido r
 where p.id = r.raiz_id
   and r.semana is not null
   and p.descricao <> format('Pagamento da semana %s', r.semana);

-- ============================================================================
-- TESTES (cadeia sintética; assert aborta tudo)
-- ============================================================================
do $$
declare
    v_sem int;
begin
    -- T1: 1 -> 2(null) -> 3(39): resolve 39 (neta herda a avó).
    with recursive dados(id, semana, origem) as (
        values (1, null::smallint, 2::int),
               (2, null::smallint, 3::int),
               (3, 39::smallint, null::int)
    ),
    cadeia(raiz, semana, origem, nivel) as (
        select id, semana, origem, 0 from dados
        union all
        select c.raiz, d.semana, d.origem, c.nivel + 1
          from cadeia c
          join dados d on d.id = c.origem
         where c.semana is null and c.origem is not null and c.nivel < 32
    )
    select max(semana) into v_sem from cadeia where raiz = 1;
    if v_sem <> 39 then
        raise exception 'TESTES 48 T1: esperado 39, veio %', v_sem;
    end if;

    -- T2: 4 -> 5(40): resolve 40 (pai direto).
    with recursive dados(id, semana, origem) as (
        values (4, null::smallint, 5::int),
               (5, 40::smallint, null::int)
    ),
    cadeia(raiz, semana, origem, nivel) as (
        select id, semana, origem, 0 from dados
        union all
        select c.raiz, d.semana, d.origem, c.nivel + 1
          from cadeia c
          join dados d on d.id = c.origem
         where c.semana is null and c.origem is not null and c.nivel < 32
    )
    select max(semana) into v_sem from cadeia where raiz = 4;
    if v_sem <> 40 then
        raise exception 'TESTES 48 T2: esperado 40, veio %', v_sem;
    end if;

    -- T3: 6(37): a semana gravada na própria linha vence (nenhum ancestral).
    with recursive dados(id, semana, origem) as (
        values (6, 37::smallint, null::int)
    ),
    cadeia(raiz, semana, origem, nivel) as (
        select id, semana, origem, 0 from dados
        union all
        select c.raiz, d.semana, d.origem, c.nivel + 1
          from cadeia c
          join dados d on d.id = c.origem
         where c.semana is null and c.origem is not null and c.nivel < 32
    )
    select max(semana) into v_sem from cadeia where raiz = 6;
    if v_sem <> 37 then
        raise exception 'TESTES 48 T3: esperado 37, veio %', v_sem;
    end if;

    raise notice 'TESTES 48 OK: T1–T3 passaram.';
end $$;
