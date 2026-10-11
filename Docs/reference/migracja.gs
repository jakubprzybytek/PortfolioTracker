// ============================================================
// ZMIENNE GLOBALNE (zakładamy że zdefiniowane gdzieś w projekcie)
// shTransakcje, shHistoria, shObligacje, shDashboard, shTechniczny, shMultiasset
// ============================================================


// ── ORKIESTRATOR ─────────────────────────────────────────────
function copyDataFromPreviousVersion() {
  const startTime = new Date();
  const timeLimit = 1000 * 60 * 2.5;

  Logger.log("Start: " + Utilities.formatDate(new Date(), 'CET', "yyyy-MM-dd HH:mm:ss"));

  const checkmark = '\u2713';
  const cross     = '\u2717';
  const ui        = SpreadsheetApp.getUi();

  // 1. Pobierz plik źródłowy
  const sourceFile = pobierzPlikZrodlowy(ui);
  if (!sourceFile) return;

  const targetFile = SpreadsheetApp.getActiveSpreadsheet();
  const statusMessages = [];

  // 2. Migracja głównych zakładek
  statusMessages.push(migrujTransakcje(sourceFile, targetFile, checkmark, cross));
  statusMessages.push(migrujHistorie(sourceFile, targetFile, checkmark, cross));
  statusMessages.push(migrujObligacje(sourceFile, targetFile, checkmark, cross));

  // 3. Migracja pozostałych zakładek
  statusMessages.push(migrujDashboard(sourceFile, targetFile, checkmark, cross));
  statusMessages.push(migrujTechniczny(sourceFile, targetFile, checkmark, cross));
  statusMessages.push(migrujMultiasset(sourceFile, targetFile, checkmark, cross));

  // 4. Utwórz triggery
  const triggerStatus = createDailyTrigger();
  const triggerStatusMessage = Object.values(triggerStatus).every(s => s)
    ? 'Trzy reguły zostały utworzone: masterDaily, historiaBackup, inflacja ' + checkmark
    : 'Przynajmniej jedna reguła już istnieje. Nowe reguły nie zostały dodane ' + cross;

  // 5. Wyświetl status
  const message = statusMessages.join('\n') + '\n' + triggerStatusMessage
    + '\n\nKliknij OK by zakończyć migrację i przeliczyć portfolio';
  ui.alert('Status migracji', message, ui.ButtonSet.OK);

  // 6. Procesy końcowe
  copyLastDaysOfPeriod(1);
  inflacja();

  const runningTime = new Date().getTime() - startTime.getTime();
  if (runningTime <= timeLimit) {
    przeliczPortfolio();
  } else {
    ui.alert('Status migracji',
      'Automatyczne przeliczenie portfolio nie powiodło się.\nPrzelicz Portfolio ręcznie',
      ui.ButtonSet.OK);
  }

  Logger.log('Czas wykonania: ' + (new Date().getTime() - startTime.getTime()) + ' ms');
}


// ── POBRANIE PLIKU ŹRÓDŁOWEGO ────────────────────────────────
function pobierzPlikZrodlowy(ui) {
  const message = "Wprowadź ID lub adres URL pliku, z którego chcesz pobrać dane.\n\n" +
                  "W razie niepowodzenia (przekroczenie czasu), powtórz proces i zweryfikuj zmigrowane dane";
  const response  = ui.prompt(message);
  const userInput = response.getResponseText();
  const fileId    = extractFileIdFromUrl(userInput) || userInput;

  if (!fileId) {
    ui.alert('Niepoprawne ID lub URL pliku. Skrypt przerwany.');
    Logger.log('Niepoprawne ID źródłowego pliku. Skrypt przerwany.');
    return null;
  }

  try {
    return SpreadsheetApp.openById(fileId);
  } catch (e) {
    ui.alert('Nie można otworzyć pliku. Upewnij się, że podałeś poprawne ID lub URL pliku.');
    Logger.log('Błąd podczas otwierania pliku o ID: ' + fileId + '. Błąd: ' + e.toString());
    return null;
  }
}

