package io.empanados.musica;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Actualizaciones de la app sin pasar por ninguna tienda:
 *  - descargarInterfaz: baja la interfaz nueva (.zip) y la deja lista para la PRÓXIMA vez que se abra la app.
 *  - instalarApk: cuando cambió la parte de Android, baja el .apk nuevo y abre el instalador (Android pide
 *    confirmar; eso no se puede saltar).
 */
@CapacitorPlugin(name = "Actualizacion")
public class ActualizacionPlugin extends Plugin {

  private static void bajar(String url, File destino) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setConnectTimeout(15000);
    c.setReadTimeout(30000);
    if (c.getResponseCode() != 200) throw new Exception("El servidor respondió " + c.getResponseCode());
    try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(destino)) {
      byte[] b = new byte[64 * 1024];
      int n;
      while ((n = in.read(b)) > 0) out.write(b, 0, n);
    }
  }

  private static void borrar(File f) {
    File[] hijos = f.listFiles();
    if (hijos != null) for (File h : hijos) borrar(h);
    //noinspection ResultOfMethodCallIgnored
    f.delete();
  }

  @PluginMethod
  public void descargarInterfaz(PluginCall call) {
    final String url = call.getString("url");
    final String version = call.getString("version", "");
    if (url == null || version.isEmpty() || !version.matches("[A-Za-z0-9_.-]+")) {
      call.reject("Faltan datos de la versión");
      return;
    }
    new Thread(() -> {
      try {
        Context ctx = getContext();
        File base = new File(ctx.getFilesDir(), "interfaz");
        File dir = new File(base, version);
        File zip = new File(ctx.getCacheDir(), "interfaz.zip");
        bajar(url, zip);
        File tmp = new File(base, version + ".tmp");
        borrar(tmp);
        //noinspection ResultOfMethodCallIgnored
        tmp.mkdirs();
        String raiz = tmp.getCanonicalPath() + File.separator;
        try (ZipInputStream z = new ZipInputStream(new java.io.FileInputStream(zip))) {
          ZipEntry e;
          byte[] b = new byte[64 * 1024];
          while ((e = z.getNextEntry()) != null) {
            // Rutas con "\" (zips armados en Windows): se pasan a "/" para que queden en sus carpetas.
            String nombre = e.getName().replace('\\', '/');
            while (nombre.startsWith("./")) nombre = nombre.substring(2);
            if (nombre.isEmpty()) continue;
            File f = new File(tmp, nombre);
            if (!f.getCanonicalPath().startsWith(raiz)) throw new Exception("Archivo inválido en la actualización");
            if (e.isDirectory()) {
              //noinspection ResultOfMethodCallIgnored
              f.mkdirs();
              continue;
            }
            //noinspection ResultOfMethodCallIgnored
            f.getParentFile().mkdirs();
            try (OutputStream out = new FileOutputStream(f)) {
              int n;
              while ((n = z.read(b)) > 0) out.write(b, 0, n);
            }
          }
        }
        //noinspection ResultOfMethodCallIgnored
        zip.delete();
        if (!new File(tmp, "index.html").exists() || !new File(tmp, "assets").isDirectory()) throw new Exception("La actualización no trae la app completa");
        borrar(dir);
        if (!tmp.renameTo(dir)) throw new Exception("No se pudo guardar la actualización");
        // Las versiones viejas se borran (menos la que está en uso ahora y la nueva).
        String enUso = ctx.getSharedPreferences("CapWebViewSettings", Context.MODE_PRIVATE).getString("serverBasePath", "");
        File[] viejas = base.listFiles();
        if (viejas != null) for (File v : viejas) {
          // No se borra la que se está usando ahora (la app todavía puede pedir archivos de ella).
          if (!v.equals(dir) && !v.getAbsolutePath().equals(enUso)) borrar(v);
        }
        // La próxima vez que se abra la app, usa esta interfaz (así no se recarga mientras la usas).
        ctx.getSharedPreferences("CapWebViewSettings", Context.MODE_PRIVATE).edit().putString("serverBasePath", dir.getAbsolutePath()).apply();
        JSObject r = new JSObject();
        r.put("ruta", dir.getAbsolutePath());
        call.resolve(r);
      } catch (Exception e) {
        call.reject("No se pudo bajar la actualización: " + e.getMessage());
      }
    }).start();
  }

  @PluginMethod
  public void instalarApk(PluginCall call) {
    final String url = call.getString("url");
    if (url == null) {
      call.reject("Falta la dirección del .apk");
      return;
    }
    Context ctx = getContext();
    // Android 8+: la primera vez hay que permitir "instalar apps" a esta app.
    if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
      Intent permiso = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
      permiso.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      ctx.startActivity(permiso);
      JSObject r = new JSObject();
      r.put("permiso", true);
      call.resolve(r);
      return;
    }
    new Thread(() -> {
      try {
        File apk = new File(ctx.getCacheDir(), "actualizacion.apk");
        bajar(url, apk);
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
        call.resolve();
      } catch (Exception e) {
        call.reject("No se pudo bajar la versión nueva: " + e.getMessage());
      }
    }).start();
  }
}
