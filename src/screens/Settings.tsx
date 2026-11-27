import { useState } from 'react';
import { AutoinicioPc } from '../escritorio/AutoinicioPc';
import { TemasPc } from '../escritorio/TemasPc';
import { diagClear, diagEntries, diagText } from '../diag';
import { openEqualizer, PanelEcualizador } from '../components/Equalizer';
import { useEscritorio } from '../escritorio/activo';
import { AutomixIcon, ChevronRightIcon, EqualizerIcon, InfoIcon, LevelIcon, RackIcon, RadioIcon, VinylIcon, HeadphonesIcon, PeopleIcon } from '../components/Icons';
import { useLeveler } from '../player/loudness';
import { AUTOMIX_VISIBLE, useAutomix } from '../player/automixStore';
import { toggleMode } from '../components/ModeConfirm';
import { showSnack } from '../components/PlaylistSheets';
import { useCuenta } from '../server/cuenta';
import { cambiarMostrarAmigos, cambiarPrivacidad, useSocial } from '../server/social';
import { DiscordPc } from '../escritorio/DiscordPc';
import { openRack } from '../components/Rack';
import { ECHO_MODES, useRack } from '../player/rack';
import { useVinyl, viniloDisponible } from '../player/Vinyl';
import { usePlayer } from '../player/player';
import { useReco } from '../reco/store';
import { allPresets, useEq } from '../player/equalizer';

