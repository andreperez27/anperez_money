-- ============================================================================
-- MIGRATION 52 — rótulo "(n/total)" só para série PARCELADA: APLICAÇÃO EFETIVA
-- + LIMPEZA das compras já criadas de séries recorrentes (02/11/2026)
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. IDEMPOTENTE.
--
-- CONTEXTO: a migration 40 (23/09/2026) restringiu o rótulo "(n/total)" da
-- compra realizada em cartão às séries PARCELADAS — recorrente mensal (Xbox/
-- Netflix/HBO Max) realiza com a descrição PURA, porque o contador (2/24)
-- não é parcela de dívida e só polui o extrato. MAS a 40 nunca foi aplicada
-- no banco: a função viva continuou sendo a versão sem restrição (35/37) e
-- compras RECORRENTE continuaram nascendo com sufixo
--   "Netflix (3/24)", "HBO Max (2/3)"
--
-- MIGRAÇÃO AUTOCONTIDA (reaplica o corpo da 40 — as duas juntas são iguais):
--   1. realizar_planejamento_cartao: sufixo "(n/total)" SÓ quando
--      serie_id + parcela_numero + total_parcelas preenchidos E origem da
--      linha <> 'recorrente' (parceladas: Seguro 4/10 etc.);
--   2. BACKFILL: compras VINCULADAS a previsões de origem='recorrente'
--      (lancamento_tipo='compra' + lancamento_id) perdem o sufixo " (i/N)"
--      do FIM da descrição (regexp ancorado no fim — não toca parênteses
--      legítimos no meio, ex. "Savasporte (calça p/ trabalho)"; não toca
--      compras de série parcelada, ex. "Seguro do carro - Mapfre (6/10)").
--
-- Histórico das compras (criado_em/valor) não muda; o vínculo com o
-- planejamento fica de pé — o rótulo "n/N" da LISTA do Planejamento vem de
-- parcela_numero/total_parcelas, não da descrição.
--
-- TESTES no fim (bloco DO autocontido que cria e limpa o cenário).
-- ============================================================================

-- ============================================================================
-- 1. RPC: realizar_planejamento_cartao (corpo idêntico à migration 40)
-- ============================================================================
drop function if exists public.realizar_planejamento_cartao(uuid, uuid, numeric, date);

