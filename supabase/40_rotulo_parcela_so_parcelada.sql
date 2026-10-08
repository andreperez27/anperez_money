-- ============================================================================
-- MIGRATION 40 — rótulo "(n/total)" SÓ para série parcelada (23/09/2026)
-- ============================================================================
-- A migration 37 passou a carimbar "(n/total)" na descrição da compra ao
-- realizar previsão de SÉRIE em cartão. A regra valia para QUALQUER série —
-- inclusive RECORRENTE mensal (ex.: Netflix virou "Netflix (2/24)"), onde o
-- contador não é parcela de dívida e só polui o extrato.
--
-- Decisão com André: o sufixo fica SÓ para série PARCELADA (origem <>
-- 'recorrente' — ex.: Seguro 4/10). Recorrente mensal realiza com a
-- descrição pura. Idêntica à 37 em todo o resto (só o passo 3b muda).
-- ============================================================================


drop function if exists public.realizar_planejamento_cartao(uuid, uuid, numeric, date);

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
    v_serie_id      uuid;
    v_parcela       integer;
    v_total_parcelas integer;
    v_origem        text;
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
    select descricao, valor, tipo_op, categoria, serie_id, parcela_numero, total_parcelas, origem
      into v_descricao, v_valor, v_tipo_op, v_categoria, v_serie_id, v_parcela, v_total_parcelas, v_origem
      from public.planejamentos
     where id = p_planejamento_id
       and user_id = v_user
       for update;

    if not found then
        raise exception 'Planejamento não encontrado ou não pertence ao usuário.';
    end if;

    -- 3b. Descrição da COMPRA: parcela de SÉRIE PARCELADA ganha o rótulo
    --     "(n/total)" no extrato do cartão (decisão 14/09/2026, restrita em
    --     23/09/2026). Recorrente mensal (origem='recorrente') realiza com a
    --     descrição pura — o contador (2/24) não é parcela e polui o extrato.
    --     A compra continua avulsa (n_parcelas=1): não há integração entre o
    --     parcelamento do Planejamento (serie_id/parcela_numero) e o do
    --     Cartões (criar_compra) — o rótulo é SÓ texto da descrição. Avulsa
    --     comum (serie_id nulo) segue sem parênteses, como antes.
    if v_serie_id is not null
       and v_parcela is not null
       and v_total_parcelas is not null
       and (v_origem is null or v_origem <> 'recorrente') then
        v_descricao := v_descricao
                       || ' (' || v_parcela::text || '/' || v_total_parcelas::text || ')';
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
    --    A descrição já carrega o rótulo "(n/total)" quando é parcela de
    --    série PARCELADA (passo 3b); a categoria da previsão é repassada
    --    (p_categoria) para a compra nascer já categorizada (migration 35).
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


-- ----------------------------------------------------------------------------
-- GRANTS
-- ----------------------------------------------------------------------------
revoke all on function public.realizar_planejamento_cartao(uuid, uuid, numeric, date) from public;
grant execute on function public.realizar_planejamento_cartao(uuid, uuid, numeric, date) to authenticated;

-- ============================================================================
-- RLS / TRIGGERS — NENHUMA ALTERAÇÃO NECESSÁRIA
--   • criar_compra (11/33) já insere em compras/parcelas como owner.
--   • planejamentos tem RLS própria (08); a RPC acessa como dono.
--   • Nenhuma movimentação/ajuste de saldo aqui (só o pagamento da fatura o faz).
-- ============================================================================
