import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Busca centralizada das movimentações do usuário logado.
//
// SELECT com embedding: '.select("*, contas (nome)")' instrui o PostgREST
// a montar o JOIN com a tabela contas usando a FK conta_id — cada linha
// chega com contas: { nome }, sem escrever JOIN manual.
//
// Como em useContas: sem filtro de user_id no código (RLS filtra no
// banco) e insert sem user_id (DEFAULT auth.uid() preenche no banco).
export function useMovimentacoes() {
  const [movimentacoes, setMovimentacoes] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  async function carregar() {
    const { data, error } = await supabase
      .from('movimentacoes')
      .select('*, contas (nome)')
      .order('data', { ascending: false })
      .order('criado_em', { ascending: false })
      .limit(10)
    if (error) throw new Error(error.message)
    return data
  }

  useEffect(() => {
    let ativo = true

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
  }, [])

  // Lançar movimentação. O insert não envia user_id (DEFAULT preenche) e
  // não toca no saldo: o trigger trg_atualizar_saldo do banco ajusta o
  // saldo_atual da conta atomicamente dentro da mesma transação.
  async function criarMovimentacao({ conta_id, data, descricao, valor, categoria, tipo_op }) {
    const { error } = await supabase
      .from('movimentacoes')
      .insert({ conta_id, data, descricao, valor, categoria, tipo_op })
    if (error) throw new Error(error.message)

    const dados = await carregar()
    setMovimentacoes(dados)
    setErro(null)
  }

  return { movimentacoes, carregando, erro, criarMovimentacao }
}