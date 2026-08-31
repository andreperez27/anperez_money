-- ============================================================================
-- ETAPA 06 (Planejamento) — MIGRATION 16: realizar_planejamento
-- ============================================================================
-- Efetivação de UMA previsão "previsto" em lançamento real na conta
-- (Planejado → Realizado). É o "botão Lançar" que a E5-F deixou marcado como
-- FORA de escopo em Lancamentos.jsx — agora implementado, só pelo caminho de
-- CONTAS (movimentacoes). O caminho Cartão/compra fica para etapa futura.
--
-- POR QUE uma RPC atômica e não duas chamadas do cliente?
--   A realização é a ÚNICA operação do módulo que TRANSFORMA a previsão em um
--   lançamento que mexe no saldo. Para isso há DUAS escritas que precisam
--   acontecer juntas ou não acontecer de jeito nenhum:
--     1. INSERT em movimentacoes  (a trigger trg_atualizar_saldo ajusta o
--                                  saldo da conta — ela cuida sozinha);
--     2. UPDATE em planejamentos  (estado→'realizado', grava lancamento_id e
--                                  confirma conta_destino_id).
--   Se um erro acontecer entre as duas (ex.: a conta é excluída no meio), não
--   pode sobrar movimentação sem o estado marcado — nem o contrário. O
--   plpgsql torna o corpo da função uma única transação: qualquer RAISE faz
--   rollback de TUDO. Idêntico ao padrão de pagar_fatura/desfazer_pagamento.
--
-- REGRAS de negócio (herdadas da REGRA DE OURO de 08_planejamentos):
--   • a realização é SEMPRE EXPLÍCITA (nunca automática): só disparo quando o
--     usuário clica em "Lançar". Este script não agenda nada.
--   • só uma previsão no estado 'previsto' pode ser realizada; 'realizado'
--     nunca é re-executado (idempotência) e 'cancelado' não volta à vida por
--     este caminho;
--   • o saldo NÃO é calculado aqui: a trigger trg_atualizar_saldo (migration
--     03) soma Entrada / subtrai Saida com base no tipo_op da movimentação
--     criada — reaproveita-se, não se duplica lógica financeira;
--   • o valor padrão é o VALOR PREVISTO (planejamentos.valor); p_valor_real
--     opcional permite registrar uma realização com valor efetivo diferente
--     da previsão (ex.: despesa saiu por R$ 98,40). O CHECK valor > 0 do banco
--     continua valendo.
--
-- SEGURANÇA:
--   security definer + set search_path = public; as validações de propriedade
--   (auth.uid() = user_id) acontecem no corpo da função — nada é confiado ao
--   cliente. O dono da função (postgres, dono das migrations) ignora a RLS,
--   então ele insere na movimentacao e atualiza o planejamento do usuário
--   validado. revoke/grant só para authenticated (mesmo padrão 10/11/12/13).
--
-- DELETE/DESFAZER da realização NÃO faz parte desta etapa (política futura).
-- ============================================================================


-- Remove versões antigas de assinaturas diferentes (evita ambiguidade).
drop function if exists public.realizar_planejamento(uuid, uuid);
drop function if exists public.realizar_planejamento(uuid, uuid, numeric, date);

create or replace function public.realizar_planejamento(
    p_planejamento_id uuid,
    p_conta_id        uuid,
    p_valor_real      numeric default null,
    p_data_realizacao date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user        uuid := auth.uid();
    v_data        date := coalesce(p_data_realizacao, current_date);
    v_descricao   text;
    v_valor       numeric(12, 2);
    v_tipo_op     text;
    v_mov_id      uuid;
begin
    -- 1. Autenticação
    if v_user is null then
        raise exception 'Sessão sem usuário autenticado.';
    end if;

    -- 2. Validações paramétricas básicas
    if p_planejamento_id is null then
        raise exception 'Informe o planejamento a realizar.';
    end if;
    if p_conta_id is null then
        raise exception 'Informe a conta de destino.';
    end if;

    -- 3. Previsão a realizar (FOR UPDATE — lock determinístico bloqueia
    --    uma segunda realização concorrente da mesma linha antes do UPDATE).
    select descricao, valor, tipo_op
      into v_descricao, v_valor, v_tipo_op
      from public.planejamentos
     where id = p_planejamento_id
       and user_id = v_user
       for update;

    if not found then
        raise exception 'Planejamento não encontrado ou não pertence ao usuário.';
    end if;

    -- 4. Só 'previsto' realiza. 'realizado' já tem lançamento (nunca
    --    re-executa — idempotência); 'cancelado' não volta à vida aqui.
    --    Para isso basta reler o estado da linha travada no passo 3.
    if (select estado from public.planejamentos where id = p_planejamento_id) <> 'previsto' then
        raise exception 'Apenas previsões em estado "previsto" podem ser realizadas.';
    end if;

    -- 5. Conta de destino (FOR UPDATE — valida existência + propriedade +
    --    atividade, e trava a linha contra exclusão concorrente).
    perform 1
      from public.contas
     where id = p_conta_id
       and user_id = v_user
       and ativa = true
       for update;
    if not found then
        raise exception 'Conta de destino não encontrada, inativa ou não pertence ao usuário.';
    end if;

    -- 6. Valor efetivo da realização (padrão: o valor previsto).
    v_valor := coalesce(p_valor_real, v_valor);
    if v_valor is null or v_valor <= 0 then
        raise exception 'Valor da realização deve ser maior que zero.';
    end if;

    -- 7. Criar a movimentação real. O tipo_op da previsão (Entrada/Saida) é
    --    herdado — a trigger trg_atualizar_saldo soma/subtrai o saldo_da_conta
    --    automaticamente. categoria 'planejamento' identifica a origem.
    insert into public.movimentacoes
        (user_id, conta_id, data, descricao, valor, categoria, tipo_op)
    values
        (v_user, p_conta_id, v_data, v_descricao, v_valor, 'planejamento', v_tipo_op)
    returning id into v_mov_id;

    -- 8. Marcar a previsão como realizada e vincular o lançamento. Como a
    --    função é uma única transação, se este UPDATE falhar o INSERT do
    --    passo 7 é desfeito junto — previsão e lançamento nunca ficam fora de
    --    sincronia. conta_destino_id é confirmado com a conta efetivamente usada.
    update public.planejamentos
       set estado = 'realizado',
           lancamento_id = v_mov_id,
           conta_destino_id = p_conta_id
     where id = p_planejamento_id;

    -- 9. Devolve o id do lançamento criado (feedback útil para a UI).
    return v_mov_id;
end;
$$;


-- ============================================================================
-- GRANTS
-- ============================================================================
revoke all on function public.realizar_planejamento(uuid, uuid, numeric, date) from public;
grant execute on function public.realizar_planejamento(uuid, uuid, numeric, date) to authenticated;

-- ============================================================================
-- RLS / TRIGGERS — NENHUMA ALTERAÇÃO NECESSÁRIA
-- ============================================================================
--   • trg_atualizar_saldo (03): já ajusta saldo_atual da conta pelo tipo_op da
--     movimentação inserida — a RPC não duplica essa lógica.
--   • trg_protege_transferencia (06): passa pois a movimentação criada tem
--     transferencia_id = null.
--   • planejamentos já tem RLS própria (08); a RPC acessa como dono.
--   • Cartões permanece intocado (D6/D7 preservados: sem FK em lancamento_id,
--     sem caminho Cartão/compra nesta etapa).
