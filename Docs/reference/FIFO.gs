/*====================================================================================================================================*
  FIFO Script Credits: Keith Frislid - Think Stocks (https://www.youtube.com/watch?v=T47pgIS67_M&t=205s)
  ====================================================================================================================================
  Collaboration: rjscripts0001 with Planet Finance. Using Think Stocks FIFO Script with his permission to create our own Investment Portfolio Tracker and sharing it with our Planet Finance community.
  ====================================================================================================================================
  Instructions: 
  - If building tracker from scratch, copy this script and paste it in Script editor (Tools -> Script editor -> Paste Script -> Save -> Run -> Close Tab). 
  - If you downloaded the ready-to-use Planet Finance Investment Portfolio Tracker from collaboration websites or Patreon no need to copy/paste this code as the ready-to-use versions automatically include the script.
 *====================================================================================================================================*/

function generateTrade(stockQuant, stockPrice, action, totalPLN, waluta) {
  // Generuje obiekt reprezentujący transakcję
  return {
    shares: stockQuant,
    price: stockPrice,
    action: action,
    totalPLN: totalPLN,
    waluta: waluta
  };
}

function generateFifo(security, actions, quantity, price, totalCostPLN, currency, cena_nominalna) {
  // Generuje portfel FIFO na podstawie danych transakcyjnych  
  //Logger.log(security.length)
  let portfolio = new Map();  
  for(var i = 0; i<security.length; i++){
    let ticker = security[i].toString();
    let category = ticker.split("##")[2]
    let action = actions[i].toString();
    let stockQuant = Number(quantity[i]);
    let stockPrice = Number(price[i]);
    let nominalna = Number(cena_nominalna[i]);
    if(category == kl_KorpoPL || (category == kl_OblPL && nominalna > 1)){
      if (nominalna == 1) {nominalna = 100}
      stockPrice = 100*Number(totalCostPLN[i]) /  Number(quantity[i]) / Number(currency[i]) / nominalna
    } else{
      stockPrice = Number(totalCostPLN[i]) /  Number(quantity[i]) / Number(currency[i])
    }    
    let totalPLN = Number(totalCostPLN[i]) / stockQuant;
    let waluta = Number(currency[i]);
    let trade = generateTrade(stockQuant, stockPrice, action, totalPLN, waluta);

    // Obsługa różnych rodzajów transakcji
    if(action == "Wpłata środków" || action == "Zakup" || action.toUpperCase() == "DRIP"){
      let activeTrades = portfolio.get(ticker);
      if(activeTrades == null){
        portfolio.set(ticker, [trade]);
      } else {
        activeTrades.push(trade);
      }
    }

    if(action.toUpperCase() == "SPLIT"){
      let activeTrades = portfolio.get(ticker);
      let ratio = quantity[i].toString().split(":");
      activeTrades = activeTrades.map((trade) =>{
        trade.shares = trade.shares * ratio[0];
        trade.price = trade.price / ratio[0];
        trade.shares = trade.shares / ratio[1];
        trade.price = trade.price * ratio[1];
        trade.totalPLN = trade.totalPLN / ratio[0];
        trade.totalPLN = trade.totalPLN * ratio[1];
      });
    }

    if(action == "Sprzedaż"){
      let activeTrades = portfolio.get(ticker);
      let precision = 8;

      
      if (activeTrades == null || activeTrades.length === 0) {
        throw "Próbujesz sprzedać aktywo, którego nie posiadasz w portfelu - sprawdź dane transakcji: "
        + "\nKonto: " + ticker.split("##")[0]
        + "\nTicker: " + ticker.split("##")[1]
        + "\nKlasa aktywów: " + ticker.split("##")[2]
        + "\nWaluta: " + ticker.split("##")[3];
      }

      let sharesToSell = Number(Number(trade.shares).toFixed(precision));
      while (sharesToSell > 0){
        sharesToSell = Number(Number(sharesToSell).toFixed(precision));

        if (activeTrades.length > 0){
          let itemToSell = activeTrades[0];
          itemToSell.shares = Number(Number(itemToSell.shares).toFixed(precision));

          if(itemToSell.shares == sharesToSell){
            sharesToSell = 0;
            activeTrades.splice(0,1);
          } else if(itemToSell.shares < sharesToSell){
            sharesToSell -= itemToSell.shares;
            activeTrades.splice(0,1);
          } else {
            itemToSell.shares -= sharesToSell;
            sharesToSell = 0;
          }

        } else {
          throw "Próbujesz sprzedać więcej jednostek, niż posiadasz w portfelu - popraw transakcję: "
            + ticker.split("##")[1] + " (Konto: " + ticker.split("##")[0] + ")";
        }
      }

      if(activeTrades.length == 0){
        portfolio.delete(ticker);
      }
    }
  }
  return portfolio;
}

