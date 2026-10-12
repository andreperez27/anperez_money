-- ============================================================================
-- MIGRATION 42 — editar/excluir lançamentos de caixinha (pedido 23/09/2026)
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. ADITIVO e
-- seguro de reexecutar (IF NOT EXISTS / create or replace / on conflict).
--
-- 1) VÍNCULO com a conta (só guardar/resgatar têm contrapartida):
--    caixinha_movimentacoes.lancamento_id → movimentacoes.id
--    (ON DELETE SET NULL). Backfill UMA vez, SÓ quando o par é único
--    (mesma conta, data, valor e descrição automática): ambíguos ficam
--    NULL. Guardar/resgatar antigos SEM vínculo: as RPCs abaixo RECUSAM
--    editar/excluir com mensagem clara (sem adivinhar contrapartida).
-- 2) caixinha_guardar / caixinha_resgatar passam a gravar o vínculo
--    (mesmos corpos da migration 04 + returning id; nada mais muda).
-- 3) RPCs novas (atômicas, security definer, mesmas validações de saldo de
--    guardar/resgatar, com mensagem dizendo QUAL saldo travaria):
--      caixinha_editar_movimento (valor/data/descricao; NULL = mantém.
--        Trocar tipo fica FORA — excluir + relançar, padrão do app).
--      caixinha_excluir_movimento.
--    Regras: editar move só o DELTA; data propaga para a contrapartida;
--    descrição só propaga se ainda for a automática; taxa/rendimento mexem
--    só em caixinhas.saldo (sem conta). O trigger trg_atualizar_saldo
--    (FASE 3b) JÁ trata UPDATE/DELETE de movimentacoes — por isso as RPCs
--    NÃO encostam em contas.saldo_atual: só validam (com trava) e atualizam
--    a linha da contrapartida; o trigger aplica o delta/a reversão.
--    caixinhas.saldo não tem trigger: ali o ajuste continua manual.
-- 4) TESTES no fim do arquivo (bloco DO autocontido que se limpa).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Coluna de vínculo
-- ----------------------------------------------------------------------------
alter table public.caixinha_movimentacoes
  add column if not exists lancamento_id uuid references public.movimentacoes(id) on delete set null;

comment on column public.caixinha_movimentacoes.lancamento_id is
  'Contrapartida na conta corrente (só guardar/resgatar). NULL = sem vínculo (ambíguo ou antigo): edição/exclusão recusada.';

-- ----------------------------------------------------------------------------
-- 2. Backfill UMA vez, só par único (conta + data + valor + descrição auto)
-- ----------------------------------------------------------------------------
update public.caixinha_movimentacoes cm
   set lancamento_id = m.id
  from public.caixinhas cx
  join public.movimentacoes m
    -- ON só entre tabelas do FROM: a tabela-alvo (cm) NÃO pode aparecer
    -- aqui (erro 42P01). Os predicados com cm ficam no WHERE abaixo,
    -- com semântica idêntica (inner join).
    on m.conta_id = cx.conta_id
 where cm.caixinha_id = cx.id
   and cm.tipo in ('guardar', 'resgatar')
   and cm.lancamento_id is null
   and m.user_id = cm.user_id
   and m.data = cm.data
   and m.valor = cm.valor
   and m.categoria = 'caixinha'
   and m.descricao in ('Guardado na caixinha ' || cx.nome, 'Resgate da caixinha ' || cx.nome)
   and not exists (
     select 1
       from public.caixinhas cx2
       join public.movimentacoes m2
         on m2.conta_id = cx2.conta_id
      -- Mesma regra do ON externo: referências de fora (cm, m) ficam no
      -- WHERE da subquery (correlação clássica, sempre válida).
      where cx2.id = cm.caixinha_id
        and m2.user_id = cm.user_id
        and m2.data = cm.data
        and m2.valor = cm.valor
        and m2.categoria = 'caixinha'
        and m2.descricao in ('Guardado na caixinha ' || cx2.nome, 'Resgate da caixinha ' || cx2.nome)
        and m2.id <> m.id
   );

