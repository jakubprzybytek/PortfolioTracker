//@OnlyCurrentDoc
/**
 * ================================================================================
 * SYSTEM BENCHMARKÓW PORTFELA INWESTYCYJNEGO
 * ================================================================================
 * 
 * OPIS:
 * System automatycznie pobiera dane benchmarków z Google Finance i oblicza 
 * hipotetyczną wartość portfela, gdyby środki były zainwestowane w różne 
 * indeksy zamiast w rzeczywiste aktywa. Pozwala porównać wyniki własnego 
 * portfela z passive investing w indeksy giełdowe i inflację (CPI).
 * 
 * ================================================================================
 * KONFIGURACJA BENCHMARKÓW:
 * ================================================================================
 * 
 * OBECNIE SKRYPT OBSŁUGUJE:
 * 1. CPI (inflacja) - obliczana automatycznie z zakładki "Inflacja"
 * 2. LON:ACWI (GBP) – ETF na globalny indeks akcji MSCI ACWI.
 * 3. LON:CSPX (USD) – iShares Core S&P 500 UCITS ETF USD (Acc)
 * 4. AMS:V80A (EUR) – Vanguard LifeStrategy 80% Equity UCITS ETF (Acc)
 * 5. WSE:WIG (PLN) – szeroki indeks warszawskiej giełdy.
 * 6. WSE:SWIG80TR (PLN) – indeks małych spółek z GPW w wersji Total Return
 * 
 * UWAGA: Benchmarki w USD, EUR lub GBP są automatycznie przeliczane do PLN
 * przy użyciu kursu walutowego z danego dnia.
 * 
 * ================================================================================
 * MECHANIZM DZIAŁANIA I ZAŁOŻENIA:
 * ================================================================================
 * 
 * GŁÓWNE ZAŁOŻENIA:
 * - Wszystkie wpłaty/wypłaty inwestowane natychmiast (brak kosztów transakcyjnych)
 * - Reinwestycja dywidend (dla indeksów Total Return)
 * - Inflacja miesięczna rozłożona równomiernie na dni miesiąca
 * - Maksymalnie 5 benchmarków jednocześnie (limit Google Finance)
 * 
 * ================================================================================
 */


// Stałe konfiguracyjne
const MAX_BENCHMARKS = 5;
const PRICE_CHANGE_THRESHOLD = 0.5; // 50% zmiana = anomalia
const GOOGLE_FINANCE_DELAY_MS = 5000;
const DATE_BUFFER_DAYS = 7;


/**
 * KONFIGURACJA BENCHMARKÓW
 */
const BENCHMARK_CONFIG = [
  
  { ticker: "LON:ACWI",     waluta: "GBP" },   // MSCI ACWI
  { ticker: "LON:CSPX",     waluta: "USD" },   // SP500
  //{ ticker: "LON:IGLA",     waluta: "USD" },   // iShares Global Govt Bond
  //{ ticker: "LON:IWDA",     waluta: "USD" },   // iShares Core MSCI World
  { ticker: "AMS:V80A",     waluta: "EUR" },    // Vanguard V80A
  { ticker: "WSE:WIG",      waluta: "PLN" },   // WIG
  { ticker: "WSE:SWIG80TR", waluta: "PLN" }   // sWIG80 TR
];


// FUNKCJA GŁÓWNA - uruchom tę!
function updateBenchmarks() {
  Logger.log("=== START: Aktualizacja benchmarków ===");
  
  try {
    validateBenchmarkConfig();
    
    Logger.log("Krok 1: Pobieranie danych z Google Finance...");
    refreshBenchmarkData();
    
    Logger.log("Krok 2: Przetwarzanie danych benchmarków...");
    fillBenchmarkData();

    Logger.log("Krok 3: Aktualizacja zakładki Benchmarki...");
    updateBenchmarkDashboardValues();
    
    Logger.log("=== KONIEC: Benchmarki zaktualizowane ===");
    //SpreadsheetApp.getUi().alert("✓ Benchmarki zaktualizowane pomyślnie!");
    
  } catch (error) {
    Logger.log(`BŁĄD: ${error.message}`);
    SpreadsheetApp.getUi().alert(`Błąd aktualizacji benchmarków:\n\n${error.message}`);
    throw error;
  }
}


