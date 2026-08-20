/**
 * storage.js
 * ---------------------------------------------------------------------
 * Camada de armazenamento. Hoje persiste em localStorage. A interface
 * (métodos async) foi desenhada para que, no futuro, LocalStorageAdapter
 * possa ser substituído por um SupabaseAdapter sem tocar no resto do
 * app — quem consome é sempre o objeto `Storage`, nunca localStorage
 * diretamente.
 *
 * Para migrar para Supabase:
 *   1. Implemente SupabaseAdapter (esqueleto no final deste arquivo)
 *      com os mesmos métodos.
 *   2. Troque a linha `const activeAdapter = new LocalStorageAdapter();`
 *      por `new SupabaseAdapter({ url, anonKey })`.
 * ---------------------------------------------------------------------
 */

const CPL_DB_VERSION = 1;
const CPL_KEYS = {
  lancamentos: 'cpl_caixa_lancamentos_v1',
  config: 'cpl_caixa_config_v1',
  logo: 'cpl_caixa_logo_v1'
};

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

class LocalStorageAdapter {
  constructor() {
    this._migrate();
  }

  _migrate() {
    // Espaço reservado para futuras migrações de schema.
  }

  _readAll() {
    try {
      const raw = localStorage.getItem(CPL_KEYS.lancamentos);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Falha ao ler lançamentos do armazenamento local', e);
      return [];
    }
  }

  _writeAll(list) {
    localStorage.setItem(CPL_KEYS.lancamentos, JSON.stringify(list));
  }

  async init() {
    return true;
  }

  async listLancamentos() {
    return this._readAll().sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  }

  async addLancamentos(objs) {
    const list = this._readAll();
    const maxOrdem = list.reduce((m, l) => Math.max(m, l.ordem ?? 0), 0);
    const novos = objs.map((o, i) => ({
      id: uuid(),
      ordem: maxOrdem + i + 1,
      data: o.data || '',
      numDoc: o.numDoc || 'OUTRO',
      fornecedor: o.fornecedor || '',
      entrada: o.entrada ?? null,
      saida: o.saida ?? null,
      createdAt: Date.now()
    }));
    list.push(...novos);
    this._writeAll(list);
    return novos;
  }

  async updateLancamento(id, patch) {
    const list = this._readAll();
    const idx = list.findIndex(l => l.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch };
    this._writeAll(list);
    return list[idx];
  }

  async deleteLancamento(id) {
    const list = this._readAll().filter(l => l.id !== id);
    this._writeAll(list);
    return true;
  }

  async clearAll() {
    this._writeAll([]);
    return true;
  }

  async getConfig() {
    try {
      const raw = localStorage.getItem(CPL_KEYS.config);
      return raw ? JSON.parse(raw) : this._defaultConfig();
    } catch (e) {
      return this._defaultConfig();
    }
  }

  _defaultConfig() {
    return {
      obra: 'COMPERJ',
      periodo: '',
      data: new Date().toISOString().slice(0, 10),
      responsavel: '',
      dcNum: ''
    };
  }

  async saveConfig(cfg) {
    localStorage.setItem(CPL_KEYS.config, JSON.stringify(cfg));
    return cfg;
  }

  async getLogo() {
    return localStorage.getItem(CPL_KEYS.logo) || null;
  }

  async saveLogo(dataUrl) {
    try {
      localStorage.setItem(CPL_KEYS.logo, dataUrl);
    } catch (e) {
      console.warn('Não foi possível salvar o logo (limite do localStorage). O logo não será persistido.', e);
    }
    return true;
  }
}

/**
 * ESQUELETO — implementar quando o Supabase estiver disponível.
 * Mantém exatamente a mesma interface pública do LocalStorageAdapter.
 *
 * class SupabaseAdapter {
 *   constructor({ url, anonKey }) {
 *     this.client = supabase.createClient(url, anonKey); // via CDN do supabase-js
 *   }
 *   async init() { ... verificar sessão / tabela ... }
 *   async listLancamentos() { const { data } = await this.client.from('lancamentos').select('*').order('ordem'); return data; }
 *   async addLancamentos(objs) { ... insert ... }
 *   async updateLancamento(id, patch) { ... update ... }
 *   async deleteLancamento(id) { ... delete ... }
 *   async clearAll() { ... }
 *   async getConfig() { ... }
 *   async saveConfig(cfg) { ... }
 *   async getLogo() { ... }
 *   async saveLogo(dataUrl) { ... }
 * }
 */

// Ponto único de configuração do backend ativo.
const Storage = new LocalStorageAdapter();
