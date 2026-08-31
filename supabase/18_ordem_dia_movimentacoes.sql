-- ============================================================================
-- ETAPA 07 (Extrato de Contas) — MIGRATION 18: ordem_dia + mover no dia
-- ============================================================================
-- PROBLEMA resolvido:
--   quando duas movimentações caem na MESMA data, o desempate sempre foi por
--   criado_em (o instante em que a linha foi GRAVADA no banco) — não pela
--   ordem real dos eventos. Isso fica visivelmente errado quando um lançamento
--   é criado retroativamente com data passada (ex.: confirmar uma previsão do
--   Planejamento alguns dias depois de ela acontecer): ele "fura a fila" na
--   frente de movimentações daquele mesmo dia que já existiam, e o SALDO
--   PROGRESSIVO (coluna "Saldo" linha a linha) fica incoerente — mesmo o
--   saldo_atual real da conta estando certo (quem garante esse total é o
--   trigger trg_atualizar_saldo, que soma/subtrai sem ligar pra ordem).

-- O QUE ESTA MIGRATION FAZ (e o que NÃO faz):
--   • adiciona a coluna `ordem_dia` (nullable) em movimentacoes — um número
--     usado SÓ para desempatar movimentações do mesmo dia/conta na ORDEM DE
--     EXIBIÇÃO do extrato;
--   • cria a RPC mover_movimentacao_no_dia(p_id, p_sentido), que permite ao
--     usuário reordenar manualmente, com setas subir/descer, as movimentações
--     do MESMO DIA.
--   • NÃO mexe em saldo_atual, NÃO mexe no trigger trg_atualizar_saldo, NÃO
--     mexe em valor/data/tipo_op de nenhuma movimentação. É só exibição: a
--     coluna entra como MAIS UM desempate na cadeia de ordenação do extrato,
--     entre `data` e `criado_em` (veja src/hooks/useMovimentacoes.js).

-- POR QUE `ordem_dia` (campo de ordenação explícita) e não um campo de HORA:
--   o app antigo não registrava a hora real dos eventos — só a data. Inventar
--   uma hora agora "pra caber" seria falsificar o dado. Em vez disso, damos ao
--   usuário uma ordem relativa manual (setinhas) dentro do dia. A coluna só
--   preenche quando alguém reordena; enquanto ninguém mexe, fica NULL e o
--   comportamento é IDÊNTICO ao de hoje (fallback para criado_em desc, id asc).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) COLUNA: movimentacoes.ordem_dia
-- ----------------------------------------------------------------------------
-- NULL = o usuário nunca reordenou este dia → vale o fallback criado_em.
-- Preenchida (número inteiro) = posição relativa da linha NAQUELE dia+conta.
-- A ordenação final do extrato passa a ser:
--     data DESC → ordem_dia DESC (NULL por último) → criado_em DESC → id ASC
-- O `if not exists` deixa a migration re-executável SEM apagar os ordens já
-- gravados (aula de bom uso: ALTER idempotente + nunca DROP da coluna).
alter table public.movimentacoes
    add column if not exists ordem_dia integer;

comment on column public.movimentacoes.ordem_dia is
    'Posição relativa da movimentação no desempate do DIA (ordem_dia DESC). NULL = nunca reordenada (vale fallback criado_em desc, id asc). Só entra na ORDEM DE EXIBIÇÃO; não altera saldo nem trigger';

-- Índice de apoio para as consultas "mesmo dia + mesma conta" da RPC (busca
-- só as linhas de um dia/conta para reordenar). Sem ele o Postgres teria que
-- varrer o histórico inteiro a cada seta clicada.
create index if not exists idx_movimentacoes_dia
    on public.movimentacoes (conta_id, data);


-- ----------------------------------------------------------------------------
-- 2) RPC: mover_movimentacao_no_dia(p_id, p_sentido)
-- ----------------------------------------------------------------------------
-- Move UMA movimentação uma posição para cima ou para baixo DENTRO das
-- movimentações do MESMO DIA + MESMA CONTA. Semáforo de "ordem de exibição":
--
--   • ordem efetiva atual = ordem_dia DESC (nulls por último) → criado_em
--     DESC → id ASC   (a MESMA cadeia do hook useMovimentacoes.js)
--   • 'subir'  → troca com o vizinho imediatamente MAIS RECENTE (o que vem
--                antes na lista, índice anterior);
--   • 'descer' → troca com o vizinho imediatamente MAIS ANTIGO (o que vem
--                depois, índice seguinte);
--   • se o alvo JÁ é o primeiro/último do dia naquela direção, não faz nada
--     (idempotente, sem erro) — o usuário pode clicar à vontade.
--
-- INICIALIZAÇÃO do grupo: se QUALQUER linha do dia/conta ainda tem ordem_dia
-- NULL, o grupo inteiro é inicializado numa sequência (mais RECENTE = MAIOR
-- número) baseada na ordem efetiva atual — assim nunca fica parte inicializado
-- e parte não, e a troca passa a ser só entre dois números distintos. Como a
-- sequência é derivada da ordem atual, a inicialização em si NÃO muda a
-- posição de ninguém (só "materializa" o que já estava à vista).
--
-- POR QUE security definer + FOR UPDATE?
--   • security definer (dono = postgres) permite à função fazer as várias
--     escritas dentro do dia como uma única transação atômica, ignorando a RLS
--     — mas valida POSSE de cada linha (user_id = auth.uid()) no corpo, nada é
--     confiado ao cliente (mesmo padrão de realizar_planejamento);
--   • FOR UPDATE trava o conjunto do dia/conta contra uma corrida: se dois
--     cliques/dispositivos tentarem reordenar o MESMO dia ao mesmo tempo, o
--     segundo espera o primeiro terminar (e vê os valores já atualizados).
-- ============================================================================

