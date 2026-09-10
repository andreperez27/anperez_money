-- ============================================================================
-- MIGRATION 35 — CATEGORIA NOS PLANEJAMENTOS
-- ============================================================================
-- Motivação (achado 10/09/2026): a realização de um planejamento gravava
-- categoria 'planejamento' FIXO na movimentação (migration 16), porque a
-- tabela planejamentos não tinha categoria própria. Resultado: todo
-- lançamento realizado (ex.: "Condomínio 2026/09" R$1.463,59) caía em
-- 'planejamento' no relatório "Por categoria" / PDF — fora da lista fechada
-- de categorias (src/lib/categorias.js) e agrupado em 'Outros'.
--
-- Decisões (10/09/2026, com André):
--   1. NOVA coluna planejamentos.categoria (text, nullable) — o atributo é
--      da PREVISÃO; o seletor fechado manda o valor canônico (mesma lista
--      das compras/movimentações). NULL = planejamento sem categoria.
--   2. RPC realizar_planejamento: passa a copiar planejamentos.categoria
--      para a movimentação gerada. Quando o planejamento não tem categoria,
--      a movimentação nasce SEM categoria (NULL) — nunca mais o marcador
--      'planejamento'. O relatório (relatorioPdf.js) já trata vazio/null
--      como agrupamento "Sem categoria" (decisão 10/09/2026).
--   3. RPC realizar_planejamento_cartao: repassa a categoria do
--      planejamento para criar_compra (que já aceita p_categoria desde a
--      migration 33), para a compra de cartão nascer já categorizada.
--
-- Correção retroativa (atribuir categoria às séries existentes) é um passo
-- SEPARADO (com André definindo a categoria de cada série) — NÃO está aqui.
--
-- Idempotente: add column if not exists + create or replace function.
-- ============================================================================

alter table public.planejamentos
    add column if not exists categoria text;

comment on column public.planejamentos.categoria is
    'Categoria canônica do planejamento (lista fechada src/lib/categorias.js); NULL = sem categoria. Copiada para a movimentação (realizar_planejamento) ou compra (realizar_planejamento_cartao) na realização. Migration 35';


-- ============================================================================
-- 1. RPC: realizar_planejamento (migration 16) — copia a categoria
-- ============================================================================

drop function if exists public.realizar_planejamento(uuid, uuid);
drop function if exists public.realizar_planejamento(uuid, uuid, numeric, date);

