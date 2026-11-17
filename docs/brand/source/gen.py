import math, os
K = os.environ.get("KIT", ".")
INK = os.environ.get("INK", "#3B36C9"); REC = os.environ.get("REC", "#FF5A1F"); WHITE = "#FFFFFF"

def f(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s if s != "-0" else "0"

class T:
    def __init__(s, ox=0, oy=0, k=1): s.ox, s.oy, s.k = ox, oy, k
    def X(s, x): return f(s.ox + s.k * x)
    def Y(s, y): return f(s.oy + s.k * y)
    def R(s, r): return f(s.k * r)

def letter_a(t, R=86, w=40, ymin=44, ymax=212):
    """a de caja única: anillo R/grosor w, montante w al ras del borde derecho; origen = borde izquierdo, centro y=128."""
    ri = R - w
    dx = R - w             # montante: x = 2R-w .. 2R ; borde izq. a distancia R-w del centro
    dy = math.sqrt(R*R - dx*dx)
    xs = 2*R - w
    d = (f"M{t.X(2*R)} {t.Y(ymin)} V{t.Y(ymax)} H{t.X(xs)} V{t.Y(128+dy)} "
         f"A{t.R(R)} {t.R(R)} 0 1 1 {t.X(xs)} {t.Y(128-dy)} V{t.Y(ymin)} Z "
         f"M{t.X(R)} {t.Y(128-ri)} A{t.R(ri)} {t.R(ri)} 0 1 0 {t.X(R)} {t.Y(128+ri)} A{t.R(ri)} {t.R(ri)} 0 1 0 {t.X(R)} {t.Y(128-ri)} Z")
    return d

def dot(t, cx, r, fill):
    return f'<circle cx="{t.X(cx)}" cy="{t.Y(128)}" r="{t.R(r)}" fill="{fill}"/>'

def letter_c(t, ox, R=86, w=40, cut=40):
    ri = R - w
    cx = ox + R
    do = math.sqrt(R*R - cut*cut); di = math.sqrt(ri*ri - cut*cut)
    x = cx + cut
    return (f"M{t.X(x)} {t.Y(128-do)} A{t.R(R)} {t.R(R)} 0 1 0 {t.X(x)} {t.Y(128+do)} V{t.Y(128+di)} "
            f"A{t.R(ri)} {t.R(ri)} 0 1 1 {t.X(x)} {t.Y(128-di)} Z")

def letter_t(t, ox, w=40, top=8, base=212, bar_t=44, bar_b=76, left=26, right=52):
    s0 = ox + left; s1 = s0 + w
    return (f"M{t.X(s0)} {t.Y(top)} H{t.X(s1)} V{t.Y(bar_t)} H{t.X(s1+right)} V{t.Y(bar_b)} H{t.X(s1)} V{t.Y(base)} "
            f"H{t.X(s0)} V{t.Y(bar_b)} H{t.X(ox)} V{t.Y(bar_t)} H{t.X(s0)} Z")

def svg(vb, title, body, extra=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{vb.split()[2]}" height="{vb.split()[3]}" role="img" aria-labelledby="t">\n'
            f'  <title id="t">{title}</title>\n{body}</svg>\n')

def write(name, s):
    open(os.path.join(K, name), "w").write(s)

# ---- Símbolo (256) ----
t = T(42-0, 0, 1)   # a ocupa x 42..214 en lienzo 256 (R=86 -> ancho 172)
def symbol(ink, rec, R=86, w=40, ox=42, ymin=44, ymax=212, dr=22):
    tt = T(ox, 0, 1)
    body = (f'  <g id="symbol">\n    <path fill="{ink}" fill-rule="evenodd" d="{letter_a(tt,R,w,ymin,ymax)}"/>\n'
            f'    {dot(tt,R,dr,rec)}\n  </g>\n')
    return body
write("acta-symbol.svg", svg("0 0 256 256", "acta — símbolo", symbol(INK, REC)))
# corte pequeño: huella mayor, anillo 42, punto mayor
write("acta-symbol-small.svg", svg("0 0 256 256", "acta — símbolo (tamaño pequeño)", symbol(INK, REC, R=92, w=42, ox=36, ymin=38, ymax=218, dr=24)))
# invertido: anillo adelgazado (irradiación)
write("acta-symbol-small-reversed.svg", svg("0 0 256 256", "acta — símbolo pequeño sobre fondo oscuro", symbol(WHITE, REC, R=92, w=38, ox=36, ymin=38, ymax=218, dr=24)))
write("acta-symbol-reversed.svg", svg("0 0 256 256", "acta — símbolo sobre fondo oscuro", symbol(WHITE, REC, R=86, w=36, ox=42, ymin=44, ymax=212, dr=22)))

# ---- Palabra ----
def wordmark(ink, rec, ox=32, oy=11, k=1, with_dot=True):
    tt = T(ox, oy, k)
    a1 = letter_a(tt)                       # x 0..172
    c  = letter_c(tt, 194)                  # 194..320
    tl = letter_t(tt, 334)                  # 334..452
    a2 = letter_a(T(ox + k*470, oy, k))      # 470..642
    parts = (f'  <g id="wordmark" fill="{ink}" fill-rule="evenodd">\n'
             f'    <path d="{a1}"/>\n    <path d="{c}"/>\n    <path d="{tl}"/>\n    <path d="{a2}"/>\n  </g>\n')
    if with_dot: parts += f'  <g id="rec">{dot(tt,86,22,rec)}</g>\n'
    return parts
write("acta-horizontal.svg", svg("0 0 706 256", "acta", wordmark(INK, REC)))
write("acta-wordmark.svg", svg("0 0 706 256", "acta — solo palabra", wordmark(INK, REC, with_dot=False)))
write("acta-horizontal-reversed.svg", svg("0 0 706 256", "acta sobre fondo oscuro", wordmark(WHITE, REC)))

# ---- Apilado ----
def stacked(ink, rec, sym_w=40, sym_ink=None):
    W = 520
    body = ""
    ts = T((W-172)/2, -42+24, 1)            # símbolo 172 de alto, margen superior 24
    body += (f'  <g id="symbol"><path fill="{ink}" fill-rule="evenodd" d="{letter_a(ts,86,sym_w)}"/>{dot(ts,86,22,rec)}</g>\n')
    k = 0.5
    ow = (W - 642*k)/2
    tw = T(ow, 172+24+40 - 20*k, k)         # 40 de aire; parte alta de la t en y=236
    body += (f'  <g id="wordmark" fill="{ink}" fill-rule="evenodd">\n'
             f'    <path d="{letter_a(tw)}"/>\n    <path d="{letter_c(tw,194)}"/>\n    <path d="{letter_t(tw,334)}"/>\n'
             f'    <path d="{letter_a(T(ow+k*470, tw.oy, k))}"/>\n  </g>\n')
    H = 24 + 172 + 40 + (214-20)*k + 24
    return W, H, body
W,H,b = stacked(INK, REC)
write("acta-stacked.svg", svg(f"0 0 {W} {f(H)}", "acta — apilado", b))
W,H,b = stacked(WHITE, REC, sym_w=36)
write("acta-stacked-reversed.svg", svg(f"0 0 {W} {f(H)}", "acta — apilado sobre fondo oscuro", b))

# ---- Icono de app (macOS, 1024, cuerpo 824) ----
def app_icon(bg):
    k = 3.0                                  # a 172 -> 516 px (63 % del cuerpo)
    ox = 512 - 86*k; oy = 512 - 128*k - 6    # centro óptico 6 px arriba
    tt = T(ox, oy, k)
    return (f'  <rect x="100" y="100" width="824" height="824" rx="186" fill="{bg}"/>\n'
            f'  <g id="symbol"><path fill="{WHITE}" fill-rule="evenodd" d="{letter_a(tt,86,36)}"/>{dot(tt,86,22,REC)}</g>\n')
write("acta-app-icon.svg", svg("0 0 1024 1024", "acta — icono de app", app_icon(INK)))
print("ok")

# ---- Favicon con baldosa (visible en pestañas claras y oscuras) ----
def favicon_tile(bg):
    k = 0.9
    tt = T(128 - 92*k, 128*(1-k) - 2, k)
    return (f'  <rect width="256" height="256" rx="56" fill="{bg}"/>\n'
            f'  <g id="symbol"><path fill="{WHITE}" fill-rule="evenodd" d="{letter_a(tt,92,38,38,218)}"/>{dot(tt,92,24,REC)}</g>\n')
write("acta-favicon-tile.svg", svg("0 0 256 256", "acta — favicon", favicon_tile(INK)))
