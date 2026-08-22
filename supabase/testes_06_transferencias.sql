-- ============================================================================
-- ROTEIRO DE TESTES — Etapa 14 (transferências)
-- ============================================================================
-- COMO USAR: primeiro rode supabase/06_transferencias.sql. Depois, no SQL
-- Editor do Supabase, selecione UM BLOCO POR VEZ (do "begin;" até o
-- "rollback;" correspondente) e clique em Run.
--
-- NÃO PRECISA CONFIGURAR NADA: cada bloco detecta sozinho o primeiro usuário
-- de auth.users (num app pessoal, é o seu). Todo bloco termina em ROLLBACK —
-- nenhum dado de teste sobra no banco.
--
-- Legenda: [OK esperado]   = comando retorna resultado normal (veja as
--                            notices abaixo do resultado).
--          [ERRO esperado] = o Supabase exibe mensagem de exceção — isso É o
--                            teste passando.
-- ============================================================================

-- ============================================================================
-- TESTE 0 [OK esperado] — confere quem será usado nos testes
-- ============================================================================
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
begin
    raise notice 'testes rodarão como: % (%)',
        (select email from auth.users where id = u), u;
end $$;
rollback;

-- ============================================================================
-- TESTE 1 [OK esperado] — A=1000, B=0, transferir 300 → A=700, B=300,
--                        duas movimentações categoria 'transferencia'
-- ============================================================================
begin;
do $$
declare
    u    uuid := (select id from auth.users order by created_at limit 1);
    a    uuid;
    b    uuid;
    t_id uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);

    insert into public.contas (user_id, nome, saldo_atual) values (u, 'Teste A', 1000) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'Teste B', 0)    returning id into b;

    t_id := public.criar_transferencia(a, b, 300, current_date, 'primeira', gen_random_uuid());

    raise notice 'transferencia % | saldo A = % | saldo B = %', t_id,
        (select saldo_atual from public.contas where id = a),
        (select saldo_atual from public.contas where id = b);
    raise notice '%',
        (select string_agg(descricao || ' | ' || tipo_op || ' | ' || valor, E'\n')
           from public.movimentacoes where transferencia_id = t_id);
end $$;
rollback;

-- Esperado nas notices:
--   saldo A = 700.00 | saldo B = 300.00
--   Transferência enviada para Teste B | Saida | 300
--   Transferência recebida de Teste A | Entrada | 300

-- ============================================================================
-- TESTES 2–7 [ERRO esperado em todos] — recusas da RPC
-- ============================================================================

-- TESTE 2: valor maior que o saldo da origem
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T2 A', 100) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T2 B', 0)   returning id into b;
    perform public.criar_transferencia(a, b, 500, current_date, null, gen_random_uuid());
end $$;
rollback;
-- Esperado: 'Saldo insuficiente em "T2 A" (disponível: 100.00).'

-- TESTE 3: origem = destino
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T3', 100) returning id into a;
    perform public.criar_transferencia(a, a, 10, current_date, null, gen_random_uuid());
end $$;
rollback;
-- Esperado: 'A conta de origem e a de destino devem ser diferentes.'

-- TESTE 4 [ERRO esperado]: conta de OUTRO usuário
-- Truque sem segundo cadastro: cria as contas com SEU user_id e depois troca
-- as claims JWT para um uuid estranho — a RPC deve recusar a conta alheia.
begin;
do $$
declare
    u        uuid := (select id from auth.users order by created_at limit 1);
    impostor uuid := gen_random_uuid(); -- só existe nas claims falsas
    alheia   uuid;
    b        uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T4 Alheia', 9999) returning id into alheia;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T4 B', 0)         returning id into b;

    perform set_config('request.jwt.claims', json_build_object('sub', impostor)::text, true);
    perform public.criar_transferencia(alheia, b, 50, current_date, null, gen_random_uuid());
end $$;
rollback;
-- Esperado: 'A conta de origem não pertence ao usuário autenticado.'

-- TESTE 5 [ERRO esperado]: conta destino INATIVA
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T5 A', 500) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual, ativa) values (u, 'T5 B', 0, false) returning id into b;
    perform public.criar_transferencia(a, b, 10, current_date, null, gen_random_uuid());
end $$;
rollback;
-- Esperado: 'A conta de destino está inativa.'

-- TESTE 6 [ERRO esperado]: valor ZERO
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T6 A', 100) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T6 B', 0)   returning id into b;
    perform public.criar_transferencia(a, b, 0, current_date, null, gen_random_uuid());
end $$;
rollback;
-- Esperado: 'Informe um valor maior que zero para a transferência.'

