const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../database/db');
const { executarSincronizacao } = require('../scripts/process_sync');

const SERVER_HOST = config.MDC_WEB_HOST;
const SERVER_PORT = config.MDC_WEB_PORT;
const INTERVALO_MINUTOS = config.SYNC_INTERVAL_MINUTES;

let sincronizacaoEmAndamento = false;
let ultimaSincronizacao = null;
let proximaSincronizacao = new Date(Date.now() + INTERVALO_MINUTOS * 60 * 1000).toISOString();
let timerId = null;

async function checkServerStatus() {
  const http = require('http');
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: SERVER_HOST,
        port: SERVER_PORT,
        path: '/mdc4web/index.do',
        method: 'HEAD',
        timeout: 3000
      },
      (res) => {
        resolve({
          online: true,
          statusCode: res.statusCode,
          host: `${SERVER_HOST}:${SERVER_PORT}`,
          sistema: 'MDC 4WEB Residence'
        });
      }
    );
    req.on('error', (err) => {
      resolve({
        online: false,
        error: err.message,
        host: `${SERVER_HOST}:${SERVER_PORT}`
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({
        online: false,
        error: 'Timeout',
        host: `${SERVER_HOST}:${SERVER_PORT}`
      });
    });
    req.end();
  });
}

/**
 * Dispara sincronização completa em tempo real com o SQL Server e a Planilha Oficial
 */
async function sincronizarAgora(origem = 'Manual (Botão)') {
  if (sincronizacaoEmAndamento) {
    return {
      emAndamento: true,
      mensagem: 'Uma sincronização já está em processamento no momento.',
      ultimaSincronizacao
    };
  }

  sincronizacaoEmAndamento = true;
  const inicio = Date.now();
  console.log(`[SYNC-SERVICE] 🔄 Iniciando sincronização completa [Origem: ${origem}]...`);

  try {
    const dbData = await executarSincronizacao({ extrairSql: true });
    db.load(); // Recarrega banco em memória

    const duracaoMs = Date.now() - inicio;
    const now = new Date();
    proximaSincronizacao = new Date(now.getTime() + INTERVALO_MINUTOS * 60 * 1000).toISOString();

    ultimaSincronizacao = {
      sucesso: true,
      origem,
      dataHora: `${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR')}`,
      timestamp: now.toISOString(),
      duracaoSegundos: (duracaoMs / 1000).toFixed(1),
      totalPrestadores: db.getPrestadores().length,
      totalUnidades: db.getUnidades().length,
      erro: null
    };

    console.log(`[SYNC-SERVICE] ✅ Sincronização concluída com sucesso em ${ultimaSincronizacao.duracaoSegundos}s!`);
    return {
      sucesso: true,
      mensagem: 'Sincronização com o banco de dados MDC e Planilha concluída com sucesso!',
      ...ultimaSincronizacao,
      proximaSincronizacao
    };
  } catch (err) {
    const duracaoMs = Date.now() - inicio;
    console.error(`[SYNC-SERVICE] ❌ Erro durante a sincronização:`, err.message);
    ultimaSincronizacao = {
      sucesso: false,
      origem,
      dataHora: new Date().toLocaleString('pt-BR'),
      timestamp: new Date().toISOString(),
      duracaoSegundos: (duracaoMs / 1000).toFixed(1),
      totalPrestadores: db.getPrestadores().length,
      totalUnidades: db.getUnidades().length,
      erro: err.message
    };
    return {
      sucesso: false,
      mensagem: `Falha na sincronização: ${err.message}`,
      ...ultimaSincronizacao
    };
  } finally {
    sincronizacaoEmAndamento = false;
  }
}

/**
 * Inicia o agendamento automático periódico a cada 60 minutos
 */
function iniciarAgendamento(intervaloMinutos = INTERVALO_MINUTOS) {
  if (timerId) clearInterval(timerId);

  const ms = intervaloMinutos * 60 * 1000;
  proximaSincronizacao = new Date(Date.now() + ms).toISOString();
  console.log(`[SYNC-SERVICE] ⏰ Agendamento de sincronização ativo: a cada ${intervaloMinutos} minutos.`);
  console.log(`[SYNC-SERVICE] 📅 Próxima sincronização automática programada para: ${new Date(proximaSincronizacao).toLocaleString('pt-BR')}`);

  timerId = setInterval(() => {
    console.log(`[SYNC-SERVICE] ⏰ Disparando sincronização automática periódica (60 min)...`);
    sincronizarAgora('Automático (A cada 60 min)');
  }, ms);
}

/**
 * Retorna o status atual da sincronização
 */
function getSyncStatus() {
  const settings = db.getSettings();
  return {
    sincronizacaoEmAndamento,
    intervaloMinutos: INTERVALO_MINUTOS,
    ultimaSincronizacao: ultimaSincronizacao || {
      dataHora: settings.ultimaSincronizacao || 'Hoje',
      duracaoSegundos: settings.duracaoUltimaSincronizacaoMs ? (settings.duracaoUltimaSincronizacaoMs / 1000).toFixed(1) : '2.5',
      sucesso: true,
      origem: 'Sincronização Inicial',
      totalPrestadores: db.getPrestadores().length,
      totalUnidades: db.getUnidades().length
    },
    proximaSincronizacao,
    totalPrestadores: db.getPrestadores().length,
    totalUnidades: db.getUnidades().length
  };
}

module.exports = {
  checkServerStatus,
  sincronizarAgora,
  iniciarAgendamento,
  getSyncStatus,
  SERVER_HOST,
  SERVER_PORT
};
