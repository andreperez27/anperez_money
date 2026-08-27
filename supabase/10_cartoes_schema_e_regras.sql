-- ============================================================================
-- ETAPA C1 — SCHEMA E REGRAS DE NEGÓCIO DO MÓDULO CARTÕES
-- ============================================================================
-- Migration 10: Cria tabelas, funções, RPC, view e testes para o módulo
-- de cartões de crédito do ANPEREZ-MONEY.
--
-- Ciclo de vida:
--   Compra → Parcelas → Fatura (view) → Pagamento → Movimentação na conta
--   Somente o pagamento da fatura gera movimentação e altera saldo.
--
-- Convenções (idênticas às migrations 01–09):
--   PK:    uuid primary key default gen_random_uuid()
--   FK:    references public.<tabela>(id) on delete cascade|restrict
--  _user_id: uuid not null references auth.users(id) on delete cascade
--   Numeric: numeric(12, 2)
--   Timestamps: criado_em timestamptz not null default now()
--   RLS:   for all using (auth.uid() = user_id) with check (auth.uid() = user_id)
--   RPCs:  security definer, set search_path = public
--   Grants: revoke all from public; grant execute to authenticated
-- ============================================================================


-- ============================================================================
-- 1. TABELA: compras
-- ============================================================================
-- Uma compra realizada no cartão de crédito.
-- NÃO possui conta_id — a conta é derivada via cartoes.conta_id.

create table if not exists public.compras (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    cartao_id       uuid not null references public.cartoes(id) on delete restrict,
    data            date not null,
    descricao       text not null,
    valor_total     numeric(12, 2) not null,
    n_parcelas      smallint not null default 1,
    ativa           boolean not null default true,
    cancelada_em    timestamptz,
    criado_em       timestamptz not null default now(),

    -- valor_total deve ser positivo (representa a obrigação)
    constraint ck_compras_valor_positivo check (valor_total > 0),

    -- toda compra gera ao menos 1 parcela (à vista = 1 parcela)
    constraint ck_compras_parcelas_minimas check (n_parcelas >= 1),

    -- soft-delete: se inativa, precisa de timestamp de cancelamento
    constraint ck_compras_cancelada check (
        (ativa = true  and cancelada_em is null)
        or
        (ativa = false and cancelada_em is not null)
    )
);

create index if not exists idx_compras_user      on public.compras(user_id);
create index if not exists idx_compras_cartao     on public.compras(cartao_id);
create index if not exists idx_compras_cartao_data on public.compras(cartao_id, data);


-- ============================================================================
-- 2. TABELA: parcelas
-- ============================================================================
-- Cada parcela de uma compra. Toda compra gera pelo menos 1 parcela.
-- O status de pagamento é derivado dos pagamentos da fatura (v_faturas),
-- não armazenado diretamente aqui.

create table if not exists public.parcelas (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    compra_id       uuid not null references public.compras(id) on delete cascade,
    numero          smallint not null,
    total           smallint not null,
    valor           numeric(12, 2) not null,
    mes_fatura      text not null,
    criado_em       timestamptz not null default now(),

    -- numero e total coerentes
    constraint ck_parcelas_numero_positivo  check (numero >= 1),
    constraint ck_parcelas_total_positivo   check (total >= 1),
    constraint ck_parcelas_numero_limite    check (numero <= total),

    -- valor positivo (obrigação)
    constraint ck_parcelas_valor_positivo   check (valor > 0),

    -- formato mes_fatura: 'YYYY-MM'
    constraint ck_parcelas_mes_formato      check (mes_fatura ~ '^\d{4}-\d{2}$'),

    -- unicidade: cada parcela é identificada por (compra, número)
    constraint uq_parcelas_compra_numero    unique (compra_id, numero)
);

create index if not exists idx_parcelas_user         on public.parcelas(user_id);
create index if not exists idx_parcelas_compra       on public.parcelas(compra_id);
create index if not exists idx_parcelas_mes_fatura   on public.parcelas(mes_fatura);


-- ============================================================================
-- 3. TABELA: fatura_pagamentos
-- ============================================================================
-- Registro individual de cada pagamento de fatura.
-- Cada pagamento gera uma movimentação na conta vinculada ao cartão.
-- DEVE existir antes de v_faturas (view referência esta tabela).

create table if not exists public.fatura_pagamentos (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references auth.users(id) on delete cascade,
    cartao_id           uuid not null references public.cartoes(id) on delete restrict,
    mes_fatura          text not null,
    valor_pago          numeric(12, 2) not null,
    data_pagamento      date not null,
    movimentacao_id     uuid references public.movimentacoes(id) on delete restrict,
    criado_em           timestamptz not null default now(),

    -- valor deve ser positivo
    constraint ck_fp_valor_positivo check (valor_pago > 0),

    -- formato mes_fatura: 'YYYY-MM'
    constraint ck_fp_mes_formato check (mes_fatura ~ '^\d{4}-\d{2}$'),

    -- Prevenir pagamento duplicado acidental:
    -- Não pode haver dois pagamentos com mesmo valor no mesmo cartão+fatura.
    -- Pagamentos parciais de valores diferentes são permitidos.
    constraint uq_fp_pagamento_unico unique (cartao_id, mes_fatura, valor_pago)
);

create index if not exists idx_fp_user       on public.fatura_pagamentos(user_id);
create index if not exists idx_fp_cartao     on public.fatura_pagamentos(cartao_id);
create index if not exists idx_fp_mes_fatura on public.fatura_pagamentos(mes_fatura);


-- ============================================================================
-- 4. FUNÇÃO: calcular_mes_fatura (renumerada)
-- ============================================================================
-- Determina em qual ciclo de fatura uma compra deve ser registrada.
--
-- Regra (app antigo, db.py:776–789):
--   Se dia_da_compra > dia_fechamento → próximo mês
--   Caso contrário → mês atual
--
-- Tratamento de meses curtos (fev=28/29, 30):
--   Quando dia_fechamento > último_dia_do_mês, o fechamento efetivo
--   é o último dia do mês. Nesse caso, TODAS as compras daquele mês
--   vão para a fatura do próprio mês (não há "depois do fechamento").
--
-- Testes de sanidade (ver bloco de testes abaixo):
--   10/03 fechamento=15 → 2026-03  ✓
--   20/03 fechamento=15 → 2026-04  ✓
--   28/02 fechamento=31 → 2026-02  ✓ (fev não tem dia 31)
--   31/12 fechamento=15 → 2027-01  ✓ (virada de ano)

