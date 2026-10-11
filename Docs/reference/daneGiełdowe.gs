function runKursy(){
  const startTime = new Date();  
  PropertiesService.getScriptProperties().setProperty('br_status', '1');
  PropertiesService.getScriptProperties().setProperty('br_fail_count', '0');
  kurs(startTime);
}

const DISABLE_FT = false;
const DISABLE_BR = false;
const DISABLE_BOSSA = false;
const DISABLE_Yahoo = false;
const DISABLE_GFin = false;

// Sprawdź czy zmienne są zdefiniowane, jeśli nie - zdefiniuj lokalnie
if (typeof kl_MetaleSurowce === 'undefined') {
  var kl_MetaleSurowce = "Metale i surowce";
}

if (typeof kl_AkcjeZagr === 'undefined') {
  var kl_AkcjeZagr = "Akcje zagraniczne";
}

function kurs(startTime) {

  const timeLimit = 1000 * 60 * 4.5; // Limit czasu wykonywania skryptu: 4,5 minuty
  let runningTime = new Date().getTime() - startTime.getTime(); // Czas wykonania skryptu
  
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(shPortfolio);
  const dataRange = sheet.getRange(2, 2, sheet.getLastRow() - 1, 4).getValues(); // Pobranie danych z arkusza portfela

  const sheetTech = spreadsheet.getSheetByName(shTechniczny);
  const lastRow = sheetTech.getRange(1, 4).getNextDataCell(SpreadsheetApp.Direction.DOWN).getRow();
  let currentTickers = sheetTech.getRange(2, 4, lastRow, 1).getValues(); // Pobranie aktualnych tickerów
  let currentPrices = sheetTech.getRange(2, 4, lastRow, 6).getValues(); // Pobranie aktualnych cen
  let currentPricesFormulas = sheetTech.getRange(2, 4, lastRow, 6).getFormulas(); // Pobranie formuł cen

  currentTickers = filterEmptyArrays(currentTickers); // Usunięcie pustych wierszy z tickerów
  currentPrices = updatePricesFromFormulas(currentPrices, currentPricesFormulas); // Aktualizacja cen na podstawie formuł
  currentPrices = filterEmptyArrays(currentPrices); // Usunięcie pustych wierszy z cen
  const currencies = getUniqueCurrencies(dataRange); //Lista unikatowych walut
  const rates = fetchBackupCurrencyRates(currencies); //Pobieranie kursów walutowych
  Logger.log(`Waluty w Portfolio: ${currencies}`);
  //Logger.log(rates);

  let uniqueTickers = getUniqueTickers(dataRange); // Pobranie unikalnych tickerów z danych

  const TEST_TICKERS = []; // np. ['VT', 'VOO']

  if (TEST_TICKERS.length > 0) {
    uniqueTickers = uniqueTickers.filter(value => TEST_TICKERS.includes(value.split('___')[0]));
  }

  uniqueTickers.sort(); // Sortowanie tickerów

  GLOBAL_BOSSA_MAP = buildBossaQuotesMapForTickers(uniqueTickers);

  let newPrices = []; // Inicjalizacja nowej tablicy cen

  // Mapa: ticker -> indeks w newPrices
  const tickerIndexMap = {};

  // Zbuduj mapę istniejących cen po tickerze
  const currentPricesMap = {};
  currentPrices.forEach(row => {
    const t = row[0];
    if (t && !(t in currentPricesMap)) {
      currentPricesMap[t] = row;
    }
  });

  // Przypisanie istniejących cen do odpowiednich tickerów
  uniqueTickers.forEach(tickerValue => {
    const [ticker] = tickerValue.split('___');
    const existing = currentPricesMap[ticker];
    if (existing) {
      tickerIndexMap[ticker] = newPrices.length;
      newPrices.push(existing);
    }
  });

  Logger.log(`Przygotowano listę tickerów w Portfolio`);

  // dalej w kurs() używaj tickerIndexMap zamiast tickersWithPrice

  runningTime = new Date().getTime() - startTime.getTime(); // Aktualizacja czasu wykonania
  let catalystArray = [], catalystPrices = [], catalystInterest = [];  

  if (runningTime <= 0.5 * timeLimit) {
    catalystArray = getCatalystTickers(); // Pobranie tickerów Catalyst
    if (catalystArray.length > 0) {
      catalystPrices = getCatalystForArray(catalystArray); // Pobranie cen z Catalyst
      catalystInterest = getCatalystInterestForArray(catalystArray); // Pobranie odsetek z Catalyst
      Logger.log(`Pobrano ceny i odsetki Catalyst dla: ${catalystArray}`);
    }  
  }

  let gpwArray = getGPWTickers(uniqueTickers);
  let gpwPrices = [];
  let gpwPricesLoaded = false;

  let brStatus = PropertiesService.getScriptProperties().getProperty('br_status');
  runningTime = new Date().getTime() - startTime.getTime(); // Aktualizacja czasu wykonania
  
  if (runningTime <= 0.9 * timeLimit) {
    uniqueTickers.forEach(tickerValue => {
      const [ticker, klasaAktywow, waluta] = tickerValue.split('___');
      if (ticker === "") return; // Pomijanie pustych tickerów

      let kurs = '', zmiana = '', zmianaProc = '', odsetkiKorpo = '', nominalna = '';

      // Pobranie cen w zależności od klasy aktywów
      if (isBond(ticker, klasaAktywow)) {
        //Logger.log("Ticker: " + ticker + " | klasaAktywow: " + klasaAktywow + " | Waluta: " + waluta + " | Function: getBondPrice");
        kurs = getBondPrice(ticker);

      } else if (klasaAktywow === kl_AkcjePL) {
        //Logger.log("Ticker: " + ticker + " | klasaAktywow: " + klasaAktywow + " | Waluta: " + waluta + " | Function: getStockPrices");
        //[kurs, zmiana, zmianaProc] = getStockPrices(ticker, gpwPrices, waluta, brStatus);
        const stockData = getStockPrices(ticker, gpwArray, gpwPrices, gpwPricesLoaded, waluta, brStatus);
        [kurs, zmiana, zmianaProc] = stockData.results;
        gpwPrices = stockData.gpwPrices;
        gpwPricesLoaded = stockData.gpwPricesLoaded;

      } else if (klasaAktywow === kl_KorpoPL || catalystArray.includes(ticker)) {
        //Logger.log("Ticker: " + ticker + " | klasaAktywow: " + klasaAktywow + " | Waluta: " + waluta + " | Function: getCatalystPrices");
        [kurs, zmiana, zmianaProc] = getCatalystPrices(ticker, catalystPrices, brStatus);

      } else if (klasaAktywow === kl_Krypto) {
        //Logger.log("Ticker: " + ticker + " | klasaAktywow: " + klasaAktywow + " | Waluta: " + waluta + " | Function: getCryptoPrices");
        [kurs, zmiana, zmianaProc] = getCryptoPrices(ticker, waluta, brStatus);

      } else if (klasaAktywow === "Waluty") {
        //Logger.log("Ticker: " + ticker + " | klasaAktywow: " + klasaAktywow + " | Waluta: " + waluta + " | Function: (no price available)");
        kurs = ""; // Dla walut brak ceny

      } else {
        //Logger.log("Ticker: " + ticker + " | klasaAktywow: " + klasaAktywow + " | Waluta: " + waluta + " | Function: getOtherPrices");
        [kurs, zmiana, zmianaProc] = getOtherPrices(ticker, waluta, brStatus,klasaAktywow);
      }

      // Pobranie odsetek i wartości nominalnej dla obligacji
      if (catalystArray.includes(ticker)) {
        [odsetkiKorpo, nominalna] = getBondInterest(ticker, catalystInterest);
      }

      if(isBond_IZ(ticker, klasaAktywow) && nominalna == 1000){
        try {
          const wynik = pobierzNominalnaObecna(ticker);
          nominalna = (wynik !== null && wynik !== undefined && !isNaN(wynik)) ? wynik : 1000;
        } catch (error) {
          Logger.log('Błąd w pobierzNominalnaObecna dla ' + ticker + ': ' + error.toString());
          nominalna = 1000;
        }
      }

      //updatePricesArray(newPrices, tickersWithPrice, ticker, kurs, zmiana, zmianaProc, odsetkiKorpo, nominalna);
      updatePricesArray(newPrices, tickerIndexMap, ticker, kurs, zmiana, zmianaProc, odsetkiKorpo, nominalna);
      

      runningTime = new Date().getTime() - startTime.getTime(); // Aktualizacja czasu wykonania
      if (runningTime >= timeLimit) {
        Logger.log("Timeout!"); // Przekroczenie limitu czasu
        return;
      }
    });
  }

  //Dodanie kursów walut na koniec listy
  rates.forEach(rate => newPrices.push([rate[0], rate[1], rate[2], "", "", "", ""]));


  // Zapisanie nowych cen do arkusza
  if (newPrices.length > 0) {
    const sh = spreadsheet.getSheetByName(shTechniczny);
    sh.getRange("D2:J").clearContent(); // Czyszczenie poprzednich danych
    sh.getRange(2, 4, newPrices.length, newPrices[0].length).setValues(newPrices); // Wstawienie nowych danych
  }
}

