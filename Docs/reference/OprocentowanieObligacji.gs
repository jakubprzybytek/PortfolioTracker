// ============================================================
// WRAPPER DLA FRONTENDU IMPORTU — pobiera dane dla wielu serii
// ============================================================
function pobierzOprocentowanieImport(serie) {
  const wyniki = {};

  try {
    Logger.log('=== pobierzOprocentowanieImport START ===');
    Logger.log('Serie do pobrania: ' + JSON.stringify(serie));

    const dane = pobierzISparsujPlikMF();
    Logger.log('Plik MF sparsowany. Dostępne zakładki: ' + Object.keys(dane).join(', '));

    serie.forEach(function(seria) {
      try {
        const wynik = wyciagnijOprocentowanieZDanych(dane, seria);
        Logger.log('OK: ' + seria + ' → opr1=' + wynik.opr1 + ', marza=' + wynik.marza);
        wyniki[seria] = wynik;
      } catch(e) {
        Logger.log('BŁĄD dla ' + seria + ': ' + e.message);
        wyniki[seria] = { blad: e.message };
      }
    });

  } catch(e) {
    Logger.log('BŁĄD KRYTYCZNY (pobieranie pliku): ' + e.message);
    serie.forEach(function(seria) {
      wyniki[seria] = { blad: 'Błąd pobierania pliku MF: ' + e.message };
    });
  }

  Logger.log('=== pobierzOprocentowanieImport END === Sukcesy: ' +
    Object.values(wyniki).filter(function(w) { return !w.blad; }).length + '/' + serie.length);
  return wyniki;
}


// ============================================================
// WRAPPER DO WYWOŁANIA Z FRONTENDU
// ============================================================
function pobierzOprocentowanieZFrontendu(typObligacji, dataZakupu) {
  const seria = zbudujSerie(typObligacji, dataZakupu);
  const dane  = pobierzISparsujPlikMF();
  return wyciagnijOprocentowanieZDanych(dane, seria);
}


// ============================================================
// CACHE PLIKU MF — JEDNO POBRANIE DLA WIELU SERII
// ============================================================
function pobierzISparsujPlikMF() {
  const stronaUrl  = 'https://www.gov.pl/web/finanse/obligacje-detaliczne1';
  const stronaHtml = UrlFetchApp.fetch(stronaUrl, { muteHttpExceptions: true }).getContentText();

  const linkMatch = stronaHtml.match(/href="(\/attachment\/[a-f0-9\-]+)"[^>]*download/);
  if (!linkMatch) throw new Error('Nie znaleziono linku do pliku XLS na stronie MF.');

  const xlsUrl   = 'https://www.gov.pl' + linkMatch[1];
  const response = UrlFetchApp.fetch(xlsUrl, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error('Błąd pobierania pliku XLS: HTTP ' + response.getResponseCode());
  }

  eval(UrlFetchApp.fetch('https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js').getContentText());

  const uint8    = new Uint8Array(response.getContent().map(function(b) { return b & 0xFF; }));
  const workbook = XLSX.read(uint8, { type: 'array' });

  const dane = {};
  workbook.SheetNames.forEach(function(name) {
    dane[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' });
  });

  return dane;
}


// ============================================================
// GŁÓWNY PARSER SERII Z PLIKU MF
// Zwraca: seria, lata[], marza, staleCena, cenaZamiany
// ============================================================
function wyciagnijWszystkieOkresyZDanych(dane, seria, maxLat) {
  const typ = seria.substring(0, 3).toUpperCase();
  if (!dane[typ]) throw new Error('Brak zakładki "' + typ + '" w pliku MF.');

  const rows = dane[typ];

  let headerRow = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some(function(c) { return String(c).trim() === 'Seria'; })) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) throw new Error('Nie znaleziono wiersza nagłówkowego w zakładce ' + typ);

  const headerRow2 = headerRow + 1;
  const headers1   = rows[headerRow].map(function(c)  { return String(c).trim(); });
  const headers2   = rows[headerRow2].map(function(c) { return String(c).trim(); });

  const idxSeria = headers1.indexOf('Seria');
  if (idxSeria < 0) throw new Error('Nie znaleziono kolumny "Seria"');

  // ── Cena zamiany — szukaj w obu wierszach nagłówka ───────
  const KANDYDACI_CENA  = ['Cena zamiany', 'cena zamiany', 'Cena Zamiany'];
  const idxCenaZamiany  = _znajdzKolumne(headers1.concat(headers2), KANDYDACI_CENA);

  // ── Marża ─────────────────────────────────────────────────
  const idxMarza = _znajdzKolumne(headers1, ['Marża', 'Marza', 'marża', 'marza']);

  // ── Oprocentowanie rok 1 ──────────────────────────────────
  const KANDYDACI_ROK1 = [
    'w 1. roku', 'w 1.roku', 'w 1. okresie', 'w 1.okresie',
    '1. roku', '1. okresie', 'Rok 1', 'Okres 1'
  ];

  let idxRok1   = _znajdzKolumne(headers2, KANDYDACI_ROK1);
  let staleCena = false;
  if (idxRok1 < 0) {
    idxRok1   = _znajdzKolumne(headers1, ['Oprocentowanie', 'oprocentowanie']);
    staleCena = true;
  }
  if (idxRok1 < 0) throw new Error('Nie znaleziono kolumny oprocentowania rok 1 w zakładce ' + typ);

  // ── Indeksy kolumn dla roku 2..maxLat ─────────────────────
  const idxKolumny = [idxRok1];
  if (!staleCena) {
    for (let rok = 2; rok <= maxLat; rok++) {
      const kandydaci = [
        'w ' + rok + '. roku',    'w ' + rok + '.roku',
        'w ' + rok + '. okresie', 'w ' + rok + '.okresie',
        rok + '. roku',            rok + '. okresie',
        'Rok ' + rok,              'Okres ' + rok
      ];
      idxKolumny.push(_znajdzKolumne(headers2, kandydaci));
    }
  }

  // ── Szukaj wiersza serii ──────────────────────────────────
  for (let i = headerRow2 + 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[idxSeria] || '').trim().toUpperCase() !== seria.toUpperCase()) continue;

    // Lata
    const lata = idxKolumny.map(function(idx) {
      return idx < 0 ? null : _formatujProcent(row[idx]);
    });
    while (lata.length < maxLat) lata.push(null);

    // Marża
    const marza = idxMarza >= 0 ? _formatujProcent(row[idxMarza]) : null;

    // Cena zamiany
    let cenaZamiany = 0.999;
    if (idxCenaZamiany >= 0) {
      const parsed = parseFloat(String(row[idxCenaZamiany]).replace(',', '.').replace('%', '').trim());
      if (!isNaN(parsed) && parsed > 0) {
        cenaZamiany = Math.round(parsed * 10) / 1000;
      } else {
        Logger.log('Brak ceny zamiany dla serii ' + seria + ' — używam domyślnej 0,999');
      }
    } else {
      Logger.log('Nie znaleziono kolumny "Cena zamiany" w zakładce ' + typ + ' — używam domyślnej 0,999');
    }

    return { seria: seria, lata: lata, marza: marza, staleCena: staleCena, cenaZamiany: cenaZamiany };
  }

  throw new Error('Nie znaleziono serii "' + seria + '" w zakładce ' + typ);
}


