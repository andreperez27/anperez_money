import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useCartoes } from '../hooks/useCartoes'
import { useFaturas, mesAtual } from '../hooks/useFaturas'
import { useCompras, useExtratoCartao } from '../hooks/useCompras'
import ModalCompra from '../components/ModalCompra'
import EditarCompraForm from '../components/EditarCompraForm'
import { estilosComuns, formatarData, formatoReal, hoje } from '../lib/compartilhados'

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

// Lista única de meses ("YYYY-MM") entre inicio e fim, para o filtro de
// extrato.
function listaMeses(inicio, fim) {
  const anos = []
  for (let a = inicio.getFullYear(); a <= fim.getFullYear(); a++) {
    const mIni = a === inicio.getFullYear() ? inicio.getMonth() : 0
    const mFim = a === fim.getFullYear() ? fim.getMonth() : 11
    for (let m = mIni; m <= mFim; m++) {
      anos.push(`${a}-${String(m + 1).padStart(2, '0')}`)
    }
  }
  return anos
}

// É um mês válido de fatura "YYYY-MM"?
function ehMes(s) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '')
}

// Desloca um mês "YYYY-MM" em `delta` meses (±1).
function deslocaMes(mesStr, delta) {
  let [ano, m] = mesStr.split('-').map(Number)
  m += delta
  if (m < 1) { m += 12; ano -= 1 }
  if (m > 12) { m -= 12; ano += 1 }
  return `${ano}-${String(m).padStart(2, '0')}`
}

// "2026-08" → "08/2026" (rótulo do seletor de mês, estilo app antigo).
function mesExibicao(mesStr) {
  const [ano, m] = mesStr.split('-')
  return `${m}/${ano}`
}

