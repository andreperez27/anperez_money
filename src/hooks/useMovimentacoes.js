import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

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
// Ordenação: data mais recente primeiro, e depois criado_em (desempate
// de lançamentos do mesmo dia) — como no app antigo.
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
    query = query.order('data', { ascending: false })
    query = query.order('criado_em', { ascending: false })
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

  return {
    movimentacoes,
    carregando,
    erro,
    criarMovimentacao,
    editarMovimentacao,
    excluirMovimentacao,
    atualizar,
  }
}

// Saldo de abertura de um período: a soma de TODAS as movimentações com
// data ANTES de `data` (exclusive) na conta ativa — o saldo que a conta
// tinha na véspera do primeiro lançamento do período. Query adicional
// enxuta (só tipo_op e valor), que é o que o RLS permite e basta pra
// somar. Depois do período, o saldo pode evoluir por fora desta soma
// (novos lançamentos) — para o extrato isso não importa, o valor é o da
// data de início.
export async function buscarSaldoAntesDe({ contaId, data }) {
  if (!contaId || !data) return null

  const { data: linhas, error } = await supabase
    .from('movimentacoes')
    .select('tipo_op, valor')
    .eq('conta_id', contaId)
    .lt('data', data)

  if (error) throw new Error(error.message)

  return linhas.reduce(
    (soma, l) => soma + (l.tipo_op === 'Entrada' ? 1 : -1) * Number(l.valor),
    0,
  )
}