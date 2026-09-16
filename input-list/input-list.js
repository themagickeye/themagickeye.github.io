/* ============================================================
   KONFIGURATOR LISTY WEJŚCIOWEJ — The Magick Eye
   Czysty JS, zero zależności, działa z file:// i z GitHub Pages.

   Model jest jednokierunkowy: stan -> lista kanałów -> DOM.
   Nic nie czyta z DOM-u poza obsługą zdarzeń, więc nie ma
   stanu rozsianego po polach formularza.

   Liczby XR18 (16 kanałów, aux return U17/U18, 6 busów,
   pary linkowane 1-2, 3-4, …) są potwierdzone plikami scen
   z X-AIR Edit. Wszystko, czego NIE dało się potwierdzić
   plikiem ani instrukcją, jest w UI oznaczone jako
   "do potwierdzenia" i nie jest wpisywane w eksport jako fakt.
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   1. KONSOLE
   auxReturn = ile mono-slotów zwrotu USB (XR18: U17 i U18).
   verified  = czy pojemności pochodzą z pomiaru, czy z pamięci.
   ------------------------------------------------------------ */
/* linksAdjacent = czy stereo trzeba sklejać z DWÓCH sąsiednich kanałów.
   Na XR18 tak i tylko w parach 1-2, 3-4 … Na Wingu nie: instrukcja
   (Firmware 3.1, sekcja 2.2) mówi wprost, że kanały 1-40 obsługują mono,
   stereo i mid/side „without requiring adjacent channel linking", a busy
   B1-B16 są stereo z natury. To zmienia rachunek: para stereo zjada tam
   jeden kanał, nie dwa, i nie ma czego wyrównywać. */
/* aes50 = liczba gniazd AES50 na konsolecie. XR18 nie ma żadnego, więc
   stagebox nie ma do czego się wpiąć; Wing ma trzy (instrukcja 3.1,
   sekcja 3.4), po 48 kanałów w każdą stronę na gniazdo.

   variants = lokalne I/O zależy od odmiany Winga, a różnica jest ogromna
   (8 preampów kontra 24), więc odmianę wybiera się osobno. */
const TARGETS = {
  xr18: { label: 'Behringer XR18', channels: 16, auxReturn: 2, buses: 6,
          locked: true,  verified: true,  linksAdjacent: true,  aes50: 0 },
  /* locked, bo liczby pochodzą z instrukcji, nie z pamięci — inaczej
     starszy zapis (z błędnym 48) nadpisywałby je przy wczytaniu pliku. */
  wing: { label: 'Behringer Wing', channels: 40, auxReturn: 8, buses: 16,
          locked: true,  verified: true,  linksAdjacent: false, aes50: 3,
          variants: 'wing' },
  other:{ label: 'Inna konsola',   channels: 32, auxReturn: 2, buses: 8,
          locked: false, verified: false, linksAdjacent: true,  aes50: 2 }
};

/* ------------------------------------------------------------
   1a. LOKALNE I/O KONSOLETY
   Instrukcja WING (2025-10-20) rozstrzyga to wprost i jest to
   odpowiedź na pytanie „czy gniazda na stole działają RAZEM ze
   stageboxem": tak, bez żadnego zastrzeżenia. Sekcja 5.4 ROUTING
   wylicza grupy źródeł — Local In, Aux In, AES50 A/B/C, USB … —
   i mówi, że każdy z 40 kanałów wybiera swoje źródło niezależnie.
   Nie ma trybu „albo lokalne, albo AES50"; kanał 1 może siedzieć na
   preampie w stole, a kanał 2 na stageboxie.

   Liczby (sekcja 2.1 oraz 3.1–3.3):
     WING          8 preampów XLR + 8 linii Aux In (TRS)  + 8 wyjść XLR
     WING COMPACT  24 preampy XLR, Aux In BRAK            + 8 wyjść XLR
     WING RACK     24 preampy XLR, Aux In BRAK            + 8 wyjść XLR
   Aux In jest tylko w pełnym WING-u — instrukcja zaznacza to nawiasem
   „(WING only)". To wejścia LINIOWE: nie ma tam preampu ani phantomu,
   więc mikrofon się w nie nie wepnie.
   ------------------------------------------------------------ */
const CONSOLE_VARIANTS = {
  wing: {
    wing:    { label: 'WING (pełny)', ins: 8,  auxin: 8, outs: 8 },
    compact: { label: 'WING COMPACT', ins: 24, auxin: 0, outs: 8 },
    rack:    { label: 'WING RACK',    ins: 24, auxin: 0, outs: 8 }
  }
};
const LOCAL_ID = 'LCL';

/* ------------------------------------------------------------
   1b. STAGEBOXY
   Wing nie ma ULTRANET-u — droga do P16 prowadzi przez AES50 do
   stageboxa, który ten port MA. Liczby niżej pochodzą z kart
   produktów Behringera i Midasa (Thomann, Sweetwater; wrzesień 2026).
   Czego karta nie mówi wprost, stoi jako null i w UI jest oznaczone
   jako niepotwierdzone.

   Najniższy model spełniający oba warunki (AES50 + ULTRANET) to SD8:
   8 wejść / 8 wyjść, 2× AES50, hub ULTRANET zasilający dwa P16-M po
   skrętce. Stopień wyżej jest SD16 (16/8, ULTRANET ×4) — tańszy od
   S16 i o trzy porty ULTRANET bogatszy. Seria S i DL ma jeden port
   ULTRANET; karty nie mówią, czy zasila P16-M, więc powersP16: null.
   Które numery wejść SD8/SD16 przyjmują Hi-Z, karta też nie mówi —
   dlatego hiZ to liczba, nie lista gniazd.

   AES50 przenosi 48 kanałów w każdą stronę; dwa boksy w łańcuchu na
   jednym gnieździe konsolety muszą się w tym zmieścić. Każdy model
   niżej ma dwa gniazda AES50, więc każdy może być pierwszym ogniwem.

   adat = ile ośmiokanałowych bloków ADAT boks wystawia NA WYJŚCIU.
   To jest droga do dołożenia wyjść analogowych: optyczny TOSLINK do
   przetwornika ADA8000 albo ADA8200 daje osiem dodatkowych XLR-ów.
   Uwaga na kierunek — w DL16, DL32, S16 i S32 gniazda ADAT są
   WYJŚCIAMI, więc tą drogą przybywa wyjść, a wejść nie. Karty SD8
   i SD16 ADAT-u nie wymieniają wcale.
   ------------------------------------------------------------ */
const STAGEBOXES = {
  sd8:  { label: 'Behringer SD8',  ins: 8,  outs: 8,  hiZ: 2, aes50: 2, ultranet: 2, adat: 0, powersP16: true, verified: true,  extra: '' },
  sd16: { label: 'Behringer SD16', ins: 16, outs: 8,  hiZ: 2, aes50: 2, ultranet: 4, adat: 0, powersP16: true, verified: true,  extra: '' },
  s16:  { label: 'Behringer S16',  ins: 16, outs: 8,  hiZ: 0, aes50: 2, ultranet: 1, adat: 2, powersP16: null, verified: true,  extra: 'MIDI' },
  s32:  { label: 'Behringer S32',  ins: 32, outs: 16, hiZ: 0, aes50: 2, ultranet: 1, adat: 2, powersP16: null, verified: true,  extra: 'AES3, MIDI' },
  dl16: { label: 'Midas DL16',     ins: 16, outs: 8,  hiZ: 0, aes50: 2, ultranet: 1, adat: 2, powersP16: null, verified: true,  extra: '' },
  dl32: { label: 'Midas DL32',     ins: 32, outs: 16, hiZ: 0, aes50: 2, ultranet: 1, adat: 2, powersP16: null, verified: true,  extra: 'AES3' },
  other:{ label: 'Inny stagebox',  ins: 16, outs: 8,  hiZ: 0, aes50: 2, ultranet: 1, adat: 0, powersP16: null, verified: false, extra: '', custom: true }
};
/* Przetwornik ADAT→analog dopięty do gniazda optycznego boksu.
   Osiem wyjść XLR na sztukę, ale stoi we WŁASNEJ obudowie i łączy
   się światłowodem TOSLINK — a ten jest krótki i sztywny, więc
   przetwornik musi stać tuż obok boksu, nie po drugiej stronie sceny. */
const EXP_OUTS = 8;
const EXP_LABEL = 'ADA8000 / ADA8200';
const SB_LETTERS = ['A', 'B'];
const AES50_PORTS = ['A', 'B', 'C'];
const AES50_CH = 48;

/* ------------------------------------------------------------
   1c. IKONY POŁĄCZEŃ
   Poprzednia wersja używała znaków Unicode (◉ ◎ ▭ ⌇ ⌁) i to był błąd:
   w foncie ekranowym i w Helvetice na wydruku wyglądają jak plamy,
   a ◉ od ◎ nie odróżni nikt, kto nie wie, że ma je porównywać.
   Teraz każdy typ to mały rysunek SVG plus krótki podpis — kształt
   niesie znaczenie, a podpis je domyka.

   SVG jest wpisany w kod, a nie ładowany z pliku: strona ma działać
   z file:// i bez ani jednego dodatkowego żądania. stroke="currentColor"
   sprawia, że ikona jest zielona na ekranie i czarna na wydruku bez
   żadnej osobnej reguły.
   ------------------------------------------------------------ */
function svg(body) {
  return '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false" ' +
    'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
    body + '</svg>';
}
const ICONS = {
  /* Mikrofon ręczny: kapsuła + pałąk + nóżka. */
  mic:   svg('<rect x="5.6" y="1.2" width="4.8" height="8" rx="2.4"/>' +
             '<path d="M3.4 7.4a4.6 4.6 0 0 0 9.2 0"/><path d="M8 12v2.8"/><path d="M5.7 14.8h4.6"/>'),
  /* Pojemnościowy: ta sama sylwetka, ale z siatką na kapsule — plus
     podpis „48V", bo to phantom jest tu informacją, nie typ kapsuły. */
  mic48: svg('<rect x="5.6" y="1.2" width="4.8" height="8" rx="2.4"/>' +
             '<path d="M5.6 4h4.8M5.6 6.2h4.8"/>' +
             '<path d="M3.4 7.4a4.6 4.6 0 0 0 9.2 0"/><path d="M8 12v2.8"/><path d="M5.7 14.8h4.6"/>'),
  /* Wtyk jack/DI wjeżdżający w gniazdo od lewej. */
  line:  svg('<path d="M1.6 8h3.2"/><path d="M4.8 5.8v4.4"/>' +
             '<rect x="6" y="5.2" width="5.2" height="5.6" rx="1.2"/><path d="M11.2 8h2.9"/>'),
  /* Trójząb USB — jedyny znak, który wszyscy czytają bez podpisu. */
  usb:   svg('<path d="M8 14.4V3.2"/><circle cx="8" cy="2.1" r="1.1" fill="currentColor" stroke="none"/>' +
             '<path d="M8 10 5.2 7.4V5.6"/><rect x="4.2" y="3.9" width="2" height="2" fill="currentColor" stroke="none"/>' +
             '<path d="M8 8.2l2.9-2.4"/><circle cx="11.2" cy="5.2" r="1.1"/>'),
  /* Odsłuch podłogowy: klin ustawiony skosem, z głośnikiem. */
  mon:   svg('<path d="M1.8 13.2 4 4.6h8.4l1.8 8.6z"/><circle cx="8" cy="9.6" r="2.2"/>'),
  /* Gniazdo RJ45 od przodu: obrys z języczkiem u dołu i stykami
     u góry. Tego kształtu nie da się pomylić z niczym innym na
     kartce, a właśnie o skrętkę tu chodzi. */
  rj45:  svg('<path d="M1.8 2.6h12.4v8.1h-3.1v2.7H4.9v-2.7H1.8z"/>' +
             '<path d="M4.4 4.6v2.1M6 4.6v2.1M7.6 4.6v2.1M9.2 4.6v2.1M10.8 4.6v2.1"/>'),
  /* Stagebox: skrzynka z rzędem gniazd. */
  box:   svg('<rect x="1.4" y="3.6" width="13.2" height="8.8" rx="1.2"/>' +
             '<circle cx="4.6" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="11.4" cy="8" r="1.25"/>'),
  /* Przetwornik ADAT: skrzynka z okrągłym okiem optycznym i rzędem
     wyjść — kształt mówi „to osobne pudełko", a o to tu chodzi. */
  ada:   svg('<rect x="1.4" y="3.6" width="13.2" height="8.8" rx="1.2"/>' +
             '<circle cx="4.6" cy="8" r="1.8"/><circle cx="4.6" cy="8" r="0.5" fill="currentColor" stroke="none"/>' +
             '<path d="M8.4 6.2h4.4M8.4 8h4.4M8.4 9.8h4.4"/>'),
  /* Konsoleta: obrys pulpitu z trzema fejderami. */
  desk:  svg('<rect x="1.4" y="2.6" width="13.2" height="10.8" rx="1.2"/>' +
             '<path d="M4.6 5v6M8 5v6M11.4 5v6"/>' +
             '<circle cx="4.6" cy="7" r="1.1" fill="currentColor" stroke="none"/>' +
             '<circle cx="8" cy="9.4" r="1.1" fill="currentColor" stroke="none"/>' +
             '<circle cx="11.4" cy="6.4" r="1.1" fill="currentColor" stroke="none"/>')
};

/* short = podpis przy ikonie w ciasnych miejscach (tabela, wydruk).
   Pusty tam, gdzie rysunek mówi wszystko sam. */
const CONN = {
  mic:   { ico: 'mic',   short: '',     label: 'MIC',       desc: 'mikrofon dynamiczny — XLR w preamp' },
  mic48: { ico: 'mic48', short: '48V',  label: 'MIC 48V',   desc: 'mikrofon pojemnościowy — XLR, włączyć phantom' },
  line:  { ico: 'line',  short: '',     label: 'DI / LINE', desc: 'sygnał liniowy albo z DI: modeler, pad, DI basu' },
  usb:   { ico: 'usb',   short: '',     label: 'USB',       desc: 'z komputera po USB — nie ma gniazda na scenie' },
  mon:   { ico: 'mon',   short: '',     label: 'MON',       desc: 'odsłuch: bus na wyjściu XLR' },
  p16:   { ico: 'rj45',  short: '16',   label: 'P16',       desc: 'ULTRANET — 16 kanałów skrętką do P16-M' },
  box:   { ico: 'box',   short: '',     label: 'SB',        desc: 'stagebox' },
  desk:  { ico: 'desk',  short: '',     label: 'PULT',      desc: 'gniazdo na samej konsolecie' },
  ada:   { ico: 'ada',   short: '',     label: 'ADAT',      desc: 'przetwornik ADAT→analog przy boksie: dodatkowe wyjścia XLR' }
};
/* Ikona z podpisem — jedna funkcja na wszystkie miejsca, żeby ekran
   i wydruk nie rozjechały się przy najbliższej zmianie. */
function icon(k, withText) {
  const c = CONN[k];
  if (!c) return '';
  const t = withText ? (c.short || '') : '';
  return '<span class="sym" title="' + esc(c.label) + '">' + ICONS[c.ico] +
    (t ? '<span class="sym-t">' + esc(t) + '</span>' : '') + '</span>';
}
/* Typy, które można wybrać ręcznie dla kanału. USB nie — o nim
   decyduje źródło, nie człowiek. */
const CONN_PICK = ['mic', 'mic48', 'line'];

/* ------------------------------------------------------------
   1b. SŁOWNIK P16 — ustalony pomiarem
   Źródło: IOpatchingP16.scn, eksport z X-AIR Edit, w którym każdy
   slot dostał inne źródło i inny punkt odczepu. Nic tu nie jest
   zgadnięte — każdy token stoi w tamtym pliku.

   Post Fader nie ma wariantu "+ Mute" i to nie jest przeoczenie:
   za faderem mute już zadziałał, więc nie ma czego dublować.
   ------------------------------------------------------------ */
const P16_TAPS = [
  { v: 'AIN',      label: 'Analog' },
  { v: 'AIN+M',    label: 'Analog + Mute' },
  { v: 'IN',       label: 'Input' },
  { v: 'IN+M',     label: 'Input + Mute' },
  { v: 'PREEQ',    label: 'Pre EQ' },
  { v: 'PREEQ+M',  label: 'Pre EQ + Mute' },
  { v: 'POSTEQ',   label: 'Post EQ' },
  { v: 'POSTEQ+M', label: 'Post EQ + Mute' },
  { v: 'PRE',      label: 'Pre Fader' },
  { v: 'PRE+M',    label: 'Pre Fader + Mute' },
  { v: 'POST',     label: 'Post Fader' }
];
const DEFAULT_TAP = 'IN';

/* Mikrofony zespołu, przypisane do źródeł po id kanału (L i R pary
   osobno, bo prowadząca dostaje dwa różne). Kolumna jest po to, żeby
   spakować się bez liczenia na palcach i rozstawić scenę bez pytania
   „a co tu wchodzi". Wszystko da się nadpisać w tabeli; tu są tylko
   punkty startowe. Nazwy w pisowni producentów.

   Rachunek klipsów: e 604 są trzy, na kotły idą dwa (tom 1 + floor),
   trzeci schodzi na spód werbla — dzięki temu drugi i5 zwalnia się
   dla gitary prowadzącej. Hi-hat i DI basu nie mają tu modelu, bo
   zespół go nie ma: albo pożyczony, albo od realizatora. */
const MIC_DEFAULTS = {
  kick_in:   'Behringer BA 19A',
  kick_out:  'AKG D550',
  snare_t:   'Audix i5',
  snare_b:   'Sennheiser e 604',
  hihat:     '',
  tom1:      'Sennheiser e 604',
  tom2:      'Sennheiser e 604',
  floor1:    'Sennheiser e 604',
  floor2:    '',
  oh_l:      'sE Electronics sE2200a II C',
  oh_r:      'sE Electronics sE2200a II C',
  oh:        'sE Electronics sE2200a II C',
  bass_di:   '',
  bass_amp:  'Shure SM58',
  gtr_rhy_l: 'Sennheiser e 906',
  gtr_rhy_r: 'Sennheiser e 906',
  gtr_rhy:   'Sennheiser e 906',
  gtr_ld_l:  'Audix i5',
  gtr_ld_r:  'Shure SM58',
  gtr_ld:    'Audix i5',
  vox_drums: 'Audix OM5',
  vox_bass:  'dowolny — tylko do komunikacji',
  vox_rhy:   'Shure SM58',
  vox_lead:  'własny wokalisty'
};

/* Mocowanie mikrofonu — z tego liczy się statywy do spakowania.
   stand: statyw, clip: klips na obręcz. Reszta to „nie potrzebuje
   niczego": leży w bębnie, wisi na kablu (klasyk z e 906 na piecu)
   albo jest odłożony. Niskiego statywu nie rozróżniamy: zespół nie ma
   ich więcej, więc liczba statywów jest jedna. */
const MOUNTS = {
  none:  { label: '—',        stand: false, clip: false },
  clip:  { label: 'klips',    stand: false, clip: true  },
  stand: { label: 'statyw',   stand: true,  clip: false },
  cable: { label: 'na kablu', stand: false, clip: false },
  loose: { label: 'odłożony', stand: false, clip: false }
};
/* Domyślne po id kanału. Czego tu nie ma, dostaje statyw, gdy jest
   mikrofonem, i myślnik, gdy jest linią albo USB. */
const MOUNT_DEFAULTS = {
  kick_in:   'none',      // BA 19A leży w centrali
  kick_out:  'stand',
  snare_t:   'clip',
  snare_b:   'clip',
  hihat:     'stand',
  tom1:      'clip',
  tom2:      'clip',
  floor1:    'clip',
  floor2:    'clip',
  oh_l:      'stand',
  oh_r:      'stand',
  oh:        'stand',
  room_l:    'stand',
  room_r:    'stand',
  room:      'stand',
  bass_di:   'none',
  bass_amp:  'stand',
  gtr_rhy_l: 'cable',     // e 906 zwieszone na kablu — bez statywu
  gtr_rhy_r: 'cable',
  gtr_rhy:   'cable',
  gtr_ld_l:  'stand',
  gtr_ld_r:  'stand',
  gtr_ld:    'stand',
  vox_drums: 'stand',
  vox_bass:  'loose',     // do komunikacji — może leżeć obok
  vox_rhy:   'stand',
  vox_lead:  'stand'
};

const VOX_MICS = [
  { k: 'drums', id: 'vox_drums', name: 'VOX DRUMS', label: 'Perkusista' },
  { k: 'bass',  id: 'vox_bass',  name: 'VOX BASS',  label: 'Basista'    },
  { k: 'rhy',   id: 'vox_rhy',   name: 'VOX RHY',   label: 'Rytmiczna'  },
  { k: 'lead',  id: 'vox_lead',  name: 'VOX LEAD',  label: 'Lead'       }
];

/* Które pary źródło↔odczep faktycznie widzieliśmy w eksporcie.
   Dla kanałów zmierzono AIN/IN/PREEQ/POSTEQ (z mutami), dla
   powrotów USB IN/PRE/PRE+M, dla Aux In POST, a dla busów, FX,
   wysyłek i Main — wyłącznie IN. Reszta kombinacji może być
   legalna, ale tego nie sprawdziliśmy, więc mówimy o tym wprost
   zamiast udawać, że wiemy. */
const TAP_MEASURED = {
  'Kanały':      ['AIN', 'AIN+M', 'IN', 'IN+M', 'PREEQ', 'PREEQ+M', 'POSTEQ', 'POSTEQ+M'],
  'Zwrot aux':   ['IN', 'PRE', 'PRE+M'],
  'Aux In':      ['POST'],
  /* P16odczepy.scn: Bus1 PREEQ, Bus2 POSTEQ, Bus3 POST — bus bierze
     te same tokeny co kanał. Nie sprawdzone: AIN (na busie nie ma
     czego mierzyć przed EQ), PRE i warianty +M. */
  'Busy':        ['IN', 'PREEQ', 'POSTEQ', 'POST'],
  'Main':        ['IN'],
  'Wysyłki FX':  ['IN'],
  'Powroty FX':  ['IN']
};

/* Punkty, które są na pulpicie zawsze — nie biorą się z listy
   wejściowej, więc konfigurator ich nie generuje, tylko oferuje. */
const FX_RETURNS = ['1L','1R','2L','2R','3L','3R','4L','4R'];

/* ------------------------------------------------------------
   2. STAN
   Preset domyślny = lista, od której zaczynamy: dokładnie te
   16 kanałów, które siedzą dziś w MagickEye_Proby.scn.
   ------------------------------------------------------------ */
