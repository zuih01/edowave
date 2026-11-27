import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { closeOverlay, openOverlay } from '../nav';
import { crearCuenta, entrar, ErrorServidor, esAppNativa, revisarRegistro, useCuenta } from '../server/cuenta';
import { escritorioActivo } from '../escritorio/activo';

const esAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
import { BackIcon, CheckIcon, EyeIcon, EyeOffIcon } from './Icons';
import { useExit } from './useExit';

/**
 * Entrar a la cuenta del servidor de música, o crear una con un código de invitación.
 *
 * - Primero solo dos opciones grandes: "Iniciar sesión" o "Tengo un código" (más "Ahora no", discreto).
 * - Crear cuenta va en 3 pasos cortos con una barra que avanza (efecto de cercanía a la meta).
 * - Los errores se dicen debajo del campo que hay que corregir, con palabras simples.
 * - Flexible con lo que escribe la persona (ley de Postel): mayúsculas, espacios, "@", un correo completo
 *   o un código sin guion se aceptan igual.
 */
const usePantalla = create<{ open: boolean; codigo: string | null }>(() => ({ open: false, codigo: null }));

export function abrirCuenta(codigo: string | null = null) {
  if (usePantalla.getState().open) return;
  usePantalla.setState({ open: true, codigo });
  openOverlay(() => usePantalla.setState({ open: false }));
}

/**
 * Link de invitación de un amigo: musica.empanados.io/?invitar=ABCD-2345. Se lee una vez al abrir la app y se
 * quita de la barra de direcciones (así no queda en la app instalada).
 */
const invitacionDelLink = (() => {
  try {
    const u = new URL(location.href);
    const c = u.searchParams.get('invitar');
    if (!c) return null;
    u.searchParams.delete('invitar');
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    return c;
  } catch {
    return null;
  }
})();

/** Al abrir la app: si llegó con un link de invitación, va directo a crear la cuenta con el código puesto. */
export function pedirCuentaAlAbrir() {
  const c = useCuenta.getState();
  if (c.token) return;
  if (invitacionDelLink) abrirCuenta(invitacionDelLink);
  else if (!c.omitida || !esAppNativa) abrirCuenta();
}

// ---------------- Ser flexible con lo que se escribe ----------------

/** "  @Ana ", "ana@gmail.com" o "Ana" → "Ana" (el servidor ya ignora mayúsculas). */
export function limpiarUsuario(v: string) {
  let s = v.normalize('NFC').trim().replace(/^@+/, '');
  const arroba = s.indexOf('@');
  if (arroba > 0) s = s.slice(0, arroba); // escribió su correo: se usa lo de antes de la @
  return s.replace(/\s+/g, '');
}