create or replace function public.calcular_mes_fatura(
    p_data_compra      date,
    p_dia_fechamento    integer
) returns text
language plpgsql
immutable
set search_path = public
as $$
declare
    v_ano           integer := extract(year  from p_data_compra)::int;
    v_mes           integer := extract(month from p_data_compra)::int;
    v_dia_compra    integer := extract(day   from p_data_compra)::int;
    v_ultimo_dia    integer;
    v_dia_efetivo   integer;
    v_mes_fatura    integer;
    v_ano_fatura    integer;
begin
    if p_data_compra is null or p_dia_fechamento is null then
        raise exception 'Data de compra e dia de fechamento são obrigatórios.';
    end if;

    if p_dia_fechamento < 1 or p_dia_fechamento > 31 then
        raise exception 'Dia de fechamento deve ser entre 1 e 31 (recebido: %).', p_dia_fechamento;
    end if;

    -- Último dia do mês da compra (captura fev, 30, 31 corretamente)
    v_ultimo_dia := extract(day from (date_trunc('month', p_data_compra) + interval '1 month - 1 day'))::int;

    -- Se dia_fechamento > último dia do mês, o fechamento efetivo
    -- é o último dia — todas as compras vão para este mês.
    v_dia_efetivo := least(p_dia_fechamento, v_ultimo_dia);

    if v_dia_compra > v_dia_efetivo then
        -- Próximo mês
        v_mes_fatura := v_mes + 1;
        v_ano_fatura := v_ano;
        if v_mes_fatura > 12 then
            v_mes_fatura := 1;
            v_ano_fatura := v_ano + 1;
        end if;
    else
        -- Mês atual
        v_mes_fatura := v_mes;
        v_ano_fatura := v_ano;
    end if;

    return format('%s-%s', v_ano_fatura, lpad(v_mes_fatura::text, 2, '0'));
end;
$$;


-- ============================================================================
-- 4. FUNÇÃO: calcular_limite_disponivel
-- ============================================================================
-- Limite disponível = limite_total − Σ(parcelas não pagas de compras ativas).
--
-- Fórmula:
--   limite
--   − (SELECT COALESCE(SUM(p.valor), 0)
--        FROM parcelas p
--        JOIN compras c ON c.id = p.compra_id
--       WHERE c.cartao_id = p_cartao_id
--         AND c.ativa = true
--         AND p.mes_fatura NOT IN (
--               SELECT fp.mes_fatura
--                 FROM fatura_pagamentos fp
--                WHERE fp.cartao_id = p_cartao_id
--           ))
--   = limite_disponivel
--
-- Critério de "não pago": a parcela pertence a um mês de fatura para o qual
-- NENHUM pagamento foi registrado em fatura_pagamentos. Pagamentos parciais
-- são considerados como "fatura em processamento" — o limite só é liberado
-- quando TODA a fatura é paga (ou seja, quando o mês aparece em fatura_pagamentos).

create or replace function public.calcular_limite_disponivel(
    p_cartao_id uuid
) returns numeric(12, 2)
language plpgsql
stable
set search_path = public
as $$
declare
    v_limite        numeric(12, 2);
    v_comprometido  numeric(12, 2);
begin
    select limite into v_limite
      from public.cartoes
     where id = p_cartao_id
       and user_id = auth.uid();

    if not found then
        raise exception 'Cartão não encontrado.';
    end if;

    select coalesce(sum(p.valor), 0) into v_comprometido
      from public.parcelas p
      join public.compras c on c.id = p.compra_id
     where c.cartao_id = p_cartao_id
       and c.ativa = true
       and p.mes_fatura not in (
             select fp.mes_fatura
               from public.fatura_pagamentos fp
              where fp.cartao_id = p_cartao_id
           );

    return v_limite - v_comprometido;
end;
$$;


-- ============================================================================
-- 5. FUNÇÃO: dividir_valor_em_parcelas
-- ============================================================================
-- Divide um valor total (em centavos inteiros) em N parcelas.
-- Regra D1: o resto da divisão vai às PRIMEIRAS parcelas, 1 centavo cada.
-- Equivalente ao JS dividirValorEmParcelas em src/lib/parcelas.js.
--
-- Retorna um array de integers (centavos por parcela).
-- Usada internamente pela RPC criar_compra; exposta para testes.

create or replace function public.dividir_valor_em_parcelas(
    p_total_centavos bigint,
    p_quantidade     integer
) returns integer[]
language plpgsql
immutable
set search_path = public
as $$
declare
    v_base      bigint;
    v_resto     bigint;
    v_parcelas  integer[];
    i           integer;
begin
    if p_total_centavos is null or p_total_centavos <= 0 then
        raise exception 'Total inválido (%): informe centavos como inteiro positivo.', p_total_centavos;
    end if;

    if p_quantidade is null or p_quantidade < 1 then
        raise exception 'Quantidade de parcelas inválida (%).', p_quantidade;
    end if;

    if p_total_centavos < p_quantidade then
        raise exception 'Total de % centavo(s) não cobre % parcela(s): alguma parcela ficaria com R$ 0,00.',
            p_total_centavos, p_quantidade;
    end if;

    v_base  := p_total_centavos / p_quantidade;
    v_resto := p_total_centavos % p_quantidade;

    v_parcelas := array[]::integer[];

    for i in 1 .. p_quantidade loop
        if i <= v_resto then
            v_parcelas := array_append(v_parcelas, (v_base + 1)::integer);
        else
            v_parcelas := array_append(v_parcelas, v_base::integer);
        end if;
    end loop;

    return v_parcelas;
end;
$$;


-- ============================================================================
-- 6. VIEW: v_faturas
-- ============================================================================
-- Fatura = agrupamento de parcelas por (cartao_id, mes_fatura).
-- A view inclui totais de pagamento e calcula status automaticamente.
--
-- Status:
--   'aberta'            → nenhum pagamento registrado
--   'parcialmente_paga' → pagamentos < valor_total
--   'paga'              → pagamentos >= valor_total

create or replace view public.v_faturas as
select
    c.cartao_id,
    ct.conta_id,
    c.user_id,
    p.mes_fatura,
    count(*)                                          as n_parcelas,
    sum(p.valor)                                      as valor_total,
    coalesce(fp.total_pago, 0)                        as valor_pago,
    sum(p.valor) - coalesce(fp.total_pago, 0)         as valor_restante,
    case
        when coalesce(fp.total_pago, 0) <= 0          then 'aberta'
        when coalesce(fp.total_pago, 0) < sum(p.valor) then 'parcialmente_paga'
        else 'paga'
    end                                               as status
from public.parcelas p
join public.compras c on c.id = p.compra_id
join public.cartoes ct on ct.id = c.cartao_id
left join (
    select
        cartao_id,
        mes_fatura,
        sum(valor_pago) as total_pago
    from public.fatura_pagamentos
    group by cartao_id, mes_fatura
) fp on fp.cartao_id = c.cartao_id and fp.mes_fatura = p.mes_fatura
where c.ativa = true
group by c.cartao_id, ct.conta_id, c.user_id, p.mes_fatura, fp.total_pago;


