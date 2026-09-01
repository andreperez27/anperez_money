-- ============================================================================
-- ETAPA 07 — Módulo PONTO INTELIGENTE (jornada de trabalho por exceções)
-- ============================================================================
-- Como usar: SQL Editor do Supabase → cole o arquivo inteiro → Run.
--
-- O "drop ... if exists" no topo limpa tentativas anteriores antes de criar
-- do zero (mesmo padrão das migrations 01/02/08). Depois de criado, é
-- idempotente à moda das migrations aditivas: rodar de novo apenas recria
-- as tabelas vazias + seed da config, sem tocar em outras tabelas.
--
-- MODELO DE NEGÓCIO (decidido com André em 01/09/2026, após ler a lógica do
-- app antigo Controle_Horas\dist_android):
--
--   1) A CARGA PADRÃO é constante da aplicação (src/lib/pontoCalc.js) e NUNCA
--      é lançada: Seg–Sex 20:30→03:00 (6,5h), Sáb 20:30→02:00 (5,5h), Dom sem
--      carga. O app antigo lançava TODOS os dias com entrada/saída; o novo
--      lança SOMENTE EXCEÇÕES — dia sem lançamento = carga cumprida.
--   2) FERIADO é tabela (calendário nacional/municipal), não set fixo no
--      código como no app antigo. Folga em feriado não precisa de lançamento.
--      Trabalhar em feriado (ou domingo) = lançamento tipo 'domfer' (base 0,
--      toda hora é extra) com diária congelada pela hora de saída.
--   3) HORA EXTRA em dia normal = lançamento tipo 'he': horas trabalhadas
--      menos a base do dia (seg–sex 6,5h / sáb 5,5h), valor = HE × R$/h.
--   4) FÉRIAS são AVULSAS (dias soltos), cada uma marcada como exceção tipo
--      'ferias' SEM horários: o dia conta como carga cumprida sem exigir
--      lançamento, e fica registrado para o relatório anual (15 dias/ano).
--   5) VALORES EM R$ são congelados NO MOMENTO do lançamento (colunas
--      valor_he / valor_domfer / valor_fixo), como o app antigo fazia —
--      reajustes futuros de config não retrocalculam registros passados.
--      Token/adicional noturno NÃO existe: turno que cruza meia-noite tem a
--      duração calculada como no antigo (saida <= entrada → +1 dia); o valor
--      da hora extra é único (VALOR_HE_NORMAL).
--
-- A tabela de exceções é modelada por TIPO justamente para não travar quando
-- forem definidas novas regras (o tipo 'ferias' já é um exemplo disso).
--
-- O user_id é amarrado a auth.users com cascade e a segurança fica no RLS
-- (mesmo padrão das tabelas do projeto). ponto_config e ponto_feriados são
-- GLOBAIS (calendário e valores do sistema, não por usuário).
-- ============================================================================

drop table if exists public.ponto_excecoes cascade;
drop table if exists public.ponto_feriados cascade;
drop table if exists public.ponto_config cascade;

-- ----------------------------------------------------------------------------
-- TABELA: ponto_config — valores monetários atuais do módulo
-- ----------------------------------------------------------------------------
-- Chaves espelham as do app antigo (tabela configuracoes), já com o REAJUSTE
-- vigente (VALOR_FIXO_SEMANA passou de 1600 → 1650 na semana de 09/03/2026).
-- O CONGELAMENTO acontece no hook (usePonto) na hora de gravar: o que fica
-- aqui é o valor vigente para lançamentos NOVOS; lançamentos antigos
-- preservam os valores gravados nas colunas valor_* de ponto_excecoes.
create table public.ponto_config (
    chave  text             primary key,
    valor  numeric(12, 2)   not null
);

comment on table public.ponto_config is
    'Valores monetários vigentes do Ponto Inteligente (paralelo ao configuracoes do app antigo, com o reajuste de 1650). Congelados na hora do lançamento';

