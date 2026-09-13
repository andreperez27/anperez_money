import { useEffect, useMemo, useState } from 'react'
import ModalFormulario from '../ModalFormulario'
import { useDespesaRecorrenteItens } from '../../hooks/useDespesaRecorrenteItens'
import { estilosComuns, formatoReal } from '../../lib/compartilhados'
import { calcularTotalCondominio } from '../../lib/despesaRecorrenteCalc'
import { parseValorObservacao } from '../../lib/serieValorVariavel'
import ModalNovoItemFixo from './ModalNovoItemFixo'

// ============================================================================
// CONSUMO REAL DA OCORRÊNCIA DE CONDOMÍNIO (13/09/2026)
// ============================================================================
// Formulário que ANTES morava dentro de "Novo lançamento → Condomínio" e agora
// abre no contexto da própria ocorrência prevista de Condomínio (ação "Inserir
// consumo real" do acordeão). NÃO duplica a lógica de gravação: o save usa a
// MESMA action `salvarConsumoReal` do hook (upsert em condominio_consumo_mensal
// + recalcular com calcularTotalCondominio + marcar "Consumo real informado" e
// imune à reprojeção) — só muda de onde é disparado.
//
// ANTES dos campos de Gás/Água o formulário mostra a COMPOSIÇÃO do boleto daquele
// mês no estilo "Composição da Arrecadação" (só leitura), com a referência
// n/total das séries, para conferir contra o boleto físico. O "Reajustar item
// fixo" é um atalho pro modal Novena existente (ModalNovoItemFixo → criarItem);
// a vigência nunca é duplicada aqui.
// ============================================================================

