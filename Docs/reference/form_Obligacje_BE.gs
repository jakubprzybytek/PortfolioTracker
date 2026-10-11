// ============================================================
// ENTRY POINTS — FORMULARZE
// ============================================================

function loadFormObligacje() {
  const htmlForSidebar = HtmlService.createTemplateFromFile('form_Obligacje_FE');
  const htmlOutput = htmlForSidebar.evaluate();
  htmlOutput.setTitle('Dodaj obligacje');
  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}

function loadFormObligacjeSell() {
  const htmlForSidebar = HtmlService.createTemplateFromFile('form_Obligacje_sell_FE');
  const htmlOutput = htmlForSidebar.evaluate();
  htmlOutput.setTitle('Sprzedaj obligacje');
  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}

// ============================================================
// INFLACJA — pobieranie danych z GUS
// ============================================================

function inflacja() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet       = spreadsheet.getSheetByName(shInflacja);
  var url         = 'https://stat.gov.pl/obszary-tematyczne/ceny-handel/wskazniki-cen/wskazniki-cen-towarow-i-uslug-konsumpcyjnych-pot-inflacja-/miesieczne-wskazniki-cen-towarow-i-uslug-konsumpcyjnych-od-1982-roku/';

  // ── KROK 1: Pobierz stronę główną i znajdź link do CSV ───
  var siteResponse;
  try {
    siteResponse = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch(e) {
    Logger.log('BŁĄD: Nie udało się połączyć z GUS: ' + e.message);
    return;
  }

  if (siteResponse.getResponseCode() !== 200) {
    Logger.log('BŁĄD: Serwis GUS niedostępny (HTTP ' + siteResponse.getResponseCode() + ').');
    return;
  }

  var websiteContent       = siteResponse.getContentText();
  var priceHtmlSpanTagId   = 'Pobranie CSV';

  if (websiteContent.indexOf(priceHtmlSpanTagId) === -1) {
    Logger.log('BŁĄD: Nie znaleziono linku do pliku CSV na stronie GUS — struktura strony mogła się zmienić.');
    return;
  }

  var priceHtmlSpanTagIdLocation = websiteContent.indexOf(priceHtmlSpanTagId);
  var priceTextStartLocation     = websiteContent.indexOf('href=', priceHtmlSpanTagIdLocation);
  var priceTextEndLocation       = websiteContent.indexOf('title=', priceHtmlSpanTagIdLocation);
  var urlCSV                     = websiteContent.substring(priceTextStartLocation + 6, priceTextEndLocation - 2);
  var urlFinal                   = 'https://stat.gov.pl' + urlCSV;

  // ── KROK 2: Pobierz plik CSV ──────────────────────────────
  var csvResponse;
  try {
    csvResponse = UrlFetchApp.fetch(urlFinal, { muteHttpExceptions: true });
  } catch(e) {
    Logger.log('BŁĄD: Nie udało się pobrać pliku CSV z GUS: ' + e.message);
    return;
  }

  if (csvResponse.getResponseCode() !== 200) {
    Logger.log('BŁĄD: Nie udało się pobrać pliku CSV (HTTP ' + csvResponse.getResponseCode() + ').');
    return;
  }

  // ── KROK 3: Wykryj kodowanie i wczytaj dane ──────────────
  var blob      = csvResponse.getBlob();
  var encodings = [
    'cp1250', '852', 'utf-8', 'iso-8859-2', 'windows-1252',
    'utf-16', 'utf-16le', 'utf-16be', 'iso-8859-1', 'macroman'
  ];
  var keyword = 'Miesiąc';
  var wczytano = false;

  for (var i = 0; i < encodings.length; i++) {
    try {
      var content = blob.getDataAsString(encodings[i]);
      if (content.substring(0, 100).includes(keyword)) {
        Logger.log('Wykryto odpowiednie kodowanie: ' + encodings[i]);
        sheet.getRange('A1:G').clear();
        var data = Utilities.parseCsv(content, ';');
        sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
        wczytano = true;
        break;
      }
    } catch(e) {
      Logger.log('Nie udało się odczytać jako ' + encodings[i] + ': ' + e.message);
    }
  }

  if (!wczytano) {
    Logger.log('BŁĄD: Nie udało się wykryć właściwego kodowania pliku CSV — dane nie zostały zaktualizowane.');
  }
}
// ============================================================
// DODAJ OBLIGACJE — warstwa UI
// ============================================================

