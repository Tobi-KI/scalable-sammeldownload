# ScStore-Texte fuer die Erweiterung, gerendert als Mockup-Grafiken
from PIL import Image, ImageDraw, ImageFont
import os

OUT = r"C:\Users\Tobi\Documents\Hermes\scalable-sammeldownload\store-assets"
os.makedirs(OUT, exist_ok=True)

TEAL = (0, 160, 175)
DARK = (26, 43, 60)
LIGHT = (244, 247, 249)
GREY = (120, 135, 150)
WHITE = (255, 255, 255)
GREEN = (46, 160, 80)

def font(size, bold=False):
    for name in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        try:
            return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)
        except OSError:
            continue
    return ImageFont.load_default()

def rr(d, box, r, fill):
    d.rounded_rectangle(box, radius=r, fill=fill)

def icon(out_size=128):
    img = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rr(d, [4, 4, 124, 124], 26, TEAL)
    # Dokument
    d.rectangle([40, 24, 88, 88], fill=WHITE)
    for y in (36, 50, 64):
        d.rectangle([48, y, 80, y + 5], fill=(210, 228, 232))
    # Pfeil nach unten
    d.polygon([(64, 92), (50, 76), (78, 76)], fill=WHITE)
    d.rectangle([60, 66, 68, 80], fill=WHITE)
    if out_size != 128:
        img = img.resize((out_size, out_size), Image.LANCZOS)
    return img

icon(128).save(f"{OUT}/icon128.png")
icon(16).save(f"{OUT}/icon16.png")
icon(48).save(f"{OUT}/icon48.png")

def browser_chrome(w, h):
    """Zeichnet Browser-Rahmen, gibt Bild + draw + y-Offset fuer Inhalt zurueck."""
    img = Image.new("RGB", (w, h), LIGHT)
    d = ImageDraw.Draw(img)
    # Titelleiste
    d.rectangle([0, 0, w, 46], fill=(222, 228, 233))
    rr(d, [16, 8, w - 16, 38], 15, WHITE)
    f = font(15)
    d.text((36, 14), "scalable.capital/broker/transactions", font=f, fill=GREY)
    # Tab-Dots
    for i, c in enumerate([(240, 100, 100), (245, 190, 90), (110, 200, 110)]):
        d.ellipse([w - 90 + i * 24, 16, w - 78 + i * 24, 28], fill=c)
    return img, d, 46

def mock_rows(d, y0, rows, checked_idx):
    f_name = font(17, bold=True)
    f_sub = font(13)
    f_cb = font(15, bold=True)
    for i, (name, sub) in enumerate(rows):
        y = y0 + i * 58
        rr(d, [30, y, 830, y + 50], 10, WHITE)
        # Checkbox
        sel = i in checked_idx
        cb = [44, y + 14, 68, y + 38]
        if sel:
            rr(d, cb, 6, TEAL)
            d.line([(49, y + 26), (55, y + 32), (65, y + 20)], fill=WHITE, width=3)
        else:
            rr(d, cb, 6, (205, 214, 222))
        d.text((82, y + 8), name, font=f_name, fill=DARK)
        d.text((82, y + 30), sub, font=f_sub, fill=GREY)

def panel(d, x, y, w=300, h=150, status=None):
    rr(d, [x, y, x + w, y + h], 14, WHITE, )
    d.rounded_rectangle([x, y, x + w, y + h], radius=14, outline=(200, 210, 220), width=1)
    d.text((x + 16, y + 12), "Sammeldownload", font=font(17, bold=True), fill=DARK)
    rr(d, [x + 16, y + 44, x + 160, y + 74], 8, LIGHT)
    d.text((x + 26, y + 50), "Zeilen scannen", font=font(13), fill=DARK)
    rr(d, [x + 170, y + 44, x + w - 16, y + 74], 8, TEAL)
    d.text((x + 180, y + 50), "Ausgewählte laden", font=font(13, bold=True), fill=WHITE)
    if status:
        d.text((x + 16, y + 90), status, font=font(14), fill=GREEN)

rows = [
    ("Vanguard FTSE All-World UCITS ETF", "Sparplan · 01.09.2026 · 100,00 €"),
    ("iShares Core MSCI World UCITS ETF", "Sparplan · 01.09.2026 · 50,00 €"),
    ("iShares NASDAQ 100 UCITS ETF", "Sparplan · 01.09.2026 · 25,00 €"),
]

# ---------- Screenshot 1280x800 ----------
w, h = 1280, 800
img, d, y0 = browser_chrome(w, h)
d.text((30, y0 + 20), "Transaktionen", font=font(28, bold=True), fill=DARK)
mock_rows(d, y0 + 80, rows, {0, 1, 2})
panel(d, 880, y0 + 560, 370, 170, "3 von 3 Abrechnungen gefunden")
img.save(f"{OUT}/screenshot-1280x800.png")