function defaultState() {
  return {
    v: 1,
    /* Bez daty i miejsca: strona jest publiczna, a konkretny koncert
       to nie jest coś, co ma stać w domyślnych ustawieniach narzędzia.
       Wpisuje się na miejscu i zostaje w przeglądarce albo w linku. */
    gig:  { name: 'Sesja live', date: '', console: '' },
    target: 'xr18',
    /* Odmiana konsolety — dla Winga rozstrzyga, ile jest gniazd na
       samym stole (8 kontra 24 preampy). Domyślnie pełny WING, bo to
       wariant ostrożniejszy: ma ich najmniej. */
    variant: 'wing',
    cap: null,                 // nadpisanie pojemności dla konsol nie-XR18
    localCap: null,            // lokalne I/O dla konsolety spoza katalogu
    src: {
      kick: 2, snare: 1, hihat: false,
      /* Zestaw ma dwa wysokie i dwa floor. Liczba nie wystarczy — „3"
         nie mówi, KTÓRE trzy — więc każdy kocioł ma własny przełącznik. */
      toms: { t1: true, t2: true, f1: true, f2: false },
      oh: 'stereo', room: 'none', spd: 'none',
      bass: 'di', gtrRhy: 1, gtrLd: 2,
      /* Tak jak przy tomach: liczba nie mówi, KTÓRE mikrofony, a przy
         czterech śpiewających to jest różnica. Basista dochodzi głównie
         po to, żeby móc się odezwać w odsłuchach. */
      vox: { drums: true, bass: false, rhy: true, lead: true },
      click: true,  clickOnAux: false,
      tape: 'stereo', tapeOnAux: true,
      aux: []                  // [{name, stereo}]
    },
    alignPairs: true,
    links: {},                 // ręczne nadpisania linku: { "7": true|false }
    /* Busy opisane instrumentem, nie osobą. Strona jest publiczna, a
       „kto na czym gra" i tak wynika z listy wejściowej — imię niczego
       nie dodaje poza wskazaniem konkretnego człowieka.
       Rytmicznej tu nie ma, bo idzie na P16 przez ULTRANET, nie busem. */
    buses: [
      { name: 'Bębny',      stereo: true, out: 'aux' },
      { name: 'Bas',        stereo: true, out: 'aux' },
      { name: 'Prowadząca', stereo: true, out: 'aux' }
    ],
    /* Odsłuch przez ULTRANET nie zajmuje busa, ale realizator musi
       o nim wiedzieć — inaczej nie przewidzi, czym go doprowadzić.
       Stąd osobna pozycja obok busów, nie w nich. */
    p16Monitor: { on: false, name: 'Rytmiczna', stereo: true },
    printP16: true,                  // czy tabela slotów idzie na kartkę
    /* Kartka domyślnie kończy się tam, gdzie kończą się kable: boks bez
       ani jednego kabla nie idzie wcale, a lista gniazd urywa się za
       ostatnim zajętym. Oba przełączniki przywracają pełne listy — ktoś
       może chcieć dopisywać ręcznie w wolnych wierszach. */
    printEmptyNodes: false,
    printEmptyJacks: false,
    printPlot: true,                 // czy plan sceny idzie na kartkę
    /* Plan sceny: gdzie co stoi. Sloty, nie współrzędne — scena to
       siatka 3×3, a nie płótno do malowania; dwa kliknięcia zamiast
       przeciągania i zero pikselowego dłubania przy druku. */
    plot: { stations: { drums: 'bc', bass: 'mr', gtrRhy: 'ml', gtrLd: 'fc' }, boxes: ['fl', 'br'] },
    p16: emptyP16(),                 // [{ src: id|null, tap }]
    p16Tap: DEFAULT_TAP,             // odczep nadawany nowym przypisaniom
    p16Auto: true,
    /* Scena: stageboxy i patch. boxes to 0, 1 albo 2 pozycje — litera
       A/B wynika z miejsca w tablicy. patch mapuje 'rodzaj:rzecz' na
       { box, n }: 'in:kick_in' → wejście, 'out:bus_0' → wyjście XLR,
       'un:p16' → port ULTRANET (bez numeru). Wartość to { box, n, k },
       gdzie box to id węzła ('A', 'B' albo 'LCL' dla gniazd na samej
       konsolecie), a k rozróżnia gniazdo XLR od liniowego Aux In.
       auto działa jak p16Auto: wypełnia po kolei do pierwszej ręcznej
       zmiany. useLocal decyduje, czy gniazda na stole w ogóle biorą
       udział — przy realizacji z FOH-u bywa, że nie ma jak tam dojść. */
    stage: { boxes: [], patch: {}, auto: true, useLocal: true },
    /* Nadpisania typu połączenia (mic / mic48 / line) po id źródła;
       dla pary stereo kluczem jest id pary, żeby L i R szły razem. */
    conn: {},
    /* Nadpisania modelu mikrofonu po id kanału (L i R osobno). Pusty
       napis to też nadpisanie: „tu nic nie wpisuj". */
    mics: {},
    /* Nadpisania mocowania po id kanału. */
    mounts: {},
    /* Zasilanie 230 V na scenie — to, czego nie da się wyliczyć z patcha:
       wzmacniacze, pedalboardy, wzmacniacze słuchawkowe. Stageboxy
       i przetworniki dolicza kod sam. Liczby ze stanowisk zespołu;
       stanowisko prowadzącej spisane z dawnego ridera, więc do
       potwierdzenia. */
    power: [
      { station: 'Perkusja',        items: 'zasilacz wzmacniacza słuchawkowego', n: 1, place: 'stage' },
      { station: 'Bas',             items: 'wzmacniacz, pedalboard, wzmacniacz słuchawkowy', n: 3, place: 'stage' },
      { station: 'Gitara rytmiczna', items: 'Roland Jazz Chorus 120, Orange OR15, pedalboard, P16-HQ', n: 4, place: 'stage' },
      { station: 'Gitara prowadząca / wokal', items: 'Fender Champ 12, Vox AC15, rack (preamp + VoiceLive 3) — do potwierdzenia', n: 3, place: 'stage' },
      /* FOH: konsoletę dolicza kod z ustawień, komputer jest stanowiskiem,
         bo nie każdy koncert ma laptopa. Realizator pewnie ma listwę
         w racku — liczymy i tak, bo lepiej mieć za dużo przedłużaczy. */
      { station: 'FOH: komputer',   items: 'zasilacz laptopa (REAPER, USB do konsolety)', n: 1, place: 'foh' }
    ],
    powerV: 2
  };
}

function emptyP16() {
  const a = [];
  for (let i = 0; i < 16; i++) a.push({ src: null, tap: DEFAULT_TAP });
  return a;
}

let S = defaultState();

/* Pola, które w stanie są boolowskie, a w formularzu jeżdżą na radiach
   o wartościach "" / "1". Bez tej listy synchronizacja w obie strony
   rozjeżdża się cicho: String(false) to "false", a nie "". */
const BOOL_KEYS = ['hihat', 'click', 'clickOnAux', 'tapeOnAux'];

/* ------------------------------------------------------------
   3. BUDOWA LISTY ŹRÓDEŁ
   Kolejność jest tu zaszyta na sztywno i celowo: to kolejność
   z kartki dla realizatora (perkusja od stopy w górę, potem
   bas, gitary, wokale, na końcu elektronika). Zmiana kolejności
   to zmiana TEJ tablicy, nie logiki niżej.
   ------------------------------------------------------------ */
function buildSources(src) {
  const out = [];
  /* conn = domyślny typ połączenia (symbol na patchu). Mikrofon dynamiczny
     jest domyślny; pojemnościowe (+48V) tam, gdzie zwyczajowo stoją
     kondensatory; line tam, gdzie nie ma mikrofonu. Wszystko da się
     nadpisać w tabeli patcha — to punkt startowy, nie wyrok. */
  const add = (id, name, group, opt) => out.push(Object.assign(
    { id, name, group, kind: 'in', side: null, pair: null, conn: 'mic' }, opt || {}));
  const C48 = { conn: 'mic48' }, LINE = { conn: 'line' };

  /* --- perkusja --- */
  add('kick_in', src.kick === 2 ? 'KICK IN' : 'KICK', 'perkusja');
  if (src.kick === 2) add('kick_out', 'KICK OUT', 'perkusja');

  add('snare_t', src.snare === 2 ? 'SNARE T' : 'SNARE', 'perkusja');
  if (src.snare === 2) add('snare_b', 'SNARE B', 'perkusja');

  if (src.hihat) add('hihat', 'HI-HAT', 'perkusja', C48);

  /* Floor dostaje numer dopiero, gdy grają oba — przy jednym zostaje
     samo „FLOOR", tak jak na kartce, do której wszyscy przywykli. */
  const t = src.toms;
  const bothFloors = t.f1 && t.f2;
  if (t.t1) add('tom1', 'TOM 1', 'perkusja');
  if (t.t2) add('tom2', 'TOM 2', 'perkusja');
  if (t.f1) add('floor1', bothFloors ? 'FLOOR 1' : 'FLOOR', 'perkusja');
  if (t.f2) add('floor2', bothFloors ? 'FLOOR 2' : 'FLOOR', 'perkusja');

  if (src.oh === 'mono')   add('oh', 'OH', 'perkusja', C48);
  if (src.oh === 'stereo') addPair(out, 'oh', 'OH', 'perkusja', C48);

  if (src.room === 'mono')   add('room', 'ROOM', 'perkusja', C48);
  if (src.room === 'stereo') addPair(out, 'room', 'ROOM', 'perkusja', C48);

  /* Pad wchodzi liniowo, nie mikrofonem, ale na liście siedzi przy
     perkusji — tam go realizator szuka. */
  if (src.spd === 'mono')   add('spd', 'SPD-SX', 'perkusja', LINE);
  if (src.spd === 'stereo') addPair(out, 'spd', 'SPD-SX', 'perkusja', LINE);

  /* --- bas --- */
  if (src.bass === 'di'  || src.bass === 'both') add('bass_di',  'BASS DI',  'bas', LINE);
  if (src.bass === 'mic' || src.bass === 'both') add('bass_amp', 'BASS AMP', 'bas');

  /* --- gitary ---
     Mikrofony przed piecami: rytmiczna dwa e 906, prowadząca i5 plus
     SM58. Modeler po linii to zmiana typu w tabeli patcha. */
  if (src.gtrRhy === 1) add('gtr_rhy', 'GTR RHY', 'gitary');
  else addPair(out, 'gtr_rhy', 'GTR RHY', 'gitary');
  if (src.gtrLd === 1) add('gtr_ld', 'GTR LD', 'gitary');
  else addPair(out, 'gtr_ld', 'GTR LD', 'gitary');

  /* --- wokale ---
     Kolejność jest stała i idzie za pulpitem: perkusista, basista,
     rytmiczna, lead. Zmiana kolejności to zmiana TEJ tablicy. */
  VOX_MICS.forEach(v => { if (src.vox[v.k]) add(v.id, v.name, 'wokale'); });

  /* --- elektronika ---
     Klik i taśma wchodzą przez USB: na XR18 to pole 2 w
     /ch/NN/preamp (ON = USB), a nie osobne gniazdo. */
  if (src.click && !src.clickOnAux) add('click', 'CLICK', 'elektronika', { kind: 'usb', noMain: true });
  if (src.tape === 'mono'   && !src.tapeOnAux) add('tape', 'TAPE', 'elektronika', { kind: 'usb' });
  if (src.tape === 'stereo' && !src.tapeOnAux) addPair(out, 'tape', 'TAPE', 'elektronika', { kind: 'usb' });

  /* --- aux: dowolne dodatkowe wejścia --- */
  src.aux.forEach((a, i) => {
    const nm = (a.name || ('AUX ' + (i + 1))).toUpperCase();
    if (a.stereo) addPair(out, 'auxch_' + i, nm, 'dodatkowe', LINE);
    else add('auxch_' + i, nm, 'dodatkowe', LINE);
  });

  return out;
}

function addPair(arr, id, name, group, opt) {
  const base = Object.assign({ kind: 'in', conn: 'mic' }, opt || {});
  arr.push(Object.assign({ id: id + '_l', name: name + ' L', group, side: 'L', pair: id }, base));
  arr.push(Object.assign({ id: id + '_r', name: name + ' R', group, side: 'R', pair: id }, base));
}

/* Źródła, które idą na zwrot aux (USB 17/18), a nie na kanał. */
function buildAuxReturn(src) {
  const out = [];
  if (src.click && src.clickOnAux) out.push({ id: 'click', name: 'CLICK', group: 'elektronika', kind: 'usb', side: null, pair: null, noMain: true });
  if (src.tape === 'mono'   && src.tapeOnAux) out.push({ id: 'tape', name: 'TAPE', group: 'elektronika', kind: 'usb', side: null, pair: null });
  if (src.tape === 'stereo' && src.tapeOnAux) addPair(out, 'tape', 'TAPE', 'elektronika', { kind: 'usb' });
  return out;
}

/* ------------------------------------------------------------
   4. ROZŁOŻENIE NA KANAŁY
   Tu zapada jedyna nieoczywista decyzja: para stereo musi
   zaczynać się na kanale NIEPARZYSTYM, bo /config/chlink linkuje
   wyłącznie 1-2, 3-4, 5-6 … Gdy wypadłaby na parzystym, wstawiamy
   pusty kanał — kosztuje slot, ale bez tego pary nie da się
   zlinkować i pan stereo trzeba by ustawiać ręcznie.
   ------------------------------------------------------------ */
function layout(state) {
  const cap = capacity(state);
  const sources = buildSources(state.src);
  const rows = [];
  let n = 1;

  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (state.alignPairs && cap.linksAdjacent && s.side === 'L' && n % 2 === 0) {
      rows.push({ n: n++, spacer: true, name: '— wolne —' });
    }
    rows.push(Object.assign({ n: n++, spacer: false }, s));
  }

  /* Na pulpicie bez sklejania para stereo siedzi na JEDNYM kanale, choć
     wejścia fizyczne są dwa — liczymy więc osobno gniazda i osobno paski. */
  const strips = cap.linksAdjacent
    ? rows.length
    : rows.filter(r => !r.spacer && r.side !== 'R').length;

  if (cap.linksAdjacent) {
    rows.forEach(r => { r.over = r.n > cap.channels; });
  } else {
    let used = 0;
    rows.forEach(r => { if (r.side !== 'R') used++; r.over = used > cap.channels; });
  }

  /* Linki: para aktywna, jeśli L wypadła na nieparzystym i R tuż za nią.
     Ręczne nadpisanie z state.links wygrywa — realizator może chcieć
     zlinkować coś, co logicznie parą nie jest (np. dwa wokale). */
  const links = {};
  for (let i = 1; cap.linksAdjacent && i <= cap.channels; i += 2) {
    const a = rows.find(r => r.n === i), b = rows.find(r => r.n === i + 1);
    const auto = !!(a && b && a.pair && a.pair === b.pair && a.side === 'L');
    links[i] = (i in state.links) ? state.links[i] : auto;
    if (!b) links[i] = false;
  }

  return { rows, links, strips, auxRet: buildAuxReturn(state.src), cap, sources };
}

function capacity(state) {
  const t = TARGETS[state.target];
  const c = state.cap || {};
  return {
    target:    state.target,
    linksAdjacent: t.linksAdjacent,
    channels:  t.locked ? t.channels  : (c.channels  || t.channels),
    auxReturn: t.locked ? t.auxReturn : (c.auxReturn || t.auxReturn),
    buses:     t.locked ? t.buses     : (c.buses     || t.buses),
    verified:  t.verified,
    label:     t.label
  };
}

/* ------------------------------------------------------------
   5. BUSY
   Na XR18 stereo-para busów też jest sztywna (/config/buslink:
   1-2, 3-4, 5-6), więc obowiązuje ta sama zasada nieparzystego
   początku co przy kanałach.
   ------------------------------------------------------------ */
function layoutBuses(state) {
  const cap = capacity(state);
  const out = [];
  let n = 1;
  const twoSlots = b => b.stereo && cap.linksAdjacent;
  state.buses.forEach((b, i) => {
    if (twoSlots(b) && n % 2 === 0) { out.push({ idx: -1, spacer: true, n: n++ }); }
    const slots = twoSlots(b) ? [n, n + 1] : [n];
    n += twoSlots(b) ? 2 : 1;
    out.push({ idx: i, bus: b, slots, over: slots[slots.length - 1] > cap.buses });
  });
  return { rows: out, used: n - 1, cap };
}

/* ------------------------------------------------------------
   6. ŹRÓDŁA DLA P16
   Cały słownik /routing/p16/SS, odczytany z IOpatchingP16.scn:
   ChNN, UNN, AuxL/AuxR, Fx1L…Fx4R, Bus1…Bus6, Send1…Send4, L/R.
   Busy JEST czym karmić ULTRANET — to była ostatnia niewiadoma.

   auto:true dostają tylko kanały i zwrot aux. „Wypełnij po kolei"
   ma rozłożyć listę wejściową, a nie zasypać odsłuch busami.
   ------------------------------------------------------------ */
function p16Sources(L, B) {
  const list = [];
  const push = (id, osc, label, grp, auto) =>
    list.push({ id, osc, label, grp, auto: !!auto });

  L.rows.forEach(r => {
    if (r.spacer || r.over) return;
    push(r.id, 'Ch' + pad(r.n), 'Ch' + pad(r.n) + '  ' + r.name, 'Kanały', true);
  });

  L.auxRet.forEach((r, i) => {
    if (i >= L.cap.auxReturn) return;
    push('aux_' + r.id, 'U' + (17 + i), 'U' + (17 + i) + '  ' + r.name, 'Zwrot aux', true);
  });

  /* Tylko dla XR18 — tokeny są jego, nie uniwersalne. */
  if (L.cap.target !== 'xr18') return list;

  B.rows.forEach(r => {
    if (r.spacer) return;
    r.slots.forEach((sl, k) => {
      if (sl > B.cap.buses) return;
      const side = r.bus.stereo ? (k === 0 ? ' L' : ' R') : '';
      push('bus_' + sl, 'Bus' + sl, 'Bus' + sl + '  ' + (r.bus.name || '') + side, 'Busy');
    });
  });

  push('main_l', 'L', 'Main L', 'Main');
  push('main_r', 'R', 'Main R', 'Main');
  push('auxin_l', 'AuxL', 'Aux In L', 'Aux In');
  push('auxin_r', 'AuxR', 'Aux In R', 'Aux In');
  for (let i = 1; i <= 4; i++) push('send_' + i, 'Send' + i, 'Send ' + i + '  (wysyłka FX)', 'Wysyłki FX');
  FX_RETURNS.forEach(t => push('fx_' + t, 'Fx' + t, 'FX ' + t + '  (powrót)', 'Powroty FX'));

  return list;
}

function autoFillP16(L, B) {
  const pool = p16Sources(L, B).filter(a => a.auto);
  const slots = emptyP16();
  for (let i = 0; i < 16 && i < pool.length; i++) {
    slots[i] = { src: pool[i].id, tap: S.p16Tap || DEFAULT_TAP };
  }
  return slots;
}

/* ------------------------------------------------------------
   6b. SCENA: STAGEBOXY I PATCH
   Patch to mapa „co w które gniazdo". Klucz opisuje rodzaj i rzecz
   ('in:kick_in', 'out:bus_0', 'un:p16'), wartość — stagebox (indeks)
   i numer gniazda. ULTRANET nie ma numeru: to port, nie gniazdo XLR.
   Automat wypełnia po kolei do pierwszej ręcznej zmiany — tak jak
   sloty P16. Rozmieszczenie po scenie (perkusja przy jednym boksie,
   gitary przy drugim) to decyzja człowieka, nie algorytmu.
   ------------------------------------------------------------ */
function stageActive(state) {
  return TARGETS[state.target].aes50 > 0 && state.stage.boxes.length > 0;
}

/* Pojemność konkretnego boksu: z katalogu, a dla „innego" z pól
   wpisanych ręcznie. */
function boxSpec(box) {
  const m = STAGEBOXES[box.model] || STAGEBOXES.other;
  const s = Object.assign({}, m);
  if (m.custom) { s.ins = box.ins || m.ins; s.outs = box.outs == null ? m.outs : box.outs; }
  /* Przetworniki ADAT: tyle sztuk, ile boks ma bloków optycznych. */
  s.exp = Math.min(box.exp || 0, m.adat);
  return s;
}

/* Lokalne I/O konsolety. Dla Winga z katalogu odmian, dla konsolety
   spoza katalogu — z pól wpisanych ręcznie (i wtedy niepotwierdzone). */
function localSpec(state) {
  const t = TARGETS[state.target];
  const vs = CONSOLE_VARIANTS[t.variants];
  if (vs) {
    const v = vs[state.variant] || vs[Object.keys(vs)[0]];
    return { label: v.label, ins: v.ins, auxin: v.auxin, outs: v.outs, verified: true, custom: false };
  }
  const c = state.localCap || {};
  return { label: t.label, ins: c.ins || 0, auxin: 0, outs: c.outs || 0, verified: false, custom: true };
}

/* Węzły patcha: wszystko, co ma gniazda. Kolejność jest kolejnością
   automatu i nie jest przypadkowa — najpierw stageboxy, bo stoją NA
   SCENIE, a dopiero na końcu gniazda samej konsolety. Przy realizacji
   z FOH-u wpięcie do stołu znaczy analogowy kabel przez całą salę,
   więc to ostatnia deska ratunku, nie pierwszy wybór. */
function stageNodes(state) {
  const out = [];
  state.stage.boxes.forEach((b, i) => {
    const sp = boxSpec(b);
    out.push({ id: SB_LETTERS[i], idx: i, local: false, model: b.model, label: sp.label,
      jacks: { in: sp.ins, auxin: 0, out: sp.outs, expout: sp.exp * EXP_OUTS },
      ultranet: sp.ultranet, powersP16: sp.powersP16, verified: sp.verified, custom: !!sp.custom,
      hiZ: sp.hiZ, aes50: sp.aes50, adat: sp.adat, exp: sp.exp, extra: sp.extra,
      port: b.port || 'A', pos: b.pos || '' });
  });
  if (state.stage.useLocal) {
    const ls = localSpec(state);
    if (ls.ins || ls.auxin || ls.outs) {
      out.push({ id: LOCAL_ID, idx: -1, local: true, label: ls.label,
        jacks: { in: ls.ins, auxin: ls.auxin, out: ls.outs, expout: 0 },
        ultranet: 0, powersP16: false, verified: ls.verified, custom: ls.custom,
        hiZ: 0, aes50: TARGETS[state.target].aes50, adat: 0, exp: 0, extra: '', port: null,
        pos: 'przy konsolecie' });
    }
  }
  return out;
}
const nodeById = (nodes, id) => nodes.find(n => n.id === id) || null;

/* Ile gniazd danego rodzaju ma węzeł. Rodzaje: in (XLR z preampem),
   auxin (liniowe TRS, bez preampu i bez phantomu), out (XLR wyjściowe). */
function jackCap(node, kind) {
  return node && node.jacks ? (node.jacks[kind] || 0) : 0;
}

function connOf(r) {
  if (r.kind === 'usb') return 'usb';
  return S.conn[r.pair || r.id] || r.conn || 'mic';
}

/* Model mikrofonu dla wiersza: nadpisanie po id kanału wygrywa,
   potem domyślne po id, po id z „_l" (mono OH bierze to, co L) i po
   id pary. USB nie ma mikrofonu z definicji. */
function micDefault(r) {
  if (r.kind === 'usb') return '';
  const keys = [r.id, r.id + '_l', r.pair].filter(Boolean);
  for (let i = 0; i < keys.length; i++) if (MIC_DEFAULTS[keys[i]] !== undefined) return MIC_DEFAULTS[keys[i]];
  return '';
}
function micOf(r) {
  if (r.kind === 'usb') return '';
  const keys = [r.id, r.id + '_l', r.pair].filter(Boolean);
  for (let i = 0; i < keys.length; i++) if (S.mics[keys[i]] !== undefined) return S.mics[keys[i]];
  return micDefault(r);
}

/* Do spakowania: ile sztuk którego modelu. Liczymy po wierszach z
   listy (para stereo to dwa mikrofony), pomijamy puste i USB. Sort po
   liczbie, potem po nazwie — na kartce najpierw to, czego jest dużo. */
function mountDefault(r) {
  if (r.kind === 'usb') return 'none';
  const keys = [r.id, r.id + '_l', r.pair].filter(Boolean);
  for (let i = 0; i < keys.length; i++) if (MOUNT_DEFAULTS[keys[i]] !== undefined) return MOUNT_DEFAULTS[keys[i]];
  return connOf(r) === 'line' ? 'none' : 'stand';
}
/* Stare zapisy mogły mieć 'lowstand' — to teraz zwykły statyw. */
const mountNorm = v => v === 'lowstand' ? 'stand' : v;
function mountOf(r) {
  if (r.kind === 'usb') return 'none';
  const keys = [r.id, r.id + '_l', r.pair].filter(Boolean);
  for (let i = 0; i < keys.length; i++) {
    const v = mountNorm(S.mounts[keys[i]]);
    if (v !== undefined && MOUNTS[v]) return v;
  }
  return mountDefault(r);
}
/* Statywy i klipsy do spakowania, z kolumny mocowań. */
function standsList(L) {
  const c = { stand: 0, clip: 0 };
  L.rows.forEach(r => {
    if (r.spacer || r.over || r.kind === 'usb') return;
    const m = MOUNTS[mountOf(r)];
    if (!m) return;
    if (m.stand) c.stand++;
    if (m.clip) c.clip++;
  });
  return c;
}

function packingList(L) {
  const cnt = {};
  L.rows.forEach(r => {
    if (r.spacer || r.over || r.kind === 'usb') return;
    const m = String(micOf(r)).trim();
    if (!m) return;
    cnt[m] = (cnt[m] || 0) + 1;
  });
  return Object.keys(cnt).map(model => ({ model, count: cnt[model] }))
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model, 'pl'));
}
/* Kanały bez modelu — to trzeba pożyczyć albo wziąć od realizatora. */
/* Tylko mikrofony (mic / mic48) mogą mieć brakujący model — DI i linia
   (bass DI, wyjście z modelera) kończą się samym kablem XLR, bez
   fizycznego mikrofonu do spakowania, więc pytanie „jaki model" jest
   tu bezprzedmiotowe. */
function micsMissing(L) {
  return L.rows.filter(r => !r.spacer && !r.over && r.kind !== 'usb' &&
    (connOf(r) === 'mic' || connOf(r) === 'mic48') && !String(micOf(r)).trim());
}

/* Wszystko, co fizycznie trzeba wpiąć na scenie: gniazda z listy
   kanałów, wyjścia XLR dla busów idących na Aux Out oraz porty
   ULTRANET dla P16-M. USB zostaje na liście, ale gniazda nie dostaje —
   komputer stoi przy konsolecie, nie na scenie. */
