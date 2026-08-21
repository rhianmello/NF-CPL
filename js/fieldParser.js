/**
 * fieldParser.js
 * Leitura contextual de documentos fiscais/recibos.
 * A regra principal é procurar os campos pelo rótulo e contexto,
 * evitando escolher simplesmente o primeiro número, texto ou valor da imagem.
 */

const FieldParser = (() => {
  const MONTHS_PT = {
    jan:'01', fev:'02', mar:'03', abr:'04', mai:'05', jun:'06',
    jul:'07', ago:'08', set:'09', out:'10', nov:'11', dez:'12'
  };

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
    return n.toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
  }

  const MONEY_TOKEN = /\b\d{1,3}(?:\.\d{3})*,\d{2}\b|\b\d+,\d{2}\b/g;
  const DATE_TOKEN = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/;

  function moneyTokensInLine(line) {
    return (line.match(MONEY_TOKEN) || []).map(moneyToNumber).filter(n => n !== null);
  }

  function extractDate(text) {
    const lines = cleanLines(text);
    const preferred = lines.filter(l => /(EMISSAO|DATA DA EMISSAO|DATA EMISSAO|EMITIDO|EMISSAO EM)/.test(normalize(l)));
    const pool = [...preferred, ...lines];
    for (const line of pool) {
      const m = line.match(DATE_TOKEN);
      if (m) {
        const d=+m[1], mo=+m[2]; let y=+m[3]; if(y<100)y+=2000;
        if(d>=1&&d<=31&&mo>=1&&mo<=12&&y>=2000&&y<=2099)
          return `${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y}`;
      }
    }
    const joined = lines.join('\n');
    const t = joined.match(/\b(\d{1,2})\s*(?:de)?\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zçã]*\s*(?:de)?\s*(\d{2,4})\b/i);
    if (t) {
      const d=+t[1], mo=MONTHS_PT[t[2].toLowerCase()]; let y=+t[3]; if(y<100)y+=2000;
      if(d>=1&&d<=31&&mo)return `${String(d).padStart(2,'0')}/${mo}/${y}`;
    }
    return '';
  }

  function classifyNumDoc(text) {
    const u=normalize(text);
    if (/\bDANFE\b/.test(u) || /DOCUMENTO AUXILIAR DA NOTA FISCAL/.test(u)) return 'DANFE';
    if (/\bRECIBO\b/.test(u)) return 'RECIBO';
    if (/\bCOMANDA\b/.test(u)) return 'COMANDA';
    if (/NFC-E|NFCE|NOTA FISCAL DE CONSUMIDOR|CUPOM FISCAL/.test(u)) return 'NOTA FISCAL';
    if (/\bNF-E\b|\bNFE\b|NOTA FISCAL/.test(u)) return 'NOTA FISCAL';
    return 'OUTRO';
  }

  function extractDocumentNumber(text) {
    const lines=cleanLines(text);
    const patterns=[
      /(?:NUMERO|N[.ºO]?\s*(?:DA)?\s*NOTA|NOTA\s*(?:FISCAL)?\s*N[.ºO]?|NF[- ]?E)\s*[:#-]?\s*(\d{1,12})/i,
      /\bN[.ºO]\s*[:#-]?\s*(\d{1,12})\b/i
    ];
    for(const line of lines){
      for(const p of patterns){const m=line.match(p);if(m)return m[1].replace(/^0+(?=\d)/,'');}
    }
    // Em DANFE, "Nº ..." costuma aparecer perto de série/folha; aceita apenas linha curta.
    for(const line of lines.slice(0,15)){
      const m=line.match(/\bN[ºO]\.?\s*(\d{1,12})\b/i);
      if(m && !/CNPJ|CPF|CEP|CHAVE|PROTOCOLO|TELEFONE/i.test(line)) return m[1].replace(/^0+(?=\d)/,'');
    }
    return '';
  }

  const STOP = /CNPJ|CPF|INSCRICAO|ENDERECO|DANFE|RECIBO|COMANDA|NOTA FISCAL|CUPOM|DOCUMENTO|AUXILIAR|CHAVE DE ACESSO|PROTOCOLO|CONSUMIDOR|MUNICIPIO|EMISSAO|VALIDACAO|WWW\.|HTTP|VALOR|TOTAL|PAGAMENTO/;
  const ADDRESS = /\b(RUA|AVENIDA|AV\.?|TRAVESSA|ALAMEDA|RODOVIA|ESTRADA|PRACA|BAIRRO|CEP|N[ºO]\.?|TEL|FONE)\b/;

  function scoreSupplier(line, idx) {
    const u=normalize(line);
    if(line.length<3||line.length>70||STOP.test(u)||ADDRESS.test(u))return -Infinity;
    const letters=(line.match(/[A-Za-zÀ-ÿ]/g)||[]).length;
    const digits=(line.match(/\d/g)||[]).length;
    if(letters<4)return -Infinity;
    let score=letters - digits*3 - idx*1.5;
    if(/LTDA|ME|EPP|COMERCIO|COMERCIO|SERVICOS|INDUSTRIA|RESTAURANTE|MERCADO|AUTO|CONSTRUTORA/.test(u))score+=15;
    if((line.match(/[A-ZÀ-Ý]/g)||[]).length>=letters*.65)score+=8;
    return score;
  }

  function extractFornecedor(text) {
    const lines=cleanLines(text);
    let best='',bestScore=-Infinity;
    // Em NF, prioriza bloco do emitente antes de "DESTINATARIO/REMETENTE".
    const end=Math.max(1, lines.findIndex(l=>/DESTINATARIO|REMETENTE|DADOS DO DESTINATARIO/i.test(normalize(l))));
    lines.slice(0,Math.min(end,15)).forEach((line,idx)=>{const s=scoreSupplier(line,idx);if(s>bestScore){bestScore=s;best=line;}});
    return bestScore>-Infinity ? best : '';
  }

  function extractValor(text) {
    const lines=cleanLines(text);
    const strong=[
      /VALOR\s+TOTAL\s+DA\s+NOTA/,
      /VALOR\s+TOTAL/,
      /TOTAL\s+DA\s+NOTA/,
      /VALOR\s+A\s+PAGAR/,
      /TOTAL\s+A\s+PAGAR/,
      /VALOR\s+DO\s+DOCUMENTO/,
      /TOTAL\s+R\$?/
    ];
    // Primeiro: mesmo rótulo + valor na mesma linha.
    for(const rx of strong){
      for(const line of lines){
        if(rx.test(normalize(line))){const vals=moneyTokensInLine(line);if(vals.length)return Math.max(...vals);}
      }
    }
    // Segundo: rótulo em uma linha e valor logo ao lado/na linha seguinte.
    for(let i=0;i<lines.length;i++){
      if(/VALOR\s+TOTAL|TOTAL\s+DA\s+NOTA|VALOR\s+A\s+PAGAR|TOTAL\s+A\s+PAGAR/.test(normalize(lines[i]))){
        for(const candidate of lines.slice(i,Math.min(i+3,lines.length))){const vals=moneyTokensInLine(candidate);if(vals.length)return Math.max(...vals);}
      }
    }
    // Fallback conservador: somente valores monetários em linhas que parecem total.
    const candidates=[];
    lines.forEach(line=>{if(/TOTAL|PAGAR|DOCUMENTO/.test(normalize(line))&&!/SUBTOTAL|ITENS|QUANTIDADE/.test(normalize(line)))candidates.push(...moneyTokensInLine(line));});
    return candidates.length?Math.max(...candidates):null;
  }

  function parseDocumentText(rawText) {
    const text=rawText||'';
    const tipo=classifyNumDoc(text);
    const data=extractDate(text);
    const numero=extractDocumentNumber(text);
    const fornecedor=extractFornecedor(text);
    const valor=extractValor(text);
    return {
      data,
      numDoc: tipo,
      numeroDoc: numero,
      fornecedor,
      valor,
      valorFormatado: valor!==null?formatMoney(valor):'',
      confidence:{
        data:!!data,
        numDoc:tipo!=='OUTRO',
        numeroDoc:!!numero,
        fornecedor:!!fornecedor,
        valor:valor!==null
      }
    };
  }

  return {parseDocumentText,extractDate,classifyNumDoc,extractDocumentNumber,extractFornecedor,extractValor,moneyToNumber,formatMoney};
})();

if(typeof module!=='undefined'&&module.exports)module.exports=FieldParser;