function dodajObligacjeNew(rowDataObligacje) {
  var sheet    = SpreadsheetApp.getActive().getSheetByName(shObligacje);
  var nLastRow = sheet.getLastRow() + 1;

  var liczba       = Number(rowDataObligacje.liczba);
  var pierwszyRok  = Number(rowDataObligacje.pierwszyRok);
  var marza        = Number(rowDataObligacje.marza);
  var konto        = rowDataObligacje.konto;
  var typ          = rowDataObligacje.typObligacji.toString();
  var data         = rowDataObligacje.data;
  var dyskonto     = rowDataObligacje.dyskonto;

  var dyskontoStatus = dyskonto ? 'Tak' : 'Nie';

  var tickerYear = Number(data.toString().substring(2, 4));
  switch (typ) {
    case 'EDO': tickerYear += 10; break;
    case 'COI': tickerYear += 4;  break;
    case 'ROS': tickerYear += 6;  break;
    case 'ROD': tickerYear += 12; break;
    case 'TOS': tickerYear += 3;  break;
  }

  var ticker = typ + '-' +
               data.toString().substring(8, 10) +
               data.toString().substring(5, 7) +
               tickerYear;

  var cena = 100;
  if (dyskonto) cena = cena * 0.999;

  var wartoscZakupu = (liczba * cena).toLocaleString('pl-PL', {
    style: 'currency', currency: 'PLN',
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  var liczbaFormatowana = liczba.toLocaleString('pl-PL');

  var ui = SpreadsheetApp.getUi();

  const dataZakupu  = new Date(data);
  const jestMarcowa = dataZakupu.getMonth() === 2;
  const komunikatMarcowa = jestMarcowa && typ !== 'TOS'
    ? '\n\n⚠️ Marcowa seria obligacji\n' +
      'Uwaga! Oprocentowanie bazuje na wstępnym CPI ze stycznia (publikacja w marcu).' +
      'Wymagana ręczna korekta w kolejnych latach w zakładce "Obligacje".\n\n' +
      'Więcej w instrukcji arkusza: https://inwestomat.eu/wlasny-arkusz-do-monitorowania-inwestycji/#kupowanie-polskich-obligacji-skarbowych'
    : '';

  var textAlert = (
    '📊 DANE OBLIGACJI\n' +
    '═══════════════════════════════\n' +
    'Typ obligacji: ' + typ +
    '\nData zakupu: ' + data +
    (typ == 'TOS'
      ? '\nOprocentowanie roczne: ' + pierwszyRok.toFixed(2) + '%'
      : '\nOprocentowanie w pierwszym roku: ' + pierwszyRok.toFixed(2) + '%' +
        '\nMarża w kolejnych latach: ' + marza.toFixed(2) + '%'
    ) +
    komunikatMarcowa +
    '\n\n💰 PODSUMOWANIE ZAKUPU\n' +
    '═══════════════════════════════\n' +
    'Liczba zakupionych obligacji: ' + liczbaFormatowana +
    '\nWartość zakupionych obligacji: ' + wartoscZakupu +
    '\nObligacje zakupione z dyskontem: ' + dyskontoStatus +
    '\n\nCzy dodać obligacje do portfela?'
  );

  var response = ui.alert(textAlert, ui.ButtonSet.YES_NO);

  if (response == ui.Button.YES) {
    _dodajObligacjeCore(
      sheet, nLastRow, ticker, typ, data,
      liczba, cena,
      pierwszyRok / 100,
      marza / 100,
      dyskonto
    );
    nowyZakupObligacji(konto, ticker, data, liczba, cena);
  } else {
    ui.alert('Operacja przerwana. Dane nie zostały zapisane');
  }

  return true;
}

// ============================================================
// DODAJ OBLIGACJE — rdzeń (bez UI, wywoływany też przez import)
// pierwszyRok i marza podawane jako ułamek dziesiętny (np. 0.065)
// Przy imporcie: pierwszyRok=0, marza=0 — user uzupełnia ręcznie
// ============================================================

function _dodajObligacjeCore(sheet, nLastRow, ticker, typ, data,
                              liczba, cena, pierwszyRok, marza, dyskonto,
                              odtwarzaj = false) {

  // Liczba lat per typ
  const MAX_LAT = { 'EDO': 10, 'COI': 4, 'ROS': 6, 'ROD': 12 };
  const maxLat  = MAX_LAT[typ] || 12;

  // Kolumna ostatniej wartości: rok N → kolumna I + (N-1)*2 = 9 + (N-1)*2
  // rok 1 → I(9), rok 4 → O(15), rok 6 → S(19), rok 10 → AC(29), rok 12 → AE(31)
  function getWartoscKolumna(lat) {
    const code = 9 + (lat - 1) * 2;  // 1-based kolumna
    if (code <= 26) return String.fromCharCode(64 + code);
    return 'A' + String.fromCharCode(64 + code - 26);
  }

  const finalValueCol = getWartoscKolumna(maxLat);  // np. 'AC' dla EDO

  if (!odtwarzaj) {
    // KROK 1: Podstawowe dane (kolumny A-F)
    sheet.getRange(nLastRow, 1, 1, 6).setValues([
      [typ, data, pierwszyRok, marza, liczba, dyskonto]
    ]);

    // KROK 2: Checkbox w kolumnie F
    sheet.getRange(nLastRow, 6).insertCheckboxes();
  }

  // KROK 3: Formuły G-H (wartość zakupu + oprocentowanie rok 1)
  sheet.getRange(nLastRow, 7, 1, 2).setFormulas([[
    `=E${nLastRow}*100*IF(F${nLastRow};0,999;1)`,
    `=C${nLastRow}`
  ]]);

  // KROK 4a: Formuły EDO / COI / ROS / ROD
  if (typ === 'EDO' || typ === 'COI' || typ === 'ROS' || typ === 'ROD') {

    const valueFormulas    = [];
    const interestFormulas = [];
    for (let year = 1; year <= maxLat; year++) {
      valueFormulas.push(generateValueFormula(nLastRow, year));
      interestFormulas.push(generateInterestRateFormula(nLastRow, year));
    }

    // Kolumny H..AD to 23 kolumn (offset 0..22), ale generujemy tylko do maxLat*2
    // Struktura: H(opr1), I(val1), J(opr2), K(val2), ... para na rok
    // Liczba kolumn dla maxLat lat: 1 (H=opr1) + maxLat*2 - 1 = maxLat*2
    // H=col8, ostatnia para roku N kończy się na col 8 + N*2 - 1
    const numCols    = maxLat * 2;       // np. COI=8, EDO=20, ROD=24
    const formulaRow = [];

    for (let col = 0; col < numCols; col++) {
      if (col === 0) {
        // H — oprocentowanie rok 1
        formulaRow.push(interestFormulas[0]);

      } else if (col % 2 === 1) {
        // I, K, M... — wartości lat 1..maxLat
        const yearIdx = (col - 1) / 2;
        formulaRow.push(yearIdx < maxLat ? valueFormulas[yearIdx] : '');

      } else {
        // J, L, N... — oprocentowanie lat 2..maxLat
        const yearIdx = col / 2;
        formulaRow.push(yearIdx < maxLat ? interestFormulas[yearIdx] : '');
      }
    }

    // Zakres H..ostatnia kolumna par (np. H..AC dla EDO, H..O dla COI)
    const startColLetter = 'H';
    const endColCode     = 8 + numCols - 1;  // 1-based
    const endColLetter   = endColCode <= 26
      ? String.fromCharCode(64 + endColCode)
      : 'A' + String.fromCharCode(64 + endColCode - 26);

    sheet.getRange(`${startColLetter}${nLastRow}:${endColLetter}${nLastRow}`)
         .setFormulas([formulaRow]);

    // Formuły AF..AM (statystyki) — bez zmian strukturalnych, tylko AF dostosowane
    sheet.getRange(`AF${nLastRow}:AM${nLastRow}`).setFormulas([[

      // AF — obecna wartość obligacji (finalYearValue z właściwej kolumny)
      `=LET(
        currentRow; ROW();
        bondType; INDEX(A:A; currentRow);
        baseDate; INDEX(B:B; currentRow);
        yearsElapsed; DATEDIF(baseDate; TODAY(); "Y") + 1;
        year1Value; INDEX(I:I; currentRow);
        year2Value; INDEX(K:K; currentRow);
        year3Value; INDEX(M:M; currentRow);
        year4Value; INDEX(O:O; currentRow);
        finalYearValue; INDEX(${finalValueCol}:${finalValueCol}; currentRow);
        coiValue; SWITCH(yearsElapsed; 1; year1Value; 2; year2Value; 3; year3Value; 4; year4Value; year4Value);
        result; IF(bondType = "COI"; coiValue; finalYearValue);
        result
      )`,

      // AG — odsetki skumulowane COI
      `=LET(
        currentRow; ROW();
        bondType; INDEX(A:A; currentRow);
        isCOI; bondType = "COI";
        baseDate; INDEX(B:B; currentRow);
        initialValue; INDEX(E:E; currentRow) * 100;
        taxRate; 0,81;
        yearsElapsed; DATEDIF(baseDate; TODAY(); "Y");
        year1Value; INDEX(I:I; currentRow);
        year2Value; INDEX(K:K; currentRow);
        year3Value; INDEX(M:M; currentRow);
        year4Value; INDEX(O:O; currentRow);
        year1Tax; IF(yearsElapsed >= 1; taxRate * (year1Value - initialValue); 0);
        year2Tax; IF(yearsElapsed >= 2; taxRate * (year2Value - initialValue); 0);
        year3Tax; IF(yearsElapsed >= 3; taxRate * (year3Value - initialValue); 0);
        year4Tax; IF(yearsElapsed >= 4; taxRate * (year4Value - initialValue); 0);
        totalTax; year1Tax + year2Tax + year3Tax + year4Tax;
        result; IF(isCOI; totalTax; "");
        result
      )`,

      // AH — całkowity zysk
      `=AF${nLastRow}+AG${nLastRow}`,

      // AI — zysk procentowy
      `=IFERROR(AH${nLastRow}/G${nLastRow}-1;"")`,

      // AJ — status
      `=(EDATE(B${nLastRow};12*SWITCH($A${nLastRow};"COI";4;"EDO";10;"ROS";6;"ROD";12))-1)>=TODAY()`,

      // AK — ticker
      `="${ticker}"`,

      // AL — cena za sztukę
      `=ROUND(AF${nLastRow}/E${nLastRow};2)`,

      // AM — obecne oprocentowanie
      `=LET(
        currentRow; ROW();
        currentPrice; INDEX(AL:AL; currentRow);
        baseDate; INDEX(B:B; currentRow);
        bondType; INDEX(A:A; currentRow);
        statusOK; INDEX(AJ:AJ; currentRow);
        monthsElapsed; DATEDIF(baseDate; TODAY(); "M");
        yearsElapsed; INT(monthsElapsed / 12);
        columnIndex; 2 * (yearsElapsed + 1) - 1;
        rangeStart; "H" & currentRow;
        rangeEnd; "${endColLetter}" & currentRow;
        fullRange; INDIRECT(rangeStart & ":" & rangeEnd);
        calculatedResult; IF(currentPrice = ""; ""; INDEX(fullRange; 1; columnIndex));
        finalResult; IF(NOT(statusOK); ""; calculatedResult);
        finalResult
      )`
    ]]);

  } else {
    // KROK 4b: TOS — bez zmian
    sheet.getRange(`AJ${nLastRow}:AM${nLastRow}`).setFormulas([[
      `=(EDATE(B${nLastRow};12*SWITCH($A${nLastRow};"COI";4;"EDO";10;"ROS";6;"ROD";12;"TOS";3))-1)>TODAY()`,
      `="${ticker}"`,
      `=LET(
        currentRow; ROW();
        data_zakupu; INDEX(B:B; currentRow);
        stopa; INDEX(C:C; currentRow);
        wartosc_nominalna; 100;
        dzisiaj; TODAY();
        koniec_rok_1; DATE(YEAR(data_zakupu)+1; MONTH(data_zakupu); DAY(data_zakupu));
        koniec_rok_2; DATE(YEAR(data_zakupu)+2; MONTH(data_zakupu); DAY(data_zakupu));
        koniec_rok_3; DATE(YEAR(data_zakupu)+3; MONTH(data_zakupu); DAY(data_zakupu));
        wartosc_po_rok_1; wartosc_nominalna*(1+stopa);
        wartosc_po_rok_2; wartosc_nominalna*(1+stopa)^2;
        dni_od_zakupu; DAYS(dzisiaj; data_zakupu);
        dni_w_rok_1; DAYS(koniec_rok_1; data_zakupu);
        dni_od_rok_1; DAYS(dzisiaj; koniec_rok_1);
        dni_w_rok_2; DAYS(koniec_rok_2; koniec_rok_1);
        dni_od_rok_2; DAYS(dzisiaj; koniec_rok_2);
        dni_w_rok_3; DAYS(koniec_rok_3; koniec_rok_2);
        wynik; IF(dzisiaj < koniec_rok_1;
          wartosc_nominalna*(1 + (stopa * dni_od_zakupu)/dni_w_rok_1);
          IF(dzisiaj < koniec_rok_2;
            wartosc_po_rok_1*(1 + (stopa * dni_od_rok_1)/dni_w_rok_2);
            wartosc_po_rok_2*(1 + (stopa * dni_od_rok_2)/dni_w_rok_3)
          )
        );
        ROUND(wynik; 2)
      )`,
      `=LET(
        currentRow; ROW();
        currentPrice; INDEX(AL:AL; currentRow);
        baseDate; INDEX(B:B; currentRow);
        bondType; INDEX(A:A; currentRow);
        statusOK; INDEX(AJ:AJ; currentRow);
        monthsElapsed; DATEDIF(baseDate; TODAY(); "M");
        yearsElapsed; INT(monthsElapsed / 12);
        columnIndex; 2 * (yearsElapsed + 1) - 1;
        rangeStart; "H" & currentRow;
        rangeEnd; "AE" & currentRow;
        fullRange; INDIRECT(rangeStart & ":" & rangeEnd);
        calculatedResult; IF(currentPrice = ""; ""; INDEX(fullRange; 1; columnIndex));
        finalResult; IF(NOT(statusOK); ""; IF(bondType = "TOS"; INDEX(C:C; currentRow); calculatedResult));
        finalResult
      )`
    ]]);
  }
}

// ============================================================
// GENERATORY FORMUŁ (bez zmian)
// ============================================================

function generateValueFormula(nLastRow, yearNumber) {
  if (yearNumber === 1) {
    return `=LET(
      baseValue; E${nLastRow};
      startYear; INT(LEFT(H$1; 2));
      endYear; INT(LEFT(J$1; 2));
      startDate; EDATE($B${nLastRow}; 12*(startYear-1));
      endDate; EDATE($B${nLastRow}; 12*(endYear-1));
      isFutureDate; startDate > TODAY();
      daysPassed; DATEDIF(startDate; TODAY(); "D");
      totalDays; DATEDIF(startDate; endDate; "D");
      timeRatio; IF(isFutureDate; 0; MIN(daysPassed/totalDays; 1));
      baseValue * 100 * (1 + timeRatio * H${nLastRow})
    )`;
  } else {
    const startYearColumn    = getColumnLetter(yearNumber, false);
    const endYearColumn      = getColumnLetter(yearNumber, true);
    const previousYearColumn = getTargetColumn(yearNumber - 1);
    return `=LET(
      baseValue; IF($A${nLastRow}<>"COI"; ${previousYearColumn}${nLastRow}; $E${nLastRow}*100);
      startYear; INT(LEFT(${startYearColumn}$1; 2));
      endYear; INT(LEFT(${endYearColumn}$1; 2));
      startDate; EDATE($B${nLastRow}; 12*(startYear-1));
      endDate; EDATE($B${nLastRow}; 12*(endYear-1));
      isFutureDate; startDate > TODAY();
      daysPassed; DATEDIF(startDate; TODAY(); "D");
      totalDays; DATEDIF(startDate; endDate; "D");
      timeRatio; IF(isFutureDate; 0; MIN(daysPassed/totalDays; 1));
      baseValue * (1 + timeRatio * ${startYearColumn}${nLastRow})
    )`;
  }
}

function generateInterestRateFormula(nLastRow, yearNumber) {
  if (yearNumber === 1) {
    return `=C${nLastRow}`;
  } else {
    const currentYearColumn = getColumnLetter(yearNumber, false);
    return `=LET(
      currentYear; INT(LEFT(${currentYearColumn}$1; 2));
      bondType; $A${nLastRow};
      maxYears; SWITCH(bondType; "COI"; 4; "EDO"; 10; "ROS"; 6; "ROD"; 12);
      baseDate; $B${nLastRow};
      queryDate; EDATE(baseDate; 12*(currentYear-1)-2);
      queryYear; YEAR(queryDate);
      queryMonth; MONTH(queryDate);
      bonusRate; $D${nLastRow};
      withinTimeLimit; currentYear <= maxYears;
      inflationQuery; IFERROR(
        MAX(
          (
            FILTER(
              Inflacja!$F$1:$F$5000;
              Inflacja!$C$1:$C$5000 = "Analogiczny miesiąc poprzedniego roku = 100";
              Inflacja!$D$1:$D$5000 = queryYear;
              Inflacja!$E$1:$E$5000 = queryMonth
            )
          - 100
          ) / 100;
        0
      ));
      inflationRate; MAX(inflationQuery; 0);
      finalRate; IF(withinTimeLimit; inflationRate + bonusRate; 0);
      finalRate
    )`;
  }
}

function getTargetColumn(yearNumber) {
  const columnCode = 73 + (yearNumber - 1) * 2;
  if (columnCode <= 90) return String.fromCharCode(columnCode);
  const excessCode = columnCode - 90;
  return 'A' + String.fromCharCode(64 + excessCode);
}

function getColumnLetter(yearNumber, isEndYear = false) {
  const baseCode   = 72 + (yearNumber - 1) * 2;
  const columnCode = isEndYear ? baseCode + 2 : baseCode;
  if (columnCode <= 90) return String.fromCharCode(columnCode);
  const excessCode = columnCode - 90;
  return 'A' + String.fromCharCode(64 + excessCode);
}

// ============================================================
// NOWY ZAKUP — zapis transakcji + opcjonalna wpłata gotówkowa
// (wywoływany TYLKO z formularza ręcznego, nie z importu)
// ============================================================

function nowyZakupObligacji(konto, ticker, data, liczba, cena) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(shTransakcje);
  var ui    = SpreadsheetApp.getUi();
  var klasaAktywow = kl_OblPL;

  sh.appendRow([konto, data, ticker, 'PLN', ticker, klasaAktywow,
                'Zakup', liczba, cena, 0, 1, 1, liczba * cena]);

  var totalValue        = liczba * cena;
  var formattedTotal    = totalValue.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
  var textInput         = 'Czy jednocześnie dodać transakcję Wpłaty gotówkowej na konto Obligacji detalicznych?';
  var textInput2        = 'Podaj wysokość wpłaty (Wartość zakupionych obligacji to: ' + formattedTotal + ')';

  var result = ui.alert('Wpłata gotówkowa', textInput, ui.ButtonSet.YES_NO);
  if (result == ui.Button.YES) {
    var kwota = Number(Browser.inputBox(textInput2, Browser.Buttons.OK_CANCEL));
    while (isNaN(kwota)) {
      kwota = Number(Browser.inputBox('Wprowadzona kwota nie jest poprawna. ' + textInput2, Browser.Buttons.OK_CANCEL));
    }
    sh.appendRow([konto, data, 'Gotówka', 'PLN', 'Gotówka', 'Gotówka',
                  'Wpłata środków', 1, 1, 0, 1, 1, kwota]);
  }
}

// ============================================================
// SPRZEDAŻ OBLIGACJI
// ============================================================

function sprzedajObligacje(rowData) {
  let konto    = rowData.konto;
  let data     = rowData.data;
  let ticker   = rowData.ticker;
  let liczba   = rowData.liczba;
  let prowizja = Number(rowData.prowizja);
  let totalPLN = Math.round(Number(rowData.totalPLN) * 100) / 100;
  let cena     = Math.round(((totalPLN + prowizja) / liczba) * 100) / 100;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(shTransakcje);

  sh.appendRow([
    konto, data, ticker, 'PLN', ticker,
    kl_OblPL, 'Sprzedaż',
    liczba, cena, prowizja,
    1, 1, totalPLN, ''
  ]);

  deleteTickersFromObligacje(ticker, liczba);
  return true;
}

// ============================================================
// USUŃ / ZMNIEJSZ LICZBĘ W ZAKŁADCE OBLIGACJE PO SPRZEDAŻY
// ============================================================

function _zmniejszObligacje(sheet, ticker, liczba) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return;

  const kolAK    = sheet.getRange('AK1:AK' + lastRow).getValues().flat();
  const rowIndex = kolAK.indexOf(ticker); // -1 jeśli brak

  if (rowIndex < 0) {
    Logger.log('_zmniejszObligacje: ticker ' + ticker + ' nie znaleziony.');
    return;
  }

  const arkuszRow      = rowIndex + 1;
  const aktualnaLiczba = Number(sheet.getRange(arkuszRow, 5).getValue());
  const nowaLiczba     = aktualnaLiczba - liczba;

  if (nowaLiczba > 0) {
    sheet.getRange(arkuszRow, 5).setValue(nowaLiczba);
  } else {
    // Zerujem — deleteTickersFromObligacje zapyta o usunięcie wiersza
    sheet.getRange(arkuszRow, 5).setValue(0);
  }
}

