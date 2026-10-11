//@OnlyCurrentDoc
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu("📊 Inwestycje");

  menu.addItem("➕ Dodaj transakcję", "loadForm")
      .addSeparator()
      .addItem("🏦 Dodaj obligacje detaliczne do portfela", "loadFormObligacje")
      .addItem("💰 Sprzedaj obligacje detaliczne", "loadFormObligacjeSell")
      .addItem("🛠️ Zweryfikuj i zaktualizuj zakładkę Obligacje", "theGreatBeautifulBondsCleanupAct")
      .addSeparator()
      .addItem("🔄 Przelicz portfolio", "przeliczPortfolio")
      .addSeparator()
      .addItem("⚙️ Konfiguruj Multi-asset", "loadFormMultiasset")
      .addItem("🔀 Migruj dane z poprzedniej wersji arkusza", "copyDataFromPreviousVersion")
      .addSeparator()
      .addItem("📈 Wygeneruj benchmarki", "updateBenchmarks")
      .addItem("🧾 Wygeneruj podsumowanie sprzedaży", "generateSprzedazPodsumowanie");
  menu.addToUi();
}

/***********************
 * KONFIGURACJA
 ***********************/
const TRIGGER_DELAY_MINUTES = 7; // odstęp między kolejnymi jednorazowymi triggerami

const HANDLERS = {
  PORTFOLIO: 'run_przeliczPortfolio_once',
  KURSY: 'run_runKursy_once',
  DAILY_COPY: 'run_copyDailyAndPeriod_once',
  VERSION: 'run_otherDailyFunctions_once',
};

const SKIP_RUNKURSY_PROPERTY = 'SKIP_RUNKURSY_ONCE';

/***********************
 * GŁÓWNY HARMONOGRAM
 ***********************/
function masterDaily() {
  deleteManagedTriggers_();

  const now = new Date();

  const t1 = addMinutes_(now, 0 * TRIGGER_DELAY_MINUTES);
  const t2 = addMinutes_(now, 1 * TRIGGER_DELAY_MINUTES);
  const t3 = addMinutes_(now, 2 * TRIGGER_DELAY_MINUTES);
  const t4 = addMinutes_(now, 3 * TRIGGER_DELAY_MINUTES);

  scheduleOneTimeTrigger_(HANDLERS.PORTFOLIO, t1);
  Logger.log('[masterDaily] Utworzono trigger %s -> około %s', HANDLERS.PORTFOLIO, formatDateTime_(t1));

  scheduleOneTimeTrigger_(HANDLERS.KURSY, t2);
  Logger.log('[masterDaily] Utworzono trigger %s -> około %s', HANDLERS.KURSY, formatDateTime_(t2));

  scheduleOneTimeTrigger_(HANDLERS.DAILY_COPY, t3);
  Logger.log('[masterDaily] Utworzono trigger %s -> około %s', HANDLERS.DAILY_COPY, formatDateTime_(t3));

  scheduleOneTimeTrigger_(HANDLERS.VERSION, t4);
  Logger.log('[masterDaily] Utworzono trigger %s -> około %s', HANDLERS.VERSION, formatDateTime_(t4));

  Logger.log(
    '[masterDaily] Zaplanowano 4 jednorazowe triggery. Kolejność: przeliczPortfolio -> runKursy -> copyDailyValue+copyLastDaysOfPeriod(1) -> versionCheck. Odstęp: %s min.',
    TRIGGER_DELAY_MINUTES
  );
}

/***********************
 * WRAPPERY JEDNORAZOWE
 ***********************/
function run_przeliczPortfolio_once() {
  try {
    PropertiesService.getScriptProperties().setProperty(SKIP_RUNKURSY_PROPERTY, '1');
    przeliczPortfolio();
  } finally {
    PropertiesService.getScriptProperties().deleteProperty(SKIP_RUNKURSY_PROPERTY);
    deleteOwnTrigger_(HANDLERS.PORTFOLIO);
  }
}

function run_runKursy_once() {
  try {
    runKursy();
  } finally {
    deleteOwnTrigger_(HANDLERS.KURSY);
  }
}