function przeliczPortfolio(){
  // Oblicza wartości portfela na podstawie transakcji FIFO
  const startTime = new Date();
  Logger.log("Start skryptu Przelicz Portfolio: " + Utilities.formatDate(new Date(), 'CET', "yyyy-MM-dd HH:mm:ss"))

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheetSource = spreadsheet.getSheetByName(shTransakcje);
  var sheetTarget = spreadsheet.getSheetByName(shPortfolio);  

  // BLOK 1: ODCZYT I WCZYTANIE DANYCH  
  var dataRange = sheetSource.getRange("A2:M").getValues();
  dataRange = removeEmptyLines(dataRange);  
  Logger.log(`Wczytano ${dataRange.length} wierszy z zakładki Transakcje`);

  // BLOK 2: FILTROWANIE + SORTowanie chronologiczne (FIFO: Split → Zakup → Sprzedaż)
  const validActions = ["Zakup", "DRIP", "Split", "Sprzedaż", "Wpłata środków"];
  const dataRangeFiltered = dataRange.filter(transakcja => validActions.includes(transakcja[6]));

  const priority = {
    "Split": 1,        // 1. Split modyfikuje istniejące
    "Zakup": 2,        // 2. Zakup dodaje nowe pozycje  
    "Sprzedaż": 3,     // 3. Sprzedaż usuwa (musi być PO zakupie)
    "DRIP": 4,
    "Wpłata środków": 4
  };

  dataRangeFiltered.sort((a, b) => {
    let dateA = new Date(a[1]); // B = data (YYYY-MM-DD → 00:00:00)
    let dateB = new Date(b[1]);
    
    if (dateA < dateB) return -1;
    if (dateA > dateB) return 1;
    
    // Ten sam dzień: priorytet + tie-breaker ticker + oryginalny indeks
    let prioA = priority[a[6]] || 99;
    let prioB = priority[b[6]] || 99;
    
    if (prioA !== prioB) return prioA - prioB;
    
    // Tie-breaker: ticker (Zakup  przed Sprzedaż )
    let tickerA = (a[2] || '').toString();
    let tickerB = (b[2] || '').toString();
    if (tickerA !== tickerB) return tickerA.localeCompare(tickerB);
    
    // Stabilność: oryginalna kolejność w dataRange
    return dataRange.indexOf(a) - dataRange.indexOf(b);
  });
  Logger.log(`Dane gotowe: ${dataRangeFiltered.length} transakcji (${Utilities.formatDate(new Date(), 'CET', "yyyy-MM-dd HH:mm:ss")})`);

  // BLOK 3: PRZETWARZANIE FIFO
  let returnArry = []; 
  if (dataRangeFiltered.length > 0) {
    // var klucz = dataRangeFiltered.map(row => 
    //   row[0] + "##" + (row[2] || '').toString().toUpperCase() + "##" + row[5] + "##" + row[3]
    // );
    var klucz = dataRangeFiltered.map(row => {
      const rawTicker = (row[2] || '').toString();
      const isCash = rawTicker === 'Gotówka';
      const isCurrency = rawTicker.startsWith('Waluty_');
      const ticker = (isCash || isCurrency)
        ? rawTicker
        : rawTicker.toUpperCase();

      return row[0] + '##' + ticker + '##' + row[5] + '##' + row[3];
    });
    
    var [ , , , , , , rodzajTransakcji, liczba, cena, , kursWaluty, nominalna, totalPLN] = 
      transposeMatrix(dataRangeFiltered);

    
    let portfolio = generateFifo(klucz, rodzajTransakcji, liczba, cena, totalPLN, kursWaluty, nominalna);
    
    // BLOK 4: AGREGACJA POZYCJI
    portfolio.forEach((value, key) => {
      let shares = 0, totalCost = 0, totalPLN = 0, totalWaluta = 0;
      value.forEach(trade => {
        shares += trade.shares;
        totalCost += trade.shares * trade.price;
        totalWaluta += trade.shares * trade.waluta;
        totalPLN += trade.shares * trade.totalPLN;
      });

      var splitMyText = key.split("##");
      var account = splitMyText[0];
      var ticker = splitMyText[1];
      var category = splitMyText[2];
      var currency = splitMyText[3].toUpperCase();
      
      let name, avgPrice, avgWaluta;
      if (ticker == "Gotówka") {
        name = "Gotówka";
        ticker = "";
        shares = "";
        avgPrice = "";
        avgWaluta = "";
        totalPLN = ''; 
      } else {
        avgPrice = totalCost / shares;
        avgWaluta = totalWaluta / shares;
        name = '=VLOOKUP(INDIRECT("B"&ROW());Transakcje!$C$2:$E;3;0)';
      }
      
      returnArry.push([account, ticker, name, category, currency, shares, avgPrice, totalPLN, avgWaluta]);
    });
    
  }

  // BLOK 5: ZAPIS + FORMATOWANIE
  if(returnArry.length > 0) {
    sheetTarget.getRange("A2:I").clearContent();
    sheetTarget.getRange(2, 1, returnArry.length, 9).setValues(returnArry);
  }
  Logger.log("Portfolio przygotowane i zapisane: " + Utilities.formatDate(new Date(), 'CET', "yyyy-MM-dd HH:mm:ss"))
  
  formatPorfolio();
  Logger.log("Formatowanie Portfolio zakończone: " + Utilities.formatDate(new Date(), 'CET', "yyyy-MM-dd HH:mm:ss"))
  

  const skipRunKursy = PropertiesService
    .getScriptProperties()
    .getProperty(SKIP_RUNKURSY_PROPERTY) === '1';

  if (!skipRunKursy) {
    PropertiesService.getScriptProperties().setProperty('br_status', '1');
    kurs(startTime);
  } else {
    Logger.log('[przeliczPortfolio] Pomijam runKursy(), bo przeliczPortfolio zostało uruchomione z masterDaily/run_przeliczPortfolio_once.');
  }
  
  Logger.log("Koniec skryptu Przelicz Portfolio: " + Utilities.formatDate(new Date(), 'CET', "yyyy-MM-dd HH:mm:ss"));

  //Tworzenie Triggera dla IssuesChecker
  scheduleIssueChecker();
}

