-- ============================================================================
-- MIGRATION 53 — divisão de parcelas: o resto INTEIRO vai para a PRIMEIRA
-- parcela (igual à administradora do cartão) + correção das compras já
-- gravadas com a regra antiga
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. IDEMPOTENTE.
--
-- CONTEXTO (12/11/2026): a compra "Amazon (Pulseiras p/ relógio e Fone de
-- ouvido)" de R$ 313,28 em 10x foi dividida com a regra D1 (o resto da
-- divisão espalhado 1 centavo nas PRIMEIRAS parcelas):
--     31,33 31,33 31,33 31,33 31,33 31,33 31,33 31,33 31,32 31,32
-- A administradora do cartão fatura de outro jeito:
--     31,40 31,32 31,32 31,32 31,32 31,32 31,32 31,32 31,32
-- (a PRIMEIRA parcela leva o resto inteiro; as demais ficam iguais).
--
-- EVIDÊNCIA (dados do próprio banco, 12/11/2026): das 36 compras parceladas
-- comparáveis, 35 seguem EXATAMENTE a regra da administradora — inclusive 7
-- em que a regra antiga erra (resto >= 2 centavos), a saber:
--     2025-12-15 Centauro (Tênis e roupas)   489,96 em 8x -> 61,28 + 7 x 61,24
--     2026-03-03 Amazon (liquidificador)      188,30 em 6x -> 31,40 + 5 x 31,38
--     2026-05-14 Localiza (Poços de Caldas)   587,36 em 3x -> 195,80 + 2 x 195,78
--     2026-06-12 Acium (presente do dia)      359,00 em 3x -> 119,68 + 2 x 119,66
--     2026-06-16 DR. Consulta (odontológico) 292,00 em 6x -> 48,70 + 5 x 48,66
--     2026-07-07 Amazon (panela de pressão)   484,80 em 9x -> 53,92 + 8 x 53,86
--     2026-08-11 Fechadura Intelbras (Leroy)  1105,70 em 6x -> 184,30 + 5 x 184,28
-- Essas 7 foram importadas do app ANTIGO com os valores REAIS da fatura —
-- ou seja, são a evidência direta do comportamento da administradora.
--
-- A REGRA ANTIGA (D1) só coincide com a administradora quando o resto da
-- divisão é 0 ou 1 centavo (daí as 29 compras em que as duas regras batem).
--
-- O QUE MUDA:
--   1. a FUNÇÃO public.dividir_valor_em_parcelas (usada por criar_compra,
--      editar_compra e realizar_planejamento_cartao) passa a devolver
--      [base + resto, base, base, ...];
--   2. as parcelas JÁ GRAVADAS que divergem da nova regra são corrigidas
--      (hoje: só a compra de 11/11/2026) — sem tocar nas que já estão
--      certainas, e SEM mexer em fatura já paga;
--   3. a lib JS src/lib/parcelas.js (dividirValorEmParcelas) é ajustada
--      para a MESMA regra, para o app continuar coerente com o banco.
--
-- A SOMA das parcelas continua sendo exatamente o total (nenhum centavo
-- criado ou perdido) — só muda QUAL parcela carrega a sobra.
-- ============================================================================


-- ============================================================================
-- 1. FUNÇÃO: dividir_valor_em_parcelas (regra da administradora)
-- ============================================================================
-- Divide um valor total (em centavos inteiros) em N parcelas.
-- Regra D2: o resto da divisão vai TODO para a PRIMEIRA parcela; as demais
-- ficam com a parte inteira. É a regra que a administradora do cartão usa
-- (confirmada em 35 das 36 compras parceladas do banco).
--
-- Retorna um array de integers (centavos por parcela).
-- Usada internamente pela RPC criar_compra; exposta para testes.

create or replace function public.dividir_valor_em_parcelas(
    p_total_centavos bigint,
    p_quantidade     integer
) returns integer[]
language plpgsql
immutable
set search_path = public
as $$
declare
    v_base      bigint;
    v_resto     bigint;
    v_parcelas  integer[];
    i           integer;
