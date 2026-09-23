// ============================================================================
// ABA "CONSUMOS" (Relatórios)
// ============================================================================
// Histórico de água/gás de condominio_consumo_mensal por mês do CONSUMO
// (mês gravado − 1 pela defasagem leitura × cobrança, ver consumoMensalCalc).
// Segue o ESPÍRITO do padrão resumo → gráfico → lista, mas com componentes
// próprios: o RelatorioTemplate compartilhado só faz barras, e estendê-lo
// para linha/sparkline seria o risco de regressão nas outras abas. Mesmos
// tokens visuais (#111827, #42A5F5, etc.).
//
// Seletores multi independentes acima do gráfico: TIPO (Água, Gás) e MÉTRICA
// (Valor pago, Consumo, R$/m³). Regra de plotagem:
//   • UMA métrica (um ou dois tipos) → valores BRUTOS (mesma unidade: m³ é
//     m³, R$ é R$, R$/m³ é R$/m³ — comparar água × gás direto faz sentido);
//   • 2+ métricas → cada série INDEXADA em % sobre seu primeiro valor
//     (primeiro mês = 0%), no mesmo eixo Y em % (unidades divergentes).
// Linha: TIPO define o matiz (azul Água, laranja Gás); MÉTRICA define o
// traço (sólida Valor, tracejada Consumo, pontilhada R$/m³); legenda com as
// duas dimensões. Resumos: um bloco por tipo lado a lado (nunca soma água
// com gás). Os mini cards iniciais são atalho: clicar marca o tipo e abre o
// detalhe; clicar outro card com o detalhe aberto ADICIONA o tipo.
// ============================================================================

import { useMemo } from 'react'
import { estilosComuns, formatoReal } from '../../lib/compartilhados'
import {
  COR_TIPO_CONSUMO,
  ROTULO_TIPO_CONSUMO,
  TIPOS_CONSUMO_VISIVEIS,
  corSerieConsumo,
  formatarM3,
  formatarVariacao,
  normalizarIndice,
  resumoTipo,
  rotuloMes,
  valorMetrica,
} from '../../lib/consumoMensalCalc'
import { useRelatorioConsumos } from '../../hooks/useRelatorioConsumos'
import { geometriaLinha } from '../../lib/graficoLinha'

const METRICAS = [
  { chave: 'valor', rotulo: 'Valor pago (R$)', traco: 'solido' },
  { chave: 'consumo', rotulo: 'Consumo (m³)', traco: 'tracejado' },
  { chave: 'm3', rotulo: 'R$ por m³', traco: 'pontilhado' },
]

const TRACO_SVG = {
  solido: undefined,
  tracejado: '7 5',
  pontilhado: '2 4',
}

function textoBruto(valor, metrica) {
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return '—'
  if (metrica === 'consumo') return formatarM3(valor)
  if (metrica === 'm3') return `${formatoReal.format(Number(valor))}/m³`
  return formatoReal.format(Number(valor))
}

