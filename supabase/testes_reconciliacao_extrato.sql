-- ============================================================================
-- ROTEIRO DE TESTES — Reconciliação dos extratos (correção A+B+C)
-- ============================================================================
-- Valida no BANCO as mesmas fórmulas que o front usa (src/lib/extratoCalc.js):
--
--   saldo_atual = abertura(< início)
--               + período([início..fim], fim INCLUSIVO)
--               + futuro(> fim)
--
--   fim_do_período = abertura + período
--   SEM linhas futuras ⇒ fim_do_período = saldo_atual (obrigatório)
--
-- Como usar: cole cada BLOCO por vez no SQL Editor e rode. Cada bloco abre
-- transação própria e termina em ROLLBACK (não suja nada). Um bloco passa
-- quando imprime os "ok" listados; se imprimir ERRO inesperado, falhou.
-- O usuário é detectado automaticamente (o mais antigo da base).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BLOCO A — TESTES 1 e 13: sem lançamentos futuros,
--           fim_do_período == saldo_atual (histórico completo e recorte)
-- ---------------------------------------------------------------------------
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    conta uuid;
    v_abertura numeric;
    v_periodo numeric;
    v_fim_periodo numeric;
    v_saldo_atual numeric;
begin
    insert into public.contas (user_id, nome, saldo_atual)
        values (u, 'RC A', 0) returning id into conta;

    -- Histórico pré-período e dentro do período (todas <= fim)
    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, tipo_op)
        values (conta, u, date '2026-08-05', 'hist antigo', 1000, 'Entrada'),
               (conta, u, date '2026-08-10', 'ent per', 500, 'Entrada'),
               (conta, u, date '2026-08-12', 'sai per', 200, 'Saida');

    select coalesce(sum(case when m.tipo_op = 'Entrada' then m.valor else -m.valor end), 0)
      into v_abertura
      from public.movimentacoes m
     where m.conta_id = conta and m.data < date '2026-08-10';

    select coalesce(sum(case when m.tipo_op = 'Entrada' then m.valor else -m.valor end), 0)
      into v_periodo
      from public.movimentacoes m
     where m.conta_id = conta
       and m.data >= date '2026-08-10' and m.data <= date '2026-08-16';

    v_fim_periodo := v_abertura + v_periodo;

    select saldo_atual into v_saldo_atual from public.contas where id = conta;

    if v_saldo_atual <> v_fim_periodo then
        raise exception 'RECONCILIAÇÃO FALHOU (sem futuros): fim=% saldo_atual=%',
            v_fim_periodo, v_saldo_atual;
    end if;
    raise notice 'ok — sem futuros: fim (%) == saldo_atual (%)', v_fim_periodo, v_saldo_atual;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- BLOCO B — TESTES 2, 3 e 4: lançamentos futuros explicam a diferença
--           (fim_do_período ≠ saldo_atual, diferença == efeito líquido futuro)
-- ---------------------------------------------------------------------------
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    conta uuid;
    v_futuro numeric; v_fim numeric; v_saldo numeric; v_diff numeric;
begin
    insert into public.contas (user_id, nome, saldo_atual)
        values (u, 'RC B', 0) returning id into conta;

    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, tipo_op)
        values (conta, u, date '2026-08-01', 'base',       1000, 'Entrada'),
               (conta, u, date '2026-08-10', 'per ent',     400, 'Entrada'),
               (conta, u, date '2026-08-20', 'FUTURA sai',  100, 'Saida'),   -- teste 2
               (conta, u, date '2026-08-22', 'FUTURA ent',  250, 'Entrada'),  -- teste 3
               (conta, u, date '2026-08-23', 'FUTURA ent',   50, 'Entrada');  -- teste 4

    select coalesce(sum(case when tipo_op='Entrada' then valor else -valor end),0)
      into v_fim from public.movimentacoes where conta_id=conta and data <= date '2026-08-16';
    select coalesce(sum(case when tipo_op='Entrada' then valor else -valor end),0)
      into v_futuro from public.movimentacoes where conta_id=conta and data > date '2026-08-16';
    select saldo_atual into v_saldo from public.contas where id=conta;

    v_diff := v_saldo - v_fim;
    if v_diff <> v_futuro or v_diff <> 200 then
        raise exception 'RECONCILIAÇÃO FALHOU (futuros): fim=% saldo=% diff=% futuro esperado=200',
            v_fim, v_saldo, v_diff;
    end if;
    raise notice 'ok — futuros líquidos +200 explicam divergência (aviso: "+R$ 200,00")';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- BLOCO C — TESTES 5 e 6: transferências internas (dentro e futura)
--           cada CONTA reconcilia individualmente; transferência não é
--           Entrada/Saída financeira mas AFETA o saldo de quem recebe/envia
-- ---------------------------------------------------------------------------
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid;
    va_fim numeric; vb_fim numeric; va_saldo numeric; vb_saldo numeric;
begin
    insert into public.contas (user_id, nome, saldo_atual)
        values (u, 'RC C1', 0) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual)
        values (u, 'RC C2', 0) returning id into b;

    -- Dentro do período: A envia 100 para B (categoria transferencia)
    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, categoria, tipo_op)
        values (a, u, date '2026-08-12', 'transf enviada', 100, 'transferencia', 'Saida'),
               (b, u, date '2026-08-12', 'transf recebida', 300, 'transferencia', 'Entrada');

    -- Futura: A envia 300 para B depois do fim da pesquisa
    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, categoria, tipo_op)
        values (a, u, date '2026-08-20', 'transf futura enviada', 300, 'transferencia', 'Saida'),
               (b, u, date '2026-08-20', 'transf futura recebida', 300, 'transferencia', 'Entrada');

    -- fim_do_período por conta (<= 16/08)
    select coalesce(sum(case when tipo_op='Entrada' then valor else -valor end),0)
      into va_fim from public.movimentacoes where conta_id=a and data <= date '2026-08-16';
    select coalesce(sum(case when tipo_op='Entrada' then valor else -valor end),0)
      into vb_fim from public.movimentacoes where conta_id=b and data <= date '2026-08-16';

    select saldo_atual into va_saldo from public.contas where id=a;
    select saldo_atual into vb_saldo from public.contas where id=b;

    -- Dentro do período: entra no saldo de ambas (-100 em A, +300 em B)
    if va_fim <> -100 or vb_fim <> 300 then
        raise exception 'FALHOU teste 5: va_fim=% vb_fim=% (esperado -100 / 300)', va_fim, vb_fim;
    end if;
    raise notice 'ok — teste 5: transferência no período afeta saldo das duas contas';

    -- Futura: divergência exatamente igual ao efeito dela em cada conta
    if (va_saldo - va_fim) <> -300 or (vb_saldo - vb_fim) <> 300 then
        raise exception 'FALHOU teste 6: divergência futura errada (A %→%, B %→%)', va_fim, va_saldo, vb_fim, vb_saldo;
    end if;
    raise notice 'ok — teste 6: aviso futuro = −300 em A e +300 em B';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- BLOCO D — TESTES 7 e 8: caixinha guardar (Saída) e resgatar (Entrada)
--           participam da reconciliação como fluxo comum
-- ---------------------------------------------------------------------------
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    conta uuid; v_fim numeric; v_saldo numeric;
begin
    insert into public.contas (user_id, nome, saldo_atual)
        values (u, 'RC D', 0) returning id into conta;

    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, categoria, tipo_op)
        values (conta, u, date '2026-08-10', 'caixinha guardar',  250, 'caixinha', 'Saida'),  -- teste 7
               (conta, u, date '2026-08-14', 'caixinha resgatar',  80, 'caixinha', 'Entrada'); -- teste 8

    select coalesce(sum(case when tipo_op='Entrada' then valor else -valor end),0)
      into v_fim from public.movimentacoes where conta_id=conta;
    select saldo_atual into v_saldo from public.contas where id=conta;

    if v_fim <> -170 or v_saldo <> v_fim then
        raise exception 'FALHOU testes 7/8: fim=% saldo=% (esperado -170/-170)', v_fim, v_saldo;
    end if;
    raise notice 'ok — testes 7/8: caixinha guardar/resgatar reconciliam';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- BLOCO E — TESTES 9, 10 e 11: mesmo dia / fim inclusivo / início exclusivo
-- ---------------------------------------------------------------------------
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    conta uuid;
    v_dia numeric; v_abertura numeric; v_periodo numeric; v_saldo numeric;
begin
    insert into public.contas (user_id, nome, saldo_atual)
        values (u, 'RC E', 0) returning id into conta;

    -- Vários lançamentos NO MESMO DIA (teste 9) e nas bordas do período
    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, tipo_op)
        values (conta, u, date '2026-08-09', 'véspera',        100, 'Entrada'), -- teste 11: entra na ABERTURA
               (conta, u, date '2026-08-10', 'mesmo dia a',     50, 'Entrada'), -- teste 11: NÃO entra na abertura
               (conta, u, date '2026-08-10', 'mesmo dia b',     30, 'Saida'),
               (conta, u, date '2026-08-10', 'mesmo dia c',     20, 'Entrada'),
               (conta, u, date '2026-08-16', 'no próprio fim',  40, 'Entrada'); -- teste 10: fim INCLUSIVO

    select coalesce(sum(case when tipo_op='Entrada' then valor else -valor end),0)
      into v_abertura from public.movimentacoes where conta_id=conta and data < date '2026-08-10';
    select coalesce(sum(case when tipo_op='Entrada' then valor else -valor end),0)
      into v_periodo from public.movimentacoes
     where conta_id=conta and data >= date '2026-08-10' and data <= date '2026-08-16';
    select coalesce(sum(case when tipo_op='Entrada' then valor else -valor end),0)
      into v_dia from public.movimentacoes where conta_id=conta and data = date '2026-08-10';
    select saldo_atual into v_saldo from public.contas where id=conta;

    if v_abertura <> 100 then
        raise exception 'FALHOU teste 11: abertura=% (esperado 100, sem o dia inicial)', v_abertura;
    end if;
    if v_dia <> 40 then
        raise exception 'FALHOU teste 9: mesmo dia=% (esperado 50-30+20=40)', v_dia;
    end if;
    if v_periodo <> 80 then
        raise exception 'FALHOU teste 10: período=% (esperado 40+40=80, fim inclusivo)', v_periodo;
    end if;
    if v_abertura + v_periodo <> v_saldo then
        raise exception 'FALHOU identidade: abertura+período=% saldo=%', v_abertura+v_periodo, v_saldo;
    end if;
    raise notice 'ok — testes 9/10/11: mesma data soma certo, fim inclusivo, início fora da abertura';
end $$;
rollback;