/** Pestaña Configuración. Por ahora: el ecualizador. */
export function Settings() {
  const enabled = useEq((s) => s.enabled);
  const preset = useEq((s) => s.preset);
  const saved = useEq((s) => s.saved);
  const mode = useEq((s) => s.mode);
  const setEqEnabled = useEq((s) => s.setEnabled);
  const escritorio = useEscritorio();
  const autoplay = usePlayer((s) => s.autoplay);
  const rackEnabled = useRack((s) => s.enabled);
  const setRackEnabled = useRack((s) => s.setEnabled);
  const echo = useRack((s) => s.echo);
  const comp = useRack((s) => s.comp);
  const vinyl = useVinyl((s) => s.on);
  useCuenta((s) => s.nombre); // al cambiar de cuenta se vuelve a revisar si el modo vinilo está disponible
  const hayVinilo = viniloDisponible();
  const leveler = useLeveler((s) => s.on);
  const setLeveler = useLeveler((s) => s.set);
  const automix = useAutomix((s) => s.on);
  const rhythm = useAutomix((s) => s.analyzed);
  const setAutoplay = usePlayer((s) => s.setAutoplay);
  const total = useReco((s) => s.total);
  const conectado = useCuenta((s) => !!s.token);
  const compartirEstado = useSocial((s) => s.compartir);
  const compartir = compartirEstado !== false;
  const compartirCargando = conectado && compartirEstado === null;
  const mostrarAmigosEstado = useSocial((s) => s.mostrarAmigos);
  const mostrarAmigos = mostrarAmigosEstado !== false;
  const presetName = preset === 'custom' ? 'Personalizado' : (allPresets(saved).find((p) => p.id === preset)?.name ?? '');

  return (
    <div className="settings">
      <h1 className="settings-title">Configuración</h1>

      <h3 className="settings-group">Privacidad</h3>
      <button
        className="settings-row"
        role="switch"
        aria-checked={compartir}
        disabled={!conectado || compartirCargando}
        onClick={async () => {
          try {
            await cambiarPrivacidad(!compartir);
            showSnack(compartir ? 'Ya no compartes lo que escuchas' : 'Tus amigos ven lo que escuchas');
          } catch {
            showSnack('No se pudo cambiar. Revisa la conexión.');
          }
        }}
      >
        <span className="settings-icon">
          <HeadphonesIcon />
        </span>
        <span className="track-text">
          <span className="settings-label">Compartir lo que escucho</span>
          <span className="settings-sub">
            {!conectado
              ? 'Inicia sesión para usarlo'
              : compartir
                ? 'Tus amigos ven qué escuchas y pueden escuchar contigo'
                : 'Nadie ve lo que escuchas ni puede escuchar contigo'}
          </span>
        </span>
        <span className={`switch ${compartir ? 'on' : ''}`} aria-hidden="true">
          <span />
        </span>
      </button>
      <button
        className="settings-row"
        role="switch"
        aria-checked={mostrarAmigos}
        disabled={!conectado || mostrarAmigosEstado === null}
        onClick={async () => {
          try {
            await cambiarMostrarAmigos(!mostrarAmigos);
            showSnack(mostrarAmigos ? 'Tus amigos ya no se ven en tu perfil' : 'Tus amigos se ven en tu perfil');
          } catch {
            showSnack('No se pudo cambiar. Revisa la conexión.');
          }
        }}
      >
        <span className="settings-icon">
          <PeopleIcon />
        </span>
        <span className="track-text">
          <span className="settings-label">Mostrar mis amigos en mi perfil</span>
          <span className="settings-sub">
            {!conectado
              ? 'Inicia sesión para usarlo'
              : mostrarAmigos
                ? 'Quien abra tu perfil ve tu lista de amigos'
                : 'Nadie más ve tu lista de amigos (tú sí, en tu perfil)'}
          </span>
        </span>
        <span className={`switch ${mostrarAmigos ? 'on' : ''}`} aria-hidden="true">
          <span />
        </span>
      </button>
      {/* Solo en la app de PC */}
      <DiscordPc />

      <h3 className="settings-group">Sonido</h3>
      {escritorio ? (
        // PC: el ecualizador está aquí mismo (en el teléfono se abre en su propia pantalla).
        <>
          <button className="settings-row" role="switch" aria-checked={enabled} onClick={() => setEqEnabled(!enabled)}>
            <span className="settings-icon">
              <EqualizerIcon />
            </span>
            <span className="track-text">
              <span className="settings-label">Ecualizador</span>
              <span className="settings-sub">{enabled ? `Activado · ${mode === 'pultec' ? 'Pultec' : presetName}` : 'Desactivado'}</span>
            </span>
            <span className={`switch ${enabled ? 'on' : ''}`} aria-hidden="true">
              <span />
            </span>
          </button>
          {/* Apagado, se esconde: se ve recién al activarlo. */}
          {enabled && (
            <div className="settings-eq">
              <PanelEcualizador />
            </div>
          )}
        </>
      ) : (
      <button className="settings-row" onClick={openEqualizer}>
        <span className="settings-icon">
          <EqualizerIcon />
        </span>
        <span className="track-text">
          <span className="settings-label">Ecualizador</span>
          <span className="settings-sub">{enabled ? `Activado · ${mode === 'pultec' ? 'Pultec' : presetName}` : 'Desactivado'}</span>
        </span>
        <ChevronRightIcon />
      </button>
      )}

      <h3 className="settings-group">Reproducción</h3>
      <button className="settings-row" role="switch" aria-checked={autoplay} onClick={() => setAutoplay(!autoplay)}>
        <span className="settings-icon">
          <RadioIcon />
        </span>
        <span className="track-text">
          <span className="settings-label">Reproducción automática</span>
          <span className="settings-sub">Al acabarse la cola, sigue con canciones parecidas</span>
        </span>
        <span className={`switch ${autoplay ? 'on' : ''}`} aria-hidden="true">
          <span />
        </span>
      </button>

      {hayVinilo ? (
        <button className="settings-row" role="switch" aria-checked={vinyl} onClick={() => toggleMode('vinyl')}>
          <span className="settings-icon">
            <VinylIcon />
          </span>
          <span className="track-text">
            <span className="settings-label">Modo vinilo</span>
            <span className="settings-sub">En el reproductor, un disco que gira a 45 rpm; tócalo para frenarlo</span>
          </span>
          <span className={`switch ${vinyl ? 'on' : ''}`} aria-hidden="true">
            <span />
          </span>
        </button>
      ) : (
        <div className="settings-row static proximamente" aria-disabled="true">
          <span className="settings-icon">
            <VinylIcon />
          </span>
          <span className="track-text">
            <span className="settings-label">Modo vinilo</span>
            <span className="settings-sub">Todavía no está disponible</span>
          </span>
          <span className="proximamente-chip">Próximamente</span>
        </div>
      )}

      <h3 className="settings-group">Avanzado</h3>
      <button className="settings-row" onClick={openRack}>
        <span className="settings-icon">
          <RackIcon />
        </span>
        <span className="track-text">
          <span className="settings-label">Rack de efectos</span>
          <span className="settings-sub">
            {rackEnabled
              ? `Activado · Compresor ${comp.on ? (comp.limit ? 'limit' : 'comp') : 'apagado'} · Eco ${echo.on ? ECHO_MODES[echo.mode].toLowerCase() : 'apagado'}`
              : 'Desactivado'}
          </span>
        </span>
        <span
          className={`switch ${rackEnabled ? 'on' : ''}`}
          role="switch"
          aria-checked={rackEnabled}
          aria-label="Activar rack de efectos"
          onClick={(e) => {
            e.stopPropagation(); // el interruptor activa; el resto de la fila abre el rack
            setRackEnabled(!rackEnabled);
          }}
        >
          <span />
        </span>
      </button>

      <button className="settings-row" role="switch" aria-checked={leveler} onClick={() => setLeveler(!leveler)}>
        <span className="settings-icon">
          <LevelIcon />
        </span>
        <span className="track-text">
          <span className="settings-label">Nivelador de volumen</span>
          <span className="settings-sub">
            {leveler ? 'Activado · todas las canciones a -14 LUFS' : 'Iguala el volumen: sube las bajitas y baja las fuertes'}
          </span>
        </span>
        <span className={`switch ${leveler ? 'on' : ''}`} aria-hidden="true">
          <span />
        </span>
      </button>

      {AUTOMIX_VISIBLE && (
      <button className="settings-row" role="switch" aria-checked={automix} onClick={() => toggleMode('automix')}>
        <span className="settings-icon">
          <AutomixIcon />
        </span>
        <span className="track-text">
          <span className="settings-label">
            Automix <span className="badge-exp">Experimental</span>
          </span>
          <span className="settings-sub">
            {!automix
              ? 'Mezcla las canciones como un DJ cuando el tempo coincide'
              : rhythm >= total || total === 0
                ? 'Activado · mezcla solo cuando el tempo coincide'
                : `Activado · analizando el ritmo… ${Math.min(rhythm, total)} de ${total}`}
          </span>
        </span>
        <span className={`switch ${automix ? 'on' : ''}`} aria-hidden="true">
          <span />
        </span>
      </button>
      )}

      <DiagSection />
    </div>
  );
}

