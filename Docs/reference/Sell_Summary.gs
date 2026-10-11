//@OnlyCurrentDoc
/**
 * SKRYPT: Generowanie podsumowania transakcji sprzedaży z parami Zakup-Sprzedaż
 * 
 * GŁÓWNE ZASADY DZIAŁANIA:
 * 1. Pobiera transakcje zakupu, sprzedaży, splitów i dywidend z arkusza "Transakcje"
 * 2. Grupuje transakcje według klucza: Konto##Ticker##Klasa##Waluta
 * 3. Koryguje ilości i ceny zakupów na podstawie splitów (SPLIT ADJUSTMENT)
 * 4. Dla każdej sprzedaży dopasowuje zakupy metodą FIFO (pierwsze kupione, pierwsze sprzedane)
 * 5. Dywidendy są obliczane dla każdej pary z uwzględnieniem już przetworzonych sprzedaży
 * 6. Prowizje są proporcjonalnie rozdzielane, z korektą w ostatnim wierszu dla danej sprzedaży
 * 7. Prowizje są ZAWSZE w PLN i dodawane/odejmowane po przeliczeniu ceny przez kurs FX
 * 8. Oblicza koszt zakupu, przychód ze sprzedaży, zysk, dywidendy i rentowność dla każdej pary
 * 9. Wszystkie wartości liczbowe (O-T) są wyliczane przez skrypt, nie przez formuły
 * 10. Kolumny Q i S zawierają zysk/stratę z dywidendą oraz rentowność z dywidendą
 * 
 * SPLIT ADJUSTMENT:
 * - Forward split (10:1): 100 akcji @ 50 PLN → 1000 akcji @ 5 PLN
 * - Reverse split (1:3): 300 akcji @ 2 PLN → 100 akcji @ 6 PLN
 * 
 * DYWIDENDY:
 * - Przypadek 1: Dywidenda między datą zakupu a datą sprzedaży (włącznie)
 * - Przypadek 2: Dywidenda PO sprzedaży (opóźniona wypłata) - tylko dla ostatniej pary z zakupu
 *   i tylko jeśli nie było kolejnego zakupu między sprzedażą a dywidendą
 * - Stan posiadania uwzględnia już przetworzone sprzedaże (FIFO)
 * - Jeśli dywidenda i sprzedaż są tego samego dnia, dywidenda należy się
 * - Dywidendy zaokrąglane do 4 miejsc po przecinku
 * 
 * KONFIGURACJA:
 * - includeWaluty: false = wyklucza transakcje na klasie "Waluty", true = uwzględnia wszystko
 */

