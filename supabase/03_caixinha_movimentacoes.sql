-- ============================================================================
-- FASE 3 — Histórico de movimentos das caixinhas + funções atômicas
-- ============================================================================
-- Como usar: igual aos arquivos anteriores — cole no SQL Editor do Supabase
-- e clique em Run. Este arquivo é ADITIVO: cria a tabela caixinha_movimentacoes
-- e as funções caixinha_guardar / caixinha_resgatar, sem mexer nas tabelas já
-- existentes (contas, movimentacoes, cartoes, caixinhas).
--
-- ATENÇÃO: se um dia você reexecutar o 02_schema_cartoes_caixinhas.sql
-- (que faz "drop table ... cascade" em caixinhas), a tabela criada aqui é
-- derrubada junto — reexecute ESTE arquivo depois.
--
-- Por que funções no banco (e não duas chamadas do app)?
-- Guardar = 3 alterações que PRECISAM ser atômicas: (1) saída na conta
-- corrente, (2) crédito na caixinha, (3) registro do movimento. Se duas
-- chamadas separadas falhassem no meio, a conta sairia sem a caixinha
-- creditar. A função roda as três na MESMA transação (tudo ou nada), com
-- validação de saldo e trava de linha (for update) contra concorrência.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABELA: caixinha_movimentacoes
-- ----------------------------------------------------------------------------
-- Cada linha é um movimento da caixinha: guardar (entrou dinheiro),
-- resgatar (saiu dinheiro) ou rendimento (futuro — crédito de rendimento).
-- Pertence à caixinha (on delete cascade) e ao usuário (user_id + RLS).

create table public.caixinha_movimentacoes (
    id          uuid primary key default gen_random_uuid(),
    caixinha_id uuid not null references public.caixinhas(id) on delete cascade,
    user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
    tipo        text not null check (tipo in ('guardar', 'resgatar', 'rendimento')),
    valor       numeric(12, 2) not null check (valor > 0),
    descricao   text,
    data        date not null default current_date,
    criado_em   timestamptz not null default now()
);

comment on table public.caixinha_movimentacoes is 'Histórico de movimentos das caixinhas (guardar, resgatar, rendimento)';

create index idx_caixinha_mov_caixinha on public.caixinha_movimentacoes(caixinha_id);
create index idx_caixinha_mov_user on public.caixinha_movimentacoes(user_id);

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.caixinha_movimentacoes enable row level security;

create policy "usuario_ve_apenas_seus_movimentos_caixinha"
    on public.caixinha_movimentacoes
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

grant select, insert, update, delete on public.caixinha_movimentacoes to authenticated;

-- ----------------------------------------------------------------------------
-- FUNÇÃO: caixinha_guardar
-- ----------------------------------------------------------------------------
-- Move dinheiro da conta corrente dona PARA a caixinha, atomicamente:
-- 1. valida caixinha (conta_id + user_id + ativa) e trava a linha
-- 2. valida conta (user_id + ativa) e trava a linha; confere saldo
-- 3. insere movimentação de Saída (o trigger trg_atualizar_saldo debita)
-- 4. atualiza o saldo da caixinha
-- 5. registra o movimento na caixinha
-- security definer: a função roda como o dono (postgres), ignorando RLS —
-- a validação manual de user_id/conta_id em cada passo é o que garante que
-- ninguém mexe em caixinha/conta alheia. search_path travado em public.

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
-- FUNÇÃO: caixinha_resgatar
-- ----------------------------------------------------------------------------
-- Espelho do guardar: tira dinheiro da caixinha e devolve PARA a conta
-- corrente dona, atomicamente (valida saldo da caixinha; Entrada na conta).

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