// Gráfico de linhas multi-série (eixo X = união dos meses, ordenado).
// series: [{ chave, rotulo, cor, traco, pontos: [{ mes, valor }] }] — valor
// null quebra a linha, nunca zera. compacto = sparkline (sem eixos/pontos).
function Grafico({ series, fmtY, compacto = false, rotulos = null }) {
  const W = 600
  const H = compacto ? 64 : 190
  const PAD_Y = compacto ? 6 : 22
  const PAD_X = compacto ? 4 : 26

  // Mesma geometria do PDF vetorial (graficoLinha.js) — um só cálculo.
  const geo = useMemo(
    () => geometriaLinha({ series, W, H, padX: PAD_X, padY: PAD_Y }),
    [series, W, H, PAD_X, PAD_Y],
  )
  if (!geo) return null
  const { meses, min, max, x, segmentos } = geo

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label="Evolução dos consumos"
    >
      {segmentos.flatMap(({ serie, segs }) =>
        segs.map((seg, i) => (
          <polyline
            key={`${serie.chave}-${i}`}
            points={seg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill="none"
            stroke={serie.cor}
            strokeWidth={compacto ? 2 : 2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={compacto ? undefined : TRACO_SVG[serie.traco]}
          />
        )),
      )}
      {!compacto &&
        segmentos.flatMap(({ serie, segs }) =>
          segs.flatMap((seg) =>
            seg.flatMap((p) => [
              <circle key={`${serie.chave}-${p.mes}`} cx={p.x} cy={p.y} r="3.5" fill={serie.cor} />,
              // Rótulo só nas métricas marcadas em "Rótulos" (null = sparkline).
              ...(rotulos !== null && rotulos.includes(serie.metrica)
                ? [
                    <text
                      key={`${serie.chave}-${p.mes}-v`}
                      x={p.x}
                      y={p.y - 7}
                      textAnchor="middle"
                      style={{ ...estilos.textoEixo, ...estilos.textoValor, fill: serie.cor }}
                    >
                      {fmtY(p.valor)}
                    </text>,
                  ]
                : []),
            ]),
          ),
        )}
      {!compacto && (
        <>
          <text x={W - 4} y={PAD_Y - 6} textAnchor="end" style={estilos.textoEixo}>
            {fmtY(max)}
          </text>
          <text x={W - 4} y={H - 2} textAnchor="end" style={estilos.textoEixo}>
            {fmtY(min)}
          </text>
          {meses.map((m) => (
            <text key={m} x={x(m)} y={H - 2} textAnchor="middle" style={estilos.textoEixo}>
              {rotuloMes(m)}
            </text>
          ))}
        </>
      )}
    </svg>
  )
}

function MiniCardTipo({ tipo, serie, selecionado, aoSelecionar }) {
  const { ultimo, variacao } = resumoTipo(serie)
  const cor = COR_TIPO_CONSUMO[tipo] ?? '#42A5F5'
  const nome = ROTULO_TIPO_CONSUMO[tipo] ?? tipo
  // Sem dado no período: estado vazio EXPLÍCITO (nunca some silenciosamente).
  // Não é clicável — não há detalhe a mostrar.
  if (!ultimo) {
    return (
      <div style={{ ...estilos.miniCard, ...estilos.miniCardVazio }} aria-label={`${nome}: sem leitura registrada`}>
        <div style={estilos.miniCardTopo}>
          <span style={{ ...estilos.miniCardNome, color: cor }}>{nome}</span>
        </div>
        <div style={estilos.miniCardVazioTexto}>sem leitura de {nome} registrada ainda</div>
      </div>
    )
  }
  const corVar = variacao === null ? '#9ca3af' : variacao > 0 ? '#EF4444' : variacao < 0 ? '#22C55E' : '#9ca3af'
  return (
    <button
      type="button"
      onClick={aoSelecionar}
      aria-pressed={selecionado}
      title={selecionado ? 'Remover este tipo da seleção' : `Ver detalhe de ${nome}`}
      style={{ ...estilos.miniCard, ...(selecionado ? estilos.miniCardAtivo : {}) }}
    >
      <div style={estilos.miniCardTopo}>
        <span style={{ ...estilos.miniCardNome, color: cor }}>{ROTULO_TIPO_CONSUMO[tipo] ?? tipo}</span>
        {selecionado && <span style={estilos.miniCardAtivoTag}>selecionado</span>}
      </div>
      <div style={estilos.miniCardValor}>{ultimo ? formatarM3(ultimo.consumo) : '—'}</div>
      <div style={estilos.miniCardSub}>
        {ultimo ? `em ${rotuloMes(ultimo.mes)}` : 'sem leituras no período'}
        {variacao !== null && (
          <span style={{ color: corVar, fontWeight: 600 }}> · {formatarVariacao(variacao)}</span>
        )}
      </div>
      {serie.length > 1 && (
        <div style={estilos.spark}>
          <Grafico
            series={[{ chave: tipo, cor, traco: 'solido', pontos: serie.map((p) => ({ mes: p.mes, valor: p.consumo })) }]}
            fmtY={(v) => formatarM3(v)}
            compacto
          />
        </div>
      )}
    </button>
  )
}

function ResumoTipo({ tipo, serie }) {
  const { ultimo, variacao } = resumoTipo(serie)
  const cor = COR_TIPO_CONSUMO[tipo] ?? '#42A5F5'
  if (!ultimo) return null
  return (
    <div>
      <div style={{ ...estilos.rotuloCard, color: cor, fontWeight: 700 }}>
        {ROTULO_TIPO_CONSUMO[tipo] ?? tipo}
      </div>
      <div style={estilos.rotuloCard}>Consumo em {rotuloMes(ultimo.mes)}</div>
      <div style={{ ...estilos.valorCard, color: cor }}>
        {formatarM3(ultimo.consumo)}
        {variacao !== null && (
          <span style={{ ...estilos.variacaoCard, color: variacao > 0 ? '#EF4444' : variacao < 0 ? '#22C55E' : '#9ca3af' }}>
            {' '}{formatarVariacao(variacao)}
          </span>
        )}
      </div>
      <div style={{ ...estilos.rotuloCard, marginTop: '0.5rem' }}>Valor pago no mês</div>
      <div style={estilos.valorCard}>{formatoReal.format(Number(ultimo.valor))}</div>
      <div style={{ ...estilos.rotuloCard, marginTop: '0.5rem' }}>Valor por m³ no mês</div>
      <div style={estilos.valorCard}>
        {ultimo.valorM3 !== null ? `${formatoReal.format(Number(ultimo.valorM3))}/m³` : '—'}
      </div>
    </div>
  )
}

function alternar(lista, valor) {
  return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor]
}

