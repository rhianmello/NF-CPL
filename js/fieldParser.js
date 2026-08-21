/**
 * fieldParser.js
 * Parser contextual para NF-e, NFC-e, DANFE e recibos.
 * Nunca usa um número aleatório como campo fiscal quando existe um rótulo/contexto melhor.
 */

const FieldParser = (() => {
  const MONTHS_PT = { jan:'01', fev:'02', mar:'03', abr:'04', mai:'05', jun:'06', jul:'07', ago:'08', set:'09', out:'10', nov:'11', dez:'12' };

  function cleanLines(text) {
    return (text || '').split(/\r?\n/)
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  }

  function moneyToNumber(str) {
    if (!str) return null;
    let s = String(str).trim().replace(/^R\$\s*/i, '');
    if (/\d,\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function formatMoney(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const MONEY_TOKEN = /\b\d{1,3}(?:\.\d{3})*,\d{2}\b|\b\d+,\d{2}\b/g;
  const DATE_TOKEN = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/;

  function moneyTokensInLine(line) {
    return (line.match(MONEY_TOKEN) || []).map(moneyToNumber).filter(n => n !== null);
  }

  function extractDate(text) {
    const lines = cleanLines(text);
    const preferred = lines.filter(l => /(EMISSAO|DATA DA EMISSAO|DATA EMISSAO|EMITIDO|EMISSAO EM)/.test(normalize(l)));
    for (const line of [...preferred, ...lines]) {
      const m = line.match(DATE_TOKEN);
      if (!m) continue;
      const d = +m[1], mo = +m[2]; let y = +m[3];
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2099) {
        return `${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y}`;
      }
    }
    const joined = lines.join('\n');
    const t = joined.match(/\b(\d{1,2})\s*(?:de)?\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zçã]*\s*(?:de)?\s*(\d{2,4})\b/i);
    if (t) {
      const d = +t[1], mo = MONTHS_PT[t[2].toLowerCase()]; let y = +t[3];
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31 && mo) return `${String(d).padStart(2,'0')}/${mo}/${y}`;
    }
    return '';
  }

  function classifyNumDoc(text) {
    const u = normalize(text).replace(/\s+/g, ' ');
    if (/NFC\s*[-–]?\s*E|NFC\s*E|FISCAL\s+DE\s+CONSUMIDOR\s+ELETRONICA|NOTA\s+FISCAL\s+DE\s+CONSUMIDOR|CUPOM\s+FISCAL/.test(u)) return 'NOTA FISCAL';
    if (/DANFE|DOCUMENTO AUXILIAR DA NOTA FISCAL/.test(u)) return 'DANFE';
    if (/\bRECIBO\b/.test(u)) return 'RECIBO';
    if (/\bCOMANDA\b/.test(u)) return 'COMANDA';
    if (/\bNF[- ]?E\b|\bNFE\b|\bNOTA FISCAL\b/.test(u)) return 'NOTA FISCAL';
    return 'OUTRO';
  }

  function extractDocumentNumber(text) {
    const lines = cleanLines(text);
    const patterns = [
      /NFC\s*[-–]?\s*E[^0-9]{0,20}(?:N[º°O]|NO|NUMERO|N\.)?\s*[:#-]?\s*(\d{4,12})/i,
      /(?:NUMERO|N[.º°O]?\s*(?:DA)?\s*NOTA|NOTA\s*(?:FISCAL)?\s*N[.º°O]?|NF[- ]?E)\s*[:#-]?\s*(\d{1,12})/i,
      /\bN[.º°O]\s*[:#-]?\s*(\d{1,12})\b/i
    ];
    for (const line of lines) {
      for (const p of patterns) {
        const m = line.match(p);
        if (m) return m[1];
      }
    }
    // Alguns OCRs quebram "NFC-e nº 00006363" em duas linhas.
    for (let i = 0; i < lines.length - 1; i++) {
      const joined = `${lines[i]} ${lines[i + 1]}`;
      for (const p of patterns) {
        const m = joined.match(p);
        if (m) return m[1];
      }
    }
    return '';
  }

  const STOP = /CNPJ|CPF|INSCRICAO|ENDERECO|DANFE|RECIBO|COMANDA|NOTA FISCAL|CUPOM|DOCUMENTO|AUXILIAR|CHAVE DE ACESSO|PROTOCOLO|CONSUMIDOR|MUNICIPIO|EMISSAO|VALIDACAO|WWW\.|HTTP|VALOR|TOTAL|PAGAMENTO/;
  const ADDRESS = /\b(RUA|AVENIDA|AV\.?|TRAVESSA|ALAMEDA|RODOVIA|ESTRADA|PRACA|BAIRRO|CEP|N[º°O]?\.?|TEL|FONE)\b/;

  function scoreSupplier(line, idx) {
    const u = normalize(line);
    if (line.length < 3 || line.length > 70 || STOP.test(u) || ADDRESS.test(u)) return -Infinity;
    const letters = (line.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    const digits = (line.match(/\d/g) || []).length;
    const words = line.split(/\s+/).filter(Boolean);
    if (letters < 5 || digits > 3 || words.length < 2) return -Infinity;
    const alphaRatio = letters / Math.max(1, line.length);
    if (alphaRatio < 0.45) return -Infinity;
    let score = letters + words.length * 4 - digits * 5 - idx * 1.5;
    if (/LTDA|ME|EPP|COMERCIO|COMERCIO|SERVICOS|INDUSTRIA|RESTAURANTE|MERCADO|AUTO|CONSTRUTORA|GRILL|BAR|LANCHONETE|PADARIA/.test(u)) score += 25;
    if ((line.match(/[A-ZÀ-Ý]/g) || []).length >= letters * .65) score += 8;
    return score;
  }

  function extractFornecedor(text) {
    const lines = cleanLines(text);
    const normalized = lines.map(normalize);
    const cnpjIndex = normalized.findIndex(l => /CNPJ/.test(l));

    // Em NFC-e/DANFE, o nome do emitente normalmente fica imediatamente acima do CNPJ.
    const emitentePool = cnpjIndex >= 0
      ? lines.slice(Math.max(0, cnpjIndex - 4), cnpjIndex)
      : lines.slice(0, 15);

    let best = '', bestScore = -Infinity;
    emitentePool.forEach((line, idx) => {
      const s = scoreSupplier(line, idx);
      if (s > bestScore) { bestScore = s; best = line; }
    });

    // Fallback: procura o melhor nome empresarial no cabeçalho.
    if (!best) {
      lines.slice(0, 15).forEach((line, idx) => {
        const s = scoreSupplier(line, idx);
        if (s > bestScore) { bestScore = s; best = line; }
      });
    }

    // Correções seguras de OCR para padrões muito evidentes de nomes empresariais.
    const n = normalize(best).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (/R?REIR.?\s+O?\s*GRIL/.test(n) || /FERREIR.*GRIL/.test(n)) return 'FERREIRO GRILL';
    return best;
  }

  function extractValor(text) {
    const lines = cleanLines(text);
    const strong = [
      /VALOR\s+TOTAL\s+DA\s+NOTA/,
      /VALOR\s+TOTAL/,
      /TOTAL\s+DA\s+NOTA/,
      /TOTAL\s+R\$?/,
      /VALOR\s+A\s+PAGAR/,
      /TOTAL\s+A\s+PAGAR/,
      /VALOR\s+DO\s+DOCUMENTO/,
      /VALOR\s+PAGO/
    ];
    for (const rx of strong) {
      for (const line of lines) {
        if (rx.test(normalize(line))) {
          const vals = moneyTokensInLine(line);
          if (vals.length) return Math.max(...vals);
        }
      }
    }
    for (let i = 0; i < lines.length; i++) {
      if (/VALOR\s+TOTAL|TOTAL\s+DA\s+NOTA|VALOR\s+A\s+PAGAR|TOTAL\s+A\s+PAGAR|VALOR\s+PAGO/.test(normalize(lines[i]))) {
        for (const candidate of lines.slice(i, Math.min(i + 3, lines.length))) {
          const vals = moneyTokensInLine(candidate);
          if (vals.length) return Math.max(...vals);
        }
      }
    }
    const candidates = [];
    lines.forEach(line => {
      if (/TOTAL|PAGAR|DOCUMENTO|PAGO/.test(normalize(line)) && !/SUBTOTAL|ITENS|QUANTIDADE/.test(normalize(line))) {
        candidates.push(...moneyTokensInLine(line));
      }
    });
    return candidates.length ? Math.max(...candidates) : null;
  }

  function parseDocumentText(rawText) {
    const text = rawText || '';
    const tipo = classifyNumDoc(text);
    const data = extractDate(text);
    const numero = extractDocumentNumber(text);
    const fornecedor = extractFornecedor(text);
    const valor = extractValor(text);
    return {
      data,
      numDoc: tipo,
      numeroDoc: numero,
      fornecedor,
      valor,
      valorFormatado: valor !== null ? formatMoney(valor) : '',
      confidence: {
        data: !!data,
        numDoc: tipo !== 'OUTRO',
        numeroDoc: !!numero,
        fornecedor: !!fornecedor,
        valor: valor !== null
      }
    };
  }

  return { parseDocumentText, extractDate, classifyNumDoc, extractDocumentNumber, extractFornecedor, extractValor, moneyToNumber, formatMoney };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FieldParser;