function stageNeeds(L, B) {
  const ins = L.rows.filter(r => !r.spacer && !r.over).map(r => ({
    key: 'in:' + r.id, id: r.id, n: r.n, name: r.name, group: r.group,
    conn: connOf(r), usb: r.kind === 'usb', pair: r.pair, mic: micOf(r) }));
  const outs = [], un = [];
  B.rows.forEach(r => {
    if (r.spacer || r.over) return;
    const o = r.bus.out, nm = r.bus.name || 'Bus';
    if (o === 'aux' || o === 'both')
      outs.push({ key: 'out:bus_' + r.idx, idx: r.idx, name: nm, stereo: r.bus.stereo, slots: r.slots, need: r.bus.stereo ? 2 : 1 });
    if (o === 'ultranet' || o === 'both')
      un.push({ key: 'un:bus_' + r.idx, idx: r.idx, name: nm, stereo: r.bus.stereo });
  });
  if (S.p16Monitor.on) un.push({ key: 'un:p16', idx: null, name: S.p16Monitor.name || 'P16', stereo: S.p16Monitor.stereo });
  return { ins, outs, un };
}

function autoPatch(N, nodes) {
  const patch = {};
  /* Wejścia XLR po kolei przez wszystkie węzły. */
  let i = 0, n = 1;
  const left = [];
  N.ins.forEach(r => {
    if (r.usb) return;
    while (i < nodes.length && n > jackCap(nodes[i], 'in')) { i++; n = 1; }
    if (i < nodes.length) patch[r.key] = { box: nodes[i].id, n: n++, k: 'in' };
    else left.push(r);
  });
  /* Co nie weszło, a jest liniowe, może jeszcze trafić na Aux In —
     ale tylko liniowe. Mikrofon bez preampu i bez phantomu to nie
     jest wejście, tylko rozczarowanie. */
  let ai = 0, an = 1;
  left.forEach(r => {
    if (r.conn !== 'line') return;
    while (ai < nodes.length && an > jackCap(nodes[ai], 'auxin')) { ai++; an = 1; }
    if (ai < nodes.length) patch[r.key] = { box: nodes[ai].id, n: an++, k: 'auxin' };
  });
  /* Wyjścia odsłuchowe: najpierw XLR-y na samych boksach, a dopiero
     potem przetworniki ADAT — te stoją w osobnej obudowie, więc każde
     użyte wyjście to jeszcze jedno pudełko do przywiezienia. */
  const outLeft = [];
  let oi = 0, on = 1;
  N.outs.forEach(r => {
    while (oi < nodes.length && on + r.need - 1 > jackCap(nodes[oi], 'out')) { oi++; on = 1; }
    if (oi < nodes.length) { patch[r.key] = { box: nodes[oi].id, n: on, k: 'out' }; on += r.need; }
    else outLeft.push(r);
  });
  let ei = 0, en = 1;
  outLeft.forEach(r => {
    while (ei < nodes.length && en + r.need - 1 > jackCap(nodes[ei], 'expout')) { ei++; en = 1; }
    if (ei < nodes.length) { patch[r.key] = { box: nodes[ei].id, n: en, k: 'expout' }; en += r.need; }
  });
  /* ULTRANET: pierwszy węzeł, który ten port ma. Konsoleta go nie ma. */
  const ub = nodes.find(x => x.ultranet > 0);
  if (ub) N.un.forEach(r => { patch[r.key] = { box: ub.id, k: 'un' }; });
  return patch;
}

/* Wpisy wskazujące na rzecz, której już nie ma na liście, na węzeł,
   którego już nie ma, albo na gniazdo ponad pojemność (po zmianie
   modelu albo odmiany konsolety) są usuwane — inaczej tabela
   trzymałaby gniazda-widma i zgłaszała konflikty z niczym. */
function sanitizeStage(N, nodes) {
  const P = S.stage.patch;
  const valid = new Set([].concat(N.ins, N.outs, N.un).map(r => r.key));
  Object.keys(P).forEach(k => {
    const p = P[k];
    if (!valid.has(k)) { delete P[k]; return; }
    if (p === null) return;                          // jawne „—": wybór człowieka
    if (typeof p !== 'object') { delete P[k]; return; }
    const node = nodeById(nodes, p.box);
    if (!node) { delete P[k]; return; }
    const kind = k.split(':')[0];
    if (kind === 'un') { if (node.ultranet === 0) delete P[k]; return; }
    const jk = kind === 'out'
      ? (p.k === 'expout' ? 'expout' : 'out')
      : (p.k === 'auxin' ? 'auxin' : 'in');
    p.k = jk;
    const need = kind === 'out' ? (N.outs.find(r => r.key === k) || { need: 1 }).need : 1;
    if (!p.n || p.n + need - 1 > jackCap(node, jk)) delete P[k];
  });
}

/* Najniższe wolne gniazdo danego rodzaju w węźle — dla ręcznego
   przepięcia całej rzeczy gdzie indziej bez wybierania numeru. */
function firstFree(G, nodeId, kind, need, selfKey) {
  const node = nodeById(G.nodes, nodeId);
  const cap = jackCap(node, kind);
  for (let n = 1; n + need - 1 <= cap; n++) {
    let ok = true;
    for (let k = 0; k < need; k++) {
      const o = G.occ[nodeId + ':' + kind + ':' + (n + k)] || [];
      if (o.some(x => x.key !== selfKey)) { ok = false; break; }
    }
    if (ok) return n;
  }
  return null;
}

/* Rzeczy, które pojawiły się na liście PO wyłączeniu automatu — nowy
   mikrofon, włączony odsłuch P16 — dostają gniazdo same. Ręczne wybory
   zostają nietknięte, bo dotykamy tylko kluczy, których w mapie nie ma
   wcale; jawne „—" (null) też jest wyborem i też zostaje. Bez tego
   kartka potrafiła wyjść z „P16: nie wpięte", choć port ULTRANET stał
   wolny — dokładnie tak wyszło na pierwszym prawdziwym wydruku. */
function fillGaps(N, L, B) {
  const P = S.stage.patch;
  let G = layoutStage(S, L, B), changed = false;
  const place = (key, kinds, need, allowAux) => {
    for (let i = 0; i < G.nodes.length; i++) {
      for (let j = 0; j < kinds.length; j++) {
        const jk = kinds[j];
        if (jk === 'auxin' && !allowAux) continue;
        const n = firstFree(G, G.nodes[i].id, jk, need, key);
        if (n !== null) {
          P[key] = { box: G.nodes[i].id, n, k: jk };
          changed = true;
          G = layoutStage(S, L, B);       // zajętość się zmieniła
          return;
        }
      }
    }
  };
  N.ins.forEach(r => { if (!r.usb && P[r.key] === undefined) place(r.key, ['in', 'auxin'], 1, r.conn === 'line'); });
  N.outs.forEach(r => { if (P[r.key] === undefined) place(r.key, ['out', 'expout'], r.need, false); });
  N.un.forEach(r => {
    if (P[r.key] !== undefined) return;
    const ub = G.nodes.find(x => x.ultranet > 0);
    if (ub) { P[r.key] = { box: ub.id, k: 'un' }; changed = true; }
  });
  return changed;
}

function layoutStage(state, L, B) {
  const active = stageActive(state);
  const N = stageNeeds(L, B);
  const nodes = stageNodes(state);
  const P = state.stage.patch;

  /* Zajętość: 'węzeł:rodzaj:numer' → lista rzeczy. Więcej niż jedna
     to konflikt — dwa kable do jednego XLR-a. Bus stereo bierze dwa
     kolejne wyjścia, stąd rozbicie na L i R. */
  const occ = {};
  const take = (id, kind, n, item) => { const k = id + ':' + kind + ':' + n; (occ[k] = occ[k] || []).push(item); };
  N.ins.forEach(r => {
    r.at = P[r.key] || null;
    if (r.at) take(r.at.box, r.at.k || 'in', r.at.n, r);
  });
  N.outs.forEach(r => {
    r.at = P[r.key] || null;
    if (!r.at) return;
    const ok = outKind(r.at);
    for (let k = 0; k < r.need; k++)
      take(r.at.box, ok, r.at.n + k, Object.assign({}, r, { side: r.need === 2 ? (k ? 'R' : 'L') : null }));
  });
  N.un.forEach(r => { r.at = P[r.key] || null; if (r.at) take(r.at.box, 'un', 0, r); });

  const conflicts = Object.keys(occ).filter(k => occ[k].length > 1 && k.split(':')[1] !== 'un');
  const conflictKeys = new Set();
  conflicts.forEach(k => occ[k].forEach(x => conflictKeys.add(x.key)));

  /* Mikrofon na wejściu liniowym: Aux In nie ma preampu ani phantomu,
     więc to nie jest „ciaśniej", tylko „nie zadziała". */
  const badAux = N.ins.filter(r => r.at && r.at.k === 'auxin' && r.conn !== 'line');

  return { active, nodes, boxes: nodes.filter(x => !x.local), N, occ, conflicts, conflictKeys, badAux };
}

/* Podpis gniazda na liście i na kartce: „A-03", „LCL-AUX 2",
   „A-OUT 01", „A ULTRANET". Wejście i wyjście o tym samym numerze
   muszą się różnić w zapisie, bo inaczej kabel trafia nie tam. */
function jackLabel(p, kind) {
  if (!p) return null;
  const id = p.box;
  if (kind === 'un') return id + ' ULTRANET';
  /* Wyjście na przetworniku to inne pudełko niż sam boks, więc i inny
     podpis — inaczej kabel trafia w tylną ściankę stageboxa. */
  if (kind === 'expout') return id + '-ADA ' + pad(p.n);
  if (kind === 'out') return id + '-OUT ' + pad(p.n);
  if ((p.k || kind) === 'auxin') return id + '-AUX ' + p.n;
  return id + '-' + pad(p.n);
}
/* Rodzaj gniazda dla wiersza wejściowego — 'in' albo 'auxin'. */
const inKind = p => (p && p.k === 'auxin') ? 'auxin' : 'in';
/* …i dla odsłuchowego — 'out' albo 'expout'. */
const outKind = p => (p && p.k === 'expout') ? 'expout' : 'out';

/* ------------------------------------------------------------
   6d. PLAN SCENY
   Schemat, nie rysunek: prostokąt sceny widziany Z GÓRY. Lewo i prawo
   są takie, jak widzi je widownia i realizator na FOH-u — NIE muzyk
   stojący twarzą do publiczności. Obie konwencje są w użyciu i mylą
   się nawzajem, więc plan mówi to wprost na samym rysunku.

   Pozycje to sloty siatki 3×3, nie piksele. Scena i tak dzieli się na
   tył/środek/przód i lewo/środek/prawo, a slot da się wybrać jednym
   kliknięciem i nie rozjeżdża się przy skalowaniu do A4.
   ------------------------------------------------------------ */
const STAGE_SLOTS = {
  bl: { label: 'tył lewo',      x: 0.22, y: 0.22 },
  bc: { label: 'tył środek',    x: 0.50, y: 0.22 },
  br: { label: 'tył prawo',     x: 0.78, y: 0.22 },
  ml: { label: 'środek lewo',   x: 0.22, y: 0.50 },
  mc: { label: 'środek',        x: 0.50, y: 0.50 },
  mr: { label: 'środek prawo',  x: 0.78, y: 0.50 },
  fl: { label: 'przód lewo',    x: 0.22, y: 0.78 },
  fc: { label: 'przód środek',  x: 0.50, y: 0.78 },
  fr: { label: 'przód prawo',   x: 0.78, y: 0.78 }
};
/* Stageboxy siedzą w rogach — tam, gdzie nikt nie chodzi. */
const BOX_SLOTS = { bl: 'tył lewo', br: 'tył prawo', fl: 'przód lewo', fr: 'przód prawo' };
/* Wsunięte na tyle, żeby CAŁY znacznik (132×46) zmieścił się w obrysie
   — stagebox stoi na scenie, nie za jej krawędzią. */
const BOX_XY = { bl: { x: 0.11, y: 0.08 }, br: { x: 0.89, y: 0.08 },
                 fl: { x: 0.11, y: 0.92 }, fr: { x: 0.89, y: 0.92 } };

/* Stanowiska: stałe, bo wynikają ze składu zespołu, nie z konfiguracji.
   mon/pwr to wzorce dopasowania do nazw busów i wierszy zasilania —
   nazwy są ręczne, więc dopasowanie jest heurystyką i tak je opisujemy. */
const STATIONS = [
  { id: 'drums',  label: 'Perkusja',          mon: /b[ęe]bn|perkus|drum/i, pwr: /perkus|b[ęe]bn|drum/i },
  { id: 'bass',   label: 'Bas',               mon: /^bas/i,                pwr: /^bas/i },
  { id: 'gtrRhy', label: 'Gitara rytmiczna',  mon: /rytmicz|rhy/i,         pwr: /rytmicz|rhy/i },
  { id: 'gtrLd',  label: 'Gitara prowadząca', mon: /prowadz|lead|solo/i,   pwr: /prowadz|lead|solo/i }
];
const VOX_STATION = { vox_drums: 'drums', vox_bass: 'bass', vox_rhy: 'gtrRhy', vox_lead: 'gtrLd' };

function stationOf(r) {
  if (r.group === 'perkusja') return 'drums';
  if (r.group === 'bas') return 'bass';
  if (r.group === 'gitary') return String(r.pair || r.id).indexOf('gtr_rhy') === 0 ? 'gtrRhy' : 'gtrLd';
  if (r.group === 'wokale') return VOX_STATION[r.id] || null;
  return null;
}

/* „01, 02, 03, 04, 16" czyta się gorzej niż „01-04, 16". */
function numRanges(ns) {
  const a = ns.slice().sort((x, y) => x - y), out = [];
  let i = 0;
  while (i < a.length) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(i === j ? pad(a[i]) : pad(a[i]) + '-' + pad(a[j]));
    i = j + 1;
  }
  return out.join(', ');
}

function plotData(L, B, G) {
  const PW = powerRows(G);
  /* Odsłuchy do rozdania: busy z listy plus deklaracja P16. */
  const mons = [];
  B.rows.forEach(r => { if (!r.spacer && !r.over) mons.push({ name: r.bus.name || '', slots: r.slots, p16: r.bus.out !== 'aux' }); });
  if (S.p16Monitor.on) mons.push({ name: S.p16Monitor.name || 'P16', slots: null, p16: true });
  const takenMon = {}, takenPwr = {};

  const stations = STATIONS.map(st => {
    const rows = L.rows.filter(r => !r.spacer && !r.over && r.kind !== 'usb' && stationOf(r) === st.id);
    const mon = mons.find((m, i) => !takenMon[i] && st.mon.test(m.name) && (takenMon[i] = true));
    const pw = PW.manual.find((r, i) => !takenPwr[i] && r.place === 'stage' && st.pwr.test(r.station || '') && (takenPwr[i] = true));
    let mics = 0, di = 0, stands = 0, clips = 0;
    const boxes = [];
    rows.forEach(r => {
      const c = connOf(r);
      if (c === 'line') di++; else mics++;
      const m = MOUNTS[mountOf(r)];
      if (m && m.stand) stands++;
      if (m && m.clip) clips++;
      const at = S.stage.patch['in:' + r.id];
      if (at && at.box && boxes.indexOf(at.box) === -1) boxes.push(at.box);
    });
    return { id: st.id, label: st.label, slot: (S.plot.stations || {})[st.id] || 'mc',
      chans: numRanges(rows.map(r => r.n)), count: rows.length,
      mics, di, stands, clips, boxes,
      mon: mon ? (mon.slots ? 'bus ' + mon.slots.map(pad).join('-') + (mon.p16 ? ' · P16' : '') : 'P16 / ULTRANET') : null,
      power: pw ? pw.n : 0 };
  }).filter(st => st.count || st.mon || st.power);

  const boxes = G.active ? G.boxes.map((b, i) => ({
    id: b.id, label: b.label, port: b.port, exp: b.exp,
    slot: (S.plot.boxes || [])[i] || (i === 0 ? 'fl' : 'br')
  })) : [];
  const vs = CONSOLE_VARIANTS[TARGETS[S.target].variants];
  return { stations, boxes, power: PW, cables: cableCounts(L, B, G), strips: L.strips, cap: L.cap,
    console: vs ? localSpec(S).label : L.cap.label };
}

/* Rysunek. Jedna funkcja na ekran i na kartkę — inaczej rozjadą się
   przy pierwszej zmianie. Kolor bierze się z currentColor, więc na
   ekranie jest zielony, a w druku czarny, bez osobnej wersji. */
function plotSvg(D) {
  const VW = 760, VH = 624;
  const SX = 20, SY = 34, SW = 720, SH = 430;           // prostokąt sceny
  const BW = 196, BH = 100;                              // karta stanowiska
  const KW = 132, KH = 46;                               // znacznik stageboxa
  const cx = f => SX + f * SW, cy = f => SY + f * SH;
  const txt = (x, y, str, cls) => '<text x="' + x + '" y="' + y + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(str) + '</text>';
  let g = '';

  /* scena + orientacja */
  g += '<rect class="stage" x="' + SX + '" y="' + SY + '" width="' + SW + '" height="' + SH + '" rx="6"/>';
  g += txt(VW / 2, 24, 'TYŁ SCENY', 'ax mid');
  g += txt(VW / 2, SY + SH + 20, 'PRZÓD SCENY — KRAWĘDŹ', 'ax mid');
  g += txt(SX + 6, SY + SH / 2, 'LEWO', 'ax');
  g += txt(SX + SW - 6, SY + SH / 2, 'PRAWO', 'ax end');

  const boxPos = {};
  D.boxes.forEach(b => {
    const p = BOX_XY[b.slot] || BOX_XY.fl;
    boxPos[b.id] = { x: cx(p.x), y: cy(p.y) };
  });

  /* połączenia stanowisko → stagebox, pod kartami */
  D.stations.forEach(st => {
    const sp = STAGE_SLOTS[st.slot] || STAGE_SLOTS.mc;
    st.boxes.forEach(id => {
      const bp = boxPos[id];
      if (!bp) return;
      g += '<line class="link" x1="' + cx(sp.x) + '" y1="' + cy(sp.y) + '" x2="' + bp.x + '" y2="' + bp.y + '"/>';
    });
  });

  /* karty stanowisk */
  D.stations.forEach(st => {
    const sp = STAGE_SLOTS[st.slot] || STAGE_SLOTS.mc;
    const x = cx(sp.x) - BW / 2, y = cy(sp.y) - BH / 2;
    const lines = [
      st.chans ? 'kan. ' + st.chans : 'bez kanałów',
      'odsłuch: ' + (st.mon || '—'),
      'mik. ' + st.mics + (st.di ? ' · DI ' + st.di : ''),
      [st.stands ? 'statywy ' + st.stands : '', st.clips ? 'klipsy ' + st.clips : ''].filter(Boolean).join(' · ') || 'bez statywów',
      [st.power ? '230 V: ' + st.power : '', st.boxes.length ? '→ boks ' + st.boxes.join(', ') : ''].filter(Boolean).join(' · ')
    ];
    g += '<g class="st"><rect x="' + x + '" y="' + y + '" width="' + BW + '" height="' + BH + '" rx="4"/>' +
      txt(x + BW / 2, y + 18, st.label.toUpperCase(), 'h mid') +
      lines.map((t, i) => t ? txt(x + 10, y + 34 + i * 13, t, 'd') : '').join('') + '</g>';
  });

  /* stageboxy w rogach */
  D.boxes.forEach(b => {
    const p = boxPos[b.id];
    const x = p.x - KW / 2, y = p.y - KH / 2;
    g += '<g class="kb"><rect x="' + x + '" y="' + y + '" width="' + KW + '" height="' + KH + '" rx="4"/>' +
      txt(x + KW / 2, y + 17, 'STAGEBOX ' + b.id, 'h mid') +
      txt(x + KW / 2, y + 30, b.label + (b.exp ? ' + ADA' : ''), 'd mid') +
      txt(x + KW / 2, y + 41, 'AES50 ' + (b.port || '?') + ' · 230 V: ' + (1 + (b.exp || 0)), 'd mid') + '</g>';
  });

  /* FOH pod sceną */
  const fx = VW / 2 - 150, fy = SY + SH + 40;
  const C = D.cables, foh = D.power.foh;
  g += '<g class="foh"><rect x="' + fx + '" y="' + fy + '" width="300" height="76" rx="4"/>' +
    txt(fx + 150, fy + 18, 'FOH — REALIZATOR', 'h mid') +
    txt(fx + 10, fy + 34, 'kanały: ' + D.strips + ' / ' + D.cap.channels + ' · ' + D.console, 'd') +
    txt(fx + 10, fy + 47, 'XLR ' + C.xlr + ' · skrętka ' + C.cat5 + (C.toslink ? ' · TOSLINK ' + C.toslink : ''), 'd') +
    txt(fx + 10, fy + 60, '230 V: ' + foh + ' (FOH) · ' + D.power.stage + ' (scena)', 'd') + '</g>';
  g += txt(VW / 2, fy + 93, 'PUBLICZNOŚĆ', 'ax mid');
  g += txt(VW / 2, VH - 6, 'widok z góry · lewo i prawo jak z widowni, nie od strony muzyka', 'note mid');

  return '<svg class="plot-svg" viewBox="0 0 ' + VW + ' ' + VH + '" role="img" ' +
    'aria-label="Schematyczny plan sceny">' + g + '</svg>';
}

/* ------------------------------------------------------------
   7. OSTRZEŻENIA
   ------------------------------------------------------------ */