function run_copyDailyAndPeriod_once() {
  try {
    copyDailyValue();
    copyLastDaysOfPeriod(1);
  } finally {
    deleteOwnTrigger_(HANDLERS.DAILY_COPY);
  }
}

function run_otherDailyFunctions_once() {
  try {
    versionCheck();
    transactionsSort();
  } finally {
    deleteOwnTrigger_(HANDLERS.VERSION);
  }
}



/***********************
 * INNE FUNKCJE
 ***********************/
function copyDailyValue() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sh1 = spreadsheet.getSheetByName(shDashboard);
  var sh2 = spreadsheet.getSheetByName(shHistoria);
  var shPortfolio = spreadsheet.getSheetByName("Portfolio");
  var timeZone = Session.getScriptTimeZone();

  // ===== KONFIGURACJA NAMED RANGES - EDYTUJ NAZWY TUTAJ =====
  var namedRanges = {
    gotowka: "Dashboard_Gotowka",
    akcjePL: "Dashboard_AkcjePL",
    akcjeZagr: "Dashboard_AkcjeZagr",
    obligacjePL: "Dashboard_ObligacjePL",
    obligacjeZagr: "Dashboard_ObligacjeZagr",
    obligacjeKorpPL: "Dashboard_ObligacjeKorpPL",
    obligacjeKorpZagr: "Dashboard_ObligacjeKorpZagr",
    metale: "Dashboard_MetaleSurowce",
    krypto: "Dashboard_Krypto",
    inne: "Dashboard_Inne",
    waluty: "Dashboard_Waluty",
    total: "Dashboard_Total",
    wplatyNetto: "Dashboard_WplatyNetto"
  };

  // Pobierz bieżącą datę w formacie rok-miesiąc-dzień
  var data = Utilities.formatDate(new Date(), timeZone, "yyyy-MM-dd");
  
  // ===== WALIDACJA KURSÓW WALUT I WYCEN PRZED POBRANIEM DANYCH =====
  validateCurrencyAndPortfolio(shPortfolio);
  
  // Pobierz wartości z Named Ranges (z zabezpieczeniem)
  var gotowka = getSafeValue(spreadsheet, namedRanges.gotowka);
  var akcjePL = getSafeValue(spreadsheet, namedRanges.akcjePL);
  var akcjeZagr = getSafeValue(spreadsheet, namedRanges.akcjeZagr);
  var obligacjePL = getSafeValue(spreadsheet, namedRanges.obligacjePL);
  var obligacjeZagr = getSafeValue(spreadsheet, namedRanges.obligacjeZagr);
  var obligacjeKorpPL = getSafeValue(spreadsheet, namedRanges.obligacjeKorpPL);
  var obligacjeKorpZagr = getSafeValue(spreadsheet, namedRanges.obligacjeKorpZagr);
  var metale = getSafeValue(spreadsheet, namedRanges.metale);
  var krypto = getSafeValue(spreadsheet, namedRanges.krypto);
  var inne = getSafeValue(spreadsheet, namedRanges.inne);
  var waluty = getSafeValue(spreadsheet, namedRanges.waluty);
  var total = getSafeValue(spreadsheet, namedRanges.total);
  var wplatyNetto = getSafeValue(spreadsheet, namedRanges.wplatyNetto);

  // Walidacja wartości numerycznych
  var valuesToValidate = {
    "Gotówka": gotowka,
    "Akcje PL": akcjePL,
    "Akcje zagr.": akcjeZagr,
    "Obligacje PL": obligacjePL,
    "Obligacje zagr.": obligacjeZagr,
    "Obligacje korp. PL": obligacjeKorpPL,
    "Obligacje korp. zagr.": obligacjeKorpZagr,
    "Metale": metale,
    "Kryptowaluty": krypto,
    "Inne": inne,
    "Waluty": waluty,
    "Total Portfolio": total,
    "Wpłaty Netto": wplatyNetto
  };
  
  validateNumericValues(valuesToValidate);

  // Formuły dla XIRR, Zysk/Strata oraz Drawdown
  var formulaXIRR = `=LET(
    currentRow; ROW();
    dataDo; INDEX($A:$A; currentRow);
    valueEnd; INDEX($M:$M; currentRow);
    cashFlows; FILTER(
      IF(Transakcje!\$G\$2:\$G="Wpłata środków"; -Transakcje!\$M\$2:\$M; 
        IF(Transakcje!\$G\$2:\$G="Wypłata środków"; Transakcje!\$M\$2:\$M; 0)
      );
      (Transakcje!\$B\$2:\$B<=dataDo)*(((Transakcje!\$G\$2:\$G="Wpłata środków")+(Transakcje!\$G\$2:\$G="Wypłata środków"))>0)
    );
    dates; FILTER(Transakcje!\$B\$2:\$B; (Transakcje!\$B\$2:\$B<=dataDo)*(((Transakcje!\$G\$2:\$G="Wpłata środków")+(Transakcje!\$G\$2:\$G="Wypłata środków"))>0));
    fullCash; {cashFlows; valueEnd};
    fullDates; {dates; dataDo};
    IFERROR(XIRR(fullCash; fullDates); "")
  )`;
  var formulaZyskStrata = '=INDIRECT("M"&row())-INDIRECT("N"&row())';
  var formulaDrawdown = '=(INDIRECT("M"&row())/ MAXIFS($M:$M;$A:$A;"<="&INDIRECT("A"&row())))-1';     

  // Dodaj nowy wiersz z danymi do arkusza shHistoria
  sh2.appendRow([
    data,
    gotowka,
    akcjePL, 
    akcjeZagr, 
    obligacjePL, 
    obligacjeZagr,
    obligacjeKorpPL, 
    obligacjeKorpZagr, 
    metale, 
    krypto, 
    inne, 
    waluty,
    total,
    wplatyNetto, 
    formulaXIRR,
    formulaZyskStrata,
    formulaDrawdown        
  ]);
    
  // Skopiuj dane z kolumny O do kolumny Q, kolumny M do kolumny N i kolumny Q do kolumny O
  var dataRange = sh2.getRange(3, 15, sh2.getLastRow() - 1, 3).getValues();
  sh2.getRange(3, 15, dataRange.length, 3).setValues(dataRange);

  // Zapisz datę i godzinę ukończenia operacji do dziennika zdarzeń
  Logger.log("Historia zakończona: " + Utilities.formatDate(new Date(), 'CET', "yyyy-MM-dd HH:mm:ss"));
}