/**
 * Registro técnico (plegado): lo que pasó en el reproductor y el vinilo, para poder copiarlo y enviarlo
 * cuando algo falla en el teléfono.
 */
function DiagSection() {
  // El registro técnico es para diagnosticar: solo lo ven las cuentas con acceso al panel.
  const panel = useCuenta((s) => !!s.token && s.panel);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, refresh] = useState(0);
  const text = diagText();
  return (
    <>
      <TemasPc />
      <AutoinicioPc />

      {panel && (
      <>
      <h3 className="settings-group">Ayuda</h3>
      <button className="settings-row" onClick={() => setOpen(!open)}>
        <span className="settings-icon">
          <InfoIcon />
        </span>
        <span className="track-text">
          <span className="settings-label">Registro técnico</span>
          <span className="settings-sub">Para enviarlo si algo falla ({diagEntries().length} eventos)</span>
        </span>
        <ChevronRightIcon />
      </button>
      {open && (
        <div className="diag">
          <div className="diag-buttons">
            <button
              className="pill primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* sin portapapeles: se puede seleccionar el texto a mano */
                }
              }}
            >
              {copied ? 'Copiado' : 'Copiar registro'}
            </button>
            <button
              className="pill"
              onClick={() => {
                diagClear();
                refresh((n) => n + 1);
              }}
            >
              Borrar
            </button>
          </div>
          <pre className="diag-text">{text}</pre>
        </div>
      )}
      </>
      )}
    </>
  );
}