function deleteTickersFromObligacje(ticker, liczba) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(shObligacje);
  _zmniejszObligacje(sheet, ticker, liczba);

  // Sprawdź czy E=0 i zapytaj o usunięcie
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];

  const kolAK    = sheet.getRange('AK1:AK' + lastRow).getValues().flat();
  const rowIndex = kolAK.indexOf(ticker);
  if (rowIndex < 0) return [];

  const arkuszRow = rowIndex + 1;
  const cellValue = Number(sheet.getRange(arkuszRow, 5).getValue());

  if (cellValue === 0) {
    const ui       = SpreadsheetApp.getUi();
    const response = ui.alert(
      'Potwierdzenie',
      'Sprzedajesz wszystkie obligacje serii ' + ticker +
      '. Czy chcesz je także usunąć z zakładki Obligacje?',
      ui.ButtonSet.YES_NO
    );
    if (response === ui.Button.YES) sheet.deleteRow(arkuszRow);
  }

  return [arkuszRow];
}


// ============================================================
// AKTUALIZACJA OPROCENTOWANIA W ZAKŁADCE OBLIGACJE
// ============================================================
function aktualizujOprocentowanieObligacje() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const shObl = ss.getSheetByName(shObligacje);

  if (!shObl) {
    Logger.log('BŁĄD: Nie znaleziono zakładki Obligacje.');
    return;
  }

  const lastRow = shObl.getLastRow();
  if (lastRow < 2) {
    Logger.log('Zakładka Obligacje jest pusta.');
    return;
  }

  // ── KROK 1: Zbierz unikalne serie ────────────────────────
  const OPR_KOLUMNY = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
  const MAX_LAT     = OPR_KOLUMNY.length;

  const kolTicker = shObl.getRange('AK1:AK' + lastRow).getValues().flat();
  const kolTyp    = shObl.getRange('A1:A'   + lastRow).getValues().flat();

  const serieSet = new Set();
  for (let i = 2; i < lastRow; i++) {
    const typ    = String(kolTyp[i]    || '').trim().toUpperCase();
    const ticker = String(kolTicker[i] || '').trim();
    if (!ticker || typ === 'TOS') continue;
    const seria = tickerNaSerie(ticker);
    if (seria) serieSet.add(seria);
  }

  if (serieSet.size === 0) {
    Logger.log('Brak serii do aktualizacji (tylko TOS lub pusta zakładka).');
    return;
  }

  Logger.log('Serie do pobrania z MF (' + serieSet.size + '): ' + [...serieSet].join(', '));

  // ── KROK 2: Pobierz plik MF ───────────────────────────────
  let daneMF = null;
  try {
    daneMF = pobierzISparsujPlikMF();
  } catch(e) {
    Logger.log('Nie udało się pobrać pliku MF: ' + e.message + ' — kroki 3 i 4 zostaną pominięte.');
  }

  // ── KROK 3: Wyciągnij dane dla każdej serii ───────────────
  const oprCache = {};
  if (daneMF) {
    serieSet.forEach(function(seria) {
      try {
        const wynik = wyciagnijWszystkieOkresyZDanych(daneMF, seria, MAX_LAT);
        oprCache[seria] = wynik;
        Logger.log('Pobrano dla ' + seria + ': lata=' + JSON.stringify(wynik.lata) + ', cenaZamiany=' + wynik.cenaZamiany);
      } catch(e) {
        oprCache[seria] = { blad: e.message };
        Logger.log('BŁĄD dla ' + seria + ': ' + e.message);
      }
    });
  }

  // ── KROK 4: Wczytaj blok formuł i wartości ───────────────
  const dataStartRow = 2;
  const dataRows     = lastRow - 1;
  const firstOprCol  = OPR_KOLUMNY[0];
  const lastOprCol   = OPR_KOLUMNY[OPR_KOLUMNY.length - 1];
  const numOprCols   = lastOprCol - firstOprCol + 1;

  const formulaBlock = shObl.getRange(dataStartRow, firstOprCol, dataRows, numOprCols).getFormulas();
  const valueBlock   = shObl.getRange(dataStartRow, firstOprCol, dataRows, numOprCols).getValues();

  // ── KROK 5: Przejdź przez wiersze ────────────────────────
  const podsumowanie = [];
  const zmiany = [];
  for (let r = 0; r < dataRows; r++) zmiany.push(new Array(numOprCols).fill(undefined));

  // Kolumna G = kolumna nr 7 (1-based) — formuły ceny zamiany
  const formulyG = shObl.getRange(dataStartRow, 7, dataRows, 1).getFormulas();

  for (let r = 0; r < dataRows; r++) {
    const arkuszRow = r + dataStartRow;
    const typ       = String(kolTyp[r + 1]    || '').trim().toUpperCase();
    const ticker    = String(kolTicker[r + 1]  || '').trim();

    if (!ticker || typ === 'TOS') continue;

    const seria   = tickerNaSerie(ticker);
    const oprDane = oprCache[seria];

    // ── Aktualizacja formuły w kolumnie G (cena zamiany) ──
    if (oprDane && !oprDane.blad) {
      const cenaZamiany = oprDane.cenaZamiany;
      const formulaG    = formulyG[r][0];

      if (formulaG && formulaG.startsWith('=')) {
        const nowaMnoznik = cenaZamiany.toFixed(3).replace('.', ',');

        // Wyciągnij aktualny drugi parametr IF z formuły
        // Obsługuje: IF(F4;0,999;1) lub IF(F4;1;1) lub IF(F4;0,997;1) itp.
        const matchIF = formulaG.match(/IF\([^;]+;([^;]+);/);
        const aktualnyMnoznik = matchIF ? matchIF[1].trim() : null;

        if (aktualnyMnoznik !== nowaMnoznik) {
          // Podmień drugi parametr IF niezależnie od jego obecnej wartości
          const formulaGNowa = formulaG.replace(
            /IF\(([^;]+);([^;]+);/,
            'IF($1;' + nowaMnoznik + ';'
          );
          shObl.getRange(arkuszRow, 7).setFormula(formulaGNowa);
          Logger.log('[wiersz ' + arkuszRow + '] ' + ticker + ': zaktualizowano G: ' + formulaG + ' → ' + formulaGNowa);
        }
      }
    }

    if (!oprDane || oprDane.blad) continue;

    // ── Aktualizacja oprocentowania ────────────────────────
    const zmienioneLata = [];

    OPR_KOLUMNY.forEach(function(kolNr, latIdx) {
      const colOffset  = kolNr - firstOprCol;
      const formula    = formulaBlock[r][colOffset];
      const jestFormula = formula && formula.startsWith('=');
      if (!jestFormula) return;

      const oprZMF = oprDane.lata[latIdx];
      if (oprZMF === null || oprZMF === undefined || oprZMF <= 0) return;

      zmiany[r][colOffset] = oprZMF;
      zmienioneLata.push('rok ' + (latIdx + 1) + '=' + (oprZMF * 100).toFixed(2) + '%');
    });

    if (zmienioneLata.length > 0) {
      podsumowanie.push({ ticker, seria, arkuszRow, lata: zmienioneLata });
    }
  }

  // ── KROK 6: Logger — podsumowanie ────────────────────────
  Logger.log('');
  Logger.log('=== PODSUMOWANIE AKTUALIZACJI OPROCENTOWANIA ===');
  Logger.log('Data uruchomienia: ' + new Date().toLocaleString('pl-PL'));
  Logger.log('');

  if (podsumowanie.length === 0) {
    Logger.log('Brak serii do aktualizacji — wszystkie oprocentowania są już uzupełnione lub niedostępne w pliku MF.');
  } else {
    Logger.log('Serie do zaktualizowania (' + podsumowanie.length + '):');
    podsumowanie.forEach(function(p) {
      Logger.log('  [wiersz ' + p.arkuszRow + '] ' + p.ticker + ' (' + p.seria + '): ' + p.lata.join(', '));
    });
  }

  // ── KROK 7: Nadpisywanie formuł wartościami ───────────────
  if (podsumowanie.length > 0) {
    podsumowanie.forEach(function(p) {
      const r         = p.arkuszRow - dataStartRow;
      const rowZmiany = zmiany[r];

      OPR_KOLUMNY.forEach(function(kolNr, latIdx) {
        const colOffset   = kolNr - firstOprCol;
        const nowaWartosc = rowZmiany[colOffset];
        if (nowaWartosc === undefined) return;
        shObl.getRange(p.arkuszRow, kolNr).setValue(nowaWartosc);
      });
    });

    Logger.log('Zaktualizowano ' + podsumowanie.length + ' serii.');
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Zaktualizowano oprocentowanie dla ' + podsumowanie.length + ' serii. Sprawdź zakładkę Obligacje.',
      'Aktualizacja oprocentowania',
      10
    );
  }
}