// Funkcja walidująca cenę (wykrywanie anomalii)
function validatePrice(ticker, date, currentPrice, previousPrice) {
  if (!previousPrice || !currentPrice) {
    return currentPrice;
  }
  
  currentPrice = parseFloat(currentPrice);
  previousPrice = parseFloat(previousPrice);
  
  if (isNaN(currentPrice) || isNaN(previousPrice)) {
    Logger.log(`BŁĄD: Nieprawidłowa cena dla ${ticker} ${date}`);
    return previousPrice;
  }
  
  let correctedPrice = currentPrice;
  const changePercent = Math.abs((currentPrice - previousPrice) / previousPrice);
  
  if (changePercent > PRICE_CHANGE_THRESHOLD) {
    Logger.log(`ANOMALIA wykryta: ${ticker} ${date}, zmiana ${(changePercent*100).toFixed(1)}%`);
    Logger.log(`  Cena poprzednia: ${previousPrice}, aktualna: ${currentPrice}`);
    
    if (currentPrice > previousPrice * 50) {
      correctedPrice = currentPrice / 100;
      Logger.log(`  Korekcja: ÷100, nowa cena: ${correctedPrice}`);
    } else if (currentPrice < previousPrice / 50) {
      correctedPrice = currentPrice * 100;
      Logger.log(`  Korekcja: ×100, nowa cena: ${correctedPrice}`);
    } else {
      correctedPrice = previousPrice;
      Logger.log(`  Korekcja: użyj poprzedniej wartości: ${correctedPrice}`);
    }
  }
  
  return correctedPrice;
}


function refreshBenchmarkData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetBenchmarkDane = ss.getSheetByName(shBencharkiDane);
  const sheetTransakcje = ss.getSheetByName(shTransakcje);
  
  if (!sheetBenchmarkDane || !sheetTransakcje) {
    throw new Error(`Brak wymaganych zakładek: '${shBencharkiDane}' lub '${shTransakcje}'`);
  }

  // Pierwsza wpłata
  const dataTransakcje = sheetTransakcje.getDataRange().getValues();
  let firstDepositDate = null;
  
  for (let i = 1; i < dataTransakcje.length; i++) {
    if (dataTransakcje[i][COL_TRANSAKCJE.RODZAJ] === "Wpłata środków") {
      firstDepositDate = new Date(dataTransakcje[i][COL_TRANSAKCJE.DATA]);
      break;
    }
  }
  
  if (!firstDepositDate) {
    throw new Error(`Nie znaleziono żadnej transakcji 'Wpłata środków' w zakładce '${shTransakcje}'`);
  }

  const startDate = new Date(firstDepositDate);
  startDate.setDate(startDate.getDate() - DATE_BUFFER_DAYS);
  Logger.log(`Data startu: ${Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy-MM-dd")}`);

  sheetBenchmarkDane.clear();
  let currentColumn = 1;

  // Unikalne waluty
  const walutySet = new Set();
  BENCHMARK_CONFIG.forEach(config => config.waluta !== "PLN" && walutySet.add(config.waluta));
  const walutyArray = Array.from(walutySet).sort();

  // Formuły walut
  walutyArray.forEach(waluta => {
    const formula = `=GOOGLEFINANCE("CURRENCY:${waluta}PLN";"price";DATE(${startDate.getFullYear()};${startDate.getMonth()+1};${startDate.getDate()});TODAY();"DAILY")`;
    sheetBenchmarkDane.getRange(1, currentColumn).setFormula(formula);
    Logger.log(`Formuła ${waluta}/PLN w kolumnie ${currentColumn}`);
    currentColumn += 3;
  });

  // Formuły benchmarków
  const activeTickers = BENCHMARK_CONFIG.slice(0, MAX_BENCHMARKS);
  activeTickers.forEach(config => {
    const formula = `=GOOGLEFINANCE("${config.ticker}";"close";DATE(${startDate.getFullYear()};${startDate.getMonth()+1};${startDate.getDate()});TODAY();"DAILY")`;
    sheetBenchmarkDane.getRange(1, currentColumn).setFormula(formula);
    Logger.log(`Formuła ${config.ticker} w kolumnie ${currentColumn}`);
    currentColumn += 3;
  });

  Logger.log("Formuły zapisane - oczekiwanie na Google Finance...");
  SpreadsheetApp.flush();
  Utilities.sleep(GOOGLE_FINANCE_DELAY_MS);

  // Zamiana formuł na wartości
  const dataRange = sheetBenchmarkDane.getDataRange();
  const values = dataRange.getValues();
  dataRange.setValues(values);

  Logger.log(`Dane pobrane: ${sheetBenchmarkDane.getLastRow()} wierszy`);

  // Nagłówki w wierszu 1, kolumna B
  let colB1 = 2;
  walutyArray.forEach(waluta => {
    sheetBenchmarkDane.getRange(1, colB1).setValue(`${waluta}/PLN`);
    colB1 += 3;
  });
  
  colB1 = walutyArray.length * 3 + 2;
  activeTickers.forEach(config => {
    sheetBenchmarkDane.getRange(1, colB1).setValue(`${config.ticker} (${config.waluta})`);
    colB1 += 3;
  });

  Logger.log(`GOTOWE: ${walutyArray.length} walut + ${activeTickers.length} benchmarków`);
}