function getStockPrices(ticker, gpwArray, gpwPrices, gpwPricesLoaded, waluta, brStatus) {
  const [bossaKurs, bossaZmiana, bossaZmianaProc, bossaNazwa] = getFromBossaBulkMap(ticker);
  if (!isNaN(bossaKurs) && bossaKurs !== '') {
    Logger.log(`${ticker} → kurs: ${bossaKurs}, zmiana: ${bossaZmiana} (${bossaZmianaProc}), nazwa: ${bossaNazwa}, źródło: BOSSA Bulk`);
    return { results: [bossaKurs, bossaZmiana, bossaZmianaProc], gpwPrices, gpwPricesLoaded };
  }

  if (!gpwPricesLoaded && brStatus === '1' && gpwArray.length > 0) {
    gpwPrices = getBRallStocks(gpwArray);
    gpwPricesLoaded = true;
    Logger.log(`Pobrano ceny akcji GPW z BR dopiero przy pierwszej potrzebie`);
  }

  const [kurs, zmiana, zmianaProc] = findGPWEntry(ticker, gpwPrices);
  if (!isNaN(kurs) && kurs !== '') {
    Logger.log(`${ticker} → kurs: ${kurs}, zmiana: ${zmiana} (${zmianaProc}), nazwa: | źródło: BR All`);
    return { results: [kurs, zmiana, zmianaProc], gpwPrices, gpwPricesLoaded };
  }

  const [yhKurs, yhZmiana, yhZmianaProc, yhNazwa] = getKursYahoo(ticker);
  if (!isNaN(yhKurs) && yhKurs !== '') {
    return { results: [yhKurs, yhZmiana, yhZmianaProc], gpwPrices, gpwPricesLoaded };
  }

  const [gfKurs, gfZmiana, gfZmianaProc] = getKursGFin(ticker, waluta);
  if (!isNaN(gfKurs) && gfKurs !== '') {
    return { results: [gfKurs, gfZmiana, gfZmianaProc], gpwPrices, gpwPricesLoaded };
  }

  if (brStatus === '1') {
    const brResults = getKursBiznesRadar(ticker, kl_AkcjePL);
    if (!isNaN(brResults[0]) && brResults[0] !== '') {
      return { results: brResults, gpwPrices, gpwPricesLoaded };
    }
  }

  if (shouldTryAnalizy(ticker)) {
    const anlResults = getKursAnalizy(ticker);
    if (!isNaN(anlResults[0]) && anlResults[0] !== '') {
      return { results: [anlResults[0], anlResults[1], anlResults[2]], gpwPrices, gpwPricesLoaded };
    }
  }

  return { results: ['', '', ''], gpwPrices, gpwPricesLoaded };
}

function getCatalystPrices(ticker, catalystPrices, brStatus) {
  const [bossaKurs, bossaZmiana, bossaZmianaProc, bossaNazwa] = getFromBossaBulkMap(ticker);
  if (!isNaN(bossaKurs) && bossaKurs !== '') {
    Logger.log(`${ticker} → kurs: ${bossaKurs}, zmiana: ${bossaZmiana} (${bossaZmianaProc}), nazwa: ${bossaNazwa}, źródło: BOSSA Bulk`);
    return [bossaKurs, bossaZmiana, bossaZmianaProc];
  }

  const entry = catalystPrices.find(entry => entry.symbol === ticker);
  if (entry && entry.value !== 'Not Found') {
    Logger.log(`${ticker} → kurs: ${entry.value}, zmiana: ${entry.change} (${entry.changeProc}), nazwa: | źródło: GPW Catalyst`);
    return [entry.value, entry.change, entry.changeProc];
  }

  if (brStatus === '1') {
    const brResults = getKursBiznesRadar(ticker, kl_KorpoPL);
    if (!isNaN(brResults[0]) && brResults[0] !== '') {
      return brResults;
    }
  }

  if (shouldTryAnalizy(ticker)) {
    const anlResults = getKursAnalizy(ticker);
    if (!isNaN(anlResults[0]) && anlResults[0] !== '') {
      return [anlResults[0], anlResults[1], anlResults[2]];
    }
  }

  return ['', '', ''];
}

function getCryptoPrices(ticker, waluta, brStatus) {  
  const tickerKurs = ticker.replace('/', '-');

  // Zero source: Yahoo
  const [yhKurs, yhZmiana, yhZmianaProc, yhNazwa] = getKursKryptoYahoo(ticker);
  if (!isNaN(yhKurs) && yhKurs !== '') {
    return [yhKurs, yhZmiana, yhZmianaProc];
  }
  
  // First source: Google Finance equivalent
  const gfinResults = getKursGFin(tickerKurs, waluta);
  
  if (!isNaN(gfinResults[0]) && gfinResults[0] !== '') {
    return gfinResults;
  }
  
  // Second source: Financial Times equivalent
  const ftResults = getKursFT(ticker, waluta);
  
  if (!isNaN(ftResults[0]) && ftResults[0] !== '') {
    return ftResults;
  }
  
  // Third source: Bossa  
  if (brStatus === "1") {
    const brResults = getKursBiznesRadar(ticker, kl_Krypto);    
    if (!isNaN(brResults[0]) && brResults[0] !== '') {
      return brResults;
    }
  }
  
  // If all sources fail
  //Logger.log(`No valid data found for ticker: ${ticker}. Returning empty values.`);
  return ['', '', ''];
}

function getOtherPrices(ticker, waluta, brStatus, opt_klasa) {
  // 1. BOSSA Bulk
  const [bossaKurs, bossaZmiana, bossaZmianaProc, bossaNazwa] = getFromBossaBulkMap(ticker);
  if (!isNaN(bossaKurs) && bossaKurs !== '') {
    Logger.log(`${ticker} → kurs: ${bossaKurs}, zmiana: ${bossaZmiana} (${bossaZmianaProc}), nazwa: ${bossaNazwa}, źródło: BOSSA Bulk`);
    return [bossaKurs, bossaZmiana, bossaZmianaProc];
  }

  const splitTicker = ticker.split(':');
  const hasExchangePrefix = splitTicker[1] != null;
  const isNotWSE = splitTicker[0] !== 'WSE';

  // 2. Zagranica z prefiksem giełdy: najpierw FT
  if (hasExchangePrefix && isNotWSE) {
    const ftResults = getKursFT(ticker, waluta);
    if (!isNaN(ftResults[0]) && ftResults[0] !== '') {
      return [ftResults[0], ftResults[1], ftResults[2]];
    }
  }

  // 3. Yahoo jako uniwersalny fallback przed BR
  const [yhKurs, yhZmiana, yhZmianaProc, yhNazwa] = getKursYahoo(ticker);
  if (!isNaN(yhKurs) && yhKurs !== '') {
    return [yhKurs, yhZmiana, yhZmianaProc];
  }

  // 4. Polska / inne lokalne -> BR
  if (brStatus === '1') {
    const brResults = getKursBiznesRadar(ticker, opt_klasa);
    if (!isNaN(brResults[0]) && brResults[0] !== '') {
      return brResults;
    }
  }

  // 5. Ostatni fallback tylko dla tickerów wyglądających jak ID funduszu / PPK / OFE / UFK
  if (shouldTryAnalizy(ticker)) {
    const anlResults = getKursAnalizy(ticker);
    if (!isNaN(anlResults[0]) && anlResults[0] !== '') {
      return [anlResults[0], anlResults[1], anlResults[2]];
    }
  }

  return ['', '', ''];
}

function getBondInterest(ticker, catalystInterest) {
  const entry = catalystInterest.find(entry => entry.symbol === ticker);
  if (entry && entry.interest !== 'Not Found') {
    return [entry.interest, entry.nominalna];
  } else {
    const url = '"https://gpwcatalyst.pl/o-instrumentach-instrument?nazwa="&INDIRECT("D"&row())';
    const xPathInterest = ';"/html/body/section[2]/div[2]/div[1]/div/table/tbody/tr[3]/td[2]"';
    const xPathNominalna = ';"/html/body/section[2]/div[2]/div[1]/div/table/tbody/tr[1]/td[2]"';
    const lang = ';"pl_PL"';
    
    return [
      `=iferror(IMPORTXML(${url}${xPathInterest}${lang});"")`,
      `=iferror(IMPORTXML(${url}${xPathNominalna}${lang});"")`
    ];
  }
}

function updatePricesArray(newPrices, tickerIndexMap, ticker, kurs, zmiana, zmianaProc, odsetkiKorpo, nominalna) {
  const tickerIndex = tickerIndexMap[ticker];
  let formattedDate = Utilities.formatDate(new Date(), 'CET', "yyyy-MM-dd HH:mm:ss");

  if (tickerIndex !== undefined) {
    // Ticker już istnieje w newPrices
    if (kurs === '') {
      if (newPrices[tickerIndex][2] === '') {
        // Brak kursu zarówno w nowym wpisie, jak i w istniejącym - dodajemy formułę VLOOKUP
        kurs = '=iferror(VLOOKUP(INDIRECT("D"&row());$K$3:$M;3;0);"")';
      } else if (newPrices[tickerIndex][2].toString().startsWith('=')) {
        // Kurs jest pusty, ale istniejąca wartość to formuła - zachowujemy istniejącą formułę
        kurs = newPrices[tickerIndex][2];
      } else {
        // Kurs jest pusty, używamy istniejącej wartości i nie aktualizujemy daty
        kurs = newPrices[tickerIndex][2];
        formattedDate = newPrices[tickerIndex][1];
      }
    }
    // Aktualizacja istniejącego wpisu
    newPrices[tickerIndex] = [ticker, formattedDate, kurs, odsetkiKorpo, zmiana, zmianaProc, nominalna];
  } else {
    // Ticker nie istnieje w newPrices - dodajemy nowy wpis
    if (kurs === '') {
      // Brak kursu - dodajemy formułę VLOOKUP
      kurs = '=iferror(VLOOKUP(INDIRECT("D"&row());$K$3:$M;3;0);"")';
    }
    newPrices.push([ticker, formattedDate, kurs, odsetkiKorpo, zmiana, zmianaProc, nominalna]);
  }
}

