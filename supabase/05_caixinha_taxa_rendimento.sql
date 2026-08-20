-- ============================================================================
-- FASE 5 — Caixinhas: lançar TAXA e RENDIMENTO
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. ADITIVO e
-- seguro de reexecutar (create or replace + drop constraint if exists).
--
-- Modelo (conforme combinado):
--   * TAXA       (ex.: cobrança de R$ 0,52 na última retirada) debita SÓ
--                 o saldo da caixinha e registra o movimento tipo 'taxa'.
--                 NÃO cria lançamento na conta corrente.
--   * RENDIMENTO credita SÓ o saldo da caixinha, movimento tipo
--                 'rendimento'. Também sem lançamento na conta.
--   * p_data opcional: quando informada, o movimento usa ELA; quando
--     null, current_date (mesmo contrato de caixinha_guardar/resgatar).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TIPO 'taxa' no histórico (o 'rendimento' já existia)
-- ----------------------------------------------------------------------------
alter table public.caixinha_movimentacoes drop constraint if exists caixinha_movimentacoes_tipo_check;

alter table public.caixinha_movimentacoes add constraint caixinha_movimentacoes_tipo_check
    check (tipo in ('guardar', 'resgatar', 'rendimento', 'taxa'));

-- ----------------------------------------------------------------------------
-- FUNÇÃO: caixinha_taxa
-- ----------------------------------------------------------------------------
-- Mesma filosofia das demais: security definer + validação manual de
-- dono/conta, tudo na MESMA transação (trava a caixinha com for update,
-- confere saldo, debita e registra o movimento).
-- ----------------------------------------------------------------------------

create or replace function public.caixinha_taxa(
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
        raise exception 'Informe um valor maior que zero para a taxa.';
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

    -- 1) Sai da caixinha (a taxa não volta para a conta corrente)
    update public.caixinhas
       set saldo = saldo - p_valor
     where id = p_caixinha_id;

    -- 2) Registra o movimento da caixinha
    insert into public.caixinha_movimentacoes (caixinha_id, user_id, tipo, valor, descricao, data)
    values (p_caixinha_id, auth.uid(), 'taxa', p_valor, p_descricao, coalesce(p_data, current_date));
end;
$$;

-- ----------------------------------------------------------------------------
-- FUNÇÃO: caixinha_rendimento
-- ----------------------------------------------------------------------------

create or replace function public.caixinha_rendimento(
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
        raise exception 'Informe um valor maior que zero para o rendimento.';
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

    -- 1) Entra na caixinha (rendimento não passa pela conta corrente)
    update public.caixinhas
       set saldo = saldo + p_valor
     where id = p_caixinha_id;

    -- 2) Registra o movimento da caixinha
    insert into public.caixinha_movimentacoes (caixinha_id, user_id, tipo, valor, descricao, data)
    values (p_caixinha_id, auth.uid(), 'rendimento', p_valor, p_descricao, coalesce(p_data, current_date));
end;
$$;

-- ----------------------------------------------------------------------------
-- PERMISSÕES das funções: só o usuário autenticado pode chamar
-- ----------------------------------------------------------------------------
revoke all on function public.caixinha_taxa(uuid, uuid, numeric, text, date) from public;
grant execute on function public.caixinha_taxa(uuid, uuid, numeric, text, date) to authenticated;

revoke all on function public.caixinha_rendimento(uuid, uuid, numeric, text, date) from public;
grant execute on function public.caixinha_rendimento(uuid, uuid, numeric, text, date) to authenticated;