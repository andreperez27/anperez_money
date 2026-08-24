import { useState } from 'react'
import { useMuyEstrecho } from '../../hooks/useMediaQuery'
import { estilosComuns, formatoReal, formatarData, hoje } from '../../lib/compartilhados'
import {
  RÓTULO_ESTADO,
  RÓTULO_TIPO,
  ehEntrada,
  ehDisponivel,
  badgeEstado,
  conteudoItem,
  corTipo,
  estilosItem,
} from './comum'

// ============================================================================
// LANÇAMENTOS DO PLANEJAMENTO (ETAPA 06/E5-F4)
// ============================================================================
// Área operacional: formulário de criação (avulsa × parcelada) + lista do
// período com ações. Porto FIEL do comportamento validado na E5-E — as regras
// não mudaram:
//   • criação avulsa → criarPlanejamento; série parcelada → criarSerieParcelada
//     (numerador/datas nascem na lib pura; a UI só envia o conjunto);
//   • badge "3/10" nas linhas de série e tag derivada "Disponível";
//   • CANCELAR ≠ EXCLUIR; cancelamento de série respeita previsto/realizado;
//   • totais/contagens NÃO são recalculados aqui — quem exibe números é a
//     Visão geral; esta aba é edição e listagem.
//
// FORA de escopo até a E5-F: efetivação (botão Lançar) e regeneração pela UI.
// Pós-mutação bem-sucedida, aoPosMutacao() avisa a página (que decide se algo
// precisa ser recarregado — nos períodos maiores, refazer a própria faixa).
// ============================================================================

