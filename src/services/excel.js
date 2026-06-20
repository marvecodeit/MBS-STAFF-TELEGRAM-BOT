const ExcelJS = require('exceljs');

const GRADE_SCALE = [
  { min: 70, grade: 'A', remark: 'Excellent' },
  { min: 60, grade: 'B', remark: 'Good' },
  { min: 50, grade: 'C', remark: 'Average' },
  { min: 40, grade: 'D', remark: 'Below Average' },
  { min: 0,  grade: 'F', remark: 'Fail' },
];

function getGrade(score) {
  return GRADE_SCALE.find(g => score >= g.min) || { grade: 'F', remark: 'Fail' };
}

// ── The columns the backend SKIPS during subject parsing ──────────────────────
const SKIP_COLS = new Set(['Reg No', 'Term', 'Class', 'Student Name']);

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE TEMPLATE
// Teacher fills subject score columns; "Student Name" is read-only reference.
// ═══════════════════════════════════════════════════════════════════════════════
async function generateTemplate({ students, className, classId, session, term, subjects }) {
  const workbook = new ExcelJS.Workbook();

  // ── Sheet 1: Results (the uploadable sheet) ───────────────────────────────
  const sheet = workbook.addWorksheet('Results');

  const subjectCols = subjects?.length
    ? subjects
    : ['Mathematics', 'English Language', 'Basic Science', 'Social Studies', 'Civic Education'];

  // Row 1 — Info bar (not parsed by backend, just metadata for teacher)
  sheet.mergeCells(1, 1, 1, subjectCols.length + 4);
  const infoCell = sheet.getCell('A1');
  infoCell.value = `Class: ${className}  |  Term: ${term}  |  Session: ${session}  |  Class ID: ${classId}`;
  infoCell.font  = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  infoCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
  infoCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 22;

  // Row 2 — Column headers
  const headers = ['Reg No', 'Student Name', 'Term', 'Class', ...subjectCols];
  const headerRow = sheet.getRow(2);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });
  sheet.getRow(2).height = 28;

  // Row 3+ — Students
  students.forEach((student, idx) => {
    const row = sheet.getRow(idx + 3);
    const bg  = idx % 2 === 0 ? 'FFF9F9F9' : 'FFFFFFFF';

    row.getCell(1).value = student.registrationNumber || '';
    row.getCell(2).value = student.fullname || '';
    row.getCell(3).value = term;
    row.getCell(4).value = className;

    // Lock non-score cells (styling only — actual protection set below)
    [1, 2, 3, 4].forEach(col => {
      row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      row.getCell(col).font = col === 2 ? { bold: true } : {};
      row.getCell(col).border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });

    // Subject score cells — yellow, empty
    subjectCols.forEach((_, si) => {
      const cell = row.getCell(si + 5);
      cell.value = null;
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
      cell.alignment = { horizontal: 'center' };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });

    row.commit();
  });

  // Column widths
  sheet.getColumn(1).width = 18; // Reg No
  sheet.getColumn(2).width = 26; // Student Name
  sheet.getColumn(3).width = 14; // Term
  sheet.getColumn(4).width = 14; // Class
  subjectCols.forEach((_, i) => { sheet.getColumn(i + 5).width = 18; });

  // ── Sheet 2: Instructions ─────────────────────────────────────────────────
  const info = workbook.addWorksheet('📌 Instructions');
  const rows = [
    ['📌 HOW TO FILL THIS TEMPLATE'],
    [''],
    ['1. Go back to the "Results" sheet.'],
    ['2. Enter each student\'s score in the YELLOW cells (subject columns).'],
    ['3. Do NOT change Reg No, Student Name, Term, or Class columns.'],
    ['4. Scores must be numbers between 0 and 100.'],
    ['5. Save the file and send it back to the Telegram bot.'],
    ['6. The bot will upload your scores to the school system automatically.'],
    [''],
    ['GRADING SCALE:'],
    ['70 – 100  →  A  (Excellent)'],
    ['60 – 69   →  B  (Good)'],
    ['50 – 59   →  C  (Average)'],
    ['40 – 49   →  D  (Below Average)'],
    ['0  – 39   →  F  (Fail)'],
  ];
  rows.forEach((r, i) => {
    const cell = info.getCell(`A${i + 1}`);
    cell.value = r[0];
    if (i === 0) cell.font = { bold: true, size: 13 };
    if (r[0]?.startsWith('GRADING')) cell.font = { bold: true };
  });
  info.getColumn('A').width = 55;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERT UPLOADED FILE → CLEAN XLSX FOR BACKEND