function getKursGFin(ticker, waluta) {   
  if (DISABLE_GFin) {
    return ["", "", "", ""];
  }
  var kurs = "";
  var zmianaLicz = "";
  var proc_zmiana = "";

  try {
    var inputTicker = ticker;
    var isCryptoOrCurrency = ticker.indexOf(":") === -1;
    
    var splitMyText = ticker.split(":");
    var originalExchange = splitMyText[0] || "";
    var originalSymbol = splitMyText[1] || splitMyText[0];

    if (splitMyText[1] != null) {
      ticker = splitMyText[1] + ":" + splitMyText[0];
    } else {
      ticker = splitMyText[0];
    }

    var url = "https://www.google.com/finance/quote/" + ticker;

    var options = {
      method: "get",
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": "Mozilla/5.0"
      }
    };

    var siteResponse = UrlFetchApp.fetch(url, options);

    if (siteResponse.getResponseCode() !== 200) {
      return ["", "", ""];
    }

    var websiteContent = siteResponse.getContentText();

    var dataCallbackPattern = /AF_initDataCallback\(\{[^}]*data:\s*(\[[\s\S]{1,15000}?\])\s*,\s*sideChannel/g;
    var allMatches = [];
    var match;
    
    while ((match = dataCallbackPattern.exec(websiteContent)) !== null) {
      allMatches.push(match[1]);
    }

    if (allMatches.length === 0) {
      return ["", "", ""];
    }

    var rawPrice = null;
    var rawChange = null;
    var rawChangePercent = null;
    var rawCurrency = null;

    // Ścieżka 1: Tickery z giełdą (WSE:PZU, NASDAQ:AAPL, COMEX:GC)
    if (!isCryptoOrCurrency) {
      var escapedSymbol = originalSymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var escapedExchange = originalExchange.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var tickerPattern = '\\["' + escapedSymbol + '","' + escapedExchange + '"\\]';
      var tickerBlockRegex = new RegExp(tickerPattern);

      for (var i = 0; i < allMatches.length; i++) {
        var dataBlock = allMatches[i];
        
        if (!tickerBlockRegex.test(dataBlock)) {
          continue;
        }

        if (rawCurrency === null) {
          var currencyMatch = dataBlock.match(
            new RegExp('\\["' + escapedSymbol + '","' + escapedExchange + '"\\],"[^"]+",\\d+,"([A-Z]{3})"')
          );
          if (currencyMatch) {
            rawCurrency = currencyMatch[1].toUpperCase;
          }
        }        

        var mainPattern = new RegExp('\\["' + escapedSymbol + '","' + escapedExchange + '"\\][^\\[]{0,300}\\[(\\d+\\.?\\d*),(-?\\d+\\.?\\d*),(-?\\d+\\.?\\d*)');
        var mainMatch = dataBlock.match(mainPattern);
        
        if (mainMatch) {
          rawPrice = parseFloat(mainMatch[1]);
          rawChange = parseFloat(mainMatch[2]);
          rawChangePercent = parseFloat(mainMatch[3]);
          if(rawCurrency === 'GBX'){
            rawPrice = rawPrice / 100
            rawChange = rawChange / 100
          }                  
          break;
        }
      }

      if (rawPrice === null) {
        for (var j = 0; j < allMatches.length; j++) {
          var block = allMatches[j];
          
          if (!tickerBlockRegex.test(block)) continue;
          
          var altPattern = /\[(\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*),\d+,\d+,\d+\]/;
          var altMatch = block.match(altPattern);
          
          if (altMatch) {
            rawPrice = parseFloat(altMatch[1]);
            rawChange = parseFloat(altMatch[2]);
            rawChangePercent = parseFloat(altMatch[3]);
            break;
          }
        }
      }
    } 
    // Ścieżka 2: Krypto i waluty (BTC-PLN, EUR-USD)
    else {
      // Szukamy bloków zawierających ticker
      for (var k = 0; k < allMatches.length; k++) {
        var cryptoBlock = allMatches[k];
        
        // Sprawdź, czy blok zawiera nasz ticker
        if (cryptoBlock.indexOf(inputTicker) === -1) {
          continue;
        }
        
        // Wzorzec: [liczba_6-7_cyfr.dziesiętne, liczba, liczba, 2, 2, cyfra]
        // To jest uniwersalny wzorzec dla BTC i innych krypto
        var cryptoPattern = /\[(\d+\.?\d*),(-?\d+\.?\d*),(-?\d+\.?\d*),\d+,\d+,\d+\]/;
        var cryptoMatch = cryptoBlock.match(cryptoPattern);
        
        if (cryptoMatch) {
          var candidatePrice = parseFloat(cryptoMatch[1]);
          
          // Dla BTC-PLN oczekujemy ceny w zakresie 5-7 cyfr (dziesiątki/setki tysięcy)
          // Dla innych krypto mogą być inne zakresy, więc nie filtrujemy zbyt mocno
          rawPrice = candidatePrice;
          rawChange = parseFloat(cryptoMatch[2]);
          rawChangePercent = parseFloat(cryptoMatch[3]);
          break;
        }
      }
    }

    if (rawPrice === null || isNaN(rawPrice)) {
      return ["", "", ""];
    }

    kurs = parseFloat(rawPrice.toFixed(getPrecision(rawPrice)));

    if (rawChange !== null && !isNaN(rawChange)) {
      zmianaLicz = parseFloat(rawChange.toFixed(getPrecision(rawPrice)));
      
      if (rawChangePercent !== null && !isNaN(rawChangePercent)) {
        proc_zmiana = parseFloat((rawChangePercent / 100).toFixed(6));
      }
    }

    if (!isNaN(kurs) && kurs !== '') {
      Logger.log(`${ticker} → kurs: ${kurs}, zmiana: ${zmianaLicz} (${proc_zmiana}), źródło: GFin`);
    }

    return [kurs, zmianaLicz, proc_zmiana];

  } catch (error) {
    Logger.log(`GFin: błąd dla ${ticker}: ${error.message}`);
    return ["", "", ""];
  }
}

function getKursFT(ticker, waluta) {
  if (DISABLE_FT) {
    return ["", "", "", ""];
  }

  var gfinRunned = 0;
  var yahooRunned = false
  var source = 'FT';
  const splitMyText = ticker.split(":");

  // Ticker bez giełdy (krypto, US bez prefiksu) lub COMEX → pomiń FT, idź najpierw do Yahoo, potem do GFin
  if (!ticker || !ticker.includes(':') || splitMyText[0] === 'COMEX') {
    let wyniki = getKursYahoo(ticker);

    if (!isNaN(wyniki[0]) && wyniki[0] !== '') {
      return wyniki;
    }

    gfinRunned = 1;
    wyniki = getKursGFin(ticker, waluta);
    wyniki.push('');
    return wyniki;
  }

  Utilities.sleep(500)

  // ============================================================
  // MAPA KODÓW GIEŁD: Google Finance → FT
  // ============================================================
  const exchangeMap = {
    "FRA":      "GER", // Frankfurt, Niemcy
    "GER":      "GER", // Niemcy (ogólnie rynek niemiecki)
    "ETR":      "GER", // Xetra, Niemcy (Frankfurt)
    "AMS":      "AEX", // Amsterdam, Holandia
    "EPA":      "PAR", // Paryż, Francja
    "LON":      "LSE", // Londyn, Wielka Brytania
    "NYSEARCA": "PCQ", // USA (fundusze / ETF-y)
    "NASDAQ":   "NMQ", // Nasdaq, USA
    "BIT":      "MIL", // Mediolan, Włochy
    "BME":      "MCE", // Madryt, Hiszpania
    "STO":      "OSL"  // Sztokholm → Oslo (Skandynawia)
  };

  // ============================================================
  // BUDOWANIE TICKERA FT
  // ============================================================
  const exchangeCode    = splitMyText[0];
  const symbol          = splitMyText[1].replace(/-/g, ' ');
  const walutaFT        = (waluta === 'GBP') ? 'GBX' : waluta;
  const kodGieldyFT     = exchangeMap.hasOwnProperty(exchangeCode)
    ? exchangeMap[exchangeCode]
    : exchangeCode;

  const tickerZWaluta   = symbol + ":" + kodGieldyFT + ":" + walutaFT;
  const tickerBezWaluty = symbol + ":" + kodGieldyFT;

  // ============================================================
  // POMOCNICZA: ODPYTYWANIE FT
  // ============================================================
  function fetchFT(endpoint, tickerParam) {
    const url = 'https://markets.ft.com/data/' + endpoint + '/tearsheet/summary?s=' + tickerParam;
    try {
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) {
        Logger.log(`FT: kod HTTP ${response.getResponseCode()} dla ${tickerParam}`);
        return null;
      }
      return response.getContentText();
    } catch (error) {
      Logger.log(`FT: błąd dla ${tickerParam}: ${error.message}`);
      return null;
    }
  }

  // ============================================================
  // POMOCNICZA: PARSOWANIE HTML
  // ============================================================
  function parsujStrone(websiteContent, walutaFT) {
    const priceTag = 'Price (' + walutaFT + ')';
    if (websiteContent.indexOf(priceTag) === -1) return null;

    // Kurs
    const priceTagLocation = websiteContent.indexOf(priceTag) + 55;
    const priceStart = websiteContent.indexOf('>', priceTagLocation);
    const priceEnd   = websiteContent.indexOf('<', priceTagLocation);
    let kurs = Number(websiteContent.substring(priceStart + 1, priceEnd).replace(',', ''));
    if (isNaN(kurs)) return null;

    // Zmiana dzienna
    const changeTag = "Today's Change";
    const pos = websiteContent.indexOf(changeTag);
    let changeText = '';

    const offset1    = pos + 150;
    const textStart1 = websiteContent.indexOf('>', offset1);
    const textEnd1   = websiteContent.indexOf('<', offset1);
    changeText = websiteContent.substring(textStart1 + 1, textEnd1).trim();

    let testArr = changeText.replace(/,/g, '.').replace(/[^\d.\-\/]/g, '').split('/');
    if (testArr.length !== 2 || isNaN(Number(testArr[0])) || isNaN(Number(testArr[1]))) {
      const offset2    = pos + 110;
      const textStart2 = websiteContent.indexOf('>', offset2);
      const textEnd2   = websiteContent.indexOf('<', offset2);
      changeText = websiteContent.substring(textStart2 + 1, textEnd2).trim();

      testArr = changeText.replace(/,/g, '.').replace(/[^\d.\-\/]/g, '').split('/');
      if (testArr.length !== 2 || isNaN(Number(testArr[0])) || isNaN(Number(testArr[1]))) {
        changeText = '0.00 / 0.00%';
      }
    }

    changeText = changeText.replace(/,/g, '.').replace('%', '').trim();
    const zmianaArr  = changeText.split('/');
    let zmiana       = Number(zmianaArr[0]);
    if (walutaFT === 'GBX') {
      kurs   /= 100;
      zmiana /= 100;
    }
    const zmianaProc = parseFloat((Number(zmianaArr[1]) / 100).toFixed(4));

    // Nazwa z <title>
    const titleStart = websiteContent.indexOf('<title>') + 7;
    const titleEnd   = websiteContent.indexOf('</title>');
    const titleText  = websiteContent.substring(titleStart, titleEnd);
    const nazwaRaw   = titleText.substring(0, titleText.lastIndexOf(',')).trim();
    const nazwa      = nazwaRaw
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .substring(0, 60);

    return [kurs, isNaN(zmiana) ? '' : zmiana, isNaN(zmianaProc) ? '' : zmianaProc, nazwa || ''];
  }

  // ============================================================
  // GŁÓWNA LOGIKA ODPYTYWANIA
  // ============================================================
  const NO_RESULTS = 'There were no results found for';
  let wyniki = null;

  // KROK 1: /etfs/ + ticker z walutą
  let content = fetchFT('etfs', tickerZWaluta);
  if (content && content.indexOf(NO_RESULTS) === -1) {
    wyniki = parsujStrone(content, walutaFT);
  }

  // KROK 2: /etfs/ + ticker bez waluty
  if (!wyniki) {
    content = fetchFT('etfs', tickerBezWaluty);
    if (content && content.indexOf(NO_RESULTS) === -1) {
      if (content.indexOf('<span>Equities</span>') !== -1) source = 'FT equities (redirected)';
      wyniki = parsujStrone(content, walutaFT);
    }
  }

  // KROK 3: /equities/ + ticker bez waluty (NMQ)
  if (!wyniki) {
    content = fetchFT('equities', tickerBezWaluty);
    if (content && content.indexOf(NO_RESULTS) === -1) {
      wyniki = parsujStrone(content, walutaFT);
      if (wyniki) source = 'FT equities';
    }
  }

  // KROK 3b: Jeśli NASDAQ → próbuj ponownie z NSQ zamiast NMQ
  if (!wyniki && exchangeCode === 'NASDAQ') {
    const tickerNSQ = symbol + ":NSQ";
    content = fetchFT('equities', tickerNSQ);
    if (content && content.indexOf(NO_RESULTS) === -1) {
      wyniki = parsujStrone(content, walutaFT);
      if (wyniki) source = 'FT equities NSQ';
    }
  }

  // KROK 4: Fallback – Yahoo
  if (!wyniki) {
    yahooRunned = true
    wyniki = getKursYahoo(splitMyText[0] + ':' + splitMyText[1]);
    if (!isNaN(wyniki[0]) && wyniki[0] !== '') {
      source = 'Yahoo';
    } else {
      // KROK 5: Fallback – Google Finance
      gfinRunned = 1;
      wyniki = getKursGFin(splitMyText[0] + ':' + splitMyText[1], waluta);
      wyniki.push('');
    }
  }

  const [kurs, zmiana, zmianaProc, nazwa] = wyniki;

  if (gfinRunned !== 1 && !yahooRunned) {
    Logger.log(`${tickerZWaluta} → kurs: ${kurs}, zmiana: ${zmiana} (${zmianaProc}), nazwa: ${nazwa} | źródło: ${source}`);
    //Logger.log(`${tickerZWaluta} [${kurs}, ${zmiana}, ${zmianaProc}] nazwa: "${nazwa}" source: ${source}`);
  }

  return [kurs, zmiana, zmianaProc, nazwa];
}