# ---------- Screenshot 2: Erfolg ----------
img, d, y0 = browser_chrome(w, h)
d.text((30, y0 + 20), "Transaktionen", font=font(28, bold=True), fill=DARK)
mock_rows(d, y0 + 80, rows, set())
panel(d, 880, y0 + 560, 370, 170, "OK - 3 Abrechnungen gespeichert")
d.text((30, y0 + 300), "Downloads/scalable-dokumente/", font=font(20, bold=True), fill=GREY)
files = [
    "Vanguard_FTSE_All-World_UCITS_ETF_IE00B3RBWM25_Abrechnung_Sparplan_20260901.pdf",
    "iShares_Core_MSCI_World_UCITS_ETF_IE00B4L5Y983_Abrechnung_Sparplan_20260901.pdf",
    "iShares_NASDAQ_100_UCITS_ETF_IE00BJSQQ733_Abrechnung_Sparplan_20260901.pdf",
]
for i, fn in enumerate(files):
    y = y0 + 340 + i * 46
    rr(d, [30, y, 830, y + 38], 8, WHITE)
    d.rectangle([44, y + 8, 58, y + 30], fill=(240, 100, 100))
    d.text((44, y + 7), "PDF", font=font(9, bold=True), fill=WHITE)
    d.text((70, y + 9), fn, font=font(14), fill=DARK)
img.save(f"{OUT}/screenshot2-1280x800.png")

# ---------- Kleine Werbekachel 440x280 ----------
img = Image.new("RGB", (440, 280), TEAL)
d = ImageDraw.Draw(img)
d.rectangle([0, 0, 440, 280], fill=TEAL)
d.text((30, 36), "Wertpapierabrechnungen", font=font(30, bold=True), fill=WHITE)
d.text((30, 74), "auf einmal herunterladen", font=font(30, bold=True), fill=WHITE)
rr(d, [30, 130, 30 + 240, 130 + 54], 10, WHITE)
d.rectangle([44, 142, 64, 162], fill=TEAL)
d.line([(49, 152), (54, 157), (60, 146)], fill=WHITE, width=3)
d.text((76, 146), "3 Transaktionen markiert", font=font(15), fill=DARK)
rr(d, [30, 196, 30 + 190, 196 + 40], 20, DARK)
d.text((48, 205), "> PDF-Downloads", font=font(17, bold=True), fill=WHITE)
d.text((30, 250), "Inoffiziell · Läuft rein lokal · Kostenlos", font=font(13), fill=(210, 240, 244))
img.save(f"{OUT}/promo-small-440x280.png")

# ---------- Große Werbekachel 920x680 ----------
img = Image.new("RGB", (920, 680), TEAL)
d = ImageDraw.Draw(img)
d.text((40, 40), "Sammeldownload für", font=font(40, bold=True), fill=WHITE)
d.text((40, 88), "Scalable Capital", font=font(40, bold=True), fill=WHITE)
d.text((40, 150), "Alle Wertpapierabrechnungen des Monats mit einem Klick\nals PDF speichern – statt jede Transaktion einzeln zu öffnen.", font=font(19), fill=(225, 245, 248))
# Mini-Liste
mini = [
    ("Vanguard FTSE All-World", "Sparplan · 01.09.2026", True),
    ("iShares Core MSCI World", "Sparplan · 01.09.2026", True),
    ("iShares NASDAQ 100", "Sparplan · 01.09.2026", True),
]
for i, (nm, sb, sel) in enumerate(mini):
    y = 220 + i * 62
    rr(d, [40, y, 560, y + 54], 10, WHITE)
    if sel:
        rr(d, [54, y + 15, 78, y + 39], 6, TEAL)
        d.line([(59, y + 27), (65, y + 33), (75, y + 21)], fill=WHITE, width=3)
    else:
        rr(d, [54, y + 15, 78, y + 39], 6, (205, 214, 222))
    d.text((92, y + 7), nm, font=font(17, bold=True), fill=DARK)
    d.text((92, y + 31), sb, font=font(13), fill=GREY)
# Panel
rr(d, [600, 220, 880, 380], 14, WHITE)
d.text((616, 232), "Sammeldownload", font=font(17, bold=True), fill=DARK)
rr(d, [616, 264, 760, 294], 8, LIGHT)
d.text((626, 270), "Zeilen scannen", font=font(13), fill=DARK)
rr(d, [770, 264, 864, 294], 8, DARK)
d.text((778, 270), "Laden (3)", font=font(13, bold=True), fill=WHITE)
d.text((616, 310), "OK - 3 Abrechnungen gespeichert", font=font(14), fill=GREEN)
d.text((616, 336), "Downloads/scalable-dokumente/", font=font(12), fill=GREY)
# Footer
d.text((40, 600), "Inoffiziell · Keine Datenübertragung · Open Source · Kostenlos", font=font(16), fill=(210, 240, 244))
d.line([(40, 585), (880, 585)], fill=(0, 140, 155), width=2)
img.save(f"{OUT}/promo-large-920x680.png")

print("fertig:", os.listdir(OUT))