import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCartoes } from '../hooks/useCartoes'
import { useFaturas, proximaFaturaEmAberto } from '../hooks/useFaturas'
import { useContas } from '../hooks/useContas'
import { useContaAtiva } from '../context/ContaAtivaContext'
import ModalCompra from '../components/ModalCompra'
import ModalFormulario from '../components/ModalFormulario'
import { estilosComuns, formatoReal } from '../lib/compartilhados'

const ROTULO_STATUS = {
  aberta: 'ABERTA',
  parcialmente_paga: 'PARCIAL',
  paga: 'PAGA',
}

const COR_STATUS = {
  aberta: '#fbbf24',
  parcialmente_paga: '#42A5F5',
  paga: '#4ade80',
}

// Cor da barra de uso por faixa, usando os tokens de cor já existentes no
// projeto (verde = ok, amarelo = atenção, vermelho = crítico).
// Abaixo de 50% verde; entre 50% e 80% amarelo; acima de 80% vermelho.
function corBarra(pct) {
  if (pct < 50) return '#4ade80'
  if (pct <= 80) return '#fbbf24'
  return '#f87171'
}

// Percentual com uma casa decimal e separador de milhar brasileiro (ex.: "45,7").
function formatarPct(n) {
  return String(Number(n.toFixed(1))).replace('.', ',')
}

// Fatura em destaque em cada card da lista e no resumo: SEMPRE a próxima fatura
// em aberto (a menor mês ainda não paga — ex.: 2026-09). Assim o cartão mostra
// o valor que de fato será pago a seguir, e não a do mês corrente já liquidada.
function escolherFaturaAtual(faturas) {
  return proximaFaturaEmAberto(faturas)
}

// Um cartão da lista. Componente próprio para conseguir chamar useFaturas
// por cartão (hooks não podem rodar em loop no componente pai).
function CartaoCard({ cartao, aoLancar }) {
  const navigate = useNavigate()
  const { faturas, limiteDisponivel } = useFaturas(cartao.id)
  const fatura = escolherFaturaAtual(faturas)
  const conta = cartao.contas

  const limite = Number(cartao.limite)
  const usado = limite - Number(limiteDisponivel ?? limite)
  const pctUsado = limite > 0 ? Math.min(100, (usado / limite) * 100) : 0

  return (
    <div style={estilos.cartao}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate(`/cartoes/${cartao.id}`)}
        onKeyDown={(e) => e.key === 'Enter' && navigate(`/cartoes/${cartao.id}`)}
        style={estilos.cartaoArea}
      >
        <div style={estilos.cartaoTopo}>
          <span style={estilos.cartaoNome}>{cartao.nome}</span>
          <span style={estilos.pill}>{conta?.nome ?? '—'}</span>
        </div>

        {fatura && (
          <div style={estilos.cartaoFatura}>
            <span style={estilos.faturaMes}>
              Fatura {fatura.mes_fatura} · vence dia {cartao.dia_vencimento}
            </span>
            <strong style={estilos.faturaValor}>
              {formatoReal.format(Number(fatura.valor_restante))}
            </strong>
            <span
              style={{
                ...estilos.statusPill,
                color: COR_STATUS[fatura.status] ?? '#9ca3af',
                borderColor: COR_STATUS[fatura.status] ?? '#374151',
              }}
            >
              {ROTULO_STATUS[fatura.status] ?? fatura.status}
            </span>
          </div>
        )}

        <div style={estilos.barraArea}>
          <div style={estilos.barraPercentualLinha}>
            <span style={estilos.percentualEmUso}>{formatarPct(pctUsado)}% usado</span>
            <span style={estilos.percentualLivre}>{formatarPct(100 - pctUsado)}% livre</span>
          </div>
          <div style={estilos.barra}>
            <div style={{ ...estilos.barraPreenchida, width: `${pctUsado}%`, background: corBarra(pctUsado) }} />
          </div>
          <span style={estilos.barraTexto}>
            {formatoReal.format(usado)} usados de {formatoReal.format(limite)}
          </span>
        </div>

        <div style={estilos.cartaoRodape}>
          <span>Limite disponível: <strong style={{ color: '#42A5F5' }}>{formatoReal.format(Number(limiteDisponivel ?? limite))}</strong></span>
          <span>Fecha dia {cartao.dia_fechamento} · Vence dia {cartao.dia_vencimento}</span>
        </div>
      </div>

      <button type="button" onClick={aoLancar} style={estilos.botaoLancar}>
        + Lançar compra
      </button>
    </div>
  )
}