function warnings(state, L, B, G) {
  const w = [];
  const usedCh = L.strips;

  if (!L.cap.linksAdjacent) {
    w.push({ lvl: 'info', html: '<b>' + esc(L.cap.label) + ':</b> kanały obsługują stereo bez sklejania ' +
      'sąsiednich pasków, a busy są stereo z natury. Para zajmuje jeden kanał, choć gniazda są dwa — ' +
      'stąd osobny licznik wejść. Wyrównywanie par jest tu bezprzedmiotowe i wyłączone.' });
  }

  if (usedCh > L.cap.channels) {
    const over = L.rows.filter(r => r.over).map(r => r.name);
    w.push({ lvl: 'err', html: '<b>Nie mieści się:</b> ' + (usedCh - L.cap.channels) +
      ' kanał(y) ponad pojemność ' + L.cap.label + ' (' + L.cap.channels + '). ' +
      'Poza listą zostaje: ' + over.map(esc).join(', ') + '.' });
  } else if (usedCh === L.cap.channels) {
    w.push({ lvl: 'info', html: 'Pulpit zajęty co do kanału — każdy kolejny mikrofon wymaga wyrzucenia czegoś innego.' });
  }

  const spacers = L.rows.filter(r => r.spacer);
  if (spacers.length) {
    w.push({ lvl: 'info', html: '<b>Pusty kanał ×' + spacers.length + '</b> (nr ' + spacers.map(r => r.n).join(', ') +
      ') wstawiony po to, żeby para stereo zaczęła się na nieparzystym. ' +
      'Bez tego XR18 jej nie zlinkuje. Wyłącz „wyrównuj pary”, jeśli wolisz odzyskać slot.' });
  }

  /* Para rozjechana mimo wszystko — zdarza się przy wyłączonym wyrównywaniu. */
  L.rows.forEach(r => {
    if (!L.cap.linksAdjacent || r.side !== 'L' || r.spacer) return;
    const next = L.rows.find(x => x.n === r.n + 1);
    const okPos = r.n % 2 === 1 && next && next.pair === r.pair;
    if (!okPos) {
      w.push({ lvl: 'err', html: '<b>' + esc(r.name.replace(/ L$/, '')) + '</b>: para stereo wypada na ' +
        r.n + '-' + (r.n + 1) + '. XR18 linkuje tylko 1-2, 3-4, 5-6 … — włącz „wyrównuj pary”.' });
    }
  });

  const auxUsed = L.auxRet.length;
  if (auxUsed > L.cap.auxReturn) {
    w.push({ lvl: 'err', html: '<b>Zwrot aux przepełniony:</b> ' + auxUsed + ' źródła na ' +
      L.cap.auxReturn + ' sloty (XR18 ma tylko U17/U18). Przenieś klik albo taśmę na zwykły kanał.' });
  }

  if (B.used > B.cap.buses) {
    w.push({ lvl: 'err', html: '<b>Za dużo busów:</b> potrzeba ' + B.used + ', jest ' + B.cap.buses + '.' });
  }

  /* Odczep spoza zmierzonej listy: nie blokujemy, bo pewnie działa,
     ale niech będzie widoczne, że to jedyne miejsce w całym narzędziu,
     które nie stoi na pomiarze. */
  const avail = p16Sources(L, B);
  const offGrp = {};
  S.p16.forEach((sl, i) => {
    const a = avail.find(x => x.id === sl.src);
    if (!a) return;
    const ok = TAP_MEASURED[a.grp];
    if (!ok || ok.indexOf(sl.tap) !== -1) return;
    const t = P16_TAPS.find(x => x.v === sl.tap);
    (offGrp[a.grp] = offGrp[a.grp] || []).push(
      'slot ' + pad(i + 1) + ' — ' + a.osc + ' jako ' + (t ? t.label : sl.tap));
  });
  Object.keys(offGrp).forEach(grp => {
    const seen = TAP_MEASURED[grp].map(v => {
      const t = P16_TAPS.find(x => x.v === v);
      return t ? t.label : v;
    }).join(', ');
    w.push({ lvl: 'info', html: '<b>Odczep poza pomiarem</b> (' + esc(grp.toLowerCase()) + '): ' +
      offGrp[grp].join('; ') + '. W eksporcie z X-AIR Edit takie źródło miało tylko: ' +
      esc(seen) + '. Prawdopodobnie zadziała — ale jeśli pulpit coś odrzuci, to właśnie tutaj.' });
  });

  if (state.src.click) {
    w.push({ lvl: 'info', html: 'Klik ma wyłączone przypisanie do Main LR (pole 3 w <code>/ch/NN/mix</code>) — ' +
      'inaczej poleci na front.' });
  }

  /* Bus wpięty w ULTRANET nie jest ustawieniem busa, tylko wyborem
     źródła w slocie P16 — jeśli slotu nie ma, deklaracja jest pusta. */
  if (state.target === 'xr18') {
    const wantP16 = B.rows.filter(r => !r.spacer && r.bus.out !== 'aux');
    const inP16 = new Set(S.p16.map(sl => sl.src).filter(s => s && s.indexOf('bus_') === 0));
    const missing = wantP16.filter(r => !r.slots.some(sl => inP16.has('bus_' + sl)));
    if (missing.length) {
      w.push({ lvl: 'err', html: '<b>' + missing.map(r => esc(r.bus.name)).join(', ') +
        '</b>: bus ma iść na ULTRANET, ale nie siedzi w żadnym slocie P16. ' +
        'Na XR18 bus nie „wychodzi" ULTRANET-em sam z siebie — trzeba go wybrać jako źródło slotu.' });
    }
  }

  if (!L.cap.verified) {
    w.push({ lvl: 'info', html: 'Pojemności dla <b>' + L.cap.label + '</b> są wpisane z pamięci, nie zmierzone. ' +
      'Popraw liczby w polach obok, jeśli znasz je z instrukcji konsolety.' });
  }

  /* --- scena: stageboxy, pult i patch --- */
  if (G.active) {
    const anal = G.N.ins.filter(r => !r.usb);
    const sum = (arr, kind) => arr.reduce((a, x) => a + jackCap(x, kind), 0);
    const boxIns  = sum(G.boxes, 'in'),  boxOuts  = sum(G.boxes, 'out');
    const allIns  = sum(G.nodes, 'in');
    const allOuts = sum(G.nodes, 'out') + sum(G.nodes, 'expout');
    const allAux  = sum(G.nodes, 'auxin');
    const allExp  = sum(G.nodes, 'expout');
    const local   = G.nodes.find(x => x.local);

    /* Rachunek gniazd jest teraz sumą sceny i stołu — to jest sedno
       pytania „czy się zmieści": dwa najmniejsze boksy to 16 wejść,
       ale pełny WING dokłada 8 preampów i 8 linii. */
    w.push({ lvl: 'info', html: '<b>Gniazda razem:</b> ' + allIns + ' XLR' +
      (allAux ? ' + ' + allAux + ' liniowych Aux In' : '') + ' na ' + anal.length + ' potrzebnych, ' +
      'wyjść ' + allOuts + (allExp ? ' (w tym ' + allExp + ' przez ADAT)' : '') +
      ' na ' + G.N.outs.reduce((a, r) => a + r.need, 0) + '. ' +
      (local
        ? 'Stageboxy dają ' + boxIns + ' XLR, konsoleta (' + esc(local.label) + ') dokłada ' +
          jackCap(local, 'in') + (jackCap(local, 'auxin') ? ' XLR i ' + jackCap(local, 'auxin') + ' Aux In' : ' XLR') + '.'
        : 'Gniazda na konsolecie są wyłączone — liczą się same stageboxy.') });

    const noIn = anal.filter(r => !r.at);
    if (noIn.length) {
      w.push({ lvl: 'err', html: '<b>Bez gniazda:</b> ' + noIn.map(r => esc(r.name)).join(', ') +
        '. Wejść potrzeba ' + anal.length + ', wolnych XLR jest ' + allIns + '.' +
        (local ? '' : ' Włącz gniazda na konsolecie albo weź większy stagebox.') });
    }
    const noOut = G.N.outs.filter(r => !r.at);
    if (noOut.length) {
      w.push({ lvl: 'err', html: '<b>Odsłuch bez wyjścia XLR:</b> ' + noOut.map(r => esc(r.name)).join(', ') +
        '. Wyjść potrzeba ' + G.N.outs.reduce((a, r) => a + r.need, 0) + ', jest ' + allOuts + '.' });
    }
    const noUn = G.N.un.filter(r => !r.at);
    if (noUn.length) {
      w.push({ lvl: 'err', html: '<b>P16 bez stageboxa:</b> ' + noUn.map(r => esc(r.name)).join(', ') +
        ' — wskaż, z którego portu ULTRANET ma iść. Konsoleta tego portu nie ma.' });
    }
    if (G.conflicts.length) {
      const kindTxt = { in: 'we', auxin: 'aux in', out: 'wy' };
      w.push({ lvl: 'err', html: '<b>Dwa kable w jednym gnieździe:</b> ' + G.conflicts.map(k => {
        const p = k.split(':');
        return esc(jackLabel({ box: p[0], n: +p[2], k: p[1] }, p[1])) + ' (' + kindTxt[p[1]] + '): ' +
          G.occ[k].map(x => esc(x.name + (x.side ? ' ' + x.side : ''))).join(' i ');
      }).join('; ') + '.' });
    }
    if (G.badAux.length) {
      w.push({ lvl: 'err', html: '<b>Mikrofon na wejściu liniowym:</b> ' + G.badAux.map(r => esc(r.name)).join(', ') +
        ' siedzi na Aux In. To wejście TRS bez preampu i bez phantomu — mikrofon się w nim nie odezwie. ' +
        'Przenieś na gniazdo XLR albo wstaw preamp.' });
    }

    /* Wpięcie do stołu to analogowy kabel ze sceny do FOH-u — cała
       reszta tej układanki istnieje po to, żeby ich NIE ciągnąć. */
    if (local) {
      const onDesk = anal.filter(r => r.at && r.at.box === LOCAL_ID);
      if (onDesk.length) {
        w.push({ lvl: 'info', html: '<b>Na gniazdach konsolety: ' + onDesk.length + '</b> (' +
          onDesk.map(r => esc(r.name)).join(', ') + '). Jeśli konsoleta stoi przy scenie, w porządku. ' +
          'Przy realizacji z FOH-u to tyle samo analogowych kabli przez całą salę — a stagebox jest właśnie po to, ' +
          'żeby ich nie było. Wtedy lepiej dobrać większy boks.' });
      }
      if (!local.verified) {
        w.push({ lvl: 'info', html: '<b>Gniazda konsolety:</b> liczby wpisane ręcznie, nie z instrukcji.' });
      }
    }

    G.boxes.forEach(b => {
      const users = (G.occ[b.id + ':un:0'] || []).length;
      if (users > b.ultranet) {
        w.push({ lvl: 'info', html: '<b>Stagebox ' + b.id + ':</b> ' + users + ' odbiorników P16 na ' +
          b.ultranet + ' port' + (b.ultranet === 1 ? '' : 'y') + ' ULTRANET — potrzebny dystrybutor P16-D ' +
          'albo łańcuch przez wyjście THRU kolejnych odbiorników.' });
      }
      if (users && b.powersP16 === null) {
        w.push({ lvl: 'info', html: '<b>Stagebox ' + b.id + ' (' + esc(b.label) + '):</b> ' +
          'P16-HQ i P16-M <b>umieją</b> wziąć zasilanie ze skrętki ULTRANET — pytanie jest o drugą stronę kabla. ' +
          'Karta tego boksu nie mówi, czy jego port to zasilanie <b>podaje</b>. Weź zasilacz, dopóki tego nie sprawdzisz na sucho.' });
      }
      if (!b.verified) {
        w.push({ lvl: 'info', html: '<b>Stagebox ' + b.id + ':</b> pojemności wpisane ręcznie, nie z karty produktu.' });
      }
      const expUsed = [];
      for (let n = 1; n <= jackCap(b, 'expout'); n++) if ((G.occ[b.id + ':expout:' + n] || []).length) expUsed.push(n);
      if (b.exp) {
        w.push({ lvl: 'info', html: '<b>Stagebox ' + b.id + ' + ' + b.exp + '× ' + esc(EXP_LABEL) + ':</b> ' +
          (b.exp * EXP_OUTS) + ' dodatkowych wyjść XLR, zajęte ' + expUsed.length + '. ' +
          'To osobna obudowa spięta z boksem <b>optycznym TOSLINK-iem</b>, a ten jest krótki i łamliwy — ' +
          'przetwornik musi stać tuż przy boksie, w tym samym racku. ' +
          'Gniazda ADAT w tych boksach są <b>wyjściami</b>, więc tą drogą przybywa wyjść, a wejść nie: ' +
          'karta DL16 wymienia wyłącznie „dual ADAT outputs", wejścia ADAT nie ma. ' +
          '<span class="unverified" title="z opisu sprzedawcy, nie z instrukcji Midasa — sprawdzić przed koncertem">Do sprawdzenia:</span> ' +
          'na DL16 wyjście ADAT niesie podobno <b>sztywny blok kanałów AES50 17–32</b>, gdy splitter jest wyłączony. ' +
          'Jeśli tak, to te odsłuchy trzeba wysłać na te właśnie numery kanałów, a nie na dowolne — inaczej z przetwornika nie wyjdzie nic.' });
      }
      if (b.port && AES50_PORTS.indexOf(b.port) >= TARGETS[state.target].aes50) {
        w.push({ lvl: 'err', html: '<b>Stagebox ' + b.id + ':</b> ' + esc(L.cap.label) + ' ma ' +
          TARGETS[state.target].aes50 + ' gniazd(a) AES50 — gniazdo ' + esc(b.port) + ' nie istnieje.' });
      }
    });

    /* Dwa boksy na jednym gnieździe AES50 to łańcuch: Wing → A → B.
       Mieści się, jeśli suma kanałów w każdą stronę nie przekracza 48. */
    if (G.boxes.length === 2 && G.boxes[0].port === G.boxes[1].port) {
      const over = boxIns > AES50_CH || boxOuts > AES50_CH;
      w.push({ lvl: over ? 'err' : 'info', html: '<b>Łańcuch AES50 ' + esc(G.boxes[0].port) + ':</b> Wing → A → B jednym kablem. ' +
        'Razem ' + boxIns + ' wejść i ' + boxOuts + ' wyjść na ' + AES50_CH + ' kanałów w każdą stronę' +
        (over ? ' — <b>nie mieści się</b>, rozdziel boksy na dwa gniazda.'
              : '. Boks A musi mieć dwa gniazda AES50 — każdy model z katalogu ma. ' +
                'W łańcuchu drugi boks musi mieć ustawione przesunięcie kanałów, żeby nie nadawał po tych samych co pierwszy.') });
    }

    w.push({ lvl: 'info', html: '<b>Lokalne i AES50 działają naraz</b> — instrukcja WING, sekcja 5.4 ROUTING: ' +
      'każdy z 40 kanałów wybiera źródło osobno z grup Local In, Aux In, AES50 A/B/C, USB … ' +
      'Nie ma trybu „albo stół, albo stagebox", więc kanał 1 może siedzieć na preampie w stole, a kanał 2 na boksie.' });

    w.push({ lvl: 'info', html: '<span class="unverified" title="nie potwierdzone instrukcją Winga 3.1">Do potwierdzenia:</span> ' +
      'którymi kanałami AES50 Wing karmi port ULTRANET stageboxa (na X32 to zwyczajowo kanały wyjściowe 33–48 strumienia ' +
      'do boksu). Instrukcja Winga potwierdza tylko zgodność z serią S i DL; słów „ULTRANET" i „P16" w niej nie ma.' });
  }

  return w;
}

/* ------------------------------------------------------------
   8. RENDER
   ------------------------------------------------------------ */
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Każda zmiana przebudowuje tabele i sloty od zera, więc pole, w którym
   ktoś właśnie pisze, znika razem ze swoim ogniskiem. Zapamiętujemy je
   po atrybucie data-*, bo elementy nie mają stałych id. */
function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.dataset) return null;
  const keys = ['busName', 'auxName', 'link', 'p16', 'busStereo', 'busOut', 'auxStereo',
                'sbBox', 'sbN', 'conn', 'sbModel', 'sbPort', 'sbPos', 'sbIns', 'sbOuts', 'sbExp', 'mic', 'mount',
                'pwN', 'pwStation', 'pwItems', 'pwPlace', 'plotSt', 'plotBox'];
  /* Pola lokalnego I/O mają id, nie data-*, więc łapiemy je osobno. */
  if (el.id === 'loc-ins' || el.id === 'loc-outs') return { sel: '#' + el.id, pos: null };
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (el.dataset[k] === undefined) continue;
    const attr = 'data-' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    let pos = null;
    try { pos = el.selectionStart; } catch (e) { /* number/date potrafią rzucić */ }
    return { sel: '[' + attr + '="' + el.dataset[k] + '"]', pos };
  }
  return null;
}
function restoreFocus(f) {
  if (!f) return;
  const el = document.querySelector(f.sel);
  if (!el) return;
  el.focus();
  if (f.pos != null && el.setSelectionRange) {
    try { el.setSelectionRange(f.pos, f.pos); } catch (e) { /* nie każdy typ pozwala */ }
  }
}

function render() {
  const focus = captureFocus();
  const L = layout(S);
  const B = layoutBuses(S);

  if (S.p16Auto) S.p16 = autoFillP16(L, B);

  /* Scena liczy się po kanałach i busach, bo z nich bierze listę
     rzeczy do wpięcia. Porządki przed automatem: automat i tak
     przepisze mapę, ale przy ręcznym patchu widma trzeba usunąć. */
  const N = stageNeeds(L, B);
  const nodes = stageNodes(S);
  sanitizeStage(N, nodes);
  if (S.stage.auto) S.stage.patch = autoPatch(N, nodes);
  else fillGaps(N, L, B);
  const G = layoutStage(S, L, B);

  renderMeters(L, B);
  renderChannels(L, G);
  renderAuxReturn(L);
  renderBuses(B);
  renderP16(L, B);
  renderStage(G);
  renderCables(L, B, G);
  renderPlot(L, B, G);
  renderWarnings(warnings(S, L, B, G));
  renderPrintSheet(L, B, G);
  renderExport(L, B, G);
  syncControls();
  restoreFocus(focus);
  persist();
}

function renderMeters(L, B) {
  const used = L.strips, cap = L.cap.channels;
  const m = $('#meter-ch');
  m.className = 'meter' + (used > cap ? ' over' : used === cap ? ' full' : '');
  m.querySelector('.meter-val').textContent = used + ' / ' + cap;

  /* Gdy para stereo siedzi na jednym pasku, liczba gniazd i liczba kanałów
     się rozjeżdża — realizator wozi tyle kabli, ile gniazd. */
  const jacks = L.rows.filter(r => !r.spacer).length;
  $('#meter-jacks').hidden = jacks === used;
  $('#meter-jacks').querySelector('.meter-val').textContent = jacks;

  const boxes = [];
  const total = Math.max(cap, used);
  const strip = L.cap.linksAdjacent ? L.rows : L.rows.filter(r => r.side !== 'R');
  for (let i = 1; i <= total; i++) {
    const r = L.cap.linksAdjacent ? L.rows.find(x => x.n === i) : strip[i - 1];
    let cls = 'slot-box';
    if (i > cap) cls += ' over';
    else if (r && r.spacer) cls += ' spacer';
    else if (r) cls += ' used';
    boxes.push('<span class="' + cls + '" title="' + (r ? esc(r.name) : 'wolne') + '"></span>');
  }
  $('#slots-ch').innerHTML = boxes.join('');

  const am = $('#meter-aux');
  am.className = 'meter' + (L.auxRet.length > L.cap.auxReturn ? ' over' : '');
  am.querySelector('.meter-val').textContent = L.auxRet.length + ' / ' + L.cap.auxReturn;

  const bm = $('#meter-bus');
  bm.className = 'meter' + (B.used > B.cap.buses ? ' over' : '');
  bm.querySelector('.meter-val').textContent = B.used + ' / ' + B.cap.buses;

}

function renderChannels(L, G) {
  const body = $('#chlist-body');
  body.innerHTML = L.rows.map(r => {
    if (r.spacer) {
      return '<tr class="spacer"><td class="ch-num">' + pad(r.n) + '</td>' +
        '<td class="ch-name">— wolne —</td><td class="ch-mic"></td><td class="ch-mount"></td><td class="ch-grp"></td><td class="ch-src"></td>' +
        '<td class="ch-link"></td><td class="ch-grp">wyrównanie pary</td></tr>';
    }
    const linked = L.links[r.n % 2 === 1 ? r.n : r.n - 1];
    const cls = [r.over ? 'over' : '', linked ? 'linked' : ''].filter(Boolean).join(' ');
    let link = '';
    const next = L.rows.find(x => x.n === r.n + 1);
    if (L.cap.linksAdjacent && r.n % 2 === 1 && next && r.n < L.cap.channels) {
      link = '<label><input type="checkbox" data-link="' + r.n + '"' + (L.links[r.n] ? ' checked' : '') + '> ' +
             '<span class="bracket">' + (L.links[r.n] ? '⌐' : '·') + '</span> ' + pad(r.n) + '-' + pad(r.n + 1) + '</label>';
    }
    /* Kanał ponad pojemność nie ma gniazda — pulpit nie ma In17.
       Pokazanie numeru sugerowałoby, że gdzieś się wepnie.
       Ze stageboxami gniazdem jest XLR na boksie („A-03"), nie na
       konsolecie — wtedy „In03" byłoby kłamstwem. */
    let srcTxt;
    if (r.over) srcTxt = '—';
    else if (r.kind === 'usb') srcTxt = icon('usb', true) + ' U' + pad(r.n);
    else if (G.active) {
      const p = S.stage.patch['in:' + r.id];
      srcTxt = p ? icon(p.box === LOCAL_ID ? 'desk' : 'box') + ' ' + esc(jackLabel(p, inKind(p)))
                 : '<span class="unverified" title="brak gniazda w patchu sceny">nie wpięte</span>';
    } else srcTxt = 'In' + pad(r.n);
    const ck = connOf(r);
    const note = [];
    if (!L.cap.linksAdjacent && r.side === 'L') note.push('stereo z ' + pad(r.n + 1));
    if (r.noMain) note.push('poza Main LR');
    if (r.over) note.push('POZA POJEMNOŚCIĄ');
    /* Pole modelu: tekst wolny, bo mikrofon pożyczony może się nazywać
       jak chce. USB nie ma mikrofonu, więc nie ma pola. */
    const micCell = r.kind === 'usb' ? '<span class="ch-grp">—</span>'
      : '<input type="text" data-mic="' + esc(r.id) + '" value="' + esc(micOf(r)) + '" placeholder="' +
        (ck === 'line' ? 'DI / linia' : 'model mikrofonu') + '">';
    return '<tr class="' + cls + '">' +
      '<td class="ch-num">' + pad(r.n) + '</td>' +
      '<td class="ch-name">' + icon(ck, true) + ' ' + esc(r.name) + '</td>' +
      '<td class="ch-mic">' + micCell + '</td>' +
      '<td class="ch-mount">' + (r.kind === 'usb' ? '<span class="ch-grp">—</span>' :
        '<select data-mount="' + esc(r.id) + '">' + Object.keys(MOUNTS).map(k =>
          '<option value="' + k + '"' + (k === mountOf(r) ? ' selected' : '') + '>' + esc(MOUNTS[k].label) + '</option>').join('') + '</select>') + '</td>' +
      '<td class="ch-grp">' + esc(r.group) + '</td>' +
      '<td class="ch-src ' + (r.kind === 'usb' ? 'usb' : '') + '">' + srcTxt + '</td>' +
      '<td class="ch-link">' + link + '</td>' +
      '<td class="ch-grp">' + note.join(' · ') + '</td></tr>';
  }).join('');
  renderPacking(L);
}

function standsChips(st) {
  const parts = [];
  if (st.stand) parts.push('<span class="chip stands"><b>' + st.stand + '×</b> statyw</span>');
  if (st.clip)  parts.push('<span class="chip stands"><b>' + st.clip + '×</b> klips</span>');
  return parts.join('');
}
function renderPacking(L) {
  const list = packingList(L), missing = micsMissing(L), st = standsList(L);
  const el = $('#packing');
  if (!list.length && !missing.length && !(st.stand || st.clip)) { el.innerHTML = ''; return; }
  el.innerHTML =
    (list.length ? '<div class="chip-row">' + list.map(x =>
      '<span class="chip"><b>' + x.count + '×</b> ' + esc(x.model) + '</span>').join('') + '</div>' : '') +
    ((st.stand || st.clip) ? '<div class="chip-row" style="margin-top:.4rem">' + standsChips(st) + '</div>' : '') +
    (missing.length ? '<p class="ch-grp" style="text-transform:none;margin:.4rem 0 0"><b>Bez modelu (pożyczyć albo od realizatora):</b> ' +
      missing.map(r => esc(r.name)).join(', ') + '.</p>' : '');
}

function renderAuxReturn(L) {
  const wrap = $('#auxret');
  if (!L.auxRet.length) { wrap.innerHTML = '<p class="info-text" style="color:var(--dim)">Zwrot aux pusty.</p>'; return; }
  wrap.innerHTML = '<div class="chip-row">' + L.auxRet.map((r, i) =>
    '<span class="chip' + (i >= L.cap.auxReturn ? ' out' : '') + '">U' + (17 + i) + ' &nbsp; ' + esc(r.name) + '</span>'
  ).join('') + '</div>';
}

function renderBuses(B) {
  const OUTS = { aux: 'Aux Out (gniazdo)', ultranet: 'slot P16 / ULTRANET', both: 'gniazdo + slot P16' };
  $('#bus-body').innerHTML = B.rows.map(r => {
    if (r.spacer) return '<div class="bus-row"><span class="bus-slots">' + r.n + '</span>' +
      '<span style="color:var(--dim);font-style:italic">— wolny bus (wyrównanie pary) —</span><span></span><span></span><span></span></div>';
    const b = r.bus;
    return '<div class="bus-row' + (r.over ? ' over' : '') + '">' +
      '<span class="bus-slots">' + r.slots.map(pad).join('-') + '</span>' +
      '<input type="text" data-bus-name="' + r.idx + '" value="' + esc(b.name) + '" placeholder="instrument albo rola">' +
      '<select data-bus-stereo="' + r.idx + '">' +
        '<option value="mono"' + (b.stereo ? '' : ' selected') + '>mono</option>' +
        '<option value="stereo"' + (b.stereo ? ' selected' : '') + '>stereo</option></select>' +
      '<select data-bus-out="' + r.idx + '">' +
        Object.keys(OUTS).map(k => '<option value="' + k + '"' + (b.out === k ? ' selected' : '') + '>' + OUTS[k] + '</option>').join('') +
      '</select>' +
      '<button type="button" class="btn danger" data-bus-del="' + r.idx + '" title="usuń bus">×</button>' +
      '</div>';
  }).join('');
}

