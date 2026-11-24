# Analizador de "vibe" de las canciones (lo abre el servidor: src/analisis/vibra.js).
#
# Escucha el audio con Essentia (Universidad Pompeu Fabra) y sus modelos entrenados con Discogs: primero saca
# una "huella" del sonido (discogs-effnet) y después cada clasificador dice qué tan alegre, triste, relajada,
# agresiva, de fiesta, bailable, acústica, electrónica o instrumental es (de 0 a 1).
#
# Protocolo: lee una ruta de archivo por línea (stdin) y responde una línea JSON por canción (stdout):
#   {"ok": true, "feliz": 0.71, "triste": 0.08, ...}   o   {"ok": false, "error": "..."}
# Se analizan como mucho 60 s del medio de la canción (alcanza para la vibe y es mucho más rápido).
import json
import os
import sys

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")  # sin avisos de TensorFlow
os.environ.setdefault("OMP_NUM_THREADS", "2")  # los 2 núcleos (con prioridad baja: el servidor siempre va primero)

import essentia  # noqa: E402

essentia.log.infoActive = False
essentia.log.warningActive = False
import essentia.standard as es  # noqa: E402

MODELOS = os.environ.get("VIBRA_MODELOS") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "modelos")
TRAMO_S = 60
SR = 16000

# nombre en la base → (modelo, índice de la clase "sí" en su lista de clases)
CABEZAS = {
    "feliz": ("mood_happy", 0),
    "triste": ("mood_sad", 1),
    "relajada": ("mood_relaxed", 1),
    "agresiva": ("mood_aggressive", 0),
    "fiesta": ("mood_party", 1),
    "bailable": ("danceability", 0),
    "acustica": ("mood_acoustic", 0),
    "electronica": ("mood_electronic", 0),
    "instrumental": ("voice_instrumental", 0),
}

base = es.TensorflowPredictEffnetDiscogs(
    graphFilename=os.path.join(MODELOS, "discogs-effnet-bs64-1.pb"), output="PartitionedCall:1"
)
cabezas = {
    nombre: (es.TensorflowPredict2D(graphFilename=os.path.join(MODELOS, f"{m}-discogs-effnet-1.pb"), output="model/Softmax"), i)
    for nombre, (m, i) in CABEZAS.items()
}


def analizar(ruta):
    audio = es.MonoLoader(filename=ruta, sampleRate=SR, resampleQuality=4)()
    n = TRAMO_S * SR
    if len(audio) > n:
        ini = (len(audio) - n) // 2
        audio = audio[ini : ini + n]
    if len(audio) < SR * 5:
        raise ValueError("la canción es demasiado corta")
    emb = base(audio)
    r = {}
    for nombre, (cab, i) in cabezas.items():
        p = cab(emb)
        r[nombre] = round(float(p[:, i].mean()), 4)
    return r


print(json.dumps({"listo": True}), flush=True)
for linea in sys.stdin:
    ruta = linea.strip()
    if not ruta:
        continue
    try:
        print(json.dumps({"ok": True, **analizar(ruta)}), flush=True)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)[:200]}), flush=True)