// ── MIGRACJA: ARKUSZ TECHNICZNY ──────────────────────────────
function migrujTechniczny(sourceFile, targetFile, checkmark, cross) {
  const sheetName   = shTechniczny;
  const sourceSheet = sourceFile.getSheetByName(sheetName);
  const targetSheet = targetFile.getSheetByName(sheetName);

  if (!sourceSheet || !targetSheet) {
    Logger.log(sheetName + ' - Nie znaleziono arkusza. Pominięto.');
    return sheetName + ' - ' + cross;
  }

  // Migracja kolumny A (waluty) — stała liczba 30 wierszy, od wiersza 2 (bez nagłówka)
  const sourceWaluty = sourceSheet.getRange("A2:A31").getValues();
  targetSheet.getRange("A2:A31").setValues(sourceWaluty);
  Logger.log(sheetName + ' - Skopiowano kolumnę A (waluty), wiersze 2-31.');

  // Wyznacz ostatni wiersz na podstawie kolumny K
  let lastRow = sourceSheet.getRange("K3:K").getValues()
                  .findIndex(row => row[0] === "") + 2;
  if (lastRow < 3) lastRow = sourceSheet.getLastRow();

  // Migracja zakresu K3:M (kursy i tickery) — z formułami
  const sourceRange = sourceSheet.getRange("K3:M" + lastRow);
  const values      = sourceRange.getValues();
  const formulas    = sourceRange.getFormulas();

  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values[i].length; j++) {
      const cell = targetSheet.getRange(3 + i, 11 + j);
      cell.setValue(values[i][j]);
      if (formulas[i][j]) cell.setFormula(formulas[i][j]);
    }
  }
  Logger.log(sheetName + ' - Skopiowano K3:M' + lastRow + '.');

  return `${sheetName} - Zmigrowano waluty (A) oraz kursy/tickery (K:M) ${checkmark}`;
}

// ── MIGRACJA: TRANSAKCJE ─────────────────────────────────────
function migrujTransakcje(sourceFile, targetFile, checkmark, cross) {
  const sheetName   = shTransakcje;
  const sourceSheet = sourceFile.getSheetByName(sheetName);
  const targetSheet = targetFile.getSheetByName(sheetName);

  if (!sourceSheet || !targetSheet) {
    Logger.log(sheetName + ' - Nie znaleziono arkusza źródłowego lub docelowego.');
    return sheetName + ' - ' + cross;
  }

  const sourceValues = sourceSheet.getDataRange().getValues();
  if (sourceValues.length <= 1) {
    Logger.log(sheetName + ' - Arkusz pusty lub zawiera tylko nagłówki. Pominięto.');
    return sheetName + ' - Pominięto (brak danych)';
  }

  if (targetSheet.getRange("A3").getValue() !== "") {
    Logger.log(sheetName + ' - Arkusz docelowy zawiera już dane. Pominięto.');
    return sheetName + ' - Pominięto (dane już istnieją)';
  }

  sourceValues.shift(); // usuń nagłówek

  // // Mapowanie kolumn: A-M (0-12) bez zmian, N i O (13,14) pomijamy, P (15) → N (13)
  // const filteredValues = sourceValues.map(row => {
  //   const newRow = row.slice(0, 13);  // A–M (indeksy 0–12)
  //   newRow.push(row[15]);             // P (indeks 15) → nowa N (indeks 13)
  //   return newRow;
  // });

  // Sprawdź wersję źródła na podstawie nagłówka kolumny N
  const isNowszyFormat = sourceSheet.getRange("N1").getValue() === "Komentarz";

  const filteredValues = sourceValues.map(row => {
    if (isNowszyFormat) {
      return row.slice(0, 14); // A–N (indeksy 0–13) bez pomijania
    } else {
      // Mapowanie kolumn: A-M (0-12) bez zmian, N i O (13,14) pomijamy, P (15) → N (13)
      const newRow = row.slice(0, 13); // A–M (indeksy 0–12)
      newRow.push(row[15]);            // P (indeks 15) → nowa N (indeks 13)
      return newRow;
    }
  });

  // Zaokrąglenie kolumny M (indeks 12) — totalPLN
  for (let i = 0; i < filteredValues.length; i++) {
    if (typeof filteredValues[i][12] === 'number') {
      filteredValues[i][12] = Math.round(filteredValues[i][12] * 100) / 100;
    }
  }

  const numRows = filteredValues.length;
  const numCols = filteredValues[0].length; // = 14 (A–N)

  const targetLastRow = targetSheet.getMaxRows();
  const rowsToAdd = Math.max(0, numRows - targetLastRow);
  if (rowsToAdd > 0) targetSheet.insertRowsAfter(targetLastRow, rowsToAdd);

  targetSheet.getRange(2, 1, numRows, numCols).clearContent();
  targetSheet.getRange(2, 1, numRows, numCols).setValues(filteredValues);

  // Usuń ostatni wiersz techniczny jeśli istnieje (=NOW() w kolumnie B)
  const lastRow = targetSheet.getLastRow();
  if (targetSheet.getRange(`B${lastRow}`).getFormula() === '=NOW()') {
    targetSheet.deleteRow(lastRow);
    Logger.log(sheetName + ' - Usunięto wiersz techniczny.');
  }

  Logger.log(sheetName + ' - Dane skopiowane pomyślnie.');
  return `${sheetName} - Liczba zmigrowanych wierszy: ${numRows} ${checkmark}`;
}

