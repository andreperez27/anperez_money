-- ============================================================================
-- ETAPA 06 (Planejamento) — MIGRATION 17: despesa_recorrente_item
-- ============================================================================
-- Guarda os itens FIXOS da despesa mensal de condomínio (o "corpo" do boleto:
-- Cota Condominial, Taxa de Coleta, Fundo de Reserva, Leitura, e os itens com
-- contador de parcela e fim já conhecido — Manut. Pintura PC e Benfeitorias).
--
-- É a fonte de dados do GERADOR da previsão mensal de condomínio (substitui o
-- script local gerar_boletos.py, que lia Boletos.xlsx e mantinha estado num
-- JSON solto no Windows). Os valores VARIÁVEIS (Consumo de Gás e de Água) NÃO
-- ficam nesta tabela: são digitados pelo usuário todo mês na tela e somados ao
-- total na hora de gerar a previsão.
--
-- MODELO DE VIGÊNCIA ("Custos fixos" da planilha):
--   Um item é uma LINHA com vigencia_inicio e vigencia_termino (null =
--   vigente até novo aviso). ALTERAR uma taxa NUNCA sobrescreve a linha antiga:
--   grava-se uma NOVA linha com o novo valor e data de início, e FECHA-SE a
--   linha anterior com vigencia_termino = dia anterior ao início da nova.
--   Assim o HISTÓRICO fica intacto e a previsão de qualquer mês passado
--   continua correta (mesma regra do gerador: valor vigente naquele mês).
--
--   Itens limitados por CONTADOR (Pintura PC / Benfeitorias) têm vigência
--   finita: vigencia_termino marca quando o número de parcelas se encerra. A
--   referência "n/total" da previsão é calculada contando os meses entre
--   vigencia_inicio e o mês perguntado (mesma lógica do get_vigente do script).
--
-- COLUNAS:
--   cod            código do item no boleto (ex.: 1002, 1050, 15002, 2002);
--   descricao      texto de exibição (ex.: "Cota Condominial");
--   valor          valor da VERBA (>= 0). O usuário pode cadastrar 0 para um
--                  item que ainda não se aplica — mas o comum é valor > 0;
--   categoria      rótulo informativo (Cota Regular, Servicos, Fundo, ...);
--   vigencia_inicio primeiro mês (dia 1) em que o item vale;
--   vigencia_terminonull = ainda vigente; senão, último mês em que vale.
--
-- SEGURANÇA: same padrão de todas as tabelas do projeto (RLS auth.uid() =
-- user_id). user_id vem de DEFAULT? NÃO — nesta tabela user_id é NOT NULL
-- SEM default; quem insere envia o user_id? Padrão do projeto é o DEFAULT
-- auth.uid() na tabela (como cartoes/caixinhas). Vamos usar o MESMO: default
-- auth.uid() preenche no INSERT e a RLS with check impede adulteração.
-- ============================================================================


-- Tabela (drop guardado em comentário: só reexecutar em ambiente de testes).
-- drop table if exists public.despesa_recorrente_item cascade;

create table public.despesa_recorrente_item (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
    cod              text not null,
    descricao        text not null,
    valor            numeric(12, 2) not null check (valor >= 0),
    categoria        text,
    vigencia_inicio  date not null,
    vigencia_termino date,
    criado_em        timestamptz not null default now()
);

comment on table public.despesa_recorrente_item is 'Itens fixos da despesa mensal de condomínio, por vigência (histórico preservado; nova taxa = nova linha, sem sobrescrever)';

-- Índice principal da consulta mais comum: os itens VIGENTES de um usuário
-- em determinada data (listar/validar vigência).
create index idx_despesa_recorrente_user_vigencia
    on public.despesa_recorrente_item (user_id, vigencia_inicio);

-- Índice de apoio para buscar a linha anterior de um mesmo cod (fechar
-- vigência ao criar uma nova) — útil quando a lista cresce.
create index idx_despesa_recorrente_cod
    on public.despesa_recorrente_item (user_id, cod);


-- ============================================================================
-- ROW LEVEL SECURITY (RLS) — mesmo padrão das tabelas anteriores
-- ============================================================================
alter table public.despesa_recorrente_item enable row level security;

create policy "usuario_ve_apenas_seus_itens_recorrentes"
    on public.despesa_recorrente_item
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);


-- ============================================================================
-- EXEMPLO DE CARGA INICIAL (COMENTADO — NÃO RODAR AUTOMATICAMENTE)
-- ============================================================================
-- Quem cadastra os valores REAIS vigentes hoje é o próprio usuário (pela
-- tela nova do Planejamento → Condomínio). Os valores abaixo são APENAS uma
-- referência tirada da planilha Boletos_atualizado.xlsx na data desta etapa,
-- para servir de modelo de estrutura — não devem ser gravados por migration,
-- sob risco de ficarem defasados.
--
-- Observações sobre vigência (regras herdadas da planilha/gerador):
--   • Cota Condominial valia 800,19 até MAR/2026 e passou a 840,82 desde
--     ABR/2026 → o histórico guarda as DUAS linhas;
--   • Taxa de Coleta: 67,06 até MAI/2026, 70,76 desde JUN/2026;
--   • Fundo de Reserva: 40,01 até MAR/2026, 42,04 desde ABR/2026;
--   • Manut. Pintura PC: série de 24 parcelas desde JAN/2026 (ref 9/24 em
--     SET/2026). Durante a série o valor mudou (380 até ABR/2026; 170 desde
--     MAI/2026) — mas o FINAL (24 parcelas desde o início) não muda;
--   • Benfeitorias: série de 36 parcelas, ref 33/36 em SET/2026 → início
--     JAN/2024, fim DEZ/2026;
--   • Leitura de Água e Gás: 8,48, sem fim previsto.
--
-- insert into public.despesa_recorrente_item
--     (cod, descricao, valor, categoria, vigencia_inicio, vigencia_termino)
-- values
--     -- Cota Condominial (histórico: 800,19 até mar/2026)
--     ('1002', 'Cota Condominial', 800.19, 'Cota Regular', '2024-01-01', '2026-03-31'),
--     ('1002', 'Cota Condominial', 840.82, 'Cota Regular', '2026-04-01', null),
--     -- Taxa de Coleta (histórico: 67,06 até mai/2026)
--     ('1050', 'Taxa de Coleta', 67.06, 'Servicos', '2024-01-01', '2026-05-31'),
--     ('1050', 'Taxa de Coleta', 70.76, 'Servicos', '2026-06-01', null),
--     -- Fundo de Reserva (histórico: 40,01 até mar/2026)
--     ('3002', 'Fundo de Reserva', 40.01, 'Fundo', '2024-01-01', '2026-03-31'),
--     ('3002', 'Fundo de Reserva', 42.04, 'Fundo', '2026-04-01', null),
--     -- Leitura de Água e Gás (sem fim previsto)
--     ('1102', 'Leitura de Água e Gás', 8.48, 'Servicos', '2024-01-01', null),
--     -- Manut. Pintura PC — série de 24 parcelas (início + fim fixos)
--     ('15002', 'Manut. Pintura PC', 170.00, 'Manutencao', '2026-01-01', '2027-12-31'),
--     -- Benfeitorias — série de 36 parcelas
--     ('2002', 'Benfeitorias', 46.00, 'Benfeitorias', '2024-01-01', '2026-12-31');
--
-- (As linhas de consumo Gás/Água NÃO entram aqui: são variáveis mensais.)
