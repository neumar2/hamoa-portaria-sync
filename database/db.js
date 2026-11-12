const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.json');

function limparMojibakeString(str) {
  if (!str || typeof str !== 'string') return str;
  if (!str.includes('\uFFFD')) return str;
  return str
    .replace(/ADMINISTRA\uFFFD+O/gi, 'ADMINISTRAÇÃO')
    .replace(/BAB\uFFFD\/RESPONS\uFFFDVEL/gi, 'BABÁ/RESPONSÁVEL')
    .replace(/COLABORADORES SEGURAN\uFFFDA/gi, 'COLABORADORES SEGURANÇA')
    .replace(/Funcion\uFFFDrio - Mestre de Obra/gi, 'Funcionário - Mestre de Obra')
    .replace(/MONITOR DE PARQUE AQU\uFFFDTICO/gi, 'MONITOR DE PARQUE AQUÁTICO')
    .replace(/MOTORISTA PRESTADOR DE SERVI\uFFFDO/gi, 'MOTORISTA PRESTADOR DE SERVIÇO')
    .replace(/PRESTADOR DE SERVI\uFFFDOS/gi, 'PRESTADOR DE SERVIÇOS')
    .replace(/PROFESSORA NATA\uFFFD+O/gi, 'PROFESSORA NATAÇÃO')
    .replace(/RECREA\uFFFD+O/gi, 'RECREAÇÃO')
    .replace(/SECRET\uFFFDRIA DO LAR/gi, 'SECRETÁRIA DO LAR')
    .replace(/CEL\uFFFDO/gi, 'CELÇO')
    .replace(/\uFFFD/g, '');
}

