// Panel de admin: subir música, crear invitaciones y manejar usuarios.
const $ = (s, el = document) => el.querySelector(s);
const TOKEN = 'adminToken';
let token = (() => {
  try {
    return localStorage.getItem(TOKEN);
  } catch {
    return null;
  }
})();

// ---------------- Comunicación con el servidor ----------------

async function api(ruta, { method = 'GET', body } = {}) {
  const r = await fetch(ruta, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && token) {
    guardarToken(null);
    mostrar('entrar');
  }
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  return datos;
}
function guardarToken(t) {
  token = t;
  try {
    t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN);
  } catch {
    /* sin almacenamiento */
  }
}

let avisoTimer;
function aviso(texto) {
  const el = $('#aviso');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (el.hidden = true), 2600);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');
const fecha = (d) => (d ? new Date(d).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const tamano = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

function confirmar(titulo, texto, boton = 'Borrar') {
  const d = $('#d-confirmar');
  $('#confirmar-titulo').textContent = titulo;
  $('#confirmar-texto').textContent = texto;
  $('#confirmar-si').textContent = boton;
  d.returnValue = '';
  d.showModal();
  return new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'si'), { once: true }));
}

// ---------------- Vistas ----------------

function mostrar(v) {
  for (const id of ['crear', 'entrar', 'panel']) $(`#v-${id}`).hidden = id !== v;
  if (v === 'panel') cargarTodo();
  else $(`#v-${v} input`)?.focus();
}

async function inicio() {
  if (token) {
    try {
      const yo = await api('/api/yo');
      if (yo.esAdmin) {
        $('#yo').textContent = yo.nombre; mostrarAjustes(yo.nombre);
        return mostrar('panel');
      }
    } catch {
      /* sesión vencida */
    }
    guardarToken(null);
  }
  const { hayAdmin } = await api('/api/admin/estado');
  mostrar(hayAdmin ? 'entrar' : 'crear');
}

$('#f-crear').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $('.error', f);
  if (f.clave.value !== f.clave2.value) return (err.textContent = 'Las contraseñas no coinciden');
  try {
    const r = await api('/api/admin/crear', { method: 'POST', body: { nombre: f.nombre.value, clave: f.clave.value, aparato: 'Panel de admin' } });
    guardarToken(r.token);
    $('#yo').textContent = r.nombre; mostrarAjustes(r.nombre);
    f.reset();
    mostrar('panel');
  } catch (x) {
    err.textContent = x.message;
  }
});

$('#f-entrar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('/api/login', { method: 'POST', body: { nombre: f.nombre.value, clave: f.clave.value, admin: true, aparato: 'Panel de admin' } });
    guardarToken(r.token);
    $('#yo').textContent = r.nombre; mostrarAjustes(r.nombre);
    f.reset();
    $('.error', f).textContent = '';
    mostrar('panel');
  } catch (x) {
    $('.error', f).textContent = x.message;
  }
});

$('#salir').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* igual se sale */
  }
  guardarToken(null);
  mostrar('entrar');
});

// Pestañas
document.querySelectorAll('[data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
    if (b.dataset.tab === 'invitaciones') cargarInvitaciones();
    if (b.dataset.tab === 'usuarios') cargarUsuarios();
    if (b.dataset.tab === 'reportes') cargarReportes();
    if (b.dataset.tab === 'sugerencias') {
      cargarSugerencias();
      cargarFaltantes();
    }
    if (b.dataset.tab === 'categorias') cargarCategorias();
    if (b.dataset.tab === 'artistas') cargarArtistas();
    if (b.dataset.tab === 'estadisticas') cargarEstadisticas();
  }),
);

function cargarTodo() {
  cargarCanciones();
  cargarSugerencias(); // para el numerito de pendientes en la pestaña
  cargarReportes();
  cargarCategorias();
  cargarArtistas();
}

// ---------------- Música ----------------

let canciones = [];
let sondeo;

async function cargarCanciones() {
  try {
    const r = await api('/api/admin/canciones');
    $('#total').textContent = r.total ? `· ${r.total} ${r.total === 1 ? 'canción' : 'canciones'} · ${tamano(r.bytes)}` : '';
    // Espacio libre del disco del servidor (en rojo si queda menos del 10 %).
    const libre = $('#libre');
    if (r.disco) {
      libre.textContent = `· VPS: ${tamano(r.disco.libre)} libres de ${tamano(r.disco.total)}`;
      libre.classList.toggle('poco', r.disco.libre < r.disco.total * 0.1);
      libre.title = `Disco del servidor: ${Math.round((1 - r.disco.libre / r.disco.total) * 100)} % ocupado (con todo lo que hay en el VPS, no solo la música)`;
    } else libre.textContent = '';
    // Servidor de casa (wifi): ahí se guarda el audio de las canciones nuevas.
    const wifi = $('#wifi');
    const w = r.wifi;
    if (!w) wifi.textContent = '';
    else if (!w.conectado) {
      wifi.textContent = '· Wifi: desconectado';
      wifi.classList.add('poco');
      wifi.title = `El servidor de casa no responde: las ${w.canciones} canciones guardadas ahí no suenan (salvo las que están en la caché del VPS). Las subidas nuevas esperan en el VPS y se mandan solas cuando vuelva.`;
    } else {
      wifi.textContent = `· Wifi: ${tamano(w.libre)} libres de ${tamano(w.total)}`;
      wifi.classList.toggle('poco', w.libre < w.total * 0.1);
      wifi.title = `Servidor de casa conectado: ${w.canciones} canciones (${tamano(w.bytes)})` + (w.pendientes ? ` · ${w.pendientes} esperando para mandarse` : '');
    }
    $('#borrar-todo').disabled = !r.total;
    $('#borrar-todo').dataset.total = r.total;
    // El sondeo cada 3 s solo vuelve a pintar si algo cambió de verdad.
    const firma = JSON.stringify(r.canciones);
    if (firma !== firmaCanciones) {
      const refresco = firmaCanciones !== '';
      firmaCanciones = firma;
      canciones = r.canciones;
      pintarCanciones({ conservar: refresco });
    }
    // Mientras haya canciones analizándose, se actualiza solo.
    clearTimeout(sondeo);
    if (canciones.some((c) => c.analisis === 'pendiente' || c.datos_estado === 'pendiente')) sondeo = setTimeout(cargarCanciones, 3000);
  } catch (x) {
    aviso(x.message);
  }
}

function chipAnalisis(c) {
  if (c.analisis === 'listo') {
    const bpm = c.bpm ? `${Math.round(Number(c.bpm))} BPM` : 'sin BPM';
    const mix = c.tempo_constante ? '' : ' · sin mezcla';
    return `<span class="chip ok" title="Volumen: ${c.lufs?.toFixed?.(1) ?? '?'} LUFS">${bpm}${mix}</span>`;
  }
  if (c.analisis === 'error') return `<span class="chip mal" title="${esc(c.analisis_error)}">error</span>`;
  return '<span class="chip pend">analizando…</span>';
}

function chipDatos(c) {
  if (c.datos_estado === 'listo') return `<span class="chip ok" title="Completado desde MusicBrainz: ${esc((c.mb_completado ?? []).join(', ') || 'nada faltaba')}">MusicBrainz</span>`;
  if (c.datos_estado === 'sin_resultado') return '<span class="chip" title="MusicBrainz no tiene esta canción">sin datos</span>';
  if (c.datos_estado === 'error') return '<span class="chip mal">datos: error</span>';
  return '<span class="chip pend">buscando datos…</span>';
}

