import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// Modal centralizado e genérico para os FORMULÁRIOS de lançamento/criação/
// edição do app, no mesmo padrão visual aprovado do ModalCompra.
//
// Renderizado via createPortal no <body>, fora do contexto transformado/com
// overflow do layout — assim o overlay cobre a tela inteira e o formulário
// fica centralizado, sem "grudar" no rodapé da página.
//
// Props:
//   - aberto: controla a exibição.
//   - titulo: cabeçalho do modal.
//   - aoFechar: fecha o modal (Cancelar, X, Esc ou clique no overlay).
//   - children: conteúdo do formulário (o próprio <form> e mensagens).
//   - mostrarCancelar (default true): mostra o botão "Cancelar" abaixo.
//
// O controle de "fechar só em sucesso" (manter aberto em erro) fica a cargo
// do chamador: basta não chamar aoFechar até o sucesso.
export default function ModalFormulario({
  aberto,
  titulo,
  aoFechar,
  children,
  mostrarCancelar = true,
}) {
  // O chamador pode (a) montar/desmontar o modal condicionalmente (não
  // passa `aberto`) ou (b) manter o componente montado e controlar via
  // `aberto` (ex.: o ModalCompra da FaturaDetalhe). Renderiza quando
  // `aberto` não é explicitamente `false`.
  const visivel = aberto !== false

  useEffect(() => {
    if (!visivel) return
    function aoTeclado(e) {
      if (e.key === 'Escape') aoFechar()
    }
    window.addEventListener('keydown', aoTeclado)
    return () => window.removeEventListener('keydown', aoTeclado)
  }, [visivel, aoFechar])

  if (!visivel || typeof document === 'undefined') return null

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

        {children}

        {mostrarCancelar && (
          <button type="button" onClick={aoFechar} style={estilos.cancelar}>
            Cancelar
          </button>
        )}
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
