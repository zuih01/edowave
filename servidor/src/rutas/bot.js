import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { requiereAdmin } from '../auth.js';
import { saludYtm } from '../datos/ytmusic.js';

/**
 * Pestaña "Bot" del panel: qué hace el bot de descargas (Billboard Sync) y si tiene conexión con YouTube.
 * El bot corre en este mismo VPS, con el mismo usuario, y deja sus reportes en JSON. Aquí solo se leen.
 */
const ESTADO = process.env.BOT_ESTADO || join(homedir(), 'reproductor/servicios/billboard-sync/estado');
const run = promisify(execFile);

const EJECUCIONES = [
  { id: 'asignadas', nombre: 'Listas asignadas', detalle: 'Billboard, kworb, Spotify y Dance UK · todos los días a las 4:00', archivo: 'ultimo-reporte.json', unidad: 'billboard-sync' },
  { id: 'importadas', nombre: 'Playlists de usuarios', detalle: 'Prioridad baja, hasta 80 canciones · todos los días a las 16:00', archivo: 'ultimo-reporte-importadas.json', unidad: 'billboard-importadas' },
];
// El botón "Descargar ahora" usa un servicio aparte (sin límites, máxima velocidad) y escribe el mismo reporte que
// las playlists de usuarios.
const UNIDAD_BOTON = 'billboard-importadas-ahora';
// El chequeo corre cada hora: si el último tiene más de 3 h, el chequeo mismo dejó de funcionar.
const SALUD_VIEJA_MS = 3 * 3600_000;

async function leerJson(nombre) {
  try {
    return JSON.parse(await readFile(join(ESTADO, nombre), 'utf8'));
  } catch {
    return null;
  }
}

/** Estado de un servicio y la próxima hora de su temporizador, según systemd del usuario. */
async function unidad(nombre) {
  try {
    const [s, t] = await Promise.all([
      run('systemctl', ['--user', 'show', `${nombre}.service`, '-p', 'ActiveState,Result', '--value'], { timeout: 5000 }),
      run('systemctl', ['--user', 'show', `${nombre}.timer`, '-p', 'ActiveState,NextElapseUSecRealtime', '--value', '--timestamp=unix'], { timeout: 5000 }),
    ]);
    const [activo, resultado] = s.stdout.trim().split('\n');
    const [timer, proxima] = t.stdout.trim().split('\n');
    return {
      corriendo: activo === 'active' || activo === 'activating',
      fallo: activo === 'failed' || (resultado && resultado !== 'success'),
      programado: timer === 'active',
      proxima: proxima?.startsWith('@') ? new Date(Number(proxima.slice(1)) * 1000).toISOString() : null,
    };
  } catch {
    return { corriendo: false, fallo: false, programado: null, proxima: null };
  }
}

const ESTADOS = {
  ENTREGADA_EN_ENTRADA: 'Bajada',
  CANDIDATO_UNICO: 'Audio oficial',
  PRIMER_RESULTADO_YOUTUBE: 'Primer resultado',
  SIN_AUDIO_VERIFICADO: 'No encontrada',
  DURACION_FUERA_DE_RANGO: 'Duración fuera de rango',
  OMITIDA_REGISTRO: 'Bloqueada',
  REVISAR: 'En revisión',
  REVISAR_BIBLIOTECA: 'Revisar biblioteca',
  ERROR_BUSQUEDA: 'Error al buscar',
};

function resumen(r) {
  if (!r) return null;
  const entradas = r.entradas ?? [];
  const entregas = r.entregas ?? [];
  const bajadas = entregas.filter((e) => e.estado === 'ENTREGADA_EN_ENTRADA' && e.confirmada);
  const errores = entregas.filter((e) => e.estado !== 'ENTREGADA_EN_ENTRADA');
  const conteo = {};
  for (const e of entradas) conteo[ESTADOS[e.estado] ?? e.estado] = (conteo[ESTADOS[e.estado] ?? e.estado] ?? 0) + 1;
  return {
    hora: r.hora,
    terminado: r.fase === 'terminado',
    detenidaPorHora: !!r.detenida_por_hora,
    fuentes: r.fuentes ?? {},
    unicas: r.temas_unicos ?? 0,
    existentes: r.existentes ?? 0,
    faltantes: r.faltantes ?? 0,
    revisadas: entradas.length,
    busquedas: r.busquedas ?? null,
    maxBusquedas: r.max_busquedas || null,
    conteo,
    bajadas: bajadas.slice(-200).reverse().map((e) => ({ artista: e.artista, cancion: e.cancion })),
    nBajadas: bajadas.length,
    errores: errores.slice(-50).reverse().map((e) => ({ artista: e.artista, cancion: e.cancion, detalle: e.detalle || e.tipo || '' })),
  };
}

