-- ============================================================================
-- MIGRATION 41 — faltas + banco de horas no Ponto Inteligente (FASE 2)
-- ============================================================================
-- Sem tabela nova: tudo vive em ponto_excecoes (RLS e policies existentes
-- continuam valendo; UNIQUE(user_id, data) mantido — um dia, uma linha).
--
--   • tipo 'falta': falta de jornada (dia inteiro ou parcial). Nunca carrega
--     entrada/saída (só minutos) — o CHECK de horário é refeito abaixo.
--   • destino ('pagamento' default, 'banco', 'abonada'): vale para HE (só
--     pagamento|banco — domfer fica sempre pagamento) e para falta (3
--     valores). Linhas existentes ganham 'pagamento' sem mudar nenhum valor.
--   • minutos_falta + valor_desconto: congelados na gravação (mesma disciplina
--     de valor_he/valor_domfer/valor_fixo).
--   • 4 chaves de horário em ponto_config (minutos desde 00:00, pois valor é
--     numeric): carga padrão para o cálculo de dia inteiro e da folga.
--
-- Idempotente (IF NOT EXISTS / DROP IF EXISTS / on conflict do nothing).
-- NÃO reprocessa nada existente. Aplicar no SQL Editor.
-- ============================================================================

-- 1. Tipo 'falta' no CHECK de tipo (constraint inline da 22, nome automático).
alter table public.ponto_excecoes
  drop constraint if exists ponto_excecoes_tipo_check;
alter table public.ponto_excecoes
  add constraint ponto_excecoes_tipo_check
  check (tipo in ('he', 'domfer', 'ferias', 'falta'));

-- 2. Horários: ferias e falta nunca carregam entrada/saída; he/domfer sempre.
alter table public.ponto_excecoes
  drop constraint if exists ponto_ferias_sem_horario;
alter table public.ponto_excecoes
  add constraint ponto_ferias_sem_horario check (
      (tipo in ('ferias', 'falta') and entrada is null and saida is null)
      or (tipo in ('he', 'domfer') and entrada is not null and saida is not null)
  );

-- 3. Destino do desvio (HE: pagamento|banco; falta: pagamento|banco|abonada).
alter table public.ponto_excecoes
  add column if not exists destino text not null default 'pagamento';
alter table public.ponto_excecoes
  drop constraint if exists ponto_excecoes_destino_check;
alter table public.ponto_excecoes
  add constraint ponto_excecoes_destino_check
  check (destino in ('pagamento', 'banco', 'abonada'));

-- 4. Congelados da falta (minutos faltados + desconto aplicado no fixo).
alter table public.ponto_excecoes
  add column if not exists minutos_falta integer check (minutos_falta >= 0);
alter table public.ponto_excecoes
  add column if not exists valor_desconto numeric(12, 2) check (valor_desconto >= 0);

comment on column public.ponto_excecoes.destino is
  'Destino do desvio: HE (pagamento|banco) ou falta (pagamento|banco|abonada). Default pagamento (linhas antigas intactas).';
comment on column public.ponto_excecoes.minutos_falta is
  'Minutos faltados congelados na gravação (dia inteiro = carga do dia; parcial = digitado). Só tipo falta.';
comment on column public.ponto_excecoes.valor_desconto is
  'Desconto aplicado no fixo semanal congelado na gravação (só falta com destino pagamento).';

-- 5. Horários da carga padrão em ponto_config (minutos desde 00:00).
insert into public.ponto_config (chave, valor) values
    ('CARGA_UTIL_ENTRADA', 1230),
    ('CARGA_UTIL_SAIDA', 180),
    ('CARGA_SABADO_ENTRADA', 1230),
    ('CARGA_SABADO_SAIDA', 120)
on conflict (chave) do nothing;