// Con miles de canciones no se pinta todo de una: se muestran de a POR_TANDA filas
// y se agregan más al bajar (las portadas se cargan solo cuando aparecen en pantalla).
const POR_TANDA = 100;
let filtradas = [];
let mostradas = 0;
let firmaCanciones = '';
const claveBusqueda = new WeakMap();
const textoDe = (c) => {
  let t = claveBusqueda.get(c);
  if (t === undefined) claveBusqueda.set(c, (t = `${c.titulo} ${c.artista} ${c.album ?? ''}`.toLowerCase()));
  return t;
};

function filaCancion(c) {
  return `<tr data-id="${esc(c.id)}" title="Doble clic para editar">
        <td>${c.portada ? `<img class="portada" src="/api/portadas/${esc(c.portada)}" alt="" loading="lazy" decoding="async" width="40" height="40" />` : '<span class="portada"></span>'}</td>
        <td class="titulo" title="${esc(c.titulo)}">${esc(c.titulo)}</td>
        <td title="${esc(c.artista)}">${esc(c.artista)}</td>
        <td title="${esc(c.album)}">${esc(c.album)}</td>
        <td class="num">${c.anio ?? ''}</td>
        <td class="num">${dur(c.duracion)}</td>
        <td title="${esc((c.generos ?? []).join(', '))}">${esc((c.generos ?? []).join(', '))}</td>
        <td>${chipAnalisis(c)} ${chipDatos(c)}</td>
        <td class="acciones">
          ${c.analisis === 'error' || c.datos_estado === 'error' || c.datos_estado === 'sin_resultado' ? '<button class="link" data-accion="reanalizar">Reintentar</button>' : ''}
          <button class="link" data-accion="editar">Editar</button>
          <button class="link" data-accion="borrar">Borrar</button>
        </td>
      </tr>`;
}

/** Vuelve a filtrar y pinta desde arriba (o conserva cuántas filas ya se veían, al refrescar). */
function pintarCanciones({ conservar = false } = {}) {
  const q = $('#buscar').value.trim().toLowerCase();
  filtradas = q ? canciones.filter((c) => textoDe(c).includes(q)) : canciones;
  $('#vacio').hidden = canciones.length > 0;
  const hasta = Math.min(filtradas.length, Math.max(POR_TANDA, conservar ? mostradas : 0));
  $('#tabla tbody').innerHTML = filtradas.slice(0, hasta).map(filaCancion).join('');
  mostradas = hasta;
  actualizarMas();
}

function pintarMas() {
  if (mostradas >= filtradas.length) return;
  const hasta = Math.min(filtradas.length, mostradas + POR_TANDA);
  $('#tabla tbody').insertAdjacentHTML('beforeend', filtradas.slice(mostradas, hasta).map(filaCancion).join(''));
  mostradas = hasta;
  actualizarMas();
}

function actualizarMas() {
  const resto = filtradas.length - mostradas;
  $('#mas-canciones').hidden = resto <= 0;
  $('#mas-canciones').textContent = `Mostrando ${mostradas} de ${filtradas.length} · bajar para ver más`;
}

// Al acercarse al final de la tabla se agrega la siguiente tanda.
new IntersectionObserver((e) => e[0].isIntersecting && pintarMas(), { rootMargin: '600px' }).observe($('#mas-canciones'));

let esperaBusqueda;
$('#buscar').addEventListener('input', () => {
  clearTimeout(esperaBusqueda);
  esperaBusqueda = setTimeout(pintarCanciones, 150);
});

$('#tabla').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-accion]');
  if (!b) return;
  const c = canciones.find((x) => x.id === b.closest('tr').dataset.id);
  if (!c) return;
  if (b.dataset.accion === 'borrar') {
    if (!(await confirmar(`¿Borrar "${c.titulo}"?`, 'Se borra del servidor el archivo y sus datos. También desaparece de las playlists y me gusta de los usuarios. No se puede deshacer.'))) return;
    try {
      await api(`/api/admin/canciones/${c.id}`, { method: 'DELETE' });
      aviso('Canción borrada');
      cargarCanciones();
    } catch (x) {
      aviso(x.message);
    }
  } else if (b.dataset.accion === 'reanalizar') {
    await api(`/api/admin/canciones/${c.id}/analizar`, { method: 'POST' });
    cargarCanciones();
  } else editar(c);
});

function editar(c) {
  const d = $('#d-editar');
  const f = $('#f-editar');
  f.titulo.value = c.titulo;
  f.artista.value = c.artista;
  f.album.value = c.album ?? '';
  f.artistaAlbum.value = c.artista_album ?? '';
  f.anio.value = c.anio ?? '';
  f.generos.value = (c.generos ?? []).join(', ');
  for (const x of f.querySelectorAll('input[name="cat"]')) x.checked = (c.categorias ?? []).includes(x.value);
  const fmt = c.formato_original ? `${c.formato_original.toUpperCase()} → ${(c.formato ?? 'mp3').toUpperCase()}` : (c.formato ?? 'mp3').toUpperCase();
  $('#editar-info').textContent = `${c.nombre_original ?? ''} · ${fmt} · ${c.bitrate ? `${c.bitrate} kbps · ` : ''}${tamano(c.tamano)} · subida ${fecha(c.subida)}`;
  $('.error', f).textContent = '';

  // Carátula: se elige (botón, soltar o pegar), se ve al instante y se sube al tocar Guardar.
  let nuevaPortada = null; // data URL
  const caja = $('#ed-portada');
  const img = $('#ed-portada-img');
  const pintarPortada = (url) => (img.style.backgroundImage = url ? `url("${url}")` : '');
  pintarPortada(c.portada ? `/api/portadas/${encodeURIComponent(c.portada)}` : '');
  $('#ed-portada-album').checked = false;
  $('#ed-portada-album-l').hidden = !c.album;
  const usarImagen = (archivo) => {
    if (!archivo || !/^image\/(jpeg|png|webp)$/.test(archivo.type)) return ($('.error', f).textContent = 'Usa una imagen JPG, PNG o WebP');
    if (archivo.size > 10 * 1024 * 1024) return ($('.error', f).textContent = 'La imagen tiene que pesar menos de 10 MB');
    const r = new FileReader();
    r.onload = () => {
      nuevaPortada = r.result;
      pintarPortada(nuevaPortada);
      $('.error', f).textContent = '';
    };
    r.readAsDataURL(archivo);
  };
  $('#ed-portada-elegir').onclick = () => $('#ed-portada-archivo').click();
  $('#ed-portada-archivo').onchange = (e) => {
    usarImagen(e.target.files[0]);
    e.target.value = '';
  };
  caja.ondragover = (e) => {
    e.preventDefault();
    e.stopPropagation();
    caja.classList.add('encima');
  };
  caja.ondragleave = () => caja.classList.remove('encima');
  caja.ondrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    caja.classList.remove('encima');
    usarImagen(e.dataTransfer.files[0]);
  };
  d.onpaste = (e) => {
    const archivo = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (archivo) {
      e.preventDefault();
      usarImagen(archivo);
    }
  };

  d.returnValue = '';
  d.showModal();
  f.onsubmit = async (e) => {
    if (e.submitter?.value !== 'guardar') return;
    e.preventDefault();
    try {
      if (nuevaPortada) {
        const r = await api(`/api/admin/canciones/${c.id}/portada`, { method: 'POST', body: { imagen: nuevaPortada, album: $('#ed-portada-album').checked } });
        nuevaPortada = null;
        if (r.canciones > 1) aviso(`Carátula puesta en ${r.canciones} canciones del álbum`);
      }
      await api(`/api/admin/canciones/${c.id}`, {
        method: 'PATCH',
        body: {
          titulo: f.titulo.value, artista: f.artista.value, album: f.album.value, artistaAlbum: f.artistaAlbum.value, anio: f.anio.value, generos: f.generos.value,
          categorias: [...f.querySelectorAll('input[name="cat"]:checked')].map((x) => x.value),
        },
      });
      d.close();
      aviso('Cambios guardados');
      cargarCanciones();
    } catch (x) {
      $('.error', f).textContent = x.message;
    }
  };
}

