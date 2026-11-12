const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./database/db');
const { classificarVencimento, gerarAlertasConsolidados } = require('./services/notificationService');
const mdcSyncService = require('./services/mdcSyncService');

const app = express();
const PORT = config.PORT;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Data de referência do sistema: 06/11/2026
function getTodayRef() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ==================== ENDPOINTS DE ESTATÍSTICAS ====================

app.get('/api/stats', (req, res) => {
  const prestadores = db.getPrestadores();
  const unidades = db.getUnidades();
  const refDate = getTodayRef();

  let vencidos = 0;
  let hoje = 0;
  let amanha = 0;
  let em7dias = 0;
  let em15dias = 0;
  let validos = 0;
  let semFacial = 0;

  prestadores.forEach(p => {
    const analise = classificarVencimento(p.vencimentoFacial, refDate);
    if (analise.status === 'VENCIDO') vencidos++;
    else if (analise.status === 'HOJE') hoje++;
    else if (analise.status === 'AMANHA') amanha++;
    else if (analise.status === '7DIAS') em7dias++;
    else if (analise.status === '15DIAS') em15dias++;
    else if (analise.status === 'VALIDO' || analise.status === 'PLANEJAMENTO') validos++;
    else if (analise.status === 'SEM_FACIAL') semFacial++;
  });

  res.json({
    totalUnidades: unidades.length,
    totalPrestadores: prestadores.length,
    vencidos,
    hoje,
    amanha,
    em7dias, // vence entre D+2 e D+7
    totalProximos7: hoje + amanha + em7dias, // consolidado próximos 7 dias
    em15dias,
    validos,
    semFacial,
    dataReferencia: refDate.toLocaleDateString('pt-BR')
  });
});

// ==================== RADAR DE ALERTAS POR QUADRA/LOTE ====================

app.get('/api/alertas', (req, res) => {
  const prestadores = db.getPrestadores();
  const unidades = db.getUnidades();
  const refDate = getTodayRef();
  const { filtro, busca } = req.query;

  let alertas = gerarAlertasConsolidados(prestadores, unidades, refDate);

  if (filtro === 'vencidos') {
    alertas = alertas.filter(a => a.hasVencidos);
  } else if (filtro === 'hoje') {
    alertas = alertas.filter(a => a.hasHoje);
  } else if (filtro === 'amanha') {
    alertas = alertas.filter(a => a.hasAmanha);
  } else if (filtro === '7dias') {
    alertas = alertas.filter(a => a.has7dias);
  } else if (filtro === '15dias') {
    alertas = alertas.filter(a => a.has15dias);
  } else if (filtro === 'pendencias') {
    alertas = alertas.filter(a => a.totalPendencias > 0);
  }

  if (busca) {
    const b = busca.toLowerCase();
    alertas = alertas.filter(a =>
      a.chavePrimaria.toLowerCase().includes(b) ||
      (a.condominos && a.condominos.some(c => c.nome.toLowerCase().includes(b))) ||
      (a.prestadores && a.prestadores.some(p => p.nome.toLowerCase().includes(b)))
    );
  }

  res.json(alertas);
});

// ==================== UNIDADES / RESIDÊNCIAS ====================

app.get('/api/unidades', (req, res) => {
  const unidades = db.getUnidades();
  const prestadores = db.getPrestadores();
  const refDate = getTodayRef();
  const { busca } = req.query;

  let resultado = unidades.map(u => {
    const prestadoresDaUnidade = db.getPrestadoresPorUnidade(u.chavePrimaria);
    return {
      ...u,
      totalPrestadores: prestadoresDaUnidade.length,
      prestadores: prestadoresDaUnidade.map(p => ({
        ...p,
        analiseVencimento: classificarVencimento(p.vencimentoFacial, refDate)
      }))
    };
  });

  if (busca) {
    const b = busca.toLowerCase();
    resultado = resultado.filter(u =>
      u.chavePrimaria.toLowerCase().includes(b) ||
      (u.condominos && u.condominos.some(c => c.nome.toLowerCase().includes(b)))
    );
  }

  res.json(resultado);
});

app.get('/api/unidades/:id', (req, res) => {
  const unidade = db.getUnidadeById(req.params.id);
  if (!unidade) return res.status(404).json({ error: 'Unidade não encontrada' });
  const refDate = getTodayRef();
  const prestadores = db.getPrestadoresPorUnidade(unidade.chavePrimaria);
  res.json({
    ...unidade,
    prestadores: prestadores.map(p => ({
      ...p,
      analiseVencimento: classificarVencimento(p.vencimentoFacial, refDate)
    }))
  });
});

