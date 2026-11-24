import { cambiarVistaWeb, escritorioActivo, esWeb, vistaWeb, type VistaWeb } from './activo';
import { cambiarTema, TEMAS, temasDisponibles, useTema } from './temas';

/** Configuración → Tema: en todas las interfaces (PC, web, iPhone y Android). Temas armados, sin editor. */
export function TemasPc() {
  const tema = useTema();
  if (!temasDisponibles()) return null;
  if (escritorioActivo()) return <TemasFilaPc />;
  return (
    <>
      <h3 className="settings-group">Tema</h3>
      <div className="temas-lista" role="radiogroup" aria-label="Tema de la interfaz">
        {TEMAS.map((t) => (
          <button
            key={t.id}
            className={`tema-op ${tema === t.id ? 'on' : ''}`}
            role="radio"
            aria-checked={tema === t.id}
            onClick={() => cambiarTema(t.id)}
          >
            <span className="tema-muestra" aria-hidden="true">
              <i className="m-fondo" style={{ background: t.muestra[0] }} />
              <i className="m-panel" style={{ background: t.muestra[1], opacity: 0.55 }} />
              <i className="m-centro" style={{ background: `linear-gradient(180deg, ${t.muestra[1]}, ${t.muestra[0]})` }} />
              <i className="m-punto" style={{ background: t.muestra[2] }} />
            </span>
            <span>
              <b>{t.nombre}</b>
              <small>{t.detalle}</small>
            </span>
          </button>
        ))}
      </div>
      <VistaWebSelector />
    </>
  );
}

const VISTAS: { id: VistaWeb; nombre: string }[] = [
  { id: 'auto', nombre: 'Automática' },
  { id: 'pc', nombre: 'PC' },
  { id: 'telefono', nombre: 'Teléfono' },
];

/** Solo en la web: elegir a mano la versión de PC o de teléfono (por defecto, según el aparato). */
function VistaWebSelector() {
  if (!esWeb) return null;
  const actual = vistaWeb();
  return (
    <>
      <h3 className="settings-group">Vista</h3>
      <p className="vista-nota">Automática usa la de PC en un computador y la de teléfono en el celular o la tablet.</p>
      <div className="vista-opciones" role="radiogroup" aria-label="Vista de la página">
        {VISTAS.map((v) => (
          <button
            key={v.id}
            className={`pill ${actual === v.id ? 'primary' : ''}`}
            role="radio"
            aria-checked={actual === v.id}
            onClick={() => actual !== v.id && cambiarVistaWeb(v.id)}
          >
            {v.nombre}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * PC: Configuración ordenada como Spotify. Cada ajuste en una fila (texto a la izquierda, control a la derecha):
 * el tema y la vista se eligen en una lista desplegable.
 */
function TemasFilaPc() {
  const tema = useTema();
  const actual = TEMAS.find((t) => t.id === tema) ?? TEMAS[0];
  const vista = vistaWeb();
  return (
    <>
      <h3 className="settings-group">Apariencia</h3>
      <div className="settings-row static">
        <span className="track-text">
          <span className="settings-label">Tema</span>
          <span className="settings-sub">{actual.detalle}. El rack de efectos mantiene sus colores.</span>
        </span>
        <span className="tema-puntos" aria-hidden="true">
          {actual.muestra.map((c, i) => (
            <i key={i} style={{ background: c }} />
          ))}
        </span>
        <span className="ajuste-lista">
          <select value={tema} onChange={(e) => cambiarTema(e.target.value as typeof tema)} aria-label="Tema de la interfaz">
            {TEMAS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </span>
      </div>
      {esWeb && (
        <div className="settings-row static">
          <span className="track-text">
            <span className="settings-label">Vista de la página</span>
            <span className="settings-sub">Automática usa la de PC en un computador y la de teléfono en el celular o la tablet</span>
          </span>
          <span className="ajuste-lista">
            <select value={vista} onChange={(e) => cambiarVistaWeb(e.target.value as VistaWeb)} aria-label="Vista de la página">
              {VISTAS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre}
                </option>
              ))}
            </select>
          </span>
        </div>
      )}
    </>
  );
}