export default async function bot(app) {
  app.addHook('preHandler', requiereAdmin);

  app.get('/api/admin/bot', async () => {
    const [salud, ytm, ...rest] = await Promise.all([
      leerJson('salud-youtube.json'),
      saludYtm().catch(() => null),
      ...EJECUCIONES.map((e) => leerJson(e.archivo)),
      unidad('billboard-salud'),
      unidad(UNIDAD_BOTON),
      ...EJECUCIONES.map((e) => unidad(e.unidad)),
    ]);
    const reportes = rest.slice(0, EJECUCIONES.length);
    const [unidadSalud, boton] = rest.slice(EJECUCIONES.length, EJECUCIONES.length + 2);
    const unidades = rest.slice(EJECUCIONES.length + 2);
    const ejecuciones = EJECUCIONES.map((e, i) => {
      const u = { ...unidades[i] };
      if (e.id === 'importadas') {
        // La descarga del botón cuenta como esta ejecución (mismo reporte).
        u.manual = boton.corriendo;
        u.corriendo ||= boton.corriendo;
        u.fallo ||= boton.fallo;
      }
      return { id: e.id, nombre: e.nombre, detalle: e.detalle, ...u, reporte: resumen(reportes[i]) };
    });

    const vieja = !salud || Date.now() - Date.parse(salud.hora) > SALUD_VIEJA_MS;
    const problemas = [];
    if (!salud) problemas.push('Todavía no hay chequeo de conexión con YouTube.');
    else if (!salud.ok) problemas.push('El bot perdió la conexión con YouTube.');
    else if (vieja) problemas.push('El chequeo de YouTube no corre hace más de 3 horas.');
    // API de recomendaciones de YouTube Music (la usa el servidor, no el bot; no es oficial y puede cambiar).
    const ytmVieja = !ytm?.hora || Date.now() - Date.parse(ytm.hora) > SALUD_VIEJA_MS;
    if (ytm && !ytm.hora) problemas.push('Todavía no hay chequeo de la API de YouTube Music.');
    else if (ytm && !ytm.ok) problemas.push('La API de recomendaciones de YouTube Music no responde.');
    else if (ytm && ytmVieja) problemas.push('El chequeo de la API de YouTube Music no corre hace más de 3 horas.');
    for (const e of ejecuciones) {
      if (e.fallo && !e.corriendo) problemas.push(`La última ejecución de "${e.nombre}" falló.`);
      if (e.programado === false) problemas.push(`"${e.nombre}" no está programada.`);
    }
    return {
      ok: problemas.length === 0,
      problemas,
      salud: salud && {
        ok: salud.ok,
        vieja,
        hora: salud.hora,
        pruebas: salud.pruebas,
        ultimoOk: salud.ultimo_ok,
        fallaDesde: salud.falla_desde,
        ytDlp: salud.yt_dlp,
        cookies: salud.cookies_actualizadas,
        bloqueadas: salud.bloqueadas,
        historial: salud.historial ?? [],
        proxima: unidadSalud.proxima,
      },
      ytmusic: ytm && { ...ytm, vieja: ytmVieja },
      ejecuciones,
    };
  });

  // Botón "Descargar ahora" (solo zuih): baja TODAS las faltantes de las playlists importadas, a máxima velocidad
  // (sin prioridad baja ni límite de hora). No toca los temporizadores: si a las 4:00 sigue corriendo, la de listas
  // asignadas espera a que termine; la de las 16:00 se salta ese día.
  app.post('/api/admin/bot/importadas/iniciar', async (req, reply) => {
    const u = req.usuario;
    if (!(u?.es_admin && String(u.nombre ?? '').trim().toLowerCase() === 'zuih')) {
      return reply.code(403).send({ error: 'Solo zuih puede iniciar el bot' });
    }
    // El bot no corre dos veces a la vez.
    const [asignadas, importadas, boton] = await Promise.all([...EJECUCIONES.map((e) => unidad(e.unidad)), unidad(UNIDAD_BOTON)]);
    if (importadas.corriendo || boton.corriendo) return reply.code(409).send({ error: 'La descarga de playlists ya está corriendo' });
    if (asignadas.corriendo) return reply.code(409).send({ error: 'Ahora corre la de listas asignadas; espera a que termine' });
    try {
      await run('systemctl', ['--user', 'start', '--no-block', `${UNIDAD_BOTON}.service`], { timeout: 10_000 });
    } catch (e) {
      req.log.error({ err: e }, 'no se pudo iniciar el bot');
      return reply.code(500).send({ error: 'No se pudo iniciar el bot' });
    }
    req.log.info({ usuario: u.nombre }, 'descarga de playlists iniciada a mano');
    return { ok: true };
  });
}