// Consome useFaturas por cartão (hooks não rodam em loop) e reporta ao painel
// de resumo os três valores agregados: limite, limite disponível e gasto no mês
// (valor restante da fatura atual). Renderiza vazio — só alimenta o agregado.
function ResumoCartao({ cartao, aoCalcular }) {
  const { faturas, limiteDisponivel } = useFaturas(cartao.id)
  const fatura = escolherFaturaAtual(faturas)

  useEffect(() => {
    aoCalcular(cartao.id, {
      limite: Number(cartao.limite) || 0,
      disponivel: Number(limiteDisponivel ?? cartao.limite) || 0,
      gasto: fatura ? Number(fatura.valor_restante) || 0 : 0,
    })
  }, [cartao.id, cartao.limite, limiteDisponivel, fatura, aoCalcular])

  return null
}

// Painel agregado no topo: soma todos os cartões ativos (Limite Total,
// Disponível e Gasto no Mês) + barra única com o percentual global usado/livre
// nas duas pontas. Só consome os hooks/dados existentes — sem recálculo.
function ResumoCartoes({ cartoes }) {
  const [valores, setValores] = useState({})

  const aoCalcular = useCallback((id, v) => {
    setValores((prev) => {
      const atual = prev[id]
      if (
        atual &&
        atual.limite === v.limite &&
        atual.disponivel === v.disponivel &&
        atual.gasto === v.gasto
      ) {
        return prev
      }
      return { ...prev, [id]: v }
    })
  }, [])

  const limiteTotal = cartoes.reduce((s, c) => s + (Number(c.limite) || 0), 0)
  const disponivelTotal = Object.values(valores).reduce((s, v) => s + (v.disponivel || 0), 0)
  const gastoTotal = Object.values(valores).reduce((s, v) => s + (v.gasto || 0), 0)
  const usadoTotal = limiteTotal - disponivelTotal
  const pctUsado =
    limiteTotal > 0 ? Math.min(100, Math.max(0, (usadoTotal / limiteTotal) * 100)) : 0
  const pctLivre = 100 - pctUsado

  return (
    <>
      {cartoes.map((c) => (
        <ResumoCartao key={c.id} cartao={c} aoCalcular={aoCalcular} />
      ))}

      <div style={estilos.resumo}>
        <div style={estilos.resumoValores}>
          <div style={estilos.resumoItem}>
            <span style={estilos.resumoRotulo}>Limite Total</span>
            <strong style={{ ...estilos.resumoNumero, color: '#e5e7eb' }}>
              {formatoReal.format(limiteTotal)}
            </strong>
          </div>
          <div style={estilos.resumoItem}>
            <span style={estilos.resumoRotulo}>Disponível</span>
            <strong style={{ ...estilos.resumoNumero, color: '#4ade80' }}>
              {formatoReal.format(disponivelTotal)}
            </strong>
          </div>
          <div style={estilos.resumoItem}>
            <span style={estilos.resumoRotulo}>Gasto no Mês</span>
            <strong style={{ ...estilos.resumoNumero, color: '#f87171' }}>
              {formatoReal.format(gastoTotal)}
            </strong>
          </div>
        </div>

        <div style={estilos.barraArea}>
          <div style={estilos.barraPercentualLinha}>
            <span style={estilos.percentualEmUso}>{formatarPct(pctUsado)}% usado</span>
            <span style={estilos.percentualLivre}>{formatarPct(pctLivre)}% livre</span>
          </div>
          <div style={estilos.barra}>
            <div
              style={{
                ...estilos.barraPreenchida,
                width: `${pctUsado}%`,
                background: corBarra(pctUsado),
              }}
            />
          </div>
        </div>
      </div>
    </>
  )
}

