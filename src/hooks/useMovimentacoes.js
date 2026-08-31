import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { somarEfeito, montarFiltroAntesDaJanela } from '../lib/extratoCalc'

// Busca centralizada das movimentações da conta ativa, com filtros de
// período (data_inicio/data_fim) e limite opcional.
//
// Parâmetros (objeto):
// - contaId: conta ativa (null/undefined → nenhuma busca, lista vazia)
// - dataInicio: busca a partir desta data (inclusive), ISO yyyy-mm-dd
// - dataFim: busca até esta data (inclusive)
// - limite: número máximo de linhas (ex.: 10 = "últimos lançamentos")
//
// SELECT com embedding: '.select("*, contas (nome)")' instrui o PostgREST
// a montar o JOIN com a tabela contas usando a FK conta_id — cada linha
// chega com contas: { nome }, sem escrever JOIN manual.
//
// Ordenação: data mais recente primeiro; dentro do mesmo dia, ordem_dia
// (ordem manual do usuário, ETAPA 07) e depois criado_em/id como desempate
// das não reordenadas — como no app antigo.
//
// Como em useContas: sem filtro de user_id no código (RLS filtra no
// banco) e insert sem user_id (DEFAULT auth.uid() preenche no banco).
export function useMovimentacoes({
  contaId,
  dataInicio = null,
  dataFim = null,
  limite = null,
}) {
  const [movimentacoes, setMovimentacoes] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  async function carregar() {
    let query = supabase
      .from('movimentacoes')
      .select('*, contas (nome)')
      .eq('conta_id', contaId)
    if (dataInicio) query = query.gte('data', dataInicio)
    if (dataFim) query = query.lte('data', dataFim)
    // Ordenação determinística: data desc; depois ordem_dia desc (NULL por
    // último — ordem MANUAL do usuário dentro do mesmo dia, coluna nova da
    // ETAPA 07); depois criado_em desc e id asc como desempate das não
    // reordenadas (linhas criadas na mesma transação — ex.: par de uma
    // transferência — podem nascer com timestamp idêntico; o id uuid garante
    // ordem estável entre buscas).
    query = query.order('data', { ascending: false })
    query = query.order('ordem_dia', { ascending: false, nullsFirst: false })
    query = query.order('criado_em', { ascending: false })
    query = query.order('id', { ascending: true })
    if (limite) query = query.limit(limite)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return data
  }

  useEffect(() => {
    // "ativo" protege contra setState depois do desmonte do componente.
    let ativo = true

    // Sem conta ativa não há o que buscar; a troca de conta (ou de
    // período, por causa das dependências) reexecuta o efeito.
    if (!contaId) {
      setMovimentacoes([])
      setCarregando(false)
      return () => {
        ativo = false
      }
    }

    carregar()
      .then((data) => {
        if (!ativo) return
        setMovimentacoes(data)
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e.message)
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [contaId, dataInicio, dataFim, limite])

  // Lançar movimentação. O insert não envia user_id (DEFAULT preenche) e
  // não toca no saldo: o trigger trg_atualizar_saldo do banco ajusta o
  // saldo_atual da conta atomicamente dentro da mesma transação. Depois
  // recarrega a lista JÁ com os filtros vigentes (período selecionado).
  async function criarMovimentacao({ conta_id, data, descricao, valor, categoria, tipo_op }) {
    const { error } = await supabase
      .from('movimentacoes')
      .insert({ conta_id, data, descricao, valor, categoria, tipo_op })
    if (error) throw new Error(error.message)

    const dados = await carregar()
    setMovimentacoes(dados)
    setErro(null)
  }

  // Editar movimentação. O UPDATE dispara o trigger trg_atualizar_saldo
  // (novo, Etapa 12): ele reverte o efeito da linha antiga e aplica o da
  // nova — inclusive se a movimentação trocou de conta (conta_id). Tudo na
  // mesma transação, então banco nunca fica consistente pela metade.
  async function editarMovimentacao(id, alteracoes) {
    const { error } = await supabase
      .from('movimentacoes')
      .update({
        conta_id: alteracoes.conta_id,
        data: alteracoes.data,
        descricao: alteracoes.descricao,
        valor: alteracoes.valor,
        categoria: alteracoes.categoria || null,
        tipo_op: alteracoes.tipo_op,
      })
      .eq('id', id)
    if (error) throw new Error(error.message)

    const dados = await carregar()
    setMovimentacoes(dados)
    setErro(null)
  }

  // Excluir movimentação. O DELETE dispara o trigger para REVERTER o
  // efeito no saldo (Entrada subtrai, Saída soma de volta), na mesma
  // transação. Depois recarrega a lista.
  async function excluirMovimentacao(id) {
    const { error } = await supabase.from('movimentacoes').delete().eq('id', id)
    if (error) throw new Error(error.message)

    const dados = await carregar()
    setMovimentacoes(dados)
    setErro(null)
  }

  // Recarrega a lista JÁ com os filtros vigentes (usado quando o banco
  // muda por fora dos métodos acima — ex.: exclusão de uma transferência
  // pela RPC excluir_transferencia na tela de extrato).
  async function atualizar() {
    const dados = await carregar()
    setMovimentacoes(dados)
    setErro(null)
  }

  // Reordenar dentro do MESMO DIA (ETAPA 07 do Extrato): a RPC
  // mover_movimentacao_no_dia (migration 18) troca a posição de UMA
  // movimentação para cima/para baixo entre as do mesmo dia + mesma conta,
  // gravando a coluna ordem_dia de forma atômica no servidor (valida posse
  // + FOR UPDATE contra corrida). Só muda a ORDEM DE EXIBIÇÃO; não toca em
  // saldo/trigger/valor/data/tipo_op. Após o sucesso, recarrega a lista com
  // os filtros vigentes (mesmo padrão de criar/editar/excluir) — o saldo
  // progressivo recomputa sozinho da nova ordem.
  async function moverMovimentacaoNoDia(id, sentido) {
    const { error } = await supabase.rpc('mover_movimentacao_no_dia', { p_id: id, p_sentido: sentido })
    if (error) throw new Error(error.message)

    const dados = await carregar()
    setMovimentacoes(dados)
    setErro(null)
  }

  return {
    movimentacoes,
    carregando,
    erro,
    criarMovimentacao,
    editarMovimentacao,
    excluirMovimentacao,
    atualizar,
    moverMovimentacaoNoDia,
  }
}

// Saldo de abertura de um período: o efeito acumulado de TODAS as
// movimentações com data ANTES de `data` (exclusive) na conta ativa — o
// saldo que a conta tinha na véspera do primeiro dia do período. Inclui
// transferências internas (efeito real no saldo) e lançamentos de caixinha,
// porque ambos são linhas comuns em movimentacoes. Query enxuta (só
// tipo_op e valor), que basta para somar. O efeito é calculado por
// somarEfeito (extratoCalc) — mesma fórmula usada pelo resumo da tela.
export async function buscarSaldoAntesDe({ contaId, data }) {
  if (!contaId || !data) return null

  const { data: linhas, error } = await supabase
    .from('movimentacoes')
    .select('tipo_op, valor')
    .eq('conta_id', contaId)
    .lt('data', data)

  if (error) throw new Error(error.message)

  return somarEfeito(linhas)
}

// Efeito das movimentações FUTURAS ao período (data > `data`, exclusive):
// quantas são e quanto SOMAM líquido no saldo_atual. Serve para o aviso de
// divergência do extrato quando a pesquisa termina antes de lançamentos já
// cadastrados (o trigger aplica saldo na hora, independente da data).
// Transferências participam naturalmente (cada lado é uma linha própria).
export async function buscarEfeitoApos({ contaId, data }) {
  if (!contaId || !data) return { quantidade: 0, liquido: 0 }

  const { data: linhas, error } = await supabase
    .from('movimentacoes')
    .select('tipo_op, valor')
    .eq('conta_id', contaId)
    .gt('data', data)

  if (error) throw new Error(error.message)

  return { quantidade: linhas.length, liquido: somarEfeito(linhas) }
}

// Saldo de abertura da JANELA "Últimos N" (modo sem datas): efeito de todas
// as linhas ANTERIORES à última linha exibida, seguindo a MESMA ordenação
// determinística da lista (data desc, criado_em desc, id asc) — por isso um
// dia com mais lançamentos do que o limite não corrompe a conta de abertura:
// as linhas cortadas pelo limite entram aqui. `ultimaLinha` é o ÚLTIMO
// elemento do array já ordenado (o mais antigo da janela).
export async function buscarAberturaDaJanela({ contaId, ultimaLinha }) {
  if (!contaId || !ultimaLinha) return null

  const { data: linhas, error } = await supabase
    .from('movimentacoes')
    .select('tipo_op, valor')
    .eq('conta_id', contaId)
    .or(montarFiltroAntesDaJanela(ultimaLinha))

  if (error) throw new Error(error.message)

  return somarEfeito(linhas)
}