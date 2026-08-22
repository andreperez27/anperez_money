-- ============================================================================
-- FASE 6 — Transferências entre contas próprias (Fluxo A)
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. ADITIVO e
-- seguro de reexecutar (create/drop if exists + add column if not exists):
-- não recria tabela nenhuma, não faz DROP CASCADE, não apaga dados.
--
-- Modelo (conforme ETAPA 05B autorizada):
--   * Tabela transferencias guarda a operação (com request_id UNIQUE para
--     idempotência: repetir o request NÃO cria segunda transferência).
--   * Cada transferência gera DUAS movimentações vinculadas por
--     transferencia_id: Saída na origem + Entrada no destino, categoria
--     'transferencia'. O trigger trg_atualizar_saldo ajusta os dois saldos.
--   * RPC criar_transferencia: atômica, SECURITY DEFINER, trava as duas
--     contas com FOR UPDATE em ORDEM DETERMINÍSTICA (anti-deadlock), valida
--     saldo SÓ DEPOIS dos locks e roda pós-condição de consistência antes
--     do retorno — qualquer falha = rollback completo.
--   * Guard trigger em movimentacoes: linhas com transferencia_id não podem
--     ser inseridas fora da RPC, nem editadas, nem excluídas individualmente.
--
-- O QUE ISTO NÃO FAZ: estorno (etapa futura via transferência espelho),
-- exclusão física, PIX/integração bancária, caixinhas ou cartões.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABELA: transferencias
-- ----------------------------------------------------------------------------
-- FKs de conta com ON DELETE RESTRICT (e não cascade): o histórico da
-- transferência protege as contas contra exclusão acidental. Hoje o app só
-- desativa contas (flag ativa), então este restrict nunca atrapalha o fluxo.
-- request_id UNIQUE é global entre usuários de propósito: uuid v4 gerado no
-- cliente torna colisão estatisticamente desprezível, e uma colisão hipotética
-- apenas REJEITA a operação (nunca corrompe nada).
create table if not exists public.transferencias (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references auth.users(id) on delete cascade,
    conta_origem_id  uuid not null references public.contas(id) on delete restrict,
    conta_destino_id uuid not null references public.contas(id) on delete restrict,
    valor            numeric(12, 2) not null check (valor > 0),
    data             date not null default current_date,
    descricao        text,
    request_id       uuid not null unique,
    criado_em        timestamptz not null default now(),
    constraint transferencia_contas_distintas check (conta_origem_id <> conta_destino_id)
);

comment on table public.transferencias is 'Transferências internas entre contas do próprio usuário (uma Saída na origem + uma Entrada no destino)';

create index if not exists idx_transferencias_user on public.transferencias(user_id);

alter table public.transferencias enable row level security;

create policy "usuario_ve_apenas_suas_transferencias"
    on public.transferencias
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- movimentacoes: coluna de vínculo com a transferência
-- ----------------------------------------------------------------------------
alter table public.movimentacoes
    add column if not exists transferencia_id uuid references public.transferencias(id) on delete restrict;

create index if not exists idx_movimentacoes_transferencia on public.movimentacoes(transferencia_id);

-- ----------------------------------------------------------------------------
-- GUARD: indivisibilidade das movimentações vinculadas
-- ----------------------------------------------------------------------------
-- INSERT: aceito apenas se veio da RPC (GUC local à transação marcado como
--         'sim') E a transferência correspondente existe e pertence ao MESMO
--         user_id da linha (validação estrutural — não confia só na flag).
-- UPDATE/DELETE: bloqueados incondicionalmente para qualquer linha com
--         transferencia_id (antigo ou novo). Movimentações comuns
--         (transferencia_id NULL → NULL) passam intocadas, igual hoje.
-- As RPCs de caixinha inserem com transferencia_id NULL e continuam
-- funcionando exatamente como antes.
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
        if old.transferencia_id is not null or new.transferencia_id is not null then
            raise exception 'Movimentação parte de uma transferência não pode ser editada individualmente.';
        end if;
        return new;
    end if;

    -- tg_op = 'DELETE'
    if old.transferencia_id is not null then
        raise exception 'Movimentação parte de uma transferência não pode ser excluída individualmente.';
    end if;
    return old;
end;
$$;

drop trigger if exists trg_protege_transferencia on public.movimentacoes;

create trigger trg_protege_transferencia
    before insert or update or delete on public.movimentacoes
    for each row execute function public.protege_movimentacao_transferida();

-- ----------------------------------------------------------------------------
-- FUNÇÃO: criar_transferencia
-- ----------------------------------------------------------------------------
-- Ordem interna (a ordem É a garantia):
--   1. Idempotência: request_id já usado → devolve a transferência existente.
--   2. Validações baratas (nulos, origem != destino, valor > 0).
--   3. LOCK DUPLO ORDENADO: UMA query trava as duas contas com ORDER BY id
--      FOR UPDATE — toda sessão adquire os locks na mesma sequência física,
--      eliminando deadlock AB-BA (ex.: A→B simultâneo com B→A).
--   4. Validações que dependem dos locks (dono via auth.uid(), ativa, saldo
--      suficiente). NADA é confiada ao frontend.
--   5. INSERT na transferencias; GUC local 'sim'; INSERTs das duas
--      movimentacoes (trigger atualizar_saldo ajusta os saldos).
--   6. PÓS-CONDIÇÃO antes do retorno: exatamente 2 linhas vinculadas, somas
--      Entrada e Saida ambas iguais ao valor (implica 1 Entrada + 1 Saída de
--      valores idênticos → diferença zero). Falhou? RAISE → rollback TOTAL.
-- ----------------------------------------------------------------------------