// ============================================================
// PORÓWNANIE OPROCENTOWANIA: ZAKŁADKA OBLIGACJE vs PLIK MF
// WERSJA: 2 przebiegi (drugi tylko po wykryciu różnic)
// ============================================================

function porownajOprocentowanie() {
  Logger.log('=== START: porownajOprocentowanie() ===');
  Logger.log('Data uruchomienia: ' + new Date().toLocaleString('pl-PL'));
  Logger.log('');

  // ── PIERWSZY SKAN ──────────────────────────────────────────
  Logger.log('▶️ KROK 1: Uruchamiam pierwszy skan porównawczy.');
  const wynik1 = _wykonajPorownanieOprocentowania_();

  if (!wynik1 || wynik1.krytycznyBlad) {
    Logger.log('⛔ Przerwano działanie z powodu błędu krytycznego w pierwszym skanie.');
    Logger.log('=== KONIEC: porownajOprocentowanie() ===');
    return;
  }

  _zalogujRaportPorownania_(wynik1, 'RAPORT 1 / PIERWSZY SKAN');

  // Jeżeli brak różnic, kończymy bez pobierania inflacji
  if (wynik1.roznice.length === 0) {
    Logger.log('');
    Logger.log('✅ KROK 2: Pierwszy skan nie wykazał różnic — pomijam pobranie inflacji i drugi skan.');
    Logger.log('=== KONIEC: porownajOprocentowanie() ===');

    return wynik1.roznice
      .filter(function(r) { return r.pola[0].pole !== 'SERIA'; })
      .map(function(r) { return r.ticker; })
      .filter(function(t, i, arr) { return arr.indexOf(t) === i; });
  }

  // ── POBRANIE INFLACJI + DRUGI SKAN ─────────────────────────
  Logger.log('');
  Logger.log('⚠️ KROK 2: Wykryto różnice w pierwszym skanie.');
  Logger.log('⬇️ Uruchamiam pobieranie inflacji: inflacja()');

  try {
    inflacja();
    Logger.log('✅ Funkcja inflacja() zakończona.');
  } catch (e) {
    Logger.log('⛔ BŁĄD: Nie udało się wykonać inflacja(): ' + e.message);
    Logger.log('ℹ️ Zwracam wynik z pierwszego skanu.');
    Logger.log('=== KONIEC: porownajOprocentowanie() ===');

    return wynik1.roznice
      .filter(function(r) { return r.pola[0].pole !== 'SERIA'; })
      .map(function(r) { return r.ticker; })
      .filter(function(t, i, arr) { return arr.indexOf(t) === i; });
  }

  Logger.log('🔄 Wymuszam zapis i odświeżenie arkusza: SpreadsheetApp.flush()');
  SpreadsheetApp.flush();

  Logger.log('⏳ Czekam 1500 ms na przeliczenie formuł.');
  Utilities.sleep(1500);

  Logger.log('▶️ KROK 3: Uruchamiam drugi skan porównawczy po pobraniu inflacji.');
  const wynik2 = _wykonajPorownanieOprocentowania_();

  if (!wynik2 || wynik2.krytycznyBlad) {
    Logger.log('⛔ Drugi skan zakończył się błędem krytycznym.');
    Logger.log('ℹ️ Zwracam wynik z pierwszego skanu.');
    Logger.log('=== KONIEC: porownajOprocentowanie() ===');

    return wynik1.roznice
      .filter(function(r) { return r.pola[0].pole !== 'SERIA'; })
      .map(function(r) { return r.ticker; })
      .filter(function(t, i, arr) { return arr.indexOf(t) === i; });
  }

  _zalogujRaportPorownania_(wynik2, 'RAPORT 2 / DRUGI SKAN PO inflacja()');

  if (wynik2.roznice.length === 0) {
    Logger.log('');
    Logger.log('✅ KROK 4: Drugi skan nie wykazał różnic — problem wynikał z braku świeżej inflacji.');
  } else {
    Logger.log('');
    Logger.log('❌ KROK 4: Drugi skan nadal wykazuje różnice — traktuję je jako właściwe błędy.');
  }

  Logger.log('=== KONIEC: porownajOprocentowanie() ===');

  return wynik2.roznice
    .filter(function(r) { return r.pola[0].pole !== 'SERIA'; }) // pomijamy "brak w MF"
    .map(function(r) { return r.ticker; })
    .filter(function(t, i, arr) { return arr.indexOf(t) === i; }); // unikalne
}


