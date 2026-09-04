// ============================================================================
// PLANEJAMENTO — helpers e estilos compartilhados pelos componentes internos
// (ETAPA 06/E5-F4). Apenas funções puras de apresentação e objetos de estilo:
// nenhum acesso a dados, nenhum cálculo financeiro (isso é das libs do domínio).
// ============================================================================
// Regras preservadas da E5-E:
//   • comparações de tipo usam 'Entrada'/'Saida' (mesma semântica do banco);
//   • "Disponível" é DERIVADO (estado 'previsto' e data <= hoje), nunca é um
//     estado persistido;
//   • itens cancelados ficam esmaecidos mas legíveis (histórico);
//   • badge n/N identifica parcelas de série.
// ============================================================================

import { semanaIso, inicioDaSemanaIso } from '../../lib/semana.js'

export const RÓTULO_ESTADO = {
  previsto: 'Previsto',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
}

export const ehEntrada = (tipoOp) => tipoOp === 'Entrada'

export const RÓTULO_TIPO = (tipoOp) => (ehEntrada(tipoOp) ? 'Entrada' : 'Saída')

// Rótulos de mês em pt-BR — arrays fixos (sem Intl/locale) para manter a
// apresentação determinística em qualquer ambiente.
export const NOME_MES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export const MES_ABREV = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
]

// Rótulo principal do período visível. Os metadados vêm garantidos por
// periodos.js (definirPeriodo): semana→{ano,semana}, mes→{ano,mes},
// trimestre→{ano,trimestre}, semestre→{ano,semestre}.
export function rotuloTitulo(periodo) {
  if (!periodo) return ''
  if (periodo.tipo === 'semana') return `Semana ${periodo.semana} / ${periodo.ano}`
  if (periodo.tipo === 'mes') return `${NOME_MES[periodo.mes - 1]} / ${periodo.ano}`
  if (periodo.tipo === 'trimestre') return `${periodo.trimestre}º trimestre / ${periodo.ano}`
  if (periodo.tipo === 'semestre') return `${periodo.semestre}º semestre / ${periodo.ano}`
  if (periodo.tipo === 'ano') return `Ano ${periodo.ano}`
  return `${periodo.semestre}º semestre / ${periodo.ano}`
}

// Tag "Disponível" — mesma regra derivada validada na E5-E (nunca persistida).
export const ehDisponivel = (item, dataHoje) =>
  item.estado === 'previsto' && item.data_prevista <= dataHoje

// Tag "Atrasado" — previsto cuja data já passou e ainda não foi lançado nem
// cancelado. A data ORIGINAL é mantida (não posterga sozinho); o indicador
// some ao realizar/cancelar. Aplica-se a qualquer origem (manual, recorrente,
// jornada). Especificamente o item que cairia aqui (data < hoje) também passa
// em ehDisponivel — aqui usamos ESTRITA (data < hoje) para só marcar o passado.
export const ehAtrasado = (item, dataHoje) =>
  item.estado === 'previsto' && String(item.data_prevista) < String(dataHoje)

// Uma ocorrência de origem 'jornada' está RECONCILIADA com o valor real quando
// a semana de trabalho dela já fechou (hoje > domingo da semana de trabalho) —
// naquele ponto o Ponto tem o valor definitivo e a estimativa foi/é substituída.
// Uma semana ainda aberta significa que ainda é só previsão (sem badge).
export const ehAjustadoPonto = (item, dataHoje) => {
  if (item.origem !== 'jornada') return false
  if (item.estado === 'cancelado') return false
  if (!Number.isInteger(item.semana_trabalho) || !Number.isInteger(item.ano_semana_trabalho)) {
    // Origem jornada legada/antiga sem referência guardada: sara é tratada.
    return false
  }
  try {
    const fim = semanaIso(inicioDaSemanaIso(item.ano_semana_trabalho, item.semana_trabalho)).fim
    return String(dataHoje) > String(fim)
  } catch {
    return false
  }
}

// Cor do texto conforme o tipo do lançamento planejado.
export function corTipo(tipoOp) {
  return {
    fontSize: '0.85rem',
    fontWeight: 'bold',
    color: ehEntrada(tipoOp) ? '#4ade80' : '#f87171',
  }
}

// Badge de estado: azul (previsto), verde (realizado), cinza (cancelado).
export function badgeEstado(estado) {
  const base = {
    padding: '0.15rem 0.55rem',
    borderRadius: '999px',
    border: '1px solid',
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  }
  if (estado === 'realizado') {
    return { ...base, color: '#4ade80', borderColor: 'rgba(74, 222, 128, 0.45)' }
  }
  if (estado === 'cancelado') {
    return { ...base, color: '#9ca3af', borderColor: '#374151' }
  }
  return { ...base, color: '#42A5F5', borderColor: 'rgba(66, 165, 245, 0.45)' }
}

