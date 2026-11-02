-- ============================================================================
-- MIGRATION 51 — editar só a DATA da compra reposiciona a parcela na fatura
-- (02/11/2026)
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. IDEMPOTENTE.
--
-- CONTEXTO (módulo Cartões): editar a DATA de uma compra deixava a compra na
-- fatura ANTIGA. Ex.: "Seguro do carro - Mapfre (6/10)" com a data alterada
-- para 01/11/2026 continuava aparecendo na fatura de 12/2026.
--
-- CAUSA: `editar_compra` (12/16b/33) só recalcula as parcelas quando valor ou
-- nº de parcelas muda (v_mudou_valor). Quando mudam só descrição/data, ela
-- dá retornos antecipados logo após `update public.compras` (linha 245 da
-- migration 12): a data da compra é gravada, mas `parcelas.mes_fatura` continua
-- derivado da data ANTIGA — a compra fica na fatura errada sem aviso.
--
-- CORREÇÃO: no ramo "não mudou valor", se a DATA mudou, recalcula o mês-base
-- pela regra do fechamento (`calcular_mes_fatura`, migration 10) e
-- reposiciona TODAS as parcelas da compra para `mês-base + (numero - 1)`.
--   - A divisão de valores entre parcelas não muda (não são regeradas).
--   - Se a data mudou mas o mês-base é o mesmo (ex.: 01/11 → 10/11 com
--     fechamento no dia 15), nenhuma parcela é mexida.
--   - Regra de segurança da mudança de valor vale também aqui: bloqueia se
--     ALGUMA fatura afetada (meses atuais ou novos) já tem pagamento —
--     fatura paga não pode mudar de valor nem de composição.
--
-- `criar_compra` não muda. `excluir_compra` não muda.
--
-- TESTES no fim (bloco DO autocontido que cria e limpa o cenário).
-- ============================================================================

-- ============================================================================
-- RPC: editar_compra (mesma assinatura da migration 33)
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
    v_base_antigo   text;
    v_data_antiga   date;
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
           c.n_parcelas,
           c.data
      into v_cartao_id, v_valor_antigo, v_n_antigo, v_data_antiga
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
        -- Valor/nº de parcelas iguais: as parcelas NÃO são regeradas. Mas se a
        -- DATA mudou, o mês-base pode mudar — reposiciona as parcelas na
        -- fatura certa (a divisão de valor entre elas continua válida).
        if v_data_compra is not distinct from v_data_antiga then
            return;  -- só a descrição/categoria mudou: nada a fazer.
        end if;

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

        v_mes_base := public.calcular_mes_fatura(v_data_compra, v_dia_fech);

        -- Mês-base atual = mês da parcela 1.
        select min(mes_fatura) into v_base_antigo
          from public.parcelas
         where compra_id = p_compra_id;

        if v_base_antigo is null then
            raise exception 'Compra sem parcelas registradas.';
        end if;

        if v_base_antigo <> v_mes_base then
            -- Meses afetados: os atuais + os novos (mês-base novo + numero-1).
            select coalesce(array_agg(distinct mes_fatura), array[]::text[])
              into v_meses_afet
              from public.parcelas
             where compra_id = p_compra_id;

            for i in 1 .. v_n_antigo loop
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
                raise exception 'Não é possível mudar a data: uma das faturas afetadas (meses %) já possui pagamento. A fatura paga não pode mudar.', array_to_string(v_meses_afet, ', ');
            end if;

            for i in 1 .. v_n_antigo loop
                v_ano := split_part(v_mes_base, '-', 1)::integer;
                v_mes  := split_part(v_mes_base, '-', 2)::integer;
                v_mes  := v_mes + (i - 1);
                v_ano  := v_ano + ((v_mes - 1) / 12);
                v_mes  := ((v_mes - 1) % 12) + 1;

                update public.parcelas
                   set mes_fatura = format('%s-%s', v_ano, lpad(v_mes::text, 2, '0'))
                 where compra_id = p_compra_id
                   and numero = i;
            end loop;
        end if;
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

