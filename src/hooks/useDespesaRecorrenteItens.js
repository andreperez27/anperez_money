import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { hoje } from '../lib/compartilhados'

// Itens fixos da despesa mensal de condomínio (ETAPA 06 / gerador).
//
// Acesso centralizado à tabela despesa_recorrente_item. O RLS (auth.uid() =
// user_id) filtra no banco — aqui NÃO existe filtro de user_id no código,
// como em todos os hooks do app. O INSERT NÃO envia user_id: o DEFAULT
// auth.uid() da tabela preenche com o dono da sessão (e a policy with check
// recusa adulteração).
//
// VIGÊNCIA: um item vale no mês da data consultada quando
//   vigencia_inicio <= data  E  (vigencia_termino IS NULL OU vigencia_termino >= data).
// Alterar uma taxa NUNCA sobrescreve: criarItem grava uma NOVA linha com a
// data de início informada e FECHA a linha anterior do mesmo cod com
// vigencia_termino = véspera do novo início (histórico preservado).

// Data em "YYYY-MM-DD" a partir de um Date local (evita timezone shift).
function formatoISO(data) {
  const a = data.getFullYear()
  const m = String(data.getMonth() + 1).padStart(2, '0')
  const d = String(data.getDate()).padStart(2, '0')
  return `${a}-${m}-${d}`
}

// Véspera de uma data ISO (usada para fechar a linha anterior).
function vespera(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  const dt = new Date(a, m - 1, d - 1)
  return formatoISO(dt)
}

export function useDespesaRecorrenteItens() {
  const [itens, setItens] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  // Consulta explícita: itens vigentes na data informada (prefixo 'v_' nos
  // parâmetros para não conflitar com a query padrão). Retorna a lista; não
  // mexe no estado (o componente decide o que fazer com ela). useCallback p/
  // identidade estável — consumidores podem usá-la em useEffect sem loop.
  const listar = useCallback(async (dataISO = null) => {
    const alvo = dataISO || hoje()
    const { data, error } = await supabase
      .from('despesa_recorrente_item')
      .select('*')
      .lte('vigencia_inicio', alvo)
      .or(`vigencia_termino.is.null,vigencia_termino.gte.${alvo}`)
      .order('cod')
      .order('vigencia_inicio')
    if (error) throw new Error(error.message)
    return data ?? []
  }, [])

  // Recarrega a lista vigente HOJE no estado do hook (padrão useContas).
  const atualizar = useCallback(async () => {
    const data = await listar()
    setItens(data)
    setErro(null)
  }, [listar])

  useEffect(() => {
    let ativo = true
    listar()
      .then((data) => {
        if (!ativo) return
        setItens(data)
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e.message)
        setItens([])
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => {
      ativo = false
    }
  }, [])

  // Criar item (nova vigência). Sem user_id no payload (DEFAULT auth.uid()).
  // Se existir linha anterior ABERTA do mesmo cod iniciando antes ou na
  // mesma data, fecha sua vigencia_termino para a véspera do novo início —
  // um item só pode ter uma linha "aberta" por vez.
  async function criarItem({ cod, descricao, valor, categoria, vigencia_inicio, vigencia_termino }) {
    if (!cod || !cod.toString().trim()) throw new Error('Informe o código do item.')
    if (!descricao || !descricao.trim()) throw new Error('Informe a descrição.')
    const v = Number(valor)
    if (!(v >= 0)) throw new Error('O valor deve ser maior ou igual a zero.')
    if (!vigencia_inicio) throw new Error('Informe a data de início da vigência.')

    // Busca a linha anterior ABERTA do mesmo cod para fechar (a mais recente
    // que começa antes/na mesma data e ainda não está encerrada).
    const { data: anteriores, error: errAnt } = await supabase
      .from('despesa_recorrente_item')
      .select('id, vigencia_inicio')
      .eq('cod', cod.toString().trim())
      .lte('vigencia_inicio', vigencia_inicio)
      .or(`vigencia_termino.is.null,vigencia_termino.gte.${vigencia_inicio}`)
      .order('vigencia_inicio', { ascending: false })
      .limit(1)
    if (errAnt) throw new Error(errAnt.message)

    if (anteriores && anteriores.length > 0) {
      // Fecha a linha anterior na VÉSPERA do novo início (nunca sobrepõe).
      const { error: errClose } = await supabase
        .from('despesa_recorrente_item')
        .update({ vigencia_termino: vespera(vigencia_inicio) })
        .eq('id', anteriores[0].id)
      if (errClose) throw new Error(errClose.message)
    }

    const payload = {
      cod: cod.toString().trim(),
      descricao: descricao.trim(),
      valor: v,
      vigencia_inicio,
    }
    if (categoria !== undefined && categoria !== null && categoria !== '') {
      payload.categoria = categoria
    } else {
      payload.categoria = null
    }
    if (vigencia_termino) payload.vigencia_termino = vigencia_termino
    else payload.vigencia_termino = null

    const { error } = await supabase.from('despesa_recorrente_item').insert(payload)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  return { itens, carregando, erro, atualizar, listar, criarItem }
}
