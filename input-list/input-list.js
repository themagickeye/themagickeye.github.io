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
const TARGETS = {
  xr18: { label: 'Behringer XR18', channels: 16, auxReturn: 2, buses: 6,
          locked: true,  verified: true,  linksAdjacent: true  },
  /* locked, bo liczby pochodzą z instrukcji, nie z pamięci — inaczej
     starszy zapis (z błędnym 48) nadpisywałby je przy wczytaniu pliku. */
  wing: { label: 'Behringer Wing', channels: 40, auxReturn: 8, buses: 16,
          locked: true,  verified: true,  linksAdjacent: false },
  other:{ label: 'Inna konsola',   channels: 32, auxReturn: 2, buses: 8,
          locked: false, verified: false, linksAdjacent: true  }
};

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
    cap: null,                 // nadpisanie pojemności dla konsol nie-XR18
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
    p16: emptyP16(),                 // [{ src: id|null, tap }]
    p16Tap: DEFAULT_TAP,             // odczep nadawany nowym przypisaniom
    p16Auto: true
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
  const add = (id, name, group, opt) => out.push(Object.assign(
    { id, name, group, kind: 'in', side: null, pair: null }, opt || {}));

  /* --- perkusja --- */
  add('kick_in', src.kick === 2 ? 'KICK IN' : 'KICK', 'perkusja');
  if (src.kick === 2) add('kick_out', 'KICK OUT', 'perkusja');

  add('snare_t', src.snare === 2 ? 'SNARE T' : 'SNARE', 'perkusja');
  if (src.snare === 2) add('snare_b', 'SNARE B', 'perkusja');

  if (src.hihat) add('hihat', 'HI-HAT', 'perkusja');

  /* Floor dostaje numer dopiero, gdy grają oba — przy jednym zostaje
     samo „FLOOR", tak jak na kartce, do której wszyscy przywykli. */
  const t = src.toms;
  const bothFloors = t.f1 && t.f2;
  if (t.t1) add('tom1', 'TOM 1', 'perkusja');
  if (t.t2) add('tom2', 'TOM 2', 'perkusja');
  if (t.f1) add('floor1', bothFloors ? 'FLOOR 1' : 'FLOOR', 'perkusja');
  if (t.f2) add('floor2', bothFloors ? 'FLOOR 2' : 'FLOOR', 'perkusja');

  if (src.oh === 'mono')   add('oh', 'OH', 'perkusja');
  if (src.oh === 'stereo') addPair(out, 'oh', 'OH', 'perkusja');

  if (src.room === 'mono')   add('room', 'ROOM', 'perkusja');
  if (src.room === 'stereo') addPair(out, 'room', 'ROOM', 'perkusja');

  /* Pad wchodzi liniowo, nie mikrofonem, ale na liście siedzi przy
     perkusji — tam go realizator szuka. */
  if (src.spd === 'mono')   add('spd', 'SPD-SX', 'perkusja');
  if (src.spd === 'stereo') addPair(out, 'spd', 'SPD-SX', 'perkusja');

  /* --- bas --- */
  if (src.bass === 'di'  || src.bass === 'both') add('bass_di',  'BASS DI',  'bas');
  if (src.bass === 'mic' || src.bass === 'both') add('bass_amp', 'BASS AMP', 'bas');

  /* --- gitary --- */
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
    if (a.stereo) addPair(out, 'auxch_' + i, nm, 'dodatkowe');
    else add('auxch_' + i, nm, 'dodatkowe');
  });

  return out;
}

