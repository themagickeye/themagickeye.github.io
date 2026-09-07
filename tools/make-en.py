#!/usr/bin/env python3
"""
Generuje en/index.html z index.html.

Wersji angielskiej NIE edytuj ręcznie — zostanie nadpisana.
Edytujesz index.html, dopisujesz brakujące pary poniżej i uruchamiasz:

    python3 tools/make-en.py

Skrypt przerywa pracę, jeśli któregokolwiek wzorca nie znajdzie w źródle
albo jeśli w wyniku zostanie polski tekst — lepiej głośny błąd niż cicho
rozjechane wersje językowe.

Powód istnienia: strona jest dwujęzyczna przez dwa osobne pliki statyczne
(przełącznik na JavaScripcie unieważniłby "0 js" w stopce). Blok pieczęci
to 181 prostokątów SVG; ręczne kopiowanie prędzej czy później by je
rozjechało, a tak oba pliki mają go zawsze identycznego.
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
DST = ROOT / "en" / "index.html"

# Pary (polski, angielski). Kolejność ma znaczenie: podmieniane po kolei.
TRANSLATIONS = [
    ('<html lang="pl">', '<html lang="en">'),
    ('content="The Magick Eye — oficjalna strona zespołu. Rytuały, inkantacje, gnoza."',
     'content="The Magick Eye — official band site. Rites, incantations, gnosis."'),
    ('aria-label="Pieczęć zespołu: heksagram unikursalny z Okiem w środku"',
     'aria-label="Band seal: unicursal hexagram with an Eye at its centre"'),

    # nawigacja
    ('<a href="#info">GNOZA</a>', '<a href="#info">GNOSIS</a>'),
    ('<a href="#koncerty">RYTUAŁY</a>', '<a href="#koncerty">RITES</a>'),
    ('<a href="#media">INKANTACJE</a>', '<a href="#media">INCANTATIONS</a>'),
    ('<a href="#kontakt">TELEPATIA</a>', '<a href="#kontakt">TELEPATHY</a>'),

    # tytuły sekcji
    ('☤ GNOZA', '☤ GNOSIS'),
    ('☤ RYTUAŁY', '☤ RITES'),
    ('☤ INKANTACJE', '☤ INCANTATIONS'),
    ('☤ TELEPATIA', '☤ TELEPATHY'),

    # treść
    ('<p class="info-text">Zespół z Poznania.</p>',
     '<p class="info-text">A band from Poznań.</p>'),
    ('<span class="stat-key">KONTAKT:</span>', '<span class="stat-key">CONTACT:</span>'),

    # terminy — zapis daty czytelny dla anglojęzycznych
    ('<span class="gig-date">20.09.2026</span>', '<span class="gig-date">20 Sep 2026</span>'),
    ('<span class="gig-date">16.10.2026</span>', '<span class="gig-date">16 Oct 2026</span>'),
    ('<span class="gig-date">17.10.2026</span>', '<span class="gig-date">17 Oct 2026</span>'),
    ('<span class="gig-date">17.12.2026</span>', '<span class="gig-date">17 Dec 2026</span>'),
    ('Fort II — live sesja', 'Fort II — live session'),
    # nazwy klubów zostają — to nazwy własne. Miasto tylko tam, gdzie
    # angielski ma utrwaloną formę: Warszawa -> Warsaw.
    ('<span class="gig-city">Warszawa</span>', '<span class="gig-city">Warsaw</span>'),

    # ścieżki: plik leży o katalog głębiej
    ('href="style.css?v=', 'href="../style.css?v='),

    # przełącznik języka: aktywny EN, link do PL
    ('''    <nav class="lang-switch" aria-label="Wersja językowa">
      <span class="lang-label">lang</span>
      <span class="lang-sep">│</span>
      <span class="lang-cur" aria-current="page">PL</span>
      <a href="en/" hreflang="en" lang="en">EN</a>
    </nav>''',
     '''    <nav class="lang-switch" aria-label="Language">
      <span class="lang-label">lang</span>
      <span class="lang-sep">│</span>
      <a href="../" hreflang="pl" lang="pl">PL</a>
      <span class="lang-cur" aria-current="page">EN</span>
    </nav>'''),
]

# Słowa, które po tłumaczeniu nie mają prawa zostać w treści.
# Komentarze w kodzie są po polsku celowo — sprawdzamy tekst bez nich.
FORBIDDEN = ["GNOZA", "RYTUAŁY", "INKANTACJE", "TELEPATIA",
             "KONTAKT:", "Zespół", "live sesja", "Warszawa"]


def main() -> int:
    html = SRC.read_text(encoding="utf-8")

    missing = [pl for pl, _ in TRANSLATIONS if pl not in html]
    if missing:
        print("BŁĄD: tych wzorców nie ma w index.html:", file=sys.stderr)
        for m in missing:
            print(f"  {m[:70]}", file=sys.stderr)
        print("\nZmieniłeś polską treść bez dopisania pary tutaj.", file=sys.stderr)
        return 1

    for pl, en in TRANSLATIONS:
        html = html.replace(pl, en)

    body = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    leftovers = [w for w in FORBIDDEN if w in body]
    if leftovers:
        print(f"BŁĄD: polski tekst został w wersji EN: {leftovers}", file=sys.stderr)
        return 1

    left = sorted(set(re.findall(r"\[[A-Z_0-9]+\]", html)))
    DST.parent.mkdir(exist_ok=True)
    DST.write_text(html, encoding="utf-8")

    print(f"OK  {DST.relative_to(ROOT)}  ({len(html)} B)")
    print(f"    niewypełnione pola: {left or 'brak'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
