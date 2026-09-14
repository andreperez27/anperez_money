-- ============================================================================
-- ETAPA 06/P3 — MIGRATION 37: rótulo da parcela "(n/total)" na descrição da
-- compra gerada por realizar_planejamento_cartao
-- ============================================================================
-- Correção (14/09/2026): ao efetivar ("Lançar") uma PREVISÃO de SÉRIE
-- parcelada com direcionamento Cartão, a compra criada no módulo Cartões
-- nascia sempre com a descrição pura (ex.: "Seguro do carro - Mapfre") e
-- n_parcelas=1 — o extrato mostrava "1/1" em vez do número real da parcela
-- dentro da série (ex.: "4/10").
--
-- DECISÃO (não integrar os sistemas de parcelamento): a compra continua
-- avulsa (n_parcelas=1, como hoje); o parcelamento do Planejamento
-- (serie_id/parcela_numero) NÃO é convertido no parcelamento do Cartões
-- (criar_compra). A mudança é SÓ NO TEXTO da descrição: quando a previsão
-- tiver serie_id + parcela_numero + total_parcelas preenchidos, a compra
-- recebe " {descricao} ({n}/{total})",
-- ex.: "Seguro do carro - Mapfre (4/10)". Avulsa comum (serie_id nulo)
-- continua sem parênteses.
--
-- Não altera a tabela planejamentos nem a lógica de série; não reprocessa
-- compras já lançadas (backfill manual à parte se desejado).
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
    select descricao, valor, tipo_op, categoria, serie_id, parcela_numero, total_parcelas
      into v_descricao, v_valor, v_tipo_op, v_categoria, v_serie_id, v_parcela, v_total_parcelas
      from public.planejamentos
     where id = p_planejamento_id
       and user_id = v_user
       for update;

    if not found then
        raise exception 'Planejamento não encontrado ou não pertence ao usuário.';
    end if;

    -- 3b. Descrição da COMPRA: parcela de SÉRIE ganha o rótulo "(n/total)" no
    --     extrato do cartão (decisão 14/09/2026). A compra continua avulsa
    --     (n_parcelas=1): não há integração entre o parcelamento do
    --     Planejamento (serie_id/parcela_numero) e o do Cartões (criar_compra)
    --     — o rótulo é SÓ texto da descrição. Avulsa comum (serie_id nulo)
    --     segue sem parênteses.
    if v_serie_id is not null
       and v_parcela is not null
       and v_total_parcelas is not null then
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
    --    série (passo 3b); a categoria da previsão é repassada (p_categoria)
    --    para a compra nascer já categorizada (migration 35).
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