 function loadFormMultiasset() {
  const htmlForSidebar = HtmlService.createTemplateFromFile("multiasset");
  const htmlOutput = htmlForSidebar.evaluate();
  htmlOutput.setTitle("Dodaj proporcje aktywów");  
  const ui = SpreadsheetApp.getUi();
  ui.showSidebar(htmlOutput);
}


function getMultiassetsTickers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(shTransakcje);
  var data = sheet.getDataRange().getValues();
  var multiassetSheet = ss.getSheetByName(shMultiasset);
  var tickers = [];

  // Loop through the data and filter tickers based on column C and column F
  for (var i = 1; i < data.length; i++) { // Assuming header row is present, start from index 1
    if (data[i][5] === kl_MultiAsset) { // Check if value in column F is "Multiasset"
      tickers.push(data[i][2]); // Push value from column C (index 2) to the tickers array
    }
  }

  // Remove duplicates from the tickers array
  tickers = tickers.filter(function(item, index) {
    return tickers.indexOf(item) === index;
  });

  // Remove tickers that are already present in "Multiasset" sheet, column A
  var existingTickers = multiassetSheet.getRange('A2:A').getValues().flat();
  tickers = tickers.filter(function(ticker) {
    return !existingTickers.includes(ticker);
  });
    
  //Logger.log(tickers)
  return tickers;
}

function submitInvestmentForm(formData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var multiassetSheet = ss.getSheetByName(shMultiasset);

  var columnAData = multiassetSheet.getRange('A:A').getValues().flat();
  var nextEmptyRow = columnAData.findIndex(value => !value) + 1;

  // If there's no empty row found, set it to the last row + 1
  if (nextEmptyRow === 0) {
    nextEmptyRow = multiassetSheet.getLastRow() + 1;
  }
  var range = multiassetSheet.getRange(nextEmptyRow, 1, 1, 13); // Adjust columns as needed

  var values = [
    formData.tickers, // Column A
    '=SUMIFS(Portfolio!N:N;Portfolio!B:B;INDIRECT("A"&row());Portfolio!D:D;"Multi-asset")', // Column B
    parseFloat(formData.gotowka), // Column C
    '', // Column D
    parseFloat(formData.akcjePolskie), // Column E
    parseFloat(formData.akcjeZagraniczne), // Column F    
    parseFloat(formData.obligacjeSkarbowePolskie), // Column G
    parseFloat(formData.obligacjeSkarboweZagraniczne), // Column H
    parseFloat(formData.obligacjeKorporacyjnePolskie), // Column I
    parseFloat(formData.obligacjeKorporacyjneZagraniczne), // Column J
    parseFloat(formData.metaleISurowce), // Column K
    parseFloat(formData.kryptowaluty), // Column L
    parseFloat(formData.inne) // Column M
    
  ];

  range.setValues([values]);
}