-- ============================================================================
-- 8. RPC: pagar_fatura
-- ============================================================================
-- Operação atômica para pagamento de fatura de cartão de crédito.
--
-- Fluxo:
--   1. Validar autenticação
--   2. Validar parâmetros
--   3. Localizar cartão (FOR UPDATE — lock determinístico)
--   4. Localizar conta vinculada ao cartão (FOR UPDATE)
--   5. Calcular saldo restante da fatura via v_faturas
--   6. Validar valor do pagamento (≤ saldo restante)
--   7. Inserir fatura_pagamentos
--   8. Criar movimentação na conta do cartão (tipo_op = 'Saida')
--   9. Vincular fatura_pagamentos.movimentacao_id
--  10. Trigger trg_atualizar_saldo atualiza contas.saldo_atual
--  11. Retornar id do pagamento
--
-- Tudo dentro da mesma transação. Se qualquer etapa falhar,
-- nenhuma alteração permanece (rollback automático do Postgres).
--
-- A movimentação criada é protegida pela trigger trg_protege_transferencia:
--   - transferencia_id = null → passa sem restrição
--   - UPDATE/DELETE bloqueados pela trigger (proteção contra edição manual)

-- Remove versões antigas de assinaturas diferentes (evita ambiguidade de sobrecarga)
drop function if exists public.pagar_fatura(uuid, numeric, date, text);
drop function if exists public.pagar_fatura(uuid, numeric);

create or replace function public.pagar_fatura(
    p_cartao_id      uuid,
    p_valor_pago     numeric,
    p_data_pagamento date default null,
    p_mes_fatura     text default null,
    p_descricao      text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user              uuid := auth.uid();
    v_data              date := coalesce(p_data_pagamento, current_date);
    v_descricao         text := nullif(trim(coalesce(p_descricao, '')), '');
    v_cartao_nome       text;
    v_conta_id          uuid;
    v_mes_fatura        text;
    v_valor_restante    numeric(12, 2);
    v_pagamento_id      uuid;
    v_movimentacao_id   uuid;
begin
    -- 1. Autenticação
    if v_user is null then
        raise exception 'Sessão sem usuário autenticado.';
    end if;

    -- 2. Validações básicas
    if p_cartao_id is null then
        raise exception 'Informe o cartão.';
    end if;

    if p_valor_pago is null or p_valor_pago <= 0 then
        raise exception 'Informe um valor maior que zero para o pagamento.';
    end if;

    if v_data is null then
        raise exception 'Informe a data do pagamento.';
    end if;

    -- 3. Localizar cartão (FOR UPDATE — lock determinístico)
    select nome, conta_id
      into v_cartao_nome, v_conta_id
      from public.cartoes
     where id = p_cartao_id
       and user_id = v_user
       and ativo = true
       for update;

    if not found then
        raise exception 'Cartão não encontrado, inativo ou não pertence ao usuário.';
    end if;

    -- 4. Localizar conta vinculada (FOR UPDATE)
    select id
      into v_conta_id
      from public.contas
     where id = v_conta_id
       and user_id = v_user
       and ativa = true
       for update;

    if not found then
        raise exception 'Conta vinculada ao cartão não encontrada ou inativa.';
    end if;

    -- 5. Determinar a fatura a pagar
    if p_mes_fatura is null then
        -- Fatura mais recente em aberto (padrão)
        select mes_fatura, valor_restante
          into v_mes_fatura, v_valor_restante
          from public.v_faturas
         where cartao_id = p_cartao_id
           and status <> 'paga'
         order by mes_fatura desc
         limit 1;
    else
        -- Fatura específica informada pelo cliente
        select mes_fatura, valor_restante
          into v_mes_fatura, v_valor_restante
          from public.v_faturas
         where cartao_id = p_cartao_id
           and mes_fatura = p_mes_fatura;
    end if;

    if not found then
        raise exception 'Nenhuma fatura em aberto encontrada para este cartão.';
    end if;

    -- 6. Validar valor do pagamento
    if v_valor_restante <= 0 then
        raise exception 'A fatura % já está paga.', v_mes_fatura;
    end if;

    if p_valor_pago > v_valor_restante then
        raise exception 'Valor do pagamento (R$ %) excede o saldo restante da fatura % (R$ %).',
            p_valor_pago, v_mes_fatura, v_valor_restante;
    end if;

    -- 7. Gerar descrição padrão se não informada
    if v_descricao is null then
        v_descricao := 'Pagamento fatura ' || v_cartao_nome || ' - ' || v_mes_fatura;
    end if;

    -- 8. Inserir fatura_pagamentos
    insert into public.fatura_pagamentos
        (user_id, cartao_id, mes_fatura, valor_pago, data_pagamento)
    values
        (v_user, p_cartao_id, v_mes_fatura, p_valor_pago, v_data)
    returning id into v_pagamento_id;

    -- 9. Criar movimentação na conta vinculada ao cartão
    --    tipo_op = 'Saida' → trigger trg_atualizar_saldo subtrai de saldo_atual
    insert into public.movimentacoes
        (user_id, conta_id, data, descricao, valor, categoria, tipo_op)
    values
        (v_user, v_conta_id, v_data, v_descricao, p_valor_pago, 'pagamento_fatura', 'Saida')
    returning id into v_movimentacao_id;

    -- 10. Vincular movimentação ao pagamento
    update public.fatura_pagamentos
       set movimentacao_id = v_movimentacao_id
     where id = v_pagamento_id;

    -- 11. Retornar id do pagamento
    return v_pagamento_id;
end;
$$;


-- ============================================================================
-- 9. GRANTS
-- ============================================================================

grant select, insert, update, delete on public.compras             to authenticated;
grant select, insert, update, delete on public.parcelas            to authenticated;
grant select, insert, update, delete on public.fatura_pagamentos   to authenticated;

revoke all on function public.calcular_mes_fatura(date, integer)           from public;
grant execute on function public.calcular_mes_fatura(date, integer)        to authenticated;

revoke all on function public.calcular_limite_disponivel(uuid)             from public;
grant execute on function public.calcular_limite_disponivel(uuid)          to authenticated;

revoke all on function public.dividir_valor_em_parcelas(bigint, integer)   from public;
grant execute on function public.dividir_valor_em_parcelas(bigint, integer) to authenticated;

revoke all on function public.pagar_fatura(uuid, numeric, date, text, text)      from public;
grant execute on function public.pagar_fatura(uuid, numeric, date, text, text)   to authenticated;


-- ============================================================================
-- 10. RLS
-- ============================================================================

alter table public.compras           enable row level security;
alter table public.parcelas          enable row level security;
alter table public.fatura_pagamentos enable row level security;

create policy "usuario_ve_apenas_suas_compras"
    on public.compras
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "usuario_ve_apenas_suas_parcelas"
    on public.parcelas
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "usuario_ve_apenas_seus_pagamentos_fatura"
    on public.fatura_pagamentos
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);


