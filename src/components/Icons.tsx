type P = { size?: number };
const svg = (size: number, d: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {d}
  </svg>
);

export const HomeIcon = ({ size = 26, filled }: P & { filled?: boolean }) =>
  svg(size, filled ? <path d="M4 21V10l8-6 8 6v11h-6v-6h-4v6z" /> : <path d="M4 21V10l8-6 8 6v11h-6v-6h-4v6zm2-2h2v-6h8v6h2v-8l-6-4.5L6 11z" />);

export const SearchIcon = ({ size = 26 }: P) =>
  svg(size, <path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />);

export const LibraryIcon = ({ size = 26, filled }: P & { filled?: boolean }) =>
  svg(size, filled ? <path d="M6 3h12v18l-6-4-6 4z" /> : <path d="M6 3h12v18l-6-4-6 4zm2 2v12.3l4-2.7 4 2.7V5z" />);

export const BackIcon = ({ size = 24 }: P) => svg(size, <path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" />);

export const NoteIcon = ({ size = 24 }: P) => svg(size, <path d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3z" />);

export const PersonIcon = ({ size = 24 }: P) =>
  svg(size, <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4 0-8 2-8 5v2h16v-2c0-3-4-5-8-5z" />);

export const PlusIcon = ({ size = 22 }: P) => svg(size, <path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z" />);

export const FolderIcon = ({ size = 22 }: P) => svg(size, <path d="M3 5h7l2 2h9v12H3zm2 4v8h14V9z" />);

export const CloseIcon = ({ size = 20 }: P) =>
  svg(size, <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z" />);

export const PlayIcon = ({ size = 24 }: P) => svg(size, <path d="M7 4.5v15l12.5-7.5z" />);
export const PauseIcon = ({ size = 24 }: P) => svg(size, <path d="M6 4h4v16H6zm8 0h4v16h-4z" />);
export const NextIcon = ({ size = 24 }: P) => svg(size, <path d="M5 5.5v13l9.5-6.5zM16 5h2.5v14H16z" />);
export const PrevIcon = ({ size = 24 }: P) => svg(size, <path d="M19 5.5v13L9.5 12zM5.5 5H8v14H5.5z" />);
export const ShuffleIcon = ({ size = 24 }: P) =>
  svg(size, <path d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zm.3 9.4-1.4 1.4 3.1 3.1-2 2.1H20v-5.5l-2 2z" />);
export const RepeatIcon = ({ size = 24, one }: P & { one?: boolean }) =>
  svg(
    size,
    <>
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z" />
      {one && <path d="M11 9.5h1.6V15h-1.5v-3.8l-1 .4V10.4z" />}
    </>,
  );
export const ThumbUpIcon = ({ size = 24, filled }: P & { filled?: boolean }) =>
  svg(
    size,
    filled ? (
      <path d="M2 10h4v11H2zm6 11V10l5-7 1.2.9c.5.4.7 1 .6 1.6L14 9h6.5c1.1 0 2 .9 2 2v2l-3 7.2c-.3.5-.8.8-1.4.8z" />
    ) : (
      <path d="M2 10h4v11H2zm6 11V10l5-7 1.2.9c.5.4.7 1 .6 1.6L14 9h6.5c1.1 0 2 .9 2 2v2l-3 7.2c-.3.5-.8.8-1.4.8zm2-2h8l2.5-6v-2h-8.9l1.1-5.3L10 10.6z" />
    ),
  );
export const ThumbDownIcon = ({ size = 24, filled }: P & { filled?: boolean }) => (
  <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
    <ThumbUpIcon size={size} filled={filled} />
  </span>
);
export const ChevronDownIcon = ({ size = 28 }: P) => svg(size, <path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z" />);
export const QueueIcon = ({ size = 24 }: P) => svg(size, <path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-4v6.2a3 3 0 1 0 2 2.8V12h3v-2z" />);
export const MoreIcon = ({ size = 22 }: P) =>
  svg(size, <path d="M12 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" />);
export const PlayNextIcon = ({ size = 22 }: P) => svg(size, <path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm11 0 7 4-7 4z" />);
export const AlbumIcon = ({ size = 22 }: P) =>
  svg(size, <path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />);

/** Logo del título: el mismo ícono de la app (public/icon.svg). El cuadrado ocupa ~204 de 256 px del archivo,
 *  así que se dibuja un poco más grande con margen negativo para que el cuadrado mida `size`. */
export const LogoIcon = ({ size = 30 }: P) => {
  const box = Math.round(size * (256 / 204));
  const m = -Math.round((box - size) / 2);
  return <img src="/icon.svg?v=5" width={box} height={box} alt="" aria-hidden="true" draggable={false} style={{ margin: m, display: 'block' }} />;
};

export const InfoIcon = ({ size = 24 }: P) =>
  svg(size, <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1 7h2v6h-2zm0-4h2v2h-2z" />);

/** Tres reguladores verticales con su perilla a distinta altura (líneas redondeadas, como los demás íconos). */
export const EqualizerIcon = ({ size = 24 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M6 4v7.5M6 16.5V20M12 4v2.5M12 11.5V20M18 4v9.5M18 18.5V20" />
    <circle cx="6" cy="14" r="2.5" />
    <circle cx="12" cy="9" r="2.5" />
    <circle cx="18" cy="16" r="2.5" />
  </svg>
);

const GEAR =
  'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58z';
export const SettingsIcon = ({ size = 26, filled }: P & { filled?: boolean }) =>
  svg(
    size,
    filled ? (
      <path fillRule="evenodd" d={`${GEAR}M12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z`} />
    ) : (
      <g fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d={GEAR} transform="translate(12 12) scale(0.88) translate(-12 -12)" />
        <circle cx="12" cy="12" r="3" />
      </g>
    ),
  );

export const ChevronRightIcon = ({ size = 24 }: P) => svg(size, <path d="M9.4 6 8 7.4l4.6 4.6L8 16.6 9.4 18l6-6z" />);

export const GridIcon = ({ size = 24 }: P) =>
  svg(size, <path d="M3 3h8v8H3zm2 2v4h4V5zm8-2h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zm8-2h8v8h-8zm2 2v4h4v-4z" />);

export const ListIcon = ({ size = 24 }: P) => svg(size, <path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z" />);

export const PlaylistAddIcon = ({ size = 24 }: P) => svg(size, <path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-4v4h-4v2h4v4h2v-4h4v-2h-4v-4z" />);

export const PlaylistRemoveIcon = ({ size = 24 }: P) => svg(size, <path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm11 1h7v2h-7z" />);

export const PinIcon = ({ size = 18 }: P) => svg(size, <path d="M16 9V4h1V2H7v2h1v5a3 3 0 0 1-3 3v2h6v7l1 1 1-1v-7h6v-2a3 3 0 0 1-3-3z" />);

export const EditIcon = ({ size = 24 }: P) =>
  svg(size, <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z" />);

export const TrashIcon = ({ size = 24 }: P) => svg(size, <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z" />);

export const RadioIcon = ({ size = 24 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
  </svg>
);

export const WaveIcon = ({ size = 24 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" />
  </svg>
);

export const VinylIcon = ({ size = 24 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 6.5a5.5 5.5 0 0 0-5.5 5.5" opacity="0.6" />
  </svg>
);

/** Rack de efectos: dos equipos apilados con sus tornillos y perillas. */
export const RackIcon = ({ size = 24 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="13" width="18" height="7" rx="2" />
    <circle cx="15" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15" cy="16.5" r="1.3" fill="currentColor" stroke="none" />
    <path d="M6 7.5h4M6 16.5h4" />
  </svg>
);

/** Nivelador de volumen: barras de distinta altura que quedan alineadas en una misma línea. */
export const LevelIcon = ({ size = 24 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M6 18V9M12 18V5M18 18v-7" opacity="0.45" />
    <path d="M3 12h18" />
    <path d="M6 18v-6M12 18v-6M18 18v-6" />
  </svg>
);

/** Automix: dos ondas que se cruzan (una canción entra mientras la otra se va). */
export const AutomixIcon = ({ size = 24 }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 7h4c4 0 6 10 10 10h4" />
    <path d="M3 17h4c4 0 6-10 10-10h4" opacity="0.5" />
  </svg>
);

/** Reloj con flecha: una búsqueda reciente. */
export const HistoryIcon = ({ size = 24 }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
    <path d="M3 4v4h4" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

/** Flecha en diagonal hacia arriba: pone esa búsqueda en el cuadro para seguir escribiendo. */
export const FillQueryIcon = ({ size = 24 }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 18 6.5 6.5M6 14V6h8" />
  </svg>
);

export const EyeIcon = ({ size = 22 }: P) =>
  svg(
    size,
    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
  );

export const EyeOffIcon = ({ size = 22 }: P) =>
  svg(
    size,
    <path d="M12 7a5 5 0 0 1 4.64 6.83l2.92 2.92A11.8 11.8 0 0 0 23 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16A4.9 4.9 0 0 1 12 7zM2 4.27l2.74 2.74A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3zm5.53 5.53 1.55 1.55A3 3 0 0 0 12.65 15l1.55 1.55A5 5 0 0 1 7.53 9.8zm4.31-.78 3.15 3.15.01-.16a3 3 0 0 0-3-3z" />,
  );

export const CheckIcon = ({ size = 18 }: P) => svg(size, <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />);

export const PersonAddIcon = ({ size = 24 }: P) =>
  svg(
    size,
    <path d="M15 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0-6a2 2 0 1 1-2 2 2 2 0 0 1 2-2zm0 8c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm-6 4c.22-.72 3.31-2 6-2s5.8 1.29 6 2zM6 10V7H4v3H1v2h3v3h2v-3h3v-2z" />,
  );

export const LogoutIcon = ({ size = 24 }: P) => svg(size, <path d="M5 5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7v-2H5zm16 7-4-4v3H9v2h8v3z" />);

export const HeadphonesIcon = ({ size = 24 }: P) =>
  svg(size, <path d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h3v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h3a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z" />);

export const GlobeIcon = ({ size = 24 }: P) =>
  svg(
    size,
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4a14 14 0 0 1 1.9 4h-3.8A14 14 0 0 1 12 4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4zm.8 2h2.9a15.7 15.7 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zM8 8H5.1a8 8 0 0 1 4.3-3.6A15.7 15.7 0 0 0 8 8zm4 12a14 14 0 0 1-1.9-4h3.8A14 14 0 0 1 12 20zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6a15.7 15.7 0 0 0 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4z" />,
  );

export const LockIcon = ({ size = 24 }: P) =>
  svg(
    size,
    <path d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 0 1 6 0v2H9zm9 14H6V10h12zm-6-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
  );

export const PeopleIcon = ({ size = 24 }: P) =>
  svg(
    size,
    <path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1a4.2 4.2 0 0 1 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z" />,
  );

export const MicIcon = ({ size = 24 }: P) =>
  svg(size, <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z" />);

/** Encendido (abrir al iniciar el computador). */
export const PowerIcon = ({ size = 24 }: P) => svg(size, <path d="M11 3h2v10h-2zm5.6 2.4 1.4-1.4A9 9 0 1 1 6 4l1.4 1.4a7 7 0 1 0 9.2 0z" />);

/** Descargar: flecha hacia abajo dentro de un círculo. */
export const DownloadIcon = ({ size = 24 }: P) =>
  svg(
    size,
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm1-13h-2v5.6l-2.3-2.3-1.4 1.4L12 16.4l4.7-4.7-1.4-1.4-2.3 2.3z" />,
  );
/** Descargada: círculo lleno con un visto. */
export const DownloadedIcon = ({ size = 24 }: P) =>
  svg(size, <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.6 14.6-4.1-4.1 1.4-1.4 2.7 2.7 6-6 1.4 1.4z" />);

/** Party (escuchar en grupo): destellos, como el botón de agregar canciones. */
/** Party: destellos rellenos de lados curvos (uno grande, uno chico y un punto). */
export const PartyIcon = ({ size = 24 }: P) =>
  svg(
    size,
    <path d="M10 3.5c.95 6.2 3 8.3 9.2 9.25-6.2.95-8.25 3.05-9.2 9.25-.95-6.2-3-8.3-9.2-9.25C7 11.8 9.05 9.7 10 3.5zm8.6-2c.4 2.55 1.25 3.4 3.8 3.8-2.55.4-3.4 1.25-3.8 3.8-.4-2.55-1.25-3.4-3.8-3.8 2.55-.4 3.4-1.25 3.8-3.8zM19.6 17a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z" />,
  );

export const ShareIcon = ({ size = 24 }: P) => svg(size, <path d="M12 2l5 5-1.4 1.4L13 5.8V15h-2V5.8L8.4 8.4 7 7zM5 13h2v6h10v-6h2v8H5z" />);

/** Mover a un puesto más arriba. */
export const CloudOffIcon = ({ size = 24 }: P) =>
  svg(
    size,
    <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4c-1.48 0-2.85.43-4.01 1.17l1.46 1.46C10.21 6.23 11.08 6 12 6c3.04 0 5.5 2.46 5.5 5.5v.5H19c1.66 0 3 1.34 3 3 0 1.13-.64 2.11-1.56 2.62l1.45 1.45C23.16 18.16 24 16.68 24 15c0-2.64-2.05-4.78-4.65-4.96zM3 5.27l2.75 2.74C2.56 8.15 0 10.77 0 14c0 3.31 2.69 6 6 6h11.73l2 2L21 20.73 4.27 4 3 5.27zM7.73 10l8 8H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h1.73z" />,
  );
export const ArrowUpIcon = ({ size = 24 }: P) => svg(size, <path d="M12 4l7 7-1.4 1.4L13 7.8V20h-2V7.8l-4.6 4.6L5 11z" />);

/** Letra de la canción (comillas, como en YT Music). El mismo en el teléfono y en PC. */
export const LetraIcon = ({ size = 22 }: P) => svg(size, <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />);