function transactionsSort() {  

  // Pobierz arkusz aktywny w danym momencie
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  // Pobierz arkusz o nazwie shTransakcje (zmienna niezdefiniowana w tej funkcji)
  var sheet = spreadsheet.getSheetByName(shTransakcje);

  // Zapamiętaj istniejące kryteria filtrów
  var lastColumn = sheet.getLastColumn();
  var savedFilterCriteria = {};
  var existingFilter = sheet.getFilter();

  if (existingFilter != null) {
    for (var col = 1; col <= lastColumn; col++) {
      var criteria = existingFilter.getColumnFilterCriteria(col);
      if (criteria != null) {
        savedFilterCriteria[col] = criteria;
      }
    }
    existingFilter.remove();
  }

  // Pobierz numer ostatniej kolumny, utwórz zakres i dodaj filtr
  var range = sheet.getRange(1, 1, sheet.getLastRow(), lastColumn);
  range.createFilter();

  // Posortuj dane w filtrze według rodzaju transakcji: Zakup przed Sprzedażą - konieczne dla transakcji w tym samym dniu
  sheet.getFilter().sort(7, false); // Sortowanie według rodzaju transakcji: Zakup przed Sprzedażą - konieczne dla transakcji w tym samym dniu
  sheet.getFilter().sort(2, true); // Sortowanie według daty
  sheet.getFilter().remove();

  // Usuwanie spacji z tickerów
  var tickerRange = sheet.getRange(2, 3, sheet.getLastRow(), 1);
  var tickerValues = tickerRange.getValues();
  var cleanedTickers = tickerValues.map(function(row) {
    return [row[0].toString().replace(' ', '')];
  });

  // Ustawienie zaktualizowanych wartości tickerów na arkuszu
  tickerRange.setValues(cleanedTickers);

  // Przywrócenie filtrów użytkownika
  if (Object.keys(savedFilterCriteria).length > 0) {
    range.createFilter();
    var restoredFilter = sheet.getFilter();

    for (var col in savedFilterCriteria) {
      restoredFilter.setColumnFilterCriteria(Number(col), savedFilterCriteria[col]);
    }
  }
  Logger.log(
  'Transakcje posortowane: data ↑, typ transakcji ↓, tickery oczyszczone ze spacji, filtry użytkownika %s.',
  Object.keys(savedFilterCriteria).length > 0 ? 'przywrócone' : 'nie były ustawione'
);
}