function renderP16(L, B) {
  const avail = p16Sources(L, B);

  /* Grupowanie w optgroup: przy pełnym słowniku lista ma ponad 40
     pozycji i bez podziału nie da się w niej niczego znaleźć. */
  const opts = used => {
    let html = '<option value="">— puste —</option>';
    let grp = null;
    avail.forEach(a => {
      if (a.grp !== grp) {
        if (grp !== null) html += '</optgroup>';
        html += '<optgroup label="' + esc(a.grp) + '">';
        grp = a.grp;
      }
      html += '<option value="' + a.id + '"' + (a.id === used ? ' selected' : '') + '>' + esc(a.label) + '</option>';
    });
    return html + (grp !== null ? '</optgroup>' : '');
  };
  const tapOpts = tap => P16_TAPS.map(t =>
    '<option value="' + t.v + '"' + (t.v === tap ? ' selected' : '') + '>' + t.label + '</option>').join('');

  $('#p16-grid').innerHTML = S.p16.map((sl, i) => {
    const ok = avail.some(a => a.id === sl.src);
    return '<div class="p16-slot' + (ok ? '' : ' empty') + '">' +
      '<span class="p16-num">' + pad(i + 1) + '</span>' +
      '<select data-p16="' + i + '">' + opts(ok ? sl.src : '') + '</select>' +
      '<select data-p16tap="' + i + '"' + (ok ? '' : ' disabled') + '>' + tapOpts(sl.tap) + '</select>' +
      '</div>';
  }).join('');

  $('#p16-tap-all').innerHTML = P16_TAPS.map(t =>
    '<option value="' + t.v + '"' + (t.v === S.p16Tap ? ' selected' : '') + '>' + t.label + '</option>').join('');

  const assigned = new Set(S.p16.map(sl => sl.src).filter(Boolean));
  /* Liczymy tylko to, co wypadło Z LISTY WEJŚCIOWEJ. Busy, Main, FX
     i wysyłki są zawsze dostępne i prawie zawsze niewpięte — gdyby
     trafiały tutaj, panel pokazywałby 24 pozycje przy każdym ustawieniu
     i przestałby odpowiadać na pytanie „co wypada". */
  const dropped = avail.filter(a => a.auto && !assigned.has(a.id));
  $('#p16-dropped').innerHTML = dropped.length
    ? '<div class="chip-row">' + dropped.map(a => '<span class="chip out">' + esc(a.label) + '</span>').join('') + '</div>'
    : '<div class="chip-row"><span class="chip">cała lista wejściowa mieści się w odsłuchu</span></div>';
  $('#p16-dropped-count').textContent = dropped.length;

  const spare = 16 - S.p16.filter(sl => avail.some(a => a.id === sl.src)).length;
  $('#p16-spare').textContent = spare
    ? 'Wolnych slotów: ' + spare + '. Można w nie wstawić bus, Main, Aux In, wysyłkę albo powrót FX.'
    : '';

  /* Liczymy tylko sloty wskazujące na istniejące źródło. Po zmianie listy
     kanałów w stanie mogą zostać nieaktualne id — w UI slot jest wtedy
     pusty i licznik musi mówić to samo, co widać. */
  const live = S.p16.filter(sl => avail.some(a => a.id === sl.src)).length;
  $('#meter-p16').querySelector('.meter-val').textContent = live + ' / 16';
}

function renderWarnings(w) {
  $('#warnings').innerHTML = w.map(x => '<li class="' + x.lvl + '">' + x.html + '</li>').join('');
}

/* ------------------------------------------------------------
   8a. SCENA
   Dwa widoki tych samych danych: tabela „co w które gniazdo" (od
   strony listy wejściowej — tu się klika) i karty boksów (od strony
   sceny — to idzie na plan). Konflikt widać w obu.
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   6c. KABLE I ZASILANIE
   XLR: jeden na każde wejście analogowe (DI też kończy się XLR-em)
   i jeden na każde wyjście odsłuchowe (stereo = dwa). Skrętka: jedna
   na każdy stagebox (od konsolety albo od poprzedniego boksu w
   łańcuchu) i jedna na każdy odbiornik P16. TOSLINK: jeden na
   przetwornik. Zasilanie: stageboxy i przetworniki z patcha, reszta
   ze stanowisk wpisanych ręcznie.
   ------------------------------------------------------------ */
function cableCounts(L, B, G) {
  const N = G.N;
  const xlrIn  = N.ins.filter(r => !r.usb).length;
  const xlrOut = N.outs.reduce((a, r) => a + r.need, 0);
  const aes50 = [];
  G.boxes.forEach((b, i) => {
    const prev = G.boxes.slice(0, i).filter(x => x.port === b.port).pop();
    aes50.push({ from: prev ? 'boks ' + prev.id : 'konsoleta AES50 ' + (b.port || '?'), to: 'boks ' + b.id });
  });
  const ultranet = N.un.map(r => ({ from: r.at ? 'boks ' + r.at.box : '—', to: r.name }));
  const toslink = G.boxes.reduce((a, b) => a + (b.exp || 0), 0);
  /* Rozbicie XLR po węzłach — do spakowania osobno pod każdy boks. */
  const perNode = G.nodes.map(n => {
    const cnt = k => { let c = 0; for (let j = 1; j <= jackCap(n, k); j++) if ((G.occ[n.id + ':' + k + ':' + j] || []).length) c++; return c; };
    return { id: n.id, local: n.local, label: n.label, ins: cnt('in') + cnt('auxin'), outs: cnt('out') + cnt('expout') };
  }).filter(x => x.ins || x.outs);
  return { xlrIn, xlrOut, xlr: xlrIn + xlrOut, aes50, ultranet, cat5: aes50.length + ultranet.length, toslink, perNode };
}

/* Miejsce (spot) = fizyczne skupisko gniazd, do którego idzie jedna
   listwa: boks razem ze swoim przetwornikiem to jedno miejsce, każde
   stanowisko muzyka osobne, FOH jedno na wszystko. Z liczby miejsc
   wynika liczba listw i przedłużaczy — lepiej mieć o jeden za dużo. */
function powerRows(G) {
  const derived = [];
  G.boxes.forEach(b => {
    derived.push({ station: 'Stagebox ' + b.id + ' (' + b.label + ')', items: 'zasilanie boksu', n: 1, place: 'stage', spot: 'box:' + b.id, derived: true });
    if (b.exp) derived.push({ station: 'Przetwornik przy ' + b.id, items: b.exp + '× ' + EXP_LABEL + ' — ten sam rack co boks', n: b.exp, place: 'stage', spot: 'box:' + b.id, derived: true });
  });
  derived.push({ station: 'Konsoleta (' + capacity(S).label + (CONSOLE_VARIANTS[TARGETS[S.target].variants] ? ', ' + localSpec(S).label : '') + ')',
    items: 'na FOH-u', n: 1, place: 'foh', spot: 'foh', derived: true });
  const manual = (S.power || []).filter(r => r && typeof r === 'object').map((r, i) => {
    const place = r.place === 'foh' ? 'foh' : 'stage';
    return Object.assign({ idx: i, derived: false }, r, { n: parseInt(r.n, 10) || 0, place, spot: place === 'foh' ? 'foh' : 'row:' + i });
  });
  const all = derived.concat(manual);
  const sum = place => all.filter(r => r.place === place).reduce((a, r) => a + r.n, 0);
  const stage = sum('stage'), foh = sum('foh');
  /* Miejsca i ich obłożenie — najgęstsze decyduje, jak długa listwa. */
  const spots = {};
  all.forEach(r => { if (!r.n) return; const k = r.spot; spots[k] = spots[k] || { n: 0, names: [], place: r.place }; spots[k].n += r.n; spots[k].names.push(r.station); });
  const spotList = Object.keys(spots).map(k => spots[k]);
  const stageSpots = spotList.filter(x => x.place === 'stage').length;
  const fohSpots = spotList.filter(x => x.place === 'foh').length;
  const busiest = spotList.reduce((m, x) => (!m || x.n > m.n) ? x : m, null);
  return { derived, manual, stage, foh, total: stage + foh,
    stageSpots, fohSpots, strips: stageSpots + fohSpots + 1, cords: stageSpots + fohSpots + 1, busiest };
}

function renderPlot(L, B, G) {
  const D = plotData(L, B, G);
  $('#plot').innerHTML = plotSvg(D);
  const slotSel = (attr, val, slots) => '<select data-' + attr + '>' + Object.keys(slots).map(k =>
    '<option value="' + k + '"' + (k === val ? ' selected' : '') + '>' +
    esc(slots[k].label || slots[k]) + '</option>').join('') + '</select>';
  $('#plot-ctl').innerHTML =
    D.stations.map(st => '<div class="bus-row pl"><span>' + esc(st.label) + '</span>' +
      slotSel('plot-st="' + st.id + '"', st.slot, STAGE_SLOTS) +
      '<span class="ch-grp">' + (st.chans ? 'kan. ' + esc(st.chans) : '—') +
      (st.boxes.length ? ' · boks ' + esc(st.boxes.join(', ')) : '') + '</span></div>').join('') +
    D.boxes.map((b, i) => '<div class="bus-row pl"><span>' + icon('box') + ' Stagebox ' + b.id + '</span>' +
      slotSel('plot-box="' + i + '"', b.slot, BOX_SLOTS) +
      '<span class="ch-grp">' + esc(b.label) + '</span></div>').join('');

  /* Plan rysuje to, co mówi patch — a patch bywa starszy niż decyzja,
     gdzie kto stoi. Jeśli stanowisko ma kable do boksu po drugiej
     stronie sceny, lepiej się o tym dowiedzieć teraz niż przy rozkładaniu. */
  const notes = [];
  D.stations.forEach(st => {
    if (st.boxes.length > 1) notes.push({ lvl: 'info', html: '<b>' + esc(st.label) + ':</b> kable idą do dwóch boksów (' +
      esc(st.boxes.join(', ')) + ') — do rozdzielenia, jeśli to nie było celowe.' });
    const sp = STAGE_SLOTS[st.slot] || STAGE_SLOTS.mc;
    st.boxes.forEach(id => {
      const b = D.boxes.find(x => x.id === id);
      if (!b) return;
      const bp = BOX_XY[b.slot] || BOX_XY.fl;
      const dist = Math.sqrt(Math.pow(sp.x - bp.x, 2) + Math.pow(sp.y - bp.y, 2));
      if (dist > 0.62) notes.push({ lvl: 'info', html: '<b>' + esc(st.label) + '</b> stoi ' +
        esc(sp.label) + ', a jej kanały idą do boksu <b>' + esc(id) + '</b> (' + esc(BOX_SLOTS[b.slot] || '?') +
        ') — to ' + st.count + ' kabli przez całą scenę. Przepnij w patchu albo przestaw boks.' });
    });
    if (!st.mon) notes.push({ lvl: 'info', html: '<b>' + esc(st.label) + ':</b> żaden bus ani P16 nie pasuje nazwą — ' +
      'dopasowanie idzie po nazwie odsłuchu, więc nazwij bus tak, jak stanowisko.' });
  });
  $('#plot-notes').innerHTML = notes.map(x => '<li class="' + x.lvl + '">' + x.html + '</li>').join('');
}

function renderCables(L, B, G) {
  const C = cableCounts(L, B, G);
  const P = powerRows(G);
  const li = (n, what, note) => '<li class="jack' + (n ? '' : ' empty') + '"><span class="jack-n">' + n + '</span>' +
    '<span class="jack-ico"></span><span class="jack-name">' + what + (note ? '<span class="ch-grp">' + note + '</span>' : '') + '</span></li>';
  let html = '<ol class="jacks cables">';
  html += li(C.xlr, 'XLR razem', C.xlrIn + ' wejść + ' + C.xlrOut + ' odsłuch' + (C.xlr ? ' · dołóż zapas' : ''));
  C.perNode.forEach(x => html += li(x.ins + x.outs, '&nbsp;&nbsp;w tym przy ' + (x.local ? 'konsolecie' : 'boksie ' + x.id), x.ins + ' we + ' + x.outs + ' wy'));
  html += li(C.cat5, 'skrętka Cat5e ekranowana', C.aes50.length + ' AES50 + ' + C.ultranet.length + ' ULTRANET');
  C.aes50.forEach(x => html += li(1, '&nbsp;&nbsp;AES50: ' + esc(x.from) + ' → ' + esc(x.to), 'do 100 m'));
  C.ultranet.forEach(x => html += li(1, '&nbsp;&nbsp;ULTRANET: ' + esc(x.from) + ' → ' + esc(x.to), ''));
  if (C.toslink) html += li(C.toslink, 'TOSLINK optyczny', 'boks → przetwornik, krótki');
  html += '</ol>';
  $('#cables').innerHTML = html;

  const placeSel = r => '<select data-pw-place="' + r.idx + '" title="scena czy FOH">' +
    '<option value="stage"' + (r.place === 'stage' ? ' selected' : '') + '>scena</option>' +
    '<option value="foh"' + (r.place === 'foh' ? ' selected' : '') + '>FOH</option></select>';
  $('#power-body').innerHTML =
    P.derived.map(r => '<div class="bus-row pw derived"><span class="bus-slots">' + r.n + '</span>' +
      '<span>' + esc(r.station) + '</span><span class="ch-grp">' + esc(r.items) + '</span>' +
      '<span class="ch-grp">' + (r.place === 'foh' ? 'FOH' : 'scena') + '</span><span></span></div>').join('') +
    P.manual.map(r => '<div class="bus-row pw">' +
      '<input type="number" min="0" max="20" data-pw-n="' + r.idx + '" value="' + r.n + '">' +
      '<input type="text" data-pw-station="' + r.idx + '" value="' + esc(r.station || '') + '" placeholder="stanowisko">' +
      '<input type="text" data-pw-items="' + r.idx + '" value="' + esc(r.items || '') + '" placeholder="co się wpina">' +
      placeSel(r) +
      '<button type="button" class="btn danger" data-pw-del="' + r.idx + '" title="usuń">×</button></div>').join('');
  $('#power-total').textContent = P.total;
  $('#power-split').textContent = 'scena ' + P.stage + ' · FOH ' + P.foh;
  $('#power-strips').innerHTML = '<b>Listwy: ' + P.strips + '</b> (' + P.stageSpots + ' miejsc na scenie + ' + P.fohSpots + ' FOH + 1 zapas) · ' +
    '<b>przedłużacze: ' + P.cords + '</b>, po jednym do każdego miejsca i jeden zapasowy' +
    (P.busiest ? ' · najgęściej: ' + esc(P.busiest.names[0]) + ', ' + P.busiest.n + ' gniazd' + (P.busiest.n > 3 ? ' — listwa co najmniej ' + (P.busiest.n + 1) + '-gniazdowa' : '') : '') + '.';
}

function renderStage(G) {
  const hasAes = TARGETS[S.target].aes50 > 0;
  $('#stage-noaes').hidden = hasAes;
  $('#stage-body').hidden = !hasAes;
  $$('[name="sbcount"]').forEach(el => { el.checked = +el.value === S.stage.boxes.length; });
  $('#sb-list').innerHTML = G.boxes.map(renderBoxRow).join('');
  $('#patch-wrap').hidden = !G.active;
  $('#stage-auto-note').hidden = !S.stage.auto;
  $('#local-wrap').hidden = !hasAes;
  $('#use-local').checked = S.stage.useLocal;
  $('#local-spec').innerHTML = localLine();
  $('#local-cap').hidden = !(S.stage.useLocal && localSpec(S).custom);
  if (S.localCap) { $('#loc-ins').value = S.localCap.ins || 0; $('#loc-outs').value = S.localCap.outs || 0; }
  if (!G.active) return;

  const legKeys = ['mic', 'mic48', 'line', 'usb', 'mon', 'p16', 'box', 'desk']
    .concat(G.nodes.some(n => n.exp) ? ['ada'] : []);
  $('#legend').innerHTML = legKeys.map(k =>
    '<span class="chip">' + icon(k, true) + '<b>' + esc(CONN[k].label) + '</b> — ' + esc(CONN[k].desc) + '</span>').join('');
  $('#patch-body').innerHTML = renderPatchRows(G);
  $('#show-empty-jacks').checked = UI.showEmptyJacks;
  $('#show-empty-nodes').checked = UI.showEmptyNodes;
  const printable = G.nodes.filter(b => UI.showEmptyNodes || nodeHasCables(G, b));
  const skipped = G.nodes.filter(b => !(UI.showEmptyNodes || nodeHasCables(G, b)));
  $('#sb-matrix').innerHTML = printable.map(n => renderBoxCard(n, G)).join('');
  $('#sb-skipped').innerHTML = skipped.length
    ? 'Bez kabli, ukryte: ' + skipped.map(b => esc(b.local ? 'gniazda na konsolecie' : 'stagebox ' + b.id)).join(', ') +
      ' — <button type="button" class="btn" data-act="show-empty-nodes-now">pokaż</button>.'
    : '';
}

/* Podpis lokalnego I/O pod przełącznikiem — zawsze z odmianą, bo to
   ona rozstrzyga, czy mamy 8 preampów czy 24. */
function localLine() {
  const t = TARGETS[S.target];
  if (!t.aes50) return '';
  const ls = localSpec(S);
  if (!S.stage.useLocal) return 'Wyłączone — liczą się same stageboxy.';
  const parts = [ls.ins + ' × XLR z preampem'];
  if (ls.auxin) parts.push(ls.auxin + ' × Aux In (liniowe TRS, bez phantomu)');
  parts.push(ls.outs + ' × XLR wyjściowe');
  return esc(ls.label) + ': ' + parts.join(' · ') +
    (ls.verified ? '' : ' <span class="unverified" title="wpisane ręcznie">niepotwierdzone</span>');
}

function specLine(spec) {
  const parts = [spec.ins + ' we', spec.outs + ' wy' + (spec.exp ? ' + ' + (spec.exp * EXP_OUTS) + ' przez ADAT' : ''),
                 spec.aes50 + '× AES50', 'ULTRANET ×' + spec.ultranet];
  if (spec.adat) parts.push(spec.adat + '× ADAT out');
  if (spec.powersP16 === true) parts.push('zasila P16-M');
  if (spec.powersP16 === null) parts.push('<span class="unverified" title="karta produktu tego nie mówi">zasilanie P16-M?</span>');
  if (spec.hiZ) parts.push('Hi-Z ×' + spec.hiZ + ' <span class="unverified" title="które numery gniazd — do sprawdzenia w instrukcji boksu">(które?)</span>');
  if (spec.extra) parts.push(esc(spec.extra));
  return parts.join(' · ');
}

function renderBoxRow(b) {
  const ports = AES50_PORTS.slice(0, Math.max(TARGETS[S.target].aes50, 1));
  const sp = boxSpec(S.stage.boxes[b.idx]);
  let html = '<div class="sb-row">' +
    '<span class="bus-slots">' + icon('box') + ' ' + b.id + '</span>' +
    '<select data-sb-model="' + b.idx + '">' + Object.keys(STAGEBOXES).map(k =>
      '<option value="' + k + '"' + (k === b.model ? ' selected' : '') + '>' + esc(STAGEBOXES[k].label) + '</option>').join('') + '</select>' +
    '<select data-sb-port="' + b.idx + '" title="gniazdo AES50 na konsolecie">' + ports.map(pt =>
      '<option value="' + pt + '"' + (pt === b.port ? ' selected' : '') + '>AES50 ' + pt + '</option>').join('') + '</select>' +
    '<input type="text" data-sb-pos="' + b.idx + '" value="' + esc(b.pos || '') + '" placeholder="gdzie stoi, np. tył sceny — perkusja i bas">';
  if (b.custom) {
    html += '<span class="sb-custom ch-grp">wejść <input type="number" min="1" max="64" data-sb-ins="' + b.idx + '" value="' + sp.ins + '">' +
      ' wyjść <input type="number" min="0" max="32" data-sb-outs="' + b.idx + '" value="' + sp.outs + '"></span>';
  }
  if (sp.adat) {
    let opts = '';
    for (let i = 0; i <= sp.adat; i++) {
      opts += '<option value="' + i + '"' + (i === sp.exp ? ' selected' : '') + '>' +
        (i ? i + '× ' + EXP_LABEL + '  (+' + (i * EXP_OUTS) + ' wy)' : 'bez przetwornika ADAT') + '</option>';
    }
    html += '<span class="sb-custom ch-grp">' + icon('ada') +
      '<select data-sb-exp="' + b.idx + '" title="przetwornik ADAT→analog dopięty do gniazda optycznego">' + opts + '</select></span>';
  }
  return html + '<span class="ch-grp sb-spec">' + specLine(sp) + '</span></div>';
}

function renderPatchRows(G) {
  const short = n => n.id + ' · ' + esc(n.label.replace(/^(Behringer|Midas) /, ''));
  const nodeOpts = (at, only) => '<option value="">—</option>' + G.nodes.map(n =>
    '<option value="' + n.id + '"' + (at && at.box === n.id ? ' selected' : '') +
    (only && !only(n) ? ' disabled' : '') + '>' + short(n) + '</option>').join('');

  /* Lista gniazd węzła: XLR i Aux In w jednej liście, bo z punktu
     widzenia „gdzie wsadzam ten kabel" to jeden wybór. Wartość niesie
     rodzaj, żeby nie zgadywać po numerze. Podpis mówi, kto już tam
     siedzi — konflikt widać przed kliknięciem, nie po. */
  const jackOpts = (r, node, kinds, need) => {
    let html = '';
    kinds.forEach(kind => {
      const cap = jackCap(node, kind);
      if (!cap) return;
      const grpName = { in: 'XLR z preampem', auxin: 'Aux In — liniowe',
                        out: 'XLR na boksie', expout: EXP_LABEL + ' przez ADAT' }[kind];
      if (kinds.length > 1) html += '<optgroup label="' + esc(grpName) + '">';
      for (let n = 1; n + need - 1 <= cap; n++) {
        const others = [];
        for (let k = 0; k < need; k++) {
          (G.occ[node.id + ':' + kind + ':' + (n + k)] || []).forEach(x => {
            if (x.key !== r.key) others.push(x.name + (x.side ? ' ' + x.side : ''));
          });
        }
        const sel = r.at && (r.at.k || 'in') === kind && r.at.n === n;
        html += '<option value="' + kind + ':' + n + '"' + (sel ? ' selected' : '') + '>' +
          esc(jackLabel({ box: node.id, n: n, k: kind }, kind)) +
          (others.length ? ' · ' + esc(others.join(', ')) : '') + '</option>';
      }
      if (kinds.length > 1) html += '</optgroup>';
    });
    return html;
  };

  const connCell = r => r.usb
    ? icon('usb', true) + ' ' + esc(CONN.usb.label)
    : icon(r.conn) + '<select data-conn="' + esc(r.pair || r.id) + '">' + CONN_PICK.map(k =>
        '<option value="' + k + '"' + (k === r.conn ? ' selected' : '') + '>' + esc(CONN[k].label) + '</option>').join('') + '</select>';

  const rows = [];
  const grp = t => rows.push('<tr class="grp"><td colspan="6">' + t + '</td></tr>');
  const cls = r => [r.at ? '' : 'unpatched', G.conflictKeys.has(r.key) ? 'conflict' : ''].filter(Boolean).join(' ');

  grp('Wejścia — z listy kanałów');
  G.N.ins.forEach(r => {
    const node = r.at ? nodeById(G.nodes, r.at.box) : null;
    const bad = r.at && r.at.k === 'auxin' && r.conn !== 'line';
    const note = [];
    if (r.usb) note.push('z komputera po USB — nie na scenie');
    else if (!r.at) note.push('nie wpięte');
    if (bad) note.push('<b>mikrofon na wejściu liniowym</b>');
    else if (r.at && r.at.box === LOCAL_ID) note.push('gniazdo na konsolecie');
    if (G.conflictKeys.has(r.key)) note.push('<b>konflikt</b>');
    rows.push('<tr class="' + (r.usb ? 'usb' : cls(r)) + (bad ? ' conflict' : '') + '">' +
      '<td class="ch-num">' + pad(r.n) + '</td>' +
      '<td class="pc-conn">' + connCell(r) + '</td>' +
      '<td class="ch-name">' + esc(r.name) + '</td>' +
      (r.usb ? '<td colspan="2" class="ch-grp">—</td>' :
        '<td><select data-sb-box="' + r.key + '">' + nodeOpts(r.at) + '</select></td>' +
        '<td>' + (node ? '<select data-sb-n="' + r.key + '">' + jackOpts(r, node, ['in', 'auxin'], 1) + '</select>' : '') + '</td>') +
      '<td class="ch-grp">' + note.join(' · ') + '</td></tr>');
  });

  if (G.N.outs.length) {
    grp('Odsłuchy — busy na wyjścia XLR');
    G.N.outs.forEach(r => {
      const node = r.at ? nodeById(G.nodes, r.at.box) : null;
      const note = [];
      if (r.stereo) note.push('stereo — dwa wyjścia');
      if (!r.at) note.push('nie wpięte');
      if (r.at && r.at.box === LOCAL_ID) note.push('wyjście na konsolecie');
      if (r.at && r.at.k === 'expout') note.push('na przetworniku ADAT, nie na boksie');
      if (G.conflictKeys.has(r.key)) note.push('<b>konflikt</b>');
      rows.push('<tr class="' + cls(r) + '"><td class="ch-num">' + r.slots.map(pad).join('-') + '</td>' +
        '<td class="pc-conn">' + icon('mon') + ' ' + esc(CONN.mon.label) + '</td>' +
        '<td class="ch-name">' + esc(r.name) + '</td>' +
        '<td><select data-sb-box="' + r.key + '">' + nodeOpts(r.at) + '</select></td>' +
        '<td>' + (node ? '<select data-sb-n="' + r.key + '">' + jackOpts(r, node, ['out', 'expout'], r.need) + '</select>' +
          (r.need === 2 ? ' <span class="ch-grp">+ ' + pad(r.at.n + 1) + '</span>' : '') : '') + '</td>' +
        '<td class="ch-grp">' + note.join(' · ') + '</td></tr>');
    });
  }

  if (G.N.un.length) {
    grp('P16 — port ULTRANET stageboxa');
    G.N.un.forEach(r => {
      rows.push('<tr class="' + cls(r) + '"><td class="ch-num">P16</td>' +
        '<td class="pc-conn">' + icon('p16', true) + ' ' + esc(CONN.p16.label) + '</td>' +
        '<td class="ch-name">' + esc(r.name) + '</td>' +
        '<td><select data-sb-box="' + r.key + '">' + nodeOpts(r.at, n => n.ultranet > 0) + '</select></td>' +
        '<td class="ch-grp">ULTRANET</td>' +
        '<td class="ch-grp">' + (r.stereo ? 'stereo' : 'mono') + (r.at ? '' : ' · nie wpięte') + '</td></tr>');
    });
  }
  return rows.join('');
}

