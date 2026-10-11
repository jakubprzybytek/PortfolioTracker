function loadForm() {
  const htmlForSidebar = HtmlService.createTemplateFromFile("form_FE")
  const htmlOutput = htmlForSidebar.evaluate();
  htmlOutput.setTitle("Dodaj transakcję");  
  const ui = SpreadsheetApp.getUi();
  ui.showSidebar(htmlOutput);
}

function dodajTransakcje(rowData) {

  // ============================================================
  // PARSOWANIE DANYCH WEJŚCIOWYCH
  // ============================================================
  const cena     = Number(rowData.cena);
  const prowizja = Number(rowData.prowizja);
  const liczba   = rowData.rodzajTransakcji === 'Split' ? rowData.liczba : Number(rowData.liczba);


  // ============================================================
  // NORMALIZACJA TICKERA
  // ============================================================
  let ticker;
  let komunikatKonwersji = '';
  let komentarzKonwersji = '';

  if (rowData.klasaAktywow === "Waluty" && rowData.rodzajTransakcji === 'Zakup') {
    ticker = "Waluty_" + rowData.waluta;
  } else {
    const wynik = normalizujTicker(rowData.ticker, rowData.waluta);

    if (wynik.blokada) {
      SpreadsheetApp.getUi().alert(wynik.komunikat);
      return;
    }

    ticker             = wynik.ticker;
    komunikatKonwersji = wynik.komunikat;
    komentarzKonwersji = wynik.komentarzInfo;
  }


  // ============================================================
  // KOMENTARZ
  // ============================================================
  let komentarz = rowData.komentarz || '';
  if (komentarzKonwersji) {
    komentarz = komentarz
      ? `${komentarz} | ${komentarzKonwersji}`
      : komentarzKonwersji;
  }


  // ============================================================
  // KLASA AKTYWÓW
  // ============================================================
  const klasaAktywow =
    (rowData.rodzajTransakcji === 'Wpłata środków' || rowData.rodzajTransakcji === 'Wypłata środków')
      ? 'Gotówka'
      : rowData.klasaAktywow;


  // ============================================================
  // WALUTA – wszystkie przypadki w jednym miejscu, po ustaleniu klasaAktywow
  // ============================================================
  let waluta;
  if (klasaAktywow === 'Gotówka' && rowData.waluta === 'PLN') {  
    waluta = 'PLN';
  } else if (rowData.klasaAktywow === 'Waluty' && rowData.rodzajTransakcji === 'Sprzedaż') {
    waluta = rowData.ticker.replace('Waluty_', '');
  } else {
    waluta = rowData.waluta;
  }

  // ============================================================
  // NAZWA
  // ============================================================
  let nazwa = null;
  let wynikFT = null;

  const tickerWewnetrzny =
    ticker === 'Gotówka'                  ||
    klasaAktywow === 'Gotówka'            ||
    klasaAktywow === 'Waluty'             ||
    isBond(ticker, klasaAktywow)          ||
    rowData.rodzajTransakcji === 'Split';

  if (rowData.nazwa !== '') {
    // Użytkownik podał nazwę ręcznie → używamy bez zmian
    nazwa = rowData.nazwa;
  } else if (!tickerWewnetrzny) {
    const tickerDoFT = (klasaAktywow === kl_AkcjePL && !ticker.startsWith('WSE:'))
      ? 'WSE:' + ticker
      : ticker;

    try {
      wynikFT = getKursFT(tickerDoFT, waluta);
      nazwa = wynikFT[3] && wynikFT[3] !== '' ? wynikFT[3] : null;
    } catch(e) {
      nazwa = null;
    }

    // Fallback do analizy.pl gdy FT nie zwróciło nazwy
    if (!nazwa) {
      try {
        const wynikAnalizy = getKursAnalizy(ticker);
        nazwa = wynikAnalizy[3] && wynikAnalizy[3] !== '' ? wynikAnalizy[3] : null;
      } catch(e) {
        nazwa = null;
      }
    }
  }

  // Ostateczny fallback – ticker jako nazwa
  if (!nazwa) {
    nazwa = ticker;
  }


  // ============================================================
  // KURS WALUTY
  // ============================================================
  let kursWaluty;
  const brakKursu = !rowData.kursWaluty;  // obsługuje "", null, undefined

  if (brakKursu && waluta === 'PLN' || rowData.rodzajTransakcji === 'Split') {
    kursWaluty = 1;
  } else if (brakKursu && waluta !== 'PLN') {
    kursWaluty = Number(currency_rates(waluta, rowData.data));
  } else {
    kursWaluty = Number(rowData.kursWaluty);
  }

  // ============================================================
  // PROWIZJA WALUTOWA
  // ============================================================
  let prowizjaWPLN = prowizja;
  const walutaProwizji = rowData.walutaProwizji || 'PLN';

  if (prowizja > 0 && walutaProwizji !== 'PLN') {
    let kursProwizji;
    if (walutaProwizji === waluta) {
      // Waluta prowizji = waluta aktywa → użyj tego samego kursu
      kursProwizji = kursWaluty;
    } else {
      // Osobny kurs – podany ręcznie lub NBP
      kursProwizji = rowData.kursProwizji
        ? Number(rowData.kursProwizji)
        : Number(currency_rates(walutaProwizji, rowData.data));
    }

    prowizjaWPLN = Math.round(prowizja * kursProwizji * 100) / 100;

    // Doklejenie info do komentarza
    const infoProwizji = '| Prowizja: ' + prowizja.toFixed(2) + ' ' + walutaProwizji + ' @ ' + kursProwizji.toFixed(4) + ' PLN';
    komentarz = komentarz ? komentarz + ' ' + infoProwizji : infoProwizji;
  }


  // ============================================================
  // NOMINALNA
  // ============================================================
  const nominalna =
    (rowData.klasaAktywow === kl_KorpoPL ||
     (rowData.klasaAktywow === kl_OblPL && rowData.obligacjeTyp === "Notowane na Catalyst"))
      ? Number(rowData.nominalna)
      : 1;


  // ============================================================
  // TOTAL PLN
  // ============================================================
  let totalPLN = 0;

  switch (rowData.rodzajTransakcji) {
    case 'Zakup':
      totalPLN = liczba * cena * kursWaluty + prowizjaWPLN;  // ← zmiana
      break;
    case 'Sprzedaż':
      totalPLN = liczba * cena * kursWaluty - prowizjaWPLN;  // ← zmiana
      break;
    case 'Wpłata środków':
    case 'Wypłata środków':
    case 'Dywidenda / Odsetki':
    case 'Koszty':
      totalPLN = Number(rowData.totalPLN) * kursWaluty;
      break;
    case 'Split':
      totalPLN = 1;
      break;
    default:
      totalPLN = liczba * cena * kursWaluty;
  }

  totalPLN = Math.round(totalPLN * 100) / 100;

  if (klasaAktywow === 'Gotówka') {  
    waluta = 'PLN';
  }

  // ============================================================
  // ZAPIS GŁÓWNEJ TRANSAKCJI
  // ============================================================
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(shTransakcje);

  Logger.log('DEBUG nazwa: "' + nazwa + '" | typ: ' + typeof nazwa);
  Logger.log('DEBUG wynikFT[3]: "' + (wynikFT ? wynikFT[3] : 'wynikFT jest null') + '"');


  sh.appendRow([
    rowData.konto,
    rowData.data,
    ticker,
    waluta,
    nazwa,
    klasaAktywow,
    rowData.rodzajTransakcji,
    liczba,
    cena,
    prowizjaWPLN,
    kursWaluty,
    nominalna,
    totalPLN,
    komentarz
  ]);


  // ============================================================
  // AUTOMATYCZNY ZAKUP WALUTY
  // (Wpłata środków / Sprzedaż / Dywidenda na konto walutowe)
  // ============================================================
  const buyCurrencyTransactions = ['Wpłata środków', 'Sprzedaż', 'Dywidenda / Odsetki'];
  if (buyCurrencyTransactions.includes(rowData.rodzajTransakcji) && rowData.cash === 'Waluty') {
    sh.appendRow([
      rowData.konto,
      rowData.data,
      "Waluty_" + rowData.waluta,
      rowData.waluta,
      "Waluty_" + rowData.waluta,
      "Waluty",
      "Zakup",
      parseFloat(Number(totalPLN / kursWaluty).toFixed(2)),
      1,
      0,
      kursWaluty,
      1,
      totalPLN,
      "Transakcja dodana automatycznie"
    ]);
  }


  // ============================================================
  // AUTOMATYCZNA SPRZEDAŻ WALUTY
  // (Wypłata środków / Zakup / Koszty z konta walutowego)
  // ============================================================
  const sellCurrencyTransactions = ['Wypłata środków', 'Zakup', 'Koszty'];
  if (sellCurrencyTransactions.includes(rowData.rodzajTransakcji) && rowData.cash === 'Waluty') {
    sh.appendRow([
      rowData.konto,
      rowData.data,
      "Waluty_" + rowData.waluta,
      rowData.waluta,
      "Waluty_" + rowData.waluta,
      "Waluty",
      "Sprzedaż",
      parseFloat(Number(totalPLN / kursWaluty).toFixed(2)),
      1,
      0,
      kursWaluty,
      1,
      totalPLN,
      "Transakcja dodana automatycznie"
    ]);
  }


  // ============================================================
  // AUTOMATYCZNA WPŁATA PRZY ZAKUPIE (konto złotówkowe)
  // ============================================================
  if (rowData.wplata && rowData.cash !== 'Waluty') {
    sh.appendRow([
      rowData.konto,
      rowData.data,
      "Gotówka",
      "PLN",
      "Gotówka",
      "Gotówka",
      "Wpłata środków",
      1,
      1,
      0,
      1,
      1,
      totalPLN,
      "Transakcja dodana automatycznie"
    ]);
  }


  // ============================================================
  // KONFIGURACJA MULTIASSET
  // ============================================================
  if (rowData.rodzajTransakcji === 'Zakup' && klasaAktywow === kl_MultiAsset) {
    const multiassetSheet = ss.getSheetByName(shMultiasset);
    const existingTickers = multiassetSheet.getRange('A2:A').getValues().flat();   
    if (!existingTickers.includes(rowData.ticker)) {     
      return 'multiasset';
    }
  }


  // ============================================================
  // ALERT O KONWERSJI TICKERA
  // (po appendRow – dane są już bezpiecznie zapisane)
  // ============================================================
  if (komunikatKonwersji) {
    SpreadsheetApp.getUi().alert(komunikatKonwersji);
  }

  return true;
}

