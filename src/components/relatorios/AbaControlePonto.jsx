// ============================================================================
// ABA "CONTROLE DE PONTO" (Relatórios) — espelho dia a dia, SOMENTE LEITURA
// ============================================================================
// Usa o RelatorioTemplate compartilhado (resumo → lista) SEM mudar seu
// comportamento: resumo via cards + detalhes custom (tabela dia a dia,
// blocos semanais de R$ e bloco do banco); gráfico desligado pela prop
// aditiva `semGrafico` (default off — as outras abas intactas).
// Campos de hora e de R$ viajam separados no motor (futuro "somente horas"
// = esconder colunas).
// ============================================================================

import { estilosComuns, formatoReal } from '../../lib/compartilhados'
import { formatarDuracaoHMin } from '../../lib/pontoCalc'
import RelatorioTemplate from './RelatorioTemplate'
import { useRelatorioControlePonto } from '../../hooks/useRelatorioControlePonto'

// Minutos que entraram/saíram do banco NESTE dia (he/domfer-banco em horas,
// falta-banco em minutos); '—' quando nada transitou.
function txtBancoDia(d) {
  if (d.situacao === 'he-banco' || d.situacao === 'domfer-banco') {
    return formatarDuracaoHMin(Math.round(d.bancoHoras * 60))
  }
  if (d.situacao === 'falta-banco') {
    return formatarDuracaoHMin(d.faltaMinutos)
  }
  return '—'
}

const DESTINO_ROTULO = {
  pagamento: 'pagamento',
  banco: 'banco',
  abonada: 'abonada',
}

function rotuloFalta(d) {
  return `Falta (${d.faltaIntegral ? 'integral' : 'parcial'}) · ${DESTINO_ROTULO[d.faltaDestino] ?? d.faltaDestino}`;
}

function rotuloExtra(d) {
  const base = d.situacao === 'he-pagamento' || d.situacao === 'he-banco'
    ? `HE (${d.situacao === 'he-banco' ? 'banco' : 'pagamento'})`
    : `Dom/fer (${d.situacao === 'domfer-banco' ? 'banco' : 'pagamento'})`;
  return d.agendada ? `${base} · agendada` : base;
}

function rotuloData(dataISO) {
  return `${dataISO.slice(8, 10)}/${dataISO.slice(5, 7)}`
}

export default function AbaControlePonto({ periodo }) {
  const { carregando, erro, dados } = useRelatorioControlePonto(periodo)

  if (!periodo?.inicio || !periodo?.fim) {
    return <p style={estilos.aviso}>Defina um período válido para ver o controle de ponto.</p>
  }
  if (carregando) return <p style={estilosComuns.mensagem}>Carregando controle de ponto…</p>
  if (erro) return <p style={estilos.erro}>{erro}</p>
  if (!dados || dados.dias.length === 0) return <p style={estilosComuns.mensagem}>Sem dias no período.</p>

  const { dias, resumo, banco } = dados
  const r = resumo
  const pctCarga = r.carga.pct !== null && r.carga.pct !== undefined
    ? `${r.carga.pct.toFixed(1).replace('.', ',')}%`
    : '—'
  const faltasHorasMin = r.faltas.pagamento.minutos + r.faltas.banco.minutos + r.faltas.abonada.minutos

  const cards = [
    {
      label: 'Carga cumprida',
      valor: `${r.carga.cumprida}h de ${r.carga.prevista}h (${pctCarga})`,
      cor: '#4ade80',
    },
    {
      label: `Faltas (pag/bco/abon)`,
      valor: `${r.faltas.pagamento.qtd}/${r.faltas.banco.qtd}/${r.faltas.abonada.qtd} · ${formatarDuracaoHMin(faltasHorasMin)}`,
    },
    { label: 'HE pagas', valor: `${r.hePagasHoras}h · ${formatoReal.format(r.hePagasValor)}` },
    { label: 'Dom/fer pagos', valor: `${r.domferPagosDias} dia(s) · ${formatoReal.format(r.domferPagosValor)}` },
    {
      label: `Banco (início ${formatarDuracaoHMin(banco.saldoInicio)})`,
      valor: `${formatarDuracaoHMin(banco.saldoFim)} (${banco.variacao >= 0 ? '+' : ''}${formatarDuracaoHMin(banco.variacao)})`,
    },
  ]

  const faltasLista = dias.filter((d) => String(d.situacao).startsWith('falta-'))
  const extrasLista = dias.filter(
    (d) => d.situacao === 'he-pagamento' || d.situacao === 'he-banco' || d.situacao === 'domfer-pagamento' || d.situacao === 'domfer-banco',
  )

  const detalhes = (
    <div style={estilos.detalhes}>
      <div style={estilos.blocoTitulo}>Faltas do período</div>
      {faltasLista.length === 0 && (
        <div style={estilos.linha}>
          <span style={estilos.celula}>nenhuma falta no período</span>
        </div>
      )}
      {faltasLista.map((d) => (
        <div key={d.data} style={estilos.linha}>
          <span style={{ ...estilos.celula, ...estilos.celulaData }}>
            {rotuloData(d.data)} {d.diaSemana}
          </span>
          <span style={estilos.celula}>{rotuloFalta(d)}</span>
          <span style={estilos.celula}>{formatarDuracaoHMin(d.faltaMinutos)}</span>
          {d.faltaDestino === 'banco' && (
            <span style={banco.fifoPorData.get(d.data) === 'compensada' ? estilos.ok : estilos.pendente}>
              {banco.fifoPorData.get(d.data) === 'compensada' ? 'Compensada' : 'Pendente'}
            </span>
          )}
          {d.agendada && <span style={estilos.agendada}>agendada</span>}
          {d.obs && <span style={estilos.celulaObs}>{d.obs}</span>}
        </div>
      ))}

      <div style={estilos.blocoTitulo}>Horas extras do período</div>
      {extrasLista.length === 0 && (
        <div style={estilos.linha}>
          <span style={estilos.celula}>nenhuma hora extra no período</span>
        </div>
      )}
      {extrasLista.map((d) => {
        const pago = d.situacao === 'he-pagamento' || d.situacao === 'domfer-pagamento'
        const horasTxt = d.situacao === 'he-pagamento' || d.situacao === 'he-banco'
          ? `${d.situacao === 'he-pagamento' ? d.hePagaHoras : d.bancoHoras}h`
          : `${Number(d.horas || 0).toFixed(2).replace('.', ',')}h`
        const valorTxt = pago
          ? formatoReal.format((d.hePagaValor || 0) + (d.domferValor || 0))
          : '—'
        return (
          <div key={d.data} style={estilos.linha}>
            <span style={{ ...estilos.celula, ...estilos.celulaData }}>
              {rotuloData(d.data)} {d.diaSemana}
            </span>
            <span style={estilos.celula}>{rotuloExtra(d)}</span>
            <span style={estilos.celula}>
              {d.entrada && d.saida ? `${d.entrada}→${d.saida}` : '—'}
            </span>
            <span style={estilos.celula}>{horasTxt}</span>
            <span style={estilos.celula}>{valorTxt}</span>
            {d.agendada && <span style={estilos.agendada}>agendada</span>}
            {d.obs && <span style={estilos.celulaObs}>{d.obs}</span>}
          </div>
        )
      })}
    </div>
  )

  return <RelatorioTemplate cards={cards} grafico={null} linhas={[]} detalhes={detalhes} semGrafico />
}

const estilos = {
  aviso: { color: '#f87171', fontSize: '0.85rem' },
  erro: { color: '#ef4444', fontSize: '0.85rem' },
  detalhes: { display: 'flex', flexDirection: 'column' },
  linha: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '0.2rem 0.9rem',
    padding: '0.7rem 0',
    borderBottom: '1px solid #1f2937',
    fontSize: '0.9rem',
  },
  celula: { color: '#9ca3af' },
  celulaData: { color: '#e5e7eb', fontWeight: 600, minWidth: '86px' },
  celulaObs: { color: '#6b7280', fontSize: '0.8rem', flexBasis: '100%' },
  apagado: { color: '#6b7280' },
  blocoTitulo: { fontWeight: 700, fontSize: '0.9rem', color: '#e5e7eb', marginTop: '0.9rem' },
  agendada: {
    padding: '0.15rem 0.55rem',
    borderRadius: '999px',
    background: 'rgba(66, 165, 245, 0.15)',
    color: '#42A5F5',
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  },
  ok: { color: '#4ade80', fontSize: '0.8rem', fontWeight: 600 },
  pendente: { color: '#f59e0b', fontSize: '0.8rem', fontWeight: 600 },
}
