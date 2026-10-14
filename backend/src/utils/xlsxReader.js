// Safe .xlsx reading shared by the product import and the supplier catalog
// import: the zip guard runs first, exceljs loads with row/column caps, and
// every cell becomes plain text (never "[object Object]", never a formula).
const ExcelJS = require("exceljs");
const ApiError = require("./ApiError");
const { assertSafeXlsx } = require("./xlsxZipGuard");

const XLSX_MAX_ROWS = 2000;
const XLSX_MAX_COLS = 60;

function formatDate(date) {
  // exceljs builds dates from the Excel serial in UTC; the UTC day is the cell's day.
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function isExcelError(value) {
  return Boolean(value && typeof value === "object" && "error" in value);
}

function scalarText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

// Text of one exceljs cell:
//   empty -> ""; text, number, boolean -> String(value); date -> YYYY-MM-DD;
//   formula -> its calculated result ("" when missing or an Excel error such as
//   #DIV/0!), never the formula text; rich text and hyperlink -> visible text;
//   an Excel error value -> "".
function readXlsxCellValue(cell) {
  const value = cell?.value;
  const scalar = scalarText(value);
  if (scalar !== null) return scalar;
  if (isExcelError(value)) return "";

  if (typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
    const result = value.result;
    if (result === undefined || result === null || isExcelError(result)) return "";
    const resultText = scalarText(result);
    return resultText === null ? "" : resultText;
  }

  // Rich text ({ richText: [...] }) and hyperlinks ({ text, hyperlink }).
  const text = cell?.text;
  return typeof text === "string" ? text : "";
}

function translateExcelLoadError(error) {
  const limit = /^Max (\w+) count \((\d+)\) exceeded$/.exec(String(error?.message || ""));
  if (limit && limit[1] === "row") {
    return new ApiError(400, `La hoja de Excel tiene más de ${XLSX_MAX_ROWS.toLocaleString("en-US")} filas. Divide el archivo en partes más pequeñas.`);
  }
  if (limit) {
    return new ApiError(400, `La hoja de Excel tiene más de ${XLSX_MAX_COLS} columnas. Quita las columnas que no uses.`);
  }
  return new ApiError(400, "No se pudo leer el archivo de Excel. Revisa que sea un .xlsx válido.");
}

// Rows of the first visible sheet: [{ rowNumber, values: [text, ...] }].
// Other sheets are ignored (no error). The caps apply to every sheet, because
// exceljs parses all of them.
async function readFirstVisibleSheetRows(buffer) {
  assertSafeXlsx(buffer);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer, { maxRows: XLSX_MAX_ROWS, maxCols: XLSX_MAX_COLS });
  } catch (error) {
    throw translateExcelLoadError(error);
  }

  const worksheet = workbook.worksheets.find((sheet) => !sheet.state || sheet.state === "visible");
  if (!worksheet) {
    throw new ApiError(400, "El archivo de Excel no tiene hojas visibles con datos.");
  }

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    const values = [];
    for (let column = 1; column <= row.cellCount; column += 1) {
      values.push(readXlsxCellValue(row.getCell(column)));
    }
    rows.push({ rowNumber, values });
  });
  return rows;
}

module.exports = { readXlsxCellValue, readFirstVisibleSheetRows, XLSX_MAX_ROWS, XLSX_MAX_COLS };