create or replace function public.realizar_planejamento_cartao(
    p_planejamento_id uuid,
    p_cartao_id       uuid,
    p_valor_real      numeric default null,
    p_data_compra     date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user          uuid := auth.uid();
    v_data          date := coalesce(p_data_compra, current_date);
    v_descricao     text;
    v_valor         numeric(12, 2);
    v_tipo_op       text;
    v_categoria     text;
    v_serie_id      uuid;
    v_parcela       integer;
    v_total_parcelas integer;
    v_origem        text;
    v_cartao_conta  uuid;
    v_compra_id     uuid;
begin
    -- 1. Autenticação
    if v_user is null then
        raise exception 'Sessão sem usuário autenticado.';
    end if;

    -- 2. Parâmetros básicos
    if p_planejamento_id is null then
        raise exception 'Informe o planejamento a realizar.';
    end if;
    if p_cartao_id is null then
        raise exception 'Informe o cartão de destino.';
    end if;

    -- 3. Previsão a realizar (FOR UPDATE — lock determinístico contra uma
    --    segunda efetivação concorrente da mesma linha, como na migration 16).
    select descricao, valor, tipo_op, categoria, serie_id, parcela_numero, total_parcelas, origem
      into v_descricao, v_valor, v_tipo_op, v_categoria, v_serie_id, v_parcela, v_total_parcelas, v_origem
      from public.planejamentos
     where id = p_planejamento_id
       and user_id = v_user
     for update;

    if not found then
        raise exception 'Planejamento não encontrado ou não pertence ao usuário.';
    end if;

    -- 3b. Descrição da COMPRA: parcela de SÉRIE PARCELADA ganha o rótulo
    --     "(n/total)" no extrato do cartão (decisão 14/09/2026, restrita em
    --     23/09/2026). Recorrente mensal (origem='recorrente') realiza com a
    --     descrição pura — o contador (2/24) não é parcela e polui o extrato.
    --     A compra continua avulsa (n_parcelas=1): não há integração entre o
    --     parcelamento do Planejamento (serie_id/parcela_numero) e o do
    --     Cartões (criar_compra) — o rótulo é SÓ texto da descrição. Avulsa
    --     comum (serie_id nulo) segue sem parênteses, como antes.
    if v_serie_id is not null
       and v_parcela is not null
       and v_total_parcelas is not null
       and (v_origem is null or v_origem <> 'recorrente') then
        v_descricao := v_descricao
                       || ' (' || v_parcela::text || '/' || v_total_parcelas::text || ')';
    end if;

    -- 4. Só 'previsto' realiza (idempotente; 'cancelado' não reativa aqui).
    if (select estado from public.planejamentos where id = p_planejamento_id) <> 'previsto' then
        raise exception 'Apenas previsões em estado "previsto" podem ser realizadas.';
    end if;

    -- 5. Valor efetivo (padrão: o valor previsto).
    v_valor := coalesce(p_valor_real, v_valor);
    if v_valor is null or v_valor <= 0 then
        raise exception 'Valor da realização deve ser maior que zero.';
    end if;

    -- 6. A realização em cartão é de SAÍDA (despesa); receita não faz sentido.
    if v_tipo_op <> 'Saida' then
        raise exception 'A realização em cartão é válida apenas para despesas (Saida).';
    end if;

    -- 7. Validar o cartão (dono + ativo) e capturar a conta vinculada
    --    (lock determinístico, mesmo padrão do criar_compra/pagar_fatura).
    select c.conta_id
      into v_cartao_conta
      from public.cartoes c
     where c.id = p_cartao_id
       and c.user_id = v_user
       and c.ativo = true
     for update;

    if not found then
        raise exception 'Cartão não encontrado, inativo ou não pertence ao usuário.';
    end if;

    -- 8. Criar a compra no cartão reutilizando a RPC atômica criar_compra
    --    (migration 11/33) com n_parcelas=1 → à vista, UMA parcela na fatura.
    --    A descrição já carrega o rótulo "(n/total)" quando é parcela de
    --    série PARCELADA (passo 3b); a categoria da previsão é repassada
    --    (p_categoria) para a compra nascer já categorizada (migration 35).
    v_compra_id := public.criar_compra(
        p_cartao_id,
        v_data,
        v_descricao,
        v_valor,
        1,
        v_categoria
    );

    -- 9. Marcar a previsão como realizada no cartão. lancamento_tipo='compra'
    --    informa que lancamento_id aponta para compras.id. Tudo na mesma
    --    transação: se este UPDATE falhar, a compra criada no passo 8 é
    --    desfeita junto (rollback).
    update public.planejamentos
       set estado = 'realizado',
           lancamento_tipo = 'compra',
           lancamento_id = v_compra_id,
           conta_destino_id = v_cartao_conta
     where id = p_planejamento_id;

    -- 10. Devolve o id da compra criada (feedback útil para a UI).
    return v_compra_id;
end;
$$;

revoke all on function public.realizar_planejamento_cartao(uuid, uuid, numeric, date) from public;
grant execute on function public.realizar_planejamento_cartao(uuid, uuid, numeric, date) to authenticated;


-- ============================================================================
-- 2. BACKFILL: recorrentes já lançadas perdem o sufixo "(i/N)" do fim
-- ============================================================================
update public.compras c
   set descricao = regexp_replace(c.descricao, ' \(\d+/\d+\)$', '')
  from public.planejamentos p
 where p.lancamento_tipo = 'compra'
   and p.lancamento_id = c.id
   and p.origem = 'recorrente'
   and c.descricao ~ ' \(\d+/\d+\)$';


-- ============================================================================
-- TESTES (cenário sintético; assert aborta tudo e limpa no fim)
-- ============================================================================
do $$
declare
    v_user    uuid;
    v_conta   uuid;
    v_cartao  uuid;
    v_plan    uuid;
    v_compra  uuid;
    v_err     text;
    v_desc    text;
    v_teste   text;
    v_role    text;
    v_serie   uuid := 'b1c2d3e4-1111-4222-8333-444455556666';
begin
    -- Papel de quem rodou o script (SQL Editor), para restaurar no fim —
    -- auth.users não aceita DELETE do papel 'authenticated'.
    v_role := current_user;
    -- Usuário fictício (FK de contas precisa de auth.users).
    v_user := '52525252-5252-5252-5252-525252525252'::uuid;
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
    values (v_user, 'user_teste_52@test.com', '{}', '{}', 'authenticated', 'authenticated')
    on conflict (id) do nothing;

    -- Contexto de autenticação para chamar as RPCs.
    perform set_config('request.jwt.claims',
        json_build_object('sub', v_user)::text, true);
    perform set_config('role', 'authenticated', true);

    -- Limpeza de cenário anterior (re-execução).
    delete from public.fatura_pagamentos where user_id = v_user;
    delete from public.parcelas where user_id = v_user;
    delete from public.compras where user_id = v_user;
    delete from public.planejamentos where user_id = v_user;
    delete from public.cartoes where user_id = v_user;
    delete from public.contas where user_id = v_user;

    -- Conta e cartão com fechamento dia 15.
    insert into public.contas (user_id, nome, tipo, saldo_atual)
    values (v_user, 'TESTE_52_CONTA', 'corrente', 0)
    returning id into v_conta;

    insert into public.cartoes (user_id, conta_id, nome, limite, dia_fechamento, dia_vencimento)
    values (v_user, v_conta, 'TESTE_52_CARTAO', 0, 15, 20)
    returning id into v_cartao;

    -- T1: RECURRENTE com série/parcelas → compra SEM sufixo.
    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado,
         ano_semana, semana, origem, serie_id, parcela_numero, total_parcelas)
    values
        (v_user, 'Saida', 'TESTE_52_RECORRENTE', 20, date '2026-11-05', 'previsto',
         2026, 45, 'recorrente', v_serie, 3, 24)
    returning id into v_plan;

    v_compra := public.realizar_planejamento_cartao(v_plan, v_cartao);
    select descricao INTO v_desc from public.compras where id = v_compra;
    if v_desc <> 'TESTE_52_RECORRENTE' then
        raise exception 'TESTE_52 T1: recorrente ficou "%", esperado descrição pura', v_desc;
    end if;

    -- T2: PARCELADA (origem 'manual') → compra COM sufixo "(3/24)".
    delete from public.parcelas where user_id = v_user;
    delete from public.compras where user_id = v_user;
    delete from public.planejamentos where user_id = v_user and estado = 'realizado';

    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado,
         ano_semana, semana, origem, serie_id, parcela_numero, total_parcelas)
    values
        (v_user, 'Saida', 'TESTE_52_PARCELADA', 30, date '2026-11-05', 'previsto',
         2026, 45, 'manual', v_serie, 3, 24)
    returning id into v_plan;

    v_compra := public.realizar_planejamento_cartao(v_plan, v_cartao);
    select descricao INTO v_desc from public.compras where id = v_compra;
    if v_desc <> 'TESTE_52_PARCELADA (3/24)' then
        raise exception 'TESTE_52 T2: parcelada ficou "%", esperado "TESTE_52_PARCELADA (3/24)"', v_desc;
    end if;

    -- T3: AVULSA (sem série) → compra SEM sufixo.
    delete from public.parcelas where user_id = v_user;
    delete from public.compras where user_id = v_user;
    delete from public.planejamentos where user_id = v_user and estado = 'realizado';

    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado,
         ano_semana, semana, origem)
    values
        (v_user, 'Saida', 'TESTE_52_AVULSA', 15, date '2026-11-05', 'previsto',
         2026, 45, 'manual')
    returning id into v_plan;

    v_compra := public.realizar_planejamento_cartao(v_plan, v_cartao);
    select descricao INTO v_desc from public.compras where id = v_compra;
    if v_desc <> 'TESTE_52_AVULSA' then
        raise exception 'TESTE_52 T3: avulsa ficou "%", esperado descrição pura', v_desc;
    end if;

    -- T4: BACKFILL — o regexp da limpeza tira " (i/N)" do FIM e não toca em
    -- parênteses legítimos ("Savasporte (calça p/ trabalho)").
    v_teste := regexp_replace('Netflix (3/24)', ' \(\d+/\d+\)$', '');
    if v_teste <> 'Netflix' then
        raise exception 'TESTE_52 T4a: regexp ficou "%", esperado "Netflix"', v_teste;
    end if;
    v_teste := regexp_replace('Savasporte (calça p/ trabalho)', ' \(\d+/\d+\)$', '');
    if v_teste <> 'Savasporte (calça p/ trabalho)' then
        raise exception 'TESTE_52 T4b: parênteses legítimos foram tocados (%)', v_teste;
    end if;

    -- Limpeza.
    delete from public.fatura_pagamentos where user_id = v_user;
    delete from public.parcelas where user_id = v_user;
    delete from public.compras where user_id = v_user;
    delete from public.planejamentos where user_id = v_user;
    delete from public.cartoes where user_id = v_user;
    delete from public.contas where user_id = v_user;
    perform set_config('role', v_role, true);
    perform set_config('request.jwt.claims', '', true);
    delete from auth.users where id = v_user;

    raise notice 'TESTES 52 OK: T1–T4 passaram; cenário limpo.';
exception
    when others then
        v_err := sqlerrm;
        raise notice 'TESTES 52 FALHOU: %', v_err;
        -- Limpeza best effort.
        begin
            delete from public.fatura_pagamentos where user_id = v_user;
            delete from public.parcelas where user_id = v_user;
            delete from public.compras where user_id = v_user;
            delete from public.planejamentos where user_id = v_user;
            delete from public.cartoes where user_id = v_user;
            delete from public.contas where user_id = v_user;
            perform set_config('role', v_role, true);
            perform set_config('request.jwt.claims', '', true);
            delete from auth.users where id = v_user;
        exception when others then
            raise notice 'Aviso: limpeza de dados de teste falhou: %', sqlerrm;
        end;
        raise;
end $$;
