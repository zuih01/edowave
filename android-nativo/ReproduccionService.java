package io.empanados.musica;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Servicio de música en primer plano: mantiene viva la app mientras suena (pantalla apagada, otra app abierta)
 * y muestra la notificación con portada y controles; también la pantalla de bloqueo y los botones de los
 * auriculares/Bluetooth (MediaSession). El audio en sí lo sigue reproduciendo la app (con su ecualizador,
 * rack y volumen).
 */
public class ReproduccionService extends Service {
  static final String ACTUALIZAR = "io.empanados.musica.ACTUALIZAR";
  static final String CANAL = "musica";
  static final int ID = 7300;

  private MediaSessionCompat sesion;
  private PowerManager.WakeLock despierto;
  private String titulo = "", artista = "", album = "", portadaUrl = "";
  private Bitmap portada;
  private boolean sonando;
  private long posicion, duracion;

  @Override
  public void onCreate() {
    super.onCreate();
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel c = new NotificationChannel(CANAL, "Reproducción", NotificationManager.IMPORTANCE_LOW);
      c.setShowBadge(false);
      getSystemService(NotificationManager.class).createNotificationChannel(c);
    }
    sesion = new MediaSessionCompat(this, "Musica");
    sesion.setCallback(new MediaSessionCompat.Callback() {
      @Override public void onPlay() { ReproduccionPlugin.accion("play", -1); }
      @Override public void onPause() { ReproduccionPlugin.accion("pausa", -1); }
      @Override public void onSkipToNext() { ReproduccionPlugin.accion("siguiente", -1); }
      @Override public void onSkipToPrevious() { ReproduccionPlugin.accion("anterior", -1); }
      @Override public void onSeekTo(long pos) { ReproduccionPlugin.accion("mover", pos); }
      @Override public void onStop() { ReproduccionPlugin.accion("pausa", -1); }
    });
    sesion.setActive(true);
    PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
    despierto = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "musica:reproduccion");
    despierto.setReferenceCounted(false);
  }

  @Override
  public int onStartCommand(Intent i, int flags, int startId) {
    if (i != null) {
      String a = i.getAction();
      if (ACTUALIZAR.equals(a)) {
        titulo = i.getStringExtra("titulo");
        artista = i.getStringExtra("artista");
        album = i.getStringExtra("album");
        sonando = i.getBooleanExtra("sonando", false);
        posicion = i.getLongExtra("posicion", 0);
        duracion = i.getLongExtra("duracion", 0);
        String url = i.getStringExtra("portada");
        if (url != null && !url.equals(portadaUrl)) {
          portadaUrl = url;
          portada = null;
          bajarPortada(url);
        }
      } else if (a != null) {
        // Botones de la notificación.
        ReproduccionPlugin.accion(a, -1);
      }
    }
    mostrar();
    return START_NOT_STICKY;
  }

  private void bajarPortada(final String url) {
    if (url.isEmpty()) return;
    new Thread(() -> {
      try {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        try (InputStream in = c.getInputStream()) {
          Bitmap b = BitmapFactory.decodeStream(in);
          if (b != null && url.equals(portadaUrl)) {
            portada = b;
            mostrar();
          }
        }
      } catch (Exception ignorado) {
        // sin portada: la notificación sale igual
      }
    }).start();
  }

  private PendingIntent boton(String accion) {
    Intent i = new Intent(this, ReproduccionService.class).setAction(accion);
    return PendingIntent.getService(this, accion.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private synchronized void mostrar() {
    MediaMetadataCompat.Builder m = new MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, titulo)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artista)
        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duracion);
    if (portada != null) m.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, portada);
    sesion.setMetadata(m.build());
    sesion.setPlaybackState(new PlaybackStateCompat.Builder()
        .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO)
        .setState(sonando ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, posicion, sonando ? 1f : 0f)
        .build());

    Intent abrir = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent alTocar = PendingIntent.getActivity(this, 0, abrir, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Notification n = new NotificationCompat.Builder(this, CANAL)
        .setSmallIcon(android.R.drawable.ic_media_play)
        .setContentTitle(titulo)
        .setContentText(artista)
        .setSubText(album)
        .setLargeIcon(portada)
        .setContentIntent(alTocar)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setOngoing(sonando)
        .addAction(android.R.drawable.ic_media_previous, "Anterior", boton("anterior"))
        .addAction(sonando ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, sonando ? "Pausar" : "Reproducir", boton(sonando ? "pausa" : "play"))
        .addAction(android.R.drawable.ic_media_next, "Siguiente", boton("siguiente"))
        .setStyle(new MediaStyle().setMediaSession(sesion.getSessionToken()).setShowActionsInCompactView(0, 1, 2))
        .build();

    int tipo = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
    ServiceCompat.startForeground(this, ID, n, tipo);
    // Mientras suena, la CPU no se duerme (pantalla apagada). En pausa se suelta para no gastar batería.
    if (sonando) despierto.acquire(6 * 60 * 60 * 1000L);
    else if (despierto.isHeld()) despierto.release();
  }

  @Override
  public void onDestroy() {
    if (despierto.isHeld()) despierto.release();
    sesion.setActive(false);
    sesion.release();
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent i) {
    return null;
  }
}