function getKursYahoo(ticker) { 

  if (DISABLE_Yahoo) {
    return ["", "", "", ""];
  }
  var originalTicker = String(ticker || '').trim().toUpperCase();
  var symbol = buildYahooSymbol(originalTicker);

  var name = null;
  var regularMarketPrice = null;
  var regularMarketPreviousClose = null;
  var changeNominal = null;
  var changePercent = null;

  var options = {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    }
  };

  // ----------------------------------------------------------
  // KROK 1: quoteType – nazwa instrumentu
  // ----------------------------------------------------------
  try {
    var typeUrl = 'https://query2.finance.yahoo.com/v1/finance/quoteType/?symbol=' +
      encodeURIComponent(symbol);

    var typeResp = UrlFetchApp.fetch(typeUrl, options);

    if (typeResp.getResponseCode() === 200) {
      var typeJson = JSON.parse(typeResp.getContentText());
      var typeResult = typeJson?.quoteType?.result?.[0];
      if (typeResult) {
        name = typeResult.longName || typeResult.shortName || symbol;
      }
    }
  } catch (e) {
    Logger.log('Błąd Yahoo quoteType: ' + e.message);
  }

  // ----------------------------------------------------------
  // KROK 2: chart – ceny, poprzednie zamknięcie, zmiana
  // ----------------------------------------------------------
  try {
    var chartUrl = 'https://query2.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(symbol) +
      '?range=5d&interval=1d';
    //Logger.log(chartUrl)
    var chartResp = UrlFetchApp.fetch(chartUrl, options);
    var chartCode = chartResp.getResponseCode();

    if (chartCode === 200) {
      var chartJson = JSON.parse(chartResp.getContentText());
      var result = chartJson?.chart?.result?.[0];
      var meta = result?.meta;
      var closes = result?.indicators?.quote?.[0]?.close || [];

      regularMarketPrice = meta?.regularMarketPrice ?? null;
      regularMarketPreviousClose = meta?.previousClose ?? null;
      currenyYahoo = meta?.currency ?? null;

      if (regularMarketPreviousClose == null) {
        var validCloses = closes.filter(function(v) {
          return v !== null && v !== undefined;
        });
        if (validCloses.length >= 2) {
          regularMarketPreviousClose = validCloses[validCloses.length - 2];
        }
      }

      if (regularMarketPrice != null && regularMarketPreviousClose != null) {
        regularMarketPrice = Number(regularMarketPrice);
        regularMarketPreviousClose = Number(regularMarketPreviousClose);
        if(currenyYahoo === 'GBp' && currenyYahoo != null){
          regularMarketPrice = regularMarketPrice / 100
          regularMarketPreviousClose = regularMarketPreviousClose / 100
        }

        changeNominal = regularMarketPrice - regularMarketPreviousClose;
        changePercent = (changeNominal / regularMarketPreviousClose) * 100;
      }
    } else if (chartCode === 404) {
      return ["", "", "", name || symbol];
    } else {
      Logger.log('Yahoo chart HTTP ' + chartCode + ' dla ' + symbol);
    }
  } catch (e) {
    Logger.log('Błąd Yahoo chart: ' + e.message);
  }

  // ----------------------------------------------------------
  // FORMAT WYJŚCIA:
  // [kurs, zmianaNominalna, zmianaProc, nazwa]
  // zmianaProc jako ułamek, np. 0.0123
  // ----------------------------------------------------------
  
  if (regularMarketPrice == null) {
    return ["", "", "", name || symbol];
  }

  var kurs       = Number(regularMarketPrice.toFixed(4));
  var zmianaNom  = changeNominal == null ? null : Number(changeNominal.toFixed(2));
  var zmianaProc = changePercent == null ? null : Number((changePercent / 100).toFixed(4));
  var nazwaFinal = name || symbol;

  Logger.log(
    originalTicker +
    " [" + symbol + "]" +
    " → kurs: " + kurs +
    ", zmiana: " + zmianaNom +
    " (" + zmianaProc + ")" +
    ", nazwa: " + nazwaFinal +
    " | źródło: Yahoo"
  );

  return [kurs, zmianaNom, zmianaProc, nazwaFinal];
}

