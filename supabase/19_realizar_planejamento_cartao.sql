-- ============================================================================
-- ETAPA 06/P3 (Planejamento) — MIGRATION 19: realizar_planejamento_cartao
-- ============================================================================
-- Efetivação de UMA previsão "previsto" em compra no CARTÃO DE CRÉDITO
-- (Planejado → Realizado no cartão). Complementa a migration 16
-- (realizar_planejamento), que só efetiva em CONTA (movimentacoes).
--
-- POR QUE lançamento_tipo?
--   A migration 16 grava lancamento_id apontando para movimentacoes.id. No
--   caminho de cartão, a "efetivação" não gera movimentação — cria uma compra
--   (e sua parcela de fatura). Para que a UI saiba como interpretar
--   lancamento_id (movimentacao.id OU compras.id), adicionamos um
--   discriminador: lancamento_tipo in ('movimentacao', 'compra').
--
-- POR QUE chamar a MESMA função criar_compra (migration 11) e não duplicar?
--   A criação da compra + parcela na fatura (mes_fatura via calcular_mes_fatura,
--   divisão via dividir_valor_em_parcelas, virada de ano) já é atômica e
--   testada dentro de criar_compra. Reutilizamos ela com n_parcelas=1 (à
--   vista): a previsão do planejamento vira UMA parcela na fatura do cartão.
--   Nenhuma lógica de fatura/parcela é re-implementada aqui.
--
-- REGRAS (mesmo espírito da 16):
--   • só 'previsto' realiza; 'realizado' nunca é re-executado (idempotência);
--     'cancelado' não volta à vida por este caminho;
--   • cartão é validado por propriedade (auth.uid()) e atividade — nada
--     confiado ao cliente (security definer + set search_path = public);
--   • FOR UPDATE na previsão bloqueia corrida (duas efetivações simultâneas
--     da mesma linha — só uma passa);
--   • p_valor_real opcional (padrão: valor previsto); p_data_compra padrão
--     current_date.
--
-- OBRIGAÇÕES MANUAIS (fora do código, ver DIARIO_DE_BORDO):
--   • Cadastrar Netflix/HBO/Vivo como previsões mensais avulsas (origem
--     'recorrente', valor fixo, SEM variável) e lancá-las em cartão por aqui.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. COLUNA: planejamentos.lancamento_tipo (discriminador do lancamento)
-- ----------------------------------------------------------------------------
-- Nullable: linhas ainda não realizadas não têm lançamento. Já realizadas
-- pelo caminho de conta (migration 16) são retro-preenchidas com
-- 'movimentacao' para manter coerência do histórico.
alter table public.planejamentos
    add column if not exists lancamento_tipo text
    check (lancamento_tipo in ('movimentacao', 'compra'));

update public.planejamentos
   set lancamento_tipo = 'movimentacao'
 where estado = 'realizado'
   and lancamento_id is not null
   and lancamento_tipo is null;


-- ----------------------------------------------------------------------------
-- 2. RPC: realizar_planejamento_cartao
-- ----------------------------------------------------------------------------
drop function if exists public.realizar_planejamento_cartao(uuid, uuid);

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
    select descricao, valor, tipo_op
      into v_descricao, v_valor, v_tipo_op
      from public.planejamentos
     where id = p_planejamento_id
       and user_id = v_user
       for update;

    if not found then
        raise exception 'Planejamento não encontrado ou não pertence ao usuário.';
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
    --    (migration 11) com n_parcelas=1 → à vista, UMA parcela na fatura.
    --    Não duplicamos mes_fatura/divisão/virada de ano aqui.
    v_compra_id := public.criar_compra(
        p_cartao_id,
        v_data,
        v_descricao,
        v_valor,
        1
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


-- ----------------------------------------------------------------------------
-- GRANTS
-- ----------------------------------------------------------------------------
revoke all on function public.realizar_planejamento_cartao(uuid, uuid, numeric, date) from public;
grant execute on function public.realizar_planejamento_cartao(uuid, uuid, numeric, date) to authenticated;

-- ============================================================================
-- RLS / TRIGGERS — NENHUMA ALTERAÇÃO NECESSÁRIA
--   • criar_compra (11) já insere em compras/parcelas como owner; a RLS de
--     compras/parcelas (10) não atrapalha a RPC security definer.
--   • planejamentos tem RLS própria (08); a RPC acessa como dono.
--   • Nenhuma movimentação/ajuste de saldo aqui: compra não mexe no saldo
--     (T08 da 10) — só o pagamento da fatura (pagar_fatura) o faz.
-- ============================================================================