// ---------------- Subir ----------------

const zona = $('#soltar');
const cola = [];
let subiendo = 0;
const PARALELO = 2;

['dragenter', 'dragover'].forEach((t) =>
  zona.addEventListener(t, (e) => {
    e.preventDefault();
    zona.classList.add('encima');
  }),
);
['dragleave', 'drop'].forEach((t) => zona.addEventListener(t, () => zona.classList.remove('encima')));
zona.addEventListener('drop', (e) => {
  e.preventDefault();
  agregar([...e.dataTransfer.files]);
});
$('#archivos').addEventListener('change', (e) => {
  agregar([...e.target.files]);
  e.target.value = '';
});
// Para no abrir el archivo en el navegador si se suelta fuera de la zona.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

const EXT_AUDIO = /\.(mp3|m4a|aac|mp4|flac|wav|wave|aif|aiff|alac|ogg|oga|opus|wma|ac3|eac3|ape|wv|mka|amr|caf|dsf|mpc|tta|webm)$/i;

function agregar(archivos) {
  // Cualquier audio (el servidor decide si lo guarda tal cual o lo prepara). Se ignoran fotos, textos, etc.
  const audio = archivos.filter((f) => f.type.startsWith('audio/') || EXT_AUDIO.test(f.name));
  if (audio.length < archivos.length) aviso(`${archivos.length - audio.length} archivo(s) no son audio y se ignoraron`);
  if (!audio.length) return;
  $('#subidas').hidden = false;
  for (const f of audio) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="nombre">${esc(f.name)}</span><span class="estado">en espera</span><span class="barrita"><i></i></span>`;
    $('#subidas-lista').append(li);
    cola.push({ f, li });
  }
  resumen();
  siguiente();
}

const conteo = { ok: 0, rep: 0, mal: 0 };
function resumen() {
  const pend = cola.length + subiendo;
  $('#subidas-resumen').textContent =
    `${conteo.ok} subidas` + (conteo.rep ? ` · ${conteo.rep} ya estaban` : '') + (conteo.mal ? ` · ${conteo.mal} con error` : '') + (pend ? ` · faltan ${pend}` : ' · listo');
}

function siguiente() {
  while (subiendo < PARALELO && cola.length) {
    const t = cola.shift();
    subiendo++;
    subir(t).finally(() => {
      subiendo--;
      resumen();
      siguiente();
      if (!subiendo && !cola.length) cargarCanciones();
    });
  }
}

function subir({ f, li }) {
  const estado = $('.estado', li);
  const barra = $('.barrita i', li);
  estado.textContent = 'subiendo…';
  return new Promise((res) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/canciones');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) barra.style.width = `${(e.loaded / e.total) * 100}%`;
      if (e.loaded === e.total) estado.textContent = 'leyendo datos…';
    };
    xhr.onload = () => {
      let d = {};
      try {
        d = JSON.parse(xhr.responseText);
      } catch {
        /* sin cuerpo */
      }
      barra.parentElement.remove();
      if (xhr.status === 200) {
        conteo.ok++;
        estado.className = 'estado ok';
        estado.textContent = `✓ ${d.artista} – ${d.titulo}`;
      } else if (xhr.status === 409) {
        conteo.rep++;
        estado.className = 'estado rep';
        estado.textContent = d.error;
      } else {
        conteo.mal++;
        estado.className = 'estado mal';
        estado.textContent = d.error || `Error ${xhr.status}`;
        if (xhr.status === 401) mostrar('entrar');
      }
      res();
    };
    xhr.onerror = () => {
      conteo.mal++;
      estado.className = 'estado mal';
      estado.textContent = 'Sin conexión con el servidor';
      res();
    };
    const datos = new FormData();
    datos.append('archivo', f, f.name);
    xhr.send(datos);
  });
}

$('#subidas-limpiar').addEventListener('click', () => {
  if (subiendo || cola.length) return aviso('Espera a que terminen las subidas');
  $('#subidas-lista').innerHTML = '';
  $('#subidas').hidden = true;
  Object.assign(conteo, { ok: 0, rep: 0, mal: 0 });
});
window.addEventListener('beforeunload', (e) => {
  if (subiendo || cola.length) e.preventDefault();
});

// ---------------- Invitaciones ----------------

async function cargarInvitaciones() {
  try {
    const lista = await api('/api/admin/invitaciones');
    $('#invitaciones').innerHTML = lista.length
      ? lista
          .map((i) => {
            const estado = i.usada
              ? `Usada por <b>${esc(i.usada_por ?? 'cuenta borrada')}</b> · ${fecha(i.usada)}`
              : i.vigente
                ? `${i.multiuso ? `Varios usos · ${i.usos} ${i.usos === 1 ? 'cuenta creada' : 'cuentas creadas'} · ` : ''}${i.nunca_vence ? 'No vence nunca' : `Vence ${fecha(i.vence)}`}`
                : 'Vencida';
            return `<li data-id="${i.id}">
              <div class="principal">
                <div class="codigo ${i.vigente ? '' : 'usado'}">${esc(i.codigo)}</div>
                <div class="meta">${i.nota ? `${esc(i.nota)} · ` : ''}${estado}</div>
              </div>
              ${i.vigente ? '<button data-accion="copiar">Copiar</button><button class="link" data-accion="anular">Anular</button>' : ''}
            </li>`;
          })
          .join('')
      : '<p class="vacio">Aún no has creado invitaciones.</p>';
  } catch (x) {
    aviso(x.message);
  }
}

$('#f-invitar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const i = await api('/api/admin/invitaciones', { method: 'POST', body: { nota: f.nota.value, dias: Number(f.dias.value) } });
    f.nota.value = '';
    await cargarInvitaciones();
    try {
      await navigator.clipboard.writeText(i.codigo);
      aviso(`Invitación ${i.codigo} creada y copiada`);
    } catch {
      aviso(`Invitación ${i.codigo} creada`);
    }
  } catch (x) {
    aviso(x.message);
  }
});

$('#invitaciones').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-accion]');
  if (!b) return;
  const li = b.closest('li');
  const codigo = $('.codigo', li).textContent;
  if (b.dataset.accion === 'copiar') {
    try {
      await navigator.clipboard.writeText(codigo);
      aviso('Código copiado');
    } catch {
      aviso(codigo);
    }
  } else if (await confirmar(`¿Anular ${codigo}?`, 'Ese código ya no servirá para crear una cuenta.', 'Anular')) {
    await api(`/api/admin/invitaciones/${li.dataset.id}`, { method: 'DELETE' }).catch((x) => aviso(x.message));
    cargarInvitaciones();
  }
});

// ---------------- Usuarios ----------------

// ---------------- Usuarios: lista compacta, detalle al tocar, orden y filtros ----------------

let usuarios = [];
let usOrden = 'recientes';
let usFiltro = 'todos';
let usBusca = '';
/** Una cuenta está "conectada" si alguno de sus aparatos le habló al servidor hace menos de 3 minutos. */
const CONECTADO_MS = 3 * 60_000;
const ultimoUso = (u) => Math.max(0, ...u.sesiones.map((s) => Date.parse(s.ultimo_uso) || 0));
const conectado = (u) => Date.now() - ultimoUso(u) < CONECTADO_MS;

function haceCuanto(ms) {
  if (!ms) return 'Nunca';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

async function cargarUsuarios() {
  try {
    usuarios = await api('/api/admin/usuarios');
    pintarUsuarios();
  } catch (x) {
    aviso(x.message);
  }
}

function pintarUsuarios() {
  const conectados = usuarios.filter(conectado).length;
  $('#us-total').textContent = `${usuarios.length}`;
  $('#us-n-todos').textContent = usuarios.length;
  $('#us-n-conectados').textContent = conectados;
  $('#us-n-desconectados').textContent = usuarios.length - conectados;

  const q = usBusca.trim().toLowerCase();
  const lista = usuarios
    .filter((u) => (usFiltro === 'conectados' ? conectado(u) : usFiltro === 'desconectados' ? !conectado(u) : true))
    .filter((u) => !q || u.nombre.toLowerCase().includes(q))
    .sort((a, b) => {
      switch (usOrden) {
        case 'antiguos':
          return Date.parse(a.creado) - Date.parse(b.creado);
        case 'nombre':
          return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
        case 'actividad':
          return ultimoUso(b) - ultimoUso(a);
        case 'escuchas':
          return b.escuchas - a.escuchas;
        default:
          return Date.parse(b.creado) - Date.parse(a.creado);
      }
    });

  $('#usuarios').innerHTML = lista.length
    ? lista
        .map((u) => {
          const on = conectado(u);
          return `<li data-id="${u.id}" class="us-fila" tabindex="0" role="button" aria-label="Ver detalles de ${esc(u.nombre)}">
            <span class="us-avatar" aria-hidden="true">${esc(u.nombre.charAt(0).toUpperCase())}<i class="us-punto ${on ? 'on' : ''}"></i></span>
            <div class="principal">
              <div><b>${esc(u.nombre)}</b>${u.es_admin ? '<span class="insignia">admin</span>' : u.puede_admin ? '<span class="insignia">panel</span>' : ''}</div>
              <div class="meta">${on ? '<span class="us-on">Conectado</span>' : `Activo ${haceCuanto(ultimoUso(u))}`}</div>
            </div>
            <span class="us-flecha" aria-hidden="true">›</span>
          </li>`;
        })
        .join('')
    : '<li class="vacio">Nadie coincide con ese filtro.</li>';
}

function abrirUsuario(id) {
  const u = usuarios.find((x) => String(x.id) === String(id));
  if (!u) return;
  const d = $('#d-usuario');
  const on = conectado(u);
  d.dataset.id = u.id;
  $('#du-nombre').innerHTML = `${esc(u.nombre)}${u.es_admin ? '<span class="insignia">admin</span>' : u.puede_admin ? '<span class="insignia">panel</span>' : ''}`;
  $('#du-panel').textContent = u.puede_admin ? 'Quitar acceso al panel' : 'Dar acceso al panel';
  $('#du-estado').innerHTML = on ? '<span class="us-on">● Conectado</span>' : `Activo ${haceCuanto(ultimoUso(u))}`;
  $('#du-datos').innerHTML = `
    <div><span>Se unió</span><b>${esc(fecha(u.creado))}</b></div>
    <div><span>Escuchas</span><b>${u.escuchas ?? 0}</b></div>
    <div><span>Me gusta</span><b>${u.me_gusta ?? 0}</b></div>
    <div><span>Playlists</span><b>${u.playlists ?? 0}</b></div>`;
  $('#du-sesiones').innerHTML = u.sesiones.length
    ? u.sesiones
        .map(
          (s) => `<li data-sesion="${s.id}">
            <div class="principal"><div>${esc(s.aparato || 'Aparato sin nombre')}</div><div class="meta">Último uso ${haceCuanto(Date.parse(s.ultimo_uso))} · desde ${fecha(s.creada)}</div></div>
            ${soyDueno ? '<button class="link" data-accion="cerrar">Cerrar sesión</button>' : ''}
          </li>`,
        )
        .join('')
    : '<li class="meta">Sin sesiones abiertas</li>';
  // Restablecer contraseña / borrar cuenta: solo el dueño (el servidor también lo exige).
  $('#du-acciones').hidden = !!u.es_admin || !soyDueno;
  d.showModal();
}

$('#usuarios').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) abrirUsuario(li.dataset.id);
});
$('#usuarios').addEventListener('keydown', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    abrirUsuario(li.dataset.id);
  }
});

$('#d-usuario').addEventListener('click', async (e) => {
  const d = $('#d-usuario');
  const b = e.target.closest('button[data-accion]');
  if (!b) return;
  const u = usuarios.find((x) => String(x.id) === d.dataset.id);
  if (!u) return;
  if (b.dataset.accion === 'cerrar-dialogo') return d.close();
  if (b.dataset.accion === 'cerrar') {
    const id = b.closest('[data-sesion]').dataset.sesion;
    if (!(await confirmar('¿Cerrar esta sesión?', 'Ese aparato tendrá que volver a entrar con usuario y contraseña.', 'Cerrar sesión'))) return;
    await api(`/api/admin/sesiones/${id}`, { method: 'DELETE' }).catch((x) => aviso(x.message));
    // Si cerraste la sesión de este mismo panel, hay que volver a entrar.
    await cargarUsuarios();
    api('/api/yo').catch(() => {});
    abrirUsuario(u.id);
  } else if (b.dataset.accion === 'panel') {
    const dar = !u.puede_admin;
    const ok = dar
      ? await confirmar(
          `¿Dar acceso al panel a ${u.nombre}?`,
          'Podrá entrar al panel con su misma contraseña y usarlo entero, menos borrar cuentas, cambiar contraseñas, cerrar sesiones, dar este acceso o vaciar la biblioteca.',
          'Dar acceso',
        )
      : await confirmar(`¿Quitar el acceso al panel a ${u.nombre}?`, 'Queda fuera del panel al instante. Su cuenta en la app no cambia.', 'Quitar acceso');
    if (!ok) return;
    try {
      await api(`/api/admin/usuarios/${u.id}/panel`, { method: 'PATCH', body: { puede: dar } });
    } catch (x) {
      return aviso(x.message);
    }
    await cargarUsuarios();
    abrirUsuario(u.id);
  } else if (b.dataset.accion === 'clave') {
    d.close();
    restablecerClave(u.id, u.nombre);
  } else if (b.dataset.accion === 'borrar') {
    d.close();
    if (!(await confirmar(`¿Borrar la cuenta de ${u.nombre}?`, 'Se borran su historial, me gusta, playlists y su algoritmo. No se puede deshacer.'))) return;
    await api(`/api/admin/usuarios/${u.id}`, { method: 'DELETE' }).catch((x) => aviso(x.message));
    cargarUsuarios();
  }
});

$('#us-orden').addEventListener('change', (e) => {
  usOrden = e.target.value;
  pintarUsuarios();
});
$('#us-buscar').addEventListener('input', (e) => {
  usBusca = e.target.value;
  pintarUsuarios();
});
document.querySelectorAll('.us-filtros [data-filtro]').forEach((b) =>
  b.addEventListener('click', () => {
    usFiltro = b.dataset.filtro;
    document.querySelectorAll('.us-filtros [data-filtro]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    pintarUsuarios();
  }),
);
// Con la pestaña abierta, el estado "Conectado" se actualiza cada 30 s.
setInterval(() => {
  if (!$('[data-panel="usuarios"]').hidden) cargarUsuarios();
}, 30_000);

// ---------------- Borrar todas las canciones ----------------

/** El botón de ajustes (y con él "Borrar todas") solo existe para la cuenta de admin "zuih". */
const DUENO = 'zuih';
/** ¿Esta sesión del panel es la del dueño? Solo él borra cuentas, cambia contraseñas y cierra sesiones. */
let soyDueno = false;
function mostrarAjustes(nombre) {
  soyDueno = String(nombre ?? '').trim().toLowerCase() === DUENO;
  $('#ajustes').hidden = !soyDueno;
}
$('#ajustes').addEventListener('click', () => $('#d-ajustes').showModal());

$('#borrar-todo').addEventListener('click', () => {
  $('#d-ajustes').close();
  const d = $('#d-borrar-todo');
  const f = $('#f-borrar-todo');
  const n = Number($('#borrar-todo').dataset.total) || 0;
  $('#borrar-todo-titulo').textContent = `¿Borrar las ${n} ${n === 1 ? 'canción' : 'canciones'} del servidor?`;
  f.confirmar.value = '';
  $('#borrar-todo-si').disabled = true;
  $('.error', f).textContent = '';
  d.returnValue = '';
  d.showModal();
  f.confirmar.focus();
  f.confirmar.oninput = () => ($('#borrar-todo-si').disabled = f.confirmar.value.trim().toUpperCase() !== 'BORRAR');
  f.onsubmit = async (e) => {
    if (e.submitter?.value !== 'borrar') return;
    e.preventDefault();
    if (f.confirmar.value.trim().toUpperCase() !== 'BORRAR') return;
    $('#borrar-todo-si').disabled = true;
    try {
      const r = await api('/api/admin/canciones', { method: 'DELETE', body: { confirmar: 'BORRAR' } });
      d.close();
      aviso(`Se borraron ${r.borradas} ${r.borradas === 1 ? 'canción' : 'canciones'}`);
      cargarCanciones();
    } catch (x) {
      $('.error', f).textContent = x.message;
      $('#borrar-todo-si').disabled = false;
    }
  };
});

// ---------------- Sugerencias ----------------

const DOMINIOS_ENLACE = ['open.spotify.com', 'music.youtube.com', 'www.youtube.com'];

/** Misma regla que el servidor (src/enlaces.js): https y solo esos sitios. Devuelve la URL o null. */
function enlaceSugerenciaValido(texto) {
  if (!texto || String(texto).length > 300) return null;
  try {
    const u = new URL(String(texto));
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !DOMINIOS_ENLACE.includes(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
}

// ---------------- Reportes de canciones ----------------

const ESTADOS_REP = { pendiente: 'Pendiente', resuelto: 'Resuelto', descartado: 'Descartado' };

async function cargarReportes() {
  try {
    const lista = await api('/api/admin/reportes');
    const pendientes = lista.filter((r) => r.estado === 'pendiente').length;
    const c = $('#rep-contador');
    c.hidden = !pendientes;
    c.textContent = pendientes;
    $('#rep-vacio').hidden = lista.length > 0;
    $('#reportes').innerHTML = lista
      .map(
        (r) => `<li data-id="${r.id}" data-cancion="${esc(r.cancion)}" class="sug-${r.estado === 'pendiente' ? 'pendiente' : 'subida'}">
          <div class="principal">
            <div>${r.titulo ? `<b>${esc(r.titulo)}</b> · ${esc(r.artista)}${r.album ? ` <span class="meta">(${esc(r.album)})</span>` : ''}` : '<b>Canción borrada</b>'}${r.estado !== 'pendiente' ? `<span class="insignia">${ESTADOS_REP[r.estado]}</span>` : ''}</div>
            <div class="rep-comentario">${esc(r.comentario)}</div>
            <div class="meta">Reportada por ${esc(r.usuario ?? 'una cuenta borrada')} · ${fecha(r.creado)}</div>
          </div>
          ${r.titulo ? '<button class="link" data-accion="editar">Editar</button>' : ''}
          ${
            r.estado === 'pendiente'
              ? '<button class="link" data-accion="resuelto">Resuelto</button><button class="link" data-accion="descartado">Descartar</button>'
              : '<button class="link" data-accion="pendiente">Volver a pendiente</button><button class="link" data-accion="borrar">Borrar</button>'
          }
        </li>`,
      )
      .join('');
  } catch (x) {
    aviso(x.message);
  }
}

$('#reportes').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-accion]');
  if (!b) return;
  const li = b.closest('li[data-id]');
  if (b.dataset.accion === 'editar') {
    const c = canciones.find((x) => x.id === li.dataset.cancion);
    if (c) editar(c);
    else aviso('Abre primero la pestaña Música para cargar las canciones');
    return;
  }
  try {
    if (b.dataset.accion === 'borrar') await api(`/api/admin/reportes/${li.dataset.id}`, { method: 'DELETE' });
    else await api(`/api/admin/reportes/${li.dataset.id}`, { method: 'PATCH', body: { estado: b.dataset.accion } });
  } catch (x) {
    aviso(x.message);
  }
  cargarReportes();
});

const ESTADOS_SUG = { pendiente: 'Pendiente', subida: 'Subida', descartada: 'Descartada' };

async function cargarSugerencias() {
  try {
    const lista = await api('/api/admin/sugerencias');
    const pendientes = lista.filter((s) => s.estado === 'pendiente').length;
    const c = $('#sug-contador');
    c.hidden = !pendientes;
    c.textContent = pendientes;
    $('#sug-vacio').hidden = lista.length > 0;
    $('#sugerencias').innerHTML = lista
      .map(
        (s) => `<li data-id="${s.id}" class="sug-${s.estado}">
          <div class="principal">
            <div>${s.titulo ? `<b>${esc(s.titulo)}</b> · ${esc(s.artista)}` : s.artista ? `<b>${esc(s.artista)}</b>` : ''}<span class="sug-enlace"></span>${s.estado !== 'pendiente' ? `<span class="insignia">${ESTADOS_SUG[s.estado]}</span>` : ''}</div>
            <div class="meta">Sugerida por ${esc(s.usuario ?? 'una cuenta borrada')} · ${fecha(s.creada)}</div>
          </div>
          ${
            s.estado === 'pendiente'
              ? '<button class="link" data-accion="subida">Ya la subí</button><button class="link" data-accion="descartada">Descartar</button>'
              : '<button class="link" data-accion="pendiente">Volver a pendiente</button><button class="link" data-accion="borrar">Borrar</button>'
          }
        </li>`,
      )
      .join('');
    // El enlace se arma con createElement/textContent (nunca innerHTML con lo que escribió la persona) y solo si
    // vuelve a pasar la validación de dominio: no se confía en lo guardado.
    for (const s of lista) {
      const url = enlaceSugerenciaValido(s.enlace);
      if (!url) continue;
      const hueco = $(`li[data-id="${CSS.escape(String(s.id))}"] .sug-enlace`, $('#sugerencias'));
      if (!hueco) continue;
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = url.replace(/^https:\/\//, '');
      hueco.append(a);
    }
  } catch (x) {
    aviso(x.message);
  }
}

/** Canciones que esperan las playlists importadas de Spotify (solo para ver: se resuelven subiéndolas). */
async function cargarFaltantes() {
  try {
    const lista = await api('/api/admin/faltantes');
    $('#falt-titulo').hidden = $('#falt-ayuda').hidden = !lista.length;
    $('#faltantes').innerHTML = lista
      .map(
        (f) => `<li>
          <div class="principal">
            <div><b>${esc(f.titulo)}</b> · ${esc(f.artista)}</div>
            <div class="meta">${f.playlists === 1 ? 'En 1 playlist' : `En ${f.playlists} playlists`} de ${esc((f.usuarios ?? []).join(', '))}</div>
          </div>
        </li>`,
      )
      .join('');
  } catch (x) {
    aviso(x.message);
  }
}

$('#sugerencias').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-accion]');
  if (!b) return;
  const id = b.closest('li[data-id]').dataset.id;
  try {
    if (b.dataset.accion === 'borrar') await api(`/api/admin/sugerencias/${id}`, { method: 'DELETE' });
    else await api(`/api/admin/sugerencias/${id}`, { method: 'PATCH', body: { estado: b.dataset.accion } });
  } catch (x) {
    aviso(x.message);
  }
  cargarSugerencias();
});

// ---------------- Restablecer contraseña ----------------
// El panel ya no inventa la contraseña: genera un enlace de un solo uso (24 h) que se le manda a la persona, y
// ella pone la suya en /clave/. El código va después del "#" para que no quede en los registros de nadie.

function restablecerClave(id, nombre) {
  const d = $('#d-clave');
  const f = $('#f-clave');
  const err = $('.error', f);
  $('#clave-titulo').textContent = `Restablecer la contraseña de ${nombre}`;
  $('#clave-enlace').hidden = true;
  $('#clave-generar').textContent = 'Generar enlace';
  $('#clave-cerrar').textContent = 'Cancelar';
  f.enlace.value = '';
  err.textContent = '';
  d.returnValue = '';
  d.showModal();
  $('#clave-copiar').onclick = async () => {
    try {
      await navigator.clipboard.writeText(f.enlace.value);
      aviso('Enlace copiado');
    } catch {
      f.enlace.select(); // sin permiso para copiar: queda seleccionado para copiarlo a mano
    }
  };
  $('#clave-compartir').hidden = !navigator.share;
  $('#clave-compartir').onclick = () =>
    navigator.share({ title: 'Edowave', text: `Pon tu contraseña nueva de Edowave (${nombre}):`, url: f.enlace.value }).catch(() => {});
  f.onsubmit = async (e) => {
    if (e.submitter?.value !== 'generar') return;
    e.preventDefault();
    err.textContent = '';
    $('#clave-generar').disabled = true;
    try {
      const r = await api(`/api/admin/usuarios/${id}/enlace-clave`, { method: 'POST' });
      f.enlace.value = `${location.origin}/clave/#${r.token}`;
      const vence = new Date(r.vence).toLocaleString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      $('#clave-vence').textContent = `Vence el ${vence}. Mándaselo en privado: quien lo abra puede cambiar la contraseña. Si generas otro, este deja de servir.`;
      $('#clave-enlace').hidden = false;
      $('#clave-generar').textContent = 'Generar otro';
      $('#clave-cerrar').textContent = 'Listo';
      f.enlace.select();
    } catch (x) {
      err.textContent = x.message;
    } finally {
      $('#clave-generar').disabled = false;
    }
  };
}