// ── MIGRACJA: HISTORIA ───────────────────────────────────────
function migrujHistorie(sourceFile, targetFile, checkmark, cross) {
  const sheetName   = shHistoria;
  const sourceSheet = sourceFile.getSheetByName(sheetName);
  const targetSheet = targetFile.getSheetByName(sheetName);

  if (!sourceSheet || !targetSheet) {
    Logger.log(sheetName + ' - Nie znaleziono arkusza źródłowego lub docelowego.');
    return sheetName + ' - ' + cross;
  }

  const sourceValues = sourceSheet.getDataRange().getValues();
  if (sourceValues.length <= 1) {
    Logger.log(sheetName + ' - Arkusz pusty lub zawiera tylko nagłówki. Pominięto.');
    return sheetName + ' - Pominięto (brak danych)';
  }

  if (targetSheet.getRange("A3").getValue() !== "") {
    Logger.log(sheetName + ' - Arkusz docelowy zawiera już dane. Pominięto.');
    return sheetName + ' - Pominięto (dane już istnieją)';
  }

  sourceValues.shift(); // usuń nagłówek

  // Zaokrąglenie kolumn 2–(n-3) do 2 miejsc po przecinku
  for (let i = 0; i < sourceValues.length; i++) {
    for (let j = 1; j < sourceValues[i].length - 3; j++) {
      if (typeof sourceValues[i][j] === 'number') {
        sourceValues[i][j] = Math.round(sourceValues[i][j] * 100) / 100;
      }
    }
  }

  const numRows = sourceValues.length;
  const numCols = sourceValues[0].length;

  const targetLastRow = targetSheet.getMaxRows();
  const rowsToAdd = Math.max(0, numRows - targetLastRow);
  if (rowsToAdd > 0) targetSheet.insertRowsAfter(targetLastRow, rowsToAdd);

  targetSheet.getRange(2, 1, numRows, numCols).clearContent();
  targetSheet.getRange(2, 1, numRows, numCols).setValues(sourceValues);

  // Wstaw formuły O, P, Q jeśli puste
  const lastRow = targetSheet.getLastRow();
  if (targetSheet.getRange("O2").isBlank() ||
      targetSheet.getRange("P2").isBlank() ||
      targetSheet.getRange("Q2").isBlank()) {

    const formulaO = `=LET(
    currentRow; ROW();
    dataDo; INDEX($A:$A; currentRow);
    valueEnd; INDEX($M:$M; currentRow);
    cashFlows; FILTER(
      IF(Transakcje!$G$2:$G="Wpłata środków"; -Transakcje!$M$2:$M; 
        IF(Transakcje!$G$2:$G="Wypłata środków"; Transakcje!$M$2:$M; 0)
      );
      (Transakcje!$B$2:$B<=dataDo)*(((Transakcje!$G$2:$G="Wpłata środków")+(Transakcje!$G$2:$G="Wypłata środków"))>0)
    );
    dates; FILTER(Transakcje!$B$2:$B; (Transakcje!$B$2:$B<=dataDo)*(((Transakcje!$G$2:$G="Wpłata środków")+(Transakcje!$G$2:$G="Wypłata środków"))>0));
    fullCash; {cashFlows; valueEnd};
    fullDates; {dates; dataDo};
    IFERROR(XIRR(fullCash; fullDates); "")
  )`;

    const formulaP = `=INDIRECT("M"&ROW())-INDIRECT("N"&ROW())`;
    const formulaQ = `=(INDIRECT("M"&ROW())/MAXIFS($M:$M;$A:$A;"<="&INDIRECT("A"&ROW())))-1`;

    targetSheet.getRange(`O2:O${lastRow}`).setFormula(formulaO);
    targetSheet.getRange(`P2:P${lastRow}`).setFormula(formulaP);
    targetSheet.getRange(`Q2:Q${lastRow}`).setFormula(formulaQ);
  }

  Logger.log(sheetName + ' - Dane skopiowane pomyślnie.');
  return `${sheetName} - Liczba zmigrowanych wierszy: ${numRows} ${checkmark}`;
}

