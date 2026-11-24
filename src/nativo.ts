import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { currentTrack, playerPos, usePlayer } from './player/player';
import { useCuenta } from './server/cuenta';

/**
 * Solo en la app de Android: conecta el reproductor con Android (android-nativo/ReproduccionService.java).
 *  - Android muestra la notificación con portada y controles, la pantalla de bloqueo y los botones de los
 *    auriculares, y mantiene la app viva mientras suena (pantalla apagada).
 *  - Lo que se toca ahí vuelve aquí y mueve el mismo reproductor de siempre.
 * En la web (PC, iPhone) no hace nada.
 */
interface Reproduccion {
  actualizar(o: { titulo: string; artista: string; album: string; portada: string; sonando: boolean; posicion: number; duracion: number }): Promise<void>;
  detener(): Promise<void>;
  addListener(ev: 'accion', fn: (e: { accion: string; posicion?: number }) => void): Promise<PluginListenerHandle>;
}

const Reproduccion = registerPlugin<Reproduccion>('Reproduccion');

let iniciado = false;
export function iniciarNativo() {
  if (iniciado || !Capacitor.isNativePlatform()) return;
  iniciado = true;

  void Reproduccion.addListener('accion', ({ accion, posicion }) => {
    const p = usePlayer.getState();
    if (accion === 'play' && !p.playing) p.toggle();
    else if (accion === 'pausa' && p.playing) p.toggle();
    else if (accion === 'siguiente') p.next();
    else if (accion === 'anterior') p.prev();
    else if (accion === 'mover' && typeof posicion === 'number') p.seek(posicion);
  });

  let ultimo = '';
  const avisar = () => {
    const s = usePlayer.getState();
    const t = currentTrack(s);
    if (!t) {
      if (ultimo) void Reproduccion.detener();
      ultimo = '';
      return;
    }
    const base = useCuenta.getState().base;
    const portada = t.coverId?.startsWith('p:') ? `${base}/api/portadas/${encodeURIComponent(t.coverId.slice(2))}` : '';
    const clave = `${t.id}|${s.playing}|${s.duration}`;
    // Solo cuando cambia algo que se ve (canción, play/pausa); la posición la calcula Android sola.
    if (clave === ultimo) return;
    ultimo = clave;
    void Reproduccion.actualizar({
      titulo: t.title,
      artista: t.artist,
      album: t.album,
      portada,
      sonando: s.playing,
      posicion: playerPos() || s.position,
      duracion: s.duration || t.duration,
    }).catch(() => {});
  };
  usePlayer.subscribe(avisar);
  // Al mover la barra: Android también actualiza su barra.
  let ultimaPos = 0;
  usePlayer.subscribe((s) => {
    if (Math.abs(s.position - ultimaPos) > 3 && s.playing) {
      ultimo = '';
      avisar();
    }
    ultimaPos = s.position;
  });
  useCuenta.subscribe((c) => !c.token && void Reproduccion.detener());
  avisar();
}