inicio().catch((x) => aviso(x.message));

// ---------------- Estadísticas ----------------

let estDias = 7;
let estDatos = null;
let estOrden = 'reproducciones';
const ESTAD_COLUMNAS = [
  ['reproducciones', 'Reprod.', 'Veces que sonó'],
  ['oyentes', 'Oyentes', 'Personas distintas'],
  ['retencion', 'Retención %', 'Escuchas completas'],
  ['pct_escuchado', 'Escuchado %', 'Cuánto de la canción se escucha, en promedio'],
  ['skip5', 'Skip <5 s %', 'Saltadas en los primeros 5 segundos'],
  ['skip30', 'Skip %', 'Saltadas antes de la mitad (o 30 s)'],
  ['salto_en', 'Salto en', 'Segundo en que la suelen saltar'],
  ['repiten', 'Repiten', 'Personas que la pusieron en 2 días distintos o más'],
  ['tasa_megusta', '👍 %', 'Me gusta sobre oyentes'],
  ['tasa_nomegusta', '👎 %', 'No me gusta sobre oyentes'],
  ['guardan', 'Guardan', 'Personas que la tienen en una playlist'],
  ['impresiones', 'Mostrada', 'Veces que se mostró (accesos directos y búsqueda)'],
  ['ctr', 'CTR %', 'Tocada desde accesos/búsqueda sobre veces mostrada'],
  ['pais_top', 'País', 'País desde donde más se escucha'],
];
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const num = (v, suf = '') => (v === null || v === undefined || v === '' ? '–' : `${v}${suf}`);
const segs = (s) => (s === null || s === undefined ? '–' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const bandera = (cc) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0))) + ' ' + cc : num(cc));

