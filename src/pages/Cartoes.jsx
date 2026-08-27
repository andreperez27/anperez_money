import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCartoes } from '../hooks/useCartoes'
import { useFaturas, mesAtual } from '../hooks/useFaturas'
import { useContas } from '../hooks/useContas'
import { useContaAtiva } from '../context/ContaAtivaContext'
import ModalCompra from '../components/ModalCompra'
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

// Fatura "atual" de um cartão para a lista: a do mês corrente; se não
// houver, a última fatura aberta (mais recente em aberto); senão a mais
// recente qualquer (para mostrar um valor de referência).
function escolherFaturaAtual(faturas) {
  if (!faturas.length) return null
  const mes = mesAtual()
  const doMes = faturas.find((f) => f.mes_fatura === mes)
  if (doMes) return doMes
  const emAberto = faturas.find((f) => f.status !== 'paga')
  if (emAberto) return emAberto
  return faturas[0]
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
          <div style={estilos.barra}>
            <div style={{ ...estilos.barraPreenchida, width: `${pctUsado}%` }} />
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
    <div style={{ ...estilosComuns.conteudo, fontSize: '0.9rem' }}>
      <h2 style={{ margin: '0.25rem 0 0.25rem' }}>Cartões de Crédito</h2>
      <p style={estilosComuns.mensagem}>Acompanhe faturas e limite por cartão.</p>

      {carregando && <p style={estilosComuns.mensagem}>Carregando cartões...</p>}
      {erro && <p style={estilosComuns.erro}>Não foi possível carregar: {erro}</p>}

      {!carregando && !erro && (
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

          <button type="button" onClick={() => (mostrandoForm ? setMostrandoForm(false) : abrirForm())} style={estilos.adicionar}>
            {mostrandoForm ? 'Cancelar' : '+ Adicionar cartão'}
          </button>
        </div>
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
        <form onSubmit={handleCriar} style={{ ...estilosComuns.form, maxWidth: '100%', marginTop: '1rem' }}>
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
          {mensagem && (
            <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
              {mensagem.texto}
            </p>
          )}
        </form>
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
