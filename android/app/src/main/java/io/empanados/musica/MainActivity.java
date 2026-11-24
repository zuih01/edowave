package io.empanados.musica;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * La app de Android. La interfaz va dentro del .apk; la música sigue sonando con la pantalla apagada o con la
 * app en segundo plano (ver ReproduccionService).
 * (Lo copia scripts/compilar-apk.ps1 al proyecto Android en cada compilación: editar AQUÍ, en android-nativo/.)
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ReproduccionPlugin.class);
    registerPlugin(ActualizacionPlugin.class);
    super.onCreate(savedInstanceState);
  }

  @Override
  public void onPause() {
    super.onPause();
    // Android pausa la página al salir de la app: se mantiene viva para que la música no se corte.
    WebView w = getBridge() != null ? getBridge().getWebView() : null;
    if (w != null) {
      w.onResume();
      w.resumeTimers();
    }
  }
}
