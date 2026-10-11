function pobierzWspolczynikiIndeksacji() {
  const url = 'https://www.gov.pl/web/finanse/wspolczynniki-indeksacji2';
  
  try {
    const response = UrlFetchApp.fetch(url);
    const html = response.getContentText();
    
    const dane = [];
    let tickery = [];
    
    // Znajdź wszystkie wiersze tabeli <tr>
    const trMatches = html.match(/<tr[^>]*>.*?<\/tr>/gs);
    
    if (!trMatches) {
      Logger.log('Nie znaleziono wierszy tabeli');
      return [];
    }
    
    // Znajdź nagłówki z tickerami (IZ0831, IZ0836, itp.)
    trMatches.forEach((tr) => {
      const thMatches = tr.match(/<th[^>]*>(.*?)<\/th>/gs);
      if (thMatches) {
        thMatches.forEach(th => {
          const text = th.replace(/<[^>]*>/g, '').trim();
          if (text.match(/^IZ\d{4}$/)) {
            if (!tickery.includes(text)) {
              tickery.push(text);
            }
          }
        });
      }
    });
    
    //Logger.log('Znalezione tickery: ' + JSON.stringify(tickery));
    
    // Przetwarzaj wiersze z danymi
    trMatches.forEach((tr) => {
      const tdMatches = tr.match(/<td[^>]*>(.*?)<\/td>/gs);
      
      if (tdMatches && tdMatches.length >= 3) {
        // Wyciągnij tekst z komórek
        const cells = tdMatches.map(td => {
          return td.replace(/<[^>]*>/g, '').replace(/&oacute;/g, 'ó').trim();
        });
        
        // Funkcja do przetwarzania bloku danych (data + tickery)
        const przetworzBlok = (startIndex) => {
          if (startIndex >= cells.length || !cells[startIndex].match(/^\d{2}\.\d{2}\.\d{4}$/)) {
            return null;
          }
          
          const rekord = { data: cells[startIndex] };
          let cellIndex = startIndex + 1;
          
          // Dla każdego tickera pobierz współczynnik i odsetki
          tickery.forEach(ticker => {
            if (cellIndex < cells.length) {
              const wspolczynnik = parseFloat(cells[cellIndex].replace(',', '.')) || null;
              rekord[ticker + '_nominalna'] = wspolczynnik ? Math.round(wspolczynnik * 1000 * 100) / 100 : null;
              cellIndex++;
            }
            if (cellIndex < cells.length) {
              rekord[ticker + '_odsetki'] = parseFloat(cells[cellIndex].replace(',', '.')) || null;
              cellIndex++;
            }
          });
          
          return rekord;
        };
        
        // Przetwórz pierwszy blok (zaczyna od komórki 0)
        const rekord1 = przetworzBlok(0);
        if (rekord1) {
          dane.push(rekord1);
        }
        
        // Przetwórz drugi blok (jeśli istnieje)
        const expectedSecondStart = 1 + (tickery.length * 2);
        const rekord2 = przetworzBlok(expectedSecondStart);
        if (rekord2) {
          dane.push(rekord2);
        }
      }
    });    
   
    //Logger.log('Rekordów: ' + dane.length);
    //Logger.log('Pierwszy: ' + JSON.stringify(dane[0]));
    //Logger.log('Ostatni: ' + JSON.stringify(dane[dane.length-1]));
    
    return dane;
    
  } catch (error) {
    Logger.log('Błąd: ' + error.toString());
    throw error;
  }
}

function pobierzNominalnaObecna(ticker) {
  //ticker = "IZ0831"
  try {
    const dane = pobierzWspolczynikiIndeksacji();
    
    if (dane.length === 0) {
      Logger.log('Brak danych');
      return null;
    }
    
    // Pobierz dzisiejszą datę w formacie DD.MM.YYYY
    const dzisiaj = new Date();
    const dzisiejszaData = String(dzisiaj.getDate()).padStart(2, '0') + '.' +
                          String(dzisiaj.getMonth() + 1).padStart(2, '0') + '.' +
                          dzisiaj.getFullYear();
    
    // Znajdź rekord dla dzisiejszej daty
    const rekordDzisiaj = dane.find(rekord => rekord.data === dzisiejszaData);
    
    let wynik;
    
    if (rekordDzisiaj) {
      const nominalnaField = ticker + '_nominalna';
      wynik = rekordDzisiaj[nominalnaField] || null;
      Logger.log('Nominalna dla ' + ticker + ' na ' + dzisiejszaData + ': ' + wynik);
    } else {
      // Jeśli nie ma danych na dzisiaj, znajdź najnowsze dostępne
      const najnowszyRekord = dane[dane.length - 1];
      const nominalnaField = ticker + '_nominalna';
      wynik = najnowszyRekord[nominalnaField] || null;
      Logger.log('Nominalna dla ' + ticker + ' (najnowsze z ' + najnowszyRekord.data + '): ' + wynik);
    }
    
    return wynik;
    
  } catch (error) {
    Logger.log('Błąd: ' + error.toString());
    return null;
  }
}
