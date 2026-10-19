-- ============================================================================
-- MIGRATION 45 — JORNADA SEMANAL: uma linha por semana, sem duplicatas
-- ============================================================================
-- Como usar: cole no SQL Editor do Supabase e clique em Run. IDEMPOTENTE.
--
-- CONTEXTO: a entrada semanal do Ponto virou linha automática (migration 43) e
-- é gerada pelo app. No modo dev (React StrictMode) o efeito de sincronização
-- rodou duas vezes em paralelo e cada execução inseriu o mesmo lote de semanas
-- futuras → fichas DUPLICADAS (mesma semana de trabalho). Esta migration:
--   1) remove as duplicatas, mantendo a linha "mais forte" de cada semana;
--   2) renomeia a descrição automática legada ("Pagamento Semanal") para
--      "Pagamento da semana N" (nome dado à mão é preservado);
--   3) cria um índice ÚNICO PARCIAL por (user_id, ano, semana) das linhas
--      origem='jornada', para o banco recusar duplicatas mesmo em corrida.
--
-- Por que PARCIAL e por usuário: outras origens (manual/recorrente) também usam
-- ano_semana_trabalho/semana_trabalho e podem repetir a semana — o índice vale
-- só para 'jornada' e separado por usuário (RLS/multi-tenant).
--
-- TESTES no fim do arquivo (bloco DO autocontido que se limpa).
-- ============================================================================

-- 1) Duplicatas: mantém uma linha por (user_id, ano, semana). A ordem de
--    preferência preserva o que tem mais "verdade": realizado > migrado >
--    cancelado (cancelamento explícito) > previsto; empate pela mais antiga.
with ranqueadas as (
    select id,
           row_number() over (
               partition by user_id, ano_semana_trabalho, semana_trabalho
               order by
                   case estado
                       when 'realizado' then 0
                       when 'migrado'   then 1
                       when 'cancelado' then 2
                       when 'previsto'  then 3
                       else 9
                   end,
                   criado_em asc nulls last,
                   id asc
           ) as ordem
      from public.planejamentos
     where origem = 'jornada'
       and ano_semana_trabalho is not null
       and semana_trabalho is not null
)
delete from public.planejamentos p
 using ranqueadas r
 where p.id = r.id
   and r.ordem > 1;

-- 2) Descrição: substitui o rótulo fixo legado pelo número da semana. Só toca
--    a descrição AUTOMÁTICA — renomeada à mão fica como está.
update public.planejamentos
   set descricao = format('Pagamento da semana %s', semana_trabalho)
 where origem = 'jornada'
   and semana_trabalho is not null
   and descricao = 'Pagamento Semanal';

-- 3) Índice único parcial: o banco passa a garantir uma linha por semana.
create unique index if not exists uq_planejamentos_jornada_semana
    on public.planejamentos (user_id, ano_semana_trabalho, semana_trabalho)
    where origem = 'jornada'
      and ano_semana_trabalho is not null
      and semana_trabalho is not null;

-- ============================================================================
-- TESTES (bloco DO autocontido: valida e LIMPA; qualquer assert aborta tudo)
-- ============================================================================
do $$
declare
    v_id   uuid;
    v_uid  uuid;
begin
    -- SQL Editor roda como postgres (sem JWT): fixa o claim do usuário mais
    -- antigo, valendo SÓ nesta transação.
    select id into v_uid from auth.users order by created_at limit 1;
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    if v_uid is null then
        raise exception 'TESTES 45: nenhum usuário em auth.users.';
    end if;

    -- T1: não sobrou duplicata de semana entre as linhas de jornada.
    if exists (
        select 1
          from public.planejamentos
         where origem = 'jornada'
           and ano_semana_trabalho is not null
           and semana_trabalho is not null
         group by user_id, ano_semana_trabalho, semana_trabalho
        having count(*) > 1
    ) then
        raise exception 'TESTES 45 T1: ainda há semanas duplicadas.';
    end if;

    -- T2: o índice único parcial recusa a 2ª linha da MESMA semana/usuário.
    -- (Ano 2099 fica fora do horizonte do app; limpo antes por segurança.)
    delete from public.planejamentos
     where user_id = v_uid and origem = 'jornada'
       and ano_semana_trabalho = 2099 and semana_trabalho = 1;

    insert into public.planejamentos
        (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
         ano_semana, semana, ano_semana_trabalho, semana_trabalho)
    values
        (v_uid, 'Entrada', 'TESTE_45', 1, date '2099-01-07', 'previsto',
         'jornada', 2099, 1, 2099, 1)
    returning id into v_id;

    begin
        insert into public.planejamentos
            (user_id, tipo_op, descricao, valor, data_prevista, estado, origem,
             ano_semana, semana, ano_semana_trabalho, semana_trabalho)
        values
            (v_uid, 'Entrada', 'TESTE_45_DUP', 1, date '2099-01-07', 'previsto',
             'jornada', 2099, 1, 2099, 1);
        raise exception 'TESTES 45 T2: duplicata de semana foi aceita.';
    exception
        when unique_violation then null;
    end;

    -- Limpeza do cenário de teste.
    delete from public.planejamentos where id = v_id;
    raise notice 'TESTES 45 OK: T1–T2 passaram; cenário limpo.';
end $$;