/* Karta węzła: każde gniazdo w osobnym wierszu, wolne też — na planie
   sceny puste gniazdo to informacja („tu jeszcze coś wejdzie"). */
function renderBoxCard(b, G) {
  const at = (kind, n) => G.occ[b.id + ':' + kind + ':' + n] || [];
  const li = (label, items, icoOf, tail) => {
    const cls = ['jack', items.length ? '' : 'empty', items.length > 1 ? 'conflict' : ''].filter(Boolean).join(' ');
    const txt = items.length ? items.map(x => esc(x.name + (x.side ? ' ' + x.side : ''))).join(' / ') : '—';
    return '<li class="' + cls + '"><span class="jack-n">' + esc(label) + '</span>' +
      '<span class="jack-ico">' + (items.length ? icon(icoOf(items[0])) : '') + '</span>' +
      '<span class="jack-name">' + txt + (items.length ? '<span class="ch-grp">' + tail(items[0]) + '</span>' : '') + '</span></li>';
  };
  let ins = '', outs = '', usedIn = 0, usedOut = 0, usedAux = 0;
  for (let n = 1; n <= jackCap(b, 'in'); n++) if ((at('in', n)).length) usedIn++;
  for (let n = 1; n <= jackCap(b, 'auxin'); n++) if ((at('auxin', n)).length) usedAux++;
  for (let n = 1; n <= jackCap(b, 'out'); n++) if ((at('out', n)).length) usedOut++;
  for (let n = 1; n <= jackCap(b, 'expout'); n++) if ((at('expout', n)).length) usedOut++;
  /* Zliczenia w nagłówkach liczą się z pełnej pojemności — obcinanie
     dotyczy tylko tego, ile wierszy faktycznie się rysuje. */
  for (let n = 1; n <= screenRange(G, b, 'in'); n++)     ins += li(pad(n), at('in', n), x => x.conn, x => 'ch ' + pad(x.n) + (x.mic ? ' · ' + esc(x.mic) : ''));
  for (let n = 1; n <= screenRange(G, b, 'auxin'); n++)  ins += li('AUX ' + n, at('auxin', n), x => x.conn, x => 'ch ' + pad(x.n) + (x.mic ? ' · ' + esc(x.mic) : ''));
  for (let n = 1; n <= screenRange(G, b, 'out'); n++)    outs += li(pad(n), at('out', n), () => 'mon', x => 'bus ' + x.slots.map(pad).join('-'));
  for (let n = 1; n <= screenRange(G, b, 'expout'); n++) outs += li('ADA ' + pad(n), at('expout', n), () => 'mon', x => 'bus ' + x.slots.map(pad).join('-'));
  const un = at('un', 0);
  const head = b.local
    ? icon('desk') + ' Gniazda na konsolecie — ' + esc(b.label)
    : icon('box') + ' Stagebox ' + b.id + ' — ' + esc(b.label);
  const sub = b.local
    ? 'przy konsolecie' + (jackCap(b, 'auxin') ? ' · Aux In są liniowe' : '')
    : 'AES50 ' + esc(b.port || '?') + (b.pos ? ' · ' + esc(b.pos) : '');
  const inHead = 'Wejścia — ' + (usedIn + usedAux) + ' / ' + (jackCap(b, 'in') + jackCap(b, 'auxin'));
  return '<div class="sb-card' + (b.local ? ' local' : '') + '">' +
    '<h4>' + head + '<span class="ch-grp sb-sub">' + sub + '</span></h4>' +
    '<div class="sb-cols">' +
      '<div><h5>' + inHead + '</h5><ol class="jacks">' + ins + '</ol></div>' +
      '<div><h5>Wyjścia — ' + usedOut + ' / ' + (jackCap(b, 'out') + jackCap(b, 'expout')) +
        (b.exp ? ' <span class="ch-grp">w tym ' + jackCap(b, 'expout') + ' na ' + esc(EXP_LABEL) + '</span>' : '') +
        '</h5><ol class="jacks">' + outs + '</ol></div>' +
      '<div class="sb-un"><h5>' + (b.ultranet
        ? 'ULTRANET — ' + un.length + ' na ' + b.ultranet + ' port' + (b.ultranet === 1 ? '' : 'y')
        : 'ULTRANET — brak portu') + '</h5>' +
        (un.length ? '<div class="chip-row">' + un.map(x => '<span class="chip">' + icon('p16', true) + ' ' +
          esc(x.name) + ' (' + (x.stereo ? 'stereo' : 'mono') + ')</span>').join('') + '</div>'
          : '<span class="ch-grp">' + (b.ultranet ? 'nikt' : 'konsoleta nie ma ULTRANET-u') + '</span>') +
      '</div>' +
    '</div></div>';
}

/* ------------------------------------------------------------
   8b. ARKUSZ DO DRUKU
   Osobny, minimalny render tych samych danych. Próba doprowadzenia
   ekranowego interfejsu do druku samym CSS-em zawsze kończy się
   walką z <select>ami, checkboxami i paskami tytułów — a na kartce
   nie są one do niczego potrzebne. Tu nie ma czego ukrywać, bo
   niczego zbędnego nie ma od początku.
   ------------------------------------------------------------ */
/* Ostatnie ZAJĘTE gniazdo danego rodzaju w węźle — granica, do której
   ma sens drukować. Luki w środku zostają zawsze: „03 wolne między 02
   a 04" to informacja; pusty ogon za ostatnim kablem to tylko papier. */
function lastUsed(G, node, kind) {
  let last = 0;
  for (let n = 1; n <= jackCap(node, kind); n++)
    if ((G.occ[node.id + ':' + kind + ':' + n] || []).length) last = n;
  return last;
}
/* Wspólna dla druku i ekranu: showEmpty=true pokazuje wszystkie
   gniazda, false ucina ogon za ostatnim zajętym. Luka W ŚRODKU
   zostaje zawsze — informuje, że coś tam kiedyś było albo będzie. */
function rangeFor(G, node, kind, showEmpty) {
  return showEmpty ? jackCap(node, kind) : lastUsed(G, node, kind);
}
function printRange(G, node, kind) { return rangeFor(G, node, kind, S.printEmptyJacks); }
function screenRange(G, node, kind) { return rangeFor(G, node, kind, UI.showEmptyJacks); }
function nodeHasCables(G, node) {
  return ['in', 'auxin', 'out', 'expout'].some(k => lastUsed(G, node, k) > 0) ||
    (G.occ[node.id + ':un:0'] || []).length > 0;
}

