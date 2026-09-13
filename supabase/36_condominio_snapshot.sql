-- ============================================================================
-- ETAPA 06 (Planejamento) — MIGRATION 36: snapshot congelado do condomínio
-- ============================================================================
-- A "composição da arrecadação" do boleto do condomínio (fixos + Gás/Água) vira
-- um SNAPSHOT IMUTÁVEL gravado no momento em que a previsão é REALIZADA
-- (botão "Lançar" em Lancamentos.jsx). Depois de gravado, nunca mais é tocado —
-- nem quando itens de despesa_recorrente_item mudarem nem quando o consumo
-- mensal for editado. Modelo CONGELADO (decisão do André, 12/09/2026).
--
-- POR QUE snapshot e não consulta ao vivo?
--   O modelo "recálculo por vigência" mudaria o passado: o boleto que o morador
--   recebeu em SET/2026 não pode mudar só porque a Cota sobe em 2027. Oueda:
--   cada mês realizado guarda a fotografia exata daquele boleto. O PDF
--   (espelho) e a planilha (PARTES 3/4) leem só esta tabela — nunca recalculam.
--
-- UNIDADE DE VALOR: REAIS (numeric(12,2)), a mesma do boleto, da
--   despesa_recorrente_item e da observação ("R$ 840,82"). ATENÇÃO: é uma
--   unidade DIFERENTE de movimentacoes/planejamentos.valor, que guardam
--   CENTAVOS. Não confundir nos scripts/PDF que vierem nas partes seguintes.
--
-- TABELAS novas:
--   1. condominio_boleto_itens  — itens do snapshot por ocorrência realizada
--      (fixos vigentes no mês + Gás 1010 / Água 1052). Física de "1 linha por
--      item"; o conjunto das linhas de um planejamento_id É o snapshot.
--   2. condominio_consumo_mensal — leituras + valor em R$ do gás/água de cada
--      mês (preenchido pela tela do condomínio na PARTE 2).
--
-- DECISÕES (pontos validados na auditoria de 12/09/2026):
--   • O snapshot é BEST-EFFORT: se qualquer parte falhar, a REALIZAÇÃO não é
--     desfeita (try/catch dentro da RPC). Nunca o snapshot impede o lançamento.
--   • Gás/Água vêm de condominio_consumo_mensal do mês; SE não houver registro
--     no banco, cai de volta (fallback) para ler o valor da própria observação
--     ("1010 Consumo de Gás R$ 90,00" / "1052 ..."), replicando o
--     parseValorObservacao (src/lib/serieValorVariavel.js). Assim os meses
--     reais antigos, gravados só na observação, também produzem snapshot.
--   • Idempotente: re-rodar sobre a mesma ocorrência não duplica nem
--     sobrescreve (on conflict do nothing). O disparo, porém, acontece apenas
--     UMA vez — na transição previsto → realizado dentro da RPC.
--   • NÃO inclui o backfill dos condomínios já realizados antes desta
--     migration (ponto 3 da auditoria) — fica para script separado após a
--     aprovação do André.
--
-- Como usar: igual às migrations anteriores — cole este arquivo inteiro no SQL
-- Editor do Supabase e clique em Run. Pode rodar de novo sem medo: as funções
-- são create or replace e as tabelas create table if not exists. NÃO dropa
-- nada (as tabelas carregam dados reais; jamais rodar "drop" nelas).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- HELPERS internos (sem grant público; usados pela função de snapshot)
-- ----------------------------------------------------------------------------

-- Nº de meses de calendário cheios entre duas datas (p_fim depois de p_inicio):
-- (2026-01-01, 2026-09-01) = 8 → a 9ª parcela do mês perguntado.
create or replace function public.meses_cheios(p_inicio date, p_fim date)
returns int
language sql
stable
as $$
    select (extract(year from p_fim)::int - extract(year from p_inicio)::int) * 12
         + (extract(month from p_fim)::int - extract(month from p_inicio)::int);
$$;