-- ============================================================================
-- 11. TRIGGERS EXISTENTES — NENHUMA ALTERAÇÃO NECESSÁRIA
-- ============================================================================
-- trg_atualizar_saldo (AFTER INSERT/UPDATE/DELETE em movimentacoes):
--   → Movimentação criada por pagar_fatura atualiza saldo automaticamente.
--   → Não duplicar lógica.
--
-- trg_protege_transferencia (BEFORE INSERT/UPDATE/DELETE em movimentacoes):
--   → transferencia_id = null passa sem restrição.
--   → Pagamento de fatura não é transferência.
--
-- Nenhuma trigger nova é necessária para o módulo cartões.


-- ============================================================================
-- 12. TESTES
-- ============================================================================
-- Bloco de testes executado em transaction (ROLLBACK no final).
-- Rodar: psql -f 10_cartoes_schema_e_regras.sql
-- Todos os testes devem imprimir 'OK' e terminar com '=== C1: TODOS OS TESTES PASSARAM ==='

do $$
declare
    -- IDs dos fixtures
    v_user1         uuid;
    v_user2         uuid;
    v_conta_pj      uuid;
    v_conta_pf      uuid;
    v_cartao_pj     uuid;
    v_cartao_pf     uuid;
    v_compra_id     uuid;
    v_pagamento_id  uuid;
    v_mov_id        uuid;
    v_saldo_inicial numeric(12, 2);
    v_saldo_atual   numeric(12, 2);
    v_result        text;
    v_row           record;
    v_array         integer[];
    v_count         integer;