// Lê um número digitado ("124,08" ou "124.08") → número em reais (padrão app).
function lerValor(texto) {
  const n = Number(String(texto).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

// Último dia de um mês 'YYYY-MM' como 'YYYY-MM-DD' (para filtrar vigência).
function ultimoDia(mesAno) {
  const [a, m] = mesAno.split('-').map(Number)
  const ultimo = new Date(a, m, 0).getDate()
  return `${a}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`
}

const MES_3 = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']

export default function ConsumoRealOcorrencia({ item, aoSalvarConsumoReal, aoPosMutacao, aoFechar }) {
  // Mês da própria ocorrência (data_prevista) — o alvo da correção.
  const mes = String(item?.data_prevista || '').slice(0, 7)
  const [anoAtual, mesAtual] = mes.split('-').map(Number)
  const rotuloMes = `${MES_3[mesAtual - 1]}/${anoAtual}`

  const { carregando: carregandoItens, erro: erroItens, listar, criarItem } =
    useDespesaRecorrenteItens()
  const [itensVigentes, setItensVigentes] = useState([])

  // Pré-preenche Gás/Água com os valores ATUAIS da própria ocorrência (lidos
  // da observação — mesma linha que o boleto). O morador só edita.
  const [gas, setGas] = useState(() => {
    const g = parseValorObservacao(item?.observacao, '1010')
    return Number.isFinite(g) && g > 0 ? String(g).replace('.', ',') : ''
  })
  const [agua, setAgua] = useState(() => {
    const a = parseValorObservacao(item?.observacao, '1052')
    return Number.isFinite(a) && a > 0 ? String(a).replace('.', ',') : ''
  })
  const [gasLeitAtual, setGasLeitAtual] = useState('')
  const [gasLeitAnterior, setGasLeitAnterior] = useState('')
  const [aguaLeitAtual, setAguaLeitAtual] = useState('')
  const [aguaLeitAnterior, setAguaLeitAnterior] = useState('')

  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState({ tipo: '', texto: '' })
  const [mostrandoItemFixo, setMostrandoItemFixo] = useState(false)

  // Itens fixos VIGENTES no mês da ocorrência.
  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(mes)) return undefined
    let ativo = true
    listar(ultimoDia(mes))
      .then((dados) => {
        if (ativo) setItensVigentes(dados)
      })
      .catch(() => {
        if (ativo) setItensVigentes([])
      })
    return () => {
      ativo = false
    }
  }, [mes, listar])

  const gasNum = Number.isFinite(lerValor(gas)) ? lerValor(gas) : 0
  const aguaNum = Number.isFinite(lerValor(agua)) ? lerValor(agua) : 0

  // Composição do boleto: mesmo cálculo do total (calcularTotalCondominio) — a
  // tabela só leitura exibe os FIXOS + os variáveis lendo os inputs vivos. O
  // total recalcula enquanto o morador digita Gás/Água.
  const composicao = useMemo(() => {
    const { total, detalhamento } = calcularTotalCondominio({
      itens: itensVigentes,
      mes,
      gas: gasNum,
      agua: aguaNum,
    })
    const variaveis = detalhamento.filter((l) => l.cod === '1010' || l.cod === '1052')
    const fixos = detalhamento.filter((l) => l.cod !== '1010' && l.cod !== '1052')
    return { total, fixos, variaveis }
  }, [itensVigentes, mes, gasNum, aguaNum])

  async function aoSalvar(e) {
    e.preventDefault()
    if (salvando || !aoSalvarConsumoReal) return
    const temGas = gasNum > 0
    const temAgua = aguaNum > 0
    if (!temGas && !temAgua) {
      setMsg({ tipo: 'erro', texto: 'Informe ao menos o valor do consumo de gás ou de água.' })
      return
    }
    try {
      setSalvando(true)
      const payload = { mes, gas: {}, agua: {} }
      if (temGas) {
        payload.gas.valor = gasNum
        const atual = lerValor(gasLeitAtual)
        const anterior = lerValor(gasLeitAnterior)
        if (Number.isFinite(atual)) payload.gas.leitura_atual = atual
        if (Number.isFinite(anterior)) payload.gas.leitura_anterior = anterior
      }
      if (temAgua) {
        payload.agua.valor = aguaNum
        const atual = lerValor(aguaLeitAtual)
        const anterior = lerValor(aguaLeitAnterior)
        if (Number.isFinite(atual)) payload.agua.leitura_atual = atual
        if (Number.isFinite(anterior)) payload.agua.leitura_anterior = anterior
      }
      const registro = await aoSalvarConsumoReal(payload)
      await aoPosMutacao?.()
      setMsg({
        tipo: 'ok',
        texto: registro?.ocorrenciaAjustada
          ? `Consumo de ${rotuloMes} salvo e a previsão foi ajustada pelo valor real.`
          : `Consumo de ${rotuloMes} salvo (não há previsão prevista neste mês para ajustar).`,
      })
    } catch (err) {
      setMsg({ tipo: 'erro', texto: `Não foi possível salvar o consumo: ${err.message}` })
    } finally {
      setSalvando(false)
    }
  }

  // Atalho do modal "Novo item fixo": aponta pro MESMO criarItem (fecha a
  // vigência anterior). Após salvar, recarrega a composição vigente do mês.
  async function aoCadastrarItem(payload) {
    await criarItem(payload)
    setMostrandoItemFixo(false)
    const dados = await listar(ultimoDia(mes))
    setItensVigentes(dados)
  }

  return (
    <ModalFormulario titulo={`Consumo real do mês — ${rotuloMes}`} aoFechar={() => !salvando && aoFechar()}>
      <form onSubmit={aoSalvar} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }} noValidate>
        <p style={{ ...estilosComuns.mensagem, margin: 0 }}>
          Correção da ocorrência <strong style={{ color: '#e5e7eb' }}>{item.descricao}</strong> de{' '}
          {formatoReal.format(Number(item.valor))}. Confira a composição abaixo contra o boleto
          físico antes de salvar.
        </p>

        {/* Composição da Arrecadação — só leitura, estilo do boleto */}
        <div style={estilos.composicao}>
          <div style={estilos.composicaoCabecalho}>
            <span style={estilos.cod}>Cód</span>
            <span style={estilos.desc}>Descrição</span>
            <span style={estilos.ref}>Ref</span>
            <span style={estilos.valor}>Valor</span>
          </div>
          {carregandoItens && <p style={estilosComuns.mensagem}>Carregando itens fixos...</p>}
          {!carregandoItens && erroItens && <p style={estilosComuns.mensagemErro}>{erroItens}</p>}
          {!carregandoItens && !erroItens && composicao.fixos.length === 0 && (
            <p style={estilosComuns.mensagem}>Nenhum item fixo vigente neste mês.</p>
          )}
          {!carregandoItens && !erroItens && (
            <>
              {composicao.fixos.map((l) => (
                <div key={l.cod} style={estilos.composicaoLinha}>
                  <span style={estilos.cod}>{l.cod}</span>
                  <span style={estilos.desc}>{l.descricao}</span>
                  <span style={estilos.ref}>{l.referencia || ''}</span>
                  <span style={estilos.valor}>{formatoReal.format(l.valor)}</span>
                </div>
              ))}
              {composicao.variaveis.map((l) => (
                <div key={l.cod} style={estilos.composicaoLinhaVariavel}>
                  <span style={estilos.cod}>{l.cod}</span>
                  <span style={estilos.desc}>{l.descricao}</span>
                  <span style={estilos.ref}>{l.referencia || ''}</span>
                  <span style={estilos.valor}>{formatoReal.format(l.valor)}</span>
                </div>
              ))}
              <div style={estilos.composicaoTotal}>
                <span style={{ ...estilos.desc, fontWeight: 'bold' }}>Total</span>
                <span style={{ ...estilos.valor, color: '#f87171', fontWeight: 'bold' }}>{formatoReal.format(composicao.total)}</span>
              </div>
            </>
          )}
        </div>

        {/* Atalho pro modal de novo item fixo (criarItem — vigência única no hook) */}
        <button type="button" onClick={() => setMostrandoItemFixo(true)} style={estilos.linkReajustar}>
          Reajustar item fixo
        </button>

        <div style={estilos.grade}>
          <label style={estilos.rotuloCampo}>
            Consumo de Gás (R$)
            <input style={estilosComuns.input} type="text" inputMode="decimal" placeholder="0,00" value={gas} onChange={(e) => setGas(e.target.value)} />
          </label>
          <label style={estilos.rotuloCampo}>
            Consumo de Água (R$)
            <input style={estilosComuns.input} type="text" inputMode="decimal" placeholder="0,00" value={agua} onChange={(e) => setAgua(e.target.value)} />
          </label>
          <label style={estilos.rotuloCampo}>
            Gás — leitura atual (m³, opcional)
            <input style={estilosComuns.input} type="text" inputMode="decimal" placeholder="0,00" value={gasLeitAtual} onChange={(e) => setGasLeitAtual(e.target.value)} />
          </label>
          <label style={estilos.rotuloCampo}>
            Gás — leitura anterior (m³, opcional)
            <input style={estilosComuns.input} type="text" inputMode="decimal" placeholder="0,00" value={gasLeitAnterior} onChange={(e) => setGasLeitAnterior(e.target.value)} />
          </label>
          <label style={estilos.rotuloCampo}>
            Água — leitura atual (m³, opcional)
            <input style={estilosComuns.input} type="text" inputMode="decimal" placeholder="0,00" value={aguaLeitAtual} onChange={(e) => setAguaLeitAtual(e.target.value)} />
          </label>
          <label style={estilos.rotuloCampo}>
            Água — leitura anterior (m³, opcional)
            <input style={estilosComuns.input} type="text" inputMode="decimal" placeholder="0,00" value={aguaLeitAnterior} onChange={(e) => setAguaLeitAnterior(e.target.value)} />
          </label>
        </div>

        <button type="submit" disabled={salvando} style={salvando ? { ...estilosComuns.botaoCriar, opacity: 0.6 } : estilosComuns.botaoCriar}>
          {salvando ? 'Salvando consumo...' : 'Salvar consumo real do mês'}
        </button>
        {msg.texto && (
          <p style={msg.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>{msg.texto}</p>
        )}
      </form>

      {mostrandoItemFixo && (
        <ModalNovoItemFixo aoCadastrar={aoCadastrarItem} aoFechar={() => setMostrandoItemFixo(false)} />
      )}
    </ModalFormulario>
  )
}