function getKursKryptoYahoo(ticker) { 
  try {
    // Lista obsługiwanych walut fiat
    var supportedCurrencies = ['USD', 'EUR', 'PLN', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'];
    
    // Normalizacja tickera - zamiana / na -
    var normalizedTicker = ticker.replace('/', '-');
    
    // Sprawdź czy ticker zawiera giełdę (np. FRA:WBIT) - wtedy to ETF/akcja
    if (normalizedTicker.includes(':')) {
      //Logger.log('[Yahoo Crypto] Ticker zawiera giełdę (' + ticker + ') - przekazuję do standardowego Yahoo');
      return getKursYahoo(ticker);
    }
    
    // Spróbuj wykryć parę krypto-waluta
    var cryptoSymbol = null;
    var targetCurrency = null;
    
    // Przypadek 1: Format BTC-USD (z myślnikiem)
    if (normalizedTicker.includes('-')) {
      var parts = normalizedTicker.split('-');
      if (parts.length === 2 && supportedCurrencies.indexOf(parts[1]) !== -1) {
        cryptoSymbol = parts[0];
        targetCurrency = parts[1];
      }
    }
    
    // Przypadek 2: Format BTCUSD (bez separatora) - szukamy waluty na końcu
    if (!cryptoSymbol) {
      for (var i = 0; i < supportedCurrencies.length; i++) {
        var currency = supportedCurrencies[i];
        if (normalizedTicker.endsWith(currency) && normalizedTicker.length > currency.length) {
          cryptoSymbol = normalizedTicker.substring(0, normalizedTicker.length - currency.length);
          targetCurrency = currency;
          break;
        }
      }
    }
    
    // Jeśli nie wykryto pary krypto-fiat, przekaż do zwykłego Yahoo (prawdopodobnie ETF)
    if (!cryptoSymbol || !targetCurrency) {
      //Logger.log('[Yahoo Crypto] Nie wykryto pary krypto-fiat dla ' + ticker + ' - przekazuję do standardowego Yahoo');
      return getKursYahoo(ticker);
    }
    
    //Logger.log('[Yahoo Crypto] Wykryto parę: ' + cryptoSymbol + '-' + targetCurrency);
    
    // Jeśli docelowa waluta to USD, pobierz bezpośrednio
    if (targetCurrency === 'USD') {
      var standardTicker = cryptoSymbol + '-USD';
      return getKursYahoo(standardTicker);
    }
    
    // Dla innych walut: krypto w USD × para walutowa USD/TARGET
    var cryptoUSD = getKursYahoo(cryptoSymbol + '-USD');
    if (!cryptoUSD || cryptoUSD[0] === '') {
      Logger.log('[Yahoo Crypto] Brak danych dla ' + cryptoSymbol + '-USD');
      return ['', '', ''];
    }
    
    var forexPair = 'USD' + targetCurrency + '=X'; // USDPLN=X, USDEUR=X
    var usdTarget = getKursYahoo(forexPair);
    if (!usdTarget || usdTarget[0] === '') {
      Logger.log('[Yahoo Crypto] Brak kursu ' + forexPair);
      return ['', '', ''];
    }
    
    var btcUSD = cryptoUSD[0];
    var btcChangeUSD = cryptoUSD[1] || 0;
    var btcProcent = cryptoUSD[2] || 0;
    
    var usdTargetRate = usdTarget[0];
    var usdTargetProcent = usdTarget[2] || 0;
    
    // Kurs aktualny w walucie docelowej
    var kursTarget = btcUSD * usdTargetRate;
    
    // Kurs wczorajszy w walucie docelowej
    var btcUSDWczoraj = btcUSD - btcChangeUSD;
    var usdTargetWczoraj = usdTargetRate / (1 + usdTargetProcent);
    var kursTargetWczoraj = btcUSDWczoraj * usdTargetWczoraj;
    
    // Zmiana dzienna w walucie docelowej
    var zmianaTarget = kursTarget - kursTargetWczoraj;
    
    // Procent zmiany w walucie docelowej
    var procentTarget = zmianaTarget / kursTargetWczoraj;
    
    Logger.log(ticker + ' → kurs: ' + kursTarget.toFixed(2) + ', zmiana: ' + zmianaTarget.toFixed(2) + ' (' + (procentTarget * 100).toFixed(4) + '%), źródło: Yahoo');
    
    return [
      parseFloat(kursTarget.toFixed(2)),
      parseFloat(zmianaTarget.toFixed(2)),
      parseFloat(procentTarget.toFixed(6))
    ];
    
  } catch (error) {
    Logger.log('[Yahoo Crypto] błąd dla ' + ticker + ': ' + error.message);
    return ['', '', ''];
  }
}

function buildYahooSymbol(ticker) {
  // Specjalne mapowania własnych tickerów / aliasów → Yahoo
  const YAHOO_SPECIAL_SYMBOLS = {
    'COMEX:GCW00':     'GC=F',
    'GOLD-ZLOTO':      'GC=F',
    'COMEX:SIW00':     'SI=F',
    'SILVER-SREBRO':   'SI=F'
  };

  // Mapowanie prefiksów giełd na sufiksy Yahoo
  const YAHOO_EXCHANGE_MAP = {
    'WSE':    '.WA',
    'LON':    '.L',
    'NYSE':   '',
    'NASDAQ': '',
    'AMS':    '.AS',
    'EPA':    '.PA',
    'FRA':    '.DE',
    'GER':    '.DE',
    'ETR':    '.DE',
    'SWX':    '.SW',
    'CPH':    '.CO',
    'BIT':    '.MI',
    'EPA':    '.PA'
  };

  var t = String(ticker || '').trim().toUpperCase();
  if (!t) return '';

  // Krypto / pary walutowe
  if (t.indexOf('/') !== -1) {
    return t.replace('/', '-');
  }

  // Specjalne aliasy
  if (YAHOO_SPECIAL_SYMBOLS.hasOwnProperty(t)) {
    return YAHOO_SPECIAL_SYMBOLS[t];
  }

  // Format EXCHANGE:SYMBOL
  var parts = t.split(':');
  if (parts.length === 1) {
    return parts[0];
  }

  var exchange = parts[0];
  var symbol = parts[1];

  var suffix = YAHOO_EXCHANGE_MAP.hasOwnProperty(exchange)
    ? YAHOO_EXCHANGE_MAP[exchange]
    : '';

  return symbol + suffix;
}

function getKursBiznesRadar(ticker, opt_klasa) {  
  if (DISABLE_BR) {
    return ["", "", ""];
  }
  const props = PropertiesService.getScriptProperties();
  const br_status = props.getProperty('br_status');

  // ============================================================
  // Jeśli BR już oznaczony jako niedostępny, pomijamy
  // ============================================================
  if (br_status === '0') {
    Logger.log(`BiznesRadar: pominięty (oznaczony jako niedostępny) dla ${ticker}`);
    return ['', '', ''];
  }

  // ============================================================
  // Filtry wstępne: przypadki, w których BR pomijamy
  // ============================================================

  // 1) Ticker zawiera "_" → w ogóle pomijamy BR
  if (String(ticker).indexOf('_') !== -1) {
    //Logger.log(`BiznesRadar: pominięty (ticker zawiera "_") dla ${ticker}`);
    return ['', '', ''];
  }

  const tUpper = String(ticker || '').toUpperCase().trim();

  // 2) Akcje zagraniczne (np. kl_AkcjeZagr), ale nie ETF/ETN/ETC i nie kończy się na .TFI → pomijamy BR
  if (opt_klasa === kl_AkcjeZagr) {
    const isEtfLike =
      tUpper.startsWith('ETF') ||
      tUpper.startsWith('ETN') ||
      tUpper.startsWith('ETC');
    const endsWithTfi = tUpper.endsWith('.TFI');

    if (!isEtfLike && !endsWithTfi) {
      //Logger.log(`BiznesRadar: pominięty (akcje zagraniczne bez ETF/TFI) dla ${ticker}`);
      return ['', '', ''];
    }
  }

  // ============================================================
  // Budowa tickera
  // ============================================================

  // Krypto: zawsze przepinamy na .BTB → np. XRP/PLN → XRPPLN.BTB
  if (
    opt_klasa == kl_Krypto ||
    tUpper.endsWith('USD') ||
    tUpper.endsWith('PLN') ||
    tUpper.endsWith('EUR')
  ) {
    // dla krypto: usuwamy "/" i dodajemy .BTB
    ticker = ticker.replace('/', '') + '.BTB';
  }

  let splitMyText = ticker.split(':');
  if (splitMyText[0] === 'WSE' && splitMyText[1]) {
    ticker = splitMyText[1];
  }

  function incrementBrFailCount() {
    let failCount = Number(props.getProperty('br_fail_count') || '0');
    failCount++;
    props.setProperty('br_fail_count', String(failCount));

    if (failCount >= 3) {
      props.setProperty('br_status', '0');
      Logger.log(`BiznesRadar: ${failCount} awarie. Oznaczam źródło jako niedostępne.`);
    } else {
      Logger.log(`BiznesRadar: awaria nr ${failCount}. / 3`);
    }
  }

  try {
    const url = 'https://www.biznesradar.pl/notowania/' + ticker.toUpperCase();
    const siteResponse = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const responseCode = siteResponse.getResponseCode();

    // 404 = brak konkretnego instrumentu / URL-a, ale BR jako serwis działa
    if (responseCode === 404) {
      Logger.log(`BiznesRadar: 404 dla ${ticker} (brak instrumentu)`);
      return ['', '', ''];
    }

    // Awaria infrastrukturalna / limit / błąd serwera
    if ([429, 500, 502, 503, 504].includes(responseCode)) {
      incrementBrFailCount();
      return ['', '', ''];
    }

    // Inne nie-200 też traktujemy jako awarię źródła
    if (responseCode !== 200) {
      incrementBrFailCount();
      return ['', '', ''];
    }

    const websiteContent = siteResponse.getContentText();

    let priceHtmlSpanTagId  = 'class="profile_quotation"';
    const priceHtmlSpanTagId2 = 'class="profile_quotation" style="display:block"';

    if (websiteContent.indexOf(priceHtmlSpanTagId) === -1) {
      priceHtmlSpanTagId = priceHtmlSpanTagId2;
    }

    if (websiteContent.indexOf(priceHtmlSpanTagId) !== -1) {

      // Kurs – klasa q_ch_act
      const kursTag = 'class="q_ch_act">';
      const kursStart = websiteContent.indexOf(kursTag);
      const kurs = kursStart !== -1
        ? Number(
            websiteContent
              .substring(
                kursStart + kursTag.length,
                websiteContent.indexOf('<', kursStart + kursTag.length)
              )
              .replace(',', '.')
          )
        : NaN;

      // Zmiana nominalna – klasa q_ch_pkt
      const zmianaTag = 'class="q_ch_pkt';
      const zmianaTagIdx = websiteContent.indexOf(zmianaTag);
      const zmianaTagEnd = websiteContent.indexOf('>', zmianaTagIdx);
      const rawZmiana = zmianaTagEnd !== -1
        ? websiteContent.substring(
            zmianaTagEnd + 1,
            websiteContent.indexOf('<', zmianaTagEnd)
          )
        : '';
      const zmiana = rawZmiana !== ''
        ? Number(rawZmiana.replace(',', '.').replace('+', ''))
        : NaN;

      // Zmiana procentowa – klasa q_ch_per
      const procTag = 'class="q_ch_per';
      const procTagIdx = websiteContent.indexOf(procTag);
      const procTagEnd = websiteContent.indexOf('>', procTagIdx);
      const rawProc = procTagEnd !== -1
        ? websiteContent.substring(
            procTagEnd + 1,
            websiteContent.indexOf('<', procTagEnd)
          )
        : '';
      const zmianaProc = rawProc !== ''
        ? parseFloat(
            (
              Number(
                rawProc
                  .replace(',', '.')
                  .replace('(', '')
                  .replace(')', '')
                  .replace('%', '')
                  .replace('+', '')
              ) / 100
            ).toFixed(4)
          )
        : NaN;

      const results = [kurs, zmiana, zmianaProc];

      if (typeof kurs === 'number' && !isNaN(kurs) && kurs !== 0) {
        Logger.log(`${ticker} → kurs: ${kurs}, zmiana: ${zmiana} (${zmianaProc}), nazwa: | źródło: BR`);
        return results;
      }
    }

  } catch (err) {
    incrementBrFailCount();
    Logger.log(`BiznesRadar: błąd dla ${ticker.toUpperCase()}: ${err.message}`);
  }

  // Brak danych dla konkretnego tickera ≠ awaria całego BR
  return ['', '', ''];
}

var GLOBAL_BOSSA_MAP = {};

function normalizeBossaTicker(ticker) {
  let key = String(ticker || '').trim().toUpperCase();
  const split = key.split(':');
  if (split[0] === 'WSE' && split[1]) {
    key = split[1];
  }
  return key;
}

function fetchBossaCategoryRaw(categoryKey) {
  const url = 'https://bossa.pl/fl_api/API/GPW/v2/Q/C/' + categoryKey + '?_t=' + new Date().getTime();

  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      Logger.log('BOSSA BULK | HTTP ' + code + ' for ' + categoryKey);
      return null;
    }

    return JSON.parse(response.getContentText());
  } catch (err) {
    Logger.log('BOSSA BULK | error for ' + categoryKey + ': ' + err.message);
    return null;
  }
}