function fillBenchmarkData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetTransakcje = ss.getSheetByName(shTransakcje);
  const sheetInflacja = ss.getSheetByName(shInflacja);
  const sheetBenchmark = ss.getSheetByName(shBencharkiObliczenia);
  const sheetBenchmarkDane = ss.getSheetByName(shBencharkiDane);
  const sheetHistoria = ss.getSheetByName(shHistoria);
  
  if (!sheetTransakcje || !sheetInflacja || !sheetBenchmark || !sheetBenchmarkDane || !sheetHistoria) {
    throw new Error(
      `Brak wymaganych zakładek: ${shTransakcje}, ${shInflacja}, ${shBencharkiObliczenia}, ${shBencharkiDane}, ${shHistoria}`
    );
  }

  // 1. Pierwsza wpłata
  const dataTransakcje = sheetTransakcje.getDataRange().getValues();
  let firstDepositDate = null;
  
  for (let i = 1; i < dataTransakcje.length; i++) {
    if (dataTransakcje[i][COL_TRANSAKCJE.RODZAJ] === "Wpłata środków") {
      firstDepositDate = new Date(dataTransakcje[i][COL_TRANSAKCJE.DATA]);
      break;
    }
  }
  
  if (!firstDepositDate) {
    throw new Error(`Nie znaleziono 'Wpłata środków' w zakładce '${shTransakcje}'`);
  }

  // 2. Mapa transakcji
  const transakcjeMap = {};
  
  for (let i = 1; i < dataTransakcje.length; i++) {
    const dataTransakcji = dataTransakcje[i][COL_TRANSAKCJE.DATA];
    const rodzajTransakcji = dataTransakcje[i][COL_TRANSAKCJE.RODZAJ];
    
    if (rodzajTransakcji === "Wpłata środków" || rodzajTransakcji === "Wypłata środków") {
      const kwota = parseFloat(dataTransakcje[i][COL_TRANSAKCJE.KWOTA]) || 0;
      if (kwota === 0) {
        Logger.log(`UWAGA: Zerowa kwota w wierszu ${i + 1}, pominięto`);
        continue;
      }
      const dataKey = Utilities.formatDate(new Date(dataTransakcji), Session.getScriptTimeZone(), "yyyy-MM-dd");
      if (!transakcjeMap[dataKey]) transakcjeMap[dataKey] = 0;
      if (rodzajTransakcji === "Wpłata środków") {
        transakcjeMap[dataKey] += kwota;
      } else {
        transakcjeMap[dataKey] -= kwota;
      }
    }
  }

  // 3. Mapa inflacji
  const dataInflacja = sheetInflacja.getDataRange().getValues();
  const inflacjaMap = {};
  
  for (let i = 1; i < dataInflacja.length; i++) {
    const sposobPrezentacji = dataInflacja[i][COL_INFLACJA.SPOSOB_PREZENTACJI];
    const rok = dataInflacja[i][COL_INFLACJA.ROK];
    const miesiac = dataInflacja[i][COL_INFLACJA.MIESIAC];
    const wartosc = parseFloat(dataInflacja[i][COL_INFLACJA.WARTOSC]);
    
    if (sposobPrezentacji === "Poprzedni miesiąc = 100" && !isNaN(wartosc)) {
      const key = `${rok}-${String(miesiac).padStart(2, '0')}`;
      inflacjaMap[key] = wartosc;
    }
  }
  Logger.log(`Inflacja: załadowano ${Object.keys(inflacjaMap).length} miesięcy`);

  // 4. Mapa wartości portfela z Historia
  const dataHistoria = sheetHistoria.getDataRange().getValues();
  const historiaMap = {};
  
  for (let i = 1; i < dataHistoria.length; i++) {
    if (dataHistoria[i][COL_HISTORIA.DATA]) {
      const date = new Date(dataHistoria[i][COL_HISTORIA.DATA]);
      const dateKey = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
      const wartoscPortfela = parseFloat(dataHistoria[i][COL_HISTORIA.WARTOSC_PORTFELA]);
      if (!isNaN(wartoscPortfela)) {
        historiaMap[dateKey] = wartoscPortfela;
      }
    }
  }
  Logger.log(`Historia: załadowano ${Object.keys(historiaMap).length} wartości portfela`);

  // 5. Pobieranie danych benchmarków
  const benchmarkDane = sheetBenchmarkDane.getDataRange().getValues();
  if (benchmarkDane.length <= 1) {
    throw new Error(`Brak danych w zakładce '${shBencharkiDane}' - uruchom najpierw refreshBenchmarkData()`);
  }

  const walutySet = new Set();
  BENCHMARK_CONFIG.forEach(config => config.waluta !== "PLN" && walutySet.add(config.waluta));
  const walutyArray = Array.from(walutySet).sort();

  const kursyMap = {};
  const lastValidKursy = {};
  
  walutyArray.forEach((waluta, walutaIndex) => {
    kursyMap[waluta] = {};
    lastValidKursy[waluta] = null;
    
    const dateCol = walutaIndex * 3;
    const priceCol = walutaIndex * 3 + 1;
    
    for (let i = 1; i < benchmarkDane.length; i++) {
      if (benchmarkDane[i][dateCol] && benchmarkDane[i][priceCol]) {
        const date = new Date(benchmarkDane[i][dateCol]);
        const dateKey = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
        let price = benchmarkDane[i][priceCol];
        
        price = validatePrice(`${waluta}/PLN`, dateKey, price, lastValidKursy[waluta]);
        lastValidKursy[waluta] = price;
        kursyMap[waluta][dateKey] = price;
      }
    }
    if (Object.keys(kursyMap[waluta]).length === 0) {
      throw new Error(`Brak danych kursu dla waluty ${waluta} - sprawdź Google Finance`);
    }
  });

  const activeTickers = BENCHMARK_CONFIG.slice(0, MAX_BENCHMARKS);
  const benchmarkMaps = [];
  const lastValidPrices = [];
  
  activeTickers.forEach((config, index) => {
    benchmarkMaps[index] = {};
    lastValidPrices[index] = null;
    
    const benchColStart = walutyArray.length * 3;
    const dateCol = benchColStart + (index * 3);
    const priceCol = benchColStart + (index * 3) + 1;
    
    for (let i = 1; i < benchmarkDane.length; i++) {
      if (benchmarkDane[i][dateCol] && benchmarkDane[i][priceCol]) {
        const date = new Date(benchmarkDane[i][dateCol]);
        const dateKey = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
        let price = benchmarkDane[i][priceCol];
        
        price = validatePrice(config.ticker, dateKey, price, lastValidPrices[index]);
        lastValidPrices[index] = price;
        benchmarkMaps[index][dateKey] = price;
      }
    }
    if (Object.keys(benchmarkMaps[index]).length === 0) {
      Logger.log(`UWAGA: Brak danych dla benchmarku ${config.ticker} - zostanie pominięty`);
    }
  });

  const findFirstAvailableDate = (map) => {
    const dates = Object.keys(map).sort();
    return dates.length > 0 ? dates[0] : null;
  };
  
  const firstBenchmarkDates = activeTickers.map((_, i) => findFirstAvailableDate(benchmarkMaps[i]));
  Logger.log(`Pierwsze daty benchmarków:`);
  activeTickers.forEach((config, i) => {
    Logger.log(`  ${config.ticker}: ${firstBenchmarkDates[i] || 'BRAK DANYCH'}`);
  });

  const firstDepositKey = Utilities.formatDate(firstDepositDate, Session.getScriptTimeZone(), "yyyy-MM-dd");

  const shortHistoryFlags = activeTickers.map((_, i) => {
  const firstBench = firstBenchmarkDates[i];
    // true jeśli benchmark startuje później niż pierwsza wpłata
    return firstBench && firstBench > firstDepositKey;
  });
  
  const findLastValue = (map) => {
    const dates = Object.keys(map).sort();
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] <= firstDepositKey) return map[dates[i]];
    }
    return null;
  };
  
  const lastKursyStart = {};
  walutyArray.forEach(w => lastKursyStart[w] = findLastValue(kursyMap[w]));
  const lastBenchmarkPrices = activeTickers.map((_, i) => findLastValue(benchmarkMaps[i]));

  // 8. Symulacja dzień po dniu
  const today = new Date();
  today.setDate(today.getDate() - 1);
  const benchmarkData = [];
  
  let currentDate = new Date(firstDepositDate);

  let wartoscCPI = 0;
  let skumulowanaKwota = 0;
  
  const liczbaJednostek = activeTickers.map(() => 0);
  const gotowka = activeTickers.map(() => 0);
  const lastKursy = {...lastKursyStart};
  const lastPrices = [...lastBenchmarkPrices];

  while (currentDate <= today) {
    const rok = currentDate.getFullYear();
    const miesiac = currentDate.getMonth() + 1;
    const key = `${rok}-${String(miesiac).padStart(2, '0')}`;
    const dataKey = Utilities.formatDate(currentDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
    
    
    const inflacjaMiesieczna = inflacjaMap[key] || "";
    let inflacjaDzienna = "";

    if (inflacjaMiesieczna !== "") {
      const daysInMonth = new Date(rok, miesiac, 0).getDate();
      const stopaMiesieczna = (inflacjaMiesieczna / 100) - 1;
      const stopaDzienna = Math.pow(1 + stopaMiesieczna, 1 / daysInMonth) - 1;
      inflacjaDzienna = 1 + stopaDzienna;
      wartoscCPI = wartoscCPI * inflacjaDzienna;
    }

    const kwotaTransakcji = transakcjeMap[dataKey] || 0;
    if (kwotaTransakcji !== 0) skumulowanaKwota += kwotaTransakcji;

    wartoscCPI += kwotaTransakcji;
    wartoscCPI = Math.round(wartoscCPI * 10000) / 10000;
    
    const wartoscPortfelaHistoria = historiaMap[dataKey] || "";

    const benchmarkValues = [];
    for (let index = 0; index < MAX_BENCHMARKS; index++) {
      if (index < activeTickers.length) {
        const config = activeTickers[index];
        
        let cenaWalucie = benchmarkMaps[index][dataKey];
        if (cenaWalucie) lastPrices[index] = cenaWalucie;
        else cenaWalucie = lastPrices[index] || "";
        
        let kurs = 1;
        if (config.waluta !== "PLN") {
          kurs = kursyMap[config.waluta]?.[dataKey];
          if (kurs) lastKursy[config.waluta] = kurs;
          else kurs = lastKursy[config.waluta] || "";
        }
        
        let cenaPLN = "";
        let jednostki = "";
        let wartosc = "";
        
        const benchAvailable = firstBenchmarkDates[index] && dataKey >= firstBenchmarkDates[index];
        
        if (benchAvailable && cenaWalucie !== "" && (config.waluta === "PLN" || kurs !== "")) {
          cenaPLN = config.waluta === "PLN" ? cenaWalucie : cenaWalucie * kurs;
          
          if (dataKey === firstBenchmarkDates[index] && gotowka[index] > 0) {
            liczbaJednostek[index] = gotowka[index] / cenaPLN;
            gotowka[index] = 0;
            Logger.log(`${config.ticker} start: ${dataKey}, inwestuję gotówkę ${liczbaJednostek[index].toFixed(2)} jednostek`);
          }
          
          if (kwotaTransakcji !== 0) {
            liczbaJednostek[index] += kwotaTransakcji / cenaPLN;
          }
          
          jednostki = Math.round(liczbaJednostek[index] * 1000000) / 1000000;
          wartosc = Math.round(jednostki * cenaPLN * 10000) / 10000;
        } else {
          if (kwotaTransakcji !== 0) {
            gotowka[index] += kwotaTransakcji;
          }
          wartosc = gotowka[index];
        }
        
        benchmarkValues.push(wartosc);
      } else {
        benchmarkValues.push("");
      }
    }

    const benchmarkDetails = [];
    for (let index = 0; index < MAX_BENCHMARKS; index++) {
      if (index < activeTickers.length) {
        const config = activeTickers[index];
        
        let cenaWalucie = lastPrices[index] || "";
        let kurs = config.waluta === "PLN" ? 1 : (lastKursy[config.waluta] || "");
        let cenaPLN = "";
        let jednostki = Math.round(liczbaJednostek[index] * 1000000) / 1000000;
        
        if (cenaWalucie !== "" && kurs !== "") {
          cenaPLN = config.waluta === "PLN" ? cenaWalucie : cenaWalucie * kurs;
        }
        
        benchmarkDetails.push(cenaWalucie, kurs, cenaPLN, jednostki, "");
      } else {
        benchmarkDetails.push("", "", "", "", "");
      }
    }

    benchmarkData.push([
      dataKey,
      skumulowanaKwota,
      wartoscPortfelaHistoria,
      wartoscCPI,
      ...benchmarkValues,
      "",
      inflacjaMiesieczna,
      inflacjaDzienna,
      inflacjaMiesieczna !== "" ? (inflacjaMiesieczna / 100) - 1 : "",
      inflacjaDzienna !== "" ? inflacjaDzienna - 1 : "",
      "",
      ...benchmarkDetails
    ]);

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // 9. Nagłówki
  const headers = [
    "Data",
    "Zainwestowana kwota",
    "Wartość Portfela",
    "CPI",
  ];
  
  // for (let i = 0; i < MAX_BENCHMARKS; i++) {
  //   if (i < activeTickers.length) {
  //     headers.push(activeTickers[i].ticker);
  //   } else {
  //     headers.push("");
  //   }
  // }
  for (let i = 0; i < MAX_BENCHMARKS; i++) {
    if (i < activeTickers.length) {
      const config = activeTickers[i];
      const name = shortHistoryFlags[i] ? config.ticker + '*' : config.ticker;
      headers.push(name);
    } else {
      headers.push("");
    }
  }
  
  headers.push(
    "",
    "Inflacja miesięczna",
    "Inflacja dzienna",
    "Inflacja miesięczna %",
    "Inflacja dzienna %",
    ""
  );
  
  for (let i = 0; i < MAX_BENCHMARKS; i++) {
    if (i < activeTickers.length) {
      const config = activeTickers[i];
      headers.push(
        `${config.ticker} Wartość (${config.waluta})`,
        `${config.ticker} Kurs walutowy`,
        `${config.ticker} Cena PLN`,
        `${config.ticker} Jednostki`,
        ""
      );
    } else {
      headers.push("", "", "", "", "");
    }
  }

  // 10. Zapis do zakładki z obliczeniami
  if (sheetBenchmark.getLastRow() > 1) {
    sheetBenchmark
      .getRange(2, 1, sheetBenchmark.getLastRow() - 1, sheetBenchmark.getLastColumn())
      .clearContent();
  }
  
  sheetBenchmark.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (benchmarkData.length > 0) {
    sheetBenchmark
      .getRange(2, 1, benchmarkData.length, benchmarkData[0].length)
      .setValues(benchmarkData);
  }

  Logger.log(`✓ Dodano ${benchmarkData.length} wierszy z ${activeTickers.length}/${MAX_BENCHMARKS} benchmarkami`);
}


// Indeksy kolumn w arkuszach
const COL_TRANSAKCJE = {
  DATA: 1,
  RODZAJ: 6,
  KWOTA: 12
};

const COL_INFLACJA = {
  SPOSOB_PREZENTACJI: 2,
  ROK: 3,
  MIESIAC: 4,
  WARTOSC: 5
};

const COL_HISTORIA = {
  DATA: 0,
  WARTOSC_PORTFELA: 12
};


// Walidacja konfiguracji przy starcie
function validateBenchmarkConfig() {
  if (BENCHMARK_CONFIG.length === 0) {
    throw new Error("BENCHMARK_CONFIG jest pusty - dodaj przynajmniej jeden benchmark");
  }
  
  BENCHMARK_CONFIG.forEach((config, index) => {
    if (!config.ticker || typeof config.ticker !== 'string') {
      throw new Error(`Benchmark ${index + 1}: brak lub nieprawidłowy ticker`);
    }
    if (!config.waluta || typeof config.waluta !== 'string') {
      throw new Error(`Benchmark ${index + 1} (${config.ticker}): brak lub nieprawidłowa waluta`);
    }
  });
  
  if (BENCHMARK_CONFIG.length > MAX_BENCHMARKS) {
    Logger.log(`UWAGA: Zdefiniowano ${BENCHMARK_CONFIG.length} benchmarków, użyte zostanie tylko ${MAX_BENCHMARKS} pierwszych`);
  }
}

/**
 * ================================================================================
 * UPDATE GŁÓWNEJ STORNY BENCHMARKI
 * ================================================================================
*/
function updateBenchmarkDashboardValues() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheetDashboard = ss.getSheetByName(shBencharki);
  const sheetCalc = ss.getSheetByName(shBencharkiObliczenia);

  if (!sheetDashboard || !sheetCalc) {
    throw new Error(`Brak wymaganych zakładek: '${shBencharki}' lub '${shBencharkiObliczenia}'`);
  }

  const lastRow = sheetCalc.getLastRow();
  const lastCol = sheetCalc.getLastColumn();

  if (lastRow < 2) {
    throw new Error(`Zakładka '${shBencharkiObliczenia}' nie zawiera danych do aktualizacji dashboardu benchmarków`);
  }

  const data = sheetCalc.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0];
  const lastDataRow = data[lastRow - 1];

  // Układ kolumn w "Benchmarki Obliczenia"
  const COL_DATA = 0;        // A
  const COL_PORTFEL = 2;     // C
  const COL_CPI = 3;         // D
  const COL_FIRST_BENCH = 4; // E
  const MAX_BENCHMARKS = 5;

  const portfolioValue = lastDataRow[COL_PORTFEL] || '';
  const cpiValue = lastDataRow[COL_CPI] || '';
  const lastUpdate = lastDataRow[COL_DATA] || '';

  const rows = [];

  // 1. Portfel
  rows.push([
    'Portfel',
    portfolioValue,
    '',
    '',
    ''
  ]);

  // 2. CPI
  let cpiDiffAmount = '';
  let cpiDiffPct = '';
  if (portfolioValue !== '' && cpiValue !== '' && Number(cpiValue) !== 0) {
    cpiDiffAmount = portfolioValue - cpiValue;
    cpiDiffPct = (portfolioValue - cpiValue) / cpiValue;
  }

  rows.push([
    'CPI',
    cpiValue,
    cpiDiffAmount,
    cpiDiffPct,
    ''
  ]);

  // 3. Benchmarki 1..5
  for (let i = 0; i < MAX_BENCHMARKS; i++) {
    const colIndex = COL_FIRST_BENCH + i;
    const benchName = headers[colIndex] || '';
    const benchValue = lastDataRow[colIndex] || '';

    let diffAmount = '';
    let diffPct = '';

    if (benchName !== '' && portfolioValue !== '' && benchValue !== '' && Number(benchValue) !== 0) {
      diffAmount = portfolioValue - benchValue;
      diffPct = (portfolioValue - benchValue) / benchValue;
    }

    rows.push([
      benchName,
      benchValue,
      diffAmount,
      diffPct,
      ''
    ]);
  }

  // Wpis do tabeli B8:F14 (7 wierszy danych)
  const targetRange = sheetDashboard.getRange('B8:F14');
  const existingValues = targetRange.getValues();

  // Zachowaj checkboxy z kolumny F
  const output = rows.map((row, idx) => {
    return [
      row[0],                    // Nazwa
      row[1],                    // Wartość obecna
      row[2],                    // Różnica kwotowa
      row[3],                    // Różnica % vs portfel
      existingValues[idx][4]     // istniejący checkbox
    ];
  });

  targetRange.setValues(output);

  // reset koloru nazw
  sheetDashboard.getRange('B8:B14').setFontColor(null);

  // oznacz nazwy z gwiazdką na czerwono
  for (let i = 0; i < MAX_BENCHMARKS; i++) {
    const rowIndex = 8 + 2 + i; // B10..B14 (Benchmarki 1..5)
    const name = output[2 + i][0]; // 0 = kolumna nazwy (B), rząd: 0=Portfel,1=CPI,2..=Bench
    if (typeof name === 'string' && name.endsWith('*')) {
      sheetDashboard.getRange(rowIndex, 2).setFontColor('red');
    }
  }


  sheetDashboard.getRange('H3').setValue(lastUpdate);

  refreshBenchmarkHelperRangeFixed();

  SpreadsheetApp.flush();
  // Sprawdź, czy którykolwiek benchmark ma krótszą historię (nagłówek z '*')
  let hasShortHistory = false;
  for (let i = 0; i < MAX_BENCHMARKS; i++) {
    const colIndex = COL_FIRST_BENCH + i;
    const name = headers[colIndex];
    if (typeof name === 'string' && name.endsWith('*')) {
      hasShortHistory = true;
      break;
    }
  }

  // Ustaw/wyczyść komunikat w B15
  const infoCell = sheetDashboard.getRange('B15');
  if (hasShortHistory) {
    infoCell.setValue('* Brak wystarczającej historii dla tego benchmarku.');
  } else {
    infoCell.clearContent();
  }
}