function versionCheck() {
  // Pobierz aktywny arkusz i arkusz o nazwie shDashboard
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(shDashboard);
  // Pobierz aktualną wersję z komórki L1 arkusza shDashboard
  const currentVersion = sh.getRange(1, 12).getValue().split('\n')[0];  

  try {
    // Sprawdź dostępność strony internetowej
    var url = "https://inwestomat.eu/wlasny-arkusz-do-monitorowania-inwestycji/";
    var siteResponse = UrlFetchApp.fetch(url, {'muteHttpExceptions': true});
    if (siteResponse.getResponseCode() != 200) {
      lastVersion = "";
    } else {
      // Pobierz zawartość strony internetowej
      var websiteContent = siteResponse.getContentText();  
      var priceHtmlSpanTagId = 'Obecna wersja pliku:';
      
      // Sprawdź, czy zawartość strony zawiera informacje o wersji pliku
      if (websiteContent.indexOf(priceHtmlSpanTagId) == -1) {
        lastVersion = "";
      } else {
        // Pobierz najnowszą wersję z HTML strony
        var priceHtmlSpanTagIdLocation = websiteContent.indexOf(priceHtmlSpanTagId) + 18;       
        var priceTextStartLocation = websiteContent.indexOf(":", priceHtmlSpanTagIdLocation);
        var priceTextEndLocation = websiteContent.indexOf("</span>", priceHtmlSpanTagIdLocation);     
        var lastVersion = websiteContent.substring(priceTextStartLocation + 1, priceTextEndLocation).replace('<span dir="auto">', '').trim();
      }
    }   
  } catch (err) {
    Logger.log("Inwestomat padł... ")
    var lastVersion = "";
  }   

  // Wzorzec dla poprawnego formatu wersji
  var pattern = /^(\d{1,2}\.\d{1,2}(\.\d{1,2})?) z dnia (\d{2}\.\d{2}\.\d{4})\.$/;
  var isMatch = pattern.test(lastVersion);

  // Sprawdź, czy pobrana wersja pasuje do wzorca
  if (!isMatch) {
    Logger.log("Ciąg nie pasuje do oczekiwanego wzorca.");
    lastVersion = '';
  } 

  // Przygotuj wersję do porównania
  lastVersionToCompare = "Wersja " + lastVersion;
  Logger.log(lastVersionToCompare)
  Logger.log(currentVersion)

  // Porównaj aktualną wersję z pobraną
  if (currentVersion == lastVersionToCompare || lastVersionToCompare == "Wersja ")   {
    Logger.log("Brak nowej wersji");
    // Aktualizuj komórkę z wersją w arkuszu shDashboard, jeśli brak nowej wersji
    sh.getRange(1, 12).setValue(currentVersion).setFontColor('#000000').setFontSize(12);
  } else if(lastVersionToCompare == "Wersja 1.6 z dnia 24.09.2024." && currentVersion == "Wersja 1.6 z dnia 04.08.2024. (BETA v3)") {
    Logger.log("Brak wersji nowszej niż beta");
  }
  
  else {
    Logger.log("Nowa wersja dostępna");
    // Utwórz komunikat o dostępnej nowej wersji
    var text = (
      currentVersion  + 
      '\nDostępna nowa wersja: ' + lastVersion
    );  

    // Aktualizuj komórkę z wersją w arkuszu shDashboard, jeśli dostępna nowa wersja
    sh.getRange(1, 12).setValue(text).setFontColor('#cc0000').setFontSize(10);
  }
}