// ============================================================
// WEWNĘTRZNE: WYKONANIE JEDNEGO SKANU
// ============================================================

function _wykonajPorownanieOprocentowania_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const shObl = ss.getSheetByName(shObligacje);

  if (!shObl) {
    Logger.log('BŁĄD: Nie znaleziono zakładki Obligacje.');
    return { krytycznyBlad: true };
  }

  const lastRow = shObl.getLastRow();
  if (lastRow < 3) {
    Logger.log('Zakładka Obligacje jest pusta.');
    return {
      krytycznyBlad: false,
      roznice: [],
      zgodne: [],
      pominiete: [],
      lastRow: lastRow
    };
  }

  // ── Kolumny oprocentowania H(8), J(10)... AD(30) ──────────
  const OPR_KOLUMNY  = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
  const firstOprCol  = OPR_KOLUMNY[0];
  const lastOprCol   = OPR_KOLUMNY[OPR_KOLUMNY.length - 1];
  const numOprCols   = lastOprCol - firstOprCol + 1;
  const dataStartRow = 3;
  const dataRows     = lastRow - 2;

  // ── Pobierz dane z zakładki jednym blokiem ─────────────────
  const kolTicker  = shObl.getRange('AK1:AK' + lastRow).getValues().flat();
  const kolTyp     = shObl.getRange('A1:A'   + lastRow).getValues().flat();
  const kolC       = shObl.getRange('C1:C'   + lastRow).getValues().flat();
  const kolD       = shObl.getRange('D1:D'   + lastRow).getValues().flat();
  const valueBlock = shObl.getRange(dataStartRow, firstOprCol, dataRows, numOprCols).getValues();

  // ── Zbierz unikalne serie (TOS też — dla porównania kolumny C) ─
  const serieSet = new Set();
  for (let i = 2; i < lastRow; i++) {
    const ticker = String(kolTicker[i] || '').trim();
    if (!ticker) continue;
    serieSet.add(tickerNaSerie(ticker));
  }

  if (serieSet.size === 0) {
    Logger.log('Brak serii do porównania.');
    return {
      krytycznyBlad: false,
      roznice: [],
      zgodne: [],
      pominiete: [],
      lastRow: lastRow
    };
  }

  // ── Pobierz dane z MF ──────────────────────────────────────
  let daneMF;
  try {
    daneMF = pobierzISparsujPlikMF();
  } catch (e) {
    Logger.log('BŁĄD KRYTYCZNY: Nie udało się pobrać pliku MF: ' + e.message);
    return { krytycznyBlad: true };
  }

  // Cache: { 'EDO0719': { opr1, marza, lata[] } }
  const cache = {};
  serieSet.forEach(function(seria) {
    try {
      const base = wyciagnijOprocentowanieZDanych(daneMF, seria);
      const full = wyciagnijWszystkieOkresyZDanych(daneMF, seria, OPR_KOLUMNY.length);
      cache[seria] = {
        opr1:  base.opr1,
        marza: base.marza,
        lata:  full.lata
      };
    } catch (e) {
      cache[seria] = { blad: e.message };
    }
  });

  // ── Porównaj wiersz po wierszu ─────────────────────────────
  const roznice   = [];
  const zgodne    = [];
  const pominiete = [];

  for (let i = 2; i < lastRow; i++) {
    const r       = i - 2;
    const typ     = String(kolTyp[i]    || '').trim().toUpperCase();
    const ticker  = String(kolTicker[i] || '').trim();

    if (!ticker) {
      pominiete.push('(pusta seria)');
      continue;
    }

    const seria     = tickerNaSerie(ticker);
    const mfDane    = cache[seria];
    const arkuszRow = i + 1;

    if (!mfDane || mfDane.blad) {
      roznice.push({
        ticker: ticker,
        seria: seria,
        arkuszRow: arkuszRow,
        pola: [{ pole: 'SERIA', info: 'Brak w pliku MF: ' + (mfDane ? mfDane.blad : '?') }]
      });
      continue;
    }

    const polaDiff = [];

    // ── Kolumna C (opr rok 1 / oprocentowanie TOS) ──────────
    const arkC = _toNumRound(kolC[i]);
    const mfC  = mfDane.opr1;
    if (mfC !== null && arkC !== null && arkC !== mfC) {
      polaDiff.push({
        pole:   typ === 'TOS' ? 'C (oprocentowanie TOS)' : 'C (rok 1)',
        arkusz: _fmt(arkC),
        mf:     _fmt(mfC)
      });
    }

    // ── Kolumna D (marża) — tylko dla nie-TOS ───────────────
    if (typ !== 'TOS') {
      const arkD = _toNumRound(kolD[i]);
      const mfD  = mfDane.marza;
      if (mfD !== null && arkD !== null && arkD !== mfD) {
        polaDiff.push({
          pole:   'D (marża)',
          arkusz: _fmt(arkD),
          mf:     _fmt(mfD)
        });
      }
    }

    // ── Kolumny H, J, L... — tylko dla nie-TOS ──────────────
    if (typ !== 'TOS') {
      OPR_KOLUMNY.forEach(function(kolNr, latIdx) {
        const colOffset = kolNr - firstOprCol;
        const arkVal    = _toNumRound(valueBlock[r][colOffset]);
        const mfVal     = mfDane.lata[latIdx];

        if (mfVal === null || mfVal === undefined) return;
        if (arkVal === null || arkVal === 0) return;

        if (arkVal !== mfVal) {
          polaDiff.push({
            pole:   'rok ' + (latIdx + 1) + ' (kol ' + _kolLitera(kolNr) + ')',
            arkusz: _fmt(arkVal),
            mf:     _fmt(mfVal)
          });
        }
      });
    }

    if (polaDiff.length > 0) {
      roznice.push({
        ticker: ticker,
        seria: seria,
        arkuszRow: arkuszRow,
        pola: polaDiff
      });
    } else {
      zgodne.push(ticker + ' (wiersz ' + arkuszRow + ')');
    }
  }

  return {
    krytycznyBlad: false,
    roznice: roznice,
    zgodne: zgodne,
    pominiete: pominiete,
    lastRow: lastRow
  };
}


