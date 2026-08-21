/**
 * fieldParser.js
 * Parser contextual para NF-e, NFC-e, DANFE e recibos.
 */

const FieldParser = (() => {
  const MONTHS_PT = { jan:'01', fev:'02', mar:'03', abr:'04', mai:'05', jun:'06', jul:'07', ago:'08', set:'09', out:'10', nov:'11', dez:'12' };
  function cleanLines(text){return (text||'').split(/\r?\n/).map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean);}
  function normalize(text){return String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();}

  function moneyToNumber(str){
    if(!str)return null;
    let s=String(str).trim().replace(/^R\$\s*/i,'').replace(/[^0-9,.-]/g,'');
    if(!s)return null;
    if(/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(s)) s=s.replace(/\./g,'').replace(',','.');
    else if(/^\d{1,3}(?:\.\d{3})*\.\d{2}$/.test(s)) s=s.replace(/\./g,'').replace(/(\d{2})$/,'.$1');
    else if(/^\d+,\d{2}$/.test(s)) s=s.replace(',','.');
    else if(/^\d+\.\d{2}$/.test(s)){}
    else if(/^\d+,\d{3}$/.test(s)) s=s.slice(0,-1).replace(',','.');
    else s=s.replace(/,/g,'');
    const n=parseFloat(s);
    return Number.isFinite(n)?Math.round(n*100)/100:null;
  }
  function formatMoney(n){return n===null||n===undefined||Number.isNaN(n)?'':n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}

  const MONEY_TOKEN=/(?:R\$\s*)?\b\d{1,3}(?:[.,]\d{3})*[.,]\d{2,3}\b/g;
  const DATE_TOKEN=/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/;
  function moneyTokensInLine(line){return (line.match(MONEY_TOKEN)||[]).map(moneyToNumber).filter(n=>n!==null&&n>=0&&n<100000000);}

  function extractDate(text){
    const lines=cleanLines(text);
    const preferred=lines.filter(l=>/(EMISSAO|DATA DA EMISSAO|DATA EMISSAO|EMITIDO|EMISSAO EM|DATA DE AUTORIZACAO|AUTORIZACAO|DATA AUTORIZACAO)/.test(normalize(l)));
    for(const line of [...preferred,...lines]){
      const m=line.match(DATE_TOKEN); if(!m)continue;
      const d=+m[1],mo=+m[2]; let y=+m[3]; if(y<100)y+=2000;
      if(d>=1&&d<=31&&mo>=1&&mo<=12&&y>=2000&&y<=2099)return `${String(d).padStart(2,'0')}/${String(mo).padStart(2,'0')}/${y}`;
    }
    const t=lines.join('\n').match(/\b(\d{1,2})\s*(?:de)?\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zçã]*\s*(?:de)?\s*(\d{2,4})\b/i);
    if(t){const d=+t[1],mo=MONTHS_PT[t[2].toLowerCase()];let y=+t[3];if(y<100)y+=2000;if(d>=1&&d<=31&&mo&&y>=2000&&y<=2099)return `${String(d).padStart(2,'0')}/${mo}/${y}`;}
    return '';
  }

  function classifyNumDoc(text){
    const u=normalize(text).replace(/\s+/g,' ');
    if(/NFC\s*[-–]?\s*E|NFC\s*E|FISCAL\s+DE\s+CONSUMIDOR\s+ELETRONICA|NOTA\s+FISCAL\s+DE\s+CONSUMIDOR|CUPOM\s+FISCAL/.test(u))return 'NOTA FISCAL';
    if(/DANFE|DOCUMENTO AUXILIAR DA NOTA FISCAL/.test(u))return 'DANFE';
    if(/\bRECIBO\b/.test(u))return 'RECIBO';
    if(/\bCOMANDA\b/.test(u))return 'COMANDA';
    if(/\bNF[- ]?E\b|\bNFE\b|\bNOTA FISCAL\b/.test(u))return 'NOTA FISCAL';
    return 'OUTRO';
  }

  function extractDocumentNumber(text){
    const lines=cleanLines(text);
    const patterns=[
      /NFC\s*[-–]?\s*E[^0-9]{0,20}(?:N[º°O]|NO|NUMERO|N\.)?\s*[:#-]?\s*(\d{4,12})/i,
      /(?:NUMERO|N[.º°O]?\s*(?:DA)?\s*NOTA|NOTA\s*(?:FISCAL)?\s*N[.º°O]?|NF[- ]?E)\s*[:#-]?\s*(\d{1,12})/i,
      /\bN[.º°O]\s*[:#-]?\s*(\d{1,12})\b/i
    ];
    for(const line of lines)for(const p of patterns){const m=line.match(p);if(m)return m[1];}
    for(let i=0;i<lines.length-1;i++){const joined=`${lines[i]} ${lines[i+1]}`;for(const p of patterns){const m=joined.match(p);if(m)return m[1];}}
    return '';
  }

  const STOP=/CNPJ|CPF|INSCRICAO|ENDERECO|DANFE|RECIBO|COMANDA|NOTA FISCAL|CUPOM|DOCUMENTO|AUXILIAR|CHAVE DE ACESSO|PROTOCOLO|CONSUMIDOR|MUNICIPIO|EMISSAO|VALIDACAO|WWW\.|HTTP|VALOR|TOTAL|PAGAMENTO/;
  const ADDRESS=/\b(RUA|AVENIDA|AV\.?|TRAVESSA|ALAMEDA|RODOVIA|ESTRADA|PRACA|BAIRRO|CEP|N[º°O]?\.?|TEL|FONE)\b/;
  function scoreSupplier(line,idx){
    const u=normalize(line);if(line.length<3||line.length>70||STOP.test(u)||ADDRESS.test(u))return -Infinity;
    const letters=(line.match(/[A-Za-zÀ-ÿ]/g)||[]).length,digits=(line.match(/\d/g)||[]).length,words=line.split(/\s+/).filter(Boolean);
    if(letters<5||digits>3||words.length<2)return -Infinity;
    if(letters/Math.max(1,line.length)<.45)return -Infinity;
    let score=letters+words.length*4-digits*5-idx*1.5;
    if(/LTDA|ME|EPP|COMERCIO|SERVICOS|INDUSTRIA|RESTAURANTE|MERCADO|AUTO|CONSTRUTORA|GRILL|BAR|LANCHONETE|PADARIA/.test(u))score+=25;
    if((line.match(/[A-ZÀ-Ý]/g)||[]).length>=letters*.65)score+=8;
    return score;
  }
  function extractFornecedor(text){
    const lines=cleanLines(text),normalized=lines.map(normalize),cnpjIndex=normalized.findIndex(l=>/CNPJ/.test(l));
    const pool=cnpjIndex>=0?lines.slice(Math.max(0,cnpjIndex-4),cnpjIndex):lines.slice(0,15);
    let best='',bestScore=-Infinity;pool.forEach((line,idx)=>{const s=scoreSupplier(line,idx);if(s>bestScore){bestScore=s;best=line;}});
    if(!best)lines.slice(0,15).forEach((line,idx)=>{const s=scoreSupplier(line,idx);if(s>bestScore){bestScore=s;best=line;}});
    const n=normalize(best).replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
    if(/R?REIR.?\s+O?\s*GRIL/.test(n)||/FERREIR.*GRIL/.test(n))return 'FERREIRO GRILL';
    return best;
  }

  function extractValor(text){
    const lines=cleanLines(text);
    const strong=[/VALOR\s+TOTAL\s+DA\s+NOTA/,/VALOR\s+TOTAL/,/TOTAL\s+DA\s+NOTA/,/TOTAL\s+R\$?/,/VALOR\s+A\s+PAGAR/,/TOTAL\s+A\s+PAGAR/,/VALOR\s+DO\s+DOCUMENTO/,/VALOR\s+PAGO/];
    for(const rx of strong)for(let i=0;i<lines.length;i++)if(rx.test(normalize(lines[i]))){
      const vals=moneyTokensInLine(lines[i]);if(vals.length)return Math.max(...vals);
      for(const next of lines.slice(i+1,i+3)){const v=moneyTokensInLine(next);if(v.length)return Math.max(...v);}
    }
    // Fallback específico de NFC-e: se o rótulo do total foi perdido pelo OCR,
    // escolhe o maior valor monetário da nota. Isso evita retornar quantidade/preço menor.
    if(classifyNumDoc(text)==='NOTA FISCAL'){
      const all=lines.flatMap(moneyTokensInLine).filter(v=>v>0);
      if(all.length)return Math.max(...all);
    }
    return null;
  }

  function parseDocumentText(rawText){
    const text=rawText||'',tipo=classifyNumDoc(text),data=extractDate(text),numero=extractDocumentNumber(text),fornecedor=extractFornecedor(text),valor=extractValor(text);
    return {data,numDoc:tipo,numeroDoc:numero,fornecedor,valor,valorFormatado:valor!==null?formatMoney(valor):'',confidence:{data:!!data,numDoc:tipo!=='OUTRO',numeroDoc:!!numero,fornecedor:!!fornecedor,valor:valor!==null}};
  }
  return {parseDocumentText,extractDate,classifyNumDoc,extractDocumentNumber,extractFornecedor,extractValor,moneyToNumber,formatMoney};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=FieldParser;