function kopiaZapasowa() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = ss.getName();

  // Pobierz aktualną datę i godzinę do użycia w nazwie pliku kopii zapasowej
  var now = new Date();
  var timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd'_'HH-mm-ss");
  
  // Zdefiniuj nazwę pliku kopii zapasowej
  var backupFileName = sheetName + '_' + timestamp;

  // Utwórz kopię arkusza
  ss.copy(backupFileName);
}

function copyLastDaysOfPeriod(periodLength) {
  // Sprawdź poprawność wartości periodLength
  if (![1, 3, 6, 12].includes(periodLength)) {
    periodLength = 1; // Ustawia domyślną wartość na 1, jeśli periodLength jest nieprawidłowy
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var historySheet = ss.getSheetByName("Historia");
  var summarySheet = ss.getSheetByName("Historia - podsumowanie");
  
  // Pobierz numer ostatniego wiersza z danymi w arkuszu Historia
  var lastRow = historySheet.getLastRow();
  
  // Pobierz wszystkie dane z arkusza Historia
  var data = historySheet.getRange("A2:Q" + lastRow).getValues();

  // Zainicjuj tablicę do przechowywania przefiltrowanych danych
  var filteredData = [];
  
  // Pętla filtrująca ostatnie dni każdego okresu
  var currentDate = new Date();
  var currentPeriod = -1;
  var periodFunction;

  if (periodLength >= 12) {
    periodFunction = function(date) {
      return date.getFullYear();
    };
  } else {
    periodFunction = function(date) {
      return Math.floor(date.getMonth() / periodLength);
    };
  }

  for (var i = data.length - 1; i >= 0; i--) {
    var rowDate = new Date(data[i][0]);
    var period = periodFunction(rowDate);
    
    if (period !== currentPeriod) {
      currentPeriod = period;
      if (periodLength >= 12) {
        currentDate = new Date(rowDate.getFullYear() + 1, 0, 0); // Pobierz ostatni dzień aktualnego roku
      } else {
        currentDate = new Date(rowDate.getFullYear(), period * periodLength + periodLength, 0);
      }
      filteredData.unshift(data[i]); // Dodaj ostatni dzień bieżącego okresu do przefiltrowanych danych
    }
    
    if (rowDate.getTime() === currentDate.getTime()) {
      if (periodLength >= 12) {
        currentDate.setFullYear(rowDate.getFullYear() - 1); // Przejdź do ostatniego dnia poprzedniego roku
      } else {
        currentDate.setDate(0); // Przejdź do ostatniego dnia poprzedniego okresu
      }
    }
  }
  
  // Wyczyść istniejące dane w arkuszu podsumowania, oprócz nagłówków
  summarySheet.getRange("A2:Q" + summarySheet.getLastRow() + 1).clear();
  
  // Wklej przefiltrowane dane do arkusza podsumowania
  if (filteredData.length > 0) {
    summarySheet.getRange(2, 1, filteredData.length, filteredData[0].length).setValues(filteredData);
  }
  Logger.log("Historia - podsumowanie ukończone: " + Utilities.formatDate(new Date(), 'CET', "yyyy-MM-dd HH:mm:ss"))
}

function scheduleIssueChecker() {
  // Usuń istniejące triggery dla issueChecker, żeby nie duplikować
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "issueChecker")
    .forEach(t => ScriptApp.deleteTrigger(t));

  // Dodaj trigger, który uruchomi się za ~1 sekundę
  ScriptApp.newTrigger("issueChecker")
    .timeBased()
    .after(1000)
    .create();

  SpreadsheetApp.getActiveSpreadsheet().toast(
    "Sprawdzanie błędów uruchomi się automatycznie w ciągu minuty.",
    "⏳ Issue Checker",
    10 // liczba sekund wyświetlania, -1 = zostaje aż do zamknięcia
  );
  Logger.log("Trigger dla Issue Checker dodany")
}