function addPair(arr, id, name, group, opt) {
  const base = Object.assign({ kind: 'in' }, opt || {});
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
   7. OSTRZEŻENIA
   ------------------------------------------------------------ */
function warnings(state, L, B) {
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
      'Poza listą zostaje: ' + over.join(', ') + '.' });
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
      w.push({ lvl: 'err', html: '<b>' + r.name.replace(/ L$/, '') + '</b>: para stereo wypada na ' +
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
  const keys = ['busName', 'auxName', 'link', 'p16', 'busStereo', 'busOut', 'auxStereo'];
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

  renderMeters(L, B);
  renderChannels(L);
  renderAuxReturn(L);
  renderBuses(B);
  renderP16(L, B);
  renderWarnings(warnings(S, L, B));
  renderPrintSheet(L, B);
  renderExport(L, B);
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

function renderChannels(L) {
  const body = $('#chlist-body');
  body.innerHTML = L.rows.map(r => {
    if (r.spacer) {
      return '<tr class="spacer"><td class="ch-num">' + pad(r.n) + '</td>' +
        '<td class="ch-name">— wolne —</td><td class="ch-grp"></td><td class="ch-src"></td>' +
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
       Pokazanie numeru sugerowałoby, że gdzieś się wepnie. */
    const srcTxt = r.over ? '—' : (r.kind === 'usb' ? 'USB U' + pad(r.n) : 'In' + pad(r.n));
    const note = [];
    if (!L.cap.linksAdjacent && r.side === 'L') note.push('stereo z ' + pad(r.n + 1));
    if (r.noMain) note.push('poza Main LR');
    if (r.over) note.push('POZA POJEMNOŚCIĄ');
    return '<tr class="' + cls + '">' +
      '<td class="ch-num">' + pad(r.n) + '</td>' +
      '<td class="ch-name">' + esc(r.name) + '</td>' +
      '<td class="ch-grp">' + esc(r.group) + '</td>' +
      '<td class="ch-src ' + (r.kind === 'usb' ? 'usb' : '') + '">' + srcTxt + '</td>' +
      '<td class="ch-link">' + link + '</td>' +
      '<td class="ch-grp">' + note.join(' · ') + '</td></tr>';
  }).join('');
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
   8b. ARKUSZ DO DRUKU
   Osobny, minimalny render tych samych danych. Próba doprowadzenia
   ekranowego interfejsu do druku samym CSS-em zawsze kończy się
   walką z <select>ami, checkboxami i paskami tytułów — a na kartce
   nie są one do niczego potrzebne. Tu nie ma czego ukrywać, bo
   niczego zbędnego nie ma od początku.
   ------------------------------------------------------------ */
function renderPrintSheet(L, B) {
  const meta = [S.gig.name, S.gig.date, S.gig.console ? 'Konsoleta: ' + S.gig.console : '']
    .filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');

  const chRows = L.rows.map(r => {
    if (r.spacer) return '<tr><td class="ps-n">' + pad(r.n) + '</td><td colspan="3" class="ps-dim">— wolne —</td></tr>';
    const notes = [];
    if (r.side === 'L') notes.push('para ' + pad(r.n) + '-' + pad(r.n + 1));
    if (r.noMain) notes.push('poza Main LR');
    if (r.over) notes.push('PONAD POJEMNOŚĆ');
    return '<tr><td class="ps-n">' + pad(r.n) + '</td>' +
      '<td class="ps-name">' + esc(r.name) + '</td>' +
      '<td>' + (r.over ? '—' : (r.kind === 'usb' ? 'USB U' + pad(r.n) : 'In' + pad(r.n))) + '</td>' +
      '<td class="ps-note">' + notes.join(' · ') + '</td></tr>';
  }).join('');

  let html = '<h1>Lista wejściowa — The Magick Eye</h1>';
  if (meta) html += '<p class="ps-meta">' + meta + '</p>';
  html += '<table class="ps-table"><thead><tr><th>#</th><th>Nazwa</th><th>Wejście</th><th>Uwagi</th></tr></thead>' +
          '<tbody>' + chRows + '</tbody></table>';

  if (L.auxRet.length) {
    html += '<h2>Zwrot aux</h2><table class="ps-table"><tbody>' +
      L.auxRet.map((r, i) => '<tr><td class="ps-n">U' + (17 + i) + '</td>' +
        '<td class="ps-name">' + esc(r.name) + '</td><td colspan="2"></td></tr>').join('') +
      '</tbody></table>';
  }

  const buses = B.rows.filter(r => !r.spacer);
  const m = S.p16Monitor;
  if (buses.length || m.on) {
    html += '<h2>Odsłuchy</h2><table class="ps-table"><tbody>' +
      buses.map(r => '<tr><td class="ps-n">' + r.slots.map(pad).join('-') + '</td>' +
        '<td class="ps-name">' + esc(r.bus.name) + '</td>' +
        '<td>' + (r.bus.stereo ? 'stereo' : 'mono') + '</td>' +
        '<td class="ps-note">' + (r.bus.out === 'aux' ? 'Aux Out' : r.bus.out === 'ultranet' ? 'slot P16' : 'Aux Out + slot P16') +
        '</td></tr>').join('') +
      (m.on ? '<tr><td class="ps-n">P16</td>' +
        '<td class="ps-name">' + esc(m.name || 'P16') + '</td>' +
        '<td>' + (m.stereo ? 'stereo' : 'mono') + '</td>' +
        '<td class="ps-note">ULTRANET — wymaga doprowadzenia skrętki na scenę</td></tr>' : '') +
      '</tbody></table>';
  }

  if (!S.printP16) { $('#print-sheet').innerHTML = html; return; }

  const avail = p16Sources(L, B);
  if (S.p16.some(sl => avail.some(a => a.id === sl.src))) {
    html += '<h2>Odsłuch P16 / Ultranet</h2><table class="ps-table"><tbody>' +
      S.p16.map((sl, i) => {
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
function buildJSON(L, B) {
  const avail = p16Sources(L, B);
  return {
    schema: 'magickeye.input-list/1',
    generated: new Date().toISOString(),
    gig: S.gig,
    counts: { jacks: L.rows.filter(r => !r.spacer).length, channelStrips: L.strips },
    console: { target: S.target, label: L.cap.label, channelSlots: L.cap.channels,
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
          stereoPair: r.pair ? { id: r.pair, side: r.side } : null,
          linked: !!L.links[r.n % 2 === 1 ? r.n : r.n - 1],
          overCapacity: !!r.over }),
    auxReturn: L.auxRet.map((r, i) => ({ slot: 'U' + (17 + i), name: r.name,
      overCapacity: i >= L.cap.auxReturn })),
    buses: B.rows.filter(r => !r.spacer).map(r => ({
      slots: r.slots, name: r.bus.name, stereo: r.bus.stereo, out: r.bus.out,
      outVerified: r.bus.out === 'aux', overCapacity: r.over })),
    p16Monitor: S.p16Monitor.on
      ? { name: S.p16Monitor.name, stereo: S.p16Monitor.stereo, via: 'ultranet' }
      : null,
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

function buildText(L, B) {
  const pad2 = s => String(s).padEnd(12, ' ');
  const lines = [];
  lines.push('LISTA WEJŚCIOWA — THE MAGICK EYE');
  if (S.gig.name) lines.push(S.gig.name + (S.gig.date ? '  ·  ' + S.gig.date : ''));
  if (S.gig.console) lines.push('Konsoleta: ' + S.gig.console);
  lines.push('');
  L.rows.forEach(r => {
    const link = L.links[r.n % 2 === 1 ? r.n : r.n - 1] ? (r.side === 'L' ? ' \\ para' : ' / stereo') : '';
    lines.push(' ' + pad(r.n) + '  ' + pad2(r.spacer ? '—' : r.name) +
      (r.spacer ? '' : (r.kind === 'usb' ? ' (USB)' : '')) + link + (r.noMain ? '  [poza Main LR]' : ''));
  });
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
  S.p16.forEach((sl, i) => {
    const a = avail.find(x => x.id === sl.src);
    const tap = P16_TAPS.find(t => t.v === sl.tap);
    lines.push(' ' + pad(i + 1) + '  ' + (a ? String(a.label).padEnd(22, ' ') + (tap ? tap.label : '') : '—'));
  });
  return lines.join('\n');
}

let exportMode = 'json';
function renderExport(L, B) {
  $('#export-out').value = exportMode === 'json'
    ? JSON.stringify(buildJSON(L, B), null, 2)
    : buildText(L, B);
}

/* ------------------------------------------------------------
   10. TRWAŁOŚĆ: localStorage + link w adresie
   Link w adresie jest po to, żeby dało się wysłać gotową
   konfigurację realizatorowi bez żadnego serwera.
   ------------------------------------------------------------ */
const LS_LAST = 'magickeye.inputlist.last';
const LS_PRESETS = 'magickeye.inputlist.presets';

function b64enc(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64dec(str) {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(b, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function persist() {
  try { localStorage.setItem(LS_LAST, JSON.stringify(S)); } catch (e) { /* tryb prywatny */ }
}
function loadPresets() {
  try { return JSON.parse(localStorage.getItem(LS_PRESETS) || '{}'); } catch (e) { return {}; }
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
  if (j.p16Monitor) st.p16Monitor = Object.assign(st.p16Monitor, j.p16Monitor);

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
  S = Object.assign(d, obj, {
    gig: Object.assign(d.gig, obj.gig || {}),
    src: Object.assign(d.src, obj.src || {}, migrateSrc(obj.src)),
    buses: Array.isArray(obj.buses) && obj.buses.length ? obj.buses : d.buses,
    p16: migrateP16(obj.p16) || d.p16,
    links: obj.links || {}
  });
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
  $('#align').checked = S.alignPairs;
  $('#align-wrap').hidden = !capacity(S).linksAdjacent;
  $('#p16mon-on').checked = S.p16Monitor.on;
  $('#p16mon-name').value = S.p16Monitor.name || '';
  $('#p16mon-stereo').value = S.p16Monitor.stereo ? 'stereo' : 'mono';
  $('#p16mon-fields').hidden = !S.p16Monitor.on;
  $('#print-p16').checked = S.printP16;

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
  if (el.id === 'print-p16')     { S.printP16 = el.checked; return render(); }
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
}

function onClick(e) {
  const el = e.target.closest('button, [data-act]');
  if (!el) return;
  const d = el.dataset;

  if (d.busDel !== undefined) { S.buses.splice(+d.busDel, 1); return render(); }
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
      data = JSON.parse(rd.result);
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

  if (location.hash.startsWith('#k=')) {
    try { adopt(b64dec(location.hash.slice(3))); }
    catch (e) { toast('Nie udało się odczytać linku'); }
  } else {
    try {
      const last = localStorage.getItem(LS_LAST);
      if (last) adopt(JSON.parse(last));
    } catch (e) { /* zostaje domyślny */ }
  }

  refreshPresetList();
  markExport();
  render();
}

document.addEventListener('DOMContentLoaded', boot);