function getBestBossaPrice(t) {
  const quote = t._quote != null ? Number(String(t._quote).replace(',', '.')) : NaN;
  const quoteRef = t._quote_ref != null ? Number(String(t._quote_ref).replace(',', '.')) : NaN;

  if (!isNaN(quote) && quote > 0) return quote;
  if (!isNaN(quoteRef) && quoteRef > 0) return quoteRef;

  return '';
}

function getBestBossaChange(t, kurs) {
  let zmiana = t._change_pnts != null ? Number(String(t._change_pnts).replace(',', '.')) : NaN;
  let zmianaProc = t._change_proc != null ? Number(t._change_proc) : NaN;

  if (!isNaN(zmianaProc)) {
    zmianaProc = parseFloat((zmianaProc / 100).toFixed(4));
  } else {
    zmianaProc = '';
  }

  if (isNaN(zmiana)) {
    zmiana = '';
  }

  if ((zmiana === '' || zmianaProc === '') && kurs !== '') {
    const quoteRef = t._quote_ref != null ? Number(String(t._quote_ref).replace(',', '.')) : NaN;
    if (!isNaN(quoteRef) && quoteRef > 0) {
      const calcZmiana = parseFloat((kurs - quoteRef).toFixed(4));
      const calcZmianaProc = parseFloat((calcZmiana / quoteRef).toFixed(4));
      if (zmiana === '') zmiana = calcZmiana;
      if (zmianaProc === '') zmianaProc = calcZmianaProc;
    }
  }

  return [zmiana, zmianaProc];
}

function buildBossaMapFromCategory(tArray, targetMap) {
  if (!Array.isArray(tArray)) return;

  tArray.forEach(t => {
    const short = normalizeBossaTicker(t._symbol_short || '');
    if (!short) return;

    const kurs = getBestBossaPrice(t);
    const [zmiana, zmianaProc] = getBestBossaChange(t, kurs);
    const name = (t._symbol && String(t._symbol).trim()) || short;

    if (kurs !== '') {
      targetMap[short] = {
        value: kurs,
        change: zmiana,
        changeProc: zmianaProc,
        name: name
      };
    }
  });
}

function buildBossaQuotesMapForTickers(uniqueTickers) {
  const map = {};

  let needShares = false;
  let needNC = false;
  let needEtf = false;
  let needBonds = false;

  (uniqueTickers || []).forEach(value => {
    const parts = String(value || '').split('___');
    const ticker = normalizeBossaTicker(parts[0] || '');
    const klasa = String(parts[1] || '');

    if (!ticker) return;

    const isEtfLike =
      ticker.startsWith('ETF') ||
      ticker.startsWith('ETN') ||
      ticker.startsWith('ETC');

    if (isEtfLike) {
      needEtf = true;
      return;
    }

    if (klasa === kl_AkcjePL) {
      needShares = true;
      needNC = true;
      return;
    }

    if (klasa === kl_OblPL || klasa === kl_KorpoPL) {
      needBonds = true;
      return;
    }
  });

  if (needShares) {
    const jsonShares = fetchBossaCategoryRaw('_cat_shares');
    if (jsonShares && jsonShares._d && jsonShares._d[0] && jsonShares._d[0]._t) {
      buildBossaMapFromCategory(jsonShares._d[0]._t, map);
    }
  }

  if (needNC) {
    const jsonNC = fetchBossaCategoryRaw('_cat_nConnect');
    if (jsonNC && jsonNC._d && jsonNC._d[0] && jsonNC._d[0]._t) {
      buildBossaMapFromCategory(jsonNC._d[0]._t, map);
    }
  }

  if (needEtf) {
    const jsonEtf = fetchBossaCategoryRaw('_cat_etf');
    if (jsonEtf && jsonEtf._d && jsonEtf._d[0] && jsonEtf._d[0]._t) {
      buildBossaMapFromCategory(jsonEtf._d[0]._t, map);
    }
  }

  if (needBonds) {
    const jsonBonds = fetchBossaCategoryRaw('_cat_bonds');
    if (jsonBonds && jsonBonds._d && jsonBonds._d[0] && jsonBonds._d[0]._t) {
      buildBossaMapFromCategory(jsonBonds._d[0]._t, map);
    }
  }

  return map;
}

function getFromBossaBulkMap(ticker) {
  if (DISABLE_BOSSA) {
    return ['', '', '', ''];
  }  
  const key = normalizeBossaTicker(ticker);
  const entry = GLOBAL_BOSSA_MAP[key];
  if (!entry) return ['', '', '', ''];
  return [entry.value, entry.change, entry.changeProc, entry.name];
}

function getCatalystInterestForArray(bondSymbols) {
  //var bondSymbols = []

  var catalystInterest = [];

  // URLs
  var urls = ['https://gpwcatalyst.pl/o-instrumentach-instrumenty-notowane'];

  // Loop through URLs
  for (var i = 0; i < urls.length; i++) {
    var url = urls[i];

    try {
      // Fetch content for each URL
      var response = UrlFetchApp.fetch(url, {'muteHttpExceptions': true});
      //Logger.log(response.getResponseCode())
      var content = response.getContentText();

      // Loop through bondSymbols
      for (var j = 0; j < bondSymbols.length; j++) {
        var bondSymbol = bondSymbols[j];
        var symbolIndex = content.indexOf('<a href="o-instrumentach-instrument?nazwa=' + bondSymbol + '">');

        // Check if the symbol is present in the content
        if (symbolIndex !== -1) {   
   
          //bond interest
          var startString = '<td class="col10" style="vertical-align: middle" align="right">'
          var startIndex = content.indexOf(startString, symbolIndex);
          var endIndex = content.indexOf('</td>', startIndex);
          var bondInterest = content.substring(startIndex + startString.length, endIndex).trim();
          bondInterest = parseFloat(bondInterest.replace(',', '.'));   

          //nominalna
          var startString2 = '<td  class="col8" style="vertical-align: middle" align="right">'
          var startIndex2 = content.indexOf(startString2, symbolIndex);
          var endIndex2 = content.indexOf('</td>', startIndex2);
          var nominalna = content.substring(startIndex2 + startString2.length, endIndex2).trim();
          nominalna = nominalna.replace(/&nbsp;|\s/g, ''); 

          // Replace comma with a dot if needed (for decimal compatibility)
          nominalna = parseFloat(nominalna.replace(',', '.'));

          // Check if bondSymbol is already in the result array
          var existingSymbolIndex = catalystInterest.findIndex(item => item.symbol === bondSymbol);

          // If the bondSymbol is not found or the new value is a number, update the result array
          //Logger.log(bondSymbol + ': ' + bondInterest ) 

          if (existingSymbolIndex === -1 && !isNaN(bondInterest)) {
            catalystInterest.push({ symbol: bondSymbol, interest: bondInterest, nominalna: nominalna});
          }          
        }
      }      
    } catch (error) {
      // Handle the error (you might want to log it or take some other action)
      Logger.log('Error fetching data from URL: ' +  url);
      Logger.log('Error details: ' + error);
    }
  }

  // Log the final result
  //Logger.log(catalystInterest);
  return catalystInterest;
}

function getCatalystForArray(bondSymbols) {
  //var bondSymbols = []
  var catalystPrices = [];

  // URLs
  var urls = [
    'https://gpwcatalyst.pl/notowania-obligacji-obligacje-korporacyjne',
    'https://gpwcatalyst.pl/notowania-obligacji-obligacje-skarbowe'
  ];

  // Loop through URLs
  for (var i = 0; i < urls.length; i++) {
    var url = urls[i];

    try {
      // Fetch content for each URL
      var response = UrlFetchApp.fetch(url, {'muteHttpExceptions': true});
      var content = response.getContentText();

      const priceTableDiv = content.match(/<table[^>]*>[\s\S]*?<\/table>/);
      if (priceTableDiv) {
        const rows = priceTableDiv[0].match(/<tr[^>]*>[\s\S]*?<\/tr>/g);

        for (let i = 1; i < rows.length; i++) {
          const rawCells = rows[i].match(/<td[^>]*>([\s\S]*?)<\/td>/g);             
          if (rawCells) {

            const cells = rawCells.map(cell => cell.replace(/<[^>]*>/g, "").trim());

            // Regular expression to detect tickers with 2 or 3 letters followed by 4 digits
            const tickerPattern = /^[A-Z]{2,3}\d{4,5}$/;

            // Determine if the first cell is a ticker or a full name
            let tickerIndex = tickerPattern.test(cells[0]) ? 0 : 1;

            const ticker = cells[tickerIndex]; 
            const market = cells[tickerIndex + 1].substring(0, 3);
            const prevPrice = parseFloat(cells[tickerIndex + 3].replace(',', '.'));
            const price = parseFloat(cells[tickerIndex + 9].replace(',', '.'));
            const change = parseFloat((price - prevPrice).toFixed(2));
            const changeProc = parseFloat((price / prevPrice - 1).toFixed(4));
            //Logger.log(`Ticker: ${ticker}, Market: ${market}, PrevPrice: ${prevPrice}, Price: ${price}, Change: ${change}, ChangeProc: ${changeProc}`);

            // Check if ticker is in bondSymbols, market is "GPW", and ticker is not already in catalystPrices
            if (bondSymbols.includes(ticker) && market === "GPW" && !catalystPrices.some(entry => entry.symbol === ticker) && !isNaN(price) && !isNaN(prevPrice)) {
              catalystPrices.push({ symbol: ticker, value: price, change: change, changeProc: changeProc });
            }
          }            
        }
      } 
    } catch (error) {
      // Handle the error (you might want to log it or take some other action)
      Logger.log('Error fetching data from URL: ' +  url);
      Logger.log('Error details: ' + error);
    }
  }

  // Log the final result
  //Logger.log(catalystPrices);
  return catalystPrices;
}

