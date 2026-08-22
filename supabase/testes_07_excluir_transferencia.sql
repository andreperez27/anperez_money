-- ============================================================================
-- ROTEIRO DE TESTES — Etapa 15 (exclusão de transferências)
-- ============================================================================
-- PRÉ-REQUISITO: 06_transferencias.sql E 07_excluir_transferencia.sql já
-- aplicados. No SQL Editor, selecione UM BLOCO POR VEZ (do begin; ao
-- rollback;) e Run. Detecção de usuário automática; tudo termina em rollback.
--
-- [OK esperado]   = retorna normal (veja as notices).
-- [ERRO esperado] = exceção exibida — é o teste passando.
-- ============================================================================

-- ============================================================================
-- TESTE A [OK esperado] — criar e excluir: saldos voltam ao original e NADA
--                        sobra (nem movimentações, nem registro)
-- ============================================================================
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid; t uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'EX A', 1000) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'EX B', 0)    returning id into b;

    t := public.criar_transferencia(a, b, 300, current_date, null, gen_random_uuid());
    raise notice 'após criar:   A = % | B = %',
        (select saldo_atual from public.contas where id = a),
        (select saldo_atual from public.contas where id = b);

    perform public.excluir_transferencia(t);

    raise notice 'após excluir: A = % | B = % | movs vinculadas = % | transferencias = %',
        (select saldo_atual from public.contas where id = a),
        (select saldo_atual from public.contas where id = b),
        (select count(*) from public.movimentacoes where transferencia_id = t),
        (select count(*) from public.transferencias where id = t);
end $$;
rollback;
-- Esperado:
--   após criar:   A = 700.00 | B = 300.00
--   após excluir: A = 1000.00 | B = 0.00 | movs vinculadas = 0 | transferencias = 0

-- ============================================================================
-- TESTE B [ERRO esperado] — DELETE direto pelo cliente continua bloqueado
-- ============================================================================
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid; t uuid; m uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'XB A', 100) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'XB B', 0)   returning id into b;
    t := public.criar_transferencia(a, b, 10, current_date, null, gen_random_uuid());

    perform set_config('role', 'authenticated', true);
    delete from public.movimentacoes where transferencia_id = t returning id into m;
end $$;
rollback;
-- Esperado: 'Movimentação parte de uma transferência não pode ser excluída
--            individualmente.'

-- ============================================================================
-- TESTE C [ERRO esperado] — UPDATE em linha vinculada segue IMPOSSÍVEL
-- ============================================================================
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid; t uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'XC A', 100) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'XC B', 0)   returning id into b;
    t := public.criar_transferencia(a, b, 10, current_date, null, gen_random_uuid());

    update public.movimentacoes set valor = 99 where transferencia_id = t;
end $$;
rollback;
-- Esperado: 'Movimentação parte de uma transferência não pode ser editada
--            individualmente.'

-- ============================================================================
-- TESTE D [ERRO esperado] — excluir transferência de OUTRO usuário
-- ============================================================================
begin;
do $$
declare
    u        uuid := (select id from auth.users order by created_at limit 1);
    impostor uuid := gen_random_uuid();
    a uuid; b uuid; t uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'XD A', 100) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'XD B', 0)   returning id into b;
    t := public.criar_transferencia(a, b, 10, current_date, null, gen_random_uuid());

    perform set_config('request.jwt.claims', json_build_object('sub', impostor)::text, true);
    perform public.excluir_transferencia(t);
end $$;
rollback;
-- Esperado: 'Transferência não encontrada.'

-- ============================================================================
-- TESTE E [ERRO esperado] — excluir id inexistente / já excluída
-- ============================================================================
begin;
do $$
begin
    perform public.excluir_transferencia(gen_random_uuid());
end $$;
rollback;
-- Esperado: 'Transferência não encontrada.'

-- ============================================================================
-- TESTE F [OK esperado] — ciclo completo: criar → excluir → CRIAR DE NOVO
--                        com o mesmo request_id (edição manual na unha)
-- ============================================================================
-- ATENÇÃO: B começa com 100 porque a exclusão REVERTE os saldos ao original —
-- depois dela B volta a ter só o saldo inicial, então precisa de lastro para
-- ser origem da segunda transferência.
begin;
do $$
declare
    u   uuid := (select id from auth.users order by created_at limit 1);
    a   uuid; b uuid;
    req uuid := gen_random_uuid();
    t1  uuid; t2 uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'XF A', 500) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'XF B', 100) returning id into b;

    t1 := public.criar_transferencia(a, b, 50, current_date, null, req); -- A=450 B=150
    perform public.excluir_transferencia(t1);                            -- A=500 B=100

    -- Após excluir, o request_id antigo está livre de novo; nova chamada com
    -- ele cria uma transferência NOVA (o par request→operação acabou).
    t2 := public.criar_transferencia(b, a, 30, current_date, null, req); -- B=70 A=530

    raise notice 't2 novo? % | A = % | B = %',
        (t2 <> t1)::text,
        (select saldo_atual from public.contas where id = a),
        (select saldo_atual from public.contas where id = b);
end $$;
rollback;
-- Esperado: t2 novo? true | A = 530 | B = 70

-- ============================================================================
-- TESTE G [OK esperado] — REGRESSÃO: exclusão NÃO afetou caixinha nem
--                        lançamento comum (DELETE sem flag segue livre)
-- ============================================================================
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; m uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'XG', 0) returning id into a;

    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, tipo_op)
        values (a, u, current_date, 'comum', 100, 'Entrada') returning id into m;
    delete from public.movimentacoes where id = m;

    raise notice 'lançamento comum criado e excluído ok | saldo = % (esperado 0)',
        (select saldo_atual from public.contas where id = a);
end $$;
rollback;
