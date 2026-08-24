-- ============================================================================
-- ETAPA 06 / E5-B — Planejamentos PARCELADOS (séries de ocorrências)
-- ============================================================================
-- Como usar: SQL Editor do Supabase → cole o arquivo inteiro → Run.
--
-- MIGRATION ADITIVA E IDEMPOTENTE (mesmo padrão das migrations 06 e 07):
-- só ACREScenta colunas/check/índice à tabela planejamentos que já está em
-- produção. Nada existente é alterado, dropado ou reescrito; pode rodar de
-- novo sem efeito colateral.
--
-- MODELO APROVADO (E5-A / decisão D3): a tabela continua sendo de
-- OCORRÊNCIAS. Uma "série" (ex.: Seguro do carro em 10×) é um conjunto de
-- linhas que COMPARTILHAM a etiqueta serie_id; cada linha carrega a própria
-- data_prevista, valor, número da parcela e estado — exatamente como uma
-- ocorrência avulsa de hoje.
--
-- O que NÃO existe aqui, de propósito:
--   • FK de lancamento_id (decisão D7 NÃO aprovada ainda) — a coluna
--     permanece intocada, exatamente como saiu da migration 08;
--   • qualquer relação com movimentacoes/cartoes;
--   • trigger/RPC/cálculo de semana no banco — semanaIso segue sendo da
--     aplicação (src/lib/semana.js), fonte única desde a E1.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- COLUNAS NOVAS (todas NULLáveis: NULL = planejamento avulso, como hoje)
-- ----------------------------------------------------------------------------

alter table public.planejamentos
    add column if not exists serie_id uuid;

alter table public.planejamentos
    add column if not exists parcela_numero smallint;

alter table public.planejamentos
    add column if not exists total_parcelas smallint;

comment on column public.planejamentos.serie_id is
    'Etiqueta de agrupamento das ocorrências de um mesmo planejamento parcelado/recorrente. Gerada pela aplicação. NULL = avulsa. Sem FK de propósito: excluir/remover qualquer ocorrência nunca pode afetar as irmãs';
comment on column public.planejamentos.parcela_numero is
    'Número da parcela dentro da série (1-based). NULL em avulsas';
comment on column public.planejamentos.total_parcelas is
    'Total de parcelas da série. Sempre preenchido junto com parcela_numero (ver CHECKs). NULL em avulsas';

-- ----------------------------------------------------------------------------
-- CHECKS — integridade estrutural da série
-- ----------------------------------------------------------------------------
-- ADD CONSTRAINT não aceita "if not exists", então cada constraint nasce com
-- nome próprio e entra num bloco DO com guarda via pg_constraint (mesma
-- técnica dos guards das migrations 06/07).

-- CHECK 1 (regra 1 do escopo): os dois campos vêm JUNTOS — ambos NULL
-- (avulsa) ou ambos preenchidos (parcela de série).
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'ck_planejamentos_serie_campos_juntos'
          and conrelid = 'public.planejamentos'::regclass
    ) then
        alter table public.planejamentos add constraint
            ck_planejamentos_serie_campos_juntos check (
                (parcela_numero is null and total_parcelas is null)
                or
                (parcela_numero is not null and total_parcelas is not null)
            );
    end if;
end $$;

-- CHECK 2 (regras 2 e 3 do escopo): quando preenchidos, ambos >= 1 e
-- parcela_numero nunca passa de total_parcelas.
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'ck_planejamentos_serie_faixa'
          and conrelid = 'public.planejamentos'::regclass
    ) then
        alter table public.planejamentos add constraint
            ck_planejamentos_serie_faixa check (
                parcela_numero is null
                or (parcela_numero >= 1
                    and total_parcelas >= 1
                    and parcela_numero <= total_parcelas)
            );
    end if;
end $$;

-- CHECK 3 (extra recomendado, fora do escopo mínimo — APROVADO nesta etapa):
-- uma linha com parcela preenchida precisa pertencer a uma série; evita
-- "parcela 3/10 órfã" sem etiqueta de grupo.
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'ck_planejamentos_parcela_exige_serie'
          and conrelid = 'public.planejamentos'::regclass
    ) then
        alter table public.planejamentos add constraint
            ck_planejamentos_parcela_exige_serie check (
                parcela_numero is null or serie_id is not null
            );
    end if;
end $$;

-- ----------------------------------------------------------------------------
-- ÍNDICE — consultas por usuário + série (convenção idx_<tabela>_<ref>)
-- ----------------------------------------------------------------------------
-- Atende: cancelar/editar a série a partir de uma parcela ("update ... where
-- user_id = ... and serie_id = ...") e ler o histórico de uma série.

create index if not exists idx_planejamentos_serie
    on public.planejamentos(user_id, serie_id);
