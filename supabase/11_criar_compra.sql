-- ============================================================================
-- ETAPA C2 — MIGRATION 11: RPC criar_compra (compra + parcelas, atômica)
-- ============================================================================
-- Migration 11: Preenche a lacuna do módulo Cartões — não existia uma
-- função atômica que criasse uma COMPRA e suas PARCELAS de uma vez. A
-- migration 10 fornecia apenas as ajudas PURAS (dividir_valor_em_parcelas e
-- calcular_mes_fatura) e deixava os inserts de compras/parcelas a cargo do
-- cliente (comentário no teste T03: "Parcela será criada pelo cliente (RPC
-- criar_compra)"), mas a RPC nunca foi criada.
--
-- Lógica reaproveitada do app antigo (Controle_Horas, db.py e
-- cartoes_lanc_screen.py):
--   1. Parcelamento: divide o total em centavos com ROUND_FLOOR na parcela
--      base e o RESTO nas PRIMEIRAS parcelas — idêntico à função já
--      validada dividir_valor_em_parcelas(bigint, integer) da migration 10
--      (T09–T15). Aqui apenas convertemos o resultado centavos→reais.
--   2. Mês da fatura: usar o MESMO ciclo de fechamento do app antigo —
--      calcular_mes_fatura(data, dia_fechamento) dá o mês BASE; cada parcela
--      i cai no mês base + (i-1) (com virada de ano). No app antigo isso era
--      "parcela=0..n" somado ao mês.
--   3. Parcelas são linhas SEPARADAS em parcelas com mes_fatura própria
--      (um row por parcela), como o app antigo gravava em despesas_cartao.
--
-- A compra NÃO mexe no saldo da conta (T08 valida isso). Limite disponível
-- e status de fatura continuam calculados pelas peças já existentes da
-- migration 10 (view v_faturas + RPC calcular_limite_disponivel + RPC
-- pagar_fatura) — nada de lógica financeira duplicada aqui.
--
-- Convenções idênticas às migration 01–10: PK/FK, RLS (auth.uid), RPC
-- security definer + set search_path = public, revoke/grant.
-- ============================================================================


-- ============================================================================
-- 1. FUNÇÃO: criar_compra
-- ============================================================================
-- Cria a compra e gera UMA parcela por mês de fatura, tudo na MESMA
-- transação (se qualquer parcela falhar, nada persiste).
--
-- Retorno: uuid da compra criada.
--
-- Erros (mensagens claras, exibidas verbatim no front):
--   - "Usuário não autenticado."
--   - "Descrição da compra é obrigatória."
--   - "Valor total inválido (%): informe um valor maior que zero."
--   - "Número de parcelas inválido (%)."
--   - "Cartão não encontrado ou inativo."
--   - "Cartão sem dia de fechamento definido."
--   - (de dividir_valor_em_parcelas) total não cobre as parcelas.
drop function if exists public.criar_compra(uuid, date, text, numeric, integer);

create or replace function public.criar_compra(
    p_cartao_id      uuid,
    p_data           date,
    p_descricao      text,
    p_valor_total    numeric(12, 2),
    p_n_parcelas     integer default 1
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user          uuid := auth.uid();
    v_descricao     text := nullif(trim(coalesce(p_descricao, '')), '');
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

    -- Valida o cartão (dono + ativo) e captura o dia de fechamento (lock
    -- determinístico para concorrência, mesmo padrão do pagar_fatura).
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
    insert into public.compras (user_id, cartao_id, data, descricao, valor_total, n_parcelas)
    values (v_user, p_cartao_id, v_data_compra, v_descricao, p_valor_total, p_n_parcelas)
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


-- ============================================================================
-- 2. GRANTS
-- ============================================================================
revoke all on function public.criar_compra(uuid, date, text, numeric, integer) from public;
grant execute on function public.criar_compra(uuid, date, text, numeric, integer) to authenticated;