function getBRallStocks(stockTickers) {
  const timeLimit = 1000 * 60 * 0.5 //około 30s na wyciągnięcie kursów od momemntu startu
  const startTime = new Date();
  let runningTime = new Date().getTime() - startTime.getTime();

  var stockTickers = stockTickers.map(function (item) {
    // Check if the item starts with "WSE:"
    if (item.indexOf("WSE:") === 0) {
      // Remove the prefix
      return item.substring(4);
    }
    // If it doesn't start with "WSE:", return the original item
    return item;
  });

  var gpwPrices = [];

  // URLs
  var urls = [
    'https://www.biznesradar.pl/gielda/akcje_gpw',
    'https://www.biznesradar.pl/gielda/newconnect'
  ];

  // Loop through URLs
  for (var i = 0; i < urls.length; i++) {
    var url = urls[i];

    try {
      // Fetch content for each URL
      var response = UrlFetchApp.fetch(url, { 'muteHttpExceptions': true });
      var content = response.getContentText();
      //Logger.log(response.getResponseCode())

      const priceTableDiv = content.match(/<table[^>]*>[\s\S]*?<\/table>/);
      if (priceTableDiv) {
        const rows = priceTableDiv[0].match(/<tr[^>]*>[\s\S]*?<\/tr>/g);

        for (let i = 1; i < rows.length; i++) {
          const rawCells = rows[i].match(/<td[^>]*>([\s\S]*?)<\/td>/g);             
          if (rawCells) {

            const cells = rawCells.map(cell => cell.replace(/<[^>]*>/g, "").trim());
            const ticker = cells[0].substring(0, 3);; 

            const prevPrice = parseFloat(cells[5].replace(',', '.'));
            const price = parseFloat(cells[2].replace(',', '.'));
            const change = parseFloat((price - prevPrice).toFixed(2));
            const changeProc = parseFloat((price / prevPrice - 1).toFixed(4));
            //Logger.log(`Ticker: ${ticker}, PrevPrice: ${prevPrice}, Price: ${price}, Change: ${change}, ChangeProc: ${changeProc}`);
            
            // Check if ticker is not already in gpwPrices
            if (stockTickers.includes(ticker) && !gpwPrices.some(entry => entry.ticker === ticker) && !isNaN(price)) {
              gpwPrices.push({ ticker: ticker, value: price, change: change, changeProc: changeProc });
            }           
          }            
        }
      } 
 
    } catch (error) {
      // Handle the error (you might want to log it or take some other action) 
      Logger.log('Error details:+'+ error);
    }
    
    runningTime = new Date().getTime() - startTime.getTime();
    //Logger.log(runningTime)
    if(runningTime > timeLimit){
      Logger.log("All BR check - Timeout!")
      //PropertiesService.getScriptProperties().setProperty('br_status', '0');
      break;
    }
  }

  // Log the final result
  //Logger.log(gpwPrices);
  return gpwPrices;
}

// ============================================================
// analizy.gs
// Pobieranie kursów funduszy PPK/TFI z API analizy.pl
//
// UWAGA: Używane API nie jest oficjalnie udokumentowane.
// Może ulec zmianie bez ostrzeżenia.
//
// Format tickera: PZU60, UNIMSS, UNI19
// ID funduszu pochodzi z URL strony analizy.pl, np.:
// https://www.analizy.pl/fundusze/ppk/PZU60 → ID: PZU60
// ============================================================

const ANL_TYPE = 'fio'; // Typ w URL – nie ma wpływu na wynik API