// ── MIGRACJA: OBLIGACJE ──────────────────────────────────────
function migrujObligacje(sourceFile, targetFile, checkmark, cross) {
  const sheetName   = shObligacje;
  const sourceSheet = sourceFile.getSheetByName(sheetName);
  const targetSheet = targetFile.getSheetByName(sheetName);

  if (!sourceSheet || !targetSheet) {
    Logger.log(sheetName + ' - Nie znaleziono arkusza źródłowego lub docelowego.');
    return sheetName + ' - ' + cross;
  }

  const sourceValues = sourceSheet.getDataRange().getValues();
  if (sourceValues.length <= 2) {
    Logger.log(sheetName + ' - Arkusz pusty lub zawiera tylko nagłówki. Pominięto.');
    return sheetName + ' - Pominięto (brak danych)';
  }

  if (targetSheet.getRange("A3").getValue() !== "") {
    Logger.log(sheetName + ' - Arkusz docelowy zawiera już dane. Pominięto.');
    return sheetName + ' - Pominięto (dane już istnieją)';
  }

  const lastDataRow = sourceValues.length; // łącznie z nagłówkami
  const numRows = lastDataRow - 2;         // bez 2 wierszy nagłówka

  // Pobierz wartości A-G (indeksy 0-6) od wiersza 3 (index 2)
  const valuesAG   = sourceSheet.getRange(3, 1, numRows, 7).getValues();
  const formulasAG = sourceSheet.getRange(3, 1, numRows, 7).getFormulas();

  // Pobierz ticker z kolumny AK (kolumna 37) ze źródła
  const valuesAK   = sourceSheet.getRange(3, 37, numRows, 1).getValues();

  // Połącz A-G z wartościami, ale kolumnę G zastąp formułą jeśli istnieje
  const mergedAG = valuesAG.map((row, i) => {
    return row.map((cell, j) => {
      return formulasAG[i][j] !== "" ? formulasAG[i][j] : cell;
    });
  });

  // Upewnij się że jest wystarczająco wierszy
  const targetLastRow = targetSheet.getMaxRows();
  const rowsToAdd = Math.max(0, numRows - targetLastRow);
  if (rowsToAdd > 0) targetSheet.insertRowsAfter(targetLastRow, rowsToAdd);

  // Wklej A-G używając setValues dla wartości i setFormula dla formuł komórka po komórce
  for (let i = 0; i < numRows; i++) {
    for (let j = 0; j < 7; j++) {
      const cell = targetSheet.getRange(3 + i, 1 + j);
      if (formulasAG[i][j] !== "") {
        cell.setFormula(formulasAG[i][j]);
      } else {
        cell.setValue(valuesAG[i][j]);
      }
    }
  }

  // Ustaw walidację checkbox dla kolumny F (kolumna 6)
  const checkboxRule = SpreadsheetApp.newDataValidation()
    .requireCheckbox()
    .setAllowInvalid(false)
    .build();
  targetSheet.getRange(3, 6, numRows, 1).setDataValidation(checkboxRule);

  // Wklej ticker (AK) — wymagany przez theGreatBeautifulBondsCleanupAct
  targetSheet.getRange(3, 37, numRows, 1).setValues(valuesAK);

  Logger.log(sheetName + ' - Kolumny A-G + AK skopiowane. Uruchamianie theGreatBeautifulBondsCleanupAct...');
  theGreatBeautifulBondsCleanupAct();

  // Po cleanup usuń tymczasowy ticker AK jeśli cleanup go nadpisał własnymi formułami
  // (jeśli _dodajObligacjeCore samo wypełnia AK, nie trzeba tego robić)

  Logger.log(sheetName + ' - Odbudowa zakończona.');
  return `${sheetName} - Kolumny A-G przeniesione, formuły odbudowane ${checkmark}`;
}