insert into public.ponto_config (chave, valor) values
    ('VALOR_FIXO_SEMANA', 1650.0),
    ('VALOR_HE_NORMAL', 40.0),
    ('VALOR_DOMINGO_ATE4', 400.0),
    ('VALOR_DOMINGO_ATE6', 500.0)
on conflict (chave) do update set valor = excluded.valor;

alter table public.ponto_config enable row level security;

create policy "usuario_logado_ve_e_edita_config_ponto"
    on public.ponto_config
    for all
    to authenticated
    using (true)
    with check (true);

-- ----------------------------------------------------------------------------
-- TABELA: ponto_feriados — calendário de feriados (global)
-- ----------------------------------------------------------------------------
-- Substitui o set FERIADOS_2026 hardcoded do app antigo. data única global;
-- qualquer usuário autenticado gerencia (app pessoal de um usuário).
create table public.ponto_feriados (
    id        uuid                primary key default gen_random_uuid(),
    data      date                not null unique,
    nome      text                not null,
    criado_em timestamptz         not null default now()
);

comment on table public.ponto_feriados is
    'Feriados do calendário (antigo FERIADOS_2026 hardcoded). Folga em feriado = nada a lançar; trabalho em feriado = exceção domfer (base 0). Global, não por usuário';

create index idx_ponto_feriados_data on public.ponto_feriados(data);

alter table public.ponto_feriados enable row level security;

create policy "usuario_logado_ve_e_edita_feriados"
    on public.ponto_feriados
    for all
    to authenticated
    using (true)
    with check (true);

-- ----------------------------------------------------------------------------
-- TABELA: ponto_excecoes — lançamentos de exceção ao padrão, por usuário
-- ----------------------------------------------------------------------------
-- Uma linha por DATA (user_id + data únicos). A coluna tipo guarda o que foi
-- lançado; os valores calculados (horas, he, domfer_qtd) e monetários
-- (valor_he, valor_domfer, valor_fixo) são congelados no momento da gravação
-- pelo hook, após passar pela lib pura pontoCalc.js (que cruza a meia-noite e
-- aplica base 0 a dom/fer). Férias lançam tipo 'ferias' SEM horas (contam
-- como carga cumprida). Sem lançamento em dia de semana = padrão cumprido.
create table public.ponto_excecoes (
    id           uuid          primary key default gen_random_uuid(),
    user_id      uuid          not null default auth.uid() references auth.users(id) on delete cascade,
    data         date          not null,
    tipo         text          not null check (tipo in ('he', 'domfer', 'ferias')),
    entrada      text          check (entrada ~ '^\d{2}:\d{2}$'),
    saida        text          check (saida ~ '^\d{2}:\d{2}$'),
    horas        numeric(6, 2) not null default 0 check (horas >= 0),
    he           numeric(6, 2) not null default 0 check (he >= 0),
    domfer_qtd   smallint      not null default 0 check (domfer_qtd in (0, 1)),
    valor_he     numeric(12, 2) not null default 0 check (valor_he >= 0),
    valor_domfer numeric(12, 2) not null default 0 check (valor_domfer >= 0),
    valor_fixo   numeric(12, 2)          check (valor_fixo >= 0),
    obs          text,
    criado_em    timestamptz   not null default now(),
    constraint ponto_excecoses_dia_unico unique (user_id, data),
    -- férias NÃO carregam horário; he/domfer SEMPRE carregam ambos
    constraint ponto_ferias_sem_horario check (
        (tipo = 'ferias' and entrada is null and saida is null)
        or (tipo in ('he', 'domfer') and entrada is not null and saida is not null)
    )
);

comment on table public.ponto_excecoes is
    'Exceções ao padrão de jornada: hora extra (he), trabalho em domingo/feriado (domfer) e férias avulsas (ferias, sem horários, conta como carga cumprida). Dia sem linha = carga padrão cumprida. Valores monetários congelados na gravação';

create index idx_ponto_excecoes_user on public.ponto_excecoes(user_id);
create index idx_ponto_excecoes_data on public.ponto_excecoes(data);

alter table public.ponto_excecoes enable row level security;

create policy "usuario_ve_apenas_suas_excecoes"
    on public.ponto_excecoes
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);