// Reads teacher-filled Excel, strips "Student Name" col, builds a clean buffer
// that the backend's xlsx.read() can parse (SKIP_COLS: Reg No, Term, Class).
// ═══════════════════════════════════════════════════════════════════════════════
async function cleanResultsExcel(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const srcSheet = workbook.getWorksheet('Results') || workbook.worksheets[0];
  if (!srcSheet) throw new Error('No "Results" sheet found in the uploaded file.');

  // Detect header row: prefer row 2 (our template has an info bar on row 1).
  // Fall back to row 1 if row 2 doesn't contain "Reg No".
  function readColMap(rowNum) {
    const map = [];
    srcSheet.getRow(rowNum).eachCell({ includeEmpty: false }, (cell, colNum) => {
      map.push({ colNum, name: String(cell.value || '').trim() });
    });
    return map;
  }

  let colMap     = readColMap(2);
  let dataStart  = 3; // data rows start after row 2 headers
  if (!colMap.some(c => c.name === 'Reg No')) {
    // Try row 1 as header (plain sheet without info bar)
    colMap    = readColMap(1);
    dataStart = 2;
  }

  // Subject columns are everything except our SKIP_COLS
  const subjectCols = colMap.filter(c => !SKIP_COLS.has(c.name));
  const regNoCol    = colMap.find(c => c.name === 'Reg No');
  const termCol     = colMap.find(c => c.name === 'Term');
  const classCol    = colMap.find(c => c.name === 'Class');

  if (!regNoCol) throw new Error('Could not find "Reg No" column. Make sure you used the official template.');
  if (subjectCols.length === 0) throw new Error('No subject columns found. Please fill in the score columns (yellow cells).');

  // Build clean workbook for backend
  const cleanWb    = new ExcelJS.Workbook();
  const cleanSheet = cleanWb.addWorksheet('Sheet1');

  // Headers: Reg No | Term | Class | Subject1 | Subject2 ...
  const cleanHeaders = [
    'Reg No',
    termCol  ? 'Term'  : null,
    classCol ? 'Class' : null,
    ...subjectCols.map(c => c.name),
  ].filter(Boolean);

  cleanSheet.addRow(cleanHeaders);

  // Data rows start at dataStart (row 3 for our template, row 2 for plain sheets)
  let hasData = false;
  srcSheet.eachRow((row, rowNum) => {
    if (rowNum < dataStart) return;
    const regNo = String(row.getCell(regNoCol.colNum).value || '').trim();
    if (!regNo) return;

    const dataRow = [
      regNo,
      termCol  ? String(row.getCell(termCol.colNum).value  || '').trim() : null,
      classCol ? String(row.getCell(classCol.colNum).value || '').trim() : null,
      ...subjectCols.map(c => {
        const v = row.getCell(c.colNum).value;
        return v !== null && v !== undefined && v !== '' ? Number(v) : 0;
      }),
    ].filter((_, i) => cleanHeaders[i] !== undefined);

    cleanSheet.addRow(dataRow);
    hasData = true;
  });

  if (!hasData) throw new Error('No student data rows found. Make sure you filled in the scores and did not delete the student rows.');

  const cleanBuffer = await cleanWb.xlsx.writeBuffer();

  // Extract preview summary for success message
  const preview = [];
  srcSheet.eachRow((row, rowNum) => {
    if (rowNum < dataStart) return;
    const name   = String(row.getCell(colMap.find(c => c.name === 'Student Name')?.colNum || 2).value || '').trim();
    const scores = subjectCols.map(c => Number(row.getCell(c.colNum).value) || 0);
    const total  = scores.reduce((a, b) => a + b, 0);
    const avg    = scores.length ? (total / scores.length).toFixed(1) : 0;
    const { grade } = getGrade(Number(avg));
    if (name) preview.push({ name, total, avg, grade });
  });

  return { buffer: Buffer.from(cleanBuffer), preview, subjectCount: subjectCols.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE PAYMENT REPORT EXCEL
// ═══════════════════════════════════════════════════════════════════════════════
async function generatePaymentReport({ payments, title }) {
  const workbook = new ExcelJS.Workbook();
  const sheet    = workbook.addWorksheet('Payment Report');

  // Title row
  sheet.mergeCells('A1:G1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = title;
  titleCell.font  = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D47A1' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 28;

  // Headers
  const hdrs = ['S/N', 'Student Name', 'Reg Number', 'Fee', 'Amount Paid', 'Balance', 'Status'];
  const hdrRow = sheet.getRow(2);
  hdrs.forEach((h, i) => {
    const cell = hdrRow.getCell(i + 1);
    cell.value = h;
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
    cell.alignment = { horizontal: 'center' };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });
  sheet.getRow(2).height = 22;

  payments.forEach((p, idx) => {
    const row = sheet.getRow(idx + 3);
    const bg  = idx % 2 === 0 ? 'FFF5F5F5' : 'FFFFFFFF';
    const vals = [
      idx + 1,
      p.student?.fullname || '—',
      p.student?.registrationNumber || '—',
      p.fee?.title || '—',
      `₦${(p.amountPaid || 0).toLocaleString()}`,
      `₦${(p.balance || 0).toLocaleString()}`,
      (p.status || '').toUpperCase(),
    ];
    vals.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.alignment = { horizontal: i === 0 ? 'center' : 'left' };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      if (i === 6) {
        cell.font = { bold: true, color: { argb: p.status === 'paid' ? 'FF1B5E20' : 'FFB71C1C' } };
      }
    });
    row.commit();
  });

  const widths = [6, 28, 18, 26, 14, 14, 12];
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { generateTemplate, cleanResultsExcel, generatePaymentReport, getGrade };