-- ----------------------------------------------------------------------------
-- 3. guardar/resgatar gravando o vínculo (mesmos corpos da migration 04)
-- ----------------------------------------------------------------------------

create or replace function public.caixinha_guardar(
    p_caixinha_id uuid,
    p_conta_id    uuid,
    p_valor       numeric,
    p_descricao   text default null,
    p_data        date default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_nome          text;
    v_saldo_conta   numeric;
    v_mov_id        uuid;
begin
    if p_valor is null or p_valor <= 0 then
        raise exception 'Informe um valor maior que zero para guardar.';
    end if;

    select nome into v_nome
      from public.caixinhas
     where id = p_caixinha_id
       and conta_id = p_conta_id
       and user_id = auth.uid()
       and ativa
     for update;

    if not found then
        raise exception 'Caixinha não encontrada para esta conta.';
    end if;

    select saldo_atual into v_saldo_conta
      from public.contas
     where id = p_conta_id
       and user_id = auth.uid()
       and ativa
     for update;

    if not found then
        raise exception 'Conta da caixinha não encontrada.';
    end if;

    if v_saldo_conta < p_valor then
        raise exception 'Saldo insuficiente na conta corrente (disponível: %).', v_saldo_conta;
    end if;

    -- 1) Sai da conta corrente (trigger debita o saldo_atual)
    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, categoria, tipo_op)
    values (p_conta_id, auth.uid(), coalesce(p_data, current_date),
            'Guardado na caixinha ' || v_nome, p_valor, 'caixinha', 'Saida')
    returning id into v_mov_id;

    -- 2) Entra na caixinha
    update public.caixinhas
       set saldo = saldo + p_valor
     where id = p_caixinha_id;

    -- 3) Registra o movimento da caixinha (com o vínculo da contrapartida)
    insert into public.caixinha_movimentacoes (caixinha_id, user_id, tipo, valor, descricao, data, lancamento_id)
    values (p_caixinha_id, auth.uid(), 'guardar', p_valor, p_descricao, coalesce(p_data, current_date), v_mov_id);
end;
$$;

