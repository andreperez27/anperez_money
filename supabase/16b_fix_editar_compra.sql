-- ============================================================================
-- MIGRATION 16 — CORREÇÃO: bug "column cartao_id does not exist" em editar_compra
-- ============================================================================
-- Bug: dentro de editar_compra, quando o valor ou o número de parcelas muda
-- (v_mudou_valor = true), a consulta que busca o dia_fechamento do cartão
-- estava selecionando por engano a coluna "cartao_id" da própria tabela
-- public.cartoes. Essa tabela não tem essa coluna (ela é "id" ali dentro;
-- "cartao_id" só existe nas tabelas que REFERENCIAM o cartão: compras,
-- parcelas, fatura_pagamentos). Daí o erro ao editar valor/parcelas de uma
-- compra no Extrato do cartão.
--
-- Correção: remover "cartao_id" do select, mantendo só "dia_fechamento".
-- A variável v_cartao_id já está correta, vinda da consulta anterior em
-- public.compras — não precisa (e não pode) ser reatribuída aqui.
--
-- Rodar este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (create or replace function substitui a versão anterior automaticamente).
-- ============================================================================

create or replace function public.editar_compra(
    p_compra_id      uuid,
    p_data           date,
    p_descricao      text,
    p_valor_total    numeric(12, 2),
    p_n_parcelas     integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user          uuid := auth.uid();
    v_cartao_id     uuid;
    v_dia_fech      integer;
    v_descricao     text := nullif(trim(coalesce(p_descricao, '')), '');
    v_meses_afet    text[];
    v_valor_antigo  numeric(12, 2);
    v_n_antigo      integer;
    v_mudou_valor   boolean;
    v_parcelas      integer[];
    v_valor_cents   bigint;
    v_mes_base      text;
    v_ano           integer;
    v_mes           integer;
    v_total_parc    numeric(12, 2);
    v_data_compra   date := coalesce(p_data, current_date);
    i               integer;
begin
    if v_user is null then
        raise exception 'Usuário não autenticado.';
    end if;

    if v_descricao is null then
        raise exception 'Descrição da compra é obrigatória.';
    end if;

    if p_valor_total is null or p_valor_total <= 0 then
        raise exception 'Valor total inválido (%): informe um valor maior que zero.', p_valor_total;
    end if;

    if p_n_parcelas is null or p_n_parcelas < 1 then
        raise exception 'Número de parcelas inválido (%).', p_n_parcelas;
    end if;

    -- Valida a compra (dono + ativa) e captura cartão + valores atuais.
    -- Lock determinístico na compra e no cartão (protege contra concorrência).
    select c.cartao_id,
           c.valor_total,
           c.n_parcelas
      into v_cartao_id, v_valor_antigo, v_n_antigo
      from public.compras c
     where c.id = p_compra_id
       and c.user_id = v_user
       and c.ativa = true
     for update;

    if not found then
        raise exception 'Compra não encontrada ou não pertence ao usuário.';
    end if;

    v_mudou_valor := (v_valor_antigo <> p_valor_total) or (v_n_antigo <> p_n_parcelas);

    if v_mudou_valor then
        -- CORRIGIDO: antes selecionava "cartao_id, dia_fechamento" (coluna
        -- inexistente em public.cartoes). Agora só busca dia_fechamento;
        -- v_cartao_id já veio correto da consulta acima em public.compras.
        select dia_fechamento into v_dia_fech
          from public.cartoes
         where id = v_cartao_id
           and user_id = v_user
           and ativo = true
         for update;

        if not found then
            raise exception 'Cartão não encontrado ou inativo.';
        end if;
        if v_dia_fech is null then
            raise exception 'Cartão sem dia de fechamento definido.';
        end if;

        -- Meses afetados = meses atuais da compra + meses que passarão a ter
        -- parcela (mesmo cálculo de criar_compra).
        select coalesce(array_agg(distinct mes_fatura), array[]::text[])
          into v_meses_afet
          from public.parcelas
         where compra_id = p_compra_id;

        v_mes_base := public.calcular_mes_fatura(v_data_compra, v_dia_fech);
        for i in 1 .. p_n_parcelas loop
            v_ano := split_part(v_mes_base, '-', 1)::integer;
            v_mes  := split_part(v_mes_base, '-', 2)::integer;
            v_mes  := v_mes + (i - 1);
            v_ano  := v_ano + ((v_mes - 1) / 12);
            v_mes  := ((v_mes - 1) % 12) + 1;
            v_meses_afet := v_meses_afet || format('%s-%s', v_ano, lpad(v_mes::text, 2, '0'));
        end loop;

        select coalesce(array_agg(distinct m), array[]::text[])
          into v_meses_afet
          from unnest(v_meses_afet) m;

        if public.faturas_com_pagamento(v_cartao_id, v_meses_afet) then
            raise exception 'Não é possível alterar valor/parcelas: uma das faturas afetadas (meses %) já possui pagamento. A fatura paga não pode mudar.', array_to_string(v_meses_afet, ', ');
        end if;
    end if;

    -- Atualiza a compra (descricao, data, valor, parcelas).
    update public.compras
       set data = v_data_compra,
           descricao = v_descricao,
           valor_total = p_valor_total,
           n_parcelas = p_n_parcelas
     where id = p_compra_id;

    if not v_mudou_valor then
        -- Só descricao/data: parcelas permanecem intactas.
        return;
    end if;

    -- Recalcula as parcelas (redistribui valor entre o MESMO número de meses
    -- atualizado, começando do novo mês base).
    delete from public.parcelas where compra_id = p_compra_id;

    v_valor_cents := round(p_valor_total * 100)::bigint;
    v_parcelas := public.dividir_valor_em_parcelas(v_valor_cents, p_n_parcelas);

    for i in 1 .. p_n_parcelas loop
        v_ano := split_part(v_mes_base, '-', 1)::integer;
        v_mes  := split_part(v_mes_base, '-', 2)::integer;
        v_mes  := v_mes + (i - 1);
        v_ano  := v_ano + ((v_mes - 1) / 12);
        v_mes  := ((v_mes - 1) % 12) + 1;

        v_total_parc := v_parcelas[i]::numeric / 100.0;

        insert into public.parcelas (user_id, compra_id, numero, total, valor, mes_fatura)
        values (
            v_user,
            p_compra_id,
            i,
            p_n_parcelas,
            v_total_parc,
            format('%s-%s', v_ano, lpad(v_mes::text, 2, '0'))
        );
    end loop;
end;
$$;

-- Grant já existia da migration 12, mas repetimos por segurança (idempotente).
revoke all on function public.editar_compra(uuid, date, text, numeric, integer) from public;
grant execute on function public.editar_compra(uuid, date, text, numeric, integer) to authenticated;