// ============================================================
// WEWNĘTRZNE: LOGOWANIE RAPORTU
// ============================================================

function _zalogujRaportPorownania_(wynik, tytul) {
  Logger.log('=== ' + tytul + ' ===');

  if (wynik.roznice.length === 0) {
    Logger.log('✅ Wszystkie serie zgodne z plikiem MF (' + wynik.zgodne.length + ' serii).');
  } else {
    Logger.log('⚠️ Serie z różnicami (' + wynik.roznice.length + '):');
    wynik.roznice.forEach(function(r) {
      Logger.log('  [wiersz ' + r.arkuszRow + '] ' + r.ticker + ' (' + r.seria + '):');
      r.pola.forEach(function(p) {
        if (p.info) {
          Logger.log('    • ' + p.pole + ': ' + p.info);
        } else {
          Logger.log('    • ' + p.pole + ': arkusz=' + p.arkusz + ' | MF=' + p.mf + ' ⚠️');
        }
      });
    });
    Logger.log('');
    Logger.log('✅ Zgodne (' + wynik.zgodne.length + '): ' + (
      wynik.zgodne.length > 0
        ? wynik.zgodne.map(function(s) { return s.split(' ')[0]; }).join(', ')
        : '—'
    ));
  }

  Logger.log('⏭️ Pominięte (puste wiersze): ' + wynik.pominiete.length);
  Logger.log('=== KONIEC ' + tytul + ' ===');
  Logger.log('');
}

