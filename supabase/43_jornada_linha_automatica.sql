-- ============================================================================
-- MIGRATION 43 — entrada semanal do Ponto vira LINHA AUTOMÁTICA (19/10/2026)
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. IDEMPOTENTE e
-- seguro de reexecutar (o WHERE só pega quem ainda tem serie_id).
--
-- CONTEXTO: a entrada semanal do Ponto deixou de ser uma SÉRIE materializada no
-- Planejamento (modo Recorrente→Semanal→"Vincular ao Ponto"). Agora cada semana
-- de trabalho é UMA linha INDEPENDENTE, criada/reajustada sozinha pelo valor
-- fechado do Ponto (usePlanejamentos.sincronizarSemanasJornada), com o mesmo
-- comportamento de cartão/condomínio. A linha guarda a semana ISO de TRABALHO
-- que paga (ano_semana_trabalho/semana_trabalho — migration 28), o que permite
-- deduplicar por semana e exibir a legenda "Semana X/2026".
--
-- O QUE FAZ: DESVINCULA o histórico — as linhas origem='jornada' deixam de
-- pertencer à série (serie_id/parcela_numero/total_parcelas = NULL). Assim as
-- ações "Cancelar série"/"Excluir série" (que operam por serie_id) NÃO alcançam
-- mais semanas independentes. NADA é apagado: valores, estados, datas, conta e
-- categoria permanecem intactos. serie_id não tem FK (migration 09), então
-- zerar a etiqueta não quebra nada e as linhas seguem válidas como avulsas.
--
-- TESTES no fim do arquivo (bloco DO autocontido que se limpa).
-- ============================================================================

update public.planejamentos
   set serie_id = null,
       parcela_numero = null,
       total_parcelas = null
 where origem = 'jornada'
   and serie_id is not null;

-- ============================================================================
-- TESTES (bloco DO autocontido: cria cenário temporário, valida e LIMPA tudo;
-- se qualquer assert falhar, a transação aborta e nada residual permanece)
-- ============================================================================
do $$
declare
    v_jornada   uuid;
    v_manual    uuid;
    v_serie     uuid := gen_random_uuid();
    v_row       record;
begin
    -- O SQL Editor roda como postgres (sem JWT): auth.uid() viria NULL e o
    -- INSERT falharia (erro 23502). Fixa o claim para o usuário mais antigo,
    -- valendo SÓ nesta transação (apaga-se sozinho no fim do bloco).
    perform set_config('request.jwt.claim.sub',
        (select id::text from auth.users order by created_at limit 1), true);
    if auth.uid() is null then
        raise exception 'TESTES 43: nenhum usuário em auth.users.';
    end if;

    -- T1: linha origem='jornada' COM série → a instrução da migration desvincula.
    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
         ano_semana, semana, serie_id, parcela_numero, total_parcelas,
         ano_semana_trabalho, semana_trabalho)
    values
        (auth.uid(), 'Entrada', 'TESTE_43_JORNADA', 100, current_date + 2,
         'previsto', 'jornada',
         extract(isoyear from current_date + 2)::smallint,
         extract(week from current_date + 2)::smallint,
         v_serie, 3, 10, 2026, 41)
    returning id into v_jornada;

    -- T2: linha avulsa (origem='manual') COM série NÃO pode ser afetada.
    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
         ano_semana, semana, serie_id, parcela_numero, total_parcelas)
    values
        (auth.uid(), 'Saida', 'TESTE_43_MANUAL', 50, current_date + 2,
         'previsto', 'manual',
         extract(isoyear from current_date + 2)::smallint,
         extract(week from current_date + 2)::smallint,
         v_serie, 1, 3)
    returning id into v_manual;

    -- Reexecuta a MESMA instrução da migration sobre o cenário de teste.
    update public.planejamentos
       set serie_id = null,
           parcela_numero = null,
           total_parcelas = null
     where origem = 'jornada'
       and serie_id is not null;

    select serie_id, parcela_numero, total_parcelas
      into v_row
      from public.planejamentos
     where id = v_jornada;
    if v_row.serie_id is not null
       or v_row.parcela_numero is not null
       or v_row.total_parcelas is not null then
        raise exception 'TESTES 43 T1: linha jornada continuou vinculada à série.';
    end if;

    select serie_id, parcela_numero, total_parcelas
      into v_row
      from public.planejamentos
     where id = v_manual;
    if v_row.serie_id is null
       or v_row.parcela_numero is null
       or v_row.total_parcelas is null then
        raise exception 'TESTES 43 T2: linha avulsa (manual) foi desvinculada por engano.';
    end if;

    -- Limpeza: remove o cenário de teste.
    delete from public.planejamentos where id in (v_jornada, v_manual);
    raise notice 'TESTES 43 OK: T1–T2 passaram; cenário limpo.';
end;
$$;