drop function if exists public.mover_movimentacao_no_dia(uuid, text);

create or replace function public.mover_movimentacao_no_dia(
    p_id      uuid,
    p_sentido text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user      uuid := auth.uid();
    v_conta_id  uuid;
    v_data      date;
    v_ids       uuid[]   := '{}';
    v_ordens    integer[] := '{}';
    v_id        uuid;
    v_ordem     integer;
    v_total     integer;
    v_alvo_idx  integer := -1;
    v_viz_idx   integer := -1;
    v_i         integer;
    tem_null    boolean := false;
begin
    -- Autenticação e parâmetro — validação de entrada no SERVIDOR.
    if v_user is null then
        raise exception 'Sessão sem usuário autenticado.';
    end if;
    if p_sentido not in ('subir', 'descer') then
        raise exception 'Sentido inválido (use "subir" ou "descer").';
    end if;

    -- 1) Localiza a movimentação alvo e confere que é DO usuário logado.
    --    FOR UPDATE trava a linha — impede que ela suma no meio da operação.
    select conta_id, data
      into v_conta_id, v_data
      from public.movimentacoes
     where id = p_id
       and user_id = v_user
     for update;
    if not found then
        raise exception 'Movimentação não encontrada ou não pertence ao usuário.';
    end if;

    -- 2) Seleciona TODAS as movimentações do mesmo dia + conta do usuário,
    --    na ORDEM EFETIVA ATUAL de exibição, com FOR UPDATE (trava o grupo
    --    inteiro contra corrida). Coleta id e o ordem atual em dois vetores.
    --    `order nulls last` garante que linhas ainda não reordenadas (NULL)
    --    fiquem TÃO depois quanto a cadeia do hook manda.
    for v_id, v_ordem in
        select m.id, m.ordem_dia
          from public.movimentacoes m
         where m.conta_id = v_conta_id
           and m.data = v_data
           and m.user_id = v_user
         order by m.ordem_dia desc nulls last, m.criado_em desc, m.id asc
         for update of m
    loop
        v_ids := array_append(v_ids, v_id);
        v_ordens := array_append(v_ordens, v_ordem);
        if v_ordem is null then
            tem_null := true;
        end if;
    end loop;

    v_total := cardinality(v_ids);
    -- Grupo com menos de 2 linhas não tem vizinho: nada a fazer.
    if v_total < 2 then
        return;
    end if;

    -- 3) Se alguma linha do dia ainda é NULL, INICIALIZA o grupo inteiro:
    --    o primeiro da lista (mais recente) recebe o MAIOR número, o último
    --    recebe 1. Como a ordem_dia DESC mantém a posição atual, ninguém muda
    --    de lugar — a sequência apenas "materializa" o estado atual de forma
    --    única para as próximas trocas serem só entre dois números distintos.
    if tem_null then
        for v_i in 1 .. v_total loop
            v_ordens[v_i] := v_total - v_i + 1;
            update public.movimentacoes
               set ordem_dia = v_ordens[v_i]
             where id = v_ids[v_i];
        end loop;
    end if;

    -- 4) Acha a posição do alvo no grupo (índice no vetor).
    for v_i in 1 .. v_total loop
        if v_ids[v_i] = p_id then
            v_alvo_idx := v_i;
            exit;
        end if;
    end loop;

    -- 5) Vizinho imediato na direção pedida (na ordem de EXIBIÇÃO):
    --    'subir' = mais recente → índice anterior; 'descer' = mais antigo →
    --    índice seguinte. Sem vizinho nessa direção → já está na ponta.
    if p_sentido = 'subir' and v_alvo_idx > 1 then
        v_viz_idx := v_alvo_idx - 1;
    elsif p_sentido = 'descer' and v_alvo_idx < v_total then
        v_viz_idx := v_alvo_idx + 1;
    end if;
    if v_viz_idx = -1 then
        return;  -- primeiro/último do dia → idempotente, sem erro
    end if;

    -- 6) Troca os valores de ordem_dia entre alvo e vizinho (são números
    --    distintos após o passo 3, então a troca é só uma permutação).
    update public.movimentacoes
       set ordem_dia = v_ordens[v_viz_idx]
     where id = v_ids[v_alvo_idx];
    update public.movimentacoes
       set ordem_dia = v_ordens[v_alvo_idx]
     where id = v_ids[v_viz_idx];
end;
$$;


-- ----------------------------------------------------------------------------
-- 3) GRANTS — mesmo padrão do projeto (migrations 10/11/12/13/16)
-- ----------------------------------------------------------------------------
-- Nada para o público (anon/role public); só usuários autenticados podem
-- chamar. A RLS das linhas continua valendo: a função valida posse no corpo.
revoke all on function public.mover_movimentacao_no_dia(uuid, text) from public;
grant execute on function public.mover_movimentacao_no_dia(uuid, text) to authenticated;


-- ============================================================================
-- RLS / TRIGGERS / OUTROS — nenhuma alteração necessária
-- ============================================================================
--   • trg_atualizar_saldo (03) NÃO é tocado: ordem_dia é só exposição, o saldo
--     contínua sendo a soma do trigger, que não liga pra ordem.
--   • valor/data/tipo_op/criado_em de nenhuma linha mudam com esta migration.
--   • Módulo Planejamento (08/09/16/17) e Cartões permanecem intocados.
-- ============================================================================
