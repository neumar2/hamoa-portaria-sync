const fs = require('fs');
const path = require('path');
const { getPauloSheetsData, normalizarNome } = require('./googleSheetsLiveService');

const BASE_DIR = path.resolve(__dirname, '..');
const RAW_FILE = path.join(BASE_DIR, 'database', 'mdc_users_raw.txt');

function norm(s) {
  if (!s) return '';
  return s.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairNomeExato(nomeOriginal) {
  if (!nomeOriginal) return '';
  let s = String(nomeOriginal).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  const matchParenteses = s.match(/^(.*?)\((.*?)\)$/);
  if (matchParenteses) {
    const antes = matchParenteses[1].trim();
    const dentro = matchParenteses[2].trim();
    if (dentro.split(' ').length > antes.split(' ').length || (dentro === dentro.toUpperCase() && dentro.length > antes.length)) {
      return dentro.replace(/\s+/g, ' ').trim();
    }
    return antes.replace(/\s+/g, ' ').trim();
  }
  return s;
}

let cacheControle = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 segundos de cache para poupar Google Sheets API

async function getControleProfissoesData(forcarAtualizacao = false) {
  const agora = Date.now();
  if (!forcarAtualizacao && cacheControle && (agora - cacheTimestamp < CACHE_TTL_MS)) {
    return { ...cacheControle, emCache: true };
  }

  // 1. Obter dados atualizados da Planilha do Paulo
  const sheetsResult = await getPauloSheetsData(forcarAtualizacao);
  const sheets = sheetsResult && sheetsResult.colaboradores ? sheetsResult.colaboradores : (sheetsResult || {});

  // 2. Obter dados dos usuários do MDC4 (arquivo bruto mdc_users_raw.txt)
  let mdcLines = [];
  if (fs.existsSync(RAW_FILE)) {
    try {
      mdcLines = fs.readFileSync(RAW_FILE, 'latin1').split('\n');
    } catch (e) {
      mdcLines = fs.readFileSync(RAW_FILE, 'utf8').split('\n');
    }
  }

  const mdcMap = new Map();
  mdcLines.forEach(line => {
    const parts = line.split('|');
    if (parts.length >= 15 && parts[3]) {
      const id = parts[0].trim();
      const matricula = parts[1].trim();
      const cracha = parts[2].trim();
      const nome = parts[3].trim();
      const cpf = parts[4].trim();
      const fimValidade = parts[7].trim();
      const dtFace = parts[8].trim();
      const classificacao = parts[14].trim();
      const cargo = parts[15] ? parts[15].trim() : '';
      mdcMap.set(norm(nome), { id, matricula, cracha, nome, cpf, fimValidade, dtFace, classificacao, cargo });
    }
  });

  let totalGeral = 0;
  let totalNoMdc = 0;
  let totalPrecisaAjustar = 0;
  let totalSemCadastro = 0;
  let totalCompativel = 0;

  const colaboradores = Object.values(sheets).map(s => {
    totalGeral++;
    const nomeExato = extrairNomeExato(s.nome);
    const m = mdcMap.get(norm(nomeExato)) || mdcMap.get(norm(s.nome));
    let situacao = 'SEM_CADASTRO';
    let situacaoLabel = '❌ Sem cadastro facial no MDC4';
    let situacaoBadge = 'badge-nao-encontrado';

    if (m) {
      totalNoMdc++;
      const cat = (m.classificacao || '').toUpperCase();
      const prof = (s.profissao || '').toUpperCase();

      if (cat.includes('PRESTADOR DE SERVI') || !cat) {
        situacao = 'AJUSTAR_GENERICO';
        situacaoLabel = '⚠️ No MDC4 está como "PRESTADOR DE SERVIÇOS" (Genérico)';
        situacaoBadge = 'badge-alerta';
        totalPrecisaAjustar++;
      } else if (prof === 'DIARISTA' && cat.includes('SECRET')) {
        situacao = 'AJUSTAR_DIARISTA';
        situacaoLabel = '⚠️ No MDC4 está como "SECRETÁRIA DO LAR" (Diarista na planilha)';
        situacaoBadge = 'badge-aviso';
        totalPrecisaAjustar++;
      } else if (prof === 'COZINHEIRA' && cat.includes('SECRET')) {
        situacao = 'AJUSTAR_COZINHEIRA';
        situacaoLabel = '⚠️ No MDC4 está como "SECRETÁRIA DO LAR" (Cozinheira na planilha)';
        situacaoBadge = 'badge-aviso';
        totalPrecisaAjustar++;
      } else {
        situacao = 'COMPATIVEL';
        situacaoLabel = `✅ No MDC4: ${m.classificacao}`;
        situacaoBadge = 'badge-sucesso';
        totalCompativel++;
      }
    } else {
      totalSemCadastro++;
    }

    const casasStr = (Array.isArray(s.unidadesAtendidas) && s.unidadesAtendidas.length > 0)
      ? s.unidadesAtendidas.map(u => u.quadraLote).join(', ')
      : (s.quadraLote || 'SEM LOTE');

    return {
      id: s.id || ('colab_' + norm(nomeExato).replace(/\s+/g, '_')),
      nome: nomeExato,
      nomeOriginal: s.nome,
      temApelido: nomeExato !== s.nome,
      nomeNormalizado: norm(nomeExato),
      profissao: s.profissao,
      aba: s.aba,
      quadraLote: s.quadraLote || 'SEM LOTE',
      casasStr,
      totalCasas: (s.unidadesAtendidas && s.unidadesAtendidas.length) || 1,
      condomino: s.condomino || 'Condômino não identificado',
      diasSemana: s.diasSemana || 'Variável',
      observacoes: s.observacoes && s.observacoes !== '-' ? s.observacoes : '',
      vencimentoFacial: s.vencimentoFacial || '',
      mdc: m || null,
      situacao,
      situacaoLabel,
      situacaoBadge
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome));

  const profissoesContagem = {};
  colaboradores.forEach(c => {
    profissoesContagem[c.profissao] = (profissoesContagem[c.profissao] || 0) + 1;
  });

  cacheControle = {
    sucesso: true,
    totalGeral,
    totalNoMdc,
    totalPrecisaAjustar,
    totalSemCadastro,
    totalCompativel,
    profissoesContagem,
    colaboradores,
    atualizadoEm: new Date().toISOString()
  };
  cacheTimestamp = agora;

  return { ...cacheControle, emCache: false };
}

module.exports = {
  getControleProfissoesData,
  extrairNomeExato
};