function getKursAnalizy(ticker) {

  // ============================================================
  // ZAPYTANIE DO API
  // ============================================================
  const url = `https://www.analizy.pl/api/quotation/${ANL_TYPE}/${ticker.trim().toUpperCase()}`;
  let response = null;

  try {
    response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (e) {
    //Logger.log(`Analizy.pl: błąd połączenia dla ${ticker}: ${e.message}`);
  }


  // ============================================================
  // PARSOWANIE JSON
  // ============================================================
  let data = null;
  if (response !== null && response.getResponseCode() === 200) {
    try {
      data = JSON.parse(response.getContentText());
    } catch (e) {
      Logger.log(`Analizy.pl: nieprawidłowy JSON dla ${ticker}: ${e.message}`);
    }
  } else if (response !== null) {
    //Logger.log(`Analizy.pl: kod HTTP ${response.getResponseCode()} dla ${ticker}.`);
  }


  // ============================================================
  // EKSTRAKCJA NOTOWAŃ
  // ============================================================
  const prices = data?.series?.[0]?.price;
  const nazwa  = data?.label ?? "";

  const lastEntry = prices?.at(-1);
  const prevEntry = prices?.at(-2);

  const last = lastEntry?.value ?? "";
  const prev = prevEntry?.value ?? "";


  // ============================================================
  // KALKULACJA ZMIANY
  // ============================================================
  const change    = (last !== "" && prev !== "") ? Math.round((last - prev) * 100) / 100 : "";
  const changePct = (last !== "" && prev)        ? Math.round((last / prev - 1) * 10000) / 10000 : "";


  // ============================================================
  // FALLBACK – jeśli nie udało się pobrać kursu, próbuj Bankier.pl
  // ============================================================
  if (last === "") {
    //Logger.log(`Analizy.pl: brak danych dla ${ticker}. Przełączam na Bankier.pl.`);
    return getKursBankier(ticker);
  }


  // ============================================================
  // WYNIK
  // Format: [kurs, zmiana, zmiana%, nazwa]
  // ============================================================
  const results = [last, change, changePct, nazwa];
  Logger.log(`${ticker} → kurs: ${last}, zmiana: ${change} (${changePct}), nazwa: ${nazwa} | źródło: Analizy.pl`);

  return results;
}

function shouldTryAnalizy(ticker) {
  const id = String(ticker || '').trim().toUpperCase();

  if (!id) return false; 

  // RĘCZNA LISTA WYJĄTKÓW:
  // Każdy kolejny ticker dodaj po przecinku, najlepiej WIELKIMI LITERAMI, np. 'ABC123_X_PLN'.
  const MANUAL_ANALIZY_TICKERS = [
     
  ];

  if (MANUAL_ANALIZY_TICKERS.includes(id)) return true;

  if (id.includes(':')) return false;
  if (id.includes('/')) return false;

  // Typowe ID funduszy / PPK / OFE / UFK:
  // 1) 2-6 liter + 1-3 cyfry + opcjonalnie 1 litera na końcu, np. PZU60, UNI19, MON20, EWIN1, PZU68S
  // 2) bardziej złożone ID z segmentami po "_" i walutą na końcu,
  //    np. FTI022_NH1_PLN, FTI033_N_PLN, FTI068_AH_EUR, SIS176_AH_PLN, BGF057_A2_USD
  if (/^(?:[A-Z]{2,6}\d{1,3}[A-Z]?|[A-Z]{3,6}\d{3}_[A-Z]{1,3}\d?[A-Z]?_[A-Z]{3})$/.test(id)) {
    return true;
  }

  return false;
}


// ============================================================
// bankier.gs
// Pobieranie kursów funduszy PPK/TFI z bankier.pl (backup dla analizy.pl)
//
// Bankier.pl używa tych samych ID funduszy co analizy.pl (np. PZU60, QRS32)
// PPK i fundusze otwarte mają różne ścieżki URL:
//   FIO:  https://www.bankier.pl/fundusze/notowania/QRS32
//   PPK:  https://www.bankier.pl/ppk/notowania/PZU60
//
// Skrypt próbuje najpierw URL dla funduszy (/fundusze/),
// jeśli nie znajdzie danych – próbuje URL dla PPK (/ppk/).
// ============================================================

const BANKIER_URLS = [
  'https://www.bankier.pl/fundusze/notowania/',
  'https://www.bankier.pl/ppk/notowania/'
];

function getKursBankier(ticker) {
  const id = ticker.trim().toUpperCase();
  let html = null;

  // ============================================================
  // POBIERANIE HTML – próbuj obu URLi
  // ============================================================
  for (const baseUrl of BANKIER_URLS) {
    const url = baseUrl + id;
    let response;

    try {
      response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    } catch (e) {
      Logger.log(`Bankier.pl: błąd połączenia dla ${url}: ${e.message}`);
      continue;
    }

    if (response.getResponseCode() === 200) {
      const candidate = response.getContentText();
      // Weryfikacja przez atrybut data-symbol w sekcji HTML (nie CSS)
      if (candidate.includes(`data-symbol=\"${id}\"`)) {
        html = candidate;
        //Logger.log(`Bankier.pl: dane znalezione pod ${url}`);
        break;
      }
    }
  }

  if (!html) {
    //Logger.log(`Bankier.pl: nie znaleziono danych dla "${ticker}". Sprawdź czy ID funduszu jest poprawne.`);
    return ["", "", "", ""];
  }


  // ============================================================
  // EKSTRAKCJA DANYCH przez regex na atrybutach HTML
  // Szukamy po unikalnych data-atrybutach i strukturze tagów,
  // nie po nazwach klas (które są też w bloku <style>)
  // ============================================================

  // Nazwa: <section ... data-symbol="QRS32" ...>...<div class="...symbol">NAZWA</div>
  const nazwa = extractByDataSymbol(html, id);

  // Cena: <span class="a-quote-item -value">297,96 PLN</span>
  // szukamy pierwszego wystąpienia -value po sekcji data-symbol
  const sectionStart = html.indexOf(`data-symbol=\"${id}\"`);
  const section = sectionStart !== -1 ? html.substring(sectionStart, sectionStart + 3000) : "";

  const last      = extractByRegex(section, /class=\"a-quote-item -value\"[^>]*>([^<]+)</, 1);
  const changePct = extractByRegex(section, /class=\"a-quote-item -percentage-change[^\"]*\"[^>]*>([^<]+)</, 1);
  const changeNom = extractByRegex(section, /class=\"a-quote-item -value-change[^\"]*\"[^>]*>([^<]+)</, 1);


  // ============================================================
  // KONWERSJA – bankier używa przecinków i spacji (np. "297,96 PLN", "-0,60")
  // ============================================================
  const lastNum      = parsePolishNumber(last);
  const changeNum    = parsePolishNumber(changeNom);
  const changePctNum = parsePolishNumber(changePct) !== "" ? parsePolishNumber(changePct) / 100 : "";


  // ============================================================
  // WYNIK
  // Format: [kurs, zmiana, zmiana%, nazwa]
  // ============================================================
  const results = [lastNum, changeNum, changePctNum, nazwa];

  Logger.log(lastNum !== ""
    ? `${ticker} → kurs: ${lastNum}, zmiana: ${changeNum} (${changePctNum}), nazwa: ${nazwa} | źródło: Bankier.pl`
    : `Bankier.pl: brak danych cenowych dla ${ticker}`
  );

  return results;
}

// ============================================================
// POMOCNICZA – wyciąga nazwę funduszu z sekcji data-symbol
// Szuka tagu z klasą *__symbol wewnątrz sekcji funduszu
// ============================================================
function extractByDataSymbol(html, id) {
  try {
    const sectionStart = html.indexOf(`data-symbol="${id}"`);
    if (sectionStart === -1) return "";
    const section = html.substring(sectionStart, sectionStart + 1000);

    // Nazwa jest w pierwszym tagu po klasie __symbol
    const match = section.match(/__symbol[^>]*>([^<]+)</);
    return match ? match[1].trim() : "";
  } catch (e) {
    Logger.log(`Bankier.pl extractByDataSymbol błąd: ${e.message}`);
    return "";
  }
}

// ============================================================
// POMOCNICZA – wyciąga wartość przez regex
// ============================================================
function extractByRegex(html, regex, group) {
  try {
    const match = html.match(regex);
    return match ? match[group].trim() : "";
  } catch (e) {
    Logger.log(`Bankier.pl extractByRegex błąd: ${e.message}`);
    return "";
  }
}

// ============================================================
// POMOCNICZA – konwertuje polskie liczby na float
// ============================================================
function parsePolishNumber(str) {
  if (!str || str.trim() === "") return "";
  const cleaned = str.replace(/[^0-9,.\-]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? "" : num;
}

function getPrecision(number) {
  // Convert the number to a string
  var numString = number.toString();

  // Check if the number contains a decimal point
  if (numString.indexOf('.') !== -1) {
    // Get the substring after the decimal point
    var decimalPart = numString.split('.')[1];

    // Count the number of decimal places
    var precision = decimalPart.length;

    // Limit precision to a maximum of 6
    if (precision > 6) {
      precision = 6;
    }

    return precision;
  } else {
    // If there is no decimal point, return 0 precision
    return 0;
  }
}

function extractSingleNumericValue(inputString) {
  // Define a regular expression pattern to match numeric values
  var pattern = /[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\.\d+/;

  // Use RegExp.exec to find the first match in the input string
  var match = pattern.exec(inputString);

  // Convert the matched string to a numeric value
  var numericValue = match ? parseFloat(match[0].replace(/[^\d.]/g, '')) : null;

  return numericValue;
}

function removeDuplicatesFromArray(array) {
  return array.filter(function(item, index) {
    return array.indexOf(item) === index;
  });
}

function getCatalystTickers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var transakcjeSheet = ss.getSheetByName(shTransakcje);
  var portfolioSheet = ss.getSheetByName(shPortfolio);
  
  // Get last row with data in both sheets
  var lastRowT = transakcjeSheet.getLastRow();
  var lastRowP = portfolioSheet.getLastRow();
  
  // Get data range from columns C to L from Transakcje
  var data = transakcjeSheet.getRange("C2:L" + lastRowT).getValues();

  // Get data range from column B from Portfolio
  var dataP = portfolioSheet.getRange("B2:B" + lastRowT).getValues();
  
  // Initialize an object to store unique values
  var uniqueValues = {};
 
  // Loop through data to find unique values that meet conditions
  for (var i = 0; i < data.length; i++) {
    var value = data[i][0]; // Value from column C
    
    // Check conditions: kl_KorpoPL or kl_OblPL in column F and numeric value > 1 in column L
    if (dataP.flat().indexOf(value) !== -1 &&
        (data[i][3] === kl_KorpoPL || data[i][3] === kl_OblPL) && 
        typeof data[i][9] === "number" && data[i][9] > 1) {
      // Add value to uniqueValues object if it meets conditions
      uniqueValues[value] = true;
    }
  }
  
  // Convert uniqueValues object keys to an array
  var uniqueValuesArray = Object.keys(uniqueValues).sort();

  return uniqueValuesArray
  
  // Log the list of unique values
  //Logger.log("List of unique values from column C that meet conditions: " + uniqueValuesArray);
}

function filterEmptyArrays(array) {
  return array.filter(innerArray => innerArray[0] !== '');
}

function updatePricesFromFormulas(prices, formulas) {
  prices.forEach((price, i) => {
    if (formulas[i][2] !== '') {
      prices[i][2] = formulas[i][2];
    }
  });
  return prices;
}

function getUniqueTickers(dataRange) {
  const values = [];
  const uniqueTickers = [];
  
  dataRange.forEach(row => {
    const ticker = row[0].toString().toUpperCase();
    const value = `${ticker}___${row[2].toString()}___${row[3].toString()}`;

    if (value !== "___" && !values.includes(value) && !uniqueTickers.includes(ticker) && !ticker.startsWith("WALUTY_")) {
      values.push(value);
      uniqueTickers.push(ticker);
    }
  });

  return values;
}

function getGPWTickers(uniqueTickers) {
  return uniqueTickers.filter(value => value.split('___')[1] === kl_AkcjePL).map(value => value.split('___')[0]);
}

function isBond(ticker, klasaAktywow) {
  const bondsPrefixes = ['EDO', 'COI', 'ROS', 'ROD', 'TOS'];
  ticker = ticker.trim().toUpperCase();  // Normalize the ticker
  return bondsPrefixes.some(prefix => ticker.startsWith(prefix)) && klasaAktywow === kl_OblPL;
}

function isBond_IZ(ticker, klasaAktywow) {
  const bondsPrefixes = ['IZ'];
  ticker = ticker.trim().toUpperCase();  // Normalize the ticker
  return bondsPrefixes.some(prefix => ticker.startsWith(prefix)) && klasaAktywow === kl_OblPL;
}

function getBondPrice(ticker) {
  return `=VLOOKUP("${ticker}";${shObligacje}!$AK$2:$AL;2;0)`;
}

function findGPWEntry(ticker, gpwPrices) {
  const entry = gpwPrices.find(entry => entry.ticker === ticker);
  return entry ? [entry.value, entry.change, entry.changeProc] : ['', '', ''];
}



// ============================================================
// WALUTY
// ============================================================

function getUniqueCurrencies(dataRange) {
  const currencies = dataRange
    .map(row => row[3])           // kolumna E → indeks [3]
    .filter(c => c && c !== "PLN") // usuń puste i PLN
    .filter((c, i, arr) => arr.indexOf(c) === i); // unikalne wartości

  return currencies;
}

function fetchBackupCurrencyRates(currencies) {
  //currencies = ["EUR", "USD", "GBP",'SEK','CHF'];  
  const today = new Date();
  const results = [];
  
  currencies.forEach(function(currency) {
    //const rate = currency_rates(currency, today);
    var forexPair = currency + 'PLN'  + '=X'; 
    const rate = getKursYahoo(forexPair);
    const timestamp = Utilities.formatDate(new Date(), 'CET', "yyyy-MM-dd HH:mm:ss");
    results.push([currency, timestamp, rate]);
  });
  
  //Logger.log(results)  
  return results;
}

function currency_rates(waluta, data) {
  try {
    var MILLIS_PER_DAY = 1000 * 60 * 60 * 24;
    data = new Date(data);

    var endDate = new Date(data - 1 * MILLIS_PER_DAY);
    var startDate = new Date(endDate - 5 * MILLIS_PER_DAY);

    var startDateFormatted = Utilities.formatDate(startDate, 'UTC+1', 'yyyy-MM-dd');
    var endDateFormatted = Utilities.formatDate(endDate, 'UTC+1', 'yyyy-MM-dd');

    var myUrl = "https://api.nbp.pl/api/exchangerates/rates/a/" + waluta + "/" + startDateFormatted + "/" + endDateFormatted + "/?format=json";
    var jsonData = UrlFetchApp.fetch(myUrl, { muteHttpExceptions: true });

    if (jsonData.getResponseCode() == 200) {
      var json = JSON.parse(jsonData.getContentText());
      var last = json['rates'].length - 1;
      return json['rates'][last]['mid'];
    }

    Logger.log("NBP: HTTP " + jsonData.getResponseCode() + " dla " + waluta);
    return "";
  } catch (error) {
    Logger.log("NBP: błąd dla " + waluta + ": " + error.message);
    return "";
  }
}