create or replace function public.realizar_planejamento(
    p_planejamento_id uuid,
    p_conta_id        uuid,
    p_valor_real      numeric default null,
    p_data_realizacao date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user        uuid := auth.uid();
    v_data        date := coalesce(p_data_realizacao, current_date);
    v_descricao   text;
    v_valor       numeric(12, 2);
    v_tipo_op     text;
    v_categoria   text;
    v_mov_id      uuid;
begin
    -- 1. Autenticação
    if v_user is null then
        raise exception 'Sessão sem usuário autenticado.';
    end if;

    -- 2. Validações paramétricas básicas
    if p_planejamento_id is null then
        raise exception 'Informe o planejamento a realizar.';
    end if;
    if p_conta_id is null then
        raise exception 'Informe a conta de destino.';
    end if;

    -- 3. Previsão a realizar (FOR UPDATE — lock determinístico bloqueia
    --    uma segunda realização concorrente da mesma linha antes do UPDATE).
    select descricao, valor, tipo_op, categoria
      into v_descricao, v_valor, v_tipo_op, v_categoria
      from public.planejamentos
     where id = p_planejamento_id
       and user_id = v_user
       for update;

    if not found then
        raise exception 'Planejamento não encontrado ou não pertence ao usuário.';
    end if;

    -- 4. Só 'previsto' realiza. 'realizado' já tem lançamento (nunca
    --    re-executa — idempotência); 'cancelado' não volta à vida aqui.
    --    Para isso basta reler o estado da linha travada no passo 3.
    if (select estado from public.planejamentos where id = p_planejamento_id) <> 'previsto' then
        raise exception 'Apenas previsões em estado "previsto" podem ser realizadas.';
    end if;

    -- 5. Conta de destino (FOR UPDATE — valida existência + propriedade +
    --    atividade, e trava a linha contra exclusão concorrente).
    perform 1
      from public.contas
     where id = p_conta_id
       and user_id = v_user
       and ativa = true
       for update;
    if not found then
        raise exception 'Conta de destino não encontrada, inativa ou não pertence ao usuário.';
    end if;

    -- 6. Valor efetivo da realização (padrão: o valor previsto).
    v_valor := coalesce(p_valor_real, v_valor);
    if v_valor is null or v_valor <= 0 then
        raise exception 'Valor da realização deve ser maior que zero.';
    end if;

    -- 7. Criar a movimentação real. O tipo_op da previsão (Entrada/Saida) é
    --    herdado — a trigger trg_atualizar_saldo soma/subtrai o saldo_da_conta
    --    automaticamente. A categoria vem da PRÓPRIA previsão (migration 35):
    --    NULL quando o planejamento não foi categorizado — o relatório trata
    --    como "Sem categoria", nunca como o marcador 'planejamento'.
    insert into public.movimentacoes
        (user_id, conta_id, data, descricao, valor, categoria, tipo_op)
    values
        (v_user, p_conta_id, v_data, v_descricao, v_valor, v_categoria, v_tipo_op)
    returning id into v_mov_id;

    -- 8. Marcar a previsão como realizada e vincular o lançamento. Como a
    --    função é uma única transação, se este UPDATE falhar o INSERT do
    --    passo 7 é desfeito junto — previsão e lançamento nunca ficam fora de
    --    sincronia. conta_destino_id é confirmado com a conta efetivamente usada.
    update public.planejamentos
       set estado = 'realizado',
           lancamento_id = v_mov_id,
           conta_destino_id = p_conta_id
     where id = p_planejamento_id;

    -- 9. Devolve o id do lançamento criado (feedback útil para a UI).
    return v_mov_id;
end;
$$;

revoke all on function public.realizar_planejamento(uuid, uuid, numeric, date) from public;
grant execute on function public.realizar_planejamento(uuid, uuid, numeric, date) to authenticated;


-- ============================================================================
-- 2. RPC: realizar_planejamento_cartao (migration 19) — repassa a categoria
-- ============================================================================

drop function if exists public.realizar_planejamento_cartao(uuid, uuid);

create or replace function public.realizar_planejamento_cartao(
    p_planejamento_id uuid,
    p_cartao_id       uuid,
    p_valor_real      numeric default null,
    p_data_compra     date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user          uuid := auth.uid();
    v_data          date := coalesce(p_data_compra, current_date);
    v_descricao     text;
    v_valor         numeric(12, 2);
    v_tipo_op       text;
    v_categoria     text;
    v_cartao_conta  uuid;
    v_compra_id     uuid;
begin
    -- 1. Autenticação
    if v_user is null then
        raise exception 'Sessão sem usuário autenticado.';
    end if;

    -- 2. Parâmetros básicos
    if p_planejamento_id is null then
        raise exception 'Informe o planejamento a realizar.';
    end if;
    if p_cartao_id is null then
        raise exception 'Informe o cartão de destino.';
    end if;

    -- 3. Previsão a realizar (FOR UPDATE — lock determinístico contra uma
    --    segunda efetivação concorrente da mesma linha, como na migration 16).
    select descricao, valor, tipo_op, categoria
      into v_descricao, v_valor, v_tipo_op, v_categoria
      from public.planejamentos
     where id = p_planejamento_id
       and user_id = v_user
       for update;

    if not found then
        raise exception 'Planejamento não encontrado ou não pertence ao usuário.';
    end if;

    -- 4. Só 'previsto' realiza (idempotente; 'cancelado' não reativa aqui).
    if (select estado from public.planejamentos where id = p_planejamento_id) <> 'previsto' then
        raise exception 'Apenas previsões em estado "previsto" podem ser realizadas.';
    end if;

    -- 5. Valor efetivo (padrão: o valor previsto).
    v_valor := coalesce(p_valor_real, v_valor);
    if v_valor is null or v_valor <= 0 then
        raise exception 'Valor da realização deve ser maior que zero.';
    end if;

    -- 6. A realização em cartão é de SAÍDA (despesa); receita não faz sentido.
    if v_tipo_op <> 'Saida' then
        raise exception 'A realização em cartão é válida apenas para despesas (Saida).';
    end if;

    -- 7. Validar o cartão (dono + ativo) e capturar a conta vinculada
    --    (lock determinístico, mesmo padrão do criar_compra/pagar_fatura).
    select c.conta_id
      into v_cartao_conta
      from public.cartoes c
     where c.id = p_cartao_id
       and c.user_id = v_user
       and c.ativo = true
       for update;

    if not found then
        raise exception 'Cartão não encontrado, inativo ou não pertence ao usuário.';
    end if;

    -- 8. Criar a compra no cartão reutilizando a RPC atômica criar_compra
    --    (migration 11/33) com n_parcelas=1 → à vista, UMA parcela na fatura.
    --    A categoria da previsão é repassada (p_categoria) para a compra
    --    nascer já categorizada (migration 35).
    v_compra_id := public.criar_compra(
        p_cartao_id,
        v_data,
        v_descricao,
        v_valor,
        1,
        v_categoria
    );

    -- 9. Marcar a previsão como realizada no cartão. lancamento_tipo='compra'
    --    informa que lancamento_id aponta para compras.id. Tudo na mesma
    --    transação: se este UPDATE falhar, a compra criada no passo 8 é
    --    desfeita junto (rollback).
    update public.planejamentos
       set estado = 'realizado',
           lancamento_tipo = 'compra',
           lancamento_id = v_compra_id,
           conta_destino_id = v_cartao_conta
     where id = p_planejamento_id;

    -- 10. Devolve o id da compra criada (feedback útil para a UI).
    return v_compra_id;
end;
$$;

revoke all on function public.realizar_planejamento_cartao(uuid, uuid, numeric, date) from public;
grant execute on function public.realizar_planejamento_cartao(uuid, uuid, numeric, date) to authenticated;