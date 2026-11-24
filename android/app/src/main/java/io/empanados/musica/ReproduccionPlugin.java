package io.empanados.musica;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Puente entre la app y Android para la música: la app avisa qué suena (título, artista, portada, si está
 * sonando) y Android muestra los controles en la notificación y en la pantalla de bloqueo. Lo que se toca ahí
 * (play/pausa, siguiente, anterior, mover la barra) vuelve a la app como el evento "accion".
 */
@CapacitorPlugin(name = "Reproduccion")
public class ReproduccionPlugin extends Plugin {
  static ReproduccionPlugin instancia;

  @Override
  public void load() {
    instancia = this;
    // Android 13+: hay que pedir permiso para mostrar la notificación con los controles.
    if (Build.VERSION.SDK_INT >= 33
        && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        && getActivity() != null) {
      ActivityCompat.requestPermissions(getActivity(), new String[] {Manifest.permission.POST_NOTIFICATIONS}, 7301);
    }
  }

  /** Llega desde la notificación / pantalla de bloqueo / auriculares. */
  static void accion(String accion, long posicionMs) {
    ReproduccionPlugin p = instancia;
    if (p == null) return;
    JSObject d = new JSObject();
    d.put("accion", accion);
    if (posicionMs >= 0) d.put("posicion", posicionMs / 1000.0);
    p.notifyListeners("accion", d, true);
  }

  @PluginMethod
  public void actualizar(PluginCall call) {
    Intent i = new Intent(getContext(), ReproduccionService.class);
    i.setAction(ReproduccionService.ACTUALIZAR);
    i.putExtra("titulo", call.getString("titulo", ""));
    i.putExtra("artista", call.getString("artista", ""));
    i.putExtra("album", call.getString("album", ""));
    i.putExtra("portada", call.getString("portada", ""));
    i.putExtra("sonando", Boolean.TRUE.equals(call.getBoolean("sonando", false)));
    i.putExtra("posicion", (long) (call.getDouble("posicion", 0.0) * 1000));
    i.putExtra("duracion", (long) (call.getDouble("duracion", 0.0) * 1000));
    try {
      ContextCompat.startForegroundService(getContext(), i);
      call.resolve();
    } catch (Exception e) {
      call.reject("No se pudo mostrar la notificación: " + e.getMessage());
    }
  }

  @PluginMethod
  public void detener(PluginCall call) {
    getContext().stopService(new Intent(getContext(), ReproduccionService.class));
    call.resolve();
  }
}