function transferSrodkow(rowData) {
  var komentarz = rowData.komentarz || ('Transfer: ' + rowData.konto + ' → ' + rowData.kontoB);
  
  var wyplata = Object.assign({}, rowData, {
    rodzajTransakcji: 'Wypłata środków',
    konto: rowData.konto,
    komentarz: komentarz
  });
  
  var wplata = Object.assign({}, rowData, {
    rodzajTransakcji: 'Wpłata środków',
    konto: rowData.kontoB,
    komentarz: komentarz
  });
  
  dodajTransakcje(wyplata);
  dodajTransakcje(wplata);
}

// ============================================================
// MAPA SUFIKSÓW XTB → PREFIKSY GOOGLE FINANCE
// ============================================================
const XTB_SUFFIX_MAP = {
  'PL': 'WSE',   // Polska – Warsaw Stock Exchange
  'UK': 'LON',   // Wielka Brytania – London Stock Exchange
  'DE': 'FRA',   // Niemcy – Xetra / Frankfurt
  'FR': 'EPA',   // Francja – Euronext Paris
  'NL': 'AMS',   // Holandia – Euronext Amsterdam
  'ES': 'BME',   // Hiszpania – Bolsa de Madrid
  'IT': 'BIT',   // Włochy – Borsa Italiana
  'BE': 'EBR',   // Belgia – Euronext Brussels
  'PT': 'ELI',   // Portugalia – Euronext Lisbon
  'SE': 'STO',   // Szwecja – Nasdaq Stockholm
  'NO': 'OSL',   // Norwegia – Oslo Børs
  'DK': 'CPH',   // Dania – Nasdaq Copenhagen
  'FI': 'HEL',   // Finlandia – Nasdaq Helsinki
  'CH': 'VTX',   // Szwajcaria – SIX Swiss Exchange
  'AT': 'VIE',   // Austria – Wiener Börse
  'CZ': 'PRA',   // Czechy – Prague Stock Exchange
  'HU': 'BUD',   // Węgry – Budapest Stock Exchange
  'TR': 'IST',   // Turcja – Borsa Istanbul
  'US': '',      // USA – brak prefiksu (GF domyślnie szuka na rynku amerykańskim)
  'CA': 'TSE',   // Kanada – Toronto Stock Exchange
  'BR': 'BVMF',  // Brazylia – B3 (Brasil Bolsa Balcão)
};

