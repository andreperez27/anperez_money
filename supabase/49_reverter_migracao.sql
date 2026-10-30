-- ============================================================================
-- MIGRATION 49 — reverter a migração explícita de atraso (30/10/2026)
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. IDEMPOTENTE.
--
-- CONTEXTO: o botão "Jogar p/ próx. semana" usa migrar_atraso (migration 38):
-- cria uma PENDÊNCIA filha (origem_atraso_id) na data nova e marca a origem
-- como 'migrado' com valor_pendente. Se a data foi calculada errada (ou o
-- usuário se arrependeu), não havia como desfazer.
--
-- reverter_migracao(p_origem_id):
--   • exige que a origem esteja 'migrado' (só o caminho explícito do botão);
--   • apaga a pendência filha SOMENTE se ela ainda estiver 'previsto'
--     (realizada/cancelada não é revertida — não desfazemos movimentação);
--   • devolve a origem para 'previsto' e zera valor_pendente.
-- Tudo numa transação; idempotência não se aplica (2ª chamada acusa que a
-- origem não está mais 'migrado'). Não toca 'historico_planilha'.
--
-- TESTES no fim do arquivo (bloco DO autocontido que cria e limpa o cenário).
-- ============================================================================

create or replace function public.reverter_migracao(
    p_origem_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user        uuid := auth.uid();
    v_orig        record;
    v_pend_id     uuid;
    v_pend_estado text;
begin
    if v_user is null then
        raise exception 'Sessão sem usuário autenticado.';
    end if;
    if p_origem_id is null then
        raise exception 'Informe a ocorrência de origem.';
    end if;

    select *
      into v_orig
      from public.planejamentos
     where id = p_origem_id
       and user_id = v_user
       for update;

    if not found then
        raise exception 'Planejamento não encontrado ou não pertence ao usuário.';
    end if;

    if v_orig.estado <> 'migrado' then
        raise exception 'Só é possível reverter uma ocorrência migrada (estado atual: %).',
            v_orig.estado;
    end if;

    select id, estado
      into v_pend_id, v_pend_estado
      from public.planejamentos
     where origem_atraso_id = p_origem_id
       and user_id = v_user
       for update;

    if v_pend_id is not null then
        if v_pend_estado <> 'previsto' then
            raise exception 'A pendência está % — não é possível reverter sem desfazer a realização.',
                v_pend_estado;
        end if;
        delete from public.planejamentos where id = v_pend_id;
    end if;

    update public.planejamentos
       set estado = 'previsto',
           valor_pendente = null
     where id = p_origem_id;

    return v_pend_id;
end;
$$;

revoke all on function public.reverter_migracao(uuid) from public;
grant execute on function public.reverter_migracao(uuid) to authenticated;

-- ============================================================================
-- TESTES (cenário sintético; assert aborta tudo e limpa no fim)
-- ============================================================================
do $$
declare
    v_uid       uuid;
    v_orig      uuid;
    v_pend      uuid;
    v_estado    text;
    v_vpend     numeric;
    v_sobrou    int;
begin
    select id into v_uid from auth.users order by created_at limit 1;
    if v_uid is null then
        raise exception 'TESTES 49: nenhum usuário em auth.users.';
    end if;
    perform set_config('request.jwt.claim.sub', v_uid::text, true);

    -- Limpeza de execuções anteriores.
    delete from public.planejamentos
     where user_id = v_uid and descricao in ('TESTE_49_ORIG', 'TESTE_49_PEND');

    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
         ano_semana, semana, valor_pendente)
    values
        (v_uid, 'Entrada', 'TESTE_49_ORIG', 10, date '2099-01-07', 'migrado',
         'manual', 2099, 2, 10)
    returning id into v_orig;

    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
         ano_semana, semana, origem_atraso_id)
    values
        (v_uid, 'Entrada', 'TESTE_49_PEND', 10, date '2099-01-14', 'previsto',
         'manual', 2099, 3, v_orig)
    returning id into v_pend;

    -- T1: reverter apaga a pendência e devolve a origem para 'previsto'.
    perform public.reverter_migracao(v_orig);

    select estado, valor_pendente into v_estado, v_vpend
      from public.planejamentos where id = v_orig;
    if v_estado <> 'previsto' then
        raise exception 'TESTES 49 T1: origem ficou %, esperado previsto', v_estado;
    end if;
    if v_vpend is not null then
        raise exception 'TESTES 49 T1: valor_pendente não foi zerado (%)', v_vpend;
    end if;

    select count(*) into v_sobrou
      from public.planejamentos where id = v_pend;
    if v_sobrou <> 0 then
        raise exception 'TESTES 49 T1: a pendência não foi apagada';
    end if;

    -- T2: reverter de novo acusa que a origem não está mais 'migrado'.
    begin
        perform public.reverter_migracao(v_orig);
        raise exception 'TESTES 49 T2: reverteu duas vezes.';
    exception
        when others then
            if position('Só é possível reverter' in sqlerrm) = 0 then
                raise;
            end if;
    end;

    -- Limpeza.
    delete from public.planejamentos where id = v_orig;
    raise notice 'TESTES 49 OK: T1–T2 passaram; cenário limpo.';
end $$;