-- Valor em REAIS de uma linha da observação que começa com o código procurado
-- (ex.: "1010 Consumo de Gás R$ 90,00" → 90). Devolve null quando a linha não
-- existe ou o valor não é legível. Réplica SQL de parseValorObservacao
-- (src/lib/serieValorVariavel.js) — única convenção de formato da observação.
create or replace function public.valor_na_observacao(p_observacao text, p_cod text)
returns numeric(12, 2)
language plpgsql
stable
as $$
declare
    v_linha text;
    v_num   text;
begin
    if p_observacao is null or p_cod is null then
        return null;
    end if;
    for v_linha in select unnest(string_to_array(p_observacao, E'\n'))
    loop
        if v_linha is null or v_linha = '' then
            continue;
        end if;
        -- Linha que começa com o código seguido de espaço ou tab.
        if v_linha ~ ('^' || replace(p_cod, '.', '\.') || '[ \t]') then
            v_num := (regexp_match(v_linha, 'R\$\s*([\d.,]+)'))[1];
            if v_num is null then
                continue;
            end if;
            -- Formato brasileiro "1.234,56": remove os pontos e troca a vírgula.
            v_num := replace(v_num, '.', '');
            v_num := replace(v_num, ',', '.');
            if v_num ~ '^[0-9]+(\.[0-9]+)?$' then
                return v_num::numeric;
            end if;
        end if;
    end loop;
    return null;
end;
$$;


-- ----------------------------------------------------------------------------
-- TABELA 1: condominio_boleto_itens (o snapshot em si)
-- ----------------------------------------------------------------------------
-- Linhas imutáveis. Cada linha = um item do boleto daquele mês (`mes` = 1º dia
-- do mês civil da ocorrência; `referencia` = contador "9/24" congelado no
-- momento da realização; itens sem contador têm referencia null). `ordem`
-- preserva a disposição real do boleto (fixos na ordem da planilha e, depois,
-- os dois variáveis).
create table if not exists public.condominio_boleto_itens (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
    planejamento_id  uuid not null references public.planejamentos(id) on delete cascade,
    cod              text not null,
    descricao        text not null,
    valor            numeric(12, 2) not null check (valor >= 0), -- REAIS
    categoria        text,
    referencia       text,
    ordem            smallint not null,
    mes              date not null,
    criado_em        timestamptz not null default now(),
    unique (planejamento_id, cod)
);

comment on table public.condominio_boleto_itens is 'Snapshot imutável da composição do boleto do condomínio, capturado na realização da previsão (modelo congelado). O conjunto de linhas de um planejamento_id é o snapshot';

create index idx_condominio_boleto_itens_planejamento
    on public.condominio_boleto_itens (planejamento_id);
create index idx_condominio_boleto_itens_user_mes
    on public.condominio_boleto_itens (user_id, mes);


-- ----------------------------------------------------------------------------
-- TABELA 2: condominio_consumo_mensal (leituras + valor, um por mês/tipo)
-- ----------------------------------------------------------------------------
-- Registra a leitura do hidrômetro/gasômetro (m³, opcional) E o valor em R$
-- digitado pelo usuário na tela do condomínio. O valor continua sendo digitado
-- diretamente (tarifa tem regra própria do condomínio) — a leitura é registro
-- para o "Histórico de consumo" do PDF e para a PARTE 2, não entra no cálculo.
create table if not exists public.condominio_consumo_mensal (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
    mes              date not null,                                      -- 1º dia do mês civil
    tipo             text not null check (tipo in ('gas', 'agua')),
    leitura_atual    numeric(12, 2),                                     -- m³ (opcional)
    leitura_anterior numeric(12, 2),                                     -- m³ (opcional)
    valor            numeric(12, 2) not null check (valor >= 0),         -- R$ digitado
    criado_em        timestamptz not null default now(),
    unique (user_id, mes, tipo)
);

comment on table public.condominio_consumo_mensal is 'Leitura (m³) e valor em R$ do gás/água do condomínio, um registro por mês e tipo';

create index idx_condominio_consumo_user_mes
    on public.condominio_consumo_mensal (user_id, mes);


