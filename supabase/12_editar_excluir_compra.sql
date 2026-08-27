-- ============================================================================
-- ETAPA C2 — MIGRATION 12: editar_compra e excluir_compra
-- ============================================================================
-- Migration 12: Fecha as ações de manutenção do módulo Cartões — editar e
-- excluir um lançamento (compra) dentro do módulo de faturas.
--
-- Por que RPCs e não UPDATE/DELETE direto nas tabelas:
--   - `compras` é a unidade que o usuário lança; cada compra possui N
--     parcelas (uma por mês de fatura). Editar/excluir SEM recalcular as
--     parcelas deixaria o faturamento inconsistente (compras.valor_total X
--     soma das parcelas, meses desalinhados, faturas pagas corrompidas).
--   - A RPC garante atomicamente: editar recalcula as parcelas (redistribui
--     valor/número de parcelas nos meses corretos, reutilizando as funções
--     já validadas dividir_valor_em_parcelas + calcular_mes_fatura da
--     migration 10/11); excluir faz soft-delete da compra inteira, o que a
--     view v_faturas e a RPC calcular_limite_disponivel refletem sozinhas.
--
-- Regra de segurança (não corromper fatura paga):
--   Valores de fatura são derivados das parcelas + fatura_pagamentos (por
--   cartao + mes_fatura). Se uma fatura já tem QUALQUER pagamento
--   registrado, REMOVER ou REDUZIR parcelas daquele mês tornaria a fatura
--   inconsistentemente "paga" (total baixando abaixo do já pago). Então:
--     - excluir_compra: bloqueia se ALGUMA parcela atual cair em mês com
--       fatura_pagamentos.
--     - editar_compra com mudança de valor/parcelas: bloqueia se os meses
--       AFETADOS (antigos ou novos) tiverem fatura_pagamentos.
--     - editar_compra apenas de descricao/data (valor e n_parcelas
--       iguais): permitida SEMPRE — não muda o valor de fatura alguma.
--
-- Convenções idênticas às migration 10/11: RPC security definer +
-- set search_path = public, revoke/grant só para authenticated.
-- ============================================================================


-- ============================================================================
-- FUNÇÃO AUXILIAR (interna): faturas_com_pagamento
-- ============================================================================
-- Retorna true se houver QUALQUER pagamento registrado para o cartão em
-- algum dos meses informados. Usada para bloquear edição/exclusão que
-- afetaria fatura já paga/parcialmente paga.
create or replace function public.faturas_com_pagamento(
    p_cartao_id uuid,
    p_meses text[]
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_existe boolean;
begin
    select exists(
        select 1
          from public.fatura_pagamentos fp
         where fp.cartao_id = p_cartao_id
           and fp.mes_fatura = any (p_meses)
    ) into v_existe;
    return coalesce(v_existe, false);
end;
$$;


-- ============================================================================
-- 1. RPC: excluir_compra
-- ============================================================================
-- Soft-delete de uma compra inteira (ativa=false + cancelada_em=now()).
-- As parcelas permanecem no histórico (para o extrato), mas a view v_faturas
-- e calcular_limite_disponivel as ignoram (WHERE c.ativa = true), então a
-- fatura e o limite são recalculados sozinhos.
--
-- Bloqueia se qualquer parcela atual cair em mês com pagamento registrado
-- (evita descumprir fatura já paga/parcialmente paga).
create or replace function public.excluir_compra(
    p_compra_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user      uuid := auth.uid();
    v_cartao_id uuid;
    v_meses     text[];
begin
    if v_user is null then
        raise exception 'Usuário não autenticado.';
    end if;

    -- Valida a compra (dono + ativa). Lock determinístico na compra.
    select cartao_id into v_cartao_id
      from public.compras
     where id = p_compra_id
       and user_id = v_user
       and ativa = true
     for update;

    if not found then
        raise exception 'Compra não encontrada ou não pertence ao usuário.';
    end if;

    -- Meses de fatura alcançados pelas parcelas atuais da compra.
    select coalesce(array_agg(distinct mes_fatura), array[]::text[])
      into v_meses
      from public.parcelas
     where compra_id = p_compra_id;

    -- Bloqueia se qualquer uma dessas faturas já tem pagamento.
    if public.faturas_com_pagamento(v_cartao_id, v_meses) then
        raise exception 'Não é possível excluir esta compra: uma das faturas (meses %) já possui pagamento. A fatura paga não pode mudar.', array_to_string(v_meses, ', ');
    end if;

    -- Soft-delete: as parcelas somem da fatura/limite automaticamente.
    update public.compras
       set ativa = false,
           cancelada_em = now()
     where id = p_compra_id;
end;
$$;


-- ============================================================================
-- 2. RPC: editar_compra
-- ============================================================================
-- Edita uma compra ativa. Recalcula (ou apenas atualiza) as parcelas de
-- forma atômica:
--   - descricao/data: update direto em `compras` (não muda valor de fatura);
--   - valor_total/n_parcelas: redistribui TODAS as parcelas com as funções
--     validadas, deslocando o mês-base + (i-1) com virada de ano.
--
-- Bloqueia mudança de valor/parcelas se os MESES AFETADOS (antigos ou novos)
-- tiverem fatura com pagamento. Mudança apenas de descricao/data é sempre
-- permitida.
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
        select cartao_id, dia_fechamento into v_cartao_id, v_dia_fech
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


-- ============================================================================
-- 3. GRANTS
-- ============================================================================
revoke all on function public.faturas_com_pagamento(uuid, text[]) from public;
grant execute on function public.faturas_com_pagamento(uuid, text[]) to authenticated;

revoke all on function public.excluir_compra(uuid) from public;
grant execute on function public.excluir_compra(uuid) to authenticated;

revoke all on function public.editar_compra(uuid, date, text, numeric, integer) from public;
grant execute on function public.editar_compra(uuid, date, text, numeric, integer) to authenticated;
