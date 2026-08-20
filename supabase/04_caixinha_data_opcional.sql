-- ============================================================================
-- FASE 3B — Caixinhas: campo Data opcional nos formulários Guardar/Resgatar
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. Este arquivo é
-- ADITIVO e SEGURO para reexecutar (create or replace): NÃO crie a tabela
-- caixinha_movimentacoes de novo (ela já existe — rodar o 03 inteiro de novo
-- dá erro 42P07 "relation already exists").
--
-- O que muda: caixinha_guardar e caixinha_resgatar ganham o parâmetro
-- p_data date default null. Quando a data é informada, o lançamento da
-- conta corrente E o movimento da caixinha usam ELA; quando é null
-- (chamada antiga), usa current_date como antes.
--
-- Se um dia o 03_caixinha_movimentacoes.sql for reexecutado inteiro (o
-- comentário dele diz que isso é seguro), estas funções voltam para a
-- versão SEM p_data — reexecute ESTE arquivo depois.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FUNÇÃO: caixinha_guardar (com p_data)
-- ----------------------------------------------------------------------------

create or replace function public.caixinha_guardar(
    p_caixinha_id uuid,
    p_conta_id    uuid,
    p_valor       numeric,
    p_descricao   text default null,
    p_data        date default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_nome          text;
    v_saldo_conta   numeric;
begin
    if p_valor is null or p_valor <= 0 then
        raise exception 'Informe um valor maior que zero para guardar.';
    end if;

    select nome into v_nome
      from public.caixinhas
     where id = p_caixinha_id
       and conta_id = p_conta_id
       and user_id = auth.uid()
       and ativa
     for update;

    if not found then
        raise exception 'Caixinha não encontrada para esta conta.';
    end if;

    select saldo_atual into v_saldo_conta
      from public.contas
     where id = p_conta_id
       and user_id = auth.uid()
       and ativa
     for update;

    if not found then
        raise exception 'Conta da caixinha não encontrada.';
    end if;

    if v_saldo_conta < p_valor then
        raise exception 'Saldo insuficiente na conta corrente (disponível: %).', v_saldo_conta;
    end if;

    -- 1) Sai da conta corrente (trigger debita o saldo_atual)
    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, categoria, tipo_op)
    values (p_conta_id, auth.uid(), coalesce(p_data, current_date),
            'Guardado na caixinha ' || v_nome, p_valor, 'caixinha', 'Saida');

    -- 2) Entra na caixinha
    update public.caixinhas
       set saldo = saldo + p_valor
     where id = p_caixinha_id;

    -- 3) Registra o movimento da caixinha
    insert into public.caixinha_movimentacoes (caixinha_id, user_id, tipo, valor, descricao, data)
    values (p_caixinha_id, auth.uid(), 'guardar', p_valor, p_descricao, coalesce(p_data, current_date));
end;
$$;

-- ----------------------------------------------------------------------------
-- FUNÇÃO: caixinha_resgatar (com p_data)
-- ----------------------------------------------------------------------------

create or replace function public.caixinha_resgatar(
    p_caixinha_id uuid,
    p_conta_id    uuid,
    p_valor       numeric,
    p_descricao   text default null,
    p_data        date default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_nome              text;
    v_saldo_caixinha    numeric;
begin
    if p_valor is null or p_valor <= 0 then
        raise exception 'Informe um valor maior que zero para resgatar.';
    end if;

    select nome, saldo into v_nome, v_saldo_caixinha
      from public.caixinhas
     where id = p_caixinha_id
       and conta_id = p_conta_id
       and user_id = auth.uid()
       and ativa
     for update;

    if not found then
        raise exception 'Caixinha não encontrada para esta conta.';
    end if;

    if v_saldo_caixinha < p_valor then
        raise exception 'Saldo insuficiente na caixinha (disponível: %).', v_saldo_caixinha;
    end if;

    -- 1) Sai da caixinha
    update public.caixinhas
       set saldo = saldo - p_valor
     where id = p_caixinha_id;

    -- 2) Entra na conta corrente (trigger credita o saldo_atual)
    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, categoria, tipo_op)
    values (p_conta_id, auth.uid(), coalesce(p_data, current_date),
            'Resgate da caixinha ' || v_nome, p_valor, 'caixinha', 'Entrada');

    -- 3) Registra o movimento da caixinha
    insert into public.caixinha_movimentacoes (caixinha_id, user_id, tipo, valor, descricao, data)
    values (p_caixinha_id, auth.uid(), 'resgatar', p_valor, p_descricao, coalesce(p_data, current_date));
end;
$$;

-- ----------------------------------------------------------------------------
-- PERMISSÕES das funções: só o usuário autenticado pode chamar
-- ----------------------------------------------------------------------------
revoke all on function public.caixinha_guardar(uuid, uuid, numeric, text, date) from public;
grant execute on function public.caixinha_guardar(uuid, uuid, numeric, text, date) to authenticated;

revoke all on function public.caixinha_resgatar(uuid, uuid, numeric, text, date) from public;
grant execute on function public.caixinha_resgatar(uuid, uuid, numeric, text, date) to authenticated;