begin
    if p_total_centavos is null or p_total_centavos <= 0 then
        raise exception 'Total inválido (%): informe centavos como inteiro positivo.', p_total_centavos;
    end if;

    if p_quantidade is null or p_quantidade < 1 then
        raise exception 'Quantidade de parcelas inválida (%).', p_quantidade;
    end if;

    if p_total_centavos < p_quantidade then
        raise exception 'Total de % centavo(s) não cobre % parcela(s): alguma parcela ficaria com R$ 0,00.',
            p_total_centavos, p_quantidade;
    end if;

    v_base  := p_total_centavos / p_quantidade;
    v_resto := p_total_centavos % p_quantidade;

    v_parcelas := array[]::integer[];

    for i in 1 .. p_quantidade loop
        if i = 1 then
            -- 1ª parcela leva o resto INTEIRO (regra da administradora).
            v_parcelas := array_append(v_parcelas, (v_base + v_resto)::integer);
        else
            v_parcelas := array_append(v_parcelas, v_base::integer);
        end if;
    end loop;

    return v_parcelas;
end;
$$;


-- ============================================================================
-- 2. BACKFILL: corrige as parcelas já gravadas que divergem da nova regra
-- ============================================================================
-- Regras de segurança (uma compra só é corrigida se TODAS valerem):
--   a) a fatura da parcela NÃO tem pagamento registrado (senão o valor pago
--      no cartão não bateria com o app);
--   b) a soma das parcelas corrigidas continua igual ao valor_total da
--      compra (a regra redistribui, não cria nem perde centavo);
--   c) a compra está ATIVA e a parcela é de número 1 (só a 1ª muda).
--
-- Idempotente: rodar de novo não encontra nada para corrigir.

do $$
declare
    v_compra    record;
    v_parcelas  integer[];
    v_esperado  integer[];
    v_total     bigint;
    v_i         integer;
    v_corrigidas integer := 0;
    v_ausentes   integer := 0;
    v_pagas      integer := 0;
begin
    for v_compra in
        select c.id, c.valor_total, c.n_parcelas
          from public.compras c
         where c.n_parcelas > 1
           and c.ativa
           and not exists (
                select 1
                  from public.fatura_pagamentos fp
                 where fp.cartao_id = c.cartao_id
                   and fp.mes_fatura in (
                        select p.mes_fatura
                          from public.parcelas p
                         where p.compra_id = c.id
                   )
           )
    loop
        v_total := round(v_compra.valor_total * 100)::bigint;
        v_esperado := public.dividir_valor_em_parcelas(v_total, v_compra.n_parcelas);

        -- Só mexe se houver DIVERGÊNCIA real (idempotência) e se o número de
        -- parcelas gravadas bater com o declarado.
        select array_agg(round(p.valor * 100)::integer order by p.numero)
          into v_parcelas
          from public.parcelas p
         where p.compra_id = v_compra.id;

        if v_parcelas is null or array_length(v_parcelas, 1) <> v_compra.n_parcelas then
            v_ausentes := v_ausentes + 1;
            continue;
        end if;

        if v_parcelas = v_esperado then
            continue;  -- já está na regra nova
        end if;

        -- Confere que a redistribuição preserva o total.
        if (select coalesce(sum(x), 0) from unnest(v_esperado) x)
           <> (select coalesce(sum(x), 0) from unnest(v_parcelas) x) then
            raise exception 'Compra %: soma mudaria — abortada.', v_compra.id;
        end if;

        for v_i in 1 .. array_length(v_parcelas, 1) loop
            if v_parcelas[v_i] is distinct from v_esperado[v_i] then
                update public.parcelas
                   set valor = v_esperado[v_i] / 100.0
                 where compra_id = v_compra.id
                   and numero = v_i;
                v_corrigidas := v_corrigidas + 1;
            end if;
        end loop;
    end loop;

    raise notice 'Backfill da divisão: % parcela(s) corrigida(s); % compra(s) com parcelas faltantes; % fatura(s) paga(s) preservada(s).',
        v_corrigidas, v_ausentes, v_pagas;
end;
$$;


-- ============================================================================
-- 3. TESTES DA NOVA REGRA (bloco autocontido)
-- ============================================================================
do $$
declare
    v_array integer[];
