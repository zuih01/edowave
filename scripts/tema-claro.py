"""Genera las reglas de los temas claros (Neutro y Algodón; <html data-claro>, ver temas.ts): cada color, fondo o borde blanco translúcido de styles.css y
escritorio.css pasa a negro translúcido (texto) o a rosado translúcido (fondos y bordes)."""
import re, sys, io

TEMA = "html[data-claro]"
BLANCO = re.compile(r"rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([0-9.]+)\s*\)")
PROPS_TEXTO = {'color', 'fill', 'stroke', 'caret-color'}
PROPS_FONDO = {'background', 'background-color', 'border', 'border-color', 'border-top', 'border-bottom',
               'border-left', 'border-right', 'border-top-color', 'border-bottom-color', 'outline', 'box-shadow'}


def quitar_comentarios(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def reglas(css):
    """(contexto @media o '', selectores, cuerpo) para reglas simples, con un nivel de @media."""
    i, n = 0, len(css)
    pila = []
    inicio = 0
    while i < n:
        c = css[i]
        if c == '{':
            pre = css[inicio:i].strip()
            pila.append(pre)
            inicio = i + 1
        elif c == '}':
            if pila:
                pre = pila.pop()
                cuerpo = css[inicio:i]
                if not pre.startswith('@'):
                    ctx = [p for p in pila if p.startswith('@media') or p.startswith('@supports')]
                    yield (ctx[-1] if ctx else ''), pre, cuerpo
            inicio = i + 1
        elif c == ';' and not pila:
            inicio = i + 1
        i += 1


def convertir(prop, valor):
    def oscuro(m):
        a = float(m.group(1))
        return f"rgba(28, 20, 24, {min(1, round(a * 1.05, 3))})"

    def rosado(m):
        a = float(m.group(1))
        # velos muy suaves sobre blanco: rosado un poco más visible
        return f"rgba(255, 111, 181, {min(1, round(a * 1.6 + 0.02, 3))})"

    if prop in PROPS_TEXTO:
        return BLANCO.sub(oscuro, valor)
    if prop == 'box-shadow':
        return BLANCO.sub(rosado, valor)
    return BLANCO.sub(rosado, valor)


# El Pultec, el rack y el vinilo son equipos físicos: no cambian de color con el tema. El ecualizador de bandas sí.
RACK = re.compile(r"\.(bs\b|bs-|bass|pt-|pk-|vinyl|rack|pultec)")


def prefijar(selectores):
    partes = []
    for s in selectores.split(','):
        s = s.strip()
        if not s:
            continue
        if s.startswith(':root') or s.startswith('html') or RACK.search(s):
            continue
        if s.startswith('body'):
            partes.append(f"{TEMA} {s}")
        else:
            partes.append(f"{TEMA} {s}")
    return ',\n'.join(partes)


sys.stdout.reconfigure(encoding="utf-8")
salida = []
for archivo in sys.argv[1:]:
    css = quitar_comentarios(io.open(archivo, encoding='utf-8').read())
    for ctx, sel, cuerpo in reglas(css):
        if '@keyframes' in sel or sel.startswith('from') or sel.startswith('to') or re.match(r'^[0-9.]+%', sel):
            continue
        decl = []
        for d in cuerpo.split(';'):
            if ':' not in d:
                continue
            prop, valor = d.split(':', 1)
            prop = prop.strip().lower()
            if (prop in PROPS_TEXTO or prop in PROPS_FONDO) and BLANCO.search(valor):
                decl.append(f"{prop}: {convertir(prop, valor.strip())}")
        if not decl:
            continue
        pre = prefijar(sel)
        if not pre:
            continue
        regla = f"{pre} {{ {'; '.join(decl)}; }}"
        salida.append(f"{ctx} {{ {regla} }}" if ctx else regla)

print("/* ===== Temas claros (Neutro, Algodón): GENERADO por scripts/tema-claro.py a partir de styles.css y escritorio.css. ===== */")
print("\n".join(salida))