app.post('/api/unidades', (req, res) => {
  const { quadra, lote, condominos, observacoes } = req.body;
  if (!quadra || !lote) return res.status(400).json({ error: 'Quadra e Lote são obrigatórios' });

  const qdStr = String(quadra).padStart(2, '0');
  const ltStr = String(lote).padStart(2, '0');
  const chave = `QD ${qdStr} - LT ${ltStr}`;

  const nova = db.saveUnidade({
    quadra: qdStr,
    lote: ltStr,
    chavePrimaria: chave,
    condominos: condominos || [],
    observacoes: observacoes || ''
  });

  res.json(nova);
});

// ==================== PRESTADORES DE SERVIÇOS ====================

app.get('/api/prestadores', (req, res) => {
  const refDate = getTodayRef();
  let prestadores = db.getPrestadores();
  const { categoria, statusVencimento, busca, data } = req.query;

  prestadores = prestadores.map(p => ({
    ...p,
    analiseVencimento: classificarVencimento(p.vencimentoFacial, refDate)
  }));

  if (data) {
    prestadores = prestadores.filter(p => p.vencimentoFacial === data);
  }

  if (categoria) {
    prestadores = prestadores.filter(p => p.categoria.toLowerCase() === categoria.toLowerCase());
  }

  if (statusVencimento) {
    prestadores = prestadores.filter(p => p.analiseVencimento.status.toLowerCase() === statusVencimento.toLowerCase());
  }

  if (busca) {
    const b = busca.toLowerCase();
    prestadores = prestadores.filter(p =>
      p.nome.toLowerCase().includes(b) ||
      (p.quadraLote && p.quadraLote.toLowerCase().includes(b)) ||
      (p.condominoResponsavel && p.condominoResponsavel.toLowerCase().includes(b)) ||
      (p.cpf && p.cpf.includes(b)) ||
      (p.matricula && p.matricula.includes(b))
    );
  }

  res.json(prestadores);
});

// Endpoint exclusivo de mapa do calendário (agrupado por data DD/MM/AAAA)
app.get('/api/calendario', (req, res) => {
  const refDate = getTodayRef();
  const prestadores = db.getPrestadores();
  const mapa = {};
  prestadores.forEach(p => {
    if (p.vencimentoFacial && p.vencimentoFacial.includes('/')) {
      const d = p.vencimentoFacial.trim();
      if (!mapa[d]) mapa[d] = [];
      mapa[d].push({
        ...p,
        analiseVencimento: classificarVencimento(p.vencimentoFacial, refDate)
      });
    }
  });
  res.json(mapa);
});

app.post('/api/prestadores', (req, res) => {
  const { nome, categoria, quadraLote, vencimentoFacial, diasSemana, observacoes, cpf, matricula, customFields } = req.body;
  if (!nome || !categoria) return res.status(400).json({ error: 'Nome e Categoria são obrigatórios' });

  const novo = db.savePrestador({
    nome: nome.trim(),
    categoria: categoria.trim(),
    quadraLote: quadraLote || 'SEM LOTE',
    vencimentoFacial: vencimentoFacial || '',
    diasSemana: diasSemana || '',
    observacoes: observacoes || '',
    cpf: cpf || '',
    matricula: matricula || '',
    customFields: customFields || {},
    origem: 'Manual',
    status: 'Ativo'
  });

  res.json(novo);
});

app.get('/api/prestadores/:id', (req, res) => {
  const refDate = getTodayRef();
  const prestador = db.getPrestadorById(req.params.id);
  if (!prestador) return res.status(404).json({ error: 'Prestador não encontrado' });
  res.json({
    ...prestador,
    analiseVencimento: classificarVencimento(prestador.vencimentoFacial, refDate)
  });
});