function issueChecker() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "issueChecker")
    .forEach(t => ScriptApp.deleteTrigger(t));

  var errorStatus = 0;
  var errorMessage = "";
  Logger.log("=== START issueChecker ===");

  // Sprawdź błędy w konfiguracji multiasset
  Logger.log("Sprawdzam konfigurację multiasset...");
  var multiassetErrorArray = getMultiassetsTickers();
  var multiassetError = multiassetErrorArray.length;
  if (multiassetError > 0) {
    errorStatus = 1;
    errorMessage += "Znaleziono fundusze multiasset, które nie zostały skonfigurowane: " + multiassetErrorArray;
    errorMessage += "\n";
  }
  if (multiassetError === 0) Logger.log("OK: nie znaleziono błędów multiasset.");
  
  // Sprawdź błędy w wielu walutach
  Logger.log("Sprawdzam spójność walut tickerów...");
  var currencyErrorArray = checkMultipleCurrencies();
  var currencyError = currencyErrorArray.length;
  if (currencyError > 0) {
    errorStatus = 2;
    if (errorMessage) {
      errorMessage += "\n"; // Dodaj znak nowej linii, jeśli errorMessage nie jest puste
    }
    errorMessage += "Znaleziono tickery z więcej niż jedną przypisaną walutą: " + currencyErrorArray;
  }
  if (currencyError === 0) Logger.log("OK: nie znaleziono błędów walut.");

  // Sprawdź formuły w Portfolio
  Logger.log("Sprawdzam formuły w zakładce Portfolio...");
  var portfolioFormulaErrorArray = checkPortfolioFormulas();
  var portfolioFormulaError = portfolioFormulaErrorArray.length;
  if (portfolioFormulaError > 0) {
    errorStatus = 3;
    if (errorMessage) errorMessage += "\n";
    errorMessage += portfolioFormulaErrorArray[0];
  }
  if (portfolioFormulaError === 0) Logger.log("OK: nie znaleziono braków formuł w Portfolio.");

  // Sprawdź oprocentowanie obligacji
  Logger.log("Sprawdzam oprocentowanie obligacji...");
  var oprErrorArray = porownajOprocentowanie();
  if (oprErrorArray.length > 0) {
    errorStatus = 4;
    if (errorMessage) errorMessage += "\n";
    errorMessage += "Oprocentowanie obligacji wymaga weryfikacji: " + oprErrorArray.join(', ') + ".\n" +
                    "Szczegóły błędu: Rozszerzenia → Apps Script → Uruchomienia → issueChecker" + ".\n" +
                    "Popraw dane ręcznie lub użyj Inwestycje -> Zweryfikuj i zaktualizuj zakładkę Obligacje";
  }

  // Wyświetl status błędu i komunikat
  Logger.log("Status błędu: " + errorStatus);
  Logger.log("Komunikat błędu: " + errorMessage);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(shDashboard); 
  var rangeError = sheet.getRange('B4');

  if (errorStatus > 0) {
    // Zastosuj formatowanie dla błędu
    rangeError.setFontWeight("bold");
    rangeError.setBackground("#FFDDDD"); // Jasnoczerwone tło
    rangeError.setHorizontalAlignment("center"); // Wyśrodkuj tekst
      
    // Dodaj notatkę do komórki
    rangeError.setValue("Znaleziono błędy!");
    rangeError.setNote(errorMessage);
  } else {
    // Wyczyść zawartość komórki, formatowanie i notatkę, jeśli nie ma błędu
    rangeError.clearContent();
    rangeError.setBackground("#FFFFFF");
    rangeError.clearNote();
  }
  Logger.log("=== KONIEC issueChecker ===");
}

