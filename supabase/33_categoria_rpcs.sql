-- ============================================================================
-- MIGRATION 33 — Categoria nas RPCs de compra (criar_compra e editar_compra)
-- ============================================================================
-- A coluna compras.categoria foi adicionada na migration 32 (já aplicada).
-- Esta migration acrescenta o parâmetro p_categoria às RPCs de compra para
-- que o front possa gravar a categoria ao lançar/editar uma compra.
--
-- Decisões:
--   - p_categoria vai por ÚLTIMO com default NULL; chamadas antigas (sem o
--     parâmetro) continuam funcionando por causa do default.
--   - criar_compra: grava a categoria na compra (NULL quando vazio).
--   - editar_compra: só sobrescreve a categoria quando o parâmetro vier
--     preenchido — se vier vazio/NULL, mantém a categoria atual. Isso garante
--     que edições de compras migradas não apaguem a categoria já gravada.
--
-- Rodar este arquivo inteiro de uma vez no SQL Editor do Supabase.
-- ============================================================================


-- ============================================================================
-- 1. RPC: criar_compra (com p_categoria)
-- ============================================================================
drop function if exists public.criar_compra(uuid, date, text, numeric, integer);

create or replace function public.criar_compra(
    p_cartao_id      uuid,
    p_data           date,
    p_descricao      text,
    p_valor_total    numeric(12, 2),
    p_n_parcelas     integer default 1,
    p_categoria      text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user          uuid := auth.uid();
    v_descricao     text := nullif(trim(coalesce(p_descricao, '')), '');
    v_categoria     text := nullif(trim(coalesce(p_categoria, '')), '');
    v_dia_fech      integer;
    v_compra_id     uuid;
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

    select c.dia_fechamento into v_dia_fech
      from public.cartoes c
     where c.id = p_cartao_id
       and c.user_id = v_user
       and c.ativo = true
     for update;
    if not found then
        raise exception 'Cartão não encontrado ou inativo.';
    end if;
    if v_dia_fech is null then
        raise exception 'Cartão sem dia de fechamento definido.';
    end if;

    -- 1. Cria a compra (não altera saldo de conta — nenhuma trigger nela).
    insert into public.compras (user_id, cartao_id, data, descricao, valor_total, n_parcelas, categoria)
    values (v_user, p_cartao_id, v_data_compra, v_descricao, p_valor_total, p_n_parcelas, v_categoria)
    returning id into v_compra_id;

    -- 2. Divide o valor em parcelas (centavos inteiros, resto nas primeiras).
    v_valor_cents := round(p_valor_total * 100)::bigint;
    v_parcelas := public.dividir_valor_em_parcelas(v_valor_cents, p_n_parcelas);

    -- 3. Mês base da fatura (sem offset de parcela).
    v_mes_base := public.calcular_mes_fatura(v_data_compra, v_dia_fech);

    -- 4. Gera uma parcela por mês: base + (i-1) meses, com virada de ano.
    for i in 1 .. p_n_parcelas loop
        v_ano := split_part(v_mes_base, '-', 1)::integer;
        v_mes := split_part(v_mes_base, '-', 2)::integer;
        v_mes := v_mes + (i - 1);
        v_ano := v_ano + ((v_mes - 1) / 12);
        v_mes := ((v_mes - 1) % 12) + 1;

        v_total_parc := v_parcelas[i]::numeric / 100.0;

        insert into public.parcelas (user_id, compra_id, numero, total, valor, mes_fatura)
        values (
            v_user,
            v_compra_id,
            i,
            p_n_parcelas,
            v_total_parc,
            format('%s-%s', v_ano, lpad(v_mes::text, 2, '0'))
        );
    end loop;

    return v_compra_id;
end;
$$;

revoke all on function public.criar_compra(uuid, date, text, numeric, integer, text) from public;
grant execute on function public.criar_compra(uuid, date, text, numeric, integer, text) to authenticated;


-- ============================================================================
-- 2. RPC: editar_compra (com p_categoria)
-- ============================================================================
drop function if exists public.editar_compra(uuid, date, text, numeric, integer);

create or replace function public.editar_compra(
    p_compra_id      uuid,
    p_data           date,
    p_descricao      text,
    p_valor_total    numeric(12, 2),
    p_n_parcelas     integer,
    p_categoria      text default null
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
    v_categoria     text := nullif(trim(coalesce(p_categoria, '')), '');
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

    -- Atualiza a compra. A categoria só muda quando p_categoria vier
    -- preenchida (coalesce preserva a categoria atual em edições sem
    -- reclassificação, como compras migradas).
    update public.compras
       set data = v_data_compra,
           descricao = v_descricao,
           valor_total = p_valor_total,
           n_parcelas = p_n_parcelas,
           categoria = coalesce(v_categoria, categoria)
     where id = p_compra_id;

    if not v_mudou_valor then
        return;
    end if;

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

revoke all on function public.editar_compra(uuid, date, text, numeric, integer, text) from public;
grant execute on function public.editar_compra(uuid, date, text, numeric, integer, text) to authenticated;