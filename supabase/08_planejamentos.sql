-- ============================================================================
-- ETAPA 06 / E1 — Schema do módulo PLANEJAMENTO
-- ============================================================================
-- Como usar: entre no seu projeto Supabase, vá em "SQL Editor" (menu lateral),
-- cole este arquivo inteiro e clique em Run. Ele cria a tabela planejamentos
-- já com a regra de segurança (RLS) ativada.
--
-- Se algo der errado no meio, pode rodar de novo sem medo: o "drop ... if
-- exists" no topo limpa qualquer tentativa anterior antes de recriar do zero
-- (mesmo padrão das migrations 01 e 02).
--
-- REGRA DE OURO DO MÓDULO (vale para todo o código que vier depois):
--   > Planejamento PREVÊ. Contas registram o dinheiro real. Cartões registram
--     compras e faturas. A realização de uma previsão é que pode gerar um
--     lançamento real.
--
-- Por isso esta tabela NUNCA tem trigger tocando contas.saldo_atual: uma
-- linha aqui é apenas uma previsão ("o que o usuário espera receber/gastar").
-- Nenhuma função SQL calcula saldo projetado nem número de semana — quem
-- preenche ano_semana/semana é a aplicação (src/lib/semana.js), única fonte
-- da verdade do calendário ISO.
-- ============================================================================

drop table if exists public.planejamentos cascade;


-- ----------------------------------------------------------------------------
-- TABELA: planejamentos
-- ----------------------------------------------------------------------------
-- Cada linha é UMA previsão de entrada ou despesa em UMA data civil futura
-- (ou passada, se o usuário cadastrar algo que já aconteceu). Segue as mesmas
-- convenções das tabelas anteriores: id uuid gerado pelo banco, user_id
-- amarrado ao auth.users com cascade (a segurança de verdade fica no RLS,
-- logo abaixo), valores em numeric(12,2) nunca float e datas como date.
--
-- Campos-chave:
--   tipo_op          'Entrada' ou 'Saida' — mesma semântica de movimentacoes,
--                    mas aqui significa "previsão de entrada/despesa".
--   estado           ciclo de vida da previsão:
--                      previsto  → ainda não aconteceu
--                      realizado → concretizou-se (um dia apontará o
--                                  lançamento real via lancamento_id)
--                      cancelado → deixou de existir (histórico preservado;
--                                  por isso não há exclusão automática)
--   origem           de onde veio a previsão: manual (digitada pelo usuário),
--                    jornada (futura Jornada de Trabalho), recorrente (futuras
--                    regras mensais/anuais) ou outro. Hoje tudo nasce 'manual'.
--   conta_destino_id destino PREVISTO (opcional): onde o dinheiro deveria
--                    passar quando acontecer (ex.: "Nubank PJ"). É só uma
--                    anotação — NÃO move um centavo. Se a conta for excluída,
--                    a previsão continua, apenas sem destino (set null).
--   ano_semana /
--   semana           cache do calendário ISO (ex.: 2026/S33 = 10/08 a 16/08)
--                    preenchido pela aplicação na hora de salvar, para a visão
--                    principal do módulo filtrar a semana inteira com índice.
--   lancamento_id    reservado para a FUTURA realização (Planejado → Realizado):
--                    um dia apontará o lançamento em movimentacoes. Fica SEM
--                    foreign key de propósito nesta etapa — a política de
--                    vínculo (o que acontece ao excluir o lançamento etc.) será
--                    decidida na etapa própria de realização.
--   observacao       texto livre opcional.

create table public.planejamentos (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references auth.users(id) on delete cascade,
    tipo_op          text not null check (tipo_op in ('Entrada', 'Saida')),
    descricao        text not null,
    valor            numeric(12, 2) not null check (valor > 0),
    data_prevista    date not null,
    estado           text not null default 'previsto'
                     check (estado in ('previsto', 'realizado', 'cancelado')),
    origem           text not null default 'manual'
                     check (origem in ('manual', 'jornada', 'recorrente', 'outro')),
    conta_destino_id uuid references public.contas(id) on delete set null,
    ano_semana       smallint not null,
    semana           smallint not null check (semana between 1 and 53),
    lancamento_id    uuid,
    observacao       text,
    criado_em        timestamptz not null default now()
);

comment on table public.planejamentos is 'Previsões financeiras do Planejamento (entradas/despesas esperadas por semana ISO). NUNCA altera saldos — ver regra de ouro no cabeçalho';

-- Índices seguindo a convenção idx_<tabela>_<referência> das migrations
-- anteriores: um para o dono das linhas (RLS/listas gerais), um para a busca
-- principal do módulo ("mostre a Semana 33/2026 desta pessoa") e um para
-- consultas futuras por data prevista (ex.: próximos compromissos).
create index idx_planejamentos_user on public.planejamentos(user_id);
create index idx_planejamentos_semana on public.planejamentos(user_id, ano_semana, semana);
create index idx_planejamentos_data_prevista on public.planejamentos(data_prevista);


-- ============================================================================
-- ROW LEVEL SECURITY (RLS) — mesmo padrão das tabelas anteriores
-- ============================================================================
-- Uma única policy "for all": o using controla SELECT/UPDATE/DELETE e o
-- with check controla INSERT/UPDATE. Resultado: ninguém lê OU escreve
-- previsões fora do próprio user_id, nem tentando forçar isso na requisição.

alter table public.planejamentos enable row level security;

create policy "usuario_ve_apenas_seus_planejamentos"
    on public.planejamentos
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