// Data de vencimento (ISO YYYY-MM-DD) da fatura do mês `mesStr`, usando o
// dia de vencimento do cartão (clamp p/ meses curtos ex.: 31 em 04 → 30).
function vencimentoISO(mesStr, diaVenc) {
  const [ano, m] = mesStr.split('-').map(Number)
  const ultimo = new Date(ano, m, 0).getDate()
  const dia = Math.max(1, Math.min(diaVenc, ultimo))
  return `${ano}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

// Tela de detalhe da fatura do cartão (rota /cartoes/:id), reorganizada no
// estilo "Extrato do Cartão" do app antigo (ControleHoras):
//   - Seletor do cartão não é preciso (a rota já fixa o cartão): mostramos
//     o cartão/conta no header. Seletor de mês bem visível (‹ 08/2026 ›).
//   - Linha "Vencimento da fatura: dd/mm/aaaa".
//   - Tabela: Data | Descrição | Parc. | Valor (valor em vermelho).
//   - Rodapé com o Total da fatura + Já pago + Em aberto.
//   - Pagar fatura: cria a fatura_pagamentos E a movimentação de SAÍDA na
//     conta corrente do cartão (RPC pagar_fatura) — saldo atualizado pela
//     trigger trg_atualizar_saldo. "Desfazer pagamento" quando já paga.
//   - Abas [Fatura] | [Extrato]: a aba Fatura é APENAS demonstrativa (sem
//     Editar/Excluir); a aba Extrato lista o mês da fatura selecionada e
//     períodos maiores, e é onde ficam as ações Editar/Excluir (em avaliação).
export default function FaturaDetalhe() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const mesConsulta = searchParams.get('mes')

  const { cartoes } = useCartoes(null)
  const cartao = cartoes.find((c) => c.id === id) ?? null

  const {
    faturas,
    limiteDisponivel,
    carregando,
    erro,
    pagarFatura,
    desfazerPagamento,
    atualizar: atualizarFaturas,
  } = useFaturas(id)

  // Estado das abas
  const [aba, setAba] = useState('fatura')

  // Mês corrente da fatura (para o fallback do seletor)
  const mesCorrenteAtual = mesAtual()

  // Mês selecionado: usa ?mes= quando é um mês válido (mesmo sem fatura);
  // senão cai no corrente ou no mais recente com fatura.
  const mes =
    ehMes(mesConsulta)
      ? mesConsulta
      : faturas.some((f) => f.mes_fatura === mesCorrenteAtual)
        ? mesCorrenteAtual
        : faturas[0]?.mes_fatura ?? mesCorrenteAtual
  const faturaMeses = faturas.map((f) => f.mes_fatura)
  const fatura = faturas.find((f) => f.mes_fatura === mes) ?? null

  const { itens, pagamentos, carregando: itensCarregando, erro: itensErro, atualizar: atualizarItens } = useCompras(id, mes)

  // Aba Extrato: filtros de período. "Mês atual" segue o mês da fatura
  // selecionada (assim o que aparece na fatura aparece no extrato — corrige
  // o "Nenhum lançamento neste período" indevido).
  const [periodo, setPeriodo] = useState('mesAtual')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')

  function rangeExtrato() {
    if (periodo === 'mesAtual') {
      const m = mes
      return { inicio: m, fim: m }
    }
    if (periodo === 'ultimos3') {
      const hojeD = new Date()
      const fim = new Date(hojeD.getFullYear(), hojeD.getMonth(), 1)
      const inic = new Date(hojeD.getFullYear(), hojeD.getMonth() - 2, 1)
      const mm = listaMeses(inic, fim)
      return { inicio: mm[0], fim: mm[mm.length - 1] }
    }
    // personalizado
    if (dataInicio && dataFim && dataInicio <= dataFim) {
      const extrai = (iso) => iso.slice(0, 7)
      return { inicio: extrai(dataInicio), fim: extrai(dataFim) }
    }
    return null
  }

  const range = rangeExtrato()
  const {
    itens: extrato,
    carregando: extratoCarregando,
    erro: extratoErro,
    atualizar: atualizarExtrato,
  } = useExtratoCartao(id, { ...(range ?? {}), habilitado: !!range })

  const [valorPagamento, setValorPagamento] = useState('')
  const [dataPagamento, setDataPagamento] = useState(hoje())
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)
  const [comprarAberto, setComprarAberto] = useState(false)

  // Item em edição: guarda a PARCELA (linha da fatura/extrato) cuja compra
  // está sendo editada.
  const [editandoId, setEditandoId] = useState(null)

  // Quando a fatura em exibição muda, reinicia o campo de valor com o
  // restante dela (facilita pagar o total).
  useEffect(() => {
    if (fatura) setValorPagamento(String(Number(fatura.valor_restante)))
  }, [fatura?.mes_fatura]) // eslint-disable-line react-hooks/exhaustive-deps

  // Após editar/excluir uma compra, recarrega fatura, itens e extrato para
  // refletir totais, status e limite.
  async function PosMutacao() {
    setEditandoId(null)
    await Promise.all([atualizarFaturas(), atualizarItens(), atualizarExtrato()])
  }

  // Exclusão direta pela lixeira da linha (padrão de Contas): confirma e
  // chama a RPC atômica excluir_compra (soft-delete); o banco recalcula as
  // parcelas e bloqueia operações que corromperiam fatura paga.
  async function handleExcluirCompra(compra) {
    if (!compra?.id) return
    const ok = window.confirm(
      'Excluir este lançamento?\n\nO valor será removido da fatura e o limite disponível será recalculado.',
    )
    if (!ok) return
    setMensagem(null)
    try {
      await excluirCompra(compra.id)
      setMensagem({ tipo: 'ok', texto: 'Lançamento excluído.' })
      await PosMutacao()
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    }
  }

  // Troca de mês no seletor (‹ ›) atualizando a URL (?mes=).
  function irParaMes(novoMes) {
    setSearchParams({ mes: novoMes }, { replace: true })
  }

  async function handlePagar(e) {
    e.preventDefault()
    const valorNum = Number(valorPagamento)
    if (!valorNum || valorNum <= 0) {
      setMensagem({ tipo: 'erro', texto: 'Informe um valor maior que zero.' })
      return
    }

    setEnviando(true)
    setMensagem(null)
    try {
      // A RPC pagar_fatura registra a fatura PAGA e cria a movimentação de
      // SAÍDA na conta corrente vinculada ao cartão (descrição padrão
      // "Pagamento fatura <cartão> - <mês>"); a trigger atualiza o saldo.
      await pagarFatura({
        valor: valorNum,
        data: dataPagamento,
        mes_fatura: mes,
        descricao: null,
      })
      setMensagem({
        tipo: 'ok',
        texto: `Pagamento de ${formatoReal.format(valorNum)} registrado. Saída criada na conta ${cartao.contas?.nome ?? ''} e fatura ${mesExibicao(mes)} paga.`,
      })
      await Promise.all([atualizarFaturas(), atualizarItens(), atualizarExtrato()])
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setEnviando(false)
    }
  }

  async function handleDesfazerPagamento() {
    const ok = window.confirm(
      `Desfazer o pagamento da fatura ${mesExibicao(mes)}?\n\nO valor voltará para a conta ${cartao.contas?.nome ?? ''} e o saldo será restaurado.`,
    )
    if (!ok) return

    setMensagem(null)
    try {
      await desfazerPagamento({ mes_fatura: mes })
      setMensagem({ tipo: 'ok', texto: `Pagamento da fatura ${mesExibicao(mes)} desfeito.` })
      await Promise.all([atualizarFaturas(), atualizarItens(), atualizarExtrato()])
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    }
  }

  if (carregando) {
    return <div style={estilosComuns.conteudo}><p style={estilosComuns.mensagem}>Carregando fatura...</p></div>
  }

  if (erro || !cartao) {
    return (
      <div style={estilosComuns.conteudo}>
        <h2>Fatura</h2>
        <p style={estilosComuns.erro}>
          {erro ? `Não foi possível carregar: ${erro}` : 'Cartão não encontrado.'}
        </p>
        <Link to="/cartoes" style={estilosComuns.link}>← Voltar para Cartões</Link>
      </div>
    )
  }

  const restante = Number(fatura?.valor_restante ?? 0)
  const jaPago = Number(fatura?.valor_pago ?? 0)
  const total = Number(fatura?.valor_total ?? 0)
  const status = fatura?.status ?? 'aberta'
  const conta = cartao.contas
  const temPagamento = jaPago > 0

  // Renderiza UMA linha da tabela (usada na fatura e no extrato).
  // Linha 1: grid com Data | Descrição | Parc. | Valor (estilo app antigo).
  //
  // Na aba Fatura a lista é APENAS demonstrativa — nenhum botão Editar/
  // Excluir. Só na aba Extrato (em avaliação) as ações aparecem por linha,
  // alinhadas na ÚLTIMA coluna (final da linha, padrão de Contas) junto ao
  // valor — não no começo da linha.
  function linhaFatura(parcela, { comAcoes = false, extraTexto } = {}) {
    const compra = parcela.compras ?? {}
    const editando = editandoId === parcela.id
    return (
      <li key={parcela.id} style={estilos.linha}>
        <div
          style={{
            ...estilos.linhaGrid,
            gridTemplateColumns: comAcoes
              ? '1.4fr 4fr 1fr 1.5fr auto'
              : estilos.linhaGrid.gridTemplateColumns,
          }}
        >
          <span style={estilos.celData}>{formatarData(compra.data ?? '')}</span>
          <span style={estilos.celDescricao} title={compra.descricao || ''}>
            {compra.descricao || 'Compra no cartão'}
          </span>
          <span style={estilos.celParcela}>
            {parcela.numero}/{parcela.total}
          </span>
          <span style={estilos.celValor}>{formatoReal.format(Number(parcela.valor))}</span>
          {comAcoes && (
            <span style={estilos.celAcoes}>
              <button
                type="button"
                title="Editar lançamento"
                aria-label="Editar lançamento"
                onClick={() => setEditandoId(editando ? null : parcela.id)}
                style={estilos.botaoIcone}
              >
                ✏️
              </button>
              <button
                type="button"
                title="Excluir lançamento"
                aria-label="Excluir lançamento"
                onClick={() => handleExcluirCompra(compra)}
                style={estilos.botaoIcone}
              >
                🗑️
              </button>
            </span>
          )}
        </div>
        {extraTexto && <p style={estilos.celExtra}>{extraTexto}</p>}
        {comAcoes && editando && (
          <EditarCompraForm
            compra={{ ...compra, id: compra.id }}
            aoSalvar={PosMutacao}
            aoCancelar={() => setEditandoId(null)}
          />
        )}
      </li>
    )
  }

  return (
    <div style={estilos.pagina}>
      <style>{`
        .resumo-grid { display: grid; gap: 0.7rem; }
        @media (min-width: 900px) { .resumo-grid { grid-template-columns: repeat(3, 1fr); } }
      `}</style>
      <Link to="/cartoes" style={estilosComuns.link}>← Cartões</Link>

      {/* Header compacto do cartão */}
      <section style={estilos.header}>
        <div style={estilos.headerLinha}>
          <span style={estilos.headerPill}>{conta?.nome ?? 'Conta'}</span>
          {fatura && (
            <span style={{ ...estilos.statusPill, color: COR_STATUS[status], borderColor: COR_STATUS[status] }}>
              {ROTULO_STATUS[status] ?? status}
            </span>
          )}
        </div>
        <h2 style={estilos.mesTitulo}>{cartao.nome}</h2>
        <p style={estilos.mesSubtitulo}>Fecha dia {cartao.dia_fechamento} · Vence dia {cartao.dia_vencimento}</p>
        {fatura && (
          <p style={estilos.vencimento}>
            Vencimento da fatura: <strong>{formatarData(vencimentoISO(mes, cartao.dia_vencimento))}</strong>
          </p>
        )}
      </section>

      {/* "+ Lançar compra" sempre visível */}
      <button type="button" onClick={() => setComprarAberto((v) => !v)} style={estilos.botaoLancar}>
        {comprarAberto ? 'Cancelar' : '+ Lançar compra'}
      </button>

      {/* Lançamento de compra em modal centralizado (fecha sobre sucesso,
          mantém aberto com mensagem em erro do banco). */}
      <ModalCompra
        aberto={comprarAberto}
        cartaoIdInicial={id}
        aoFechar={() => setComprarAberto(false)}
        aoLancar={async () => {
          await Promise.all([atualizarFaturas(), atualizarItens(), atualizarExtrato()])
        }}
      />

      {/* Cards de resumo — empilha em 1 coluna no mobile, 3 colunas em telas maores */}
      <section className="resumo-grid">
        <div style={estilos.resumoCard}>
          <span style={estilos.rotulo}>Total fatura</span>
          <strong style={estilos.resumoTotal}>{formatoReal.format(total)}</strong>
          <span style={estilos.resumoDetalhe}>{fatura?.n_parcelas ?? 0} parcela(s)</span>
        </div>
        <div style={estilos.resumoCard}>
          <span style={estilos.rotulo}>Já pago</span>
          <strong style={estilos.resumoPago}>{formatoReal.format(jaPago)}</strong>
          <span style={estilos.resumoDetalhe}>aberto {formatoReal.format(restante)}</span>
        </div>
        <div style={estilos.resumoCard}>
          <span style={estilos.rotulo}>Limite disponível</span>
          <strong style={estilos.resumoLimite}>{formatoReal.format(Number(limiteDisponivel ?? 0))}</strong>
          <span style={estilos.resumoDetalhe}>de {formatoReal.format(Number(cartao.limite))}</span>
        </div>
      </section>

      {/* Abas internas */}
      <div style={estilos.abas}>
        <button type="button" onClick={() => setAba('fatura')} style={aba === 'fatura' ? estilos.abaAtiva : estilos.aba}>
          Fatura
        </button>
        <button type="button" onClick={() => setAba('extrato')} style={aba === 'extrato' ? estilos.abaAtiva : estilos.aba}>
          Extrato
        </button>
      </div>

      {aba === 'fatura' ? (
        <>
          {/* Seletor de mês estilo app antigo (‹ ‹ mês › ›) */}
          <div style={estilos.seletorMes}>
            <button type="button" onClick={() => irParaMes(deslocaMes(mes, -1))} style={estilos.mesSeta}>‹</button>
            <select
              value={mes}
              onChange={(e) => irParaMes(e.target.value)}
              style={estilos.mesSeletor}
              aria-label="Mês da fatura"
            >
              {Array.from({ length: 10 }, (_, i) => deslocaMes(mes, i - 3)).map((m) => (
                <option key={m} value={m}>{mesExibicao(m)}</option>
              ))}
            </select>
            <button type="button" onClick={() => irParaMes(deslocaMes(mes, 1))} style={estilos.mesSeta}>›</button>
          </div>

          {/* Tabela no estilo extrato do app antigo */}
          <section style={estilos.tabelaCaixa}>
            <div style={estilos.linhaCabec}>
              <span>Data</span>
              <span>Descrição</span>
              <span>Parc.</span>
              <span>Valor</span>
            </div>

            {itensCarregando && <p style={estilosComuns.mensagem}>Carregando itens...</p>}
            {itensErro && <p style={estilosComuns.erro}>Não foi possível carregar os itens: {itensErro}</p>}
            {!itensCarregando && !itensErro && itens.length === 0 && pagamentos.length === 0 && (
              <p style={estilos.vazio}>Nenhum lançamento nesta fatura.</p>
            )}

            {!itensCarregando && !itensErro && itens.length > 0 && (
              <ul style={estilos.listaTabela}>
                {itens.map((p) => linhaFatura(p, { comAcoes: false }))}
              </ul>
            )}

            {pagamentos.length > 0 && (
              <div style={estilos.pagamentos}>
                <h4 style={estilos.pagamentosTitulo}>Pagamentos desta fatura</h4>
                <ul style={estilos.listaPagamentos}>
                  {pagamentos.map((pg) => (
                    <li key={pg.id} style={estilos.linhaPagamento}>
                      <span style={estilosComuns.tipoConta}>{formatarData(pg.data_pagamento)}</span>
                      <span style={estilosComuns.valorEntrada}>− {formatoReal.format(Number(pg.valor_pago))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Rodapé: totais da fatura */}
          <section style={estilos.totalRodape}>
            <div style={estilos.totalLinha}>
              <span>Total da fatura</span>
              <strong style={estilos.totalValor}>{formatoReal.format(total)}</strong>
            </div>
            <div style={estilos.totalLinha}>
              <span style={estilosComuns.mensagem}>Já pago</span>
              <span style={estilosComuns.valorEntrada}>{formatoReal.format(jaPago)}</span>
            </div>
            <div style={estilos.totalLinha}>
              <span style={estilosComuns.mensagem}>Em aberto</span>
              <span style={estilosComuns.valorSaida}>{formatoReal.format(restante)}</span>
            </div>
          </section>

          {/* Pagar fatura / Desfazer pagamento / estados */}
          <section style={estilosComuns.secao}>
            <h3 style={estilos.secaoTitulo}>Pagar fatura {mesExibicao(mes)}</h3>
            {fatura && status !== 'paga' ? (
              <form onSubmit={handlePagar} style={estilos.pagarBloco}>
                <p style={estilosComuns.mensagem}>
                  Paga com a conta <strong style={{ color: '#e5e7eb' }}>{conta?.nome ?? '—'}</strong>
                  {temPagamento ? ' (pagamento parcial existente)' : ''}
                </p>
                <div style={estilos.pagarLinha}>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={valorPagamento}
                    onChange={(e) => setValorPagamento(e.target.value)}
                    style={estilosComuns.input}
                    aria-label="Valor do pagamento"
                  />
                  <input
                    type="date"
                    value={dataPagamento}
                    onChange={(e) => setDataPagamento(e.target.value)}
                    style={estilosComuns.input}
                    aria-label="Data do pagamento"
                  />
                </div>
                <button type="submit" disabled={enviando} style={enviando ? estilos.botaoPagarDesabilitado : estilos.botaoPagar}>
                  {enviando ? 'Pagando...' : 'Pagar fatura'}
                </button>
                {temPagamento && (
                  <button type="button" onClick={handleDesfazerPagamento} style={estilos.botaoDesfazer}>
                    Desfazer pagamento
                  </button>
                )}
                {mensagem && (
                  <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
                    {mensagem.texto}
                  </p>
                )}
              </form>
            ) : fatura ? (
              <div style={estilos.pagaBloco}>
                <p style={estilosComuns.mensagemOk}>Fatura {mesExibicao(mes)} já está paga. 🎉</p>
                <button type="button" onClick={handleDesfazerPagamento} style={estilos.botaoDesfazer}>
                  Desfazer pagamento
                </button>
                {mensagem && (
                  <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
                    {mensagem.texto}
                  </p>
                )}
              </div>
            ) : (
              <p style={estilosComuns.mensagem}>Nenhuma fatura para este mês.</p>
            )}
          </section>
        </>
      ) : (
        <section style={estilosComuns.secao}>
          <h2 style={estilos.secaoTitulo}>Extrato do cartão</h2>

          {/* Filtros de período */}
          <div style={estilos.filtroLinha}>
            <button type="button" onClick={() => setPeriodo('mesAtual')} style={periodo === 'mesAtual' ? estilos.filtroAtivo : estilos.filtro}>
              Mês atual
            </button>
            <button type="button" onClick={() => setPeriodo('ultimos3')} style={periodo === 'ultimos3' ? estilos.filtroAtivo : estilos.filtro}>
              Últimos 3 meses
            </button>
            <button type="button" onClick={() => setPeriodo('personalizado')} style={periodo === 'personalizado' ? estilos.filtroAtivo : estilos.filtro}>
              Personalizado
            </button>
          </div>

          {periodo === 'personalizado' && (
            <div style={estilos.filtroDatas}>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                style={estilosComuns.input}
                aria-label="Data inicial"
              />
              <span style={estilos.rotulo}>até</span>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                style={estilosComuns.input}
                aria-label="Data final"
              />
            </div>
          )}

          {periodo === 'personalizado' && (!dataInicio || !dataFim || dataInicio > dataFim) && (
            <p style={estilosComuns.mensagem}>Informe data inicial e final válidas para o extrato.</p>
          )}

          {range && (
            <div style={estilos.tabelaCaixa}>
              <div
                style={{
                  ...estilos.linhaCabec,
                  gridTemplateColumns: '1.4fr 4fr 1fr 1.5fr auto',
                }}
              >
                <span>Data</span>
                <span>Descrição</span>
                <span>Parc.</span>
                <span>Valor</span>
                <span style={estilos.cabecalhoAcoes}>Ações</span>
              </div>
              {extratoCarregando && <p style={estilosComuns.mensagem}>Carregando extrato...</p>}
              {extratoErro && <p style={estilosComuns.erro}>Não foi possível carregar o extrato: {extratoErro}</p>}
              {!extratoCarregando && !extratoErro && extrato.length === 0 && (
                <p style={estilos.vazio}>Nenhum lançamento neste período.</p>
              )}
              {!extratoCarregando && !extratoErro && extrato.length > 0 && (
                <ul style={estilos.listaTabela}>
                  {extrato.map((p) => linhaFatura(p, { comAcoes: true, extraTexto: `Fatura ${p.mes_fatura}` }))}
                </ul>
              )}
            </div>
          )}

          {mensagem && (
            <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
              {mensagem.texto}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

const estilos = {
  // Largura útil do detalhe do cartão: confortável no desktop (~1000px),
  // com margens laterais; no mobile assume a largura da tela com respiro.
  pagina: {
    padding: '1.25rem 1.5rem 4.5rem',
    maxWidth: '1000px',
    margin: '0 auto',
    fontSize: '1rem',
  },
  header: {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '16px',
    padding: '1.2rem 1.3rem',
    margin: '0.9rem 0 1.1rem',
  },
  headerLinha: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  headerPill: {
    color: '#9ca3af',
    fontSize: '0.85rem',
    background: '#0b0f19',
    border: '1px solid #374151',
    borderRadius: '999px',
    padding: '0.3rem 0.8rem',
  },
  statusPill: {
    fontSize: '0.78rem',
    fontWeight: 'bold',
    letterSpacing: '0.04em',
    border: '1px solid',
    borderRadius: '999px',
    padding: '0.3rem 0.8rem',
  },
  mesTitulo: { margin: '0.8rem 0 0.2rem', color: '#e5e7eb', fontSize: '1.6rem', lineHeight: 1.1 },
  mesSubtitulo: { margin: '0', color: '#9ca3af', fontSize: '0.95rem' },
  vencimento: {
    margin: '0.7rem 0 0',
    color: '#cbd5e1',
    fontSize: '0.95rem',
    background: 'rgba(250, 204, 21, 0.08)',
    border: '1px solid rgba(250, 204, 21, 0.25)',
    borderRadius: '10px',
    padding: '0.55rem 0.8rem',
  },
  botaoLancar: {
    width: '100%',
    boxSizing: 'border-box',
    marginBottom: '1.4rem',
    padding: '0.9rem',
    borderRadius: '10px',
    border: '1px dashed #374151',
    background: 'transparent',
    color: '#42A5F5',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '1.05rem',
  },
  resumoCard: {    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '14px',
    padding: '1rem 1.05rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    minWidth: 0,
  },
  resumoTotal: { color: '#e5e7eb', fontSize: '1.5rem', lineHeight: 1.15, wordBreak: 'break-word' },
  resumoPago: { color: '#4ade80', fontSize: '1.5rem', lineHeight: 1.15, wordBreak: 'break-word' },
  resumoLimite: { color: '#42A5F5', fontSize: '1.5rem', lineHeight: 1.15, wordBreak: 'break-word' },
  resumoDetalhe: { color: '#9ca3af', fontSize: '0.9rem' },
  rotulo: { color: '#6b7280', fontSize: '0.85rem' },
  abas: { display: 'flex', gap: '0.6rem', marginBottom: '1.4rem' },
  aba: {
    flex: 1,
    padding: '0.95rem 0.5rem',
    borderRadius: '12px',
    border: '1px solid #374151',
    background: '#0b0f19',
    color: '#9ca3af',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontFamily: 'inherit',
    fontSize: '1.05rem',
  },
  abaAtiva: {
    flex: 1,
    padding: '0.95rem 0.5rem',
    borderRadius: '12px',
    border: '1px solid #42A5F5',
    background: '#42A5F5',
    color: '#0b0f19',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontFamily: 'inherit',
    fontSize: '1.05rem',
  },
  seletorMes: { display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '1.4rem' },
  mesSeta: {
    padding: '0.7rem 1rem',
    borderRadius: '10px',
    border: '1px solid #374151',
    background: '#0b0f19',
    color: '#e5e7eb',
    cursor: 'pointer',
    fontSize: '1.2rem',
    fontFamily: 'inherit',
  },
  mesSeletor: {
    flex: 1,
    padding: '0.7rem 0.5rem',
    borderRadius: '10px',
    border: '1px solid #eab308',
    background: '#eab308',
    color: '#0b0f19',
    fontWeight: 'bold',
    fontSize: '1.1rem',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'center',
  },
  tabelaCaixa: {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '16px',
    overflow: 'hidden',
    marginBottom: '1.4rem',
  },
  linhaCabec: {
    display: 'grid',
    gridTemplateColumns: '16% 52% 14% 18%',
    background: '#0b0f19',
    borderBottom: '1px solid #1f2937',
    padding: '0.8rem 1.1rem',
    color: '#9ca3af',
    fontWeight: 'bold',
    fontSize: '0.95rem',
  },
  listaTabela: { listStyle: 'none', padding: 0, margin: 0 },
  linha: {
    padding: '0.95rem 1.1rem',
    borderBottom: '1px solid #1f2937',
  },
  linhaGrid: {
    display: 'grid',
    gridTemplateColumns: '16% 52% 14% 18%',
    alignItems: 'center',
    gap: '0.4rem',
  },
  celData: { color: '#9ca3af', fontSize: '1rem' },
  celDescricao: {
    color: '#e5e7eb',
    fontWeight: 'bold',
    fontSize: '1.05rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  celParcela: { color: '#93c5fd', fontSize: '1rem', textAlign: 'center' },
  celValor: { color: '#f87171', fontWeight: 'bold', fontSize: '1.05rem', textAlign: 'right', whiteSpace: 'nowrap' },
  celExtra: { margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.85rem' },
  celAcoes: { display: 'flex', gap: '0.3rem', alignItems: 'center', justifyContent: 'flex-end' },
  cabecalhoAcoes: { textAlign: 'right' },
  botaoIcone: {
    background: 'transparent',
    border: '1px solid #374151',
    borderRadius: '6px',
    color: '#9ca3af',
    fontFamily: 'inherit',
    fontSize: '0.78rem',
    lineHeight: 1,
    padding: '0.22rem 0.38rem',
    cursor: 'pointer',
  },
  vazio: { padding: '1.2rem 1rem', color: '#9ca3af' },
  pagamentos: { padding: '0.9rem 1rem', borderTop: '1px dashed #1f2937' },
  pagamentosTitulo: { margin: '0 0 0.5rem', color: '#9ca3af', fontSize: '0.95rem' },
  listaPagamentos: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  linhaPagamento: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  totalRodape: {
    background: '#0b0f19',
    border: '1px solid #1f2937',
    borderRadius: '16px',
    padding: '1.1rem 1.2rem',
    marginBottom: '1.4rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.55rem',
  },
  totalLinha: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  totalValor: { color: '#fde047', fontSize: '1.45rem' },
  secaoTitulo: { margin: '0 0 0.8rem', fontSize: '1.2rem', color: '#e5e7eb' },
  pagarBloco: {
    maxWidth: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.8rem',
    background: 'rgba(74, 222, 128, 0.06)',
    border: '1px solid rgba(74, 222, 128, 0.25)',
    borderRadius: '14px',
    padding: '1.1rem',
  },
  pagaBloco: {
    maxWidth: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.8rem',
    background: 'rgba(74, 222, 128, 0.08)',
    border: '1px solid rgba(74, 222, 128, 0.3)',
    borderRadius: '14px',
    padding: '1.1rem',
  },
  pagarLinha: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.7rem' },
  botaoPagar: {
    width: '100%',
    padding: '0.9rem',
    borderRadius: '12px',
    border: 'none',
    background: '#4ade80',
    color: '#0b0f19',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '1.05rem',
  },
  botaoPagarDesabilitado: {
    width: '100%',
    padding: '0.9rem',
    borderRadius: '12px',
    border: 'none',
    background: '#1f2937',
    color: '#6b7280',
    fontWeight: 'bold',
    cursor: 'not-allowed',
    fontFamily: 'inherit',
    fontSize: '1.05rem',
  },
  botaoDesfazer: {
    width: '100%',
    padding: '0.8rem',
    borderRadius: '12px',
    border: '1px solid #f87171',
    background: 'transparent',
    color: '#f87171',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.95rem',
  },
  filtroLinha: { display: 'flex', gap: '0.6rem', marginBottom: '0.9rem', flexWrap: 'wrap' },
  filtro: {
    padding: '0.6rem 0.9rem',
    borderRadius: '10px',
    border: '1px solid #374151',
    background: '#0b0f19',
    color: '#9ca3af',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.95rem',
  },
  filtroAtivo: {
    padding: '0.6rem 0.9rem',
    borderRadius: '10px',
    border: '1px solid #42A5F5',
    background: '#42A5F5',
    color: '#0b0f19',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontFamily: 'inherit',
    fontSize: '0.95rem',
  },
  filtroDatas: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '0.6rem', alignItems: 'center', marginBottom: '0.9rem' },
}
