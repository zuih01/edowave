/**
 * Registro técnico: guarda los últimos eventos importantes del reproductor (sobre todo del vinilo)
 * para poder ver qué pasó en un teléfono donde no hay consola. Se ve y se copia desde Configuración.
 */
export interface DiagEntry {
  t: string; // hora
  msg: string;
}

const KEY = 'diag';
const MAX = 120;

let entries: DiagEntry[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
})();

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function diag(msg: string, data?: Record<string, unknown>) {
  const d = new Date();
  const t = `${d.toLocaleTimeString('es', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  const extra = data
    ? ' ' +
      Object.entries(data)
        .map(([k, v]) => `${k}=${typeof v === 'number' ? Math.round(v * 1000) / 1000 : String(v)}`)
        .join(' ')
    : '';
  entries.push({ t, msg: msg + extra });
  if (entries.length > MAX) entries = entries.slice(-MAX);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {
      /* sin espacio */
    }
  }, 300);
}

export function diagEntries() {
  return entries;
}

export function diagText() {
  return [`${navigator.userAgent}`, ...entries.map((e) => `${e.t} ${e.msg}`)].join('\n');
}

export function diagClear() {
  entries = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada */
  }
}
