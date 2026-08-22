-- ============================================================================
-- FASE 7 — Exclusão física segura de transferências (Etapa 15)
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. ADITIVO e
-- seguro de reexecutar. Requer a Etapa 14 (06_transferencias.sql) aplicada.
--
-- Modelo decidido com o André:
--   * Transferência errada/teste = EXCLUÍDA de verdade, sem rastro:
--     as duas movimentações e o registro somem, saldos revertidos.
--   * A exclusão só existe pela RPC excluir_transferencia — atômica,
--     com lock ordenado das duas contas e GUC LOCAL próprio
--     (app.excluindo_transferencia). DELETE direto pelo cliente continua
--     bloqueado pelo guard.
--   * UPDATE em linha vinculada continua bloqueado INCONDICIONALMENTE
--     (não há edição parcial; "editar" na UI = excluir + relançar).
--
-- Fluxo da RPC: valida dono → trava as duas contas (ORDER BY id FOR UPDATE,
-- anti-deadlock e serialização contra criar_transferencia simultânea) →
-- abre o GUC local → DELETE das movimentacoes (trigger atualizar_saldo
-- reverte os dois saldos) → pós-condição (0 linhas restantes) → DELETE do
-- registro. Qualquer falha no meio = rollback TOTAL.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- GUARD: passa a reconhecer a flag de exclusão legítima (só no DELETE)
-- ----------------------------------------------------------------------------
create or replace function public.protege_movimentacao_transferida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        if new.transferencia_id is not null then
            -- 1) Flag transacional: só a RPC define, escopo LOCAL (some no
            --    commit/rollback; impossível vazar entre requisições).
            if current_setting('app.criando_transferencia', true) is distinct from 'sim' then
                raise exception 'Movimentação de transferência só pode ser criada pela operação de transferência.';
            end if;

            -- 2) Estrutura: a transferência precisa existir e pertencer ao
            --    mesmo dono da linha (cinturão extra além da flag).
            if not exists (
                select 1
                  from public.transferencias t
                 where t.id = new.transferencia_id
                   and t.user_id = new.user_id
            ) then
                raise exception 'Transferência correspondente não encontrada para esta movimentação.';
            end if;
        end if;
        return new;
    end if;

    if tg_op = 'UPDATE' then
        -- Edição individual segue IMPOSSÍVEL, sem exceção nenhuma.
        if old.transferencia_id is not null or new.transferencia_id is not null then
            raise exception 'Movimentação parte de uma transferência não pode ser editada individualmente.';
        end if;
        return new;
    end if;

    -- tg_op = 'DELETE': liberado APENAS dentro da RPC excluir_transferencia
    if old.transferencia_id is not null then
        if current_setting('app.excluindo_transferencia', true) is distinct from 'sim' then
            raise exception 'Movimentação parte de uma transferência não pode ser excluída individualmente.';
        end if;
        return old;
    end if;

    return old;
end;
$$;

-- O trigger já existe da Etapa 14; recriar a função basta (o CREATE TRIGGER
-- original aponta para o nome da função, não para o corpo).

-- ----------------------------------------------------------------------------
-- FUNÇÃO: excluir_transferencia
-- ----------------------------------------------------------------------------
create or replace function public.excluir_transferencia(
    p_transferencia_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user     uuid := auth.uid();
    v_origem   uuid;
    v_destino  uuid;
    v_restantes integer;
begin
    if v_user is null then
        raise exception 'Sessão sem usuário autenticado.';
    end if;

    if p_transferencia_id is null then
        raise exception 'Informe a transferência a ser excluída.';
    end if;

    -- Dono? RLS não protege função definer: validação manual obrigatória.
    select conta_origem_id, conta_destino_id
      into v_origem, v_destino
      from public.transferencias
     where id = p_transferencia_id
       and user_id = v_user;
    if not found then
        raise exception 'Transferência não encontrada.';
    end if;

    -- Mesma disciplina da criação: trava as duas contas em ordem
    -- determinística. Serializa contra outra exclusão ou uma criação
    -- simultânea tocando as mesmas contas (saldo consistente sempre).
    perform 1
       from public.contas
      where id in (v_origem, v_destino)
      order by id
        for update;

    -- GUC LOCAL: abre o portão do guard APENAS para o DELETE abaixo.
    perform set_config('app.excluindo_transferencia', 'sim', true);

    -- O trigger trg_atualizar_saldo reverte os dois saldos aqui dentro.
    delete from public.movimentacoes
     where transferencia_id = p_transferencia_id;

    -- PÓS-CONDIÇÃO (belt-and-suspenders): nada pode ter sobrado.
    select count(*)
      into v_restantes
      from public.movimentacoes
     where transferencia_id = p_transferencia_id;
    if v_restantes <> 0 then
        raise exception 'Pós-condição falhou na exclusão da transferência % — rollback completo aplicado.', p_transferencia_id;
    end if;

    delete from public.transferencias
     where id = p_transferencia_id
       and user_id = v_user;
end;
$$;

-- ----------------------------------------------------------------------------
-- PERMISSÕES: só authenticated executa (padrão do projeto)
-- ----------------------------------------------------------------------------
revoke all on function public.excluir_transferencia(uuid) from public;
grant execute on function public.excluir_transferencia(uuid) to authenticated;