// Tela de lista dos cartões de crédito (rota /cartoes) + cadastro de novo.
// Cada cartão resume: nome, conta vinculada (pill PF/PJ), fatura em
// destaque (status + valor a pagar + vencimento) e barra de limite
// usado/disponível. Tocar no cartão abre o detalhe da fatura.
export default function Cartoes() {
  const navigate = useNavigate()
  const { contaAtiva } = useContaAtiva()
  const { cartoes, carregando, erro, criarCartao } = useCartoes(null)
  const { contas } = useContas()

  const [mostrandoForm, setMostrandoForm] = useState(false)
  const [form, setForm] = useState({
    nome: '',
    conta_id: contaAtiva?.id ?? '',
    limite: '',
    dia_fechamento: '',
    dia_vencimento: '',
  })
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)
  const [comprandoId, setComprandoId] = useState(null)
  const [versaoCompra, setVersaoCompra] = useState(0)

  function abrirForm() {
    setForm({ nome: '', conta_id: contaAtiva?.id ?? '', limite: '', dia_fechamento: '', dia_vencimento: '' })
    setMensagem(null)
    setMostrandoForm(true)
  }

  async function handleCriar(e) {
    e.preventDefault()
    const limiteNum = Number(form.limite)
    if (!form.nome.trim()) {
      setMensagem({ tipo: 'erro', texto: 'Informe o nome do cartão.' })
      return
    }
    if (!form.conta_id) {
      setMensagem({ tipo: 'erro', texto: 'Selecione a conta vinculada.' })
      return
    }
    if (!limiteNum || limiteNum <= 0) {
      setMensagem({ tipo: 'erro', texto: 'Informe um limite maior que zero.' })
      return
    }
    const fech = parseInt(form.dia_fechamento, 10)
    const venc = parseInt(form.dia_vencimento, 10)
    if (!fech || fech < 1 || fech > 31) {
      setMensagem({ tipo: 'erro', texto: 'Dia de fechamento deve ser entre 1 e 31.' })
      return
    }
    if (!venc || venc < 1 || venc > 31) {
      setMensagem({ tipo: 'erro', texto: 'Dia de vencimento deve ser entre 1 e 31.' })
      return
    }

    setEnviando(true)
    setMensagem(null)
    try {
      await criarCartao({
        nome: form.nome.trim(),
        conta_id: form.conta_id,
        limite: limiteNum,
        dia_fechamento: fech,
        dia_vencimento: venc,
      })
      setMostrandoForm(false)
      navigate('/cartoes')
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={estilosComuns.conteudo}>
      <h2 style={{ margin: '0.25rem 0 0.25rem' }}>Cartões de Crédito</h2>
      <p style={estilosComuns.mensagem}>Acompanhe faturas e limite por cartão.</p>

      {carregando && <p style={estilosComuns.mensagem}>Carregando cartões...</p>}
      {erro && <p style={estilosComuns.erro}>Não foi possível carregar: {erro}</p>}

      {!carregando && !erro && (
        <>
          {cartoes.length > 0 && <ResumoCartoes cartoes={cartoes} />}

          <div style={estilos.grade}>
          {cartoes.map((c) => (
            <CartaoCard
              key={`${c.id}-${versaoCompra}`}
              cartao={c}
              aoLancar={() => {
                setComprandoId(comprandoId === c.id ? null : c.id)
                setMensagem(null)
              }}
            />
          ))}

          <button type="button" onClick={abrirForm} style={estilos.adicionar}>
            + Adicionar cartão
          </button>
          </div>
        </>
      )}

      {comprandoId && (
        <ModalCompra
          aberto={!!comprandoId}
          cartaoIdInicial={comprandoId}
          aoFechar={() => setComprandoId(null)}
          aoLancar={() => setVersaoCompra((v) => v + 1)}
        />
      )}

      {mostrandoForm && (
        <ModalFormulario
          titulo="Novo cartão"
          aoFechar={() => {
            setMostrandoForm(false)
            setMensagem(null)
          }}
        >
          <form onSubmit={handleCriar} style={{ ...estilosComuns.form, maxWidth: '100%' }}>
            <input
              type="text"
              placeholder="Nome do cartão (ex.: Nubank PJ)"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              style={estilosComuns.input}
            />
            <select
              value={form.conta_id}
              onChange={(e) => setForm({ ...form, conta_id: e.target.value })}
              style={estilosComuns.input}
            >
              <option value="">Selecione a conta vinculada</option>
              {contas.filter((c) => c.ativa).map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="Limite (R$)"
              value={form.limite}
              onChange={(e) => setForm({ ...form, limite: e.target.value })}
              style={estilosComuns.input}
            />
            <div style={estilos.diasLinha}>
              <input
                type="number"
                min="1"
                max="31"
                placeholder="Fechamento (dia)"
                value={form.dia_fechamento}
                onChange={(e) => setForm({ ...form, dia_fechamento: e.target.value })}
                style={estilosComuns.input}
              />
              <input
                type="number"
                min="1"
                max="31"
                placeholder="Vencimento (dia)"
                value={form.dia_vencimento}
                onChange={(e) => setForm({ ...form, dia_vencimento: e.target.value })}
                style={estilosComuns.input}
              />
            </div>
            <button type="submit" disabled={enviando} style={estilos.botaoCriar}>
              {enviando ? 'Cadastrando...' : 'Cadastrar cartão'}
            </button>
          </form>
          {mensagem && (
            <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
              {mensagem.texto}
            </p>
          )}
        </ModalFormulario>
      )}

      {!carregando && !erro && cartoes.length === 0 && !mostrandoForm && (
        <p style={estilosComuns.mensagem}>Nenhum cartão cadastrado nesta conta ainda.</p>
      )}
    </div>
  )
}

const estilos = {
  grade: { display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' },
  cartao: {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '14px',
    padding: '0.6rem 0.6rem',
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: '#e5e7eb',
  },
  cartaoArea: { padding: '0.5rem 0.6rem' },
  cartaoTopo: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  cartaoNome: { fontWeight: 'bold', fontSize: '1.05rem' },
  pill: {
    color: '#9ca3af',
    fontSize: '0.78rem',
    background: '#0b0f19',
    border: '1px solid #374151',
    borderRadius: '999px',
    padding: '0.2rem 0.7rem',
  },
  cartaoFatura: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.6rem',
    flexWrap: 'wrap',
    marginTop: '0.9rem',
  },
  faturaMes: { color: '#9ca3af', fontSize: '0.8rem' },
  faturaValor: { fontSize: '1.5rem', color: '#42A5F5' },
  statusPill: {
    fontSize: '0.68rem',
    fontWeight: 'bold',
    letterSpacing: '0.04em',
    border: '1px solid',
    borderRadius: '999px',
    padding: '0.15rem 0.6rem',
    marginLeft: 'auto',
  },
  barraArea: { marginTop: '0.9rem' },
  barra: {
    height: '6px',
    borderRadius: '999px',
    background: '#1f2937',
    overflow: 'hidden',
  },
  barraPreenchida: {
    height: '100%',
    borderRadius: '999px',
    background: '#42A5F5',
    transition: 'width 0.3s ease',
  },
  barraTexto: { display: 'block', color: '#6b7280', fontSize: '0.78rem', marginTop: '0.35rem' },
  barraPercentualLinha: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.3rem',
  },
  percentualEmUso: { color: '#e5e7eb', fontSize: '0.78rem', fontWeight: 'bold' },
  percentualLivre: { color: '#9ca3af', fontSize: '0.78rem' },
  resumo: {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '14px',
    padding: '1rem 1.1rem',
    marginTop: '1rem',
  },
  resumoValores: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '0.75rem',
    flexWrap: 'wrap',
    marginBottom: '0.9rem',
  },
  resumoItem: { display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: '0' },
  resumoRotulo: { color: '#9ca3af', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em' },
  resumoNumero: { fontSize: '1.25rem' },
  cartaoRodape: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '0.5rem',
    flexWrap: 'wrap',
    marginTop: '0.75rem',
    color: '#9ca3af',
    fontSize: '0.78rem',
    borderTop: '1px solid #1f2937',
    paddingTop: '0.7rem',
  },
  adicionar: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '1rem',
    borderRadius: '14px',
    border: '1px dashed #374151',
    background: 'transparent',
    color: '#42A5F5',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  diasLinha: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  botaoLancar: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    marginTop: '0.4rem',
    padding: '0.55rem',
    borderRadius: '8px',
    border: '1px solid #42A5F5',
    background: '#0b0f19',
    color: '#42A5F5',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  botaoCriar: {
    padding: '0.6rem',
    borderRadius: '8px',
    border: 'none',
    background: '#42A5F5',
    color: '#0b0f19',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
}