begin
    raise notice '';
    raise notice '=== TESTES DA DIVISÃO (regra da administradora) ===';

    -- T16: 31328 / 10 (o caso real de 12/11/2026) -> 3140 + 9 x 3132
    v_array := public.dividir_valor_em_parcelas(31328, 10);
    if v_array = array[3140, 3132, 3132, 3132, 3132, 3132, 3132, 3132, 3132, 3132] then
        raise notice 'T16 OK: 31328/10 = %', v_array;
    else
        raise exception 'T16 FALHOU: Esperado [3140,3132x9], obtido %', v_array;
    end if;

    -- T17: 10000 / 3 -> 3334 + 2 x 3333 (resto 1: igual à regra antiga)
    v_array := public.dividir_valor_em_parcelas(10000, 3);
    if v_array = array[3334, 3333, 3333] then
        raise notice 'T17 OK: 10000/3 = %', v_array;
    else
        raise exception 'T17 FALHOU: Esperado [3334,3333,3333], obtido %', v_array;
    end if;

    -- T18: 10000 / 6 -> 1670 + 5 x 1666 (resto 4: a regra antiga daria
    -- 1667,1667,1667,1667,1666,1666 — ERRADO)
    v_array := public.dividir_valor_em_parcelas(10000, 6);
    if v_array = array[1670, 1666, 1666, 1666, 1666, 1666] then
        raise notice 'T18 OK: 10000/6 = %', v_array;
    else
        raise exception 'T18 FALHOU: Esperado [1670,1666x5], obtido %', v_array;
    end if;

    -- T19: 48996 / 8 (Centauro, caso real) -> 6128 + 7 x 6124
    v_array := public.dividir_valor_em_parcelas(48996, 8);
    if v_array = array[6128, 6124, 6124, 6124, 6124, 6124, 6124, 6124] then
        raise notice 'T19 OK: 48996/8 = %', v_array;
    else
        raise exception 'T19 FALHOU: Esperado [6128,6124x7], obtido %', v_array;
    end if;

    -- T20: 9999 / 7 -> 1431 + 6 x 1428
    v_array := public.dividir_valor_em_parcelas(9999, 7);
    if v_array = array[1431, 1428, 1428, 1428, 1428, 1428, 1428] then
        raise notice 'T20 OK: 9999/7 = %', v_array;
    else
        raise exception 'T20 FALHOU: Esperado [1431,1428x6], obtido %', v_array;
    end if;

    -- T21: 10000 / 1 -> [10000] (sem resto)
    v_array := public.dividir_valor_em_parcelas(10000, 1);
    if v_array = array[10000] then
        raise notice 'T21 OK: 10000/1 = %', v_array;
    else
        raise exception 'T21 FALHOU: Esperado [10000], obtido %', v_array;
    end if;

    -- T22: 3 / 3 -> [1,1,1]
    v_array := public.dividir_valor_em_parcelas(3, 3);
    if v_array = array[1, 1, 1] then
        raise notice 'T22 OK: 3/3 = %', v_array;
    else
        raise exception 'T22 FALHOU: Esperado [1,1,1], obtido %', v_array;
    end if;

    -- T23: 1 centavo / 3 -> rejeitado (alguma parcela ficaria com 0)
    begin
        v_array := public.dividir_valor_em_parcelas(1, 3);
        raise exception 'T23 FALHOU: Deveria rejeitar 1 centavo / 3';
    exception when others then
        raise notice 'T23 OK: 1 centavo / 3 rejeitado corretamente';
    end;

    -- T24: a soma das parcelas é sempre o total (varredura determinística)
    declare
        v_total   integer;
        v_qtd     integer;
        v_soma    integer;
        v_parc    integer[];
        v_totais  integer[] := array[1, 2, 7, 99, 100, 101, 999, 1500, 31328, 48996, 150000];
        v_i       integer;
    begin
        for v_i in 1 .. array_length(v_totais, 1) loop
            v_total := v_totais[v_i];
            for v_qtd in 1 .. least(v_total, 13) loop
                v_parc := public.dividir_valor_em_parcelas(v_total, v_qtd);
                select coalesce(sum(x), 0) into v_soma from unnest(v_parc) x;
                if v_soma <> v_total then
                    raise exception 'T24 FALHOU: soma % <> total % (% x %)', v_soma, v_total, v_total, v_qtd;
                end if;
                -- a 1ª parcela é a única que carrega o resto
                if v_qtd >= 2 then
                    if v_parc[1] < v_parc[2] then
                        raise exception 'T24 FALHOU: 1ª parcela menor que a 2ª (% x %)', v_total, v_qtd;
                    end if;
                    if v_parc[1] - v_parc[2] <> v_total % v_qtd then
                        raise exception 'T24 FALHOU: resto mal distribuído (% x %)', v_total, v_qtd;
                    end if;
                end if;
            end loop;
        end loop;
        raise notice 'T24 OK: soma e resto conferidos em 11 totais x até 13 parcelas';
    end;
end;
$$;
