import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Busca centralizada das caixinhas (pockets de reserva) da conta ativa.
//
// Mesmo contrato de useCartoes: contaId é o parâmetro do hook, filtro
// conta_id + ativa = true no banco, RLS como segurança real e insert sem
// user_id (DEFAULT auth.uid() preenche no banco).
export function useCaixinhas(contaId) {
  const [caixinhas, setCaixinhas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  async function carregar() {
    const { data, error } = await supabase
      .from('caixinhas')
      .select('*')
      .eq('conta_id', contaId)
      .eq('ativa', true)
      .order('nome')
    if (error) throw new Error(error.message)
    return data
  }

  useEffect(() => {
    // "ativo" protege contra setState depois do desmonte do componente.
    let ativo = true

    // Sem conta selecionada, lista vazia sem chamar o Supabase; a troca
    // de conta reexecuta o efeito via dependência [contaId].
    if (!contaId) {
      setCaixinhas([])
      setCarregando(false)
      return () => {
        ativo = false
      }
    }

    carregar()
      .then((data) => {
        if (!ativo) return
        setCaixinhas(data)
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
  }, [contaId])

  // Criar caixinha na conta ativa. objetivo é opcional: quando vier
  // undefined, o campo não vai no payload e o banco grava NULL.
  async function criarCaixinha({ nome, saldo, objetivo }) {
    if (!contaId) throw new Error('Selecione uma conta antes de criar a caixinha.')

    const payload = { conta_id: contaId, nome, saldo }
    if (objetivo !== undefined && objetivo !== null) payload.objetivo = objetivo

    const { error } = await supabase.from('caixinhas').insert(payload)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  async function atualizar() {
    const dados = await carregar()
    setCaixinhas(dados)
    setErro(null)
  }

  // Guardar: move dinheiro da conta ativa PARA a caixinha. As três
  // alterações (Saída na conta, crédito na caixinha, registro do
  // movimento) acontecem na MESMA transação dentro da função
  // caixinha_guardar do banco — se algo falhar, nada é aplicado.
  async function guardar({ caixinha_id, valor, descricao, data }) {
    if (!contaId) throw new Error('Selecione uma conta antes de guardar.')

    const { error } = await supabase.rpc('caixinha_guardar', {
      p_caixinha_id: caixinha_id,
      p_conta_id: contaId,
      p_valor: valor,
      p_descricao: descricao || null,
      p_data: data || null,
    })
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // Resgatar: espelho do guardar — devolve dinheiro da caixinha PARA a
  // conta ativa, atomicamente (função caixinha_resgatar do banco).
  async function resgatar({ caixinha_id, valor, descricao, data }) {
    if (!contaId) throw new Error('Selecione uma conta antes de resgatar.')

    const { error } = await supabase.rpc('caixinha_resgatar', {
      p_caixinha_id: caixinha_id,
      p_conta_id: contaId,
      p_valor: valor,
      p_descricao: descricao || null,
      p_data: data || null,
    })
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // Taxa: debita SÓ o saldo da caixinha (ex.: cobrança de resgate), sem
  // lançamento na conta corrente — função caixinha_taxa do banco.
  async function taxa({ caixinha_id, valor, descricao, data }) {
    if (!contaId) throw new Error('Selecione uma conta antes de lançar a taxa.')

    const { error } = await supabase.rpc('caixinha_taxa', {
      p_caixinha_id: caixinha_id,
      p_conta_id: contaId,
      p_valor: valor,
      p_descricao: descricao || null,
      p_data: data || null,
    })
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // Rendimento: credita SÓ a caixinha, sem passar pela conta corrente.
  async function rendimento({ caixinha_id, valor, descricao, data }) {
    if (!contaId) throw new Error('Selecione uma conta antes de lançar o rendimento.')

    const { error } = await supabase.rpc('caixinha_rendimento', {
      p_caixinha_id: caixinha_id,
      p_conta_id: contaId,
      p_valor: valor,
      p_descricao: descricao || null,
      p_data: data || null,
    })
    if (error) throw new Error(error.message)

    await atualizar()
  }

  return { caixinhas, carregando, erro, criarCaixinha, guardar, resgatar, taxa, rendimento, atualizar }
}

// Variante para a visão CONSOLIDADA (tela Contas Correntes): lista TODAS
// as caixinhas do usuário, sem filtrar por conta, com o nome da conta de
// origem embutido (embedding contas (nome)). O RLS garante o isolamento
// por usuário. O atualizar() é chamado depois de criar uma caixinha para
// a lista consolidada refletir o novo registro.
export function useTodasCaixinhas() {
  const [caixinhas, setCaixinhas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  async function carregar() {
    const { data, error } = await supabase
      .from('caixinhas')
      .select('*, contas (nome)')
      .order('nome')
    if (error) throw new Error(error.message)
    return data
  }

  useEffect(() => {
    let ativo = true

    carregar()
      .then((data) => {
        if (!ativo) return
        setCaixinhas(data)
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

  async function atualizar() {
    const dados = await carregar()
    setCaixinhas(dados)
    setErro(null)
  }

  return { caixinhas, carregando, erro, atualizar }
}

// Histórico de movimentos de UMA caixinha (guardar, resgatar, rendimento).
// Ordenado por data desc e depois criado_em desc. Sem caixinhaId, lista
// vazia sem chamar o Supabase (mesmo contrato dos demais hooks).
export function useCaixinhaMovimentos(caixinhaId) {
  const [movimentos, setMovimentos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  async function carregar() {
    const { data, error } = await supabase
      .from('caixinha_movimentacoes')
      .select('*')
      .eq('caixinha_id', caixinhaId)
      .order('data', { ascending: false })
      .order('criado_em', { ascending: false })
    if (error) throw new Error(error.message)
    return data
  }

  useEffect(() => {
    let ativo = true

    if (!caixinhaId) {
      setMovimentos([])
      setCarregando(false)
      return () => {
        ativo = false
      }
    }

    carregar()
      .then((data) => {
        if (!ativo) return
        setMovimentos(data)
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
  }, [caixinhaId])

  async function atualizar() {
    const dados = await carregar()
    setMovimentos(dados)
    setErro(null)
  }

  return { movimentos, carregando, erro, atualizar }
}