function formatPorfolio() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(shPortfolio);
  
  var lastRow = sheet.getRange("A:A").getValues().filter(String).length;
  if (lastRow < 2) {
    return;
  }

  // Fetch data for columns A:N
  var dataRange = sheet.getRange(2, 1, lastRow - 1, 14).getValues(); // Columns A:N

  // Filter out rows based on column N and other conditions
  var filteredData = dataRange.filter(row => !(row[13] == 0 && row[13] !== "" && row[1] === "" && row[2] === "Gotówka"));

  // Sort data
  filteredData.sort((a, b) => {
    // Sort by column A (ascending), ignoring empty rows
    if (a[0] === "" && b[0] !== "") return 1;
    if (b[0] === "" && a[0] !== "") return -1;
    if (a[0] !== b[0]) return a[0] > b[0] ? 1 : -1;

    // Sort by column D (move "Gotówka" to the top, then ascending)
    if (a[3] === "Gotówka" && b[3] !== "Gotówka") return -1;
    if (b[3] === "Gotówka" && a[3] !== "Gotówka") return 1;
    if (a[3] !== b[3]) return a[3] > b[3] ? 1 : -1;

    // Sort by column N (descending)
    return b[13] - a[13];
  });

  // Clear content in columns A:I
  sheet.getRange(2, 1, lastRow - 1, 9).clearContent();

  // Write the cleaned and sorted data back to columns A:I
  if (filteredData.length > 0) {
    var outputData = filteredData.map(row => row.slice(0, 9)); // Extract only columns A:I
    sheet.getRange(2, 1, outputData.length, 9).setValues(outputData);
  }

  // Formatting for columns A:I
  var formattedRange = sheet.getRange(2, 1, filteredData.length, 9);
  formattedRange.setHorizontalAlignment('left')
    .setVerticalAlignment('middle')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
    .setFontFamily('Arial');

  sheet.getRange(2, 5, filteredData.length, 1) // Column E (Currency)
    .setHorizontalAlignment('center');

  sheet.getRange(2, 6, filteredData.length, 4) // Columns F to I
    .setHorizontalAlignment('right');
}

// Pomocnicza funkcja do transponowania macierzy
function transposeMatrix(matrix) {
  return matrix[0].map((col, i) => matrix.map(row => row[i]));
}

// Pomocnicza funkcja do usuwania pustych wierszy z tablicy
function removeEmptyLines(dataRange) {
  var filteredData = dataRange.filter(row => row.some(cell => cell !== ''));
  return filteredData;
}