// ── MIGRACJA: DASHBOARD ──────────────────────────────────────
function migrujDashboard(sourceFile, targetFile, checkmark, cross) {
  const sheetName     = shDashboard;
  const targetSheet   = targetFile.getSheetByName(sheetName);
  const sourceSheet   = sourceFile.getSheetByName(sheetName);

  if (!targetSheet || !sourceSheet) {
    Logger.log(sheetName + ' - Nie znaleziono arkusza. Pominięto.');
    return sheetName + ' - ' + cross;
  }

  if (targetSheet.getRange("E19").getValue() !== "Gotówka" ||
      targetSheet.getRange("E20").getValue() !== "Waluty"  ||
      targetSheet.getRange("E29").getValue() !== "Inne") {
    Logger.log(sheetName + ' - Struktura docelowego Dashboardu niezgodna. Pominięto.');
    return sheetName + ' - Pominięto (niezgodna struktura)';
  }

  // Kopiuj wagi portfela H19:H29
  targetSheet.getRange("H19:H29").setValues(
    sourceSheet.getRange("H19:H29").getValues()
  );
  Logger.log(sheetName + ' - Skopiowano H19:H29.');

  // Kopiuj wartości logiczne O32:O41 (tylko jeśli wszystkie są Boolean)
  const booleanValues = sourceSheet.getRange("O32:O41").getValues();
  const validBooleans = booleanValues.every(row => row[0] === true || row[0] === false);

  if (validBooleans) {
    targetSheet.getRange("O32:O41").setValues(booleanValues);
    Logger.log(sheetName + ' - Skopiowano O32:O41.');
  } else {
    Logger.log(sheetName + ' - Niepoprawne dane w O32:O41. Pominięto ten zakres.');
  }

  return `${sheetName} - Zmigrowano wagi portfela oraz konfiguracje kont ${checkmark}`;
}

// ── MIGRACJA: MULTI-ASSET ────────────────────────────────────
function migrujMultiasset(sourceFile, targetFile, checkmark, cross) {
  const sheetName   = shMultiasset;
  const sourceSheet = sourceFile.getSheetByName(sheetName);
  const targetSheet = targetFile.getSheetByName(sheetName);

  if (!sourceSheet || !targetSheet) {
    Logger.log(sheetName + ' - Nie znaleziono arkusza. Pominięto.');
    return sheetName + ' - ' + cross;
  }

  let lastRow = sourceSheet.getRange("A1:A").getValues()
                  .findIndex(row => row[0] === "");
  if (lastRow < 3) lastRow = sourceSheet.getLastRow();

  const sourceRange = sourceSheet.getRange("A2:M" + lastRow);
  const values      = sourceRange.getValues();
  const formulas    = sourceRange.getFormulas();

  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values[i].length; j++) {
      const cell = targetSheet.getRange(2 + i, 1 + j);
      cell.setValue(values[i][j]);
      if (formulas[i][j]) cell.setFormula(formulas[i][j]);
    }
  }

  Logger.log(sheetName + ' - Dane skopiowane pomyślnie.');
  return `${sheetName} - Zmigrowano konfiguracje funduszy Multi-asset ${checkmark}`;
}


// ── HELPER: wyodrębnij ID z URL ──────────────────────────────
function extractFileIdFromUrl(url) {
  const match = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)\//.exec(url);
  return match ? match[1] : null;
}


// ── HELPER: utwórz triggery (bez zmian) ─────────────────────
function createDailyTrigger() {
  const functionsToCheck = ['masterDaily', 'historiaBackup', 'inflacja'];
  const triggers = ScriptApp.getProjectTriggers();
  const status   = { masterDaily: false, historiaBackup: false, inflacja: false };

  const anyExists = functionsToCheck.some(fn =>
    triggers.some(t => t.getHandlerFunction() === fn)
  );

  if (anyExists) {
    Logger.log('Przynajmniej jedna reguła już istnieje. Nie tworzę nowych reguł.');
    return status;
  }

  const startHour = 17;
  const endHour   = 21;
  const randomHour = Math.floor(Math.random() * (endHour - startHour + 1)) + startHour;

  ScriptApp.newTrigger('masterDaily').timeBased().everyDays(1).atHour(randomHour).create();
  status.masterDaily = true;

  ScriptApp.newTrigger('historiaBackup').timeBased().everyDays(1).atHour(randomHour + 2).create();
  status.historiaBackup = true;

  const days = [
    ScriptApp.WeekDay.SUNDAY, ScriptApp.WeekDay.MONDAY, ScriptApp.WeekDay.TUESDAY,
    ScriptApp.WeekDay.WEDNESDAY, ScriptApp.WeekDay.THURSDAY,
    ScriptApp.WeekDay.FRIDAY, ScriptApp.WeekDay.SATURDAY
  ];
  const randomDay  = days[Math.floor(Math.random() * days.length)];
  const randomHourInflacja = Math.floor(Math.random() * 24);

  ScriptApp.newTrigger('inflacja').timeBased().everyWeeks(1)
    .onWeekDay(randomDay).atHour(randomHourInflacja).create();
  status.inflacja = true;

  Logger.log(status);
  return status;
}