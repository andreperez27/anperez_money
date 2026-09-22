import { useEffect, useMemo, useState } from 'react'
import { formatoReal, formatarData, hoje } from '../../lib/compartilhados'
import { NOME_MES, RÓTULO_TIPO, badgeEstado, corTipo, estilosItem } from './comum'
import { ehAtrasado, ehDisponivel, ehAjustadoPonto, ehConsumoRealInformado } from './comum'
import { ehValorManualPonto } from '../../lib/reconciliacaoPonto'
import { identificarRegraValorVariavel } from '../../lib/serieValorVariavel'
import { proximaDataPendente } from '../../lib/pendenciaAtraso'

const MAX_VISIBLE_CHIPS = 2

export default function CalendarioPlanejamento({
  itens,
  carregando,
  erro,
  mesAtual,
  aoMudarMes,
  dataPadrao,
  acoes,
  aoPosMutacao,
}) {
  const [diaAberto, setDiaAberto] = useState(null)
  const [itensDoDia, setItensDoDia] = useState([])
  const [erroAcao, setErroAcao] = useState('')
  const [confirmandoMigracao, setConfirmandoMigracao] = useState(false)

  // O card usa width 100vw (inclui a scrollbar no desktop): trava o overflow
  // horizontal do body enquanto o calendário está montado para não criar barra
  // de rolagem lateral. Restaura ao desmontar/voltar pra Lista.
  useEffect(() => {
    const prev = document.body.style.overflowX
    document.body.style.overflowX = 'clip'
    if (window.getComputedStyle(document.body).overflowX !== 'clip') {
      document.body.style.overflowX = 'hidden'
    }
    return () => {
      document.body.style.overflowX = prev
    }
  }, [])

  const dataHoje = hoje()

  const itensPorDia = useMemo(() => {
    const mapa = {}
    for (const item of itens || []) {
      const key = item.data_prevista
      if (!mapa[key]) mapa[key] = []
      mapa[key].push(item)
    }
    return mapa
  }, [itens])

  const primeiroDiaMes = useMemo(() => {
    const d = new Date(Date.UTC(mesAtual.ano, mesAtual.mes - 1, 1))
    // Segunda=0, Terça=1, ..., Domingo=6 (padrão ISO/Brasil)
    return (d.getUTCDay() + 6) % 7
  }, [mesAtual])

  const diasNoMes = useMemo(() => {
    return new Date(Date.UTC(mesAtual.ano, mesAtual.mes, 0)).getUTCDate()
  }, [mesAtual])

  const diasNoMesAnterior = useMemo(() => {
    return new Date(Date.UTC(mesAtual.ano, mesAtual.mes - 1, 0)).getUTCDate()
  }, [mesAtual])

  const totalCelulas = useMemo(() => {
    return Math.ceil((primeiroDiaMes + diasNoMes) / 7) * 7
  }, [primeiroDiaMes, diasNoMes])

  function mesAnterior() {
    aoMudarMes((atual) => ({
      ano: atual.mes === 1 ? atual.ano - 1 : atual.ano,
      mes: atual.mes === 1 ? 12 : atual.mes - 1,
    }))
  }

  function proximoMes() {
    aoMudarMes((atual) => ({
      ano: atual.mes === 12 ? atual.ano + 1 : atual.ano,
      mes: atual.mes === 12 ? 1 : atual.mes + 1,
    }))
  }

  function irParaHoje() {
    const h = new Date()
    aoMudarMes({ ano: h.getFullYear(), mes: h.getMonth() + 1 })
  }

  function ehHoje(ano, mes, dia) {
    return ano === Number(dataHoje.slice(0, 4)) && mes === Number(dataHoje.slice(5, 7)) && dia === Number(dataHoje.slice(8, 10))
  }

  function obterItensDoDia(ano, mes, dia) {
    const key = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
    return itensPorDia[key] || []
  }

  function abrirPainelDia(ano, mes, dia) {
    const itens = obterItensDoDia(ano, mes, dia)
    if (itens.length === 0) return
    setItensDoDia(itens)
    setDiaAberto({ ano, mes, dia })
  }

  function fecharPainelDia() {
    setDiaAberto(null)
    setItensDoDia([])
  }

  function labelMesAno() {
    return `${NOME_MES[mesAtual.mes - 1]} ${mesAtual.ano}`
  }

  async function aoMigrarAtraso(item) {
    const dataNova = proximaDataPendente(item, dataHoje)
    const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
    const ok = window.confirm(
      `Mover ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(item.valor))} (previsto de ${ddmm(item.data_prevista)}) pra ${ddmm(dataNova)}?`
    )
    if (!ok) return
    setErroAcao('')
    setConfirmandoMigracao(true)
    try {
      await acoes.migrarAtraso(item.id, dataNova)
      await aoPosMutacao?.()
      fecharPainelDia()
    } catch (e) {
      setErroAcao(`Não foi possível migrar: ${e.message}`)
    } finally {
      setConfirmandoMigracao(false)
    }
  }

  function aoAbrirRealizar(item) {
    setErroAcao('')
    acoes.realizar && acoes.realizar(item)
  }

  function aoAbrirEditar(item) {
    setErroAcao('')
    acoes.editar && acoes.editar(item)
  }

  function aoCancelar(item) {
    setErroAcao('')
    acoes.cancelar && acoes.cancelar(item)
  }

  function aoCancelarSerie(item) {
    setErroAcao('')
    acoes.cancelarSerie && acoes.cancelarSerie(item)
  }

  function aoExcluir(item) {
    setErroAcao('')
    acoes.excluir && acoes.excluir(item)
  }

  function aoExcluirSerie(item) {
    setErroAcao('')
    acoes.excluirSerie && acoes.excluirSerie(item)
  }

  function aoEditarSerie(item) {
    setErroAcao('')
    acoes.regenerarSerie && acoes.regenerarSerie(item)
  }

  function aoSalvarConsumoReal(item) {
    setErroAcao('')
    acoes.salvarConsumoReal && acoes.salvarConsumoReal(item)
  }

  function aoEfetivarFatura(item) {
    setErroAcao('')
    acoes.realizarFatura && acoes.realizarFatura(item)
  }

  const renderChip = (item) => {
    const disponivel = ehDisponivel(item, dataHoje)
    const atrasado = ehAtrasado(item, dataHoje)
    const ajustadoPonto = ehAjustadoPonto(item, dataHoje)
    const consumoReal = ehConsumoRealInformado(item)
    const valorManual = ehValorManualPonto(item)
    const ehPendente = !!item.origem_atraso_id
    const ehSerie = !!item.serie_id
    const ehRecorrente = item.origem === 'recorrente' || item.origem === 'jornada'
    const ehFatura = item.fatura === true
    const ehFaturaReal = ehFatura && item.tipo === 'real'
    const ehFaturaProjetada = ehFatura && item.tipo === 'projetada'
    const ehFerias = item.ferias === true
    const destinoCartao = item.estado === 'previsto' && item.destino_padrao === 'cartao' && !!item.cartao_padrao_id

    let statusClass = 'previsto'
    if (item.estado === 'realizado') statusClass = 'confirmado'
    else if (item.estado === 'cancelado') statusClass = 'cancelado'
    else if (item.estado === 'migrado') statusClass = 'migrado'
    else if (atrasado) statusClass = 'atrasado'
    else if (ehPendente) statusClass = 'pendente'
    else if (disponivel) statusClass = 'disponivel'

    const timeStr = item.hora ? item.hora.slice(0, 5) : ''
    const desc = item.descricao.length > 30 ? item.descricao.slice(0, 27) + '…' : item.descricao

    return (
      <div
        key={item.id}
        style={{
          ...estilos.chipBase,
          background: getChipBg(statusClass),
          color: getChipColor(statusClass),
        }}
        title={item.descricao}
      >
        {timeStr && <> <b>{timeStr}</b> {' · '} </>}{desc}
      </div>
    )
  }

  const celulas = useMemo(() => {
    const arr = []
    for (let i = 0; i < totalCelulas; i++) {
      let dia, fora = false, ano = mesAtual.ano, mes = mesAtual.mes
      if (i < primeiroDiaMes) {
        dia = diasNoMesAnterior - primeiroDiaMes + i + 1
        fora = true
        mes = mesAtual.mes === 1 ? 12 : mesAtual.mes - 1
        ano = mesAtual.mes === 1 ? mesAtual.ano - 1 : mesAtual.ano
      } else if (i >= primeiroDiaMes + diasNoMes) {
        dia = i - primeiroDiaMes - diasNoMes + 1
        fora = true
        mes = mesAtual.mes === 12 ? 1 : mesAtual.mes + 1
        ano = mesAtual.mes === 12 ? mesAtual.ano + 1 : mesAtual.ano
      } else {
        dia = i - primeiroDiaMes + 1
      }

      const itensDia = obterItensDoDia(ano, mes, dia)
      const hojeFlag = !fora && ehHoje(ano, mes, dia)

      arr.push({ dia, fora, ano, mes, itensDia, hojeFlag, index: i })
    }
    return arr
  }, [primeiroDiaMes, diasNoMes, diasNoMesAnterior, totalCelulas, mesAtual, itensPorDia, dataHoje])

  // Avaliação: tela cheia em mobile E desktop (antes só mobile).
  const cardStyle = { ...estilos.card, ...estilos.cardFullscreen }

  return (
    <>
      {carregando && (
        <div style={estilos.carregando}>Carregando lançamentos…</div>
      )}
      {erro && !carregando && (
        <div style={estilos.erro}>
          <p>{erro}</p>
          <p style={estilos.mensagemAux}>Tente navegar para outro mês.</p>
        </div>
      )}
      {!carregando && !erro && (
        <div style={cardStyle}>
          <div style={estilos.navegacaoMes}>
            <button type="button" onClick={mesAnterior} style={estilos.botaoNav} aria-label="Mês anterior">‹</button>
            <div style={estilos.rotuloMes}>{labelMesAno()}</div>
            <button type="button" onClick={proximoMes} style={estilos.botaoNav} aria-label="Próximo mês">›</button>
            <button type="button" onClick={irParaHoje} style={estilos.botaoHoje}>Hoje</button>
          </div>

          <div style={estilos.diasSemana}>
            {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d, i) => (
              <div key={i} style={estilos.diaSemana}>{d}</div>
            ))}
          </div>

          <div style={estilos.grid}>
            {celulas.map((c) => (
              <div
                key={c.index}
                style={{
                  ...estilos.celula,
                  ...(c.fora ? estilos.celulaFora : {}),
                  ...(c.hojeFlag ? estilos.celulaHoje : {}),
                  ...(c.itensDia.length > 0 ? { cursor: 'pointer' } : {}),
                }}
                onClick={() => c.itensDia.length > 0 && abrirPainelDia(c.ano, c.mes, c.dia)}
              >
                <div style={{
                  ...estilos.numeroDia,
                  ...(c.hojeFlag ? estilos.numeroDiaHoje : {}),
                  ...(c.fora ? { color: '#9ca3af' } : {}),
                }}>
                  {c.dia}
                </div>
                {c.itensDia.length > 0 && (
                  <div style={estilos.chipsContainer}>
                    {c.itensDia.slice(0, MAX_VISIBLE_CHIPS).map(renderChip)}
                    {c.itensDia.length > MAX_VISIBLE_CHIPS && (
                      <div style={estilos.maisIndicador}>
                        +{c.itensDia.length - MAX_VISIBLE_CHIPS}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={estilos.legenda}>
            <div style={estilos.legendItem}>
              <span style={{ ...estilos.legendDot, background: '#42A5F5' }}></span> Previsto
            </div>
            <div style={estilos.legendItem}>
              <span style={{ ...estilos.legendDot, background: '#4ade80' }}></span> Realizado
            </div>
            <div style={estilos.legendItem}>
              <span style={{ ...estilos.legendDot, background: '#f87171' }}></span> Atrasado
            </div>
            <div style={estilos.legendItem}>
              <span style={{ ...estilos.legendDot, background: '#f59e0b' }}></span> Pendente
            </div>
            <div style={estilos.legendItem}>
              <span style={{ ...estilos.legendDot, background: '#fbbf24' }}></span> Disponível
            </div>
            <div style={estilos.legendItem}>
              <span style={{ ...estilos.legendDot, background: '#9ca3af' }}></span> Cancelado
            </div>
          </div>
        </div>
      )}

      {diaAberto && (
        <div style={estilos.overlay} onClick={fecharPainelDia}>
          <div style={estilos.painel} onClick={(e) => e.stopPropagation()}>
            <div style={estilos.painelCabecalho}>
              <div style={estilos.painelTitulo}>
                {new Date(Date.UTC(diaAberto.ano, diaAberto.mes - 1, diaAberto.dia)).toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </div>
              <button type="button" onClick={fecharPainelDia} style={estilos.botaoFechar}>✕</button>
            </div>
            <div style={estilos.painelItens}>
              {itensDoDia.map((item) => (
                <div key={item.id} style={estilos.painelItem}>
                  <div style={estilos.painelItemTopo}>
                    <div>
                      <div style={estilos.painelItemDesc}>{item.descricao}</div>
                      <div style={{ ...corTipo(item.tipo_op), ...estilos.painelItemValor }}>
                        {RÓTULO_TIPO(item.tipo_op)} · {formatoReal.format(Number(item.valor))}
                        {item.hora ? (
                          <span style={estilos.painelItemHoraExtra}> · {String(item.hora).slice(0, 5)}</span>
                        ) : null}
                      </div>
                    </div>
                    <span style={badgeEstado(item.estado)}>
                      {item.estado === 'previsto' ? 'Previsto' :
                       item.estado === 'realizado' ? 'Realizado' :
                       item.estado === 'cancelado' ? 'Cancelado' : 'Migrado'}
                    </span>
                  </div>
                  <div style={estilos.painelAcoes}>
                    {item.ferias === true && (
                      <span style={estilosItem.textoFerias}>Aviso</span>
                    )}
                    {item.fatura === true && item.tipo === 'real' && (
                      <button type="button" onClick={() => aoEfetivarFatura(item)} style={estilosItem.botaoAcaoFatura}>Pagar fatura</button>
                    )}
                    {item.fatura === true && item.tipo === 'projetada' && (
                      <span style={estilosItem.botaoAcaoNeutro}>Projeção</span>
                    )}
                    {item.estado === 'previsto' && !item.ferias && !item.fatura && (
                      <>
                        <button type="button" onClick={() => aoAbrirRealizar(item)} style={estilosItem.botaoAcaoRealizar}>Lançar</button>
                        {String(item.data_prevista) < dataHoje && (
                          <button
                            type="button"
                            onClick={() => aoMigrarAtraso(item)}
                            disabled={confirmandoMigracao}
                            style={estilosItem.botaoAcaoMigrar}
                          >
                            {confirmandoMigracao ? 'Migrando…' : 'Jogar p/ próx. semana'}
                          </button>
                        )}
                        {item.estado === 'previsto' && identificarRegraValorVariavel(item) === 'condominio' && (
                          <button type="button" onClick={() => aoSalvarConsumoReal(item)} style={estilosItem.botaoAcaoConsumo}>Inserir consumo real</button>
                        )}
                        {item.estado !== 'cancelado' && (
                          <button type="button" onClick={() => aoAbrirEditar(item)} style={estilosItem.botaoAcaoNeutro}>Editar</button>
                        )}
                        {item.estado !== 'cancelado' && (
                          <button type="button" onClick={() => aoCancelar(item)} style={estilosItem.botaoAcaoNeutro}>Cancelar</button>
                        )}
                        {item.estado !== 'cancelado' && !!item.serie_id && item.origem !== 'recorrente' && (
                          <button type="button" onClick={() => aoCancelarSerie(item)} style={estilosItem.botaoAcaoSerie}>Série</button>
                        )}
                        {item.origem === 'recorrente' && (
                          <button type="button" onClick={() => aoEditarSerie(item)} style={estilosItem.botaoAcaoNeutro}>Editar série</button>
                        )}
                        {!!item.serie_id ? (
                          <button type="button" onClick={() => aoExcluirSerie(item)} style={estilosItem.botaoAcaoExcluir}>Excluir série</button>
                        ) : (
                          <button type="button" onClick={() => aoExcluir(item)} style={estilosItem.botaoAcaoExcluir}>Excluir</button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" style={estilos.botaoNovoNoDia} onClick={() => {}}>
                + Novo lançamento neste dia
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function getChipBg(status) {
  const cores = {
    confirmado: 'rgba(30, 158, 107, 0.15)',
    pendente: 'rgba(245, 158, 11, 0.15)',
    atrasado: 'rgba(248, 113, 113, 0.15)',
    disponivel: 'rgba(251, 191, 36, 0.15)',
    previsto: 'rgba(66, 165, 245, 0.15)',
    realizado: 'rgba(30, 158, 107, 0.15)',
    cancelado: 'rgba(156, 163, 175, 0.15)',
    migrado: 'rgba(196, 181, 253, 0.15)',
  }
  return cores[status] || cores.previsto
}

function getChipColor(status) {
  const cores = {
    confirmado: '#1E9E6B',
    pendente: '#C97A0C',
    atrasado: '#D14343',
    disponivel: '#FBBF24',
    previsto: '#3D7DF6',
    realizado: '#1E9E6B',
    cancelado: '#9CA3AF',
    migrado: '#C4B5FD',
  }
  return cores[status] || cores.previsto
}

const estilos = {
  card: {
    background: '#1C1F25',
    border: '1px solid #2B2F37',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  // Tela cheia (mobile + desktop, em avaliação): breakout real para a largura
  // do viewport. Só cancelar o padding da página não basta porque o Layout
  // envolve o Outlet num CaberNaTela de maxWidth 720px — o card ficaria preso
  // nos 720px. Com width 100vw + margin-left calc(50% - 50vw) a borda esquerda
  // cai exatamente no 0 do viewport em qualquer largura de tela. Sem
  // position:fixed para o toggle Lista/Calendário continuar acessível acima.
  cardFullscreen: {
    width: '100vw',
    maxWidth: '100vw',
    marginLeft: 'calc(50% - 50vw)',
    borderRadius: 0,
    borderLeft: 'none',
    borderRight: 'none',
  },
  carregando: {
    padding: '2rem',
    textAlign: 'center',
    color: '#9BA3AF',
  },
  erro: {
    padding: '1.5rem',
    borderRadius: '10px',
    background: '#1C1F25',
    border: '1px solid #2B2F37',
    color: '#f87171',
    marginBottom: '1rem',
  },
  mensagemAux: {
    marginTop: '0.5rem',
    fontSize: '0.85rem',
    color: '#9BA3AF',
  },
  navegacaoMes: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #2B2F37',
    flexWrap: 'wrap',
    gap: '8px',
  },
  botaoNav: {
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    border: '1px solid #2B2F37',
    background: '#1C1F25',
    color: '#9BA3AF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '16px',
  },
  rotuloMes: {
    fontSize: '16px',
    fontWeight: '600',
    minWidth: '160px',
    textAlign: 'center',
    textTransform: 'capitalize',
    color: '#EDEFF2',
  },
  botaoHoje: {
    marginLeft: 'auto',
    padding: '6px 12px',
    borderRadius: '999px',
    border: '1px solid #2B2F37',
    background: 'transparent',
    color: '#9BA3AF',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  diasSemana: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    borderBottom: '1px solid #2B2F37',
  },
  diaSemana: {
    padding: '10px 0',
    textAlign: 'center',
    fontSize: '11.5px',
    fontWeight: '600',
    color: '#9BA3AF',
  },
  // Colunas RÍGIDAS: minmax(0, 1fr) em vez de 1fr puro — o mínimo auto do
  // 1fr deixa o conteúdo (chip de texto longo) empurrar a largura da coluna
  // e entortar o grid. Com mínimo 0 a coluna nunca passa de 1/7 e o texto
  // que sobrar corta com reticências no chip (chipBase).
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  },
  celula: {
    minHeight: '100px',
    minWidth: 0,
    overflow: 'hidden',
    borderRight: '1px solid #2B2F37',
    borderBottom: '1px solid #2B2F37',
    padding: '8px',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    transition: 'background 0.12s ease',
  },
  celulaFora: {
    background: 'rgba(20, 22, 26, 0.55)',
  },
  celulaHoje: {
    background: 'rgba(66, 165, 245, 0.12)',
  },
  numeroDia: {
    fontSize: '12.5px',
    fontWeight: '600',
    color: '#9BA3AF',
    width: '22px',
    height: '22px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
  },
  numeroDiaHoje: {
    background: '#42A5F5',
    color: '#FFFFFF',
  },
  chipsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    minWidth: 0,
  },
  chipBase: {
    fontSize: '10.5px',
    lineHeight: '1.35',
    padding: '3px 6px',
    borderRadius: '5px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
    maxWidth: '100%',
  },
  maisIndicador: {
    fontSize: '10px',
    color: '#9BA3AF',
    padding: '2px 6px',
  },
  legenda: {
    display: 'flex',
    gap: '16px',
    padding: '14px 16px',
    flexWrap: 'wrap',
    borderTop: '1px solid #2B2F37',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#9BA3AF',
  },
  legendDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },

  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(10, 12, 16, 0.42)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 20,
    padding: 0,
  },
  painel: {
    background: '#1C1F25',
    width: '100%',
    maxWidth: '560px',
    maxHeight: '82vh',
    borderRadius: '16px 16px 0 0',
    padding: '18px 20px 20px',
    overflowY: 'auto',
  },
  painelCabecalho: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '14px',
  },
  painelTitulo: {
    fontSize: '16px',
    fontWeight: '700',
    textTransform: 'capitalize',
    color: '#EDEFF2',
  },
  botaoFechar: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: 'none',
    background: '#14161A',
    color: '#9BA3AF',
    cursor: 'pointer',
    fontSize: '14px',
  },
  painelItens: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  painelItem: {
    border: '1px solid #2B2F37',
    borderRadius: '10px',
    padding: '12px 14px',
  },
  painelItemTopo: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '10px',
    marginBottom: '8px',
  },
  painelItemDesc: {
    fontSize: '14.5px',
    fontWeight: '600',
    color: '#EDEFF2',
  },
  painelItemHora: {
    fontSize: '12px',
    color: '#9BA3AF',
    fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
    marginTop: '2px',
  },
  // Linha tipo + valor (mesmo padrão do acordeão de Lancamentos.jsx via
  // corTipo/RÓTULO_TIPO): nunca é substituída pelo horário.
  painelItemValor: {
    fontSize: '12.5px',
    marginTop: '2px',
  },
  // Horário só como informação adicional, quando o item tiver (planejamentos
  // não tem coluna hora — na prática quase nunca aparece).
  painelItemHoraExtra: {
    color: '#9BA3AF',
    fontWeight: 'normal',
  },
  painelAcoes: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  botaoNovoNoDia: {
    width: '100%',
    marginTop: '4px',
    padding: '11px',
    border: '1px dashed #2B2F37',
    borderRadius: '10px',
    background: 'transparent',
    color: '#9BA3AF',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
}