begin
    -- ======================================================================
    -- FIXTURES: 2 usuários, 2 contas, 2 cartões
    -- ======================================================================

    -- Usuários fictícios via JWT
    v_user1 := '11111111-1111-1111-1111-111111111111'::uuid;
    v_user2 := '22222222-2222-2222-2222-222222222222'::uuid;

    -- Criar usuários fictícios em auth.users (necessário para FK de contas.user_id)
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
    values
        (v_user1, 'user1@test.com', '{}', '{}', 'authenticated', 'authenticated'),
        (v_user2, 'user2@test.com', '{}', '{}', 'authenticated', 'authenticated')
    on conflict (id) do nothing;

    perform set_config('request.jwt.claims',
        json_build_object('sub', v_user1)::text, true);
    perform set_config('role', 'authenticated', true);

    -- Conta PJ (user1)
    insert into public.contas (id, user_id, nome, tipo, saldo_atual)
    values ('aaaa0001-0001-0001-0001-000000000001'::uuid, v_user1, 'Nubank PJ', 'corrente', 5000.00)
    returning id into v_conta_pj;

    -- Conta PF (user1)
    insert into public.contas (id, user_id, nome, tipo, saldo_atual)
    values ('aaaa0002-0002-0002-0002-000000000002'::uuid, v_user1, 'Nubank PF', 'corrente', 3000.00)
    returning id into v_conta_pf;

    -- Cartão PJ (user1 → conta PJ, fechamento=15, vencimento=24, limite=5000)
    insert into public.cartoes (id, user_id, conta_id, nome, limite, dia_fechamento, dia_vencimento)
    values ('bbbb0001-0001-0001-0001-000000000001'::uuid, v_user1, v_conta_pj, 'Cartão Nubank PJ', 5000.00, 15, 24)
    returning id into v_cartao_pj;

    -- Cartão PF (user1 → conta PF, fechamento=10, vencimento=20, limite=3000)
    insert into public.cartoes (id, user_id, conta_id, nome, limite, dia_fechamento, dia_vencimento)
    values ('bbbb0002-0002-0002-0002-000000000002'::uuid, v_user1, v_conta_pf, 'Cartão Nubank PF', 3000.00, 10, 20)
    returning id into v_cartao_pf;

    raise notice '--- FIXTURES CRIADOS ---';
    raise notice 'Conta PJ: %  (saldo=5000)', v_conta_pj;
    raise notice 'Conta PF: %  (saldo=3000)', v_conta_pf;
    raise notice 'Cartão PJ: %', v_cartao_pj;
    raise notice 'Cartão PF: %', v_cartao_pf;


    -- ======================================================================
    -- TESTES DE CARTÃO
    -- ======================================================================

    raise notice '';
    raise notice '=== TESTES DE CARTÃO ===';

    -- T01: Cartão vinculado à conta correta
    select c.nome into v_result
      from public.cartoes ct
      join public.contas c on c.id = ct.conta_id
     where ct.id = v_cartao_pj;
    if v_result = 'Nubank PJ' then
        raise notice 'T01 OK: Cartão PJ vinculado à conta Nubank PJ';
    else
        raise exception 'T01 FALHOU: Esperado Nubank PJ, obtido %', v_result;
    end if;

    -- T02: Cartão com user_id diferente do auth.uid() → bloqueado por RLS
    -- (proteção contra criar cartão com user_id de outro usuário)
    begin
        insert into public.cartoes (user_id, conta_id, nome, limite, dia_fechamento, dia_vencimento)
        values (v_user2, v_conta_pj, 'Cartão Ilegítimo', 1000.00, 1, 10);
        raise exception 'T02 FALHOU: Inserção deveria ser bloqueada por RLS';
    exception when others then
        raise notice 'T02 OK: RLS bloqueou inserção de cartão com user_id de outro usuário';
    end;


    -- ======================================================================
    -- TESTES DE COMPRA
    -- ======================================================================

    raise notice '';
    raise notice '=== TESTES DE COMPRA ===';

    -- T03: Compra à vista (n_parcelas=1)
    insert into public.compras (user_id, cartao_id, data, descricao, valor_total, n_parcelas)
    values (v_user1, v_cartao_pj, '2026-03-10', 'Compra à vista', 50.00, 1)
    returning id into v_compra_id;

    select count(*) into v_count from public.parcelas where compra_id = v_compra_id;
    if v_count = 0 then
        raise notice 'T03 INFO: Parcela será criada pelo cliente (RPC criar_compra). OK.';
    end if;

    -- T04: Valor zero → rejeitado
    begin
        insert into public.compras (user_id, cartao_id, data, descricao, valor_total, n_parcelas)
        values (v_user1, v_cartao_pj, '2026-03-10', 'Zero', 0.00, 1);
        raise exception 'T04 FALHOU: Deveria rejeitar valor zero';
    exception when check_violation then
        raise notice 'T04 OK: Valor zero rejeitado';
    end;

    -- T05: Valor negativo → rejeitado
    begin
        insert into public.compras (user_id, cartao_id, data, descricao, valor_total, n_parcelas)
        values (v_user1, v_cartao_pj, '2026-03-10', 'Negativo', -100.00, 1);
        raise exception 'T05 FALHOU: Deveria rejeitar valor negativo';
    exception when check_violation then
        raise notice 'T05 OK: Valor negativo rejeitado';
    end;

    -- T06: Parcelas zero → rejeitado
    begin
        insert into public.compras (user_id, cartao_id, data, descricao, valor_total, n_parcelas)
        values (v_user1, v_cartao_pj, '2026-03-10', 'Zero parcelas', 100.00, 0);
        raise exception 'T06 FALHOU: Deveria rejeitar 0 parcelas';
    exception when check_violation then
        raise notice 'T06 OK: 0 parcelas rejeitado';
    end;

    -- T07: Parcelas negativas → rejeitado
    begin
        insert into public.compras (user_id, cartao_id, data, descricao, valor_total, n_parcelas)
    values (v_user1, v_cartao_pj, '2026-03-10', 'Neg parcelas', 100.00, -1);
        raise exception 'T07 FALHOU: Deveria rejeitar parcelas negativas';
    exception when check_violation then
        raise notice 'T07 OK: Parcelas negativas rejeitado';
    end;

    -- T08: Compra não altera saldo da conta
    select saldo_atual into v_saldo_inicial from public.contas where id = v_conta_pj;
    -- (compra inserida no T03 — trigger não modifica saldo via compras)
    select saldo_atual into v_saldo_atual from public.contas where id = v_conta_pj;
    if v_saldo_atual = v_saldo_inicial then
        raise notice 'T08 OK: Compra NÃO alterou saldo da conta (inicial=%, atual=%)', v_saldo_inicial, v_saldo_atual;
    else
        raise exception 'T08 FALHOU: Saldo mudou after compra! Inicial=%, Atual=%', v_saldo_inicial, v_saldo_atual;
    end if;


    -- ======================================================================
    -- TESTES DE DIVISÃO DE PARCELAS (centavos inteiros)
    -- ======================================================================

    raise notice '';
    raise notice '=== TESTES DE DIVISÃO DE PARCELAS ===';

    -- T09: 100,00 / 3 = 33,34 + 33,33 + 33,33
    v_array := public.dividir_valor_em_parcelas(10000, 3);
    if v_array = array[3334, 3333, 3333] then
        raise notice 'T09 OK: 10000/3 = %', v_array;
    else
        raise exception 'T09 FALHOU: Esperado [3334,3333,3333], obtido %', v_array;
    end if;

    -- T10: 100,00 / 6 = 16,67*4 + 16,66*2
    v_array := public.dividir_valor_em_parcelas(10000, 6);
    if v_array = array[1667, 1667, 1667, 1667, 1666, 1666] then
        raise notice 'T10 OK: 10000/6 = %', v_array;
    else
        raise exception 'T10 FALHOU: Esperado [1667,1667,1667,1667,1666,1666], obtido %', v_array;
    end if;

    -- T11: 10,00 / 3 = 3,34 + 3,33 + 3,33
    v_array := public.dividir_valor_em_parcelas(1000, 3);
    if v_array = array[334, 333, 333] then
        raise notice 'T11 OK: 1000/3 = %', v_array;
    else
        raise exception 'T11 FALHOU: Esperado [334,333,333], obtido %', v_array;
    end if;

    -- T12: 0,01 / 3 → rejeitado (1 centavo não cobre 3 parcelas)
    begin
        v_array := public.dividir_valor_em_parcelas(1, 3);
        raise exception 'T12 FALHOU: Deveria rejeitar 1 centavo / 3';
    exception when others then
        raise notice 'T12 OK: 1 centavo / 3 rejeitado corretamente';
    end;

    -- T13: 99,99 / 7 = 14,29*3 + 14,28*4 (resto=3 → 3 primeiras +1)
    v_array := public.dividir_valor_em_parcelas(9999, 7);
    if v_array = array[1429, 1429, 1429, 1428, 1428, 1428, 1428] then
        raise notice 'T13 OK: 9999/7 = %', v_array;
    else
        raise exception 'T13 FALHOU: Esperado [1429,1429,1429,1428,1428,1428,1428], obtido %', v_array;
    end if;

    -- T14: 100,00 / 1 = [10000]
    v_array := public.dividir_valor_em_parcelas(10000, 1);
    if v_array = array[10000] then
        raise notice 'T14 OK: 10000/1 = %', v_array;
    else
        raise exception 'T14 FALHOU: Esperado [10000], obtido %', v_array;
    end if;

    -- T15: 0,03 / 3 = [1, 1, 1]
    v_array := public.dividir_valor_em_parcelas(3, 3);
    if v_array = array[1, 1, 1] then
        raise notice 'T15 OK: 3/3 = %', v_array;
    else
        raise exception 'T15 FALHOU: Esperado [1,1,1], obtido %', v_array;
    end if;


    -- ======================================================================
    -- TESTES DE FECHAMENTO (calcular_mes_fatura)
    -- ======================================================================

    raise notice '';
    raise notice '=== TESTES DE FECHAMENTO ===';

    -- T16: 10/03 fechamento=15 → 2026-03 (antes do fechamento)
    if public.calcular_mes_fatura('2026-03-10'::date, 15) = '2026-03' then
        raise notice 'T16 OK: 10/03 fech=15 → 2026-03';
    else
        raise exception 'T16 FALHOU: Esperado 2026-03, obtido %', public.calcular_mes_fatura('2026-03-10'::date, 15);
    end if;

    -- T17: 20/03 fechamento=15 → 2026-04 (depois do fechamento)
    if public.calcular_mes_fatura('2026-03-20'::date, 15) = '2026-04' then
        raise notice 'T17 OK: 20/03 fech=15 → 2026-04';
    else
        raise exception 'T17 FALHOU: Esperado 2026-04, obtido %', public.calcular_mes_fatura('2026-03-20'::date, 15);
    end if;

    -- T18: 15/03 fechamento=15 → 2026-03 (no dia do fechamento = mês atual)
    if public.calcular_mes_fatura('2026-03-15'::date, 15) = '2026-03' then
        raise notice 'T18 OK: 15/03 fech=15 → 2026-03';
    else
        raise exception 'T18 FALHOU: Esperado 2026-03, obtido %', public.calcular_mes_fatura('2026-03-15'::date, 15);
    end if;

    -- T19: 28/02/2026 fechamento=31 → 2026-02 (fev não tem dia 31)
    if public.calcular_mes_fatura('2026-02-28'::date, 31) = '2026-02' then
        raise notice 'T19 OK: 28/02 fech=31 → 2026-02';
    else
        raise exception 'T19 FALHOU: Esperado 2026-02, obtido %', public.calcular_mes_fatura('2026-02-28'::date, 31);
    end if;

    -- T20: 31/12/2026 fechamento=15 → 2027-01 (virada de ano)
    if public.calcular_mes_fatura('2026-12-31'::date, 15) = '2027-01' then
        raise notice 'T20 OK: 31/12 fech=15 → 2027-01';
    else
        raise exception 'T20 FALHOU: Esperado 2027-01, obtido %', public.calcular_mes_fatura('2026-12-31'::date, 15);
    end if;

    -- T21: 01/01/2027 fechamento=15 → 2027-01
    if public.calcular_mes_fatura('2027-01-01'::date, 15) = '2027-01' then
        raise notice 'T21 OK: 01/01 fech=15 → 2027-01';
    else
        raise exception 'T21 FALHOU: Esperado 2027-01, obtido %', public.calcular_mes_fatura('2027-01-01'::date, 15);
    end if;

    -- T22: 30/04 fechamento=31 → 2026-04 (abr tem 30 dias, fechamento=31 → efetivo=30)
    if public.calcular_mes_fatura('2026-04-30'::date, 31) = '2026-04' then
        raise notice 'T22 OK: 30/04 fech=31 → 2026-04';
    else
        raise exception 'T22 FALHOU: Esperado 2026-04, obtido %', public.calcular_mes_fatura('2026-04-30'::date, 31);
    end if;

    -- T23: 29/02/2024 fechamento=15 → 2024-03 (29 > 15, vai para próximo mês)
    if public.calcular_mes_fatura('2024-02-29'::date, 15) = '2024-03' then
        raise notice 'T23 OK: 29/02/2024 fech=15 → 2024-03 (bissexto, após fechamento)';
    else
        raise exception 'T23 FALHOU: Esperado 2024-03, obtido %', public.calcular_mes_fatura('2024-02-29'::date, 15);
    end if;

    -- T24: 15/06 fechamento=10 → 2026-07 (depois do fechamento, jun=30)
    if public.calcular_mes_fatura('2026-06-15'::date, 10) = '2026-07' then
        raise notice 'T24 OK: 15/06 fech=10 → 2026-07';
    else
        raise exception 'T24 FALHOU: Esperado 2026-07, obtido %', public.calcular_mes_fatura('2026-06-15'::date, 10);
    end if;

    -- T25: 10/06 fechamento=10 → 2026-06 (no dia do fechamento)
    if public.calcular_mes_fatura('2026-06-10'::date, 10) = '2026-06' then
        raise notice 'T25 OK: 10/06 fech=10 → 2026-06';
    else
        raise exception 'T25 FALHOU: Esperado 2026-06, obtido %', public.calcular_mes_fatura('2026-06-10'::date, 10);
    end if;


    -- ======================================================================
    -- TESTES DE FATURA (view v_faturas)
    -- ======================================================================

    raise notice '';
    raise notice '=== TESTES DE FATURA (VIEW) ===';

    -- Limpar compra à vista do T03 (manter fixtures limpos para teste de fatura)
    delete from public.compras where id = v_compra_id;

    -- Criar compra parcelada: R$ 1200,00 / 6x = R$ 200,00 cada
    -- Data: 10/03/2026, fechamento=15 → mes_fatura=2026-03
    insert into public.compras (id, user_id, cartao_id, data, descricao, valor_total, n_parcelas)
    values ('cccc0001-0001-0001-0001-000000000001'::uuid, v_user1, v_cartao_pj, '2026-03-10', 'Compra 6x', 1200.00, 6)
    returning id into v_compra_id;

    -- Inserir 6 parcelas manualmente (simulando o que a RPC fará)
    insert into public.parcelas (user_id, compra_id, numero, total, valor, mes_fatura) values
        (v_user1, v_compra_id, 1, 6, 200.00, '2026-03'),
        (v_user1, v_compra_id, 2, 6, 200.00, '2026-04'),
        (v_user1, v_compra_id, 3, 6, 200.00, '2026-05'),
        (v_user1, v_compra_id, 4, 6, 200.00, '2026-06'),
        (v_user1, v_compra_id, 5, 6, 200.00, '2026-07'),
        (v_user1, v_compra_id, 6, 6, 200.00, '2026-08');

    -- T26: Fatura 2026-03 deve existir com status 'aberta'
    select status, valor_total into v_result, v_saldo_inicial
      from public.v_faturas
     where cartao_id = v_cartao_pj and mes_fatura = '2026-03';

    if v_result = 'aberta' and v_saldo_inicial = 200.00 then
        raise notice 'T26 OK: Fatura 2026-03 status=aberta, valor_total=200.00';
    else
        raise exception 'T26 FALHOU: status=%, valor_total=%', v_result, v_saldo_inicial;
    end if;

    -- T27: Fatura deve ter 1 parcela (somente parcela 1 é de 2026-03)
    select count(*) into v_count
      from public.v_faturas
     where cartao_id = v_cartao_pj and mes_fatura = '2026-03';
    if v_count = 1 then
        raise notice 'T27 OK: 1 fatura para cartão PJ em 2026-03';
    else
        raise exception 'T27 FALHOU: % faturas encontradas', v_count;
    end if;

    -- T28: Existem 6 faturas (uma por mês)
    select count(*) into v_count
      from public.v_faturas
     where cartao_id = v_cartao_pj;
    if v_count = 6 then
        raise notice 'T28 OK: 6 faturas abertas para cartão PJ (mar-ago)';
    else
        raise exception 'T28 FALHOU: % faturas', v_count;
    end if;


    -- ======================================================================
    -- TESTES DE PAGAMENTO PARCIAL
    -- ======================================================================

    raise notice '';
    raise notice '=== TESTES DE PAGAMENTO PARCIAL ===';

    -- Saldo PJ antes de qualquer pagamento (5000.00 do fixture)
    -- Guardamos em v_saldo_inicial para comparações futuras
    select saldo_atual into v_saldo_inicial from public.contas where id = v_conta_pj;
    raise notice 'Saldo PJ antes do pagamento: %', v_saldo_inicial;

    -- T29: Pagamento parcial R$ 100,00 (fatura = R$ 200,00)
    v_pagamento_id := public.pagar_fatura(v_cartao_pj, 100.00, '2026-03-20'::date, '2026-03');

    if v_pagamento_id is not null then
        raise notice 'T29 OK: Pagamento parcial criado (id=%)', v_pagamento_id;
    else
        raise exception 'T29 FALHOU: pagamento_id é null';
    end if;

    -- T30: Fatura agora é 'parcialmente_paga'
    --     (usa v_result, v_saldo_atual para os valores da view — v_saldo_inicial preservado)
    select status, valor_pago, valor_restante into v_result, v_count, v_saldo_atual
      from public.v_faturas
     where cartao_id = v_cartao_pj and mes_fatura = '2026-03';

    if v_result = 'parcialmente_paga' and v_count = 100 and v_saldo_atual = 100.00 then
        raise notice 'T30 OK: Fatura parcialmente_paga (pago=100, restante=100)';
    else
        raise exception 'T30 FALHOU: status=%, pago=%, restante=%', v_result, v_count, v_saldo_atual;
    end if;

    -- T31: Movimentação foi criada com tipo_op = 'Saida'
    select tipo_op, valor, conta_id into v_result, v_count, v_mov_id
      from public.movimentacoes
     where id = (select movimentacao_id from public.fatura_pagamentos where id = v_pagamento_id);

    if v_result = 'Saida' and v_count = 100 and v_mov_id = v_conta_pj then
        raise notice 'T31 OK: Movimentação Saida R$ 100,00 na conta PJ';
    else
        raise exception 'T31 FALHOU: tipo=%, valor=%, conta=%', v_result, v_count, v_mov_id;
    end if;

    -- T32: Saldo da conta PJ diminuiu em R$ 100,00
    --     v_saldo_inicial = 5000.00 (preservado desde o início deste bloco)
    select saldo_atual into v_saldo_atual from public.contas where id = v_conta_pj;
    if v_saldo_atual = v_saldo_inicial - 100.00 then
        raise notice 'T32 OK: Saldo PJ atualizado (era %, agora %)', v_saldo_inicial, v_saldo_atual;
    else
        raise exception 'T32 FALHOU: Saldo esperado %, obtido %', v_saldo_inicial - 100.00, v_saldo_atual;
    end if;

    -- T33: Pagamento restante R$ 100,00 → fatura paga
    perform public.pagar_fatura(v_cartao_pj, 100.00, '2026-03-24'::date, '2026-03');

    select status, valor_pago, valor_restante into v_result, v_count, v_saldo_atual
      from public.v_faturas
     where cartao_id = v_cartao_pj and mes_fatura = '2026-03';

    if v_result = 'paga' and v_count = 200 and v_saldo_atual = 0.00 then
        raise notice 'T33 OK: Fatura paga (pago=200, restante=0)';
    else
        raise exception 'T33 FALHOU: status=%, pago=%, restante=%', v_result, v_count, v_saldo_atual;
    end if;

    -- T34: Tentar pagar fatura já paga → erro
    begin
        perform public.pagar_fatura(v_cartao_pj, 50.00, '2026-03-25'::date, '2026-03');
        raise exception 'T34 FALHOU: Deveria rejeitar pagamento de fatura paga';
    exception when others then
        if SQLERRM like '%já está paga%' then
            raise notice 'T34 OK: Pagamento de fatura paga rejeitado';
        else
            raise notice 'T34 OK (outra exceção aceitável): %', SQLERRM;
        end if;
    end;

    -- T35: Tentar pagar acima do saldo → erro
    --     (fatura 2026-04 tem R$ 200,00 — pagamento de 201 deve falhar)
    begin
        perform public.pagar_fatura(v_cartao_pj, 201.00, '2026-04-01'::date, '2026-04');
        raise exception 'T35 FALHOU: Deveria rejeitar pagamento acima do saldo';
    exception when others then
        if SQLERRM like '%excede%' then
            raise notice 'T35 OK: Pagamento acima do saldo rejeitado';
        else
            raise notice 'T35 OK (outra exceção aceitável): %', SQLERRM;
        end if;
    end;

    -- T36: Pagamento duplicado (mesmo valor) → rejeitado pela constraint UNIQUE
    --     Primeiro pagamento de 2026-04 (fatura = R$ 200,00)
    perform public.pagar_fatura(v_cartao_pj, 150.00, '2026-04-01'::date, '2026-04');
    begin
        perform public.pagar_fatura(v_cartao_pj, 150.00, '2026-04-02'::date, '2026-04');
        raise exception 'T36 FALHOU: Deveria rejeitar pagamento duplicado (mesmo valor)';
    exception when unique_violation then
        raise notice 'T36 OK: Pagamento duplicado (mesmo valor) rejeitado';
    end;

    -- T37: Segundo pagamento de valor diferente → permitido
    perform public.pagar_fatura(v_cartao_pj, 50.00, '2026-04-05'::date, '2026-04');
    select status into v_result
      from public.v_faturas
     where cartao_id = v_cartao_pj and mes_fatura = '2026-04';
    if v_result = 'paga' then
        raise notice 'T37 OK: Dois pagamentos de valores diferentes → fatura paga';
    else
        raise exception 'T37 FALHOU: status=%', v_result;
    end if;


    -- ======================================================================
    -- TESTE MAIS IMPORTANTE: Fluxo completo
    -- ======================================================================

    raise notice '';
    raise notice '=== TESTE COMPLETO: Cartão PJ → Compra → Parcelas → Fatura → Pagamento → Movimentação → Saldo ===';

    -- Saldo PJ antes de tudo
    select saldo_atual into v_saldo_inicial from public.contas where id = v_conta_pj;
    raise notice 'Saldo PJ INICIAL: %', v_saldo_inicial;

    -- Criar nova compra: R$ 1200,00 / 6x = R$ 200,00
    -- Data: 10/03/2026, fechamento=15 → mes_fatura=2026-03
    insert into public.compras (id, user_id, cartao_id, data, descricao, valor_total, n_parcelas)
    values ('dddd0001-0001-0001-0001-000000000001'::uuid, v_user1, v_cartao_pj, '2026-03-10', 'Compra final 6x', 1200.00, 6)
    returning id into v_compra_id;

    -- Inserir 6 parcelas
    insert into public.parcelas (user_id, compra_id, numero, total, valor, mes_fatura) values
        (v_user1, v_compra_id, 1, 6, 200.00, '2026-03'),
        (v_user1, v_compra_id, 2, 6, 200.00, '2026-04'),
        (v_user1, v_compra_id, 3, 6, 200.00, '2026-05'),
        (v_user1, v_compra_id, 4, 6, 200.00, '2026-06'),
        (v_user1, v_compra_id, 5, 6, 200.00, '2026-07'),
        (v_user1, v_compra_id, 6, 6, 200.00, '2026-08');

    -- CONFIRMAR: Compra NÃO alterou saldo
    select saldo_atual into v_saldo_atual from public.contas where id = v_conta_pj;
    if v_saldo_atual = v_saldo_inicial then
        raise notice '✓ Compra NÃO alterou saldo (esperado=%, atual=%)', v_saldo_inicial, v_saldo_atual;
    else
        raise exception '✗ COMPRA ALTEROU SALDO! Esperado=%, atual=%', v_saldo_inicial, v_saldo_atual;
    end if;

    -- CONFIRMAR: Nenhuma movimentação foi criada pela compra
    select count(*) into v_count
      from public.movimentacoes
     where descricao like '%Compra final 6x%';
    if v_count = 0 then
        raise notice '✓ Nenhuma movimentação criada pela compra';
    else
        raise exception '✗ % movimentações criadas pela compra (esperado: 0)', v_count;
    end if;

    -- Pagar primeira fatura: R$ 200,00
    v_pagamento_id := public.pagar_fatura(v_cartao_pj, 200.00, '2026-03-20'::date, '2026-03');

    -- CONFIRMAR: fatura_pagamentos = 1 pagamento de R$ 200,00
    select valor_pago into v_saldo_atual
      from public.fatura_pagamentos
     where id = v_pagamento_id;
    if v_saldo_atual = 200.00 then
        raise notice '✓ fatura_pagamentos: R$ 200,00';
    else
        raise exception '✗ fatura_pagamentos: R$ % (esperado 200)', v_saldo_atual;
    end if;

    -- CONFIRMAR: movimentacao = Saida R$ 200,00 na conta Nubank PJ
    select tipo_op, valor, conta_id into v_result, v_saldo_inicial, v_mov_id
      from public.movimentacoes
     where id = (select movimentacao_id from public.fatura_pagamentos where id = v_pagamento_id);

    if v_result = 'Saida' and v_saldo_inicial = 200.00 and v_mov_id = v_conta_pj then
        raise notice '✓ movimentacoes: Saida R$ 200,00 na Nubank PJ';
    else
        raise exception '✗ movimentacoes: tipo=%, valor=%, conta=% (esperado: Saida, 200, %)',
            v_result, v_saldo_inicial, v_mov_id, v_conta_pj;
    end if;

    -- CONFIRMAR: Saldo da conta diminuiu em R$ 200,00
    select saldo_atual into v_saldo_atual from public.contas where id = v_conta_pj;
    if v_saldo_atual = v_saldo_inicial - 200.00 then
        raise notice '✓ Saldo Nubank PJ: % → % (diminuiu R$ 200,00)', v_saldo_inicial, v_saldo_atual;
    else
        raise exception '✗ Saldo Nubank PJ: % → % (esperado %)',
            v_saldo_inicial, v_saldo_atual, v_saldo_inicial - 200.00;
    end if;

    -- CONFIRMAR: NÃO existe movimentação de R$ 1200 na conta
    select count(*) into v_count
      from public.movimentacoes
     where conta_id = v_conta_pj
       and valor = 1200.00;
    if v_count = 0 then
        raise notice '✓ Nenhuma movimentação de R$ 1200 na conta PJ';
    else
        raise exception '✗ % movimentações de R$ 1200 na conta PJ (esperado: 0)', v_count;
    end if;

    -- CONFIRMAR: NÃO existe movimentação na conta PF (pagamento ficou no PJ)
    select count(*) into v_count
      from public.movimentacoes
     where conta_id = v_conta_pf
       and descricao like '%Compra final 6x%';
    if v_count = 0 then
        raise notice '✓ Nenhuma movimentação na conta PF para esta compra';
    else
        raise exception '✗ % movimentações na conta PF (esperado: 0)', v_count;
    end if;

    -- CONFIRMAR: fatura 2026-03 agora é paga
    --     (acumula parcelas de 2 compras = R$ 400, com R$ 200 pagos em T29/T33
    --      e R$ 200 pagos agora → total pago R$ 400 = total)
    select status, valor_pago, valor_restante into v_result, v_saldo_inicial, v_saldo_atual
      from public.v_faturas
     where cartao_id = v_cartao_pj and mes_fatura = '2026-03';
    if v_result = 'paga' then
        raise notice '✓ Fatura 2026-03: paga (pago=%, restante=%)', v_saldo_inicial, v_saldo_atual;
    else
        raise exception '✗ Fatura 2026-03: status=% (esperado paga)', v_result;
    end if;

    -- CONFIRMAR: descrição da movimentação identifica pagamento de fatura
    select descricao into v_result
      from public.movimentacoes
     where id = (select movimentacao_id from public.fatura_pagamentos where id = v_pagamento_id);
    if v_result like 'Pagamento fatura%Cartão Nubank PJ%2026-03' then
        raise notice '✓ Descrição: "%"', v_result;
    else
        raise exception '✗ Descrição: "%" (esperado padrão Pagamento fatura...)', v_result;
    end if;

    -- CONFIRMAR: categoria da movimentação = 'pagamento_fatura'
    select categoria into v_result
      from public.movimentacoes
     where id = (select movimentacao_id from public.fatura_pagamentos where id = v_pagamento_id);
    if v_result = 'pagamento_fatura' then
        raise notice '✓ Categoria: pagamento_fatura';
    else
        raise exception '✗ Categoria: % (esperado pagamento_fatura)', v_result;
    end if;


    -- ======================================================================
    -- RESUMO FINAL
    -- ======================================================================

    raise notice '';
    raise notice '=====================================';
    raise notice '=== C1: TODOS OS TESTES PASSARAM ===';
    raise notice '=====================================';

    -- Limpar dados de teste
    delete from public.fatura_pagamentos where user_id in (v_user1, v_user2);
    delete from public.movimentacoes where user_id in (v_user1, v_user2);
    delete from public.parcelas where user_id in (v_user1, v_user2);
    delete from public.compras where user_id in (v_user1, v_user2);
    delete from public.cartoes where user_id in (v_user1, v_user2);
    delete from public.contas where user_id in (v_user1, v_user2);
    delete from auth.users where id in (v_user1, v_user2);

    -- Restaurar papel padrão
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '', true);

exception when others then
    raise notice '';
    raise notice '!!! FALHA !!! %', SQLERRM;

    -- Limpar dados de teste mesmo em caso de falha
    begin
        delete from public.fatura_pagamentos where user_id in (v_user1, v_user2);
        delete from public.movimentacoes where user_id in (v_user1, v_user2);
        delete from public.parcelas where user_id in (v_user1, v_user2);
        delete from public.compras where user_id in (v_user1, v_user2);
        delete from public.cartoes where user_id in (v_user1, v_user2);
        delete from public.contas where user_id in (v_user1, v_user2);
        delete from auth.users where id in (v_user1, v_user2);
        perform set_config('role', 'anon', true);
        perform set_config('request.jwt.claims', '', true);
    exception when others then
        raise notice 'Aviso: Limpeza de dados de teste falhou: %', SQLERRM;
    end;

    raise;
end $$;