function checkMultipleCurrencies() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var portfolioSheet = ss.getSheetByName('Portfolio');
  
  // Pobierz zakres danych z kolumny B (tickers) i kolumny E (currencies)
  var tickerRange = portfolioSheet.getRange('B2:B' + portfolioSheet.getLastRow());
  var currencyRange = portfolioSheet.getRange('E2:E' + portfolioSheet.getLastRow());
  
  // Pobierz wartości z kolumny B (tickers) i kolumny E (currencies)
  var tickers = tickerRange.getValues().flat();
  var currencies = currencyRange.getValues().flat();
  
  // Utwórz obiekt do przechowywania tickerów i przypisanych im walut
  var tickerCurrencies = {};
  
  // Przejdź przez dane i wypełnij obiekt tickerCurrencies
  for (var i = 0; i < tickers.length; i++) {
    var ticker = tickers[i];
    var currency = currencies[i];
    
    if (ticker && currency) {
      if (!tickerCurrencies[ticker]) {
        tickerCurrencies[ticker] = new Set();
      }
      tickerCurrencies[ticker].add(currency);
    }
  }
  
  // Sprawdź, czy którykolwiek ticker ma więcej niż jedną przypisaną walutę
  var tickersWithMultipleCurrencies = [];
  for (var ticker in tickerCurrencies) {
    if (tickerCurrencies[ticker].size > 1) {
      tickersWithMultipleCurrencies.push(ticker);
    }
  }
  
  // Zwróć wynik
  if (tickersWithMultipleCurrencies.length > 0) {
    //Logger.log("Tickers with more than one associated currency: " + tickersWithMultipleCurrencies.join(', '));
  } else {
    //Logger.log("No ticker has more than one associated currency.");
  }
  return tickersWithMultipleCurrencies;
}

function checkPortfolioFormulas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(shPortfolio);
  var lastRow = sheet.getLastRow();
  var errorRows = [];

  // Kolumny J-Q to indeksy 10-17
  var formulaStartCol = 10;
  var formulaEndCol = 17;
  var numCols = formulaEndCol - formulaStartCol + 1;

  // Pobierz wszystkie formuły w kolumnach J-Q jednym wywołaniem
  var formulas = sheet.getRange(2, formulaStartCol, lastRow - 1, numCols).getFormulas();

  for (var i = 0; i < formulas.length; i++) {
    var rowHasGap = formulas[i].some(cell => cell === "");
    if (rowHasGap) {
      errorRows.push(i + 2); // +2 bo zaczynamy od wiersza 2
    }
  }

  if (errorRows.length === 0) return [];

  if (errorRows.length > 5) {
    return ["Brakujące formuły w kolumnach J-Q zakładki Portfolio: problem dotyczy " + errorRows.length + " wierszy — sprawdź arkusz"];
  } else {
    return ["Brakujące formuły w kolumnach J-Q zakładki Portfolio, wiersze: " + errorRows.join(", ")];
  }
}

function historiaBackup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(shHistoria);
  var lastRow = sheet.getLastRow();
  var lastDate = sheet.getRange("A" + lastRow).getValue();
  var currentDate = new Date();

  Logger.log(lastRow)
  Logger.log(lastDate)
  
  // Wyodrębnij tylko datę z ostatniej daty
  var lastDateOnly = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
  
  // Wyodrębnij tylko datę z bieżącej daty
  var currentDateOnly = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  
  // Porównaj daty
  if (lastDateOnly.getTime() === currentDateOnly.getTime()) {
    Logger.log("Historia za dzisiaj została już zapisana.");
  } else {
    Logger.log("Brak historii za dzisiaj, skrypt został uruchomiony ponownie");
    masterDaily();
  }
}

/***********************
 * FUNKCJE POMOCNICZE
 ***********************/
function scheduleOneTimeTrigger_(handlerName, runAt) {
  ScriptApp.newTrigger(handlerName)
    .timeBased()
    .at(runAt)
    .create();
}

function deleteOwnTrigger_(handlerName) {
  const triggers = ScriptApp.getProjectTriggers();

  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i];

    if (
      trigger.getHandlerFunction() === handlerName &&
      trigger.getEventType() === ScriptApp.EventType.CLOCK
    ) {
      ScriptApp.deleteTrigger(trigger);
      break;
    }
  }
}

