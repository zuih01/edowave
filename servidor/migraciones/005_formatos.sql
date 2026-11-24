-- Más formatos además de MP3. `archivo` es lo que escucha la app; si hubo que convertir (WMA, OGG…) el
-- archivo subido se guarda igual en biblioteca/originales (`original`) por si algún día se quiere rehacer.
ALTER TABLE canciones ADD COLUMN formato text NOT NULL DEFAULT 'mp3';   -- lo que escucha la app: mp3, m4a, flac
ALTER TABLE canciones ADD COLUMN formato_original text;                 -- como se subió: wav, wma, ogg… (null = igual)
ALTER TABLE canciones ADD COLUMN original text;                         -- archivo en biblioteca/originales (null = no hizo falta)