class Database {
  constructor() {
    this.data = {
      unidades: [],
      prestadores: [],
      categorias: [
        'Diarista',
        'Piscineiro',
        'Babá',
        'Jardineiro',
        'Motorista',
        'Professor Particular',
        'Pet Shop',
        'Cuidador Pessoal',
        'Assessora Pessoal',
        'Cozinheira',
        'Faz Tudo'
      ],
      customColumns: [
        { id: 'empresa', nome: 'Empresa Prestadora', tipo: 'text', target: 'prestador' },
        { id: 'placa', nome: 'Placa do Veículo', tipo: 'text', target: 'prestador' }
      ],
      obras: [],
      syncLogs: [],
      notificationLogs: []
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        let raw = fs.readFileSync(DB_FILE, 'utf-8');
        if (raw.includes('\uFFFD')) {
          raw = limparMojibakeString(raw);
          // Salva limpo para corrigir o arquivo permanentemente
          try {
            this.data = JSON.parse(raw);
            this.save();
            return;
          } catch (_) {}
        }
        this.data = JSON.parse(raw);
      } else {
        const exampleFile = path.join(__dirname, 'data.example.json');
        if (fs.existsSync(exampleFile)) {
          console.log('[DB] data.json não encontrado. Inicializando a partir de data.example.json...');
          fs.copyFileSync(exampleFile, DB_FILE);
          this.data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
        } else {
          this.save();
        }
      }
    } catch (err) {
      console.error('Erro ao carregar banco de dados:', err);
    }
  }

  save() {
    const tmpFile = `${DB_FILE}.tmp`;
    try {
      const content = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(tmpFile, content, 'utf-8');
      if (fs.existsSync(DB_FILE)) {
        try {
          fs.renameSync(tmpFile, DB_FILE);
        } catch (e) {
          fs.copyFileSync(tmpFile, DB_FILE);
          try { fs.unlinkSync(tmpFile); } catch (_) {}
        }
      } else {
        fs.renameSync(tmpFile, DB_FILE);
      }
    } catch (err) {
      console.error('Erro ao salvar banco de dados atomicamente:', err);
      if (fs.existsSync(tmpFile)) {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
      }
    }
  }

  // --- UNIDADES ---
  getUnidades() {
    return this.data.unidades;
  }

  getUnidadeById(id) {
    return this.data.unidades.find(u => u.id === id);
  }

  getUnidadeByChave(chave) {
    return this.data.unidades.find(u => u.chavePrimaria.toLowerCase() === chave.toLowerCase());
  }

  saveUnidade(unidade) {
    const idx = this.data.unidades.findIndex(u => u.id === unidade.id);
    unidade.atualizadoEm = new Date().toISOString();
    if (idx >= 0) {
      this.data.unidades[idx] = { ...this.data.unidades[idx], ...unidade };
    } else {
      if (!unidade.id) unidade.id = 'uni_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      unidade.criadoEm = new Date().toISOString();
      this.data.unidades.push(unidade);
    }
    this.save();
    return unidade;
  }

  // --- PRESTADORES ---
  getPrestadores() {
    return this.data.prestadores;
  }

  getPrestadorById(id) {
    return this.data.prestadores.find(p => p.id === id);
  }

  savePrestador(prestador) {
    const idx = this.data.prestadores.findIndex(p => p.id === prestador.id);
    prestador.atualizadoEm = new Date().toISOString();
    if (idx >= 0) {
      this.data.prestadores[idx] = { ...this.data.prestadores[idx], ...prestador };
    } else {
      if (!prestador.id) prestador.id = 'pres_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      prestador.criadoEm = new Date().toISOString();
      this.data.prestadores.push(prestador);
    }
    this.save();
    return prestador;
  }

  deletePrestador(id) {
    const initialLen = this.data.prestadores.length;
    this.data.prestadores = this.data.prestadores.filter(p => p.id !== id);
    if (this.data.prestadores.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // --- CATEGORIAS ---
  getCategorias() {
    return this.data.categorias;
  }

  addCategoria(nome) {
    nome = nome.trim();
    if (nome && !this.data.categorias.includes(nome)) {
      this.data.categorias.push(nome);
      this.save();
      return true;
    }
    return false;
  }

  // --- COLUNAS CUSTOMIZADAS ---
  getCustomColumns() {
    return this.data.customColumns;
  }

  addCustomColumn(col) {
    if (!col.id) col.id = 'col_' + Date.now();
    this.data.customColumns.push(col);
    this.save();
    return col;
  }

  // --- OBRAS ---
  getObras() {
    return this.data.obras;
  }

  setObras(obrasList) {
    this.data.obras = obrasList;
    this.save();
  }

  // --- LOGS ---
  addSyncLog(log) {
    if (!this.data.syncLogs) this.data.syncLogs = [];
    log.data = new Date().toISOString();
    this.data.syncLogs.unshift(log);
    if (this.data.syncLogs.length > 50) this.data.syncLogs.pop();
    this.save();
  }

  getSyncLogs() {
    return this.data.syncLogs || [];
  }

  addNotificationLog(log) {
    if (!this.data.notificationLogs) this.data.notificationLogs = [];
    log.data = new Date().toISOString();
    this.data.notificationLogs.unshift(log);
    if (this.data.notificationLogs.length > 100) this.data.notificationLogs.pop();
    this.save();
  }

  // --- CONFIGURAÇÕES ---
  getSettings() {
    if (!this.data.settings) {
      this.data.settings = {
        backupPath: 'D:\\BKP-DIARIO',
        whatsappTemplate: '*vencimento.hamoa - Hamoa Resort Residencial*\n📍 *Unidade: {UNIDADE}*\nOlá, *{MORADOR}*!\n\nIdentificamos que o(s) seguinte(s) colaborador(es) vinculado(s) à sua residência possuem atualização de biometria facial pendente:\n\n{FUNCIONARIOS}\n👉 *Como renovar:* Para evitar bloqueios ou atrasos na portaria, solicitamos o envio de documento/foto atualizado respondendo a esta mensagem ou comparecendo à administração do Hamoa.\n\n_Administração & Portaria Hamoa_',
        ultimoBackup: 'MDC4web_05112026_200.bak',
        ultimaSincronizacao: new Date().toISOString()
      };
      this.save();
    }
    return this.data.settings;
  }

  saveSettings(settings) {
    this.data.settings = { ...this.getSettings(), ...settings, atualizadoEm: new Date().toISOString() };
    this.save();
    return this.data.settings;
  }
}

module.exports = new Database();
