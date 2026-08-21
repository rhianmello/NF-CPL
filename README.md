# Demonstrativo de Caixa — CPL Construtora

Aplicação web para fotografar documentos de despesa (DANFE, recibo, nota
fiscal, comanda), separar automaticamente múltiplos documentos de uma
mesma foto, ler os campos por OCR, permitir conferência/edição e gerar
o Demonstrativo de Caixa em Excel e PDF.

Sem back-end: tudo roda no navegador. Os lançamentos ficam salvos no
`localStorage` do navegador (não somem ao atualizar a página) e o
código já está organizado para, no futuro, trocar o armazenamento por
Supabase sem mexer no resto do app (veja `js/storage.js`).

## Estrutura do projeto

```
cpl-caixa/
├── index.html              tela única, com as 3 vistas (tabela / upload / conferência)
├── css/style.css
└── js/
    ├── storage.js           persistência (localStorage hoje; pronto p/ Supabase)
    ├── fieldParser.js        heurísticas de texto: data, tipo, fornecedor, valor total
    ├── documentDetector.js   separação de múltiplos documentos + recorte/rotação (OpenCV.js)
    ├── ocrEngine.js           leitura de texto (Tesseract.js), com timeout e fallback
    ├── exportExcel.js        gera o .xlsx no padrão do Demonstrativo de Caixa (SheetJS)
    ├── exportPdf.js           gera o PDF visual, com logo (jsPDF + autotable)
    └── app.js                 controlador: telas, eventos, orquestração
```

Todas as bibliotecas (OpenCV.js, Tesseract.js, SheetJS, jsPDF) são
carregadas via CDN no `index.html` — é necessário **internet** para
usá-las (não para hospedar o site em si, que é 100% estático).

## Como executar localmente

Por causa do OCR e do `fetch` de bibliotecas, abrir o `index.html`
direto com duplo clique (`file://`) pode falhar em alguns navegadores
por restrição de CORS. O jeito confiável é subir um servidor estático
simples na pasta do projeto:

```bash
cd cpl-caixa
python3 -m http.server 8000
# depois abra http://localhost:8000 no navegador
```

ou, se tiver Node instalado:

```bash
npx serve .
```

## Como publicar no GitHub Pages

1. Crie um repositório no GitHub e envie esta pasta (`cpl-caixa/`)
   para ele:
   ```bash
   git init
   git add .
   git commit -m "Demonstrativo de Caixa CPL"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
   git push -u origin main
   ```
2. No GitHub: **Settings → Pages → Build and deployment → Source:
   "Deploy from a branch"**, branch `main`, pasta `/ (root)`.
3. Após alguns minutos o site fica disponível em
   `https://SEU_USUARIO.github.io/SEU_REPOSITORIO/`.

## Fluxo de uso

1. **📷 Ler Documentos** → escolher imagem ou tirar foto.
2. **Detectar documentos** → o app tenta separar cada documento da
   folha automaticamente (contornos + endireitamento via OpenCV.js) e
   já dispara a leitura (OCR) de cada um.
3. Tela de **conferência**: um cartão por documento, com Data, Num
   Doc, Fornecedor/Histórico, Valor e se é Entrada ou Saída — todos
   editáveis. Cada cartão tem:
   - **Girar** — corrige documentos de cabeça para baixo/de lado;
   - **Recortar** — desenha manualmente a área do documento (útil
     quando a detecção automática erra);
   - **Repetir leitura** — roda o OCR de novo após girar/recortar;
   - **Remover** — descarta um cartão que não é um documento real.
   Um botão **"+ Adicionar documento manualmente"** cobre o caso da
   detecção ter deixado algum documento de fora.
4. **Adicionar Documentos à Tabela** → cada cartão vira uma linha
   independente (fornecedores repetidos não são agrupados).
5. Na tabela, qualquer campo pode ser editado direto, e cada linha tem
   um botão de remover.
6. **⬇️ Baixar Excel** / **🖨️ Gerar PDF** exportam o Demonstrativo de
   Caixa com o cabeçalho (Obra, Período, Data, Responsável, DC Nº —
   editáveis em **⚙️ Cabeçalho**, no topo).

## Limitações conhecidas / pontos de atenção

- **Separação automática de documentos** usa detecção de contornos
  (OpenCV.js). Funciona bem quando os documentos têm bordas/contraste
  razoável contra o fundo da foto; em fotos muito escuras, com sombras
  fortes ou documentos encostados sem espaço entre eles, pode juntar
  ou deixar de separar algum — por isso os botões **Recortar** e
  **"+ Adicionar documento manualmente"** existem como rede de
  segurança, e nada é adicionado à tabela sem passar pela conferência.
- **Correção de orientação automática** (90°/180°) depende do módulo
  de OSD do Tesseract.js, que nem sempre está disponível/confiável;
  quando falha, o app simplesmente não gira sozinho — use o botão
  **Girar** no cartão.
- **OCR em português** roda inteiramente no navegador (Tesseract.js);
  a qualidade depende muito da nitidez/iluminação da foto. Documentos
  borrados ou muito pequenos tendem a cair em "Confira os dados" ou
  "Leitura falhou" — os campos ficam abertos para preenchimento manual
  e o app nunca fica travado indefinidamente em "Lendo…" (timeout de
  25s por documento).
- **Excel (.xlsx)**: gerado com a build gratuita do SheetJS, que grava
  valores, mesclagens de célula e largura de coluna corretamente, mas
  **não** exporta estilos (negrito/cor) nem o logo — a planilha sai
  com a estrutura certa (Obra/Período/Data/Responsável/DC Nº + tabela
  Item/Data/Num Doc/Fornecedor-Histórico/Entrada/Saída), porém em
  formatação simples. O **PDF** reproduz cores e logo fielmente.
- **Saldo** não foi implementado (por pedido explícito), assim como
  campos de Categoria/Centro de Custo/Forma de Pagamento/Observação.

## Testado até agora

A lógica de interpretação de texto (`js/fieldParser.js`) — extração de
data, classificação do tipo de documento, fornecedor e valor total
(inclusive o caso de recibo com subtotal + taxa de serviço + total) —
foi testada isoladamente com Node e cobre os exemplos do briefing.

A detecção de múltiplos documentos numa foto e a leitura por OCR
dependem de navegador (Canvas, OpenCV.js, Tesseract.js) e de imagens
reais, portanto **ainda não foram testadas com fotos de verdade** —
recomendo testar com uma foto real assim que possível e me enviar o
resultado (ou uma descrição do que saiu errado) para eu ajustar as
heurísticas de detecção/recorte se necessário.