app.put('/api/prestadores/:id', (req, res) => {
  const existing = db.getPrestadorById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Prestador não encontrado' });

  const { categoria, funcaoCargo, quadraLote, condominoResponsavel, diasSemana, observacoes, vencimentoFacial } = req.body;

  // Registrar histórico de alterações
  const historico = existing.historico || [];
  const mudancas = [];
  if (categoria && categoria !== existing.categoria) mudancas.push(`Cargo: ${existing.categoria} -> ${categoria}`);
  if (quadraLote && quadraLote !== existing.quadraLote) mudancas.push(`Casa: ${existing.quadraLote} -> ${quadraLote}`);
  if (diasSemana && diasSemana !== existing.diasSemana) mudancas.push(`Dias: ${existing.diasSemana} -> ${diasSemana}`);
  if (vencimentoFacial && vencimentoFacial !== existing.vencimentoFacial) mudancas.push(`Validade: ${existing.vencimentoFacial} -> ${vencimentoFacial}`);

  if (mudancas.length > 0) {
    historico.unshift({
      data: new Date().toISOString(),
      descricao: mudancas.join('; ')
    });
  }

  // Se quadraLote mudou e condominoResponsavel não veio preenchido, auto-preencher do morador da unidade
  let finalCondomino = condominoResponsavel !== undefined ? condominoResponsavel : existing.condominoResponsavel;
  if (quadraLote && quadraLote !== existing.quadraLote && !condominoResponsavel) {
    const uni = db.getUnidadeByChave(quadraLote);
    if (uni && uni.condominos && uni.condominos.length > 0) {
      finalCondomino = uni.condominos.map(c => c.nome).join(' / ');
    }
  }

  // Garantir que nova categoria esteja registrada no catálogo
  if (categoria) {
    db.addCategoria(categoria);
  }

  const updated = db.savePrestador({
    ...existing,
    ...req.body,
    id: req.params.id,
    categoria: categoria !== undefined ? categoria : existing.categoria,
    funcaoCargo: (funcaoCargo !== undefined ? funcaoCargo : categoria) || existing.funcaoCargo,
    quadraLote: quadraLote !== undefined ? quadraLote : existing.quadraLote,
    condominoResponsavel: finalCondomino,
    diasSemana: diasSemana !== undefined ? diasSemana : existing.diasSemana,
    observacoes: observacoes !== undefined ? observacoes : existing.observacoes,
    vencimentoFacial: vencimentoFacial !== undefined ? vencimentoFacial : existing.vencimentoFacial,
    editadoManualmente: true,
    origem: existing.origem && existing.origem.includes('Editado') ? existing.origem : `${existing.origem || 'MDC'} (Editado Local)`,
    historico: historico,
    atualizadoEm: new Date().toISOString()
  });

  const refDate = getTodayRef();
  res.json({
    ...updated,
    analiseVencimento: classificarVencimento(updated.vencimentoFacial, refDate)
  });
});

app.delete('/api/prestadores/:id', (req, res) => {
  const success = db.deletePrestador(req.params.id);
  if (!success) return res.status(404).json({ error: 'Prestador não encontrado' });
  res.json({ success: true, message: 'Prestador removido com sucesso' });
});

// ==================== CATEGORIAS E CAMPOS PERSONALIZADOS ====================

app.get('/api/categorias', (req, res) => {
  res.json(db.getCategorias());
});

app.post('/api/categorias', (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome da categoria é obrigatório' });
  const added = db.addCategoria(nome);
  res.json({ success: added, categorias: db.getCategorias() });
});

app.get('/api/custom-columns', (req, res) => {
  res.json(db.getCustomColumns());
});

app.post('/api/custom-columns', (req, res) => {
  const { nome, tipo, target } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome da coluna é obrigatório' });
  const col = db.addCustomColumn({ nome, tipo: tipo || 'text', target: target || 'prestador' });
  res.json(col);
});

// ==================== OBRAS E AUDITORIA ====================

app.get('/api/obras', (req, res) => {
  res.json(db.getObras());
});

// ==================== CONFIGURAÇÕES E BACKUP DIÁRIO ====================

const fs = require('fs');

function resolverCaminhoBackup(caminhoDesejado) {
  if (caminhoDesejado && fs.existsSync(caminhoDesejado)) {
    return caminhoDesejado;
  }
  // Fallback quando executado a partir da máquina local/desenvolvimento
  const fallbackRede = config.MDC_BACKUP_PATH || '';
  if (fallbackRede && fs.existsSync(fallbackRede)) {
    return fallbackRede;
  }
  return caminhoDesejado;
}

app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

app.post('/api/settings', (req, res) => {
  const { backupPath, whatsappTemplate } = req.body;
  const updated = db.saveSettings({
    backupPath: backupPath ? backupPath.trim() : 'D:\\BKP-DIARIO',
    whatsappTemplate: whatsappTemplate || ''
  });
  res.json(updated);
});

