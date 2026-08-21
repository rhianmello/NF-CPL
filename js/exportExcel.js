/**
 * exportExcel.js
 * ---------------------------------------------------------------------
 * Gera o arquivo .xlsx reproduzindo o padrão do Demonstrativo de Caixa
 * (cabeçalho com Obra/Período/Data/Responsável/DC Nº + tabela
 * Item/Data/Num Doc/Fornecedor-Histórico/Entrada/Saída).
 *
 * Observação: a build "community" do SheetJS (xlsx.full.min.js), que é
 * gratuita e usada aqui, grava valores, mesclagens e largura de coluna
 * corretamente, mas NÃO exporta estilos de célula (negrito/cor/logo).
 * Para um visual 100% idêntico ao papel timbrado, use o botão
 * "🖨️ Gerar PDF", que reproduz cores e logo.
 * ---------------------------------------------------------------------
 */

const ExportExcel = (() => {

  function buildAoa(lancamentos, config, totals) {
    const aoa = [];
    aoa.push(['DEMONSTRATIVO DE CAIXA', '', '', '', '', '']);
    aoa.push([]);
    aoa.push(['Obra:', config.obra || '', '', 'DC Nº:', config.dcNum || '', '']);
    aoa.push(['Período:', config.periodo || '', '', 'Data:', config.data || '', '']);
    aoa.push(['Responsável:', config.responsavel || '', '', '', '', '']);
    aoa.push([]);
    aoa.push(['Item', 'Data', 'Num Doc', 'Fornecedor/Histórico', 'Entrada', 'Saída']);

    lancamentos.forEach((l, i) => {
      aoa.push([
        i + 1,
        l.data || '',
        l.numDoc || '',
        l.fornecedor || '',
        l.entrada ?? '',
        l.saida ?? ''
      ]);
    });

    aoa.push(['', '', '', 'Totais', totals.entrada, totals.saida]);
    return aoa;
  }

  function build(lancamentos, config) {
    const totals = lancamentos.reduce((acc, l) => {
      acc.entrada += Number(l.entrada) || 0;
      acc.saida += Number(l.saida) || 0;
      return acc;
    }, { entrada: 0, saida: 0 });

    const aoa = buildAoa(lancamentos, config, totals);
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    const headerRowIdx = 6; // 0-based -> linha 7 ("Item, Data, ...")
    const firstDataRow = headerRowIdx + 1;
    const lastDataRow = firstDataRow + lancamentos.length - 1;

    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } } // título
    ];
    ws['!cols'] = [
      { wch: 6 },   // Item
      { wch: 12 },  // Data
      { wch: 14 },  // Num Doc
      { wch: 38 },  // Fornecedor/Histórico
      { wch: 14 },  // Entrada
      { wch: 14 }   // Saída
    ];

    // formatação numérica (moeda BR) para colunas Entrada/Saída
    for (let r = firstDataRow; r <= lastDataRow; r++) {
      ['E', 'F'].forEach(col => {
        const ref = `${col}${r + 1}`;
        if (ws[ref] && typeof ws[ref].v === 'number') {
          ws[ref].t = 'n';
          ws[ref].z = '#,##0.00';
        }
      });
    }
    const totalsRowRef1 = `E${lastDataRow + 2}`;
    const totalsRowRef2 = `F${lastDataRow + 2}`;
    [totalsRowRef1, totalsRowRef2].forEach(ref => {
      if (ws[ref]) { ws[ref].t = 'n'; ws[ref].z = '#,##0.00'; }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Demonstrativo');
    return wb;
  }

  function download(lancamentos, config) {
    if (typeof XLSX === 'undefined') {
      throw new Error('Biblioteca de exportação Excel não carregou. Verifique a conexão com a internet.');
    }
    const wb = build(lancamentos, config);
    const nome = `Demonstrativo_Caixa_${(config.dcNum || 'sem-numero').replace(/[^\w-]/g, '')}.xlsx`;
    XLSX.writeFile(wb, nome);
  }

  return { build, download };
})();