// ============================================================
// WRAPPER DLA FORMULARZA — zwraca tylko rok 1 i marżę
// ============================================================
function wyciagnijOprocentowanieZDanych(dane, seria) {
  const wynik = wyciagnijWszystkieOkresyZDanych(dane, seria, 1);
  return {
    seria:     wynik.seria,
    opr1:      wynik.lata[0],
    marza:     wynik.marza,
    staleCena: wynik.staleCena
  };
}

// ============================================================
// HELPER — KONWERSJA TICKER → SERIA MF
// ============================================================

function tickerNaSerie(ticker) {
  const bez = ticker.replace('-', '');
  const typ = bez.substring(0, 3);
  const mm  = bez.substring(5, 7);
  const rr  = bez.substring(7, 9);
  return typ + mm + rr;
}

// ============================================================
// HELPERS
// ============================================================
function zbudujSerie(typ, dataStr) {
  const d = new Date(dataStr);
  const miesiac = String(d.getMonth() + 1).padStart(2, '0');
  const rok2    = String(d.getFullYear() + dlugoscObligacji(typ)).slice(-2);
  return typ.toUpperCase() + miesiac + rok2;
}


function dlugoscObligacji(typ) {
  const mapa = { 'TOS': 3, 'COI': 4, 'EDO': 10, 'ROS': 6, 'ROD': 12 };
  return mapa[typ.toUpperCase()] || 0;
}

function _znajdzKolumne(headers, kandydaci) {
  for (let k = 0; k < kandydaci.length; k++) {
    const idx = headers.findIndex(function(h) {
      return h.toLowerCase().trim() === kandydaci[k].toLowerCase().trim();
    });
    if (idx >= 0) return idx;
  }
  return -1;
}

function _formatujProcent(val) {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseFloat(String(val).replace(',', '.').replace('%', '').trim());
  if (isNaN(n)) return null;
  return n > 1 ? Math.round(n) / 100 : Math.round(n * 10000) / 10000;
}