// ============================================================
// MAPA KODÓW GIEŁD FT → PREFIKSY GOOGLE FINANCE
// ============================================================
const FT_EXCHANGE_MAP = {
  'LSE': 'LON',  // Wielka Brytania – London Stock Exchange
  'GER': 'FRA',  // Niemcy – Xetra / Frankfurt
  'PAR': 'EPA',  // Francja – Euronext Paris
  'MIL': 'BIT',  // Włochy – Borsa Italiana
  'AEX': 'AMS',  // Holandia – Euronext Amsterdam
};

// ============================================================
// KONWERSJA FORMATU XTB
// ============================================================
function konwertujTickerXTB(ticker) {
  const xtbRegex = /^([A-Z0-9]+)\.([A-Z]{2,3})$/;
  const match = ticker.match(xtbRegex);

  if (!match) {
    return { ticker: ticker, czyKonwertowany: false, blokada: false, komunikat: '', komentarzInfo: '' };
  }

  const symbol = match[1];
  const sufiks = match[2];

  if (!(sufiks in XTB_SUFFIX_MAP)) {
    const komunikat = `⚠️ Ticker "${ticker}" wygląda jak format XTB, ale sufiks ".${sufiks}" jest nieznany. ` +
      `Ticker zapisano bez konwersji. Podaj ticker w formacie Google Finance (np. GIEŁDA:SYMBOL).`;
    const komentarzInfo = `⚠️ Nieznany sufiks XTB, ticker zapisano bez konwersji: ${ticker}`;
    return { ticker: ticker, czyKonwertowany: false, blokada: false, komunikat, komentarzInfo };
  }

  const prefiks = XTB_SUFFIX_MAP[sufiks];
  let tickerGF;
  let infoGielda;

  if (prefiks === '') {
    tickerGF = symbol;
    infoGielda = 'rynek amerykański (bez prefiksu)';
  } else {
    tickerGF = `${prefiks}:${symbol}`;
    infoGielda = prefiks;
  }

  const komunikat = `ℹ️ Ticker "${ticker}" (format XTB) został automatycznie przekonwertowany ` +
    `na "${tickerGF}" (format Google Finance, giełda: ${infoGielda}). ` +
    `W przyszłości podawaj tickery w formacie Google Finance, np. "${tickerGF}".`;
  const komentarzInfo = `Automatyczna konwersja tickera: ${ticker}`;

  return { ticker: tickerGF, czyKonwertowany: true, blokada: false, komunikat, komentarzInfo };
}