/******************************************************
 * BLOK B – DLA UŻYTKOWNIKÓW
 * onEdit(e) + odświeżanie helper range w "Benchmarki Obliczenia"
 * Wersja ze stałym zakresem 8 kolumn:
 * Data + Portfel + CPI + Benchmark1..5
 ******************************************************/

const BENCH_UI_CONFIG = {
  headerRows: 6,
  tableStartRow: 7,  // tabela startuje w wierszu 7
  tableStartCol: 2,  // tabela startuje w kolumnie B (A = margines)
  // Helper range w zakładce obliczeniowej – start od kolumny AO (41)
  helperHeaderRowCalc: 1,
  helperStartColCalc: 41 
};

function onEdit(e) {
  const cfg = BENCH_UI_CONFIG;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== shBencharki) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();

  const tableRowStart = cfg.tableStartRow + 1;
  const tableColCheckbox = cfg.tableStartCol + 4; // kolumna "Pokaż na wykresie"

  if (row < tableRowStart || col !== tableColCheckbox) return;

  refreshBenchmarkHelperRangeFixed();
}


function refreshBenchmarkHelperRangeFixed() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = BENCH_UI_CONFIG;

  const sheetDashboard = ss.getSheetByName(shBencharki);
  const sheetCalc = ss.getSheetByName(shBencharkiObliczenia);
  if (!sheetDashboard || !sheetCalc) return;

  const lastRowCalc = sheetCalc.getLastRow();
  const lastColCalc = sheetCalc.getLastColumn();
  if (lastRowCalc < 2) return;

  const calcValues = sheetCalc.getRange(1, 1, lastRowCalc, lastColCalc).getValues();
  const headerRow = calcValues[0];

  const colIndexDate = 0;           // A
  const colIndexPortfolio = 2;      // C
  const colIndexCPI = 3;            // D
  const colIndexFirstBenchmark = 4; // E
  const maxBenchmarks = 5;

  // Start wykresu – pierwsza niezerowa wartość portfela
  let startRowIndex = 1;
  for (let i = 1; i < calcValues.length; i++) {
    const val = calcValues[i][colIndexPortfolio];
    if (val && Number(val) !== 0) {
      startRowIndex = i;
      break;
    }
  }

  // Benchmarki z nagłówków
  const benchmarks = [];
  for (let j = 0; j < maxBenchmarks; j++) {
    const colIndex = colIndexFirstBenchmark + j;
    let name = '';
    if (colIndex < headerRow.length) {
      name = headerRow[colIndex] || '';
    }
    benchmarks.push({
      name: name || ('Benchmark ' + (j + 1)),
      colIndex
    });
  }

  // Checkboxy z tabeli na zakładce Benchmarki
  // Wiersze:
  // 1 = Portfel
  // 2 = CPI
  // 3..7 = Benchmarki 1..5
  const tableStartRow = cfg.tableStartRow;
  const tableStartCol = cfg.tableStartCol;
  const rowsCount = 2 + maxBenchmarks;

  const checkboxRange = sheetDashboard.getRange(
    tableStartRow + 1,
    tableStartCol + 4,
    rowsCount,
    1
  );
  const checkboxValues = checkboxRange.getValues().map(r => !!r[0]);

  const showPortfolio = checkboxValues[0];
  const showCPI = checkboxValues[1];
  const showBenchmarks = [];
  for (let i = 0; i < maxBenchmarks; i++) {
    showBenchmarks.push(checkboxValues[2 + i] || false);
  }

  // Stały helper range: AO:AV (8 kolumn)
  const helperStartCol = cfg.helperStartColCalc; // AO = 41
  const helperHeaderRow = cfg.helperHeaderRowCalc; // 1

  const fixedHeaders = [
    'Data',
    'Portfel',
    'CPI',
    benchmarks[0].name,
    benchmarks[1].name,
    benchmarks[2].name,
    benchmarks[3].name,
    benchmarks[4].name
  ];

  // Nagłówki helpera
  sheetCalc.getRange(helperHeaderRow, helperStartCol, 1, fixedHeaders.length)
    .clearContent()
    .setValues([fixedHeaders])
    .setFontWeight('bold');

  // Dane helpera
  const sourceRows = calcValues.slice(startRowIndex);
  const helperData = sourceRows.map(row => {
    return [
      row[colIndexDate],                                    // Data zawsze
      showPortfolio ? row[colIndexPortfolio] : '',         // Portfel
      showCPI ? row[colIndexCPI] : '',                     // CPI
      showBenchmarks[0] ? row[benchmarks[0].colIndex] : '',
      showBenchmarks[1] ? row[benchmarks[1].colIndex] : '',
      showBenchmarks[2] ? row[benchmarks[2].colIndex] : '',
      showBenchmarks[3] ? row[benchmarks[3].colIndex] : '',
      showBenchmarks[4] ? row[benchmarks[4].colIndex] : ''
    ];
  });

  // Czyścimy cały stały obszar helpera poniżej nagłówka
  const maxRowsToClear = Math.max(sheetCalc.getMaxRows() - helperHeaderRow, helperData.length + 50);
  sheetCalc.getRange(helperHeaderRow + 1, helperStartCol, maxRowsToClear, fixedHeaders.length).clearContent();

  // Wpisujemy nowe dane
  if (helperData.length > 0) {
    sheetCalc.getRange(helperHeaderRow + 1, helperStartCol, helperData.length, fixedHeaders.length)
      .setValues(helperData);

    // Format daty
    sheetCalc.getRange(helperHeaderRow + 1, helperStartCol, helperData.length, 1)
      .setNumberFormat('yyyy-MM-dd');
  }

  SpreadsheetApp.flush();
}