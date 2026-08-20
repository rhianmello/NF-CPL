/**
 * exportPdf.js
 * ---------------------------------------------------------------------
 * Gera um PDF reproduzindo visualmente o Demonstrativo de Caixa
 * (cabeçalho com logo, Obra, Período, Data, Responsável, DC Nº e a
 * tabela de lançamentos), usando jsPDF + jspdf-autotable.
 * ---------------------------------------------------------------------
 */

const ExportPdf = (() => {

  function formatMoneyCell(n) {
    if (n === null || n === undefined || n === '') return '';
    return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function download(lancamentos, config, logoDataUrl) {
    if (typeof window.jspdf === 'undefined') {
      throw new Error('Biblioteca de exportação PDF não carregou. Verifique a conexão com a internet.');
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 40;

    // ---- Cabeçalho ----
    let cursorY = 40;

    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, 'PNG', marginX, cursorY - 8, 48, 48, undefined, 'FAST');
      } catch (e) {
        console.warn('Não foi possível inserir o logo no PDF.', e);
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(22, 50, 79); // azul "blueprint"
    doc.text('DEMONSTRATIVO DE CAIXA', logoDataUrl ? marginX + 60 : marginX, cursorY + 12);

    doc.setFontSize(10);
    doc.setTextColor(90, 90, 90);
    doc.text(`Obra: ${config.obra || '—'}`, logoDataUrl ? marginX + 60 : marginX, cursorY + 30);

    // DC Nº no canto direito, como "carimbo"
    const dcLabel = `DC Nº ${config.dcNum || '—'}`;
    doc.setFillColor(22, 50, 79);
    const dcWidth = doc.getTextWidth(dcLabel) + 20;
    doc.roundedRect(pageWidth - marginX - dcWidth, cursorY - 14, dcWidth, 22, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(dcLabel, pageWidth - marginX - dcWidth + 10, cursorY + 1);

    cursorY += 46;
    doc.setDrawColor(210, 210, 210);
    doc.line(marginX, cursorY, pageWidth - marginX, cursorY);
    cursorY += 18;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    const infoColWidth = (pageWidth - marginX * 2) / 2;
    const infoLeft = [
      ['Período', config.periodo || '—'],
      ['Data', config.data || '—']
    ];
    const infoRight = [
      ['Responsável', config.responsavel || '—'],
      ['Página', '1']
    ];
    infoLeft.forEach(([label, value], i) => {
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}:`, marginX, cursorY + i * 16);
      doc.setFont('helvetica', 'normal');
      doc.text(String(value), marginX + 70, cursorY + i * 16);
    });
    infoRight.forEach(([label, value], i) => {
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}:`, marginX + infoColWidth, cursorY + i * 16);
      doc.setFont('helvetica', 'normal');
      doc.text(String(value), marginX + infoColWidth + 80, cursorY + i * 16);
    });

    cursorY += 40;

    // ---- Tabela ----
    const totals = lancamentos.reduce((acc, l) => {
      acc.entrada += Number(l.entrada) || 0;
      acc.saida += Number(l.saida) || 0;
      return acc;
    }, { entrada: 0, saida: 0 });

    const body = lancamentos.map((l, i) => [
      String(i + 1),
      l.data || '',
      l.numDoc || '',
      l.fornecedor || '',
      formatMoneyCell(l.entrada),
      formatMoneyCell(l.saida)
    ]);

    doc.autoTable({
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      head: [['Item', 'Data', 'Num Doc', 'Fornecedor/Histórico', 'Entrada', 'Saída']],
      body,
      foot: [['', '', '', 'Totais', formatMoneyCell(totals.entrada), formatMoneyCell(totals.saida)]],
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: [30, 30, 30] },
      headStyles: { fillColor: [22, 50, 79], textColor: [255, 255, 255], fontStyle: 'bold' },
      footStyles: { fillColor: [237, 241, 245], textColor: [22, 50, 79], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 34, halign: 'center' },
        1: { cellWidth: 62 },
        2: { cellWidth: 68 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 62, halign: 'right' },
        5: { cellWidth: 62, halign: 'right' }
      },
      alternateRowStyles: { fillColor: [250, 251, 252] }
    });

    const nome = `Demonstrativo_Caixa_${(config.dcNum || 'sem-numero').replace(/[^\w-]/g, '')}.pdf`;
    doc.save(nome);
  }

  return { download };
})();