app.get('/api/backup/info', (req, res) => {
  const settings = db.getSettings();
  const caminhoEfetivo = resolverCaminhoBackup(settings.backupPath);

  try {
    if (!fs.existsSync(caminhoEfetivo)) {
      return res.json({
        configurado: settings.backupPath,
        efetivo: caminhoEfetivo,
        existe: false,
        arquivos: [],
        arquivoMaisRecente: null
      });
    }

    const itens = fs.readdirSync(caminhoEfetivo);
    const baks = itens
      .filter(f => f.toLowerCase().endsWith('.bak'))
      .map(f => {
        const full = path.join(caminhoEfetivo, f);
        const st = fs.statSync(full);
        return {
          nome: f,
          tamanhoMB: (st.size / (1024 * 1024)).toFixed(2),
          tamanhoGB: (st.size / (1024 * 1024 * 1024)).toFixed(2),
          dataModificacao: st.mtime.toLocaleString('pt-BR')
        };
      })
      .sort((a, b) => b.nome.localeCompare(a.nome)); // Mais recente primeiro

    res.json({
      configurado: settings.backupPath,
      efetivo: caminhoEfetivo,
      existe: true,
      totalArquivos: baks.length,
      arquivoMaisRecente: baks[0] || null,
      arquivos: baks
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/backup', (req, res) => {
  const settings = db.getSettings();
  const caminhoEfetivo = resolverCaminhoBackup(settings.backupPath);

  try {
    if (!fs.existsSync(caminhoEfetivo)) {
      return res.status(400).json({ error: `Pasta não encontrada: ${caminhoEfetivo}` });
    }

    const itens = fs.readdirSync(caminhoEfetivo).filter(f => f.toLowerCase().endsWith('.bak'));
    itens.sort((a, b) => b.localeCompare(a));
    const maisRecente = itens[0] || 'Nenhum .bak encontrado';

    // Atualiza log e settings
    const log = {
      tipo: 'BACKUP_SYNC',
      arquivo: maisRecente,
      origem: caminhoEfetivo,
      data: new Date().toISOString()
    };
    db.addSyncLog(log);

    const now = new Date();
    const dataHoraStr = `${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR')}`;

    db.saveSettings({
      ultimoBackup: maisRecente,
      ultimaSincronizacao: dataHoraStr
    });

    res.json({
      sucesso: true,
      mensagem: `Sincronização com o backup ${maisRecente} concluída com sucesso!`,
      arquivo: maisRecente,
      dataSincronizacao: dataHoraStr
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sync/status', async (req, res) => {
  const syncStatus = mdcSyncService.getSyncStatus();
  const serverStatus = await mdcSyncService.checkServerStatus();
  const logs = db.getSyncLogs();
  res.json({
    ...syncStatus,
    servidor: serverStatus,
    logs: logs.slice(0, 10),
    ultimoLog: logs[0] || null,
    totalLogs: logs.length
  });
});

app.get('/api/sync/logs', (req, res) => {
  res.json(db.getSyncLogs());
});

// Endpoint de Sincronização Imediata (Ao Vivo) - SQL Server + Planilha
app.post('/api/sync/agora', async (req, res) => {
  const origem = req.body && req.body.origem ? req.body.origem : 'Manual (Painel Portaria)';
  try {
    const resultado = await mdcSyncService.sincronizarAgora(origem);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, error: err.message });
  }
});

// Endpoint exclusivo de recarga manual do banco
app.get('/api/reload', (req, res) => {
  db.load();
  res.json({ success: true, totalPrestadores: db.getPrestadores().length, totalUnidades: db.getUnidades().length });
});

// Sincronização direta com a Planilha Oficial do Paulo (Google Sheets)
const { executarSincronizacao } = require('./scripts/process_sync');
const { getPauloSheetsData } = require('./services/googleSheetsLiveService');

app.post('/api/sync/sheets', async (req, res) => {
  try {
    console.log('[API] Solicitada sincronização com a Planilha do Paulo...');
    const resultado = await mdcSyncService.sincronizarAgora('Manual (Planilha)');
    res.json(resultado);
  } catch (err) {
    console.error('[API] Erro ao sincronizar com Google Sheets:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sync/sheets/status', async (req, res) => {
  try {
    const data = await getPauloSheetsData(false);
    res.json({
      sucesso: data.sucesso,
      totalNaPlanilha: data.total,
      offlineFallback: !!data.offlineFallback
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`🚀 vencimento.hamoa ATIVO EM: http://localhost:${PORT}`);
  console.log(`📡 Conectado ao banco de dados e sincronizador MDC 4WEB`);
  console.log(`================================================================`);
  // Inicia agendamento automático periódico a cada 60 minutos
  mdcSyncService.iniciarAgendamento(60);
});
