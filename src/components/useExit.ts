import { useEffect, useRef, useState } from 'react';

/**
 * Mantiene algo en pantalla un momento después de cerrarse, para poder animar la salida.
 * Devuelve el último valor abierto y si está cerrándose.
 */
export function useExit<T>(value: T | null | undefined, ms: number): { shown: T | null; closing: boolean } {
  const last = useRef<T | null>(value ?? null);
  const [closing, setClosing] = useState(false);
  if (value != null) last.current = value;

  useEffect(() => {
    if (value != null) {
      setClosing(false);
      return;
    }
    if (last.current == null) return;
    setClosing(true);
    const id = setTimeout(() => {
      last.current = null;
      setClosing(false);
    }, ms);
    return () => clearTimeout(id);
  }, [value, ms]);

  return { shown: value ?? (closing ? last.current : null), closing: value == null && closing };
}
