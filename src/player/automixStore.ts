import { create } from 'zustand';

/**
 * Automix OCULTO por ahora (se implementa después): no aparece en Configuración y queda siempre apagado.
 * Para volver a mostrarlo: AUTOMIX_VISIBLE = true. El código sigue intacto.
 */
export const AUTOMIX_VISIBLE = false;

/** Ajuste "Automix" (Configuración → Avanzado). Desactivado por defecto. No convive con el modo vinilo. */
export const useAutomix = create<{ on: boolean; analyzed: number; set: (v: boolean) => void }>((set) => ({
  on: (() => {
    if (!AUTOMIX_VISIBLE) return false;
    try {
      return localStorage.getItem('automix') === 'on';
    } catch {
      return false;
    }
  })(),
  analyzed: 0,
  set(on) {
    set({ on });
    try {
      localStorage.setItem('automix', on ? 'on' : 'off');
    } catch {
      /* sin espacio */
    }
  },
}));