// ============================================================
// THE GREAT BEAUTIFUL BONDS CLEANUP ACT
// ============================================================
//
// Skrypt porządkuje i odtwarza dane w zakładce Obligacje.
// Uruchom go jeśli:
//   • importowałeś obligacje i chcesz upewnić się że dane są poprawne
//   • podejrzewasz że oprocentowanie w arkuszu różni się od danych MF
//   • zakładka Obligacje wygląda na uszkodzoną lub niekompletną
//   • chcesz przeprowadzić migrację danych z poprzedniej wersji arkusza
//
// Co robi krok po kroku:
//   1. Wczytuje dane podstawowe każdej obligacji (typ, data, liczba sztuk itp.)
//   2. Pobiera aktualne dane z pliku Ministerstwa Finansów i poprawia
//      oprocentowanie (kolumny C-D) jeśli różni się od danych MF
//   3. Odtwarza wszystkie formuły obliczeniowe dla każdej serii
//      (usuwa nadmiarowe kolumny dla krótszych obligacji np. COI 4 lata)
//   4. Zastępuje formuły oprocentowania rzeczywistymi wartościami z MF
//      dla lat które już minęły
//   5. Zamraża obligacje które zostały już wykupione — zastępuje formuły
//      wartościami żeby arkusz nie przeliczał niepotrzebnie danych
//
// Uwaga: Skrypt pobiera plik z danymi oprocentowania z serwisu Ministerstwa Finansów (gov.pl). 
//        Jeśli pobieranie się nie powiedzie, kroki 2 i 4 są pomijane a formuły są odtwarzane 
//        na bazie istniejących danych w arkuszu.
// ============================================================

