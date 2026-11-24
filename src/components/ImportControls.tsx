import { useRef } from 'react';
import { useEnrich } from '../library/enrich';
import { useLibrary } from '../library/store';
import { CloseIcon, FolderIcon, PlusIcon } from './Icons';

/** iPhone / iPad (los iPad nuevos se presentan como Mac, pero tienen pantalla táctil). */
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Dos formas de importar: una carpeta entera o archivos sueltos. */
export function ImportButtons({ compact }: { compact?: boolean }) {
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const importFiles = useLibrary((s) => s.importFiles);
  const busy = useLibrary((s) => !!s.importing);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) importFiles(files);
  };

  return (
    <div className={`import-buttons ${compact ? 'compact' : ''}`}>
      {/* En el iPhone no se puede elegir una carpeta entera: el mismo botón abre la selección de varias canciones. */}
      <button className="pill primary" disabled={busy} onClick={() => (IS_IOS ? filesRef : folderRef).current?.click()}>
        <FolderIcon /> Importar carpeta
      </button>
      <button className="pill" disabled={busy} onClick={() => filesRef.current?.click()}>
        <PlusIcon /> Archivos
      </button>
      <input
        ref={folderRef}
        type="file"
        hidden
        multiple
        onChange={onPick}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />
      <input ref={filesRef} type="file" hidden multiple accept=".mp3,.wav,.ogg,.oga,.opus,audio/*" onChange={onPick} />
    </div>
  );
}

/** Aviso flotante con el progreso y el resultado de la importación. */
export function ImportToast() {
  const importing = useLibrary((s) => s.importing);
  const last = useLibrary((s) => s.lastImport);
  const dismiss = useLibrary((s) => s.dismissImportResult);
  const enrich = useEnrich();

  if (importing) {
    const pct = importing.total ? Math.round((importing.done / importing.total) * 100) : 0;
    return (
      <div className="toast">
        <div className="toast-title">
          Importando {importing.done} de {importing.total}…
        </div>
        <div className="toast-sub">{importing.current}</div>
        <div className="progress">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  if (enrich.running && enrich.total > 0) {
    const pct = Math.round((enrich.done / enrich.total) * 100);
    return (
      <div className="toast">
        <div className="toast-title">Completando datos desde internet…</div>
        <div className="toast-sub">
          {enrich.done} de {enrich.total} canciones revisadas
        </div>
        <div className="progress">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  if (last) {
    return (
      <div className="toast">
        <button className="toast-close" onClick={dismiss} aria-label="Cerrar">
          <CloseIcon />
        </button>
        <div className="toast-title">
          {last.total === 0 ? 'No se encontraron archivos mp3, wav u ogg' : last.added === 1 ? '1 canción agregada' : `${last.added} canciones agregadas`}
        </div>
        {(last.skipped > 0 || last.failed.length > 0) && (
          <div className="toast-sub">
            {last.skipped > 0 && `${last.skipped} ya estaban en tu biblioteca. `}
            {last.failed.length > 0 && `${last.failed.length} no se pudieron leer.`}
          </div>
        )}
      </div>
    );
  }
  if (enrich.result) {
    return (
      <div className="toast">
        <button className="toast-close" onClick={enrich.dismiss} aria-label="Cerrar">
          <CloseIcon />
        </button>
        <div className="toast-title">
          Se completaron datos de {enrich.result.updated} {enrich.result.updated === 1 ? 'canción' : 'canciones'}
        </div>
        <div className="toast-sub">Portadas, álbumes y años desde MusicBrainz</div>
      </div>
    );
  }
  return null;
}