/** "abcd 1234", "ABCD1234" o "abcd-1234" → "ABCD-1234". */
export function limpiarCodigo(v: string) {
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

const USUARIO_OK = /^[\p{L}\p{N}._-]{3,24}$/u;
const REGLAS = [
  { texto: '8 caracteres o más', ok: (c: string) => c.length >= 8 },
  { texto: 'Un número', ok: (c: string) => /\d/.test(c) },
];

type Paso = 'bienvenida' | 'inicio' | 'entrar' | 'codigo' | 'nombre' | 'clave';
type Campo = 'codigo' | 'nombre' | 'clave' | 'general';
const PASOS_CREAR: Paso[] = ['codigo', 'nombre', 'clave'];

export function CuentaScreen() {
  const open = usePantalla((s) => s.open);
  const codigoDelLink = usePantalla((s) => s.codigo);
  const { shown, closing } = useExit(open || null, 200);
  const [paso, setPaso] = useState<Paso>('inicio');
  const [nombre, setNombre] = useState('');
  const [clave, setClave] = useState('');
  const [codigo, setCodigo] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [errores, setErrores] = useState<Partial<Record<Campo, string>>>({});
  const [enviando, setEnviando] = useState(false);
  const primerCampo = useRef<HTMLInputElement>(null);
  // Enlace a la última app de Android publicada (la sube scripts/compilar-apk.ps1 -Publicar).
  const [apk, setApk] = useState<string | null>(null);
  useEffect(() => {
    if (esAppNativa || !open) return;
    fetch('/android/version.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => v?.apk && setApk(`/android/${encodeURIComponent(v.apk)}`))
      .catch(() => {});
  }, [open]);
  /** Último usuario que el servidor confirmó como libre (para no dejar pasar uno tomado). */
  const [libre, setLibre] = useState<string | null>(null);
  const usuario = limpiarUsuario(nombre);

  // Mientras escribe el usuario, se pregunta al servidor si está libre (con una pequeña pausa).
  useEffect(() => {
    if (paso !== 'nombre' || !USUARIO_OK.test(usuario) || libre === usuario) return;
    let vigente = true;
    const t = setTimeout(() => {
      revisarRegistro(codigo, usuario).then(
        () => vigente && setLibre(usuario),
        (x: ErrorServidor) => {
          if (vigente && x.status === 409) setErrores({ nombre: 'Ese usuario ya existe. Prueba con otro.' });
        },
      );
    }, 450);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [paso, usuario, codigo, libre]);

  useEffect(() => {
    if (paso !== 'inicio') primerCampo.current?.focus();
  }, [paso]);

  useEffect(() => {
    if (!open) return;
    // La pantalla "Descarga la app" es solo para la página web en el teléfono; la app de Android y la de PC van
    // directo a iniciar sesión.
    setPaso(codigoDelLink ? 'codigo' : !esAppNativa && !escritorioActivo() ? 'bienvenida' : 'inicio');
    if (codigoDelLink) setCodigo(limpiarCodigo(codigoDelLink));
    setClave('');
    setErrores({});
    setVerClave(false);
  }, [open, codigoDelLink]);

  if (!shown) return null;

  const ir = (p: Paso) => {
    setErrores({});
    setVerClave(false);
    if (p === 'inicio') setClave(''); // no se pasa la contraseña de "Iniciar sesión" a "Crear cuenta"
    setPaso(p);
  };
  const error = (campo: Campo, texto: string) => setErrores({ [campo]: texto });
  const editar = (campo: Campo, set: (v: string) => void) => (v: string) => {
    set(v);
    if (errores[campo] || errores.general) setErrores({});
  };

  const reglasOk = REGLAS.every((r) => r.ok(clave));
  const iCrear = PASOS_CREAR.indexOf(paso);
  const creando = iCrear >= 0;

  // Barra de avance: arranca con algo ya hecho y se llena del todo cuando la contraseña cumple las reglas.
  const avance = !creando ? 0 : iCrear === 2 ? (reglasOk ? 1 : 0.78) : [0.2, 0.5][iCrear];

  const terminar = () => {
    setClave('');
    setCodigo('');
    setVerClave(false);
    closeOverlay();
  };

  const fallo = (x: unknown) => {
    const e = x as ErrorServidor;
    const msj = e.message ?? '';
    if (e.status === 0) return error('general', 'No hay conexión con el servidor. Revisa que estés en el Wi-Fi de la casa.');
    if (e.status === 429) return error('general', 'Muchos intentos seguidos. Espera 5 minutos y vuelve a probar.');
    if (/código/i.test(msj)) {
      setPaso('codigo');
      return error('codigo', 'Este código no sirve: ya se usó o venció. Pide uno nuevo.');
    }
    if (e.status === 409) {
      setPaso('nombre');
      return error('nombre', 'Ese usuario ya existe. Prueba con otro.');
    }
    if (/administrador/i.test(msj)) return error('nombre', 'Esa es la cuenta del panel de administración. Aquí entra con tu cuenta normal.');
    if (e.status === 401) return error('clave', 'El usuario o la contraseña no coinciden.');
    return error('general', msj || 'Algo salió mal. Vuelve a intentarlo.');
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    if (paso === 'entrar') {
      if (!usuario) return error('nombre', 'Escribe tu usuario.');
      if (!clave) return error('clave', 'Escribe tu contraseña.');
      setEnviando(true);
      try {
        await entrar(usuario, clave);
        terminar();
      } catch (x) {
        fallo(x);
      } finally {
        setEnviando(false);
      }
      return;
    }
    if (paso === 'codigo') {
      if (codigo.replace('-', '').length < 8) return error('codigo', 'El código tiene 8 letras o números, como ABCD-2345.');
      setEnviando(true);
      try {
        await revisarRegistro(codigo); // el código se revisa aquí, no al final
        ir('nombre');
      } catch (x) {
        fallo(x);
      } finally {
        setEnviando(false);
      }
      return;
    }
    if (paso === 'nombre') {
      if (usuario.length < 3) return error('nombre', 'Usa al menos 3 letras o números.');
      if (usuario.length > 24) return error('nombre', 'Usa 24 caracteres como máximo.');
      if (!USUARIO_OK.test(usuario)) return error('nombre', 'Usa solo letras, números, punto, guion o guion bajo.');
      if (errores.nombre) return; // ya se sabe que está tomado
      if (libre !== usuario) {
        setEnviando(true);
        try {
          await revisarRegistro(codigo, usuario);
          setLibre(usuario);
        } catch (x) {
          return fallo(x);
        } finally {
          setEnviando(false);
        }
      }
      return ir('clave');
    }
    if (paso === 'clave') {
      if (!reglasOk) {
        const falta = REGLAS.filter((r) => !r.ok(clave)).map((r) => r.texto.toLowerCase());
        return error('clave', `A tu contraseña le falta: ${falta.join(' y ')}.`);
      }
      setEnviando(true);
      try {
        await crearCuenta(codigo, usuario, clave);
        terminar();
      } catch (x) {
        fallo(x);
      } finally {
        setEnviando(false);
      }
    }
  };

  const ahoraNo = () => {
    useCuenta.setState({ omitida: true });
    closeOverlay();
  };

  const atras = () => (paso === 'entrar' || paso === 'codigo' ? ir('inicio') : ir(PASOS_CREAR[iCrear - 1]));

  // ---------------- Pantalla inicial: solo dos opciones ----------------
  // Web (no la app): primero la pantalla para descargar la app de Android; abajo, seguir en la web.
  if (paso === 'bienvenida') {
    return (
      <div className={`cuenta-screen bienvenida ${closing ? 'closing' : ''}`}>
        <div className="bienvenida-box">
          <div className="cuenta-logo bienvenida-logo" aria-hidden="true" />
          <h1>Descarga la app de Edowave</h1>
          <p className="bienvenida-texto">Tu música, recomendada para ti. En Android suena con la pantalla apagada y se actualiza sola.</p>
          <a className="bienvenida-descargar" href={apk ?? '#'} download onClick={(e) => !apk && e.preventDefault()} aria-disabled={!apk}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M11 4h2v9.2l3.3-3.3 1.4 1.4L12 17l-5.7-5.7 1.4-1.4 3.3 3.3zM5 19h14v2H5z" />
            </svg>
            {apk ? (esAndroid ? 'Descargar para Android' : 'Descargar la app (Android)') : 'Preparando la descarga…'}
          </a>
          <button className="bienvenida-web" onClick={() => ir('inicio')}>
            Usar en la web
          </button>
        </div>
      </div>
    );
  }

  if (paso === 'inicio') {
    return (
      <div className={`cuenta-screen ${closing ? 'closing' : ''}`}>
        <div className="cuenta-box cuenta-inicio">
          <div className="cuenta-logo" aria-hidden="true" />
          <h1>Tu música, en todos tus dispositivos</h1>
          <button className="cuenta-btn" onClick={() => ir('entrar')}>
            Iniciar sesión
          </button>
          <button className="cuenta-btn secundario" onClick={() => ir('codigo')}>
            Tengo un código
          </button>
          <button className="cuenta-link" onClick={ahoraNo}>
            Ahora no
          </button>
        </div>
      </div>
    );
  }

  const titulo = { entrar: 'Inicia sesión', codigo: 'Tu código de invitación', nombre: 'Elige tu usuario', clave: 'Crea tu contraseña' }[paso];
  const boton = enviando ? 'Un momento…' : paso === 'entrar' ? 'Entrar' : paso === 'clave' ? 'Crear cuenta' : 'Continuar';

  const campoClave = (
    <Campo id="cuenta-clave" etiqueta="Contraseña" error={errores.clave}>
      <div className="cuenta-clave">
        <input
          ref={paso === 'clave' ? primerCampo : undefined}
          id="cuenta-clave"
          type={verClave ? 'text' : 'password'}
          value={clave}
          onChange={(e) => editar('clave', setClave)(e.target.value)}
          autoComplete={paso === 'entrar' ? 'current-password' : 'new-password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!errores.clave}
          aria-describedby={paso === 'clave' ? 'cuenta-reglas' : undefined}
        />
        <button
          type="button"
          className="cuenta-ojo"
          onClick={() => setVerClave((v) => !v)}
          aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={verClave}
        >
          {verClave ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {paso === 'clave' && (
        <ul className="cuenta-reglas" id="cuenta-reglas">
          {REGLAS.map((r) => (
            <li key={r.texto} className={r.ok(clave) ? 'ok' : errores.clave ? 'falta' : ''}>
              <span className="cuenta-check">{r.ok(clave) && <CheckIcon size={14} />}</span>
              {r.texto}
            </li>
          ))}
        </ul>
      )}
    </Campo>
  );

  return (
    <div className={`cuenta-screen ${closing ? 'closing' : ''}`}>
      <form className="cuenta-box" onSubmit={enviar} noValidate>
        <div className="cuenta-arriba">
          <button type="button" className="cuenta-atras" onClick={atras} aria-label="Volver">
            <BackIcon />
          </button>
          {creando && (
            <span className="cuenta-paso">{iCrear === 2 ? 'Último paso' : `Paso ${iCrear + 1} de 3`}</span>
          )}
        </div>
        {creando && (
          <div className="cuenta-avance" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={iCrear + 1}>
            <span style={{ transform: `scaleX(${avance})` }} />
          </div>
        )}

        <h1>{titulo}</h1>

        {paso === 'codigo' && (
          <Campo id="cuenta-codigo" etiqueta="Código" error={errores.codigo}>
            <input
              ref={primerCampo}
              id="cuenta-codigo"
              className="cuenta-codigo"
              value={codigo}
              onChange={(e) => editar('codigo', setCodigo)(limpiarCodigo(e.target.value))}
              placeholder="ABCD-2345"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={!!errores.codigo}
            />
          </Campo>
        )}

        {(paso === 'entrar' || paso === 'nombre') && (
          <Campo
            id="cuenta-nombre"
            etiqueta="Usuario"
            error={errores.nombre}
            ayuda={
              paso === 'nombre' && libre === usuario
                ? `Disponible${usuario !== nombre.trim() ? ` · te llamarás ${usuario}` : ''}`
                : usuario && usuario !== nombre.trim()
                  ? `${paso === 'entrar' ? 'Entrarás' : 'Te llamarás'} como ${usuario}`
                  : undefined
            }
            ayudaOk={paso === 'nombre' && libre === usuario}
          >
            <input
              ref={primerCampo}
              id="cuenta-nombre"
              value={nombre}
              onChange={(e) => editar('nombre', setNombre)(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={!!errores.nombre}
            />
          </Campo>
        )}

        {paso === 'clave' && <input className="oculto" type="text" autoComplete="username" value={usuario} readOnly tabIndex={-1} aria-hidden="true" />}

        {(paso === 'entrar' || paso === 'clave') && campoClave}

        {errores.general && (
          <p className="cuenta-error general" role="alert">
            {errores.general}
          </p>
        )}

        <button className="cuenta-btn" disabled={enviando}>
          {boton}
        </button>
      </form>
    </div>
  );
}

function Campo({ id, etiqueta, error, ayuda, ayudaOk, children }: { id: string; etiqueta: string; error?: string; ayuda?: string; ayudaOk?: boolean; children: React.ReactNode }) {
  return (
    <div className={`cuenta-campo ${error ? 'mal' : ''}`}>
      <label className="cuenta-etiqueta" htmlFor={id}>
        {etiqueta}
      </label>
      {children}
      {error ? (
        <p className="cuenta-error" role="alert">
          {error}
        </p>
      ) : (
        ayuda && (
          <p className={`cuenta-ayuda ${ayudaOk ? 'ok' : ''}`}>
            {ayudaOk && <CheckIcon size={16} />}
            {ayuda}
          </p>
        )
      )}
    </div>
  );
}