const estilos = {
  grade: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  rotuloCampo: { display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#9ca3af', fontSize: '0.8rem' },
  composicao: {
    borderRadius: '10px',
    background: '#0f1422',
    border: '1px solid #1f2937',
    padding: '0.5rem 0.75rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
  },
  composicaoCabecalho: {
    display: 'grid',
    gridTemplateColumns: '3.2rem 1fr 3.4rem 5.2rem',
    gap: '0.5rem',
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#6b7280',
    borderBottom: '1px solid #1f2937',
    paddingBottom: '0.3rem',
    marginBottom: '0.2rem',
  },
  composicaoLinha: { display: 'grid', gridTemplateColumns: '3.2rem 1fr 3.4rem 5.2rem', gap: '0.5rem', fontSize: '0.85rem' },
  composicaoLinhaVariavel: { display: 'grid', gridTemplateColumns: '3.2rem 1fr 3.4rem 5.2rem', gap: '0.5rem', fontSize: '0.85rem', fontStyle: 'italic', color: '#cbd5e1' },
  composicaoTotal: {
    display: 'grid',
    gridTemplateColumns: '3.2rem 1fr 3.4rem 5.2rem',
    gap: '0.5rem',
    fontSize: '0.9rem',
    borderTop: '1px solid #374151',
    paddingTop: '0.35rem',
    marginTop: '0.2rem',
  },
  cod: { color: '#9ca3af', fontSize: '0.8rem' },
  desc: { color: '#e5e7eb', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  ref: { color: '#42A5F5', fontSize: '0.8rem', whiteSpace: 'nowrap' },
  valor: { color: '#f87171', whiteSpace: 'nowrap', textAlign: 'right' },
  linkReajustar: {
    background: 'transparent',
    border: 'none',
    padding: '0',
    color: '#9ca3af',
    fontSize: '0.8rem',
    textDecoration: 'underline',
    alignSelf: 'flex-start',
  },
}