function deleteManagedTriggers_() {
  const managedHandlers = Object.values(HANDLERS);
  const triggers = ScriptApp.getProjectTriggers();

  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i];

    if (
      trigger.getEventType() === ScriptApp.EventType.CLOCK &&
      managedHandlers.indexOf(trigger.getHandlerFunction()) !== -1
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

function addMinutes_(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatDateTime_(date) {
  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm:ss'
  );
}

// ===== FUNKCJA POMOCNICZA - POBIERANIE NAMED RANGE =====
function getSafeValue(spreadsheet, rangeName) {
  try {
    var range = spreadsheet.getRangeByName(rangeName);
    if (range === null) {
      Logger.log("OSTRZEŻENIE: Named range '" + rangeName + "' nie istnieje. Użyto wartości 0.");
      return 0;
    }
    return range.getValue();
  } catch (e) {
    Logger.log("BŁĄD przy pobieraniu '" + rangeName + "': " + e + ". Użyto wartości 0.");
    return 0;
  }
}

// ===== FUNKCJA WALIDUJĄCA WARTOŚCI NUMERYCZNE =====
function validateNumericValues(valuesToValidate) {
  var errors = [];
  
  for (var fieldName in valuesToValidate) {
    var value = valuesToValidate[fieldName];
    if (typeof value !== 'number' || isNaN(value)) {
      errors.push(fieldName + " = '" + value + "' (typ: " + typeof value + ")");
    }
  }
  
  if (errors.length > 0) {
    var errorMessage = "BŁĄD WALIDACJI: Następujące pola nie są liczbami:\n" + errors.join("\n");
    Logger.log(errorMessage);
    throw new Error(errorMessage);
  }
}

// ===== FUNKCJA WALIDUJĄCA KURSY WALUT I WYCENY PORTFELA =====
function validateCurrencyAndPortfolio(shPortfolio) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var shPortfolio = spreadsheet.getSheetByName("Portfolio");
  
  var maxRow = shPortfolio.getLastRow();
  
  // Pobierz kolumny B (ticker), J (kursy walut) i N (wartość total) - jednym wywołaniem
  var tickerRange = shPortfolio.getRange(2, 2, maxRow - 1, 1); // Kolumna B
  var dataRange = shPortfolio.getRange(2, 10, maxRow - 1, 5); // Kolumny J do N (10-14)
  
  var tickers = tickerRange.getValues();
  var data = dataRange.getValues();
  
  var errors = [];
  
  for (var i = 0; i < data.length; i++) {
    var rowNum = i + 2; // Numer wiersza w arkuszu (zaczyna się od 2)
    var ticker = tickers[i][0]; // Kolumna B
    
    // Pomiń wiersz jeśli ticker jest pusty
    if (ticker === '' || ticker === null || ticker === undefined) {
      continue;
    }
    
    var kursWaluty = data[i][0]; // Kolumna J (indeks 0)
    var wartoscTotal = data[i][4]; // Kolumna N (indeks 4)
    
    // Sprawdź kolumnę J - kursy walut (czy są błędy)
    // Pomiń jeśli kurs jest pusty (może być dla aktywów w PLN)
    if (kursWaluty !== '' && kursWaluty !== null && kursWaluty !== undefined) {
      if (typeof kursWaluty === 'string' && kursWaluty.indexOf('#') === 0) {
        errors.push("Wiersz " + rowNum + " (Ticker: " + ticker + ", kolumna J): Błąd kursu waluty = '" + kursWaluty + "'");
      }
    }
    
    // Sprawdź kolumnę N - wartość total
    // Sprawdź czy wartość total to błąd
    if (typeof wartoscTotal === 'string' && wartoscTotal.indexOf('#') === 0) {
      errors.push("Wiersz " + rowNum + " (Ticker: " + ticker + ", kolumna N): Błąd wartości total = '" + wartoscTotal + "'");
    }
    
    // Sprawdź czy wartość total to zero (potencjalny problem z wyceną)
    if (typeof wartoscTotal === 'number' && wartoscTotal === 0) {
      errors.push("Wiersz " + rowNum + " (Ticker: " + ticker + ", kolumna N): Wartość total = 0 (możliwy problem z wyceną)");
    }
  }
  
  if (errors.length > 0) {
    var errorMessage = "BŁĄD WALIDACJI PORTFOLIO: Problem z kursami walut lub wyceną:\n" + errors.join("\n") + 
                       "\n\nHistoria NIE została zapisana. Sprawdź kursy walut i spróbuj ponownie.";
    Logger.log(errorMessage);
    throw new Error(errorMessage);
  }
  
  Logger.log("Walidacja Portfolio: OK - brak błędów kursów walut i wycen.");
}