-- ============================================================================
-- ROW LEVEL SECURITY (RLS) — mesmo padrão das tabelas anteriores
-- ============================================================================
alter table public.condominio_boleto_itens enable row level security;
alter table public.condominio_consumo_mensal enable row level security;

create policy "usuario_ve_apenas_seus_boleto_itens"
    on public.condominio_boleto_itens
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "usuario_ve_apenas_seu_consumo_condominio"
    on public.condominio_consumo_mensal
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);


-- ============================================================================
-- FUNÇÃO do snapshot (internal-only: sem grant; chamada pela RPC como dono)
-- ============================================================================
-- Grava a fotografia do boleto de UMA ocorrência de condomínio. Lê o mês e a
-- observação da previsão, os itens fixos vigentes no mês (despesa_recorrente_
-- item) e o gás/água de condominio_consumo_mensal (com fallback para a
-- observação quando o consumo do mês não foi registrado no banco). Nunca
-- lança exceção nas condições esperadas; se ainda assim algo falhar, quem
-- chama decide (a RPC engole e completa a realização mesmo assim).
create or replace function public.registrar_snapshot_condominio(
    p_planejamento_id uuid,
    p_user            uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_mes        date;
    v_observacao text;
    v_item       record;
    v_gas        numeric(12, 2);
    v_agua       numeric(12, 2);
begin
    if p_planejamento_id is null or p_user is null then
        return;
    end if;

    -- Mês civil da ocorrência (fotografia é do mês, não do dia) + observação
    -- (usada no fallback do consumo).
    select date_trunc('month', data_prevista)::date, observacao
      into v_mes, v_observacao
      from public.planejamentos
     where id = p_planejamento_id
       and user_id = p_user;

    if not found then
        return;
    end if;

    -- Só ocorrências de condomínio (mesma convenção da lib/cliente:
    -- identificador condomínio nos origens recorrente com descricao
    -- começando em "Condomínio" — série usa o nome puro; avulsa usa
    -- "Condomínio MES/AAAA").
    if not exists (
        select 1 from public.planejamentos
         where id = p_planejamento_id
           and origem = 'recorrente'
           and descricao ilike 'Condomínio%'
    ) then
        return;
    end if;

    -- 1. Itens FIXOS vigentes no mês da ocorrência. Um item vigente é: início
    --    <= mês E (término nul OU >= mês). Ordem segue a disposição real do
    --    boleto (1002, 1050, 3002, 1102, 15002, 2002); referência "n/total"
    --    congelado pelo contador de meses (mesmo cálculo do front, migration 17).
    for v_item in
        select d.cod,
               d.descricao,
               d.valor,
               d.categoria,
               case d.cod
                   when '1002'  then 1
                   when '1050'  then 2
                   when '3002'  then 3
                   when '1102'  then 4
                   when '15002' then 5
                   when '2002'  then 6
                   else 100
               end as ordem,
               case
                   when d.vigencia_termino is null then null
                   else (public.meses_cheios(d.vigencia_inicio, v_mes) + 1)
                        || '/'
                        || (public.meses_cheios(d.vigencia_inicio, d.vigencia_termino) + 1)
               end as referencia
          from public.despesa_recorrente_item d
         where d.user_id = p_user
           and d.vigencia_inicio <= v_mes
           and (d.vigencia_termino is null or d.vigencia_termino >= v_mes)
         order by ordem, d.cod
    loop
        insert into public.condominio_boleto_itens
            (user_id, planejamento_id, cod, descricao, valor, categoria, referencia, ordem, mes)
        values
            (p_user, p_planejamento_id, v_item.cod, v_item.descricao, v_item.valor,
             v_item.categoria, v_item.referencia, v_item.ordem, v_mes)
        on conflict (planejamento_id, cod) do nothing;
    end loop;

    -- 2. Variáveis Gás (1010) / Água (1052). Fonte primária: consumo do mês
    --    no banco; fallback: leitura do valor na própria observação (meses
    --    antigos que só registraram o valor no texto).
    select
        sum(valor) filter (where tipo = 'gas'),
        sum(valor) filter (where tipo = 'agua')
      into v_gas, v_agua
      from public.condominio_consumo_mensal
     where user_id = p_user
       and mes = v_mes;

    if v_gas is null then
        v_gas := public.valor_na_observacao(v_observacao, '1010');
    end if;
    if v_agua is null then
        v_agua := public.valor_na_observacao(v_observacao, '1052');
    end if;

    if v_gas is not null and v_gas >= 0 then
        insert into public.condominio_boleto_itens
            (user_id, planejamento_id, cod, descricao, valor, categoria, referencia, ordem, mes)
        values
            (p_user, p_planejamento_id, '1010', 'Consumo de Gás', v_gas, 'Consumo', null, 7, v_mes)
        on conflict (planejamento_id, cod) do nothing;
    end if;
    if v_agua is not null and v_agua >= 0 then
        insert into public.condominio_boleto_itens
            (user_id, planejamento_id, cod, descricao, valor, categoria, referencia, ordem, mes)
        values
            (p_user, p_planejamento_id, '1052', 'Consumo de Água', v_agua, 'Consumo', null, 8, v_mes)
        on conflict (planejamento_id, cod) do nothing;
    end if;
end;
$$;


-- ============================================================================
-- MIGRATION 16 ALTERADA: realizar_planejamento ganha o disparo do snapshot
-- ============================================================================
-- A assinatura e o fluxo original são PRESERVADOS — este arquivo apenas
-- adiciona o passo 8.5 entre o UPDATE (estado → 'realizado') e o return.
-- Como a RPC é a ÚNICA porta de realização, garantir que o snapshot nasce no
-- mesmo instante da realização (mesma transação) e nunca fora dela.
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
    v_origem      text;
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
    select descricao, valor, tipo_op, origem
      into v_descricao, v_valor, v_tipo_op, v_origem
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

    -- 8.5 SNAPSHOT CONGELADO do condomínio (migration 36): disparado AQUI,
    --     após a previsão virar 'realizado' e na mesma transação. Best-effort —
    --     qualquer falha é engolida e a realização NUNCA é desfeita por causa
    --     do snapshot (decisão do André).
    if v_origem = 'recorrente' and v_descricao ilike 'Condomínio%' then
        begin
            perform public.registrar_snapshot_condominio(p_planejamento_id, v_user);
        exception when others then
            null;
        end;
    end if;

    -- 9. Devolve o id do lançamento criado (feedback útil para a UI).
    return v_mov_id;
end;
$$;


-- ============================================================================
-- GRANTS
-- ============================================================================
-- Só a RPC de realização fica exposta a authenticated (igual à migration 16).
-- As funções internas (meses_cheios, valor_na_observacao, registrar_snapshot_
-- condominio) precisam de revoke TRIPLO: public (herança padrão) + anon +
-- authenticated (grant direto — o Supabase mantém execute para as roles via
-- default privileges; no teste via REST revogar só de public não bastou). A de
-- snapshot é security definer e aceita p_user por argumento: sem o revoke +
-- grant, qualquer cliente poderia gravar snapshot em nome de outro usuário.
revoke all on function public.meses_cheios(date, date) from public;
revoke all on function public.valor_na_observacao(text, text) from public;
revoke all on function public.registrar_snapshot_condominio(uuid, uuid) from public;
revoke all on function public.meses_cheios(date, date) from anon;
revoke all on function public.valor_na_observacao(text, text) from anon;
revoke all on function public.registrar_snapshot_condominio(uuid, uuid) from anon;
revoke all on function public.meses_cheios(date, date) from authenticated;
revoke all on function public.valor_na_observacao(text, text) from authenticated;
revoke all on function public.registrar_snapshot_condominio(uuid, uuid) from authenticated;
revoke all on function public.realizar_planejamento(uuid, uuid, numeric, date) from public;
grant execute on function public.realizar_planejamento(uuid, uuid, numeric, date) to authenticated;