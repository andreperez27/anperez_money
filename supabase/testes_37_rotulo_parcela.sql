-- ============================================================================
-- ROTEIRO DE TESTES — Migration 37 (rótulo da parcela "(n/total)" na
-- descrição da compra gerada ao efetivar previsão de SÉRIE no cartão)
-- ============================================================================
-- PRÉ-REQUISITO: migration 37_realizar_cartao_rotulo_parcela.sql JÁ aplicada.
-- No SQL Editor, selecione UM BLOCO POR VEZ (do begin; ao rollback;) e Run.
-- Detecção de usuário automática; tudo termina em rollback.
--
-- [OK esperado]   = retorna normal (veja as notices).
-- [ERRO esperado] = exceção exibida — é o teste passando.
-- ============================================================================

-- ============================================================================
-- TESTE A [OK esperado] — previsão de SÉRIE (parcela 4/10) efetivada no
--                        cartão: compra nasce com "Seguro - Mapfre (4/10)",
--                        n_parcelas=1 (continua avulsa) e previsão realizada
-- ============================================================================
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    conta uuid; cart_t uuid; p uuid; compra uuid;
    v_desc text; v_n int;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);

    insert into public.contas (user_id, nome, tipo, saldo_atual)
    values (u, 'CT Cartao Teste', 'corrente', 0)
    returning id into conta;

    insert into public.cartoes (user_id, conta_id, nome, limite, dia_fechamento, dia_vencimento)
    values (u, conta, 'Cartao Teste', 5000, 15, 20)
    returning id into cart_t;

    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, origem,
         ano_semana, semana, estado, serie_id, parcela_numero, total_parcelas,
         destino_padrao, cartao_padrao_id)
    values
        (u, 'Saida', 'Seguro do carro - Mapfre', 299.90, current_date, 'manual',
         extract(year from current_date)::smallint, 36, 'previsto',
         gen_random_uuid(), 4, 10, 'cartao', cart_t)
    returning id into p;

    compra := public.realizar_planejamento_cartao(p, cart_t);

    select c.descricao, c.n_parcelas
      into v_desc, v_n
      from public.compras c
     where c.id = compra;

    raise notice 'descricao = % | n_parcelas = % | esperado: (4/10) / 1', v_desc, v_n;
    raise notice 'planejamento: estado=% lancamento_tipo=% estava_esperado=%',
        (select estado from public.planejamentos where id = p),
        (select lancamento_tipo from public.planejamentos where id = p),
        true;
end $$;
rollback;

-- ============================================================================
-- TESTE B [OK esperado] — previsão AVULSA (serie_id nulo) efetivada no cartão:
--                        descrição SEM parênteses; n_parcelas=1
-- ============================================================================
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    conta uuid; cart_t uuid; p uuid; compra uuid;
    v_desc text; v_n int;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);

    insert into public.contas (user_id, nome, tipo, saldo_atual)
    values (u, 'CT Cartao Teste B', 'corrente', 0)
    returning id into conta;

    insert into public.cartoes (user_id, conta_id, nome, limite, dia_fechamento, dia_vencimento)
    values (u, conta, 'Cartao Teste B', 5000, 15, 20)
    returning id into cart_t;

    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, origem,
         ano_semana, semana, estado, destino_padrao, cartao_padrao_id)
    values
        (u, 'Saida', 'Cafe na rua', 42.50, current_date, 'manual',
         extract(year from current_date)::smallint, 37, 'previsto', 'cartao', cart_t)
    returning id into p;

    compra := public.realizar_planejamento_cartao(p, cart_t);

    select c.descricao, c.n_parcelas
      into v_desc, v_n
      from public.compras c
     where c.id = compra;

    raise notice 'descricao = % | n_parcelas = % | esperado: sem parênteses / 1', v_desc, v_n;
end $$;
rollback;

-- ============================================================================
-- TESTE C [OK esperado] — previsão de SÉRIE na parcela FINAL (10/10),
--                        efetivada com p_valor_real e p_data_compra:
--                        rótulo "(10/10)" (formatação de 2 dígitos), valor e
--                        data reais respeitados
-- ============================================================================
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    conta uuid; cart_t uuid; p uuid; compra uuid;
    v_desc text; v_valor numeric(12,2); v_data date;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);

    insert into public.contas (user_id, nome, tipo, saldo_atual)
    values (u, 'CT Cartao Teste C', 'corrente', 0)
    returning id into conta;

    insert into public.cartoes (user_id, conta_id, nome, limite, dia_fechamento, dia_vencimento)
    values (u, conta, 'Cartao Teste C', 5000, 15, 20)
    returning id into cart_t;

    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, origem,
         ano_semana, semana, estado, serie_id, parcela_numero, total_parcelas,
         destino_padrao, cartao_padrao_id)
    values
        (u, 'Saida', 'Internet mensal', 99.90, current_date, 'manual',
         extract(year from current_date)::smallint, 38, 'previsto',
         gen_random_uuid(), 10, 10, 'cartao', cart_t)
    returning id into p;

    compra := public.realizar_planejamento_cartao(p, cart_t, 104.90, '2026-09-14'::date);

    select c.descricao, c.valor_total, c.data
      into v_desc, v_valor, v_data
      from public.compras c
     where c.id = compra;

    raise notice 'descricao = % | valor = % | data = % | esperado: Internet mensal (10/10) / 104.90 / 2026-09-14',
        v_desc, v_valor, v_data;
end $$;
rollback;