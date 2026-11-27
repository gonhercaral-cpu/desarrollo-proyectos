import { jsPDF } from 'jspdf';
import JSZip from 'jszip';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileBase(report) {
  const slug = String(report.id || 'reporte').replace(/[^a-z0-9_-]/gi, '_');
  const stamp = new Date().toISOString().slice(0, 10);
  return `produccion_${slug}_${stamp}`;
}

function sanitizeCsvValue(value) {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let str = String(value);
  if (/^[\t\r]/.test(str) || /^\s*[=+\-@]/.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function exportReportCSV(report) {
  const cols = report.columns || [];
  const lines = [cols.map((c) => sanitizeCsvValue(c.label)).join(',')];
  for (const row of report.rows || []) {
    lines.push(cols.map((c) => sanitizeCsvValue(row[c.key])).join(','));
  }
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${safeFileBase(report)}.csv`);
}

function xmlEscape(value) {
  return Array.from(String(value ?? ''), ch=>{const code=ch.codePointAt(0);return code>=32||[9,10,13].includes(code)?ch:'';}).join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLetters(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function buildWorksheetXml(matrix, headerRowIndex = 0) {
  const maxCols = matrix.reduce((m, r) => Math.max(m, r.length), 1);
  const widths = Array.from({ length: maxCols }, (_, ci) => {
    const maxLen = matrix.reduce((m, r) => Math.max(m, String(r[ci] ?? '').length), 10);
    return Math.min(48, Math.max(12, maxLen + 3));
  });
  const colsXml = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  const rowsXml = matrix.map((row, rIdx) => {
    const style = rIdx === headerRowIndex ? 1 : 0;
    const cells = row.map((val, cIdx) => {
      const ref = `${colLetters(cIdx)}${rIdx + 1}`;
      if (typeof val === 'number' && Number.isFinite(val)) {
        return `<c r="${ref}" s="${style}" t="n"><v>${val}</v></c>`;
      }
      const txt = xmlEscape(val ?? '');
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${txt}</t></is></c>`;
    }).join('');
    return `<row r="${rIdx + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${colsXml}<sheetData>${rowsXml}</sheetData></worksheet>`;
}

export async function exportReportXLSX(report) {
  const zip = new JSZip();
  const cols = report.columns || [];
  const summaryRows = [
    ['Campo', 'Valor'],
    ['Reporte', report.title || 'Reporte de producción'],
    ['Descripción', report.subtitle || ''],
    ['Periodo', report.periodLabel || ''],
    ['Filtros', report.filtersSummary || ''],
    ['Generado', report.generatedAt || ''],
    ['Total de filas', (report.rows || []).length],
    ...(report.truncatedWarning ? [['Advertencia', report.truncatedWarning]] : []),
    ...(report.notes ? [['Notas', report.notes]] : []),
    ['', ''],
    ['Indicador', 'Valor'],
    ...(report.kpis || []).map((k) => [k.label, k.delta ? `${k.value} (${k.delta})` : k.value]),
  ];
  const dataRows = [
    cols.map((c) => c.label),
    ...(report.rows || []).map((row) => cols.map((c) => {
      const v = row[c.key];
      return typeof v === 'number' && Number.isFinite(v) ? v : String(v ?? '');
    })),
  ];

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Resumen" sheetId="1" r:id="rId1"/>
    <sheet name="Datos" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F294A"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
</styleSheet>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rootRels);
  zip.file('xl/workbook.xml', workbookXml);
  zip.file('xl/_rels/workbook.xml.rels', wbRels);
  zip.file('xl/styles.xml', stylesXml);
  zip.file('xl/worksheets/sheet1.xml', buildWorksheetXml(summaryRows, 0));
  zip.file('xl/worksheets/sheet2.xml', buildWorksheetXml(dataRows, 0));

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `${safeFileBase(report)}.xlsx`);
}

function pdfText(v) {
  return String(v ?? 'N/D').replace(/[—–]/g, '-').replace(/·/g, '|');
}

export function exportReportPDF(report) {
  const cols = report.columns || [];
  const landscape = cols.length > 6;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const usableW = pageW - margin * 2;
  const colW = cols.map((c) => (c.numeric ? 0.85 : 1.35));
  const weightSum = colW.reduce((s, w) => s + w, 0) || 1;
  const widths = colW.map((w) => (w / weightSum) * usableW);

  const drawBanner = (compact = false) => {
    const h = compact ? 38 : 68;
    doc.setFillColor(15, 41, 74);
    doc.rect(0, 0, pageW, h, 'F');
    doc.setFillColor(29, 78, 216);
    doc.rect(0, h, pageW, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(compact ? 11 : 15);
    doc.text(pdfText(report.title || 'Reporte de Producción'), margin, compact ? 24 : 30);
    if (!compact) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(pdfText(`${report.subtitle || ''} | Periodo: ${report.periodLabel || ''}`), margin, 48);
      doc.text(pdfText(`Generado: ${report.generatedAt || ''}`), pageW - margin, 30, { align: 'right' });
    }
    return h + 16;
  };

  let y = drawBanner(false);
  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const filterLines = doc.splitTextToSize(pdfText(`Filtros: ${report.filtersSummary || 'Sin filtros'}`), usableW);
  doc.text(filterLines, margin, y);
  y += filterLines.length * 11 + 4;

  if (report.truncatedWarning) {
    doc.setFillColor(254, 243, 199);
    doc.rect(margin, y - 8, usableW, 20, 'F');
    doc.setTextColor(146, 64, 14);
    doc.text(pdfText(`AVISO: ${report.truncatedWarning}`), margin + 6, y + 4);
    y += 22;
  }

  const kpis = report.kpis || [];
  if (kpis.length) {
    const gap = 8;
    const boxW = (usableW - gap * (kpis.length - 1)) / kpis.length;
    kpis.forEach((k, i) => {
      const x = margin + i * (boxW + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, y, boxW, 42, 4, 4, 'FD');
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(7.5);
      doc.text(pdfText(k.label), x + 8, y + 14);
      doc.setTextColor(15, 41, 74);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(pdfText(k.value), x + 8, y + 31);
      doc.setFont('helvetica', 'normal');
    });
    y += 54;
  }

  const drawTableHeader = () => {
    doc.setFillColor(15, 41, 74);
    doc.rect(margin, y, usableW, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    let x = margin;
    cols.forEach((c, i) => {
      const tx = c.numeric ? x + widths[i] - 5 : x + 5;
      doc.text(pdfText(c.label), tx, y + 14, { align: c.numeric ? 'right' : 'left' });
      x += widths[i];
    });
    y += 22;
  };

  drawTableHeader();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const rows = report.rows || [];
  if (!rows.length) {
    doc.setTextColor(100, 116, 139);
    doc.text('Sin registros verificados para el periodo y filtros seleccionados.', margin + 6, y + 16);
    y += 26;
  } else {
    rows.forEach((row, rIdx) => {
      const cells = cols.map((c, i) => doc.splitTextToSize(pdfText(row[c.key]), Math.max(24, widths[i] - 10)));
      const maxLines = Math.max(1, ...cells.map((l) => l.length));
      const rowH = maxLines * 10 + 8;
      if (y + rowH > pageH - 42) {
        doc.addPage();
        y = drawBanner(true);
        drawTableHeader();
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
      }
      if (rIdx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, usableW, rowH, 'F');
      }
      doc.setTextColor(30, 41, 59);
      let x = margin;
      cols.forEach((c, i) => {
        const tx = c.numeric ? x + widths[i] - 5 : x + 5;
        doc.text(cells[i], tx, y + 12, { align: c.numeric ? 'right' : 'left' });
        x += widths[i];
      });
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + rowH, margin + usableW, y + rowH);
      y += rowH;
    });
  }

  if (report.notes) {
    if (y + 30 > pageH - 42) { doc.addPage(); y = drawBanner(true); }
    doc.setTextColor(71, 85, 105);
    doc.setFontSize(8);
    doc.text(doc.splitTextToSize(pdfText(`Notas: ${report.notes}`), usableW), margin, y + 14);
  }

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Producción de Imprenta - Reporte Institucional', margin, pageH - 18);
    doc.text(`Página ${p} de ${totalPages}`, pageW - margin, pageH - 18, { align: 'right' });
  }
  doc.save(`${safeFileBase(report)}.pdf`);
}