revoke all on function public.editar_compra(uuid, date, text, numeric, integer, text) from public;
grant execute on function public.editar_compra(uuid, date, text, numeric, integer, text) to authenticated;


-- ============================================================================
-- TESTES (cenário sintético; assert aborta tudo e limpa no fim)
-- ============================================================================
do $$
declare
    v_user   uuid;
    v_conta  uuid;
    v_cartao uuid;
    v_compra uuid;
    v_err    text;
    v_role   text;
begin
    -- Papel de quem rodou o script (SQL Editor), para restaurar no fim —
    -- auth.users não aceita DELETE do papel 'authenticated'.
    v_role := current_user;

    -- Usuário fictício (FK de contas precisa de auth.users).
    v_user := '51515151-5151-5151-5151-515151515151'::uuid;
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
    values (v_user, 'user_teste_51@test.com', '{}', '{}', 'authenticated', 'authenticated')
    on conflict (id) do nothing;

    -- Contexto de autenticação para chamar as RPCs.
    perform set_config('request.jwt.claims',
        json_build_object('sub', v_user)::text, true);
    perform set_config('role', 'authenticated', true);

    -- Limpeza de cenário anterior (re-execução).
    delete from public.fatura_pagamentos where user_id = v_user;
    delete from public.parcelas where user_id = v_user;
    delete from public.compras where user_id = v_user;
    delete from public.cartoes where user_id = v_user;
    delete from public.contas where user_id = v_user;

    -- Conta e cartão com fechamento dia 15.
    insert into public.contas (user_id, nome, tipo, saldo_atual)
    values (v_user, 'TESTE_51_CONTA', 'corrente', 0)
    returning id into v_conta;

    insert into public.cartoes (user_id, conta_id, nome, limite, dia_fechamento, dia_vencimento)
    values (v_user, v_conta, 'TESTE_51_CARTAO', 0, 15, 20)
    returning id into v_cartao;

    -- T1: compra à vista 25/11 (fech. 15 → fatura 2026-12); editar a data
    -- para 10/11 reposiciona a parcela para a fatura 2026-11.
    perform public.criar_compra(v_cartao, date '2026-11-25', 'TESTE_51_AVISTA', 100.00, 1);
    select id into v_compra from public.compras where user_id = v_user;
    perform public.editar_compra(v_compra, date '2026-11-10', 'TESTE_51_AVISTA', 100.00, 1);

    if (select mes_fatura from public.parcelas where compra_id = v_compra) <> '2026-11' then
        raise exception 'TESTE_51 T1: parcela ficou em %, esperado 2026-11',
            (select mes_fatura from public.parcelas where compra_id = v_compra);
    end if;
    if (select data from public.compras where id = v_compra) <> date '2026-11-10' then
        raise exception 'TESTE_51 T1: data da compra não foi gravada.';
    end if;

    -- T2: compra em 2x no dia 28/12 (fech. 15 → base 2027-01); editar para
    -- 10/12 reposiciona TODAS as parcelas (2026-12 e 2027-01) e mantém a
    -- divisão de valores (100,51 → 50,26 + 50,25; resto nas primeiras).
    delete from public.parcelas where user_id = v_user;
    delete from public.compras where user_id = v_user;
    perform public.criar_compra(v_cartao, date '2026-12-28', 'TESTE_51_2X', 100.51, 2);
    select id into v_compra from public.compras where user_id = v_user;
    perform public.editar_compra(v_compra, date '2026-12-10', 'TESTE_51_2X', 100.51, 2);

    if (select array_agg(mes_fatura order by numero)
          from public.parcelas where compra_id = v_compra)
       <> array['2026-12', '2027-01'] then
        raise exception 'TESTE_51 T2: parcelas ficaram em %',
            (select array_agg(mes_fatura order by numero)
               from public.parcelas where compra_id = v_compra);
    end if;
    if (select array_agg(valor order by numero)
          from public.parcelas where compra_id = v_compra)
       <> array[50.26::numeric(12,2), 50.25::numeric(12,2)] then
        raise exception 'TESTE_51 T2: divisão de valores foi alterada %',
            (select array_agg(valor order by numero)
               from public.parcelas where compra_id = v_compra);
    end if;

    -- T3: mudança de data DENTRO do mesmo ciclo (02/11 → 10/11 com fech. 15)
    -- não reposiciona (mesmo mês-base) e nem reclama.
    delete from public.parcelas where user_id = v_user;
    delete from public.compras where user_id = v_user;
    perform public.criar_compra(v_cartao, date '2026-11-02', 'TESTE_51_MESMO_CICLO', 80.00, 1);
    select id into v_compra from public.compras where user_id = v_user;
    perform public.editar_compra(v_compra, date '2026-11-10', 'TESTE_51_MESMO_CICLO', 80.00, 1);

    if (select mes_fatura from public.parcelas where compra_id = v_compra) <> '2026-11' then
        raise exception 'TESTE_51 T3: parcela ficou em %, esperado 2026-11',
            (select mes_fatura from public.parcelas where compra_id = v_compra);
    end if;

    -- T4: fatura paga no destino BLOQUEIA a mudança de data (fatura paga
    -- não pode mudar).
    delete from public.parcelas where user_id = v_user;
    delete from public.compras where user_id = v_user;
    perform public.criar_compra(v_cartao, date '2026-11-25', 'TESTE_51_PAGA', 90.00, 1);
    select id into v_compra from public.compras where user_id = v_user;

    insert into public.fatura_pagamentos (user_id, cartao_id, mes_fatura, valor_pago, data_pagamento)
    values (v_user, v_cartao, '2026-12', 90.00, date '2026-12-20');

    begin
        perform public.editar_compra(v_compra, date '2026-11-10', 'TESTE_51_PAGA', 90.00, 1);
        raise exception 'TESTE_51 T4: edição de data em fatura paga DEVERIA ter sido bloqueada.';
    exception
        when others then
            v_err := sqlerrm;
            if v_err not like 'Não é possível mudar a data:%' then
                raise exception 'TESTE_51 T4: exceção inesperada (%)', v_err;
            end if;
    end;

    -- T5: mudar SÓ a descrição (data igual) continua sem tocar nas parcelas.
    delete from public.parcelas where user_id = v_user;
    delete from public.compras where user_id = v_user;
    delete from public.fatura_pagamentos where user_id = v_user;
    perform public.criar_compra(v_cartao, date '2026-11-25', 'TESTE_51_DESC', 70.00, 1);
    select id into v_compra from public.compras where user_id = v_user;
    perform public.editar_compra(v_compra, date '2026-11-25', 'TESTE_51_NOVA_DESC', 70.00, 1);

    if (select mes_fatura from public.parcelas where compra_id = v_compra) <> '2026-12' then
        raise exception 'TESTE_51 T5: parcela ficou em %, esperado 2026-12',
            (select mes_fatura from public.parcelas where compra_id = v_compra);
    end if;
    if (select descricao from public.compras where id = v_compra) <> 'TESTE_51_NOVA_DESC' then
        raise exception 'TESTE_51 T5: descrição não foi atualizada.';
    end if;

    -- Restaura o papel original e limpa o usuário fictício.
    perform set_config('role', v_role, true);
    perform set_config('request.jwt.claims', '', true);
    delete from auth.users where id = v_user;

    raise notice 'TESTES 51 OK: T1–T5 passaram; cenário limpo.';
exception
    when others then
        v_err := sqlerrm;
        raise notice 'TESTES 51 FALHOU: %', v_err;
        -- Limpeza best effort (o cenário é todo seu: user TESTE_51).
        begin
            delete from public.fatura_pagamentos where user_id = v_user;
            delete from public.parcelas where user_id = v_user;
            delete from public.compras where user_id = v_user;
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
