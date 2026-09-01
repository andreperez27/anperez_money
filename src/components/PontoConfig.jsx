import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { estilosComuns, formatarData } from '../lib/compartilhados'
import { VALORES_PADRAO_PONTO } from '../lib/pontoCalc'

// Edição dos valores monetários vigentes do Ponto Inteligente (tabela global
// ponto_config) e de um feriado. Decisão do André (01/09/2026): os reajustes
// entram pela página Configurações, não dentro do módulo Ponto.
//
// IMPORTANTE — congelamento: alterar aqui vale para os REAJUSTES FUTUROS.
// Lançamentos já gravados preservam os valores congelados nas colunas
// valor_* (he/domfer/fixo) de cada exceção; nada é retrocalculado. É o mesmo
// comportamento do app antigo no upsert_registro.
export default function PontoConfig() {
  const [valores, setValores] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  // Formulário de feriado (calendário global do Ponto).
  const [dataFer, setDataFer] = useState('')
  const [nomeFer, setNomeFer] = useState('')
  const [msgFer, setMsgFer] = useState(null)
  const [feriados, setFeriados] = useState([])

  function carregarFeriados() {
    return supabase
      .from('ponto_feriados')
      .select('data, nome')
      .order('data', { ascending: true })
      .then(({ data, error }) => {
        if (!error) setFeriados(data ?? [])
      })
      .catch(() => {})
  }

  useEffect(() => {
    let ativo = true
    supabase
      .from('ponto_config')
      .select('chave, valor')
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) {
          setMensagem({ tipo: 'erro', texto: `Não foi possível carregar: ${error.message}` })
          return
        }
        const mapa = {}
        for (const l of data ?? []) mapa[l.chave] = Number(l.valor)
        setValores({
          fixo: mapa.VALOR_FIXO_SEMANA ?? VALORES_PADRAO_PONTO.fixoSemana,
          he: mapa.VALOR_HE_NORMAL ?? VALORES_PADRAO_PONTO.heHora,
          domferAte4: mapa.VALOR_DOMINGO_ATE4 ?? VALORES_PADRAO_PONTO.domferAte4,
          domferAte6: mapa.VALOR_DOMINGO_ATE6 ?? VALORES_PADRAO_PONTO.domferAte6,
        })
      })
      .catch(() => {})
    carregarFeriados()
    return () => {
      ativo = false
    }
  }, [])

  async function handleSalvar(e) {
    e.preventDefault()
    setMensagem(null)
    const numero = (v) => Number(String(v).replace(',', '.'))
    const fixo = numero(valores.fixo)
    const he = numero(valores.he)
    const ate4 = numero(valores.domferAte4)
    const ate6 = numero(valores.domferAte6)
    for (const [nome, v] of [
      ['fixo semanal', fixo],
      ['hora extra por hora', he],
      ['diária dom/fer até 04:00', ate4],
      ['diária dom/fer acima de 04:00', ate6],
    ]) {
      if (!Number.isFinite(v) || v <= 0) {
        setMensagem({ tipo: 'erro', texto: `Valor inválido para ${nome}.` })
        return
      }
    }
    const linhas = [
      ['VALOR_FIXO_SEMANA', fixo],
      ['VALOR_HE_NORMAL', he],
      ['VALOR_DOMINGO_ATE4', ate4],
      ['VALOR_DOMINGO_ATE6', ate6],
    ]
    setEnviando(true)
    const { error } = await supabase
      .from('ponto_config')
      .upsert(linhas.map(([chave, valor]) => ({ chave, valor })))
    setEnviando(false)
    if (error) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível salvar: ${error.message}` })
      return
    }
    setMensagem({
      tipo: 'ok',
      texto: 'Valores salvos. Reajustes valem para os próximos lançamentos; os antigos ficam congelados.',
    })
  }

  async function handleCriarFeriado(e) {
    e.preventDefault()
    setMsgFer(null)
    if (!dataFer || !nomeFer.trim()) {
      setMsgFer({ tipo: 'erro', texto: 'Informe a data e o nome do feriado.' })
      return
    }
    const { error } = await supabase
      .from('ponto_feriados')
      .insert({ data: dataFer, nome: nomeFer.trim() })
    if (error) {
      setMsgFer({ tipo: 'erro', texto: `Não foi possível cadastrar: ${error.message}` })
      return
    }
    setDataFer('')
    setNomeFer('')
    setMsgFer({ tipo: 'ok', texto: 'Feriado cadastrado.' })
    carregarFeriados()
  }

  async function handleExcluirFeriado(dataISO) {
    const { error } = await supabase.from('ponto_feriados').delete().eq('data', dataISO)
    if (error) {
      setMsgFer({ tipo: 'erro', texto: `Não foi possível excluir: ${error.message}` })
      return
    }
    carregarFeriados()
  }

  const campo = (rotulo, chave) => (
    <label style={estilosComuns.form}>
      <span style={estilosCampo.rotulo}>{rotulo}</span>
      <input
        type="number"
        step="0.01"
        min="0"
        value={valores?.[chave] ?? ''}
        onChange={(e) => setValores((s) => ({ ...s, [chave]: e.target.value }))}
        style={estilosComuns.input}
      />
    </label>
  )

  return (
    <section style={estilosComuns.secao}>
      <h2>Ponto Inteligente · Valores</h2>
      <p style={estilosComuns.mensagem}>
        Reajustes aqui valem para os lançamentos NOVOS; lançamentos anteriores
        ficam com os valores congelados de quando foram gravados.
      </p>

      {valores ? (
        <form onSubmit={handleSalvar} style={estilosComuns.form}>
          {campo('Fixo semanal (R$)', 'fixo')}
          {campo('Hora extra — R$/h', 'he')}
          {campo('Diária dom/fer — saída até 04:00 (R$)', 'domferAte4')}
          {campo('Diária dom/fer — saída após 04:00 (R$)', 'domferAte6')}
          <button type="submit" disabled={enviando} style={estilosComuns.botaoCriar}>
            {enviando ? 'Salvando...' : 'Salvar valores'}
          </button>
        </form>
      ) : (
        <p style={estilosComuns.mensagem}>Carregando valores...</p>
      )}

      {mensagem && (
        <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
          {mensagem.texto}
        </p>
      )}

      <h3 style={{ marginTop: '1.5rem' }}>Feriados do Ponto</h3>
      <form onSubmit={handleCriarFeriado} style={estilosComuns.form}>
        <input
          type="date"
          value={dataFer}
          onChange={(e) => setDataFer(e.target.value)}
          style={estilosComuns.input}
          required
        />
        <input
          type="text"
          placeholder="Nome (ex.: Natal)"
          value={nomeFer}
          onChange={(e) => setNomeFer(e.target.value)}
          style={estilosComuns.input}
          required
        />
        <button type="submit" style={estilosComuns.botaoCriar}>
          Adicionar feriado
        </button>
      </form>
      {msgFer && (
        <p style={msgFer.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
          {msgFer.texto}
        </p>
      )}
      {feriados.length === 0 ? (
        <p style={estilosComuns.mensagem}>Nenhum feriado cadastrado.</p>
      ) : (
        <ul style={estilosComuns.lista}>
          {feriados.map((f) => (
            <li key={f.data} style={estilosComuns.item}>
              <div>
                <span style={estilosComuns.nomeConta}>{f.nome}</span>
                <span style={estilosComuns.tipoConta}>{formatarData(f.data)}</span>
              </div>
              <button
                type="button"
                onClick={() => handleExcluirFeriado(f.data)}
                style={estilosExcluir}
              >
                excluir
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const estilosCampo = {
  rotulo: { color: '#9ca3af', fontSize: '0.85rem', marginBottom: '0.15rem' },
}

const estilosExcluir = {
  background: 'none',
  border: 'none',
  color: '#f87171',
  fontSize: '0.75rem',
  cursor: 'pointer',
  textDecoration: 'underline',
  whiteSpace: 'nowrap',
}