// ============================================================
// KONWERSJA FORMATU FT (tylko ETF: SYMBOL:KOD_GIEŁDY:KOD_WALUTY)
// ============================================================
function konwertujTickerFT(ticker, waluta) {
  const czesci = ticker.split(':');

  // Obsługujemy tylko dokładnie 3 segmenty
  if (czesci.length !== 3) {
    return { ticker: ticker, czyKonwertowany: false, blokada: false, komunikat: '', komentarzInfo: '' };
  }

  const symbol      = czesci[0];
  const kodGieldy   = czesci[1];
  const kodWaluty   = czesci[2];

  // Nieznana giełda → as-is bez blokady
  if (!(kodGieldy in FT_EXCHANGE_MAP)) {
    const komunikat = `⚠️ Ticker "${ticker}" wygląda jak format FT, ale kod giełdy "${kodGieldy}" jest nieznany. ` +
      `Ticker zapisano bez konwersji. Podaj ticker w formacie Google Finance (np. GIEŁDA:SYMBOL).`;
    const komentarzInfo = `⚠️ Nieznana giełda FT, ticker zapisano bez konwersji: ${ticker}`;
    return { ticker: ticker, czyKonwertowany: false, blokada: false, komunikat, komentarzInfo };
  }

  // Walidacja waluty
  // Wyjątek: GBX w tickerze i GBP w formularzu → traktujemy jako zgodne
  const walutaZTickera   = kodWaluty.toUpperCase();
  const walutaFormularza = (waluta || '').toUpperCase();
  const zgodneWaluty =
    walutaZTickera === walutaFormularza ||
    (walutaZTickera === 'GBX' && walutaFormularza === 'GBP');

  if (!zgodneWaluty) {
    const komunikat =
      `🚫 Nie można dodać transakcji.\n\n` +
      `Waluta podana w formularzu („${walutaFormularza}") nie zgadza się z walutą notowań ` +
      `wynikającą z tickera („${walutaZTickera}").\n\n` +
      `Sprawdź wszystkie parametry transakcji (cenę, kurs waluty, wartość) ` +
      `i wprowadź je ponownie używając waluty notowań (${walutaZTickera}).\n\n` +
      `Instrukcja: https://inwestomat.eu/wlasny-arkusz-do-monitorowania-inwestycji/#dodawanie-transakcji-na-etf-ach-i-akcjach`;
    return { ticker: ticker, czyKonwertowany: false, blokada: true, komunikat, komentarzInfo: '' };
  }

  // Konwersja na format GF
  const prefiks   = FT_EXCHANGE_MAP[kodGieldy];
  const tickerGF  = `${prefiks}:${symbol}`;

  const komunikat = `ℹ️ Ticker "${ticker}" (format FT) został automatycznie przekonwertowany ` +
    `na "${tickerGF}" (format Google Finance, giełda: ${prefiks}). ` +
    `W przyszłości podawaj tickery w formacie Google Finance, np. "${tickerGF}".`;
  const komentarzInfo = `Automatyczna konwersja tickera: ${ticker}`;

  return { ticker: tickerGF, czyKonwertowany: true, blokada: false, komunikat, komentarzInfo };
}