// Itens cancelados ficam esmaecidos, mas permanecem legíveis (histórico).
export function conteudoItem(item) {
  return {
    fontWeight: 'bold',
    color: '#e5e7eb',
    opacity: item.estado === 'cancelado' ? 0.55 : 1,
  }
}

// Estilos das linhas de lançamento (desktop = grid; mobile = colunas).
// Copiados da página validada na E5-E — comportamento visual preservado.
export const estilosItem = {
  lista: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  item: { display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto auto', alignItems: 'center', columnGap: '0.9rem', rowGap: '0.35rem', padding: '0.9rem 1.1rem', borderRadius: '10px', background: '#111827', border: '1px solid #1f2937' },
  itemMobile: { display: 'flex', flexDirection: 'column', gap: '0.35rem', padding: '0.9rem 1.1rem', borderRadius: '10px', background: '#111827', border: '1px solid #1f2937' },
  linhaMobileTopo: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' },
  topoDireita: { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' },
  linhaMobileBase: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' },
  data: { color: '#9ca3af', fontSize: '0.85rem', whiteSpace: 'nowrap' },
  valor: { fontWeight: 'bold', whiteSpace: 'nowrap' },
  acoes: { display: 'flex', gap: '0.25rem' },
  botaoAcaoNeutro: { background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '0.25rem 0.4rem', fontSize: '0.85rem' },
  botaoAcaoRealizar: { background: 'transparent', border: 'none', color: '#4ade80', cursor: 'pointer', padding: '0.25rem 0.4rem', fontSize: '0.85rem' },
  botaoAcaoFatura: { background: 'transparent', border: 'none', color: '#a78bfa', cursor: 'pointer', padding: '0.25rem 0.4rem', fontSize: '0.85rem', fontWeight: 'bold' },
  botaoAcaoSerie: { background: 'transparent', border: 'none', color: '#fbbf24', cursor: 'pointer', padding: '0.25rem 0.4rem', fontSize: '0.85rem' },
  botaoAcaoExcluir: { background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.25rem 0.4rem', fontSize: '0.85rem' },
  badgeParcela: { padding: '0.15rem 0.5rem', borderRadius: '6px', background: '#1f2937', color: '#9ca3af', fontSize: '0.72rem', whiteSpace: 'nowrap' },
  // Item de FATURA automática (projeção dinâmica do cartão, não persistida) —
  // tom VIOLETA para distinguir de 'previsto' (azul) e de 'Disponível' (amarelo).
  badgeFatura: { padding: '0.15rem 0.5rem', borderRadius: '999px', background: 'rgba(167, 139, 250, 0.15)', color: '#a78bfa', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' },
  // Fatura PROJETADA (mês futuro com/por previstos de destino cartão): tom
  // VERDE-LIMÃO, sem botão de pagar (só a fatura REAL paga).
  badgeProjecao: { padding: '0.15rem 0.5rem', borderRadius: '999px', background: 'rgba(163, 230, 53, 0.15)', color: '#a3e635', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' },
  badgeDisponivel: { padding: '0.15rem 0.5rem', borderRadius: '999px', background: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' },
  // Previsto com data no PASSADO ainda não lançado/cancelado — tom VERMELHO
  // (alerta), distinto do coral do "Ajustado pelo Ponto" (#fb923c) para não
  // confundir atraso com ajuste de valor.
  badgeAtrasado: { padding: '0.15rem 0.5rem', borderRadius: '999px', background: 'rgba(248, 113, 113, 0.15)', color: '#f87171', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' },
  // Marcador de FÉRIAS (sintético, R$ 0, aviso de data futura) — tom CIANO,
  // distinto de fatura (violeta) / projeção (verde-limão) / cartão (azul).
  badgeFerias: { padding: '0.15rem 0.5rem', borderRadius: '999px', background: 'rgba(34, 211, 238, 0.15)', color: '#22d3ee', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' },
  // Férias não são lançáveis/edítáveis/excluíveis — rótulo inerte (valor 0).
  textoFerias: { color: '#22d3ee', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'default', whiteSpace: 'nowrap' },
  // Destino padrão planejado (cartão) em item ainda PREVISTO — tom AZUL, para
  // deixar claro que é intenção (não efetivado), diferente do badge de compra
  // já lançada e do "Disponível" (amarelo).
  badgeDestinoCartao: { padding: '0.15rem 0.5rem', borderRadius: '999px', background: 'rgba(66, 165, 245, 0.15)', color: '#42A5F5', fontSize: '0.7rem', letterSpacing: '0.04em', whiteSpace: 'nowrap' },
  // Ocorrência VINCULADA AO PONTO e já reconciliada — o valor exibido não é
  // mais a estimativa da série, é o valor REAL fechado (fixo + HE + dom/fer).
  // Tom CORAL/LARANJA, distinto de fatura (violeta), projeção (verde-limão),
  // férias (ciano), disponível (amarelo) e previsto (azul).
  badgeJornada: { padding: '0.15rem 0.5rem', borderRadius: '999px', background: 'rgba(251, 146, 60, 0.15)', color: '#fb923c', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' },
}