// Lê um número digitado ("1500,00" ou "1500.00") → número em reais.
function lerValor(texto) {
  const n = Number(String(texto).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

export default function Lancamentos({
  itens,
  carregando,
  erro,
  dataPadrao,
  acoes,
  aoPosMutacao,
}) {
  const muyEstrecho = useMuyEstrecho()
  const [erroAcao, setErroAcao] = useState('')

  // Formulário de criação — avulsa × parcelada.
  const [modo, setModo] = useState('avulsa') // 'avulsa' | 'parcelada'
  const [form, setForm] = useState({
    tipo_op: 'Saida',
    descricao: '',
    valor: '', // avulsa/valor total (reais)
    data_prevista: '', // avulsa
    total_parcelas: '', // parcelada
    data_primeira_parcela: '', // parcelada
  })
  const [formMsg, setFormMsg] = useState({ tipo: '', texto: '' })
  const [criando, setCriando] = useState(false)

  function campo(campoO) {
    setForm((f) => ({ ...f, ...campoO }))
    if (formMsg.texto) setFormMsg({ tipo: '', texto: '' })
  }

  async function aoCancelar(item) {
    if (carregando) return
    const ok = window.confirm(
      `Cancelar "${item.descricao}"?\n\nO registro permanece no histórico com estado "cancelado".`,
    )
    if (!ok) return
    try {
      await acoes.cancelar(item.id)
      setErroAcao('')
      await aoPosMutacao?.()
    } catch (e) {
      setErroAcao(`Não foi possível cancelar: ${e.message}`)
    }
  }

  // Cancelamento de resto da série a partir desta parcela (D5). Realizadas e
  // canceladas nunca são tocadas; o domínio usa a lib para calcular o intervalo.
  async function aoCancelarSerie(item) {
    if (carregando) return
    const ehAvulsa = !item.serie_id
    const mensagem = ehAvulsa
      ? `Esta ocorrência é avulsa. Cancelar "${item.descricao}"?`
      : `Cancelar a série a partir da parcela ${item.parcela_numero} de "${item.descricao}"?\n\nSó parcelas "previsto" daqui para frente são canceladas; realizadas não mudam.`
    const ok = window.confirm(mensagem)
    if (!ok) return
    try {
      await acoes.cancelarSerie(item.id)
      setErroAcao('')
      await aoPosMutacao?.()
    } catch (e) {
      setErroAcao(`Não foi possível cancelar a série: ${e.message}`)
    }
  }

  async function aoExcluir(item) {
    if (carregando) return
    const ok = window.confirm(
      `Excluir DEFINITIVAMENTE "${item.descricao}"?\n\nEsta ação não pode ser desfeita.`,
    )
    if (!ok) return
    try {
      await acoes.excluir(item.id)
      setErroAcao('')
      await aoPosMutacao?.()
    } catch (e) {
      setErroAcao(`Não foi possível excluir: ${e.message}`)
    }
  }

  async function aoCriar(e) {
    e.preventDefault()
    if (criando) return
    const descricao = form.descricao.trim()
    if (!descricao) {
      setFormMsg({ tipo: 'erro', texto: 'Informe a descrição.' })
      return
    }

    try {
      setCriando(true)
      if (modo === 'parcelada') {
        const totalParcelas = Number(form.total_parcelas)
        const valorTotal = lerValor(form.valor)
        if (!Number.isInteger(totalParcelas) || totalParcelas < 1) {
          setFormMsg({ tipo: 'erro', texto: 'Número de parcelas inválido (use inteiro >= 1).' })
          return
        }
        if (!Number.isFinite(valorTotal) || valorTotal <= 0) {
          setFormMsg({ tipo: 'erro', texto: 'Informe um valor total maior que zero.' })
          return
        }
        await acoes.criarSerie({
          tipoOp: form.tipo_op,
          descricao,
          totalCentavos: Math.round(valorTotal * 100),
          totalParcelas,
          dataPrimeiraParcela: form.data_primeira_parcela || dataPadrao,
        })
        setForm((f) => ({ ...f, descricao: '', valor: '', total_parcelas: '' }))
        setFormMsg({ tipo: 'ok', texto: `Série criada (${totalParcelas} parcela(s)).` })
      } else {
        const valor = lerValor(form.valor)
        if (!Number.isFinite(valor) || valor <= 0) {
          setFormMsg({ tipo: 'erro', texto: 'Informe um valor maior que zero.' })
          return
        }
        await acoes.criar({
          tipo_op: form.tipo_op,
          descricao,
          valor,
          data_prevista: form.data_prevista || dataPadrao,
        })
        setForm((f) => ({ ...f, descricao: '', valor: '' }))
        setFormMsg({ tipo: 'ok', texto: 'Planejamento criado.' })
      }
      await aoPosMutacao?.()
    } catch (err) {
      setFormMsg({ tipo: 'erro', texto: `Não foi possível criar: ${err.message}` })
    } finally {
      setCriando(false)
    }
  }

  const criandoOk = formMsg.tipo === 'ok'
  const dataHoje = hoje()

  return (
    <section>
      {/* Formulário de criação — avulsa × parcelada */}
      <form onSubmit={aoCriar} style={estilos.form} noValidate>
        <div style={estilos.toggle}>
          <button
            type="button"
            onClick={() => { setModo('avulsa'); setFormMsg({ tipo: '', texto: '' }) }}
            style={{ ...estilos.pilhaModo, ...(modo === 'avulsa' ? estilos.pilhaModoAtiva : {}) }}
          >
            Avulsa
          </button>
          <button
            type="button"
            onClick={() => { setModo('parcelada'); setFormMsg({ tipo: '', texto: '' }) }}
            style={{ ...estilos.pilhaModo, ...(modo === 'parcelada' ? estilos.pilhaModoAtiva : {}) }}
          >
            Parcelada
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <label style={estilos.radioTipo}>
            <input
              type="radio"
              name="tipo_op"
              value="Entrada"
              checked={form.tipo_op === 'Entrada'}
              onChange={() => campo({ tipo_op: 'Entrada' })}
            />
            Entrada
          </label>
          <label style={estilos.radioTipo}>
            <input
              type="radio"
              name="tipo_op"
              value="Saida"
              checked={form.tipo_op === 'Saida'}
              onChange={() => campo({ tipo_op: 'Saida' })}
            />
            Despesa
          </label>
        </div>

        <input
          style={estilosComuns.input}
          placeholder="Descrição"
          value={form.descricao}
          onChange={(e) => campo({ descricao: e.target.value })}
          maxLength={200}
        />

        <div style={estilos.camposLadoALado}>
          <label style={estilos.rotuloCampo}>
            {modo === 'parcelada' ? 'Valor total (R$)' : 'Valor (R$)'}
            <input
              style={estilosComuns.input}
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={form.valor}
              onChange={(e) => campo({ valor: e.target.value })}
            />
          </label>
          {modo === 'parcelada' ? (
            <label style={estilos.rotuloCampo}>
              Parcelas
              <input
                style={estilosComuns.input}
                type="number"
                min="1"
                step="1"
                placeholder="10"
                value={form.total_parcelas}
                onChange={(e) => campo({ total_parcelas: e.target.value })}
              />
            </label>
          ) : (
            <label style={estilos.rotuloCampo}>
              Data
              <input
                style={estilosComuns.input}
                type="date"
                value={form.data_prevista}
                onChange={(e) => campo({ data_prevista: e.target.value })}
              />
            </label>
          )}
        </div>

        {modo === 'parcelada' && (
          <label style={estilos.rotuloCampo}>
            Data da 1ª parcela
            <input
              style={estilosComuns.input}
              type="date"
              value={form.data_primeira_parcela}
              onChange={(e) => campo({ data_primeira_parcela: e.target.value })}
            />
          </label>
        )}

        {formMsg.texto && (
          <p style={criandoOk ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
            {formMsg.texto}
          </p>
        )}

        <button type="submit" disabled={criando} style={criando ? estilos.botaoCriando : estilosComuns.botaoCriar}>
          {criando ? 'Criando...' : modo === 'parcelada' ? 'Criar série' : 'Criar planejamento'}
        </button>
      </form>

      {erroAcao && <p style={{ ...estilosComuns.mensagemErro, marginTop: '1rem' }}>{erroAcao}</p>}

      {carregando && <p style={{ ...estilosComuns.mensagem, marginTop: '1rem' }}>Carregando lançamentos...</p>}
      {!carregando && erro && (
        <div style={{ marginTop: '1rem' }}>
          <p style={estilosComuns.erro}>{erro}</p>
          <p style={estilosComuns.mensagem}>Tente navegar para outro período e voltar.</p>
        </div>
      )}
      {!carregando && !erro && itens.length === 0 && (
        <div style={estilos.vazio}>
          <p style={{ ...estilosComuns.mensagem, margin: 0 }}>
            Nenhum planejamento neste período.
          </p>
          <p style={{ ...estilosComuns.mensagem, margin: 0, fontSize: '0.85rem' }}>
            Use ‹ › para consultar outros períodos ou cadastre acima.
          </p>
        </div>
      )}

      {!carregando && !erro && itens.length > 0 && (
        <ul style={{ ...estilosItem.lista, marginTop: '1rem' }}>
          {itens.map((item) => {
            const disponivel = ehDisponivel(item, dataHoje)
            const ehSerie = !!item.serie_id
            return (
              <li key={item.id} style={muyEstrecho ? estilosItem.itemMobile : estilosItem.item}>
                {muyEstrecho ? (
                  <>
                    <div style={estilosItem.linhaMobileTopo}>
                      <span style={estilosItem.data}>{formatarData(item.data_prevista)}</span>
                      <span style={estilosItem.topoDireita}>
                        {ehSerie && (
                          <span style={estilosItem.badgeParcela}>
                            {item.parcela_numero}/{item.total_parcelas}
                          </span>
                        )}
                        {disponivel && (
                          <span style={estilosItem.badgeDisponivel}>Disponível</span>
                        )}
                        <span style={badgeEstado(item.estado)}>
                          {RÓTULO_ESTADO[item.estado] ?? item.estado}
                        </span>
                      </span>
                    </div>
                    <div style={conteudoItem(item)}>{item.descricao}</div>
                    <div style={estilosItem.linhaMobileBase}>
                      <span style={corTipo(item.tipo_op)}>
                        {RÓTULO_TIPO(item.tipo_op)} · {formatoReal.format(Number(item.valor))}
                      </span>
                      <span style={estilosItem.acoes}>
                        {item.estado !== 'cancelado' && (
                          <button type="button" onClick={() => aoCancelar(item)} title="Cancelar esta ocorrência" style={estilosItem.botaoAcaoNeutro}>Cancelar</button>
                        )}
                        {item.estado !== 'cancelado' && ehSerie && (
                          <button type="button" onClick={() => aoCancelarSerie(item)} title="Cancelar série a partir desta parcela" style={estilosItem.botaoAcaoSerie}>Série</button>
                        )}
                        <button type="button" onClick={() => aoExcluir(item)} title="Excluir definitivamente" style={estilosItem.botaoAcaoExcluir}>Excluir</button>
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <span style={estilosItem.data}>{formatarData(item.data_prevista)}</span>
                    <span style={conteudoItem(item)}>
                      {item.descricao}
                      {ehSerie && (
                        <span style={{ ...estilosItem.badgeParcela, marginLeft: '0.5rem' }}>
                          {item.parcela_numero}/{item.total_parcelas}
                        </span>
                      )}
                      {disponivel && (
                        <span style={{ ...estilosItem.badgeDisponivel, marginLeft: '0.5rem' }}>
                          Disponível
                        </span>
                      )}
                    </span>
                    <span style={corTipo(item.tipo_op)}>{RÓTULO_TIPO(item.tipo_op)}</span>
                    <span style={{ ...estilosItem.valor, color: ehEntrada(item.tipo_op) ? '#4ade80' : '#f87171' }}>
                      {formatoReal.format(Number(item.valor))}
                    </span>
                    <span style={badgeEstado(item.estado)}>{RÓTULO_ESTADO[item.estado] ?? item.estado}</span>
                    <span style={estilosItem.acoes}>
                      {item.estado !== 'cancelado' && (
                        <button type="button" onClick={() => aoCancelar(item)} title="Cancelar esta ocorrência" style={estilosItem.botaoAcaoNeutro}>Cancelar</button>
                      )}
                      {item.estado !== 'cancelado' && ehSerie && (
                        <button type="button" onClick={() => aoCancelarSerie(item)} title="Cancelar série a partir desta parcela" style={estilosItem.botaoAcaoSerie}>Série</button>
                      )}
                      <button type="button" onClick={() => aoExcluir(item)} title="Excluir definitivamente" style={estilosItem.botaoAcaoExcluir}>Excluir</button>
                    </span>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const estilos = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    padding: '1rem',
    borderRadius: '12px',
    background: '#111827',
    border: '1px solid #1f2937',
  },
  toggle: { display: 'flex', gap: '0.5rem' },
  pilhaModo: {
    padding: '0.35rem 0.9rem',
    borderRadius: '999px',
    border: '1px solid #374151',
    background: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  pilhaModoAtiva: { color: '#42A5F5', borderColor: 'rgba(66, 165, 245, 0.45)' },
  radioTipo: { display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#e5e7eb', cursor: 'pointer', fontSize: '0.9rem' },
  camposLadoALado: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap' },
  rotuloCampo: { display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#9ca3af', fontSize: '0.8rem', flex: '1 1 130px' },
  botaoCriando: { ...estilosComuns.botaoCriar, opacity: 0.6, cursor: 'default' },
  vazio: { padding: '1.25rem', borderRadius: '10px', background: '#111827', border: '1px dashed #374151', display: 'flex', flexDirection: 'column', gap: '0.35rem', textAlign: 'center' },
}