function theGreatBeautifulBondsCleanupAct() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const shObl = ss.getSheetByName(shObligacje);

  if (!shObl) {
    Logger.log('BŁĄD: Nie znaleziono zakładki Obligacje.');
    return;
  }

  const lastRow = shObl.getLastRow();
  if (lastRow < 3) {
    Logger.log('Zakładka Obligacje jest pusta.');
    return;
  }

  Logger.log('=== THE GREAT BEAUTIFUL BONDS CLEANUP ACT ===');
  Logger.log('Data uruchomienia: ' + new Date().toLocaleString('pl-PL'));
  Logger.log('Liczba wierszy do przetworzenia: ' + (lastRow - 2));
  Logger.log('');

  // ── KROK 1: Pobierz kolumny A-G z zakładki Obligacje ──────
  Logger.log('--- KROK 1: Wczytywanie danych A-G ---');

  const kolA = shObl.getRange('A1:A' + lastRow).getValues().flat();
  const kolB = shObl.getRange('B1:B' + lastRow).getValues().flat();
  const kolC = shObl.getRange('C1:C' + lastRow).getValues().flat();
  const kolD = shObl.getRange('D1:D' + lastRow).getValues().flat();
  const kolE = shObl.getRange('E1:E' + lastRow).getValues().flat();
  const kolF = shObl.getRange('F1:F' + lastRow).getValues().flat();
  const kolAK = shObl.getRange('AK1:AK' + lastRow).getValues().flat();

  Logger.log('Dane wczytane.');
  Logger.log('');

  // ── KROK 2: Pobierz plik MF i popraw C-D ──────────────────
  Logger.log('--- KROK 2: Pobieranie pliku MF i weryfikacja C-D ---');

  let daneMF = null;
  let mfDostepne = false;

  try {
    daneMF = pobierzISparsujPlikMF();
    mfDostepne = true;
    Logger.log('Plik MF pobrany pomyślnie.');
  } catch(e) {
    Logger.log('BŁĄD KRYTYCZNY: Nie udało się pobrać pliku MF: ' + e.message);
    Logger.log('Kroki 2 i 4 zostaną pominięte. Formuły zostaną odtworzone na bazie istniejących wartości C-D.');
  }

  const poprawkiCD  = [];
  const bledyMF     = [];
  const cacheMF     = {};

  if (mfDostepne) {
    for (let i = 2; i < lastRow; i++) {
      const typ    = String(kolA[i]  || '').trim().toUpperCase();
      const ticker = String(kolAK[i] || '').trim();
      if (!ticker) continue;

      const seria = tickerNaSerie(ticker);
      if (!cacheMF[seria]) {
        try {
          const wynik = wyciagnijOprocentowanieZDanych(daneMF, seria);
          cacheMF[seria] = wynik;
        } catch(e) {
          cacheMF[seria] = { blad: e.message };
        }
      }

      const mfDane = cacheMF[seria];
      if (!mfDane || mfDane.blad) {
        bledyMF.push(ticker + ' (' + (mfDane ? mfDane.blad : '?') + ')');
        continue;
      }

      const arkuszRow = i + 1;

      // Kolumna C (opr rok 1 / TOS)
      const arkC = _toNumRound(kolC[i]);
      const mfC  = mfDane.opr1;
      if (mfC !== null && arkC !== mfC) {
        shObl.getRange(arkuszRow, 3).setValue(mfC);
        kolC[i] = mfC;  // aktualizuj lokalnie dla kroku 3
        poprawkiCD.push('[wiersz ' + arkuszRow + '] ' + ticker + ': C ' + _fmt(arkC) + ' → ' + _fmt(mfC));
      }

      // Kolumna D (marża) — nie dla TOS
      if (typ !== 'TOS' && mfDane.marza !== null) {
        const arkD = _toNumRound(kolD[i]);
        const mfD  = mfDane.marza;
        if (arkD !== mfD) {
          shObl.getRange(arkuszRow, 4).setValue(mfD);
          kolD[i] = mfD;  // aktualizuj lokalnie dla kroku 3
          poprawkiCD.push('[wiersz ' + arkuszRow + '] ' + ticker + ': D ' + _fmt(arkD) + ' → ' + _fmt(mfD));
        }
      }
    }

    if (poprawkiCD.length === 0) {
      Logger.log('Kolumny C-D: brak różnic z plikiem MF.');
    } else {
      Logger.log('Poprawki C-D (' + poprawkiCD.length + '):');
      poprawkiCD.forEach(function(p) { Logger.log('  ' + p); });
    }
    if (bledyMF.length > 0) {
      Logger.log('Serie niedostępne w MF (C-D bez zmian): ' + bledyMF.join(', '));
    }
  }

  Logger.log('');

  // ── KROK 3: Odtworzenie formuł H-AM ───────────────────────
  Logger.log('--- KROK 3: Odtwarzanie formuł H-AM ---');

  let odtworzone = 0;

  for (let i = 2; i < lastRow; i++) {
    const typ    = String(kolA[i]  || '').trim().toUpperCase();
    const ticker = String(kolAK[i] || '').trim();
    if (!ticker) continue;

    const arkuszRow  = i + 1;
    const data       = kolB[i];
    const pierwszyRok = Number(kolC[i]) || 0;
    const marza      = Number(kolD[i])  || 0;
    const liczba     = Number(kolE[i])  || 0;
    const dyskonto   = kolF[i] === true || kolF[i] === 'TRUE';
    const cena       = dyskonto ? 99.9 : 100;

    try {
      // Wyczyść stary zakres H-AM przed odtworzeniem
      shObl.getRange(arkuszRow, 8, 1, 32).clearContent(); // H(8) do AM(39) = 32 kolumny

      _dodajObligacjeCore(
        shObl, arkuszRow, ticker, typ, data,
        liczba, cena, pierwszyRok, marza, dyskonto,
        true
      );
      odtworzone++;
    } catch(e) {
      Logger.log('BŁĄD odtwarzania wiersza ' + arkuszRow + ' (' + ticker + '): ' + e.message);
    }
  }

  Logger.log('Odtworzono formuły dla ' + odtworzone + ' wierszy.');
  Logger.log('');

  // ── KROK 4: Aktualizacja oprocentowania z MF ──────────────
  if (mfDostepne) {
    Logger.log('--- KROK 4: Aktualizacja oprocentowania (formuły → wartości MF) ---');
    aktualizujOprocentowanieObligacje();
    Logger.log('');
  } else {
    Logger.log('--- KROK 4: Pominięto (brak pliku MF) ---');
    Logger.log('');
  }

  // ── KROK 5: Zamrożenie nieaktywnych obligacji ──────────────
  Logger.log('--- KROK 5: Zamrożenie nieaktywnych obligacji ---');

  // Odczytaj AJ po odtworzeniu formuł (wartości mogły się zmienić)
  const kolAJ = shObl.getRange('AJ1:AJ' + lastRow).getValues().flat();

  const nieaktywne        = [];
  const wierszeDoUsuniecia = [];

  for (let i = 2; i < lastRow; i++) {
    const ticker    = String(kolAK[i] || '').trim();
    if (!ticker) continue;

    const aktywna   = kolAJ[i];
    const arkuszRow = i + 1;

    // FALSE lub pusty = nieaktywna (wykupiona)
    if (aktywna === true || aktywna === 'TRUE') continue;

    // Pobierz cały zakres formuł A-AM i zastąp wartościami
    const numCols = 39; // A(1) do AM(39)
    const zakres  = shObl.getRange(arkuszRow, 1, 1, numCols);
    const wartosci = zakres.getValues();
    zakres.setValues(wartosci);

    nieaktywne.push(ticker + ' (wiersz ' + arkuszRow + ')');
    wierszeDoUsuniecia.push(arkuszRow);
  }

  if (nieaktywne.length === 0) {
    Logger.log('Brak nieaktywnych obligacji.');
  } else {
    Logger.log('Zamrożone nieaktywne obligacje (' + nieaktywne.length + '):');
    nieaktywne.forEach(function(t) { Logger.log('  ' + t); });
  }

  // Opcjonalne usunięcie nieaktywnych wierszy — ZAKOMENTOWANE
  /*
  if (wierszeDoUsuniecia.length > 0) {
    // Usuwamy od końca żeby nie przesuwać indeksów
    wierszeDoUsuniecia.slice().reverse().forEach(function(row) {
      shObl.deleteRow(row);
      Logger.log('Usunięto wiersz ' + row);
    });
  }
  */

  Logger.log('');
  Logger.log('=== PODSUMOWANIE ===');
  Logger.log('Wiersze przetworzone:       ' + odtworzone);
  Logger.log('Poprawki C-D z MF:          ' + poprawkiCD.length);
  Logger.log('Serie niedostępne w MF:     ' + bledyMF.length);
  Logger.log('Nieaktywne (zamrożone):     ' + nieaktywne.length);
  Logger.log('=== KONIEC ===');
}

// ── Helpers ────────────────────────────────────────────────

function _toNumRound(val) {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? null : Math.round(n * 10000) / 10000;
}

function _fmt(val) {
  if (val === null || val === undefined) return 'null';
  return (val * 100).toFixed(2) + '%';
}

function _kolLitera(kolNr) {
  if (kolNr <= 26) return String.fromCharCode(64 + kolNr);
  return 'A' + String.fromCharCode(64 + kolNr - 26);
}