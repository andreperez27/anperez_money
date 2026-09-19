-- ============================================================================
-- ETAPA 06/P4 — MIGRATION 38: pendência herdada de previsto atrasado
-- ============================================================================
-- Comportamento novo (decisão com André): previsto que passa da data sem ser
-- lançado não fica parado no passado só com o badge "Atrasado" — o valor
-- pendente migra para uma nova ocorrência prevista no próximo período, com a
-- tag "Pendente (atraso da semana de dd/mm)". Vale também para realização
-- PARCIAL: o restante vira a mesma pendência, sem avulso manual.
--
-- Dois caminhos (arquitetura aprovada):
--   A. PARCIAL dentro de realizar_planejamento (mesma transação): a original
--      vira 'realizado' (movimentação com o valor real) e a sobra nasce como
--      previsto com origem_atraso_id apontando para ela. Não pode ser lazy,
--      porque depois do UPDATE a original já é 'realizado' e o lazy (que só
--      enxerga 'previsto') nunca a acharia.
--   B. TOTAL via migrar_atraso (lazy, chamado por listarPorPeriodo): a original
--      vira 'migrado' (novo valor de estado) e a pendente nasce com o valor
--      cheio. Idempotente via UNIQUE parcial + NOT EXISTS.
--
-- Schema (simplificado — sem estado_migrado: total vs parcial sai de
-- valor_pendente vs valor original; iguais = total, menor = parcial):
--   • origem_atraso_id  → id da ocorrência de origem (NULL = não é herança);
--   • valor_pendente    → quanto foi herdado (na ORIGINAL: quanto migrou);
--   • nota_pendencia    → motivo humano da divergência (ex.: "referente a 50%
--                          da semana 37"), gravado canônico na ORIGINAL; a
--                          pendente carrega a cópia de exibição junto da tag na
--                          observacao (legível sozinha, sem join entre períodos).
--   • estado 'migrado'  → original totalmente migrada sem realização (não conta
--                          mais como "Atrasado" nem no saldo projetado).
--
-- RESTRIÇÕES preservadas:
--   • a pendente é sempre avulsa (serie_id NULL, origem 'manual'): NÃO herda a
--     série, para não contaminar a reprojeção por média móvel
--     (serieValorVariavel) nem a reconciliação do Ponto (que só lê
--     origem='jornada'). Para jornada, a semana nova calcula seu próprio valor
--     e a pendência entra como segunda linha separada na mesma semana.
--   • origem 'historico_*' nunca migra (só relatórios leem).
--   • sem snapshot/tabela nova; sem tocar em cálculo de fatura/limite/parcelas.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. COLUNAS
-- ----------------------------------------------------------------------------
alter table public.planejamentos
    add column if not exists origem_atraso_id uuid
        references public.planejamentos(id) on delete set null;

alter table public.planejamentos
    add column if not exists valor_pendente numeric(12, 2)
        check (valor_pendente is null or valor_pendente > 0);

alter table public.planejamentos
    add column if not exists nota_pendencia text;

comment on column public.planejamentos.origem_atraso_id is
    'Ocorrência de origem da pendência herdada (migration 38). NULL = não é herança de atraso.';
comment on column public.planejamentos.valor_pendente is
    'Quanto migrou para a pendência (migration 38). Na ORIGINAL: total (= valor) ou parcial (< valor).';
comment on column public.planejamentos.nota_pendencia is
    'Motivo humano da divergência parcial (ex.: "referente a 50% da semana 37"). Gravado na original; a pendente exibe via origem_atraso_id.';


-- ----------------------------------------------------------------------------
-- 2. ESTADO 'migrado' (original totalmente migrada sem realização)
-- ----------------------------------------------------------------------------
alter table public.planejamentos
    drop constraint if exists planejamentos_estado_check;

alter table public.planejamentos
    add constraint planejamentos_estado_check
        check (estado in ('previsto', 'realizado', 'cancelado', 'migrado'));


-- ----------------------------------------------------------------------------
-- 3. IDEMPOTÊNCIA: uma origem gera no máximo UMA pendência
-- ----------------------------------------------------------------------------
create unique index if not exists ux_planejamentos_origem_atraso
    on public.planejamentos(origem_atraso_id)
    where origem_atraso_id is not null;


-- ----------------------------------------------------------------------------
-- 4. realizar_planejamento COM pendência parcial dentro da transação
-- ----------------------------------------------------------------------------
-- Base: migration 36 (assinatura + snapshot do condomínio preservados).
-- Novos parâmetros opcionais (defaults → chamadas antigas continuam iguais):
--   • p_nota_pendencia  texto livre do usuário (motivo da divergência);
--   • p_data_pendente    data da pendência calculada no front pela lib
--                        (pendenciaAtraso.js: próxima da série ou próxima
--                        segunda para avulso). NULL → próxima segunda no SQL.
-- Regra: só gera pendência quando há sobra (v_original > v_real) E a previsão
-- estava atrasada (data_prevista <= data da realização). Parcial de previsão
-- FUTURA não migra sozinha (o restante continua devido na data original e o
-- usuário ajusta manualmente) — nesse caso a nota é ignorada.
drop function if exists public.realizar_planejamento(uuid, uuid);
drop function if exists public.realizar_planejamento(uuid, uuid, numeric, date);

create or replace function public.realizar_planejamento(
    p_planejamento_id uuid,
    p_conta_id        uuid,
    p_valor_real      numeric default null,
    p_data_realizacao date default null,
    p_nota_pendencia  text default null,
    p_data_pendente   date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user          uuid := auth.uid();
    v_data          date := coalesce(p_data_realizacao, current_date);
    v_descricao     text;
    v_original      numeric(12, 2);
    v_valor         numeric(12, 2);
    v_tipo_op       text;
    v_origem        text;
    v_data_prevista date;
    v_conta_destino uuid;
    v_destino_padrao text;
    v_cartao_padrao uuid;
    v_categoria     text;
    v_mov_id        uuid;
    v_pendente      numeric(12, 2);
    v_nota          text := nullif(trim(coalesce(p_nota_pendencia, '')), '');
    v_data_nova     date;
    v_dias_seg      integer;
    v_tag           text;
    v_pend_id       uuid;
begin
    if v_user is null then
        raise exception 'Sessão sem usuário autenticado.';
    end if;
    if p_planejamento_id is null then
        raise exception 'Informe o planejamento a realizar.';
    end if;
    if p_conta_id is null then
        raise exception 'Informe a conta de destino.';
    end if;

    -- Previsão a realizar (FOR UPDATE — mesma trava anti-duplo-clique da 16).
    select descricao, valor, tipo_op, origem, data_prevista,
           conta_destino_id, destino_padrao, cartao_padrao_id, categoria
      into v_descricao, v_original, v_tipo_op, v_origem, v_data_prevista,
           v_conta_destino, v_destino_padrao, v_cartao_padrao, v_categoria
      from public.planejamentos
     where id = p_planejamento_id
       and user_id = v_user
       for update;

    if not found then
        raise exception 'Planejamento não encontrado ou não pertence ao usuário.';
    end if;

    if (select estado from public.planejamentos where id = p_planejamento_id) <> 'previsto' then
        raise exception 'Apenas previsões em estado "previsto" podem ser realizadas.';
    end if;

    perform 1
      from public.contas
     where id = p_conta_id
       and user_id = v_user
       and ativa = true
       for update;
    if not found then
        raise exception 'Conta de destino não encontrada, inativa ou não pertence ao usuário.';
    end if;

    -- Valor efetivo (padrão: o previsto). O valor ORIGINAL é preservado na
    -- linha (histórico); só a movimentação carrega o valor real.
    v_valor := coalesce(p_valor_real, v_original);
    if v_valor is null or v_valor <= 0 then
        raise exception 'Valor da realização deve ser maior que zero.';
    end if;

    insert into public.movimentacoes
        (user_id, conta_id, data, descricao, valor, categoria, tipo_op)
    values
        (v_user, p_conta_id, v_data, v_descricao, v_valor, 'planejamento', v_tipo_op)
    returning id into v_mov_id;

    -- Sobra = previsto − realizado. Só vira pendência se positiva E atrasada
    -- (data_prevista <= data da realização). Parcial de previsão futura não
    -- migra (o restante segue devido na data original).
    v_pendente := v_original - v_valor;

    if v_pendente is not null and v_pendente > 0 and v_data_prevista <= v_data then
        -- Data da pendência: a calculada no front, ou próxima segunda no SQL.
        if p_data_pendente is not null then
            v_data_nova := p_data_pendente;
        else
            v_dias_seg := (8 - extract(isodow from current_date)::int) % 7;
            if v_dias_seg = 0 then v_dias_seg := 7; end if;
            v_data_nova := current_date + v_dias_seg;
        end if;

        -- Tag automática de rastreabilidade (segunda da semana da origem).
        v_tag := 'Pendente (atraso da semana de '
              || to_char(date_trunc('week', v_data_prevista)::date, 'DD/MM')
              || ')';

        -- A nota vive canônica na ORIGINAL (nota_pendencia); aqui vai só a
        -- cópia de exibição junto da tag, para a pendente ser legível sozinha
        -- sem join entre períodos.
        insert into public.planejamentos
            (user_id, tipo_op, descricao, valor, data_prevista,
             estado, origem, conta_destino_id, destino_padrao, cartao_padrao_id,
             categoria, observacao, ano_semana, semana, origem_atraso_id)
        values
            (v_user, v_tipo_op, v_descricao, v_pendente, v_data_nova,
             'previsto', 'manual', coalesce(v_conta_destino, p_conta_id),
             v_destino_padrao, v_cartao_padrao,
             v_categoria, v_tag || case when v_nota is not null then ' — ' || v_nota else '' end,
             extract(isoyear from v_data_nova)::smallint,
             extract(week from v_data_nova)::smallint,
             p_planejamento_id)
        returning id into v_pend_id;

        update public.planejamentos
           set estado = 'realizado',
               lancamento_id = v_mov_id,
               conta_destino_id = p_conta_id,
               valor_pendente = v_pendente,
               nota_pendencia = v_nota
         where id = p_planejamento_id;
    else
        -- Integral (ou parcial de previsão futura): sem pendência; nota ignorada.
        update public.planejamentos
           set estado = 'realizado',
               lancamento_id = v_mov_id,
               conta_destino_id = p_conta_id
         where id = p_planejamento_id;
    end if;

    -- 8.5 SNAPSHOT do condomínio (migration 36, preservado): best-effort.
    if v_origem = 'recorrente' and v_descricao ilike 'Condomínio%' then
        begin
            perform public.registrar_snapshot_condominio(p_planejamento_id, v_user);
        exception when others then
            null;
        end;
    end if;

    return v_mov_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. migrar_atraso — migração TOTAL via lazy (uma origem por vez)
-- ----------------------------------------------------------------------------
-- Chamado pelo front (migrarAtrasos) para cada previsto atrasado sem filho.
-- Tudo numa transação: trava a origem, revalida, insere a pendente e marca a
-- origem como 'migrado'. Idempotente: NOT EXISTS + UNIQUE parcial — segunda
-- chamada (duplo render, duas abas) não duplica; retorna o id existente.
create or replace function public.migrar_atraso(
    p_origem_id uuid,
    p_data_nova date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user          uuid := auth.uid();
    v_row           record;
    v_existente     uuid;
    v_tag           text;
    v_pend_id       uuid;
begin
    if v_user is null then
        raise exception 'Sessão sem usuário autenticado.';
    end if;
    if p_origem_id is null then
        raise exception 'Informe a ocorrência de origem.';
    end if;
    if p_data_nova is null then
        raise exception 'Informe a data da pendência.';
    end if;

    select *
      into v_row
      from public.planejamentos
     where id = p_origem_id
       and user_id = v_user
       for update;

    if not found then
        raise exception 'Planejamento não encontrado ou não pertence ao usuário.';
    end if;

    -- Idempotência: já tem filho → devolve o existente, sem duplicar.
    select id into v_existente
      from public.planejamentos
     where origem_atraso_id = p_origem_id
       and user_id = v_user
     limit 1;
    if found then
        return v_existente;
    end if;

    -- Só previsto atrasado, sem migração anterior, fora do histórico de
    -- relatórios. Qualquer outra situação: sem pendência (chamada inócua).
    if v_row.estado <> 'previsto'
       or v_row.valor_pendente is not null
       or v_row.data_prevista >= current_date
       or v_row.origem like 'historico_%' then
        return null;
    end if;

    v_tag := 'Pendente (atraso da semana de '
          || to_char(date_trunc('week', v_row.data_prevista)::date, 'DD/MM')
          || ')';

    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista,
         estado, origem, conta_destino_id, destino_padrao, cartao_padrao_id,
         categoria, observacao, ano_semana, semana, origem_atraso_id)
    values
        (v_user, v_row.tipo_op, v_row.descricao, v_row.valor, p_data_nova,
         'previsto', 'manual', v_row.conta_destino_id,
         v_row.destino_padrao, v_row.cartao_padrao_id,
         v_row.categoria, v_tag,
         extract(isoyear from p_data_nova)::smallint,
         extract(week from p_data_nova)::smallint,
         p_origem_id)
    on conflict (origem_atraso_id) where origem_atraso_id is not null do nothing
    returning id into v_pend_id;

    -- Conflito (corrida): o filho já existe — devolve o existente.
    if v_pend_id is null then
        select id into v_pend_id
          from public.planejamentos
         where origem_atraso_id = p_origem_id
           and user_id = v_user
         limit 1;
        return v_pend_id;
    end if;

    update public.planejamentos
       set estado = 'migrado',
           valor_pendente = v_row.valor
     where id = p_origem_id;

    return v_pend_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- GRANTS (mesmo padrão das anteriores; nova assinatura de 6 args)
-- ----------------------------------------------------------------------------
revoke all on function public.realizar_planejamento(uuid, uuid, numeric, date, text, date) from public;
grant execute on function public.realizar_planejamento(uuid, uuid, numeric, date, text, date) to authenticated;
revoke all on function public.migrar_atraso(uuid, date) from public;
grant execute on function public.migrar_atraso(uuid, date) to authenticated;


-- ============================================================================
-- RLS — NENHUMA ALTERAÇÃO (policy for all já cobre as colunas novas)
-- ============================================================================