function renderPrintSheet(L, B, G) {
  const meta = [S.gig.name, S.gig.date, S.gig.console ? 'Konsoleta: ' + S.gig.console : '']
    .filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');

  /* Gniazdo na kartce: ze stageboxami to XLR na boksie, bez nich —
     wejście konsolety. USB nie ma gniazda na scenie w żadnym wariancie. */
  const jackTxt = r => {
    if (r.over) return '—';
    if (r.kind === 'usb') return icon('usb') + ' U' + pad(r.n);
    if (!G.active) return 'In' + pad(r.n);
    const p = S.stage.patch['in:' + r.id];
    if (!p) return '<span class="ps-dim">nie wpięte</span>';
    return icon(p.box === LOCAL_ID ? 'desk' : 'box') + ' ' + esc(jackLabel(p, inKind(p)));
  };

  const chRows = L.rows.map(r => {
    if (r.spacer) return '<tr><td class="ps-n">' + pad(r.n) + '</td><td colspan="6" class="ps-dim">— wolne —</td></tr>';
    const notes = [];
    if (r.side === 'L') notes.push('para ' + pad(r.n) + '-' + pad(r.n + 1));
    if (r.noMain) notes.push('poza Main LR');
    if (r.over) notes.push('PONAD POJEMNOŚĆ');
    return '<tr><td class="ps-n">' + pad(r.n) + '</td>' +
      '<td class="ps-sym">' + icon(connOf(r), true) + '</td>' +
      '<td class="ps-name">' + esc(r.name) + '</td>' +
      '<td class="ps-mic">' + esc(micOf(r)) + '</td>' +
      '<td class="ps-mount">' + esc(MOUNTS[mountOf(r)].label) + '</td>' +
      '<td>' + jackTxt(r) + '</td>' +
      '<td class="ps-note">' + notes.join(' · ') + '</td></tr>';
  }).join('');
  const packing = packingList(L), missing = micsMissing(L);

  const legKeys = ['mic', 'mic48', 'line', 'usb']
    .concat(G.active ? ['mon', 'p16', 'box', 'desk'] : [])
    .concat(G.active && G.nodes.some(n => n.exp) ? ['ada'] : []);
  const legend = legKeys.map(k => icon(k, true) + ' ' + esc(CONN[k].label)).join(' &nbsp; ');

  let html = '<h1>Lista wejściowa — The Magick Eye</h1>';
  if (meta) html += '<p class="ps-meta">' + meta + '</p>';
  html += '<table class="ps-table"><thead><tr><th>#</th><th></th><th>Nazwa</th><th>Mikrofon</th><th>Mocowanie</th><th>' + (G.active ? 'Gniazdo' : 'Wejście') + '</th><th>Uwagi</th></tr></thead>' +
          '<tbody>' + chRows + '</tbody></table>' +
          '<p class="ps-legend">' + legend + '</p>';
  if (packing.length || missing.length) {
    const st = standsList(L);
    const stTxt = [st.stand ? '<b>' + st.stand + '×</b> statyw' : '', st.clip ? '<b>' + st.clip + '×</b> klips' : '']
      .filter(Boolean).join(' &nbsp;·&nbsp; ');
    html += '<h2>Do spakowania</h2><p class="ps-pack">' +
      packing.map(x => '<b>' + x.count + '×</b> ' + esc(x.model)).join(' &nbsp;·&nbsp; ') +
      (stTxt ? '<br>' + stTxt : '') +
      (missing.length ? '<br><span class="ps-dim">Bez modelu: ' + missing.map(r => esc(r.name)).join(', ') + '.</span>' : '') +
      '</p>';
  }

  /* Kable i zasilanie: dwie kolumny, liczby po lewej — to się czyta
     przy pakowaniu samochodu, nie przy stole. */
  {
    const C = cableCounts(L, B, G), P = powerRows(G);
    const row = (n, what, note) => '<tr><td class="ps-n">' + n + '</td><td class="ps-name">' + what + '</td><td class="ps-note">' + (note || '') + '</td></tr>';
    let cab = row(C.xlr, 'XLR', C.xlrIn + ' wejść + ' + C.xlrOut + ' odsłuch');
    C.perNode.forEach(x => cab += row(x.ins + x.outs, '&nbsp;&nbsp;przy ' + (x.local ? 'konsolecie' : 'boksie ' + x.id), x.ins + ' we + ' + x.outs + ' wy'));
    cab += row(C.cat5, 'skrętka Cat5e', C.aes50.length + ' AES50 + ' + C.ultranet.length + ' ULTRANET');
    C.aes50.forEach(x => cab += row(1, '&nbsp;&nbsp;' + esc(x.from) + ' → ' + esc(x.to), 'AES50'));
    C.ultranet.forEach(x => cab += row(1, '&nbsp;&nbsp;' + esc(x.from) + ' → ' + esc(x.to), 'ULTRANET'));
    if (C.toslink) cab += row(C.toslink, 'TOSLINK', 'boks → przetwornik');
    const byPlace = place => P.derived.concat(P.manual).filter(r => r.place === place).map(r => row(r.n, esc(r.station), esc(r.items))).join('');
    let pw = byPlace('stage') +
      '<tr><td class="ps-n"><b>' + P.stage + '</b></td><td class="ps-name"><b>na scenie</b></td><td class="ps-note"></td></tr>' +
      byPlace('foh') +
      '<tr><td class="ps-n"><b>' + P.foh + '</b></td><td class="ps-name"><b>na FOH-u</b></td><td class="ps-note">realizator pewnie ma listwę w racku — liczymy i tak</td></tr>' +
      '<tr><td class="ps-n"><b>' + P.total + '</b></td><td class="ps-name"><b>gniazd 230 V razem</b></td><td class="ps-note"></td></tr>' +
      '<tr><td class="ps-n"><b>' + P.strips + '</b></td><td class="ps-name"><b>listwy</b></td><td class="ps-note">' + P.stageSpots + ' miejsc na scenie + ' + P.fohSpots + ' FOH + 1 zapas' +
        (P.busiest && P.busiest.n > 3 ? '; ' + esc(P.busiest.names[0]) + ': ' + P.busiest.n + ' gniazd, listwa min. ' + (P.busiest.n + 1) : '') + '</td></tr>' +
      '<tr><td class="ps-n"><b>' + P.cords + '</b></td><td class="ps-name"><b>przedłużacze</b></td><td class="ps-note">po jednym do każdego miejsca + 1 zapas</td></tr>';
    html += '<div class="ps-cables"><h2>Kable i zasilanie</h2>' +
      '<table class="ps-table"><thead><tr><th>Szt.</th><th>Kable</th><th></th></tr></thead><tbody>' + cab + '</tbody></table>' +
      '<table class="ps-table" style="margin-top:.6rem"><thead><tr><th>Gniazd</th><th>Zasilanie 230 V</th><th></th></tr></thead><tbody>' + pw + '</tbody></table>' +
      '</div>';
  }

  if (L.auxRet.length) {
    html += '<h2>Zwrot aux</h2><table class="ps-table"><tbody>' +
      L.auxRet.map((r, i) => '<tr><td class="ps-n">U' + (17 + i) + '</td>' +
        '<td class="ps-name">' + esc(r.name) + '</td><td colspan="2"></td></tr>').join('') +
      '</tbody></table>';
  }

  const buses = B.rows.filter(r => !r.spacer);
  const m = S.p16Monitor;
  /* Ze stageboxem odsłuch ma konkretne gniazdo („A-03") albo port
     ULTRANET konkretnego boksu — to idzie na kartkę zamiast ogólników. */
  const busWhere = r => {
    if (!G.active) return r.bus.out === 'aux' ? 'Aux Out' : r.bus.out === 'ultranet' ? 'slot P16' : 'Aux Out + slot P16';
    const parts = [];
    const po = S.stage.patch['out:bus_' + r.idx], pu = S.stage.patch['un:bus_' + r.idx];
    if (r.bus.out === 'aux' || r.bus.out === 'both')
      parts.push(icon('mon') + ' ' + (po ? esc(jackLabel(po, 'out')) + (r.bus.stereo ? ' + ' + pad(po.n + 1) : '') : 'nie wpięte'));
    if (r.bus.out === 'ultranet' || r.bus.out === 'both')
      parts.push(icon('p16', true) + ' ' + (pu ? esc(jackLabel(pu, 'un')) : 'nie wpięte'));
    return parts.join(' · ');
  };
  const monWhere = () => {
    if (!G.active) return 'ULTRANET — wymaga doprowadzenia skrętki na scenę';
    const p = S.stage.patch['un:p16'];
    return icon('p16', true) + ' ' + (p ? esc(jackLabel(p, 'un')) : 'nie wpięte');
  };
  if (buses.length || m.on) {
    html += '<h2>Odsłuchy</h2><table class="ps-table"><tbody>' +
      buses.map(r => '<tr><td class="ps-n">' + r.slots.map(pad).join('-') + '</td>' +
        '<td class="ps-name">' + esc(r.bus.name) + '</td>' +
        '<td>' + (r.bus.stereo ? 'stereo' : 'mono') + '</td>' +
        '<td class="ps-note">' + busWhere(r) + '</td></tr>').join('') +
      (m.on ? '<tr><td class="ps-n">P16</td>' +
        '<td class="ps-name">' + esc(m.name || 'P16') + '</td>' +
        '<td>' + (m.stereo ? 'stereo' : 'mono') + '</td>' +
        '<td class="ps-note">' + monWhere() + '</td></tr>' : '') +
      '</tbody></table>';
  }

  if (G.active) {
    html += '<div class="ps-stage"><h2>Patch sceny</h2>';
    const printable = G.nodes.filter(b => S.printEmptyNodes || nodeHasCables(G, b));
    const skipped = G.nodes.length - printable.length;
    printable.forEach(b => {
      const at = (kind, n) => G.occ[b.id + ':' + kind + ':' + n] || [];
      const row = (label, items, icoOf, tail) => '<tr><td class="ps-n">' + esc(label) + '</td>' +
        '<td class="ps-sym">' + (items.length ? icon(icoOf(items[0])) : '') + '</td>' +
        (items.length
          ? '<td class="ps-name">' + items.map(x => esc(x.name + (x.side ? ' ' + x.side : ''))).join(' / ') + '</td><td class="ps-note">' + tail(items[0]) + '</td>'
          : '<td colspan="2" class="ps-dim">—</td>') + '</tr>';
      let ins = '', outs = '';
      const inTail = x => 'ch ' + pad(x.n) + (x.mic ? ' · ' + esc(x.mic) : '');
      for (let n = 1; n <= printRange(G, b, 'in'); n++)     ins  += row(pad(n), at('in', n), x => x.conn, inTail);
      for (let n = 1; n <= printRange(G, b, 'auxin'); n++)  ins  += row('AUX ' + n, at('auxin', n), x => x.conn, inTail);
      for (let n = 1; n <= printRange(G, b, 'out'); n++)    outs += row(pad(n), at('out', n), () => 'mon', x => 'bus ' + x.slots.map(pad).join('-'));
      for (let n = 1; n <= printRange(G, b, 'expout'); n++) outs += row('ADA ' + pad(n), at('expout', n), () => 'mon', x => 'bus ' + x.slots.map(pad).join('-'));
      const none = '<tr><td colspan="4" class="ps-dim">nic nie wpięte</td></tr>';
      if (!ins) ins = none;
      if (!outs) outs = none;
      const un = at('un', 0);
      const head = b.local
        ? icon('desk') + ' Gniazda na konsolecie — ' + esc(b.label) + ' &nbsp;·&nbsp; przy stole'
        : icon('box') + ' Stagebox ' + b.id + ' — ' + esc(b.label) +
          (b.exp ? ' + ' + b.exp + '× ' + esc(EXP_LABEL) : '') +
          ' &nbsp;·&nbsp; AES50 ' + esc(b.port || '?') + (b.pos ? ' &nbsp;·&nbsp; ' + esc(b.pos) : '');
      html += '<div class="ps-box"><h3>' + head + '</h3>' +
        '<div class="ps-cols">' +
          '<table class="ps-table"><thead><tr><th>We</th><th></th><th>Źródło</th><th>Kanał</th></tr></thead><tbody>' + ins + '</tbody></table>' +
          '<table class="ps-table"><thead><tr><th>Wy</th><th></th><th>Odsłuch</th><th>Bus</th></tr></thead><tbody>' + outs + '</tbody></table>' +
        '</div>' +
        (b.exp ? '<p class="ps-note">' + icon('ada') + ' ADA: wyjścia na przetworniku ' + esc(EXP_LABEL) +
                 ', spiętym z boksem optycznym TOSLINK-iem — osobna obudowa, musi stać przy boksie.</p>' : '') +
        (b.ultranet
          ? '<p class="ps-note">' + icon('p16', true) + ' ULTRANET (' + b.ultranet + ' port' + (b.ultranet === 1 ? '' : 'y') + '): ' +
              (un.length ? un.map(x => esc(x.name) + ' (' + (x.stereo ? 'stereo' : 'mono') + ')').join(', ') : 'nikt') +
              /* Uwaga o zasilaniu ma sens tylko tam, gdzie ktoś wisi na porcie. */
              (!un.length ? '' : b.powersP16 === true ? ' — port zasila odbiornik po skrętce'
                : b.powersP16 === null ? ' — czy ten port podaje zasilanie, niepotwierdzone; wziąć zasilacz do P16' : '') +
            '</p>'
          : '<p class="ps-note ps-dim">bez portu ULTRANET</p>') +
        '</div>';
    });
    if (skipped) {
      html += '<p class="ps-note ps-dim">Pominięto ' + skipped + ' bez kabli: ' +
        G.nodes.filter(b => !(S.printEmptyNodes || nodeHasCables(G, b)))
          .map(b => esc(b.local ? 'gniazda na konsolecie' : 'stagebox ' + b.id)).join(', ') + '.</p>';
    }
    html += '</div>';
  }

  if (S.printPlot) {
    html += '<div class="ps-plot"><h2>Plan sceny</h2>' + plotSvg(plotData(L, B, G)) + '</div>';
  }

  if (!S.printP16) { $('#print-sheet').innerHTML = html; return; }

  const avail = p16Sources(L, B);
  if (S.p16.some(sl => avail.some(a => a.id === sl.src))) {
    let lastSlot = 16;
    if (!S.printEmptyJacks) {
      lastSlot = 0;
      S.p16.forEach((sl, i) => { if (avail.some(a => a.id === sl.src)) lastSlot = i + 1; });
    }
    html += '<h2>Odsłuch P16 / Ultranet</h2><table class="ps-table"><tbody>' +
      S.p16.slice(0, lastSlot).map((sl, i) => {
        const a = avail.find(x => x.id === sl.src);
        const t = P16_TAPS.find(x => x.v === sl.tap);
        if (!a) return '<tr><td class="ps-n">' + pad(i + 1) + '</td><td colspan="3" class="ps-dim">—</td></tr>';
        return '<tr><td class="ps-n">' + pad(i + 1) + '</td>' +
          '<td class="ps-name">' + esc(a.label.replace(/^(\S+)\s+\s*/, '')) + '</td>' +
          '<td>' + esc(a.osc) + '</td>' +
          '<td class="ps-note">' + esc(t ? t.label : sl.tap) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  $('#print-sheet').innerHTML = html;
}

/* ------------------------------------------------------------
   9. EKSPORT
   JSON jest świadomie niezależny od konsolety: opisuje ZAMIAR
   (co gdzie ma iść), a nie komendy OSC. Z tego da się wygenerować
   i scenę .scn dla XR18, i snapshot dla Winga — to dwa różne
   formaty i dwie różne architektury kanałów.
   ------------------------------------------------------------ */
function buildJSON(L, B, G) {
  const avail = p16Sources(L, B);
  return {
    schema: 'magickeye.input-list/1',
    generated: new Date().toISOString(),
    gig: S.gig,
    counts: { jacks: L.rows.filter(r => !r.spacer).length, channelStrips: L.strips },
    console: { target: S.target, variant: TARGETS[S.target].variants ? S.variant : null,
               label: L.cap.label, channelSlots: L.cap.channels,
               stereoNeedsAdjacentPair: L.cap.linksAdjacent,
               auxReturnSlots: L.cap.auxReturn, busSlots: L.cap.buses, capacitiesVerified: L.cap.verified },
    selection: S.src,
    channels: L.rows.map(r => r.spacer
      ? { n: r.n, empty: true }
      : { n: r.n, name: r.name, group: r.group,
          source: r.kind === 'usb' ? 'usb' : 'analog',
          jack: r.over ? null : 'In' + pad(r.n),
          usb:  r.over ? null : 'U' + pad(r.n),
          toMainLR: !r.noMain,
          /* conn = typ połączenia (symbol na patchu); connRef = klucz
             nadpisania, wspólny dla L i R pary. */
          id: r.id, conn: connOf(r), connRef: r.pair || r.id,
          mic: r.kind === 'usb' ? null : micOf(r),
          mount: r.kind === 'usb' ? null : mountOf(r),
          mountLabel: r.kind === 'usb' ? null : MOUNTS[mountOf(r)].label,
          stage: G.active && !r.over && r.kind !== 'usb'
            ? (p => p ? { box: p.box, jack: p.n, jackKind: inKind(p), label: jackLabel(p, inKind(p)) } : null)(S.stage.patch['in:' + r.id])
            : null,
          stereoPair: r.pair ? { id: r.pair, side: r.side } : null,
          linked: !!L.links[r.n % 2 === 1 ? r.n : r.n - 1],
          overCapacity: !!r.over }),
    /* Lista do spakowania: model → sztuki, po wierszach listy. */
    packing: packingList(L),
    micsMissing: micsMissing(L).map(r => r.name),
    /* Statywy i klipsy z kolumny mocowań. */
    stands: standsList(L),
    /* Plan sceny: pozycje w slotach i to, co stoi na każdym stanowisku —
       z tego da się narysować plan także poza tym narzędziem. */
    stagePlot: (D => ({
      view: 'z góry; lewo/prawo jak z widowni',
      slots: Object.keys(STAGE_SLOTS).reduce((o, k) => { o[k] = STAGE_SLOTS[k].label; return o; }, {}),
      stations: D.stations.map(st => ({ id: st.id, label: st.label, slot: st.slot, slotLabel: (STAGE_SLOTS[st.slot] || {}).label,
        channels: st.chans, channelCount: st.count, mics: st.mics, di: st.di,
        stands: st.stands, clips: st.clips, monitor: st.mon, sockets: st.power, boxes: st.boxes })),
      boxes: D.boxes.map(b => ({ id: b.id, label: b.label, slot: b.slot, slotLabel: BOX_SLOTS[b.slot] }))
    }))(plotData(L, B, G)),
    cables: (c => ({ xlr: c.xlr, xlrInputs: c.xlrIn, xlrMonitorOuts: c.xlrOut, cat5: c.cat5,
      aes50: c.aes50, ultranet: c.ultranet, toslink: c.toslink, perNode: c.perNode }))(cableCounts(L, B, G)),
    power: (p => ({ sockets: p.total, stage: p.stage, foh: p.foh, powerStrips: p.strips, extensionCords: p.cords,
      rows: p.derived.concat(p.manual).map(r => ({ station: r.station, items: r.items, sockets: r.n, place: r.place, derived: !!r.derived })) }))(powerRows(G)),
    auxReturn: L.auxRet.map((r, i) => ({ slot: 'U' + (17 + i), name: r.name,
      overCapacity: i >= L.cap.auxReturn })),
    buses: B.rows.filter(r => !r.spacer).map(r => ({
      slots: r.slots, name: r.bus.name, stereo: r.bus.stereo, out: r.bus.out,
      outVerified: r.bus.out === 'aux', overCapacity: r.over })),
    p16Monitor: S.p16Monitor.on
      ? { name: S.p16Monitor.name, stereo: S.p16Monitor.stereo, via: 'ultranet' }
      : null,
    /* Scena: boksy z pojemnościami i patch w trzech listach. busIndex
       null w ultranet = deklaracja „ktoś słucha przez P16", nie bus. */
    stage: G.active ? {
      /* Węzły: stageboxy plus — jeśli włączone — gniazda na samej
         konsolecie. local:true odróżnia jedne od drugich. */
      nodes: G.nodes.map(n => ({
        id: n.id, local: n.local, model: n.local ? null : n.model, label: n.label,
        aes50Port: n.port, position: n.local ? 'przy konsolecie' : (n.pos || ''),
        inputsXlr: jackCap(n, 'in'), inputsLine: jackCap(n, 'auxin'), outputs: jackCap(n, 'out'),
        /* Wyjścia na przetworniku ADAT stoją osobno, bo to inne pudełko. */
        adatOutPorts: n.adat, adatConverters: n.exp, outputsViaAdat: jackCap(n, 'expout'),
        aes50Ports: n.local ? null : n.aes50, ultranetPorts: n.ultranet,
        powersP16: n.local ? null : n.powersP16, specVerified: n.verified })),
      inputs: G.N.ins.filter(r => !r.usb).map(r => ({
        ref: r.id, channel: r.n, name: r.name, conn: r.conn,
        box: r.at ? r.at.box : null, jack: r.at ? r.at.n : null,
        jackKind: r.at ? inKind(r.at) : null,
        label: r.at ? jackLabel(r.at, inKind(r.at)) : null })),
      monitorOuts: G.N.outs.map(r => ({
        busIndex: r.idx, busSlots: r.slots, name: r.name, stereo: r.stereo,
        box: r.at ? r.at.box : null,
        jacks: r.at ? (r.need === 2 ? [r.at.n, r.at.n + 1] : [r.at.n]) : null,
        jackKind: r.at ? outKind(r.at) : null,
        viaAdatConverter: r.at ? outKind(r.at) === 'expout' : null,
        label: r.at ? jackLabel(r.at, outKind(r.at)) : null })),
      ultranet: G.N.un.map(r => ({ busIndex: r.idx, name: r.name, stereo: r.stereo, box: r.at ? r.at.box : null })),
      conflicts: G.conflicts.length,
      /* Instrukcja WING 5.4: źródło wybiera się per kanał, więc gniazda
         lokalne i AES50 działają jednocześnie. */
      localAndAes50Simultaneous: true
    } : null,
    p16: S.p16.map((sl, i) => {
      const a = avail.find(x => x.id === sl.src);
      const tap = P16_TAPS.find(t => t.v === sl.tap);
      return {
        slot: i + 1,
        source: a ? a.osc : null,              // token XR18, np. Ch01 / Bus1 / AuxL
        sourceKind: a ? a.grp : null,           // do przełożenia na inną konsoletę
        name: a ? a.label.replace(/^\S+\s+\s*/, '') : null,
        tap: a ? sl.tap : null,
        tapLabel: a && tap ? tap.label : null
      };
    }),
    notes: [
      'Pary stereo na XR18 linkują się wyłącznie 1-2, 3-4, 5-6 … (/config/chlink).',
      'Źródło kanału wybiera pole 2 w /ch/NN/preamp: ON = USB, OFF = gniazdo.',
      'Przypisanie do Main LR to pole 3 w /ch/NN/mix.',
      'Tokeny źródeł i odczepów P16 odczytane z eksportu I/O patching preset (IOpatchingP16.scn).',
      'Post Fader nie ma wariantu + Mute — za faderem mute już zadziałał.'
    ]
  };
}

function buildText(L, B, G) {
  const pad2 = s => String(s).padEnd(12, ' ');
  const lines = [];
  lines.push('LISTA WEJŚCIOWA — THE MAGICK EYE');
  if (S.gig.name) lines.push(S.gig.name + (S.gig.date ? '  ·  ' + S.gig.date : ''));
  if (S.gig.console) lines.push('Konsoleta: ' + S.gig.console);
  lines.push('');
  L.rows.forEach(r => {
    const link = L.links[r.n % 2 === 1 ? r.n : r.n - 1] ? (r.side === 'L' ? ' \\ para' : ' / stereo') : '';
    const tag = r.spacer ? '     ' : String(CONN[connOf(r)].label).padEnd(9, ' ');
    let jack = '';
    if (!r.spacer && G.active && r.kind !== 'usb' && !r.over) {
      const p = S.stage.patch['in:' + r.id];
      jack = '  ' + (p ? jackLabel(p, inKind(p)) : '(nie wpięte)');
    }
    const mic = r.spacer ? '' : micOf(r);
    const mnt = r.spacer || r.kind === 'usb' ? '' : MOUNTS[mountOf(r)].label;
    lines.push(' ' + pad(r.n) + '  ' + tag + ' ' + pad2(r.spacer ? '—' : r.name) +
      (mic || mnt ? '  ' + String(mic).padEnd(28, ' ') + ' ' + String(mnt).padEnd(13, ' ') : '') +
      (r.spacer ? '' : (r.kind === 'usb' ? ' (USB)' : '')) + jack + link + (r.noMain ? '  [poza Main LR]' : ''));
  });
  const packing = packingList(L), missing = micsMissing(L);
  if (packing.length || missing.length) {
    lines.push('');
    lines.push('DO SPAKOWANIA');
    packing.forEach(x => lines.push(' ' + String(x.count + '×').padStart(4, ' ') + '  ' + x.model));
    const st = standsList(L);
    if (st.stand) lines.push(' ' + String(st.stand + '×').padStart(4, ' ') + '  statyw');
    if (st.clip)  lines.push(' ' + String(st.clip + '×').padStart(4, ' ') + '  klips');
    if (missing.length) lines.push('  bez modelu: ' + missing.map(r => r.name).join(', '));
  }
  {
    const C = cableCounts(L, B, G), P = powerRows(G);
    lines.push('');
    lines.push('KABLE');
    lines.push('  ' + String(C.xlr).padStart(3, ' ') + '  XLR  (' + C.xlrIn + ' wejść + ' + C.xlrOut + ' odsłuch)');
    C.perNode.forEach(x => lines.push('  ' + String(x.ins + x.outs).padStart(3, ' ') + '    przy ' + (x.local ? 'konsolecie' : 'boksie ' + x.id) + ': ' + x.ins + ' we + ' + x.outs + ' wy'));
    lines.push('  ' + String(C.cat5).padStart(3, ' ') + '  skrętka Cat5e  (' + C.aes50.length + ' AES50 + ' + C.ultranet.length + ' ULTRANET)');
    C.aes50.forEach(x => lines.push('         ' + x.from + ' → ' + x.to));
    C.ultranet.forEach(x => lines.push('         ' + x.from + ' → ' + x.to + '  (ULTRANET)'));
    if (C.toslink) lines.push('  ' + String(C.toslink).padStart(3, ' ') + '  TOSLINK  (boks → przetwornik)');
    lines.push('');
    lines.push('ZASILANIE 230 V');
    const pwLine = r => lines.push('  ' + String(r.n).padStart(3, ' ') + '  ' + String(r.station).padEnd(30, ' ') + ' ' + r.items);
    P.derived.concat(P.manual).filter(r => r.place === 'stage').forEach(pwLine);
    lines.push('  ' + String(P.stage).padStart(3, ' ') + '  na scenie');
    P.derived.concat(P.manual).filter(r => r.place === 'foh').forEach(pwLine);
    lines.push('  ' + String(P.foh).padStart(3, ' ') + '  na FOH-u');
    lines.push('  ' + String(P.total).padStart(3, ' ') + '  RAZEM');
    lines.push('  ' + String(P.strips).padStart(3, ' ') + '  listwy  (' + P.stageSpots + ' miejsc na scenie + ' + P.fohSpots + ' FOH + 1 zapas)');
    lines.push('  ' + String(P.cords).padStart(3, ' ') + '  przedłużacze  (po jednym do miejsca + 1 zapas)');
  }
  if (G.active) {
    lines.push('');
    lines.push('SCENA');
    G.nodes.filter(b => S.printEmptyNodes || nodeHasCables(G, b)).forEach(b => {
      lines.push(b.local
        ? ' PULT — ' + b.label + '  ·  gniazda na konsolecie'
        : ' STAGEBOX ' + b.id + ' — ' + b.label + (b.exp ? ' + ' + b.exp + '× ' + EXP_LABEL : '') +
          '  ·  AES50 ' + (b.port || '?') + (b.pos ? '  ·  ' + b.pos : ''));
      const at = (kind, n) => G.occ[b.id + ':' + kind + ':' + n] || [];
      const line = (label, it, tail) => lines.push('   ' + String(label).padEnd(9, ' ') + ' ' +
        (it.length ? it.map(x => String(x.conn ? CONN[x.conn].label : 'MON').padEnd(9, ' ') + ' ' +
          x.name + (x.side ? ' ' + x.side : '') + '  (' + tail(x) + ')').join(' / ') : '—'));
      const inTail = x => 'ch ' + pad(x.n) + (x.mic ? ' · ' + x.mic : '');
      for (let n = 1; n <= printRange(G, b, 'in'); n++)     line('we ' + pad(n), at('in', n), inTail);
      for (let n = 1; n <= printRange(G, b, 'auxin'); n++)  line('aux in ' + n, at('auxin', n), inTail);
      for (let n = 1; n <= printRange(G, b, 'out'); n++)    line('wy ' + pad(n), at('out', n), x => 'bus ' + x.slots.map(pad).join('-'));
      for (let n = 1; n <= printRange(G, b, 'expout'); n++) line('ADA ' + pad(n), at('expout', n), x => 'bus ' + x.slots.map(pad).join('-'));
      const un = at('un', 0);
      if (b.ultranet) lines.push('   ULTRANET ×' + b.ultranet + '  ' + (un.length ? un.map(x => x.name).join(', ') : '—'));
      lines.push('');
    });
  }
  if (L.auxRet.length) {
    lines.push('');
    L.auxRet.forEach((r, i) => lines.push(' U' + (17 + i) + '  ' + r.name + '   (zwrot aux)'));
  }
  lines.push('');
  lines.push('BUSY');
  B.rows.filter(r => !r.spacer).forEach(r => lines.push(' ' + r.slots.map(pad).join('-') + '  ' +
    r.bus.name + '  ' + (r.bus.stereo ? 'stereo' : 'mono') + '  →  ' + r.bus.out));
  lines.push('');
  lines.push('P16 / ULTRANET');
  const avail = p16Sources(L, B);
  let lastSlot = 16;
  if (!S.printEmptyJacks) { lastSlot = 0; S.p16.forEach((sl, i) => { if (avail.some(a => a.id === sl.src)) lastSlot = i + 1; }); }
  S.p16.slice(0, lastSlot).forEach((sl, i) => {
    const a = avail.find(x => x.id === sl.src);
    const tap = P16_TAPS.find(t => t.v === sl.tap);
    lines.push(' ' + pad(i + 1) + '  ' + (a ? String(a.label).padEnd(22, ' ') + (tap ? tap.label : '') : '—'));
  });
  return lines.join('\n');
}

let exportMode = 'json';
function renderExport(L, B, G) {
  $('#export-out').value = exportMode === 'json'
    ? JSON.stringify(buildJSON(L, B, G), null, 2)
    : buildText(L, B, G);
}

/* ------------------------------------------------------------
   10. TRWAŁOŚĆ: localStorage + link w adresie
   Link w adresie jest po to, żeby dało się wysłać gotową
   konfigurację realizatorowi bez żadnego serwera.
   ------------------------------------------------------------ */
const LS_LAST = 'magickeye.inputlist.last';
const LS_PRESETS = 'magickeye.inputlist.presets';

/* ------------------------------------------------------------
   10a. ZWIJANIE SEKCJI
   Preferencja interfejsu, nie konfiguracji: NIE wchodzi do S, więc
   nie jedzie w linku, w presecie ani w pliku — realizator dostający
   link ma zobaczyć wszystko rozwinięte. Trzymana osobno.
   ------------------------------------------------------------ */
const LS_UI = 'magickeye.inputlist.ui';
/* showEmptyJacks/showEmptyNodes: to samo pytanie co przy druku
   („wolne gniazda do końca" / „boksy bez kabli"), ale osobna
   odpowiedź — ekran służy do pracy nad patchem, więc domyślnie
   kompaktowy, tak jak wydruk. To preferencja tej przeglądarki, nie
   część konfiguracji: nie jedzie w linku ani w presecie. */
let UI = { collapsed: {}, showEmptyJacks: false, showEmptyNodes: false };
function loadUI() {
  try { UI = Object.assign({ collapsed: {}, showEmptyJacks: false, showEmptyNodes: false }, safeParse(localStorage.getItem(LS_UI) || '{}')); }
  catch (e) { UI = { collapsed: {}, showEmptyJacks: false, showEmptyNodes: false }; }
  if (!UI.collapsed || typeof UI.collapsed !== 'object') UI.collapsed = {};
}
function saveUI() { try { localStorage.setItem(LS_UI, JSON.stringify(UI)); } catch (e) { /* tryb prywatny */ } }
function applyCollapse() {
  $$('.panel[data-panel]').forEach(sec => {
    const on = !!UI.collapsed[sec.dataset.panel];
    sec.classList.toggle('collapsed', on);
    const h = sec.querySelector('.panel-title');
    if (h) { h.setAttribute('role', 'button'); h.tabIndex = 0; h.setAttribute('aria-expanded', on ? 'false' : 'true'); }
  });
}
function setCollapsed(id, on) { UI.collapsed[id] = !!on; saveUI(); applyCollapse(); }
function setCollapsedAll(on) {
  $$('.panel[data-panel]').forEach(sec => { UI.collapsed[sec.dataset.panel] = !!on; });
  saveUI(); applyCollapse();
}

/* JSON spoza strony — z linku, z pliku, z localStorage — przechodzi przez
   reviver, który wycina klucze „__proto__", „constructor" i „prototype".
   Object.assign w adopt() ustawia własności przez [[Set]], więc klucz
   „__proto__" z JSON.parse podmieniłby prototyp stanu. Skutek byłby
   lokalny (jedna karta przeglądarki, zero serwera), ale nie ma powodu,
   żeby link od kogoś mógł w ogóle tego dotknąć. */
/* Porównanie łańcuchów, nie obiekt-lista: w literale `{ __proto__: 1 }`
   klucz „__proto__" NIE staje się własną własnością, tylko odpala setter
   prototypu — czyli lista niebezpiecznych kluczy po cichu gubiłaby ten
   jeden, o który najbardziej chodzi. Ta sama pułapka, przed którą to
   broni. */
function isUnsafeKey(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype'; }
function safeParse(str) {
  return JSON.parse(str, function (k, v) { return isUnsafeKey(k) ? undefined : v; });
}

function b64enc(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64dec(str) {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(b, c => c.charCodeAt(0));
  return safeParse(new TextDecoder().decode(bytes));
}

function persist() {
  try { localStorage.setItem(LS_LAST, JSON.stringify(S)); } catch (e) { /* tryb prywatny */ }
}
function loadPresets() {
  try { return safeParse(localStorage.getItem(LS_PRESETS) || '{}'); } catch (e) { return {}; }
}
function savePresets(p) {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(p)); } catch (e) { toast('Brak dostępu do pamięci przeglądarki'); }
}
function refreshPresetList() {
  const p = loadPresets();
  const sel = $('#preset-sel');
  const names = Object.keys(p).sort();
  sel.innerHTML = '<option value="">— wybierz zapis —</option>' +
    names.map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
}

/* Zapisy sprzed rozbicia tomów na cztery kotły trzymały samą liczbę
   (0/2/3), a roomy jako true/false. Przeliczamy je na nowy kształt,
   żeby stary link nie wywrócił strony ani nie zgubił perkusji. */
function migrateSrc(src) {
  if (!src) return {};
  const out = {};
  if (typeof src.toms === 'number') {
    out.toms = { t1: src.toms >= 2, t2: src.toms >= 3, f1: src.toms >= 2, f2: false };
  } else if (src.toms && typeof src.toms === 'object') {
    out.toms = { t1: !!src.toms.t1, t2: !!src.toms.t2, f1: !!src.toms.f1, f2: !!src.toms.f2 };
  }
  if (typeof src.room === 'boolean') out.room = src.room ? 'mono' : 'none';
  /* Stara liczba wokali dobierała mikrofony od lidera w dół; czwarty
     nazywał się wtedy „VOX 4" i był po prostu basistą bez nazwiska. */
  if (typeof src.vox === 'number') {
    out.vox = { lead: src.vox >= 1, rhy: src.vox >= 2, drums: src.vox >= 3, bass: src.vox >= 4 };
  } else if (src.vox && typeof src.vox === 'object') {
    out.vox = { drums: !!src.vox.drums, bass: !!src.vox.bass, rhy: !!src.vox.rhy, lead: !!src.vox.lead };
  }
  return out;
}

/* Zapisy sprzed dodania odczepów trzymały w p16 same id źródeł.
   Bez tej migracji taki link albo preset wywracał render. */
function migrateP16(arr) {
  if (!Array.isArray(arr) || arr.length !== 16) return null;
  return arr.map(x => {
    if (x && typeof x === 'object') {
      return { src: x.src || null, tap: x.tap || DEFAULT_TAP };
    }
    return { src: x || null, tap: DEFAULT_TAP };
  });
}

/* Wyeksportowany JSON opisuje ZAMIAR, nie stan interfejsu, więc nie da
   się go po prostu wczytać — trzeba go złożyć z powrotem. Sloty P16
   trzymają tokeny pulpitu (Ch07, Bus1), a te znaczą co innego przy innej
   liście kanałów, więc najpierw odtwarzamy listę, a dopiero potem
   dopasowujemy do niej tokeny. */
function stateFromExport(j) {
  if (j && j.src && j.target) return j;          // surowy stan (stary preset)
  if (!j || !j.selection) throw new Error('To nie jest plik z tego konfiguratora');

  const st = defaultState();
  st.gig = Object.assign(st.gig, j.gig || {});
  st.target = (j.console && j.console.target) || st.target;
  st.src = Object.assign(st.src, j.selection, migrateSrc(j.selection));

  if (j.console && !TARGETS[st.target].locked) {
    st.cap = {
      channels:  j.console.channelSlots,
      auxReturn: j.console.auxReturnSlots,
      buses:     j.console.busSlots
    };
  }
  if (Array.isArray(j.buses) && j.buses.length) {
    st.buses = j.buses.map(b => ({ name: b.name || '', stereo: !!b.stereo, out: b.out || 'aux' }));
  }
  /* Eksport zapisuje p16Monitor tylko wtedy, gdy jest włączony, i nie
     niesie pola „on" — więc sama obecność wpisu znaczy „włączony".
     Bez tego wczytany plik gubił odsłuch P16 i kartka szła bez niego. */
  if (j.p16Monitor) st.p16Monitor = Object.assign(st.p16Monitor, j.p16Monitor, { on: true });

  /* Typy połączeń i mikrofony wracają jako NADPISANIA — ale tylko tam,
     gdzie plik różni się od domyślnego dla tego źródła. Gdyby wpisywać
     wszystko, plik z wczoraj zamrażałby wczorajsze domyślne (gitary
     „line") na zawsze, mimo że kod już wie lepiej. */
  const defs = {};
  buildSources(st.src).forEach(x => { defs[x.id] = x; });
  (j.channels || []).forEach(c => {
    if (!c || !c.id) return;
    const row = defs[c.id];
    if (c.connRef && c.conn && CONN_PICK.indexOf(c.conn) !== -1 && (!row || c.conn !== row.conn)) st.conn[c.connRef] = c.conn;
    if (typeof c.mic === 'string' && (!row || c.mic !== micDefault(row))) st.mics[c.id] = c.mic;
    const mnt = mountNorm(c.mount);
    if (typeof mnt === 'string' && MOUNTS[mnt] && (!row || mnt !== mountDefault(row))) st.mounts[c.id] = mnt;
  });
  /* Zasilanie: wracają tylko wiersze ręczne — te z boksów kod liczy sam. */
  if (j.stagePlot) {
    (j.stagePlot.stations || []).forEach(x => { if (x && x.id && STAGE_SLOTS[x.slot]) st.plot.stations[x.id] = x.slot; });
    const bs = (j.stagePlot.boxes || []).map(x => x && BOX_SLOTS[x.slot] ? x.slot : null).filter(Boolean);
    if (bs.length) st.plot.boxes = bs;
  }
  if (j.power && Array.isArray(j.power.rows)) {
    st.power = j.power.rows.filter(r => r && !r.derived).map(r => ({ station: r.station || '', items: r.items || '', n: parseInt(r.sockets, 10) || 0, place: r.place === 'foh' ? 'foh' : 'stage' }));
    st.powerV = 2;
  }

  /* Scena: boksy po modelu, patch po ref/busIndex. Litera boksu z
     eksportu wraca na indeks; nieznana litera daje -1 i wypada przy
     porządkach w render(). */
  if (j.console && j.console.variant) st.variant = j.console.variant;
  /* Węzły: stageboxy wracają do stage.boxes, a węzeł lokalny tylko
     włącza gniazda konsolety — jego pojemności biorą się z odmiany
     konsolety, nie z pliku (inaczej stary plik narzucałby 8 preampów
     WING-owi COMPACT). Wyjątek: konsoleta spoza katalogu, gdzie nie
     ma skąd ich wziąć. */
  const nodes = j.stage && Array.isArray(j.stage.nodes) ? j.stage.nodes : null;
  if (nodes) {
    st.stage.boxes = nodes.filter(n => !n.local).slice(0, SB_LETTERS.length).map(b => {
      const o = { model: STAGEBOXES[b.model] ? b.model : 'other', port: b.aes50Port || 'A', pos: b.position || '',
                  exp: b.adatConverters || 0 };
      if (o.model === 'other') { o.ins = b.inputsXlr; o.outs = b.outputs; }
      return o;
    });
    const loc = nodes.find(n => n.local);
    st.stage.useLocal = !!loc;
    if (loc && !CONSOLE_VARIANTS[TARGETS[st.target].variants]) {
      st.localCap = { ins: loc.inputsXlr || 0, outs: loc.outputs || 0 };
    }
    st.stage.patch = {};
    (j.stage.inputs || []).forEach(x => {
      if (x.box && x.jack && x.ref) st.stage.patch['in:' + x.ref] = { box: x.box, n: x.jack, k: x.jackKind === 'auxin' ? 'auxin' : 'in' };
    });
    (j.stage.monitorOuts || []).forEach(x => {
      if (x.box && x.jacks && x.jacks.length) st.stage.patch['out:bus_' + x.busIndex] = { box: x.box, n: x.jacks[0], k: x.jackKind === 'expout' ? 'expout' : 'out' };
    });
    (j.stage.ultranet || []).forEach(x => {
      if (x.box) st.stage.patch['un:' + (x.busIndex == null ? 'p16' : 'bus_' + x.busIndex)] = { box: x.box, k: 'un' };
    });
    st.stage.auto = false;
  }

  const L = layout(st), B = layoutBuses(st);
  const avail = p16Sources(L, B);
  st.p16 = emptyP16();
  (j.p16 || []).forEach((x, i) => {
    if (i > 15 || !x || !x.source) return;
    const a = avail.find(v => v.osc === x.source);
    st.p16[i] = { src: a ? a.id : null, tap: x.tap || DEFAULT_TAP };
  });
  st.p16Auto = false;
  return st;
}

/* Scalanie wczytanego stanu z domyślnym: stary zapis bez nowego
   pola nie może wywrócić strony. */
function adopt(obj) {
  const d = defaultState();
  /* Zapisy sprzed stageboxów nie mają pola stage — dostają puste.
     Zapis z uszkodzonym kształtem (boxes nie-tablica) też. */
  const stage = Object.assign(d.stage, obj.stage || {});
  if (!Array.isArray(stage.boxes)) stage.boxes = [];
  if (!stage.patch || typeof stage.patch !== 'object') stage.patch = {};
  if (typeof stage.useLocal !== 'boolean') stage.useLocal = true;
  /* Zapisy z wersji sprzed węzłów trzymały w patchu indeks boksu (0/1).
     Teraz box to id ('A', 'B', 'LCL'), więc liczby trzeba przełożyć —
     inaczej cały patch wyparowałby przy porządkach. */
  Object.keys(stage.patch).forEach(k => {
    const v = stage.patch[k];
    if (v === null) return;
    if (!v || typeof v !== 'object') { delete stage.patch[k]; return; }
    if (typeof v.box === 'number') v.box = SB_LETTERS[v.box] || SB_LETTERS[0];
    if (!v.k) v.k = k.split(':')[0] === 'out' ? 'out' : (k.split(':')[0] === 'un' ? 'un' : 'in');
  });
  S = Object.assign(d, obj, {
    gig: Object.assign(d.gig, obj.gig || {}),
    src: Object.assign(d.src, obj.src || {}, migrateSrc(obj.src)),
    buses: Array.isArray(obj.buses) && obj.buses.length ? obj.buses : d.buses,
    p16: migrateP16(obj.p16) || d.p16,
    links: obj.links || {},
    stage,
    variant: obj.variant || d.variant,
    conn: obj.conn && typeof obj.conn === 'object' ? obj.conn : {},
    mics: obj.mics && typeof obj.mics === 'object' ? obj.mics : {},
    mounts: obj.mounts && typeof obj.mounts === 'object' ? obj.mounts : {},
    printPlot: typeof obj.printPlot === 'boolean' ? obj.printPlot : true,
    plot: {
      stations: Object.assign({}, d.plot.stations, (obj.plot && obj.plot.stations) || {}),
      boxes: Array.isArray(obj.plot && obj.plot.boxes) ? obj.plot.boxes : d.plot.boxes
    },
    /* Pusta tablica to decyzja („nic nie wpisuj"); brak pola to stary zapis. */
    power: Array.isArray(obj.power) ? obj.power : d.power,
    powerV: obj.powerV || 0
  });
  /* Zapisy sprzed FOH-u: wiersze bez miejsca są ze sceny, a komputer
     na FOH-u dochodzi raz — potem to już decyzja człowieka. */
  if (S.powerV < 2) {
    S.power = S.power.filter(r => r && typeof r === 'object');
    S.power.forEach(r => { if (r.place !== 'foh') r.place = 'stage'; });
    /* Świeży defaultState(), nie „d": d to już S po scaleniu, więc jego
       power jest tablicą użytkownika — bez wiersza FOH, a find dałby
       undefined i render by padł. */
    const fohRow = defaultState().power.find(r => r.place === 'foh');
    if (fohRow && !S.power.some(r => r.place === 'foh')) S.power.push(fohRow);
    S.powerV = 2;
  }
}

function setBoxCount(k) {
  const b = S.stage.boxes;
  if (k > 0 && !TARGETS[S.target].aes50) return;
  while (b.length > k) b.pop();
  /* Drugi boks domyślnie na osobnym gnieździe AES50 — Wing ma trzy,
     a dwa kable to prostsza diagnostyka niż łańcuch. */
  while (b.length < k) b.push({ model: 'sd16', port: AES50_PORTS[b.length] || 'A', pos: '' });
  S.stage.auto = true;
}

/* ------------------------------------------------------------
   11. SYNCHRONIZACJA KONTROLEK
   ------------------------------------------------------------ */
function syncControls() {
  $$('[data-src]').forEach(el => {
    const key = el.dataset.src, val = S.src[key];
    if (BOOL_KEYS.indexOf(key) !== -1) {
      el.checked = el.type === 'checkbox' ? !!val : (!!val === (el.value !== ''));
    } else if (el.type === 'radio') {
      el.checked = String(val) === el.value;
    } else {
      el.value = val;
    }
  });
  $$('[data-tom]').forEach(el => { el.checked = !!S.src.toms[el.dataset.tom]; });
  $('#tom-count').textContent = ['t1', 't2', 'f1', 'f2'].filter(k => S.src.toms[k]).length;
  $$('[data-vox]').forEach(el => { el.checked = !!S.src.vox[el.dataset.vox]; });
  $('#vox-count').textContent = VOX_MICS.filter(v => S.src.vox[v.k]).length;
  $('#gig-name').value = S.gig.name || '';
  $('#gig-date').value = S.gig.date || '';
  $('#gig-console').value = S.gig.console || '';
  $$('[name="target"]').forEach(el => el.checked = el.value === S.target);
  const vs = CONSOLE_VARIANTS[TARGETS[S.target].variants];
  $('#variant-wrap').hidden = !vs;
  if (vs) {
    $('#variant-seg').innerHTML = Object.keys(vs).map(k =>
      '<input type="radio" name="variant" id="var-' + k + '" value="' + k + '"' + (k === S.variant ? ' checked' : '') + '>' +
      '<label for="var-' + k + '">' + esc(vs[k].label) + '</label>').join('');
  }
  $('#align').checked = S.alignPairs;
  $('#align-wrap').hidden = !capacity(S).linksAdjacent;
  /* Zasada „para zaczyna się na nieparzystym" to /config/buslink na
     XR18 — na Wingu instrukcja (sekcja 2.6) wprost dopuszcza start na
     parzystym, więc tekst byłby tam nieprawdą, nie tylko zbędny. */
  $('#buslink-note').hidden = !capacity(S).linksAdjacent;
  $('#p16mon-on').checked = S.p16Monitor.on;
  $('#p16mon-name').value = S.p16Monitor.name || '';
  $('#p16mon-stereo').value = S.p16Monitor.stereo ? 'stereo' : 'mono';
  $('#p16mon-fields').hidden = !S.p16Monitor.on;
  $('#print-p16').checked = S.printP16;
  $('#print-empty-nodes').checked = S.printEmptyNodes;
  $('#print-empty-jacks').checked = S.printEmptyJacks;
  $('#print-plot').checked = S.printPlot;

  const t = TARGETS[S.target], cap = capacity(S);
  $('#cap-fields').hidden = t.locked;
  $('#cap-ch').value = cap.channels;
  $('#cap-aux').value = cap.auxReturn;
  $('#cap-bus').value = cap.buses;
  $('#p16-auto-note').hidden = !S.p16Auto;

  renderAuxOpts();
  $('#aux-hint').hidden = S.target !== 'xr18';
}

function renderAuxOpts() {
  $('#aux-list').innerHTML = S.src.aux.map((a, i) =>
    '<div class="bus-row" style="grid-template-columns:3.5rem 1fr 9rem 2.5rem">' +
    '<span class="bus-slots">+' + (i + 1) + '</span>' +
    '<input type="text" data-aux-name="' + i + '" value="' + esc(a.name || '') + '" placeholder="np. KEYS, TALKBACK">' +
    '<select data-aux-stereo="' + i + '">' +
      '<option value="mono"' + (a.stereo ? '' : ' selected') + '>mono</option>' +
      '<option value="stereo"' + (a.stereo ? ' selected' : '') + '>stereo</option></select>' +
    '<button type="button" class="btn danger" data-aux-del="' + i + '">×</button></div>').join('');
}

/* ------------------------------------------------------------
   12. ZDARZENIA
   Jedna delegacja na dokument zamiast setki listenerów —
   tabela i sloty przebudowują się przy każdej zmianie, więc
   listenery przypięte do elementów i tak by ginęły.
   ------------------------------------------------------------ */
function onInput(e) {
  const el = e.target;
  const d = el.dataset;

  if (d.src !== undefined) {
    const key = d.src;
    let v;
    if (BOOL_KEYS.indexOf(key) !== -1) {
      v = el.type === 'checkbox' ? el.checked : el.value !== '';
    } else {
      v = el.value;
      if (/^-?\d+$/.test(v)) v = parseInt(v, 10);
    }
    S.src[key] = v;
    if (key === 'click' || key === 'tape' || key === 'clickOnAux' || key === 'tapeOnAux') S.p16Auto = true;
    S.links = {};                 // zmiana źródeł przenumerowuje kanały
    return render();
  }
  if (d.tom !== undefined) {
    S.src.toms[d.tom] = el.checked;
    S.links = {}; S.p16Auto = true;
    return render();
  }
  if (d.vox !== undefined) {
    S.src.vox[d.vox] = el.checked;
    S.links = {}; S.p16Auto = true;
    return render();
  }
  if (el.name === 'target')  { S.target = el.value; S.cap = null; S.p16Auto = true; return render(); }
  if (el.id === 'align')     { S.alignPairs = el.checked; S.links = {}; return render(); }
  if (el.id === 'p16mon-on')     { S.p16Monitor.on = el.checked; return render(); }
  if (el.id === 'p16mon-name')   { S.p16Monitor.name = el.value; return render(); }
  if (el.id === 'p16mon-stereo') { S.p16Monitor.stereo = el.value === 'stereo'; return render(); }
  if (el.id === 'print-p16')         { S.printP16 = el.checked; return render(); }
  if (el.id === 'print-empty-nodes') { S.printEmptyNodes = el.checked; return render(); }
  if (el.id === 'print-empty-jacks') { S.printEmptyJacks = el.checked; return render(); }
  if (el.id === 'file-input')    { return loadFromFile(el); }
  if (el.id === 'gig-name')  { S.gig.name = el.value; return persist(); }
  if (el.id === 'gig-date')  { S.gig.date = el.value; return persist(); }
  if (el.id === 'gig-console'){ S.gig.console = el.value; return persist(); }
  if (el.id === 'cap-ch' || el.id === 'cap-aux' || el.id === 'cap-bus') {
    S.cap = S.cap || {};
    S.cap.channels  = parseInt($('#cap-ch').value, 10)  || TARGETS[S.target].channels;
    S.cap.auxReturn = parseInt($('#cap-aux').value, 10) || TARGETS[S.target].auxReturn;
    S.cap.buses     = parseInt($('#cap-bus').value, 10) || TARGETS[S.target].buses;
    return render();
  }
  if (d.link !== undefined)  { S.links[d.link] = el.checked; return render(); }
  if (d.p16 !== undefined) {
    S.p16Auto = false;
    const slot = S.p16[+d.p16];
    slot.src = el.value || null;
    if (slot.src && !slot.tap) slot.tap = S.p16Tap || DEFAULT_TAP;
    return render();
  }
  if (d.p16tap !== undefined) { S.p16Auto = false; S.p16[+d.p16tap].tap = el.value; return render(); }
  if (el.id === 'p16-tap-all') {
    /* Zmiana odczepu hurtem dotyka tylko slotów, które coś niosą —
       pustym nie ma czego ustawiać. */
    S.p16Tap = el.value;
    S.p16.forEach(sl => { if (sl.src) sl.tap = el.value; });
    return render();
  }
  if (d.busName !== undefined)   { S.buses[+d.busName].name = el.value; return persist(); }
  if (d.busStereo !== undefined) { S.buses[+d.busStereo].stereo = el.value === 'stereo'; return render(); }
  if (d.busOut !== undefined)    { S.buses[+d.busOut].out = el.value; return render(); }
  if (d.auxName !== undefined)   { S.src.aux[+d.auxName].name = el.value; return render(); }
  if (d.auxStereo !== undefined) { S.src.aux[+d.auxStereo].stereo = el.value === 'stereo'; S.links = {}; return render(); }

  /* --- scena --- */
  if (el.name === 'sbcount') { setBoxCount(+el.value); return render(); }
  if (d.sbModel !== undefined) {
    const b = S.stage.boxes[+d.sbModel];
    b.model = el.value;
    if (!STAGEBOXES[b.model].custom) { delete b.ins; delete b.outs; }
    return render();
  }
  if (d.sbPort !== undefined) { S.stage.boxes[+d.sbPort].port = el.value; return render(); }
  if (d.sbExp !== undefined) { S.stage.boxes[+d.sbExp].exp = parseInt(el.value, 10) || 0; return render(); }
  /* Opis miejsca pokazuje się w nagłówku karty — przerysowujemy na
     'change' (po wyjściu z pola), a w trakcie pisania tylko zapisujemy. */
  if (d.sbPos !== undefined)  { S.stage.boxes[+d.sbPos].pos = el.value; return e.type === 'change' ? render() : persist(); }
  if (d.sbIns !== undefined || d.sbOuts !== undefined) {
    const b = S.stage.boxes[+(d.sbIns !== undefined ? d.sbIns : d.sbOuts)];
    const v = parseInt(el.value, 10);
    b[d.sbIns !== undefined ? 'ins' : 'outs'] = isNaN(v) ? undefined : v;
    return render();
  }
  /* Ręczne przepięcie na inny boks: numer gniazda dobiera się sam —
     najniższy wolny. To pozwala przenieść całą perkusję na boks B
     klikając tylko literę, bez wybierania numerów. */
  if (d.sbBox !== undefined) {
    S.stage.auto = false;
    const key = d.sbBox, kind = key.split(':')[0];
    /* null, nie delete: „nie wpinaj" to decyzja, którą domykanie luk
       ma uszanować. Brak klucza znaczy „jeszcze nikt nie zdecydował". */
    if (el.value === '') { S.stage.patch[key] = null; return render(); }
    const box = el.value;
    if (kind === 'un') { S.stage.patch[key] = { box, k: 'un' }; return render(); }
    const L = layout(S), B = layoutBuses(S), G = layoutStage(S, L, B);
    const need = kind === 'out' ? (G.N.outs.find(r => r.key === key) || { need: 1 }).need : 1;
    /* Wejście szuka najpierw XLR-a, a dopiero potem Aux In — i tylko
       wtedy, gdy źródło jest liniowe. */
    const wanted = kind === 'out' ? ['out', 'expout'] : ['in', 'auxin'];
    const src = G.N.ins.find(r => r.key === key);
    let picked = null;
    for (let i = 0; i < wanted.length && !picked; i++) {
      const jk = wanted[i];
      if (jk === 'auxin' && src && src.conn !== 'line') continue;
      const n = firstFree(G, box, jk, need, key);
      if (n !== null) picked = { box, n, k: jk };
    }
    if (!picked) { toast(box + ': brak wolnego gniazda'); return render(); }
    S.stage.patch[key] = picked;
    return render();
  }
  if (d.sbN !== undefined) {
    S.stage.auto = false;
    const p = S.stage.patch[d.sbN];
    /* Wartość niesie rodzaj i numer razem: 'auxin:3'. */
    const parts = String(el.value).split(':');
    if (p && parts.length === 2) { p.k = parts[0]; p.n = parseInt(parts[1], 10) || 1; }
    return render();
  }
  if (el.name === 'variant') { S.variant = el.value; return render(); }
  if (el.id === 'use-local') { S.stage.useLocal = el.checked; S.stage.auto = true; return render(); }
  /* Preferencja ekranu, nie stanu: zapis od razu, bez przechodzenia
     przez render() → persist() dla S. */
  if (el.id === 'print-plot') { S.printPlot = el.checked; return render(); }
  if (d.plotSt !== undefined)  { S.plot.stations[d.plotSt] = el.value; return render(); }
  if (d.plotBox !== undefined) { S.plot.boxes[+d.plotBox] = el.value; return render(); }
  if (el.id === 'show-empty-jacks') { UI.showEmptyJacks = el.checked; saveUI(); return render(); }
  if (el.id === 'show-empty-nodes') { UI.showEmptyNodes = el.checked; saveUI(); return render(); }
  if (el.id === 'loc-ins' || el.id === 'loc-outs') {
    S.localCap = S.localCap || {};
    S.localCap.ins  = parseInt($('#loc-ins').value, 10)  || 0;
    S.localCap.outs = parseInt($('#loc-outs').value, 10) || 0;
    return render();
  }
  if (d.conn !== undefined) { S.conn[d.conn] = el.value; return render(); }
  /* Model mikrofonu: w trakcie pisania tylko zapis, przerysowanie po
     wyjściu z pola — lista do spakowania i karty nie muszą migać przy
     każdej literze. */
  if (d.mic !== undefined) { S.mics[d.mic] = el.value; return e.type === 'change' ? render() : persist(); }
  if (d.mount !== undefined) { S.mounts[d.mount] = el.value; return render(); }
  if (d.pwN !== undefined)       { S.power[+d.pwN].n = parseInt(el.value, 10) || 0; return render(); }
  if (d.pwStation !== undefined) { S.power[+d.pwStation].station = el.value; return e.type === 'change' ? render() : persist(); }
  if (d.pwItems !== undefined)   { S.power[+d.pwItems].items = el.value; return e.type === 'change' ? render() : persist(); }
  if (d.pwPlace !== undefined)   { S.power[+d.pwPlace].place = el.value === 'foh' ? 'foh' : 'stage'; return render(); }
}

function onClick(e) {
  /* Tytuł panelu zwija i rozwija — sprawdzany PRZED przyciskami, bo
     sam przyciskiem nie jest. */
  const title = e.target.closest('.panel[data-panel] > .panel-title');
  if (title) {
    const sec = title.parentElement;
    setCollapsed(sec.dataset.panel, !sec.classList.contains('collapsed'));
    return;
  }
  const el = e.target.closest('button, [data-act]');
  if (!el) return;
  const d = el.dataset;

  if (d.busDel !== undefined) { S.buses.splice(+d.busDel, 1); return render(); }
  if (d.pwDel !== undefined)  { S.power.splice(+d.pwDel, 1); return render(); }
  if (d.auxDel !== undefined) { S.src.aux.splice(+d.auxDel, 1); S.links = {}; S.p16Auto = true; return render(); }

  switch (d.act) {
    case 'bus-add':
      S.buses.push({ name: 'Bus ' + (S.buses.length + 1), stereo: true, out: 'aux' });
      return render();
    case 'aux-add':
      S.src.aux.push({ name: '', stereo: false }); S.links = {}; S.p16Auto = true;
      return render();
    case 'p16-auto':
      S.p16Auto = true; return render();
    case 'p16-clear':
      S.p16Auto = false; S.p16 = emptyP16(); return render();
    case 'stage-auto':
      S.stage.auto = true; return render();
    case 'collapse-all': return setCollapsedAll(true);
    case 'expand-all':   return setCollapsedAll(false);
    case 'show-empty-nodes-now':
      UI.showEmptyNodes = true; saveUI(); return render();
    /* Zestaw, którym realnie dysponujemy na ten koncert. Opisany
       sprzętem, nie właścicielem — strona jest publiczna, a i tak
       liczy się to, co stoi na scenie. */
    case 'rig-wing':
      S.target = 'wing'; S.variant = 'compact'; S.cap = null;
      S.stage.boxes = [
        { model: 'dl16', port: 'A', pos: '', exp: 1 },
        { model: 'dl32', port: 'B', pos: '', exp: 0 }
      ];
      S.stage.useLocal = true; S.stage.auto = true; S.p16Auto = true;
      toast('Wczytany zestaw: WING COMPACT + DL16 + DL32');
      return render();
    case 'pw-add':
      S.power.push({ station: '', items: '', n: 1, place: 'stage' }); return render();
    case 'stage-clear':
      S.stage.auto = false; S.stage.patch = {}; return render();
    case 'export-json': exportMode = 'json'; markExport(); return render();
    case 'export-text': exportMode = 'text'; markExport(); return render();
    case 'copy':
      navigator.clipboard.writeText($('#export-out').value)
        .then(() => toast('Skopiowane')).catch(() => toast('Zaznacz i skopiuj ręcznie'));
      return;
    case 'download': {
      const name = (S.gig.name || 'input-list').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const ext = exportMode === 'json' ? 'json' : 'txt';
      const blob = new Blob([$('#export-out').value],
        { type: exportMode === 'json' ? 'application/json' : 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '.' + ext;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    case 'link': {
      const base = location.origin && location.origin !== 'null'
        ? location.origin + location.pathname
        : location.href.split('#')[0];
      const url = base + '#k=' + b64enc(S);
      navigator.clipboard.writeText(url).then(() => toast('Link skopiowany')).catch(() => {
        location.hash = 'k=' + b64enc(S); toast('Link w pasku adresu');
      });
      location.hash = 'k=' + b64enc(S);
      return;
    }
    case 'preset-save': {
      const name = ($('#preset-name').value || S.gig.name || '').trim();
      if (!name) return toast('Nazwij zapis');
      const p = loadPresets(); p[name] = S; savePresets(p);
      refreshPresetList(); $('#preset-sel').value = name;
      return toast('Zapisane');
    }
    case 'preset-load': {
      const name = $('#preset-sel').value;
      if (!name) return toast('Wybierz zapis');
      const p = loadPresets();
      if (!p[name]) return toast('Nie ma takiego zapisu');
      adopt(p[name]); $('#preset-name').value = name;
      return render();
    }
    case 'preset-del': {
      const name = $('#preset-sel').value;
      if (!name) return toast('Wybierz zapis');
      const p = loadPresets(); delete p[name]; savePresets(p);
      refreshPresetList(); return toast('Usunięte');
    }
    case 'reset':
      S = defaultState(); location.hash = '';
      return render();
    case 'print':
      return window.print();
    case 'open-file':
      return $('#file-input').click();
  }
}

function markExport() {
  $$('[data-act^="export-"]').forEach(b =>
    b.classList.toggle('on', b.dataset.act === 'export-' + exportMode));
}

/* Plik jest jedynym zapisem, który przeżyje wyczyszczenie danych strony,
   przesiadkę na inny komputer i inną przeglądarkę. Bez tej funkcji eksport
   JSON był ślepą uliczką: dało się go pobrać, ale nie dało wczytać. */
function loadFromFile(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    let data;
    try {
      data = safeParse(rd.result);
    } catch (e) {
      /* Surowy komunikat parsera („Unexpected token 'o'…") nic tu nie mówi. */
      input.value = '';
      return toast(f.name + ' to nie jest plik JSON');
    }
    try {
      adopt(stateFromExport(data));
      render();
      toast('Wczytano ' + f.name);
    } catch (e) {
      toast(e.message);
    }
    input.value = '';   // ten sam plik musi dać się wczytać drugi raz
  };
  rd.onerror = () => { toast('Nie udało się odczytać pliku'); input.value = ''; };
  rd.readAsText(f);
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

/* ------------------------------------------------------------
   13. START
   ------------------------------------------------------------ */
function boot() {
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  document.addEventListener('click', onClick);
  /* Tytuł panelu z klawiatury: Enter albo spacja, jak przycisk. */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const title = e.target.closest && e.target.closest('.panel[data-panel] > .panel-title');
    if (!title) return;
    e.preventDefault();
    const sec = title.parentElement;
    setCollapsed(sec.dataset.panel, !sec.classList.contains('collapsed'));
  });
  loadUI();
  applyCollapse();

  if (location.hash.startsWith('#k=')) {
    try { adopt(b64dec(location.hash.slice(3))); }
    catch (e) { toast('Nie udało się odczytać linku'); }
  } else {
    try {
      const last = localStorage.getItem(LS_LAST);
      if (last) adopt(safeParse(last));
    } catch (e) { /* zostaje domyślny */ }
  }

  refreshPresetList();
  markExport();
  render();
}

document.addEventListener('DOMContentLoaded', boot);
