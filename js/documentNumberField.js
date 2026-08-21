/* Campo obrigatório para o número da NF/NF-e/recibo/comanda.
 * Mantém o padrão atual da tabela e adiciona o número somente na conferência.
 */
(function () {
  'use strict';

  const pendingNumbers = [];
  let installed = false;

  function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function labelForType(type) {
    const t = String(type || '').toUpperCase();
    if (t === 'RECIBO') return 'Nº do Recibo';
    if (t === 'COMANDA') return 'Nº da Comanda';
    if (t === 'NOTA FISCAL' || t === 'DANFE') return 'Nº NF / NF-e';
    return 'Nº do Documento';
  }

  function addStyles() {
    if (document.getElementById('document-number-field-style')) return;
    const style = document.createElement('style');
    style.id = 'document-number-field-style';
    style.textContent = `
      .doc-number-field { margin: 10px 0 14px; }
      .doc-number-field label { display:block; margin-bottom:6px; }
      .doc-number-field input { width:100%; box-sizing:border-box; }
      .doc-number-field__hint { display:block; margin-top:5px; font-size:.82rem; opacity:.72; }
      .doc-number-field.is-invalid input { border-color:#d9534f !important; box-shadow:0 0 0 2px rgba(217,83,79,.12); }
      .doc-number-field.is-invalid .doc-number-field__hint { color:#c0392b; opacity:1; font-weight:600; }
    `;
    document.head.appendChild(style);
  }

  function cardType(card) {
    return card.querySelector('[data-field="numDoc"]')?.value || '';
  }

  function injectCard(card) {
    if (!card || card.querySelector('[data-field="numeroDoc"]')) return;
    const supplier = card.querySelector('[data-field="fornecedor"]');
    if (!supplier) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'field doc-number-field';
    wrapper.innerHTML = `
      <label>${escapeHtml(labelForType(cardType(card)))}</label>
      <input type="text" data-field="numeroDoc" inputmode="numeric" autocomplete="off" placeholder="Digite o número do documento" required>
      <small class="doc-number-field__hint">Obrigatório para concluir o lançamento.</small>
    `;
    supplier.closest('.field')?.insertAdjacentElement('beforebegin', wrapper);

    const input = wrapper.querySelector('[data-field="numeroDoc"]');
    const typeSelect = card.querySelector('[data-field="numDoc"]');
    const refreshLabel = () => {
      wrapper.querySelector('label').textContent = labelForType(typeSelect?.value);
      wrapper.classList.remove('is-invalid');
      const hint = wrapper.querySelector('.doc-number-field__hint');
      hint.textContent = 'Obrigatório para concluir o lançamento.';
    };
    typeSelect?.addEventListener('change', refreshLabel);
    input.addEventListener('input', () => {
      if (input.value.trim()) wrapper.classList.remove('is-invalid');
    });
  }

  function injectAll() {
    document.querySelectorAll('.doc-card').forEach(injectCard);
  }

  function validateAndCollect() {
    injectAll();
    const cards = Array.from(document.querySelectorAll('.doc-card'));
    const numbers = [];
    let firstInvalid = null;

    cards.forEach(card => {
      const wrapper = card.querySelector('.doc-number-field');
      const input = card.querySelector('[data-field="numeroDoc"]');
      const value = input?.value.trim() || '';
      if (!value) {
        wrapper?.classList.add('is-invalid');
        const hint = wrapper?.querySelector('.doc-number-field__hint');
        if (hint) hint.textContent = '⚠️ Informe o número do documento antes de continuar.';
        if (!firstInvalid) firstInvalid = input;
      }
      numbers.push(value);
    });

    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }

    pendingNumbers.splice(0, pendingNumbers.length, ...numbers);
    return true;
  }

  function install() {
    if (installed) return;
    installed = true;
    addStyles();

    const grid = document.getElementById('cardsGrid');
    if (!grid) return;

    const observer = new MutationObserver(injectAll);
    observer.observe(grid, { childList: true });
    injectAll();

    // Captura antes do listener original do app.js: impede o lançamento se faltar número.
    const confirmButton = document.getElementById('btnConfirmarAdicao');
    confirmButton?.addEventListener('click', event => {
      if (!validateAndCollect()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = 'Informe o número de cada documento antes de adicionar à tabela.';
          toast.className = 'toast toast--danger';
          toast.hidden = false;
          setTimeout(() => { toast.hidden = true; }, 3800);
        }
      }
    }, true);

    // O app não conhecia esse campo. Após salvar, anexamos o número ao registro persistido.
    if (window.Storage && typeof Storage.addLancamentos === 'function') {
      const originalAdd = Storage.addLancamentos.bind(Storage);
      Storage.addLancamentos = async function (objs) {
        const saved = await originalAdd(objs);
        if (Array.isArray(saved) && pendingNumbers.length) {
          for (let i = 0; i < saved.length; i++) {
            const number = pendingNumbers[i] || '';
            if (number && typeof Storage.updateLancamento === 'function') {
              await Storage.updateLancamento(saved[i].id, { numeroDoc: number });
            }
          }
          pendingNumbers.splice(0, pendingNumbers.length);
        }
        return saved;
      };
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