document.querySelectorAll('.est-periodo [data-dias]').forEach((b) =>
  b.addEventListener('click', () => {
    estDias = Number(b.dataset.dias);
    document.querySelectorAll('.est-periodo [data-dias]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    cargarEstadisticas();
  }),
);

async function cargarEstadisticas() {
  const cuerpo = $('#est-cuerpo');
  try {
    estDatos = await api(`/api/admin/estadisticas?dias=${estDias}`);
    pintarEstadisticas();
  } catch (x) {
    cuerpo.innerHTML = `<p class="vacio">${esc(x.message)}</p>`;
  }
}

function tarjeta(titulo, valor, nota = '') {
  return `<div class="est-tarjeta"><div class="est-valor">${esc(valor)}</div><div class="est-titulo">${esc(titulo)}</div>${nota ? `<div class="meta">${esc(nota)}</div>` : ''}</div>`;
}

function pintarEstadisticas() {
  const d = estDatos;
  const r = d.resumen ?? {};
  const a = d.activos ?? {};
  const u = d.uso ?? {};
  const v = d.vuelven ?? {};
  const pctVuelven = v.antes ? Math.round((100 * v.volvieron) / v.antes) : null;
  const radio = (d.origenes ?? []).find((o) => o.origen === 'radio');

  const tarjetas = [
    tarjeta('Reproducciones', num(r.escuchas), `${num(r.horas_escuchadas)} h escuchadas`),
    tarjeta('Retención', num(r.retencion, ' %'), 'canciones escuchadas completas'),
    tarjeta('Skip', num(r.skip30, ' %'), `${num(r.skip5, ' %')} antes de 5 s`),
    tarjeta('Activos hoy / semana / mes', `${num(a.dia)} / ${num(a.semana)} / ${num(a.mes)}`, `de ${num(a.registrados)} cuentas`),
    tarjeta('Vuelven', pctVuelven === null ? '–' : `${pctVuelven} %`, 'de la semana pasada, escucharon esta semana'),
    tarjeta('Tiempo en la app', `${num(u.horas_abierta)} h`, `${num(u.min_por_dia_usuario)} min por persona al día`),
    tarjeta('En la app sin música', `${num(u.horas_sin_musica)} h`, `${num(u.horas_sonando)} h con música sonando`),
    tarjeta('Radio', radio ? `${radio.retencion} %` : '–', radio ? `completas · ${radio.skip} % saltadas` : 'sin datos aún'),
    tarjeta('Escuchar juntos', num(d.juntos?.sesiones), `${num(d.juntos?.minutos_promedio)} min en promedio`),
  ].join('');

  const filas = [...(d.canciones ?? [])].sort((x, y) => {
    const a1 = x[estOrden];
    const b1 = y[estOrden];
    if (typeof a1 === 'string' && isNaN(Number(a1))) return String(a1 ?? '').localeCompare(String(b1 ?? ''));
    return (Number(b1) || 0) - (Number(a1) || 0);
  });
  const tabla = `
    <div class="tabla-wrap"><table class="tabla est-tabla">
      <thead><tr><th>Canción</th>${ESTAD_COLUMNAS.map(([k, t, ayuda]) => `<th title="${esc(ayuda)}"><button class="link est-ordenar ${estOrden === k ? 'activo' : ''}" data-orden="${k}">${esc(t)}</button></th>`).join('')}</tr></thead>
      <tbody>${
        filas.length
          ? filas
              .map(
                (c) =>
                  `<tr><td><div class="principal"><b>${esc(c.titulo)}</b><div class="meta">${esc(c.artista)}</div></div></td>${ESTAD_COLUMNAS.map(([k]) => {
                    const val = c[k];
                    const txt = k === 'salto_en' ? segs(val) : k === 'pais_top' ? bandera(val) : num(val);
                    return `<td class="num">${esc(txt)}</td>`;
                  }).join('')}</tr>`,
              )
              .join('')
          : `<tr><td colspan="${ESTAD_COLUMNAS.length + 1}" class="vacio">Todavía no hay escuchas en este período.</td></tr>`
      }</tbody>
    </table></div>`;

  // Mapa de calor: escuchas por día de la semana y hora.
  const max = Math.max(1, ...(d.horas ?? []).map((h) => h.n));
  const celda = (dia, hora) => {
    const n = (d.horas ?? []).find((h) => h.dia === dia && h.hora === hora)?.n ?? 0;
    return `<span class="est-celda" style="--i:${(n / max).toFixed(2)}" title="${DIAS_SEMANA[dia - 1]} ${hora}:00 · ${n} escuchas"></span>`;
  };
  const calor = `<div class="est-calor">
      <span></span>${Array.from({ length: 24 }, (_, h) => `<span class="est-hora">${h % 3 === 0 ? h : ''}</span>`).join('')}
      ${DIAS_SEMANA.map((nombre, i) => `<span class="est-dia">${nombre}</span>${Array.from({ length: 24 }, (_, h) => celda(i + 1, h)).join('')}`).join('')}
    </div><p class="meta">Hora de ${esc(d.zona)}.</p>`;

  const lista = (items, fn, vacio) => (items?.length ? `<ul class="est-lista">${items.map(fn).join('')}</ul>` : `<p class="vacio">${vacio}</p>`);

  $('#est-cuerpo').innerHTML = `
    <div class="est-tarjetas">${tarjetas}</div>
    <h3>Canciones <span class="meta">(toca una columna para ordenar)</span></h3>
    ${tabla}
    <div class="est-grilla">
      <section><h3>Cuándo escuchan</h3>${calor}</section>
      <section><h3>Desde dónde ponen la música</h3>${lista(d.origenes, (o) => `<li><b>${esc(o.origen)}</b><span>${o.escuchas} · ${o.retencion} % completas · ${o.skip} % saltadas</span></li>`, 'Sin datos aún.')}</section>
      <section><h3>Recomendaciones</h3><p class="meta">Primera reacción dentro de 14 días. Acierto: terminadas sobre escuchadas.</p>${lista(d.recomendaciones, (r) => `<li><b>${esc(r.lista)} · ${esc(r.motivo)}</b><span>${r.mostradas} recomendadas · ${r.escuchadas} escuchadas · ${num(r.acierto, ' %')} acierto · ${r.saltadas} saltadas</span></li>`, 'Sin datos aún (empieza a contar desde ahora).')}</section>
      <section><h3>Países</h3>${lista(d.paises, (p) => `<li><b>${esc(bandera(p.pais))}</b><span>${p.escuchas} escuchas · ${p.oyentes} personas</span></li>`, 'Sin datos aún (empieza a contar desde ahora).')}</section>
      <section><h3>Aparatos</h3>${lista(d.aparatos, (p) => `<li><b>${esc(p.aparato)}</b><span>${p.usuarios} personas · ${p.horas} h · versión ${esc(p.ultima_version ?? '–')}</span></li>`, 'Sin datos aún (empieza a contar desde ahora).')}</section>
      <section><h3>Búsquedas sin resultado</h3><p class="meta">Lo que buscan y no está: ideas de qué subir.</p>${lista(d.vacias, (b) => `<li><b>${esc(b.texto)}</b><span>${b.veces} ${b.veces === 1 ? 'vez' : 'veces'}</span></li>`, 'Nadie ha buscado algo que no esté.')}</section>
      <section><h3>Nunca escuchadas (${num(d.nunca?.n)})</h3>${lista(d.nunca?.lista, (c) => `<li><b>${esc(c.titulo)}</b><span>${esc(c.artista)}</span></li>`, 'Todas se han escuchado al menos una vez.')}</section>
    </div>`;

  document.querySelectorAll('.est-ordenar').forEach((b) =>
    b.addEventListener('click', () => {
      estOrden = b.dataset.orden;
      pintarEstadisticas();
    }),
  );
}


// ---------------- Categorías (meme / anime / OST de videojuego) ----------------

const NOMBRE_CAT = { meme: 'Meme', anime: 'Anime', 'ost-videojuego': 'OST de videojuego' };
let catSugerencias = [];

async function cargarCategorias() {
  try {
    const r = await api('/api/admin/categorias/sugerencias');
    catSugerencias = r.sugerencias;
    const c = $('#cat-contador');
    c.hidden = !r.total;
    c.textContent = r.total;
    $('#cat-vacio').hidden = r.total > 0;
    // Agrupadas por categoría y artista: así se aceptan de una todas las de un artista (o un álbum entero).
    const grupos = new Map();
    for (const s of r.sugerencias) {
      const k = `${s.categoria}|${s.artista}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(s);
    }
    $('#cat-grupos').innerHTML = [...grupos.values()]
      .map((g) => {
        const ids = g.map((s) => s.id).join(',');
        return `<section class="cat-grupo">
          <div class="cat-grupo-cab">
            <div><span class="insignia cat-${esc(g[0].categoria)}">${esc(NOMBRE_CAT[g[0].categoria] ?? g[0].categoria)}</span> <b>${esc(g[0].artista)}</b> <span class="meta">· ${g.length} ${g.length === 1 ? 'canción' : 'canciones'}</span></div>
            ${g.length > 1 ? `<div><button class="link" data-cat="aceptar" data-ids="${ids}">Aceptar todas</button><button class="link" data-cat="rechazar" data-ids="${ids}">Rechazar todas</button></div>` : ''}
          </div>
          <ul class="tarjetas">${g
            .map(
              (s) => `<li>
                <div class="principal">
                  <div><b>${esc(s.titulo)}</b>${s.album ? ` · ${esc(s.album)}` : ''}</div>
                  <div class="meta">${esc(s.motivo)}</div>
                </div>
                <button class="link" data-cat="aceptar" data-ids="${s.id}">Aceptar</button>
                <button class="link" data-cat="rechazar" data-ids="${s.id}">Rechazar</button>
              </li>`,
            )
            .join('')}</ul>
        </section>`;
      })
      .join('');
    if (r.total > r.sugerencias.length) {
      $('#cat-grupos').insertAdjacentHTML('beforeend', `<p class="info">Se muestran ${r.sugerencias.length} de ${r.total}: al revisar estas aparecen las siguientes.</p>`);
    }
  } catch (x) {
    aviso(x.message);
  }
}

$('#cat-grupos').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-cat]');
  if (!b) return;
  const ids = b.dataset.ids.split(',').map(Number);
  b.disabled = true;
  try {
    const r = await api('/api/admin/categorias/sugerencias', { method: 'POST', body: { ids, accion: b.dataset.cat } });
    aviso(b.dataset.cat === 'aceptar' ? `${r.n} ${r.n === 1 ? 'canción marcada' : 'canciones marcadas'}` : `${r.n} ${r.n === 1 ? 'sugerencia rechazada' : 'sugerencias rechazadas'}`);
    await cargarCategorias();
  } catch (x) {
    b.disabled = false;
    aviso(x.message);
  }
});

// Doble clic en cualquier parte de la fila: abre el editor (igual que el botón Editar).
$('#tabla').addEventListener('dblclick', (e) => {
  if (e.target.closest('button, a, input')) return;
  const tr = e.target.closest('tbody tr[data-id]');
  tr?.querySelector('button[data-accion="editar"]')?.click();
});


// ---------------- Artistas: colaboraciones y nombres escritos distinto ----------------

let artSug = { colaboraciones: [], nombres: [] };
const MAX_ART = 300; // se muestran de a tantas (al decidir, aparecen las siguientes)

async function cargarArtistas() {
  try {
    artSug = await api('/api/admin/artistas/sugerencias');
    const total = artSug.colaboraciones.length + artSug.nombres.length;
    const c = $('#art-contador');
    c.hidden = !total;
    c.textContent = total;
    $('#art-colab-n').textContent = artSug.colaboraciones.length ? `· ${artSug.colaboraciones.length}` : '';
    $('#art-nombres-n').textContent = artSug.nombres.length ? `· ${artSug.nombres.length}` : '';
    $('#art-colab-vacio').hidden = artSug.colaboraciones.length > 0;
    $('#art-nombres-vacio').hidden = artSug.nombres.length > 0;
    // Artistas con varias colaboraciones (Alvaro Diaz con Feid, con Mora, con Quevedo…): se separan todas de una.
    const porPrincipal = new Map();
    for (const g of artSug.colaboraciones) porPrincipal.set(g.principal, (porPrincipal.get(g.principal) ?? 0) + 1);
    const varios = [...porPrincipal.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
    $('#art-colab-todas').innerHTML = varios.length
      ? `<span class="meta">Separar todas las de:</span> ${varios
          .slice(0, 40)
          .map(([p, n]) => `<button class="pill-mini" data-todas="${esc(p)}">${esc(p)} (${n})</button>`)
          .join(' ')}`
      : '';
    $('#art-colab').innerHTML = artSug.colaboraciones
      .slice(0, MAX_ART)
      .map(
        (g, i) => `<li data-i="${i}">
          <div class="principal">
            <div><b>${esc(g.original)}</b> <span class="meta">· ${g.n} ${g.n === 1 ? 'canción' : 'canciones'}</span>${g.musicbrainz ? ' <span class="insignia" title="MusicBrainz los anota como artistas separados">colaboración según MusicBrainz</span>' : ''}</div>
            <div class="meta">Quedaría: <b>${esc(g.principal)}</b> – ${esc(g.ejemplos[0] ?? '')} <i>(con ${esc(g.invitados.join(' y '))})</i></div>
            <div class="meta">Solos en la biblioteca: ${g.solos.map((s) => `${esc(s.nombre)} (${s.n})`).join(' · ')}</div>
          </div>
          <button class="link" data-art="separar">Separar</button>
          <button class="link" data-art="grupo">Es un grupo</button>
        </li>`,
      )
      .join('');
    $('#art-nombres').innerHTML = artSug.nombres
      .slice(0, MAX_ART)
      .map(
        (g, i) => `<li data-i="${i}">
          <div class="principal">
            <div>${g.escritos.map((e) => `<b>${esc(e.nombre)}</b> <span class="meta">(${e.n})</span>`).join(' · ')}</div>
            <div class="meta">Usar: <select class="art-elegir">${g.escritos.map((e) => `<option value="${esc(e.nombre)}">${esc(e.nombre)}</option>`).join('')}</select></div>
          </div>
          <button class="link" data-art="unificar">Unificar</button>
          <button class="link" data-art="distintos">Son distintos</button>
        </li>`,
      )
      .join('');
  } catch (x) {
    aviso(x.message);
  }
}

for (const lista of ['#art-colab', '#art-nombres']) {
  $(lista).addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-art]');
    if (!b) return;
    const li = b.closest('li[data-i]');
    const g = (lista === '#art-colab' ? artSug.colaboraciones : artSug.nombres)[Number(li.dataset.i)];
    if (!g) return;
    const accion = b.dataset.art;
    const body =
      accion === 'separar' ? { accion, clave: g.clave, principal: g.principal, invitados: g.invitados }
      : accion === 'grupo' ? { accion, clave: g.clave, original: g.original }
      : accion === 'unificar' ? { accion, clave: g.clave, principal: $('.art-elegir', li).value }
      : { accion, clave: g.clave, original: g.escritos[0].nombre };
    b.disabled = true;
    try {
      const r = await api('/api/admin/artistas', { method: 'POST', body });
      aviso(accion === 'separar' || accion === 'unificar' ? `${r.n} ${r.n === 1 ? 'canción cambiada' : 'canciones cambiadas'}` : 'Listo: no se volverá a sugerir');
      li.remove();
      if (accion === 'separar' || accion === 'unificar') cargarCanciones();
      cargarArtistas();
    } catch (x) {
      b.disabled = false;
      aviso(x.message);
    }
  });
}

$('#art-colab-todas').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-todas]');
  if (!b) return;
  const lista = artSug.colaboraciones.filter((g) => g.principal === b.dataset.todas);
  if (!(await confirmar(`¿Separar las ${lista.length} colaboraciones de ${b.dataset.todas}?`, 'Cada una queda como "' + b.dataset.todas + ' – canción (con …)". Revisa antes que ninguna sea un grupo.', 'Separar todas'))) return;
  b.disabled = true;
  let n = 0;
  try {
    for (const g of lista) n += (await api('/api/admin/artistas', { method: 'POST', body: { accion: 'separar', clave: g.clave, principal: g.principal, invitados: g.invitados } })).n;
    aviso(`${n} ${n === 1 ? 'canción cambiada' : 'canciones cambiadas'}`);
  } catch (x) {
    aviso(x.message);
  }
  cargarCanciones();
  cargarArtistas();
});
