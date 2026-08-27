-- ============================================================================
-- ETAPA C2 (fluxo de pagamento) — MIGRATION 13: desfazer_pagamento
-- ============================================================================
-- Desfaz o pagamento de UMA fatura de cartão (equivalente ao "DESFAZER
-- PAGAMENTO" do app antigo / cartoes_extrato_screen.py).
--
-- O que a operação faz, de forma atômica:
--   1. Exclui todos os registros de `fatura_pagamentos` do cartão no mês —
--      isso remove a referência (FK on delete restrict) às movimentações e
--      a fatura volta a 'aberta'/'parcialmente_paga' (derivado pela
--      view v_faturas automaticamente).
--   2. Exclui as movimentações de SAÍDA vinculadas (pagar_fatura gravava
--      movimentacao_id nelas). A trigger trg_atualizar_saldo REVERTE o saldo
--      da conta da origem automaticamente (Saida excluída → soma de volta).
--
-- Porta de segurança:
--   - trg_protege_transferencia permite DELETE pois essas movimentações têm
--     transferencia_id = null (só bloqueia linhas de transferência).
--   - Exclui pagamentos ANTES das movimentações (fatura_pagamentos referencia
--     movimentacoes com on delete restrict).
--   - RLS/autoridade: quem executa é o dono (security definer valida
--     auth.uid() e filtra user_id) — nada é confiado ao cliente.
--
-- Convenções idênticas às migrations 10/11/12: security definer + set
-- search_path = public; revoke/grant só para authenticated.
-- ============================================================================


create or replace function public.desfazer_pagamento(
    p_cartao_id  uuid,
    p_mes_fatura text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user  uuid := auth.uid();
    v_ids   uuid[];
begin
    if v_user is null then
        raise exception 'Sessão sem usuário autenticado.';
    end if;

    if p_cartao_id is null or p_mes_fatura is null then
        raise exception 'Informe o cartão e o mês da fatura.';
    end if;

    -- Valida que o cartão pertence ao usuário.
    perform 1
      from public.cartoes
     where id = p_cartao_id
       and user_id = v_user;
    if not found then
        raise exception 'Cartão não encontrado ou não pertence ao usuário.';
    end if;

    -- Coleta as movimentações vinculadas aos pagamentos desta fatura.
    select coalesce(array_agg(fp.movimentacao_id), array[]::uuid[])
      into v_ids
      from public.fatura_pagamentos fp
     where fp.cartao_id = p_cartao_id
       and fp.mes_fatura = p_mes_fatura
       and fp.user_id = v_user
       and fp.movimentacao_id is not null;

    -- 1. Remove os pagamentos da fatura (libera a FK das movimentações).
    delete from public.fatura_pagamentos
     where cartao_id = p_cartao_id
       and mes_fatura = p_mes_fatura
       and user_id = v_user;

    -- 2. Remove as movimentações vinculadas (trigger reverte o saldo).
    if cardinality(v_ids) > 0 then
        delete from public.movimentacoes
         where id = any (v_ids)
           and user_id = v_user;
    end if;
end;
$$;


-- ============================================================================
-- GRANTS
-- ============================================================================
revoke all on function public.desfazer_pagamento(uuid, text) from public;
grant execute on function public.desfazer_pagamento(uuid, text) to authenticated;