create or replace function public.caixinha_resgatar(
    p_caixinha_id uuid,
    p_conta_id    uuid,
    p_valor       numeric,
    p_descricao   text default null,
    p_data        date default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_nome              text;
    v_saldo_caixinha    numeric;
    v_mov_id            uuid;
begin
    if p_valor is null or p_valor <= 0 then
        raise exception 'Informe um valor maior que zero para resgatar.';
    end if;

    select nome, saldo into v_nome, v_saldo_caixinha
      from public.caixinhas
     where id = p_caixinha_id
       and conta_id = p_conta_id
       and user_id = auth.uid()
       and ativa
     for update;

    if not found then
        raise exception 'Caixinha não encontrada para esta conta.';
    end if;

    if v_saldo_caixinha < p_valor then
        raise exception 'Saldo insuficiente na caixinha (disponível: %).', v_saldo_caixinha;
    end if;

    -- 1) Sai da caixinha
    update public.caixinhas
       set saldo = saldo - p_valor
     where id = p_caixinha_id;

    -- 2) Entra na conta corrente (trigger credita o saldo_atual)
    insert into public.movimentacoes (conta_id, user_id, data, descricao, valor, categoria, tipo_op)
    values (p_conta_id, auth.uid(), coalesce(p_data, current_date),
            'Resgate da caixinha ' || v_nome, p_valor, 'caixinha', 'Entrada')
    returning id into v_mov_id;

    -- 3) Registra o movimento da caixinha (com o vínculo da contrapartida)
    insert into public.caixinha_movimentacoes (caixinha_id, user_id, tipo, valor, descricao, data, lancamento_id)
    values (p_caixinha_id, auth.uid(), 'resgatar', p_valor, p_descricao, coalesce(p_data, current_date), v_mov_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. RPC: caixinha_editar_movimento (valor/data/descricao; NULL = mantém)
-- ----------------------------------------------------------------------------
-- Move só o DELTA. Taxa/rendimento: só caixinhas.saldo. Guardar/resgatar
-- exigem vínculo (lancamento_id); a contrapartida na conta é ajustada pelo
-- UPDATE da linha (o trigger aplica o delta — NUNCA atualizar
-- contas.saldo_atual aqui, senão conta duas vezes). Data propaga
-- para a contrapartida; descrição só se ainda for a automática. Trocar tipo:
-- fora (excluir + relançar).
create or replace function public.caixinha_editar_movimento(
    p_movimento_id uuid,
    p_valor        numeric default null,
    p_data         date    default null,
    p_descricao    text    default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_mov               public.caixinha_movimentacoes%rowtype;
    v_saldo_caixinha    numeric;
    v_nome_caixinha     text;
    v_conta_id          uuid;
    v_valor_novo        numeric;
    v_data_nova         date;
    v_delta             numeric;
    v_saldo_conta       numeric;
    v_desc_auto         text;
begin
    select * into v_mov
      from public.caixinha_movimentacoes
     where id = p_movimento_id
       and user_id = auth.uid()
       for update;
    if not found then
        raise exception 'Lançamento da caixinha não encontrado.';
    end if;

    select saldo, nome, conta_id into v_saldo_caixinha, v_nome_caixinha, v_conta_id
      from public.caixinhas
     where id = v_mov.caixinha_id
       and user_id = auth.uid()
       and ativa
     for update;
    if not found then
        raise exception 'Caixinha não encontrada.';
    end if;

    v_valor_novo := coalesce(p_valor, v_mov.valor);
    if v_valor_novo is null or v_valor_novo <= 0 then
        raise exception 'Informe um valor maior que zero.';
    end if;
    v_data_nova := coalesce(p_data, v_mov.data);
    v_delta := v_valor_novo - v_mov.valor;

    if v_mov.tipo = 'taxa' then
        -- Reverte o débito parcial: caixinha perde/ganha só o delta.
        if v_saldo_caixinha - v_delta < 0 then
            raise exception 'Sem saldo na caixinha para este valor (disponível: %).', v_saldo_caixinha;
        end if;
        update public.caixinhas set saldo = saldo - v_delta where id = v_mov.caixinha_id;
    elsif v_mov.tipo = 'rendimento' then
        if v_saldo_caixinha + v_delta < 0 then
            raise exception 'Sem saldo na caixinha para este valor (disponível: %).', v_saldo_caixinha;
        end if;
        update public.caixinhas set saldo = saldo + v_delta where id = v_mov.caixinha_id;
    elsif v_mov.tipo in ('guardar', 'resgatar') then
        if v_mov.lancamento_id is null then
            raise exception 'Este lançamento antigo não tem vínculo com a conta (sem lancamento_id): exclua e relance.';
        end if;
        -- Contrapartida (trava + dono).
        perform 1 from public.movimentacoes
         where id = v_mov.lancamento_id and user_id = auth.uid()
         for update;
        if not found then
            raise exception 'Contrapartida na conta não encontrada: exclua e relance.';
        end if;
        if v_mov.tipo = 'guardar' then
            -- Saída na conta: caixinha += delta (manual); conta -= delta via
            -- trigger no UPDATE da contrapartida abaixo (só valida aqui).
            if v_saldo_caixinha + v_delta < 0 then
                raise exception 'Sem saldo na caixinha para este valor (disponível: %).', v_saldo_caixinha;
            end if;
            select saldo_atual into v_saldo_conta from public.contas
             where id = v_conta_id and user_id = auth.uid() for update;
            if v_saldo_conta - v_delta < 0 then
                raise exception 'Sem saldo na conta para este valor (disponível: %).', v_saldo_conta;
            end if;
            update public.caixinhas set saldo = saldo + v_delta where id = v_mov.caixinha_id;
        else
            -- Resgatar = Entrada na conta: caixinha -= delta (manual);
            -- conta += delta via trigger (só valida aqui).
            if v_saldo_caixinha - v_delta < 0 then
                raise exception 'Sem saldo na caixinha para este valor (disponível: %).', v_saldo_caixinha;
            end if;
            select saldo_atual into v_saldo_conta from public.contas
             where id = v_conta_id and user_id = auth.uid() for update;
            if v_saldo_conta + v_delta < 0 then
                raise exception 'Sem saldo na conta para este valor (disponível: %).', v_saldo_conta;
            end if;
            update public.caixinhas set saldo = saldo - v_delta where id = v_mov.caixinha_id;
        end if;
        -- Data propaga sempre; descrição só se ainda for a automática.
        v_desc_auto := case
            when v_mov.tipo = 'guardar' then 'Guardado na caixinha ' || v_nome_caixinha
            else 'Resgate da caixinha ' || v_nome_caixinha
        end;
        update public.movimentacoes
           set valor = v_valor_novo,
               data = v_data_nova,
               descricao = case when descricao = v_desc_auto then v_desc_auto else descricao end
         where id = v_mov.lancamento_id;
    else
        raise exception 'Tipo de lançamento desconhecido: %.', v_mov.tipo;
    end if;

    update public.caixinha_movimentacoes
       set valor = v_valor_novo,
           data = v_data_nova,
           descricao = coalesce(p_descricao, descricao)
     where id = p_movimento_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. RPC: caixinha_excluir_movimento (reverte tudo atomicamente)
-- ----------------------------------------------------------------------------
create or replace function public.caixinha_excluir_movimento(
    p_movimento_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_mov               public.caixinha_movimentacoes%rowtype;
    v_saldo_caixinha    numeric;
    v_nome_caixinha     text;
    v_conta_id          uuid;
    v_saldo_conta       numeric;
begin
    select * into v_mov
      from public.caixinha_movimentacoes
     where id = p_movimento_id
       and user_id = auth.uid()
       for update;
    if not found then
        raise exception 'Lançamento da caixinha não encontrado.';
    end if;

    select saldo, nome, conta_id into v_saldo_caixinha, v_nome_caixinha, v_conta_id
      from public.caixinhas
     where id = v_mov.caixinha_id
       and user_id = auth.uid()
       and ativa
     for update;
    if not found then
        raise exception 'Caixinha não encontrada.';
    end if;

    if v_mov.tipo = 'taxa' then
        -- Reverte o débito: devolve à caixinha (sempre seguro somar).
        update public.caixinhas set saldo = saldo + v_mov.valor where id = v_mov.caixinha_id;
    elsif v_mov.tipo = 'rendimento' then
        if v_saldo_caixinha - v_mov.valor < 0 then
            raise exception 'Sem saldo na caixinha para excluir este rendimento (disponível: %).', v_saldo_caixinha;
        end if;
        update public.caixinhas set saldo = saldo - v_mov.valor where id = v_mov.caixinha_id;
    elsif v_mov.tipo in ('guardar', 'resgatar') then
        if v_mov.lancamento_id is null then
            raise exception 'Este lançamento antigo não tem vínculo com a conta (sem lancamento_id): exclua e relance.';
        end if;
        perform 1 from public.movimentacoes
         where id = v_mov.lancamento_id and user_id = auth.uid()
         for update;
        if not found then
            raise exception 'Contrapartida na conta não encontrada: exclua e relance.';
        end if;
        select saldo_atual into v_saldo_conta from public.contas
         where id = v_conta_id and user_id = auth.uid() for update;
        if v_mov.tipo = 'guardar' then
            -- Reverte: caixinha -= valor (manual, valida); apaga a saída e o
            -- trigger credita a conta de volta (sem UPDATE manual aqui).
            if v_saldo_caixinha - v_mov.valor < 0 then
                raise exception 'Sem saldo na caixinha para excluir este lançamento (disponível: %).', v_saldo_caixinha;
            end if;
            update public.caixinhas set saldo = saldo - v_mov.valor where id = v_mov.caixinha_id;
        else
            -- Resgatar: caixinha += valor (manual); apaga a entrada e o
            -- trigger debita a conta (valida antes).
            if v_saldo_conta - v_mov.valor < 0 then
                raise exception 'Sem saldo na conta para excluir este lançamento (disponível: %).', v_saldo_conta;
            end if;
            update public.caixinhas set saldo = saldo + v_mov.valor where id = v_mov.caixinha_id;
        end if;
        delete from public.movimentacoes where id = v_mov.lancamento_id;
    else
        raise exception 'Tipo de lançamento desconhecido: %.', v_mov.tipo;
    end if;

    delete from public.caixinha_movimentacoes where id = p_movimento_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- PERMISSÕES
-- ----------------------------------------------------------------------------
revoke all on function public.caixinha_editar_movimento(uuid, numeric, date, text) from public;
grant execute on function public.caixinha_editar_movimento(uuid, numeric, date, text) to authenticated;
revoke all on function public.caixinha_excluir_movimento(uuid) from public;
grant execute on function public.caixinha_excluir_movimento(uuid) to authenticated;

-- ============================================================================
-- TESTES (bloco DO autocontido: cria cenário temporário, valida e LIMPA tudo;
-- se qualquer assert falhar, a transação aborta e nada residual permanece)
-- ============================================================================
do $$
declare
    v_conta   uuid;
    v_caixa   uuid;
    v_saldo_c numeric;
    v_saldo_o numeric;
    v_mov_id  uuid;
    v_n       integer;
begin
    -- O SQL Editor roda como postgres (sem JWT): auth.uid() viria NULL e
    -- todo INSERT/RPC falharia (erro 23502 aqui, "não encontrada" nas RPCs).
    -- Fixa o claim para o usuário mais antigo, valendo SÓ nesta transação
    -- (cobre o bloco todo, inclusive dentro das RPCs; apaga-se sozinho).
    perform set_config('request.jwt.claim.sub',
        (select id::text from auth.users order by created_at limit 1), true);
    if auth.uid() is null then
        raise exception 'TESTES 42: nenhum usuário em auth.users.';
    end if;

    -- Cenário: conta com 1000 + caixinha zerada (nomes marcados TESTE_42).
    insert into public.contas (user_id, nome, tipo, saldo_atual, ativa)
    values (auth.uid(), 'TESTE_42_CONTA', 'corrente', 1000, true)
    returning id into v_conta;
    insert into public.caixinhas (user_id, conta_id, nome, saldo, ativa)
    values (auth.uid(), v_conta, 'TESTE_42_CAIXA', 0, true)
    returning id into v_caixa;

    -- T1: rendimento 200 (só caixinha) + edição para 250 (delta +50).
    perform public.caixinha_rendimento(v_caixa, v_conta, 200, 't1', current_date);
    perform public.caixinha_editar_movimento(
        (select id from public.caixinha_movimentacoes where caixinha_id = v_caixa and tipo = 'rendimento'),
        250, null, null);
    select saldo into v_saldo_c from public.caixinhas where id = v_caixa;
    if v_saldo_c <> 250 then raise exception 'T1 falhou: saldo % (esperado 250)', v_saldo_c; end if;

    -- T2: esvazia a caixa e tenta reduzir o rendimento além do saldo → bloqueia.
    -- (caixa 250; resgata 250 → caixa 0; editar rendimento 250→100 daria
    --  0+(100-250) = -150 < 0 → erro esperado 'Sem saldo na caixinha'.)
    perform public.caixinha_resgatar(v_caixa, v_conta, 250, 't2-esvazia', current_date);
    begin
        perform public.caixinha_editar_movimento(
            (select id from public.caixinha_movimentacoes where caixinha_id = v_caixa and tipo = 'rendimento'),
            100, null, null);
        raise exception 'T2 falhou: deveria ter bloqueado (saldo insuficiente).';
    exception
        when others then
            if sqlerrm not like '%Sem saldo na caixinha%' then
                raise exception 'T2 falhou com mensagem errada: %', sqlerrm;
            end if;
    end;

    -- T3: excluir rendimento sem saldo para reverter → bloqueia.
    -- (caixa 0, rendimento 250: 0-250 < 0 → erro esperado.)
    -- caixinha 0, conta 1000+250=1250. Excluir o rendimento de 250: 0-250 < 0 → erro esperado.
    begin
        perform public.caixinha_excluir_movimento(
            (select id from public.caixinha_movimentacoes where caixinha_id = v_caixa and tipo = 'rendimento'));
        raise exception 'T3 falhou: deveria ter bloqueado (saldo insuficiente).';
    exception
        when others then
            if sqlerrm not like '%Sem saldo na caixinha%' then
                raise exception 'T3 falhou com mensagem errada: %', sqlerrm;
            end if;
    end;

    -- T4: guardar 100 grava vínculo; editar valor/data move os dois lados.
    perform public.caixinha_guardar(v_caixa, v_conta, 100, 't4', current_date);
    select lancamento_id into v_mov_id from public.caixinha_movimentacoes
     where caixinha_id = v_caixa and tipo = 'guardar' order by criado_em desc limit 1;
    if v_mov_id is null then raise exception 'T4 falhou: guardar não gravou lancamento_id.'; end if;
    perform public.caixinha_editar_movimento(
        (select id from public.caixinha_movimentacoes where lancamento_id = v_mov_id),
        150, null, 't4-edit');
    select saldo into v_saldo_c from public.caixinhas where id = v_caixa;
    select saldo_atual into v_saldo_o from public.contas where id = v_conta;
    -- caixinha: 0+100/editar... (conta do cenário: após T3, caixa 0 / conta 1250;
    -- guardar 100: caixa 100, conta 1150; editar 100→150: caixa 150, conta 1100)
    if v_saldo_c <> 150 then raise exception 'T4 falhou: caixa % (esperado 150)', v_saldo_c; end if;
    if v_saldo_o <> 1100 then raise exception 'T4 falhou: conta % (esperado 1100)', v_saldo_o; end if;

    -- T5: excluir guardar reverte os dois lados.
    perform public.caixinha_excluir_movimento(
        (select id from public.caixinha_movimentacoes where lancamento_id = v_mov_id));
    select saldo into v_saldo_c from public.caixinhas where id = v_caixa;
    select saldo_atual into v_saldo_o from public.contas where id = v_conta;
    if v_saldo_c <> 0 then raise exception 'T5 falhou: caixa % (esperado 0)', v_saldo_c; end if;
    if v_saldo_o <> 1250 then raise exception 'T5 falhou: conta % (esperado 1250)', v_saldo_o; end if;
    select count(*) into v_n from public.movimentacoes where id = v_mov_id;
    if v_n <> 0 then raise exception 'T5 falhou: contrapartida não apagada.'; end if;

    -- T6: movimento antigo sem vínculo é recusado com mensagem clara.
    insert into public.caixinha_movimentacoes (caixinha_id, user_id, tipo, valor, data)
    values (v_caixa, auth.uid(), 'guardar', 10, current_date);
    begin
        perform public.caixinha_editar_movimento(
            (select id from public.caixinha_movimentacoes where caixinha_id = v_caixa and valor = 10 and lancamento_id is null),
            20, null, null);
        raise exception 'T6 falhou: deveria ter recusado (sem vínculo).';
    exception
        when others then
            if sqlerrm not like '%sem lancamento_id%' then
                raise exception 'T6 falhou com mensagem errada: %', sqlerrm;
            end if;
    end;

    -- Limpeza: apaga o cenário de teste (conta com cascade nas caixinhas).
    delete from public.movimentacoes where conta_id = v_conta;
    delete from public.caixinhas where id = v_caixa;
    delete from public.contas where id = v_conta;
    raise notice 'TESTES 42 OK: T1–T6 passaram; cenário limpo.';
end;
$$;