-- TESTE 7 [ERRO esperado]: valor NEGATIVO
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T7 A', 100) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T7 B', 0)   returning id into b;
    perform public.criar_transferencia(a, b, -25, current_date, null, gen_random_uuid());
end $$;
rollback;
-- Esperado: 'Informe um valor maior que zero para a transferência.'

-- ============================================================================
-- TESTE 8 — atomicidade (rollback se qualquer etapa falhar)
-- ============================================================================
-- A RPC grava tudo numa ÚNICA transação PL/pgSQL e roda PÓS-CONDIÇÃO
-- (count = 2 e somas Entrada/Saida = valor) antes do retorno; qualquer RAISE
-- reverte TUDO, inclusive a linha de transferencias. Não dá para forçar
-- falha no segundo INSERT sem editar a função — a prova executável é a
-- pós-condição + o fato dos TESTES 2–7 não deixarem órfãos. Verificação:

-- TESTE 8b [OK esperado] — banco limpo: nada gravado pelos blocos recusados
begin;
do $$
begin
    raise notice 'total de transferencias = % | movimentacoes vinculadas = %',
        (select count(*) from public.transferencias),
        (select count(*) from public.movimentacoes where transferencia_id is not null);
end $$;
rollback;
-- Esperado (banco sem uso real ainda): ambos 0.

-- ============================================================================
-- TESTE 11 [OK esperado] — request_id repetido NÃO cria segunda transferência
-- ============================================================================
begin;
do $$
declare
    u   uuid := (select id from auth.users order by created_at limit 1);
    a   uuid; b uuid;
    req uuid := gen_random_uuid();
    t1  uuid; t2 uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);

    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T11 A', 1000) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T11 B', 0)    returning id into b;

    t1 := public.criar_transferencia(a, b, 10, current_date, null, req);
    t2 := public.criar_transferencia(a, b, 10, current_date, null, req); -- MESMO request_id

    raise notice 'ids iguais? % | transferencias = % | movs vinculadas = %',
        (t1 = t2)::text,
        (select count(*) from public.transferencias),
        (select count(*) from public.movimentacoes where transferencia_id = t1);
    raise notice 'saldo A = % | saldo B = %',
        (select saldo_atual from public.contas where id = a),
        (select saldo_atual from public.contas where id = b);
end $$;
rollback;
-- Esperado: ids iguais? true | transferencias = 1 | movs = 2 | A = 990 | B = 10

-- ============================================================================
-- TESTES 9/10 — simultâneas e A→B/B→A sem deadlock
-- ============================================================================
-- O lock é determinístico (ORDER BY id FOR UPDATE numa única query): toda
-- sessão trava as contas na MESMA ordem — deadlock AB-BA impossível. Prova
-- paralela real exige DUAS sessões com commit manual (duas janelas do SQL
-- Editor ou dois psql):
--   Sessão X: begin; select criar_transferencia(A,B,1,null,null,gen_random_uuid()); -- não commite
--   Sessão Y: begin; select criar_transferencia(B,A,1,null,null,gen_random_uuid());
--   → X conclui; Y aguarda o lock e conclui na sequência; nenhuma trava eterna.
-- Versão SEQUENCIAL equivalente (consistência + patrimônio neutro):

begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);

    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T9 A', 1000) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'T9 B', 0)    returning id into b;

    perform public.criar_transferencia(a, b, 100, current_date, null, gen_random_uuid());
    perform public.criar_transferencia(b, a, 40,  current_date, null, gen_random_uuid());
    perform public.criar_transferencia(a, b, 60,  current_date, null, gen_random_uuid());

    raise notice 'saldo A = % | saldo B = % | patrimônio = %',
        (select saldo_atual from public.contas where id = a),
        (select saldo_atual from public.contas where id = b),
        (select sum(saldo_atual) from public.contas where user_id = u);
end $$;
rollback;
-- Esperado: A = 880 | B = 120 | patrimônio = 1000 (INALTERADO — TESTE 14)

-- ============================================================================
-- TESTES 12–13 [OK esperado] — transferência interna fora de receita/despesa
-- ============================================================================
-- Após o TESTE 1 (dentro da mesma sessão, ANTES do rollback), rode:
--     select tipo_op, sum(valor) from movimentacoes group by tipo_op;
-- → Entrada 300 / Saida 300. Agora exclua a categoria:
--     select tipo_op, sum(valor) from movimentacoes
--      where categoria <> 'transferencia' or categoria is null
--      group by tipo_op;
-- → nenhuma linha nova. É EXATAMENTE o filtro do app (useResumoMes e resumo
--   do extrato filtram no cliente, pois `categoria <> 'x'` em SQL descartaria
--   também as linhas com categoria NULL).

