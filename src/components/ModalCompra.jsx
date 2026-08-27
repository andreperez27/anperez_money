import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import CompraForm from './CompraForm'

// Modal centralizado para lançar compra/despesa no cartão.
//
// Renderizado via createPortal no <body>, fora do contexto transformado/
// com overflow do CaberNaTela — assim o overlay cobre a tela inteira (a
// barra do Windows não corta o formulário e a lista fica ao fundo, sem o
// form "grudado" no rodapé).
//
// Props:
//   - aberto: controla a exibição.
//   - cartaoIdInicial: cartão pré-selecionado (vem de um cartão específico).
//   - aoFechar: fecha o modal (Cancelar, X, Esc ou clique no overlay).
//   - aoLancar: callback após uma compra bem-sucedida (atualiza tela);
//     o modal só fecha quando essa callback roda, então em erro do banco o
//     formulário permanece aberto com a mensagem visível.
//   - titulo: cabeçalho do modal (default "Lançar compra").
export default function ModalCompra({
  aberto,
  cartaoIdInicial = '',
  aoFechar,
  aoLancar,
  titulo = 'Lançar compra',
}) {
  useEffect(() => {
    if (!aberto) return
    function aoTeclado(e) {
      if (e.key === 'Escape') aoFechar()
    }
    window.addEventListener('keydown', aoTeclado)
    return () => window.removeEventListener('keydown', aoTeclado)
  }, [aberto, aoFechar])

  if (!aberto || typeof document === 'undefined') return null

  return createPortal(
    <div style={estilos.overlay} onClick={aoFechar}>
      <div
        style={estilos.painel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <div style={estilos.cabecalho}>
          <h3 style={estilos.titulo}>{titulo}</h3>
          <button type="button" onClick={aoFechar} style={estilos.fechar} aria-label="Fechar">
            ✕
          </button>
        </div>

        <CompraForm
          cartaoIdInicial={cartaoIdInicial}
          aoLancar={() => {
            if (aoLancar) aoLancar()
            aoFechar()
          }}
        />

        <button type="button" onClick={aoFechar} style={estilos.cancelar}>
          Cancelar
        </button>
      </div>
    </div>,
    document.body,
  )
}

const estilos = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
    zIndex: 1000,
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  painel: {
    width: '100%',
    maxWidth: '520px',
    maxHeight: '90vh',
    overflowY: 'auto',
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '18px',
    padding: '1.3rem 1.4rem',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.9rem',
  },
  cabecalho: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.5rem',
  },
  titulo: { margin: 0, color: '#e5e7eb', fontSize: '1.25rem' },
  fechar: {
    background: 'transparent',
    border: '1px solid #374151',
    borderRadius: '8px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    lineHeight: 1,
    padding: '0.45rem 0.6rem',
  },
  cancelar: {
    width: '100%',
    padding: '0.8rem',
    borderRadius: '12px',
    border: '1px solid #374151',
    background: 'transparent',
    color: '#9ca3af',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.95rem',
  },
}
