import { BandejaPc } from './BandejaPc';
import { NotchPc } from './NotchPc';

type Tauri = { core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
const tauri = () => (window as unknown as { __TAURI__?: Tauri }).__TAURI__;

/**
 * Configuración, solo en la app de PC: "Este PC" (bandeja y notch; Discord está en Privacidad). Edowave no se abre al iniciar Windows: desde
 * la 1.0.3 el instalador tampoco lo ofrece (un programa sin firma que arranca solo es lo que Defender marcaba).
 */
export function AutoinicioPc() {
  if (!tauri()) return null;
  return (
    <>
      <h3 className="settings-group">Este PC</h3>
      <BandejaPc />
      <NotchPc />
    </>
  );
}