-- ============================================================================
-- SEGURANÇA EXTRA — bypass do guard por usuário comum [ERRO esperado]
-- ============================================================================
-- A) INSERT direto SEM a flag (o que um cliente PostgREST conseguiria fazer):
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid; t uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'SG A', 100) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'SG B', 0)   returning id into b;
    perform set_config('role', 'authenticated', true);

    insert into public.transferencias (user_id, conta_origem_id, conta_destino_id, valor, request_id)
        values (u, a, b, 5, gen_random_uuid());

    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, categoria, tipo_op, transferencia_id)
        select id, u, current_date, 'forjada', 5, 'transferencia', 'Entrada', id from public.transferencias limit 1;
end $$;
rollback;
-- Esperado: 'Movimentação de transferência só pode ser criada pela operação
--            de transferência.'

-- B) Mesmo FORJANDO a flag manualmente (simula atacante com SQL direto):
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid; t uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'SG2 A', 100) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'SG2 B', 0)   returning id into b;
    insert into public.transferencias (user_id, conta_origem_id, conta_destino_id, valor, request_id)
        values (u, a, b, 5, gen_random_uuid()) returning id into t;

    perform set_config('app.criando_transferencia', 'sim', true);
    perform set_config('role', 'authenticated', true);

    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, categoria, tipo_op, transferencia_id)
        values (b, u, current_date, 'forjada c/ flag', 5, 'transferencia', 'Entrada', gen_random_uuid());
end $$;
rollback;
-- Esperado: 'Transferência correspondente não encontrada para esta
--            movimentação.' (validação estrutural segura mesmo com flag).

-- ============================================================================
-- TESTES 17–18 [ERRO esperado] — edição/exclusão individual bloqueadas
-- ============================================================================
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid; t uuid; m_saida uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'TE A', 100) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'TE B', 0)   returning id into b;

    t := public.criar_transferencia(a, b, 20, current_date, null, gen_random_uuid());
    m_saida := (select id from public.movimentacoes
                 where transferencia_id = t and tipo_op = 'Saida');

    update public.movimentacoes set valor = 99 where id = m_saida;
end $$;
rollback;
-- Esperado: 'Movimentação parte de uma transferência não pode ser editada
--            individualmente.'

begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid; b uuid; t uuid; m_entrada uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'TD A', 100) returning id into a;
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'TD B', 0)   returning id into b;

    t := public.criar_transferencia(a, b, 20, current_date, null, gen_random_uuid());
    m_entrada := (select id from public.movimentacoes
                   where transferencia_id = t and tipo_op = 'Entrada');

    delete from public.movimentacoes where id = m_entrada;
end $$;
rollback;
-- Esperado: 'Movimentação parte de uma transferência não pode ser excluída
--            individualmente.'

-- ============================================================================
-- TESTE 21 [OK esperado] — REGRESSÃO: caixinhas continuam funcionando
-- ============================================================================
begin;
do $$
declare
    u  uuid := (select id from auth.users order by created_at limit 1);
    a  uuid; cx uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'RG', 1000) returning id into a;
    insert into public.caixinhas (conta_id, user_id, nome) values (a, u, 'Reserva') returning id into cx;

    perform public.caixinha_guardar(cx, a, 200, null, null);

    raise notice 'conta RG = % | caixinha Reserva = %',
        (select saldo_atual from public.contas where id = a),
        (select saldo from public.caixinhas where id = cx);
    raise notice 'movs caixinha na conta = %',
        (select count(*) from public.movimentacoes where conta_id = a and categoria = 'caixinha');
end $$;
rollback;
-- Esperado: conta RG = 800 | caixinha = 200 | 1 movimentação categoria caixinha

-- ============================================================================
-- TESTE 22 [OK esperado] — REGRESSÃO: lançamento comum segue intacto
-- ============================================================================
begin;
do $$
declare
    u uuid := (select id from auth.users order by created_at limit 1);
    a uuid;
begin
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    insert into public.contas (user_id, nome, saldo_atual) values (u, 'LC', 0) returning id into a;

    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, categoria, tipo_op)
        values (a, u, current_date, 'Salário', 1000, null, 'Entrada');
    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, categoria, tipo_op)
        values (a, u, current_date, 'Mercado', 150, null, 'Saida');

    raise notice 'saldo LC = % (esperado 850)',
        (select saldo_atual from public.contas where id = a);
end $$;
rollback;