create or replace function public.criar_transferencia(
    p_conta_origem_id  uuid,
    p_conta_destino_id uuid,
    p_valor            numeric,
    p_data             date default null,
    p_descricao        text default null,
    p_request_id       uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user             uuid := auth.uid();
    v_request          uuid := coalesce(p_request_id, gen_random_uuid());
    v_transferencia_id uuid;
    v_data_efetiva     date := coalesce(p_data, current_date);
    v_nome_origem      text;
    v_nome_destino     text;
    v_saldo_origem     numeric;
    v_ativa_origem     boolean;
    v_dona_origem      uuid;
    v_ativa_destino    boolean;
    v_dona_destino     uuid;
    v_linhas           integer;
    v_entradas         numeric;
    v_saidas           numeric;
begin
    if v_user is null then
        raise exception 'Sessão sem usuário autenticado.';
    end if;

    -- 1) Idempotência: mesma requisição reenviada (rede instável, duplo
    --    toque) retorna a transferência JÁ criada, sem duplicar nada.
    select id into v_transferencia_id
      from public.transferencias
     where request_id = v_request
       and user_id = v_user;
    if found then
        return v_transferencia_id;
    end if;

    -- 2) Validações básicas
    if p_conta_origem_id is null or p_conta_destino_id is null then
        raise exception 'Informe a conta de origem e a conta de destino.';
    end if;

    if p_conta_origem_id = p_conta_destino_id then
        raise exception 'A conta de origem e a de destino devem ser diferentes.';
    end if;

    if p_valor is null or p_valor <= 0 then
        raise exception 'Informe um valor maior que zero para a transferência.';
    end if;

    -- 3) Lock duplo determinístico (anti-deadlock): as duas contas travadas
    --    numa única varredura ordenada por id.
    perform 1
       from public.contas
      where id in (p_conta_origem_id, p_conta_destino_id)
      order by id
        for update;

    -- 4) Validações PÓS-lock (dono / ativa / saldo)
    select nome, saldo_atual, ativa, user_id
      into v_nome_origem, v_saldo_origem, v_ativa_origem, v_dona_origem
      from public.contas
     where id = p_conta_origem_id;
    if not found then
        raise exception 'Conta de origem não encontrada.';
    end if;
    if v_dona_origem is distinct from v_user then
        raise exception 'A conta de origem não pertence ao usuário autenticado.';
    end if;
    if not v_ativa_origem then
        raise exception 'A conta de origem "%" está inativa.', v_nome_origem;
    end if;

    select ativa, user_id
      into v_ativa_destino, v_dona_destino
      from public.contas
     where id = p_conta_destino_id;
    if not found then
        raise exception 'Conta de destino não encontrada.';
    end if;
    if v_dona_destino is distinct from v_user then
        raise exception 'A conta de destino não pertence ao usuário autenticado.';
    end if;
    if not v_ativa_destino then
        raise exception 'A conta de destino está inativa.';
    end if;

    select nome into v_nome_destino
      from public.contas
     where id = p_conta_destino_id;

    if v_saldo_origem < p_valor then
        raise exception 'Saldo insuficiente em % (disponível: %).', v_nome_origem, v_saldo_origem;
    end if;

    -- 5) Gravação atômica
    insert into public.transferencias
        (user_id, conta_origem_id, conta_destino_id, valor, data, descricao, request_id)
    values
        (v_user, p_conta_origem_id, p_conta_destino_id, p_valor, v_data_efetiva,
         nullif(trim(coalesce(p_descricao, '')), ''), v_request)
    returning id into v_transferencia_id;

    -- GUC LOCAL à transação (some sozinha no commit/rollback): abre o
    -- portão do guard trg_protege_transferencia APENAS para os inserts abaixo.
    perform set_config('app.criando_transferencia', 'sim', true);

    insert into public.movimentacoes
        (conta_id, user_id, data, descricao, valor, categoria, tipo_op, transferencia_id)
    values
        (p_conta_origem_id, v_user, v_data_efetiva,
         'Transferência enviada para ' || v_nome_destino,
         p_valor, 'transferencia', 'Saida', v_transferencia_id),
        (p_conta_destino_id, v_user, v_data_efetiva,
         'Transferência recebida de ' || v_nome_origem,
         p_valor, 'transferencia', 'Entrada', v_transferencia_id);

    -- 6) PÓS-CONDIÇÃO (belt-and-suspenders): com count = 2 e soma de Entradas
    --    = soma de Saídas = valor, a ÚNICA composição possível é 1 Entrada +
    --    1 Saída, cada uma valendo exatamente o valor (diferença zero).
    select count(*),
           coalesce(sum(case when tipo_op = 'Entrada' then valor else 0 end), 0),
           coalesce(sum(case when tipo_op = 'Saida'   then valor else 0 end), 0)
      into v_linhas, v_entradas, v_saidas
      from public.movimentacoes
     where transferencia_id = v_transferencia_id;

    if v_linhas <> 2
       or v_entradas is distinct from p_valor
       or v_saidas   is distinct from p_valor then
        raise exception 'Pós-condição falhou na transferência % — rollback completo aplicado.', v_transferencia_id;
    end if;

    return v_transferencia_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- PERMISSÕES: só authenticated executa (padrão das demais RPCs do projeto)
-- ----------------------------------------------------------------------------
revoke all on function public.criar_transferencia(uuid, uuid, numeric, date, text, uuid) from public;
grant execute on function public.criar_transferencia(uuid, uuid, numeric, date, text, uuid) to authenticated;