export default function AbaConsumos({
  periodo,
  tiposSel = [],
  aoTrocarTipos,
  metricasSel = ['valor'],
  aoTrocarMetricas,
  rotulosSel = [],
  aoTrocarRotulos,
}) {
  const { carregando, erro, porTipo } = useRelatorioConsumos(periodo)
  // Seleção elevada à página (Relatórios usa a mesma no Exportar PDF).
  // Os callbacks recebem a lista nova pronta (não updater).
  const trocarTipos = (t) => (aoTrocarTipos ?? (() => {}))(alternar(tiposSel, t))
  const trocarMetricas = (m) => (aoTrocarMetricas ?? (() => {}))(alternar(metricasSel, m))
  const trocarRotulos = (m) => (aoTrocarRotulos ?? (() => {}))(alternar(rotulosSel, m))

  const tiposComDados = useMemo(
    () => TIPOS_CONSUMO_VISIVEIS.filter((t) => Array.isArray(porTipo[t]) && porTipo[t].length > 0),
    [porTipo],
  )
  const tiposVisiveis = tiposSel.filter((t) => tiposComDados.includes(t))
  const detalheAberto = tiposVisiveis.length > 0

  // UMA métrica → valores brutos; 2+ → cada série indexada em % na mesma base.
  const indexado = metricasSel.length > 1
  const metricaUnica = metricasSel.length === 1 ? metricasSel[0] : null
  const seriesGrafico = useMemo(() => {
    const out = []
    for (const tipo of tiposVisiveis) {
      const serie = porTipo[tipo] ?? []
      for (const metrica of metricasSel) {
        const m = METRICAS.find((x) => x.chave === metrica)
        if (!m) continue
        const pontos = indexado
          ? normalizarIndice(serie, metrica).map((p) => ({ mes: p.mes, valor: p.pct }))
          : serie.map((p) => ({ mes: p.mes, valor: valorMetrica(p, metrica) }))
        out.push({
          chave: `${tipo}-${metrica}`,
          rotulo: `${ROTULO_TIPO_CONSUMO[tipo] ?? tipo} · ${m.rotulo}`,
          cor: corSerieConsumo(tipo, metrica),
          traco: m.traco,
          metrica,
          pontos,
        })
      }
    }
    return out
  }, [tiposVisiveis, metricasSel, porTipo, indexado])
  const fmtY = indexado
    ? (v) => formatarVariacao(v)
    : (v) => {
        if (!Number.isFinite(Number(v))) return '—'
        if (metricaUnica === 'consumo') return formatarM3(v)
        if (metricaUnica === 'm3') return `${formatoReal.format(Number(v))}/m³`
        return formatoReal.format(Number(v))
      }

  if (!periodo?.inicio || !periodo?.fim) {
    return <p style={estilos.aviso}>Defina um período válido para ver os consumos.</p>
  }
  if (carregando) {
    return <p style={estilosComuns.mensagem}>Carregando consumos…</p>
  }
  if (erro) {
    return <p style={estilos.erro}>{erro}</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      {/* Atalho + RESUMO por tipo (mini cards, sem comparativo em volume).
          Todos os tipos sempre renderizam: sem dado, card vazio explícito. */}
      <section aria-label="Resumo por tipo">
        {tiposComDados.length === 0 && Object.keys(porTipo).length === 0 ? (
          <div style={estilos.semDados}>
            <p style={{ ...estilosComuns.mensagem, margin: 0 }}>Sem leituras neste período.</p>
          </div>
        ) : (
          <div style={estilos.gradeTipos}>
            {TIPOS_CONSUMO_VISIVEIS.map((t) => (
              <MiniCardTipo
                key={t}
                tipo={t}
                serie={porTipo[t] ?? []}
                selecionado={tiposSel.includes(t)}
                aoSelecionar={() => trocarTipos(t)}
              />
            ))}
          </div>
        )}
      </section>

      {detalheAberto && (
        <>
          {/* RESUMOS — um bloco por tipo lado a lado (nunca soma água + gás) */}
          <section aria-label="Resumo dos tipos" style={estilos.cardSecao}>
            <div style={estilos.gradeResumo}>
              {tiposVisiveis.map((t) => (
                <ResumoTipo key={t} tipo={t} serie={porTipo[t] ?? []} />
              ))}
            </div>
          </section>

          <section aria-label="Gráfico" style={estilos.cardSecao}>
            <div style={estilos.seletorMetrica} role="group" aria-label="Tipos no gráfico">
              {tiposComDados.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tiposSel.includes(t)}
                  onClick={() => trocarTipos(t)}
                  style={{ ...estilos.pilula, ...(tiposSel.includes(t) ? estilos.pilulaAtiva : {}) }}
                >
                  {ROTULO_TIPO_CONSUMO[t] ?? t}
                </button>
              ))}
            </div>
            <div style={estilos.seletorMetrica} role="group" aria-label="Métricas no gráfico">
              {METRICAS.map((m) => (
                <button
                  key={m.chave}
                  type="button"
                  aria-pressed={metricasSel.includes(m.chave)}
                  onClick={() => trocarMetricas(m.chave)}
                  style={{ ...estilos.pilula, ...(metricasSel.includes(m.chave) ? estilos.pilulaAtiva : {}) }}
                >
                  {m.rotulo}
                </button>
              ))}
            </div>
            <div style={estilos.seletorMetrica} role="group" aria-label="Rótulos de valor nos pontos">
              <span style={estilos.rotuloSeletor}>Rótulos:</span>
              {METRICAS.map((m) => (
                <button
                  key={m.chave}
                  type="button"
                  aria-pressed={rotulosSel.includes(m.chave)}
                  onClick={() => trocarRotulos(m.chave)}
                  title={`Mostrar valores de ${m.rotulo} nos pontos`}
                  style={{ ...estilos.pilula, ...(rotulosSel.includes(m.chave) ? estilos.pilulaAtiva : {}) }}
                >
                  {m.rotulo}
                </button>
              ))}
            </div>
            {metricasSel.length === 0 ? (
              <p style={{ ...estilosComuns.mensagem, margin: 0 }}>Marque ao menos uma métrica.</p>
            ) : (
              <>
                <Grafico series={seriesGrafico} fmtY={fmtY} rotulos={rotulosSel} />
                <div style={estilos.legenda}>
                  {seriesGrafico.map((s) => (
                    <span key={s.chave} style={estilos.itemLegenda}>
                      <svg width="26" height="8" aria-hidden="true">
                        <line
                          x1="0" y1="4" x2="26" y2="4"
                          stroke={s.cor}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeDasharray={TRACO_SVG[s.traco]}
                        />
                      </svg>
                      {s.rotulo}
                    </span>
                  ))}
                </div>
                {indexado && (
                  <p style={estilos.notaIndice}>Séries indexadas em % sobre o primeiro mês exibido (0%).</p>
                )}
              </>
            )}
          </section>

          {/* LISTAS — uma por tipo, reusando as séries (sem query nova) */}
          {tiposVisiveis.map((t) => (
            <section key={t} aria-label={`Detalhe mensal de ${ROTULO_TIPO_CONSUMO[t] ?? t}`} style={estilos.cardSecao}>
              <div style={{ ...estilos.tituloLista, color: COR_TIPO_CONSUMO[t] ?? '#42A5F5' }}>
                {ROTULO_TIPO_CONSUMO[t] ?? t} — mês a mês
              </div>
              {(porTipo[t] ?? []).map((p, i, arr) => (
                <div
                  key={p.mes}
                  style={{ ...estilos.linhaMeses, ...(i === arr.length - 1 ? estilos.linhaUltima : {}) }}
                >
                  <span style={estilos.celulaMes}>{rotuloMes(p.mes)}</span>
                  <span style={estilos.celula}>
                    ant. <strong style={estilos.num}>{formatarM3(p.leituraAnterior).replace(' m³', '')}</strong>
                  </span>
                  <span style={estilos.celula}>
                    atual <strong style={estilos.num}>{formatarM3(p.leituraAtual).replace(' m³', '')}</strong>
                  </span>
                  <span style={estilos.celula}>
                    <strong style={estilos.num}>{formatarM3(p.consumo)}</strong>
                  </span>
                  <span style={estilos.celula}>
                    <strong style={estilos.num}>{formatoReal.format(Number(p.valor))}</strong>
                  </span>
                  <span style={estilos.celula}>
                    {p.valorM3 !== null ? `${formatoReal.format(Number(p.valorM3))}/m³` : '—'}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  )
}

const estilos = {
  aviso: { color: '#f87171', fontSize: '0.85rem' },
  erro: { color: '#ef4444', fontSize: '0.85rem' },
  semDados: {
    background: '#111827',
    border: '1px dashed #374151',
    borderRadius: '10px',
    padding: '1.2rem 1rem',
    textAlign: 'center',
  },
  gradeTipos: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '0.9rem',
  },
  miniCard: {
    background: '#111827',
    borderRadius: '10px',
    border: '1px solid #1f2937',
    padding: '0.9rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    width: '100%',
  },
  miniCardAtivo: { border: '1px solid rgba(66, 165, 245, 0.45)', background: '#16202e' },
  miniCardVazio: { border: '1px dashed #374151', cursor: 'default' },
  miniCardVazioTexto: { color: '#6b7280', fontSize: '0.82rem', fontStyle: 'italic' },
  miniCardTopo: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  miniCardNome: { fontWeight: 700, fontSize: '0.95rem' },
  miniCardAtivoTag: { color: '#42A5F5', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' },
  miniCardValor: { fontWeight: 700, fontSize: '1.3rem', color: '#e5e7eb', fontVariantNumeric: 'tabular-nums' },
  miniCardSub: { color: '#9ca3af', fontSize: '0.8rem' },
  spark: { marginTop: '0.35rem' },
  cardSecao: { background: '#111827', borderRadius: '10px', padding: '0.9rem 1rem' },
  gradeResumo: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '0.9rem',
  },
  rotuloCard: { color: '#9ca3af', fontSize: '0.8rem' },
  valorCard: { fontWeight: 700, fontSize: '1.15rem', fontVariantNumeric: 'tabular-nums' },
  variacaoCard: { fontWeight: 600, fontSize: '0.9rem' },
  seletorMetrica: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.7rem', alignItems: 'center' },
  rotuloSeletor: { color: '#6b7280', fontSize: '0.8rem' },
  pilula: {
    padding: '0.35rem 0.9rem',
    borderRadius: '999px',
    border: '1px solid #374151',
    background: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontFamily: 'inherit',
  },
  // Experimento 23/09: selecionado = fundo azul + texto preto; não
  // selecionado = o oposto (fundo transparente + texto cinza).
  pilulaAtiva: { background: '#42A5F5', borderColor: '#42A5F5', color: '#0b0f19', fontWeight: 600 },
  textoEixo: { fontSize: '11px', fill: '#6b7280' },
  textoValor: { fontSize: '9px', fontWeight: 600 },
  legenda: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem', marginTop: '0.5rem' },
  itemLegenda: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#9ca3af', fontSize: '0.78rem' },
  notaIndice: { color: '#6b7280', fontSize: '0.75rem', margin: '0.4rem 0 0' },
  tituloLista: { fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.2rem' },
  linhaMeses: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '0.2rem 0.9rem',
    padding: '0.7rem 0',
    borderBottom: '1px solid #1f2937',
    fontSize: '0.9rem',
  },
  linhaUltima: { borderBottom: 'none' },
  celulaMes: { color: '#e5e7eb', fontWeight: 600, minWidth: '52px' },
  celula: { color: '#9ca3af' },
  num: { color: '#e5e7eb', fontVariantNumeric: 'tabular-nums' },
}