// ============================================================
// GŁÓWNA FUNKCJA WEJŚCIOWA
// ============================================================
/**
 * Wykrywa format tickera (XTB / FT / GF / nieznany) i konwertuje
 * na format Google Finance.
 *
 * @param {string} ticker  - Ticker podany przez użytkownika
 * @param {string} waluta  - Waluta z rowData.waluta (potrzebna tylko dla FT)
 * @returns {{ ticker, czyKonwertowany, blokada, komunikat, komentarzInfo }}
 */
function normalizujTicker(ticker, waluta) {
  if (!ticker || typeof ticker !== 'string') {
    return { ticker: ticker, czyKonwertowany: false, blokada: false, komunikat: '', komentarzInfo: '' };
  }

  // Tickery wewnętrzne – nie normalizuj
  const tickeryWewnetrzne = ['Gotówka', 'gotówka'];
  if (tickeryWewnetrzne.some(t => ticker.trim() === t) || ticker.trim().startsWith('Waluty_')) {
    return { ticker: ticker.trim(), czyKonwertowany: false, blokada: false, komunikat: '', komentarzInfo: '' };
  }

  const trimmed = ticker.trim().toUpperCase();

  // Format FT: dokładnie 3 segmenty oddzielone dwukropkiem
  if (trimmed.split(':').length === 3) {
    return konwertujTickerFT(trimmed, waluta);
  }

  // Format XTB: SYMBOL.SUFIKS
  if (  /^[A-Z0-9]+\.[A-Z]{2,3}$/.test(trimmed) &&  !trimmed.endsWith('.TFI')) {
    return konwertujTickerXTB(trimmed);
  }

  // Zakładamy format GF lub nieznany – nie ruszamy
  return { ticker: trimmed, czyKonwertowany: false, blokada: false, komunikat: '', komentarzInfo: '' };
}

function getDropDownArrayWaluty(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(shTechniczny);
  dataRange = sh.getRange(2,1,sh.getLastRow()-1,1).getValues()
  var values = [];
  for (i = 0; i < dataRange.length -1; i++) {
    var value = dataRange[i].toString().toUpperCase() 
    if ((value != "") && (values.indexOf(value) == -1)) {
      values.push(value);
    }
  }
  return values
}

function getDropDownArrayKlasyPortfolio() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(shPortfolio);
  values = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues(); // 4 → 5
  return values;
}