/**
 * fieldParser.js
 * ---------------------------------------------------------------------
 * Funções puras (sem dependência de DOM/OCR) que recebem o texto bruto
 * extraído de um documento e tentam identificar: Data, Num Doc,
 * Fornecedor/Histórico e Valor total.
 *
 * Isoladas em módulo próprio para poderem ser testadas com Node,
 * sem precisar de navegador/OpenCV/Tesseract.
 * ---------------------------------------------------------------------
 */

const FieldParser = (() => {

  const MONTHS_PT = {
    'jan': '01', 'fev': '02', 'mar': '03', 'abr': '04', 'mai': '05', 'jun': '06',
    'jul': '07', 'ago': '08', 'set': '09', 'out': '10', 'nov': '11', 'dez': '12'
  };

  function cleanLines(text) {
    return (text || '')
      .split(/\r?\n/)
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  /** Converte "1.234,56" ou "1234,56" ou "362.67" em número 1234.56 */
  function moneyToNumber(str) {
    if (!str) return null;
    let s = str.trim().replace(/^r\$\s*/i, '');
    // formato BR: milhar com ponto, decimal com vírgula
    if (/\d,\d{2}$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // já parece formato "internacional" (362.67) ou sem decimais
      s = s.replace(/,/g, '');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  /** Formata número para exibição BR: 1234.5 -> "1.234,50" */
  function formatMoney(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const MONEY_TOKEN = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g;

  function moneyTokensInLine(line) {
    const matches = line.match(MONEY_TOKEN) || [];
    return matches.map(moneyToNumber).filter(n => n !== null);
  }

  /** ---------------- DATA ---------------- */
  function extractDate(text) {
    const lines = cleanLines(text);
    const joined = lines.join('\n');

    // dd/mm/aaaa ou dd-mm-aaaa ou dd.mm.aaaa (com ano de 2 ou 4 dígitos)
    const numeric = joined.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g);
    if (numeric) {
      for (const m of numeric) {
        const parts = m.split(/[\/\-.]/);
        const d = parseInt(parts[0], 10);
        const mo = parseInt(parts[1], 10);
        let y = parseInt(parts[2], 10);
        if (y < 100) y += 2000;
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2099) {
          return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
        }
      }
    }

    // formato textual: "19 de agosto de 2026" ou "19 AGO 2026"
    const textual = joined.match(/\b(\d{1,2})\s*(?:de)?\s*[\/\-]?\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zçã]*\s*(?:de)?\s*(\d{2,4})\b/i);
    if (textual) {
      const d = parseInt(textual[1], 10);
      const mo = MONTHS_PT[textual[2].toLowerCase()];
      let y = parseInt(textual[3], 10);
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31 && mo) {
        return `${String(d).padStart(2, '0')}/${mo}/${y}`;
      }
    }

    return '';
  }

  /** ---------------- NUM DOC (tipo) ---------------- */
  function classifyNumDoc(text) {
    const upper = (text || '').toUpperCase();

    if (/\bDANFE\b/.test(upper)) return 'DANFE';
    if (/\bCOMANDA\b/.test(upper)) return 'COMANDA';
    if (/\bRECIBO\b/.test(upper)) return 'RECIBO';
    if (/NOTA\s+FISCAL|NF-?E\b|NFC-?E\b|CUPOM\s+FISCAL/.test(upper)) return 'NOTA FISCAL';

    return 'OUTRO';
  }

  /** ---------------- FORNECEDOR ---------------- */
  const FORNECEDOR_STOP_WORDS = /CNPJ|CPF|INSCRI[ÇC][ÃA]O|ENDERE[ÇC]O|DANFE|RECIBO|COMANDA|NOTA FISCAL|CUPOM|DOCUMENTO|AUXILIAR|CHAVE DE ACESSO|PROTOCOLO|CONSUMIDOR|MUNIC[IÍ]PIO|EMISS[ÃA]O|VALIDA[ÇC][ÃA]O|WWW\.|HTTP/;

  function looksLikeName(line) {
    if (line.length < 3 || line.length > 46) return false;
    if (/^\d+$/.test(line)) return false;
    if (FORNECEDOR_STOP_WORDS.test(line.toUpperCase())) return false;
    if (moneyTokensInLine(line).length && line.replace(MONEY_TOKEN, '').trim().length < 3) return false;
    // exige ao menos 2 letras seguidas
    if (!/[A-Za-zÀ-ÿ]{2,}/.test(line)) return false;
    return true;
  }

  const ADDRESS_WORDS = /\b(RUA|AVENIDA|AV\.?|TRAVESSA|ALAMEDA|RODOVIA|ROD\.?|ESTRADA|PRA[ÇC]A|BAIRRO|CEP|N[ºO]\.?)\b/;

  function extractFornecedor(text) {
    const lines = cleanLines(text).slice(0, 8); // fornecedor normalmente aparece no topo
    let best = '';
    let bestScore = -Infinity;
    lines.forEach((line, idx) => {
      if (!looksLikeName(line)) return;
      const stripped = line.replace(MONEY_TOKEN, '');
      const letters = (stripped.match(/[A-Za-zÀ-ÿ]/g) || []).length;
      const upperLetters = (stripped.match(/[A-ZÀ-Ý]/g) || []).length;
      const digits = (stripped.match(/\d/g) || []).length;
      const upperRatio = letters ? upperLetters / letters : 0;
      let score = letters;               // linhas mais "textuais" pontuam mais
      score += upperRatio * 8;            // nomes de estabelecimento costumam vir em caixa alta
      score -= idx * 4;                   // forte preferência pelo topo do documento
      score -= digits * 3;                // endereços/telefones têm mais dígitos que nomes
      if (ADDRESS_WORDS.test(line.toUpperCase())) score -= 15;
      if (score > bestScore) {
        bestScore = score;
        best = line;
      }
    });
    return best;
  }

  /** ---------------- VALOR TOTAL ---------------- */
  function extractValor(text) {
    const lines = cleanLines(text);

    // 1) linhas que mencionam "TOTAL" mas não "SUBTOTAL" / "TOTAL DE ITENS" / "QTD TOTAL"
    const totalCandidates = [];
    lines.forEach(line => {
      const upper = line.toUpperCase();
      const mentionsTotal = /\bTOTAL\b/.test(upper);
      const isSubtotal = /SUBTOTAL|SUB TOTAL/.test(upper);
      const isItemCount = /TOTAL\s+DE\s+ITENS|QTD\.?\s*TOTAL|TOTAL\s+ITENS/.test(upper);
      const isDiscount = /DESCONTO/.test(upper);
      if (mentionsTotal && !isSubtotal && !isItemCount && !isDiscount) {
        const vals = moneyTokensInLine(line);
        if (vals.length) totalCandidates.push(Math.max(...vals));
      }
    });
    if (totalCandidates.length) {
      // valor total "final" tende a ser o maior entre as linhas rotuladas como total
      // (cobre casos com "Total com serviço" vindo depois de um "Total" parcial)
      return Math.max(...totalCandidates);
    }

    // 2) fallback: maior valor monetário do documento inteiro
    const allValues = [];
    lines.forEach(line => {
      const upper = line.toUpperCase();
      if (/CNPJ|CPF|CHAVE DE ACESSO|PROTOCOLO/.test(upper)) return; // evita números longos de identificação
      allValues.push(...moneyTokensInLine(line));
    });
    if (allValues.length) return Math.max(...allValues);

    return null;
  }

  /** ---------------- Interface principal ---------------- */
  function parseDocumentText(rawText) {
    const text = rawText || '';
    const data = extractDate(text);
    const numDoc = classifyNumDoc(text);
    const fornecedor = extractFornecedor(text);
    const valor = extractValor(text);

    return {
      data,
      numDoc,
      fornecedor,
      valor,
      valorFormatado: valor !== null ? formatMoney(valor) : '',
      confidence: {
        data: !!data,
        numDoc: numDoc !== 'OUTRO',
        fornecedor: !!fornecedor,
        valor: valor !== null
      }
    };
  }

  return {
    parseDocumentText,
    extractDate,
    classifyNumDoc,
    extractFornecedor,
    extractValor,
    moneyToNumber,
    formatMoney
  };
})();

// Node.js (testes) e navegador (window) — expõe o mesmo objeto nos dois ambientes.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FieldParser;
}
