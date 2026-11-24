import { BandejaPc } from './BandejaPc';
import { DiscordPc } from './DiscordPc';

type Tauri = { core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
const tauri = () => (window as unknown as { __TAURI__?: Tauri }).__TAURI__;

/**
 * Configuración, solo en la app de PC: "Este PC" (bandeja y Discord). "Abrir al iniciar Windows" ya no está aquí:
 * lo pregunta el instalador, como cualquier programa (la app no toca la carpeta de Inicio de Windows).
 */
export function AutoinicioPc() {
  if (!tauri()) return null;
  return (
    <>
      <h3 className="settings-group">Este PC</h3>
      <BandejaPc />
      <DiscordPc />
    </>
  );
}