function generateSprzedazPodsumowanie() {
  // === KONFIGURACJA ===
  var includeWaluty = false;
  
  // === INICJALIZACJA ARKUSZY ===
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheetSource = spreadsheet.getSheetByName(shTransakcje);
  var sheetTarget = spreadsheet.getSheetByName(shSellSummary);
  
  // === USUNIĘCIE FILTRÓW ===
  var filter = sheetTarget.getFilter();
  if(filter) {
    filter.remove();
    Logger.log("Usunięto aktywne filtry");
  }
  
  sheetTarget.getRange("A2:V").clearContent();
  
  // === POBRANIE I FILTROWANIE DANYCH ===
  var dataRange = sheetSource.getRange("A2:M").getValues();
  
  var dataFiltered = dataRange.filter(row => {
    if(!row[0] || !["Zakup","Sprzedaż","Split","Dywidenda / Odsetki"].includes(row[6])) return false;
    if(!includeWaluty && row[5] === "Waluty") return false;
    return true;
  });
  
  dataFiltered.sort((a,b) => new Date(a[1]) - new Date(b[1]));
  
  // === GRUPOWANIE TRANSAKCJI ===
  let tickers = new Map();
  dataFiltered.forEach(row => {
    // let key = `${row[0]}##${row[2]}##${row[5]}##${row[3]}`;
    // if(!tickers.has(key)) tickers.set(key, []);
    let key;

    if (row[6] === "Dywidenda / Odsetki") {
      let fullKey = `${row[0]}##${row[2]}##${row[5]}##${row[3]}`;
      let baseKey = `${row[0]}##${row[2]}##${row[5]}##`;

      let matchedKey = null;

      if (tickers.has(fullKey)) {
        matchedKey = fullKey;
      } else {
        matchedKey = Array.from(tickers.entries())
          .find(([k, txs]) =>
            k.startsWith(baseKey) &&
            txs.some(t => t.type === "Zakup" || t.type === "Sprzedaż")
          )?.[0];
      }

      key = matchedKey || fullKey;
    } else {
      key = `${row[0]}##${row[2]}##${row[5]}##${row[3]}`;
    }

    if(!tickers.has(key)) tickers.set(key, []);
    
    let splitRatio = 1;
    if(row[6] === "Split" && row[7]) {
      let splitParts = row[7].toString().split(':');
      if(splitParts.length === 2) {
        let numerator = parseFloat(splitParts[0]);
        let denominator = parseFloat(splitParts[1]);
        if(numerator > 0 && denominator > 0) {
          splitRatio = numerator / denominator;
        }
      }
    }
    
    tickers.get(key).push({
      date: new Date(row[1]),
      type: row[6],
      qty: row[6] === "Split" ? splitRatio : (parseFloat(row[7]?.toString().replace(',','.')) || 0),
      price: parseFloat(row[8]?.toString().replace(',','.')) || 0,
      fee: parseFloat(row[9]?.toString().replace(',','.')) || 0,
      fx: parseFloat(row[10]?.toString().replace(',','.')) || 0,
      //totalPLN: parseFloat(row[12]?.toString().replace(',','.').replace('zł','').trim()) || 0,
      totalPLN: Number(row[12]) || 0,
      name: row[4] || ''
    });

    //Logger.log(`TYPE=${row[6]} | KEY=${row[0]}##${row[2]}##${row[5]}##${row[3]}`);
  });

  
  
  // === TWORZENIE PAR Z DYWIDENDAMI ===
  let pairs = [];
  
  tickers.forEach((txs, key) => {
    let buys = txs.filter(t => t.type === "Zakup");
    let sells = txs.filter(t => t.type === "Sprzedaż");
    let splits = txs.filter(t => t.type === "Split");
    let dividends = txs.filter(t => t.type === "Dywidenda / Odsetki");
    //Logger.log(`DIV MATCH => baseKey=${baseKey} | matchedKey=${matchedKey} | finalKey=${key}`);
    
    // === KOREKTA SPLITÓW ===
    buys.forEach(buy => {
      let cumulativeSplitRatio = 1;
      splits.forEach(split => {
        if(split.date > buy.date) {
          cumulativeSplitRatio *= split.qty;
        }
      });
      
      if(cumulativeSplitRatio !== 1) {
        buy.qty = buy.qty * cumulativeSplitRatio;
        buy.price = buy.price / cumulativeSplitRatio;
        buy.fee = buy.fee * cumulativeSplitRatio;
      }
    });
    
    buys.sort((a,b) => a.date - b.date);
    
    // Zapamiętaj oryginalne ilości i inicjalizuj qtySold
    buys.forEach(buy => {
      buy.originalQty = buy.qty;
      buy.qtySold = 0;
    });
    
    // === FIFO Z DYWIDENDAMI ===
    sells.forEach(sell => {
      let remainingQty = sell.qty;
      let sellUnitFee = sell.fee / sell.qty;
      let remainingSellFee = sell.fee;
      
      // Zliczanie wierszy dla korekty prowizji
      let tempQty = remainingQty;
      let matchCount = 0;
      for(let i = 0; tempQty > 0 && i < buys.length; i++) {
        if(buys[i].qty > 0) {
          matchCount++;
          tempQty -= Math.min(tempQty, buys[i].qty);
        }
      }
      
      let currentMatch = 0;
      for(let i = 0; remainingQty > 0 && i < buys.length; i++) {
        let buy = buys[i];
        if(buy.qty > 0) {
          let matchQty = Math.min(remainingQty, buy.qty);
          let buyUnitFee = buy.fee / buy.qty;
          currentMatch++;
          
          let buyFee, sellFee;
          
          if(currentMatch === matchCount) {
            buyFee = Math.round((buyUnitFee * matchQty) * 100) / 100;
            sellFee = remainingSellFee;
          } else {
            buyFee = Math.round((buyUnitFee * matchQty) * 100) / 100;
            sellFee = Math.round((sellUnitFee * matchQty) * 100) / 100;
            remainingSellFee -= sellFee;
          }
          
          // === OBLICZANIE DYWIDEND DLA PARY ===
          let pairDividends = 0;
          
          // Czy to ostatnia para z tego zakupu? (cały zakup będzie sprzedany)
          let isLastPairFromBuy = (buy.qty - matchQty) === 0;
          
          dividends.forEach(dividend => {
            let includeDividend = false;
            
            // === PRZYPADEK 1: Dywidenda między zakupem a sprzedażą (włącznie) ===
            if(dividend.date > buy.date && dividend.date <= sell.date) {
              includeDividend = true;
            }
            
            // === PRZYPADEK 2: Dywidenda PO sprzedaży (opóźniona wypłata) ===
            // Tylko dla ostatniej pary z tego zakupu
            // i tylko jeśli nie było kolejnego zakupu tego tickera między sprzedażą a dywidendą
            if(isLastPairFromBuy && dividend.date > sell.date) {
              // Sprawdź czy jest jakiś zakup między sprzedażą a dywidendą
              let hasBuyBetween = buys.some(b => 
                b.date > sell.date && b.date <= dividend.date
              );
              
              if(!hasBuyBetween) {
                includeDividend = true;
              }
            }
            
            // === OBLICZ DYWIDENDĘ DLA PARY ===
            if(includeDividend) {
              // Oblicz globalny stan posiadania na dzień dywidendy
              let globalHoldings = 0;
              buys.forEach(b => {
                if(b.date <= dividend.date) {
                  globalHoldings += b.originalQty;
                }
              });
              
              // Odejmij sprzedaże PRZED dniem dywidendy
              sells.forEach(s => {
                if(s.date < dividend.date) {
                  globalHoldings -= s.qty;
                }
              });
              
              // Jeśli dywidenda jest PO sprzedaży (Przypadek 2), 
              // stan posiadania w dniu dywidendy był już 0,
              // ale dywidenda należała się na podstawie stanu przed sprzedażą
              if(dividend.date > sell.date) {
                // Przywróć stan sprzed tej sprzedaży
                globalHoldings += sell.qty;
              }
              
              // Dywidenda per akcja
              if(globalHoldings > 0) {
                let divPerShare = dividend.totalPLN / globalHoldings;
                
                // Ile akcji Z TEGO ZAKUPU było w posiadaniu?
                let buyHoldingsOnDivDate = buy.originalQty - buy.qtySold;
                
                // Proporcja akcji dla tej pary
                let proportionOfBuyHoldings = matchQty / buyHoldingsOnDivDate;
                let divForBuyOnThisDate = divPerShare * buyHoldingsOnDivDate;
                
                pairDividends += divForBuyOnThisDate * proportionOfBuyHoldings;
              }
            }
          });
          
          // Zaokrąglenie do 4 miejsc po przecinku
          pairDividends = Math.round(pairDividends * 10000) / 10000;
          
          // === WYLICZENIA WARTOŚCI NUMERYCZNYCH ===
          // O: Koszt zakupu
          let costBuy = Math.round((matchQty * (buy.price * buy.fx) + buyFee) * 100) / 100;
          
          // P: Przychód ze sprzedaży
          let revenueeSell = Math.round((matchQty * (sell.price * sell.fx) - sellFee) * 100) / 100;
          
          // Q: Zysk/Strata (bez dywidendy)
          let gainWithoutDiv = Math.round((revenueeSell - costBuy) * 100) / 100;
          
          // S: Zysk/Strata + dywidenda
          let gainWithDiv = Math.round((gainWithoutDiv + pairDividends) * 100) / 100;
          
          // R: Rentowność (bez dywidendy)
          let returnWithoutDiv = costBuy !== 0 ? Math.round((gainWithoutDiv / costBuy) * 10000) / 10000 : 0;
          
          // T: Rentowność + dywidenda
          let returnWithDiv = costBuy !== 0 ? Math.round((gainWithDiv / costBuy) * 10000) / 10000 : 0;
          
          // U: Dni do sprzedaży
          let daysToSell = Math.floor((sell.date - buy.date) / (1000 * 60 * 60 * 24));
          
          // === TWORZENIE WIERSZA ===
          let [konto,ticker,klasa,waluta] = key.split("##");
          
          // Obliczenia (bez zaokrągleń dla sum częściowych)
          let buyPricePLN = buy.price * buy.fx;
          let sellPricePLN = sell.price * sell.fx;
          let buyTotal = matchQty * buyPricePLN + buyFee;
          let sellTotal = matchQty * sellPricePLN - sellFee;
          let profit = sellTotal - buyTotal;
          let profitability = buyTotal > 0 ? profit / buyTotal : 0;
          let daysHeld = Math.floor((sell.date - buy.date) / (1000 * 60 * 60 * 24));
          let profitWithDiv = profit + pairDividends;
          let profitabilityWithDiv = buyTotal > 0 ? profitWithDiv / buyTotal : 0;
          
          // Zaokrąglenia
          buyTotal = Math.round(buyTotal * 100) / 100;
          sellTotal = Math.round(sellTotal * 100) / 100;
          profit = Math.round(profit * 100) / 100;
          profitability = Math.round(profitability * 10000) / 10000;
          profitWithDiv = Math.round(profitWithDiv * 100) / 100;
          profitabilityWithDiv = Math.round(profitabilityWithDiv * 10000) / 10000;
          
          pairs.push([
            ticker,                              // A
            buy.name || ticker,                  // B
            klasa,                               // C
            konto,                               // D
            waluta,                              // E
            buy.date.toLocaleDateString('pl-PL'), // F
            buy.price,                           // G
            buyFee,                              // H
            buy.fx,                              // I
            sell.date.toLocaleDateString('pl-PL'), // J
            sell.price,                          // K
            sellFee,                             // L
            sell.fx,                             // M
            matchQty,                            // N
            buyTotal,                            // O - Koszt zakupu
            sellTotal,                           // P - Przychód sprzedaży
            profit,                              // Q - Zysk/Strata PLN
            profitability,                       // R - Rentowność
            daysHeld,                            // S - Dni do sprzedaży
            pairDividends,                       // T - Dywidendy
            profitWithDiv,                       // U - Zysk/Strata PLN + dywidenda
            profitabilityWithDiv                 // V - Rentowność z dywidendą
          ]);

          
          // Aktualizuj stan zakupu
          buy.qty -= matchQty;
          buy.qtySold += matchQty;
          remainingQty -= matchQty;
        }
      }
    });
  });
  
  // === ZAPISYWANIE WYNIKÓW ===
  if(pairs.length > 0) {
    sheetTarget.getRange(2, 1, pairs.length, 22).setValues(pairs);
    Logger.log(`✓ ${pairs.length} par`);
  }
}