const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const SHEET_ID = config.GOOGLE_SHEET_ID;

// Lista base de abas conhecidas (usada como fallback se o auto-discovery falhar)
const PAULO_SHEET_TABS_DEFAULT = [
  { name: 'DIÁRISTA', gid: '1549392278', profissao: 'Diarista' },
  { name: 'ASSESSORA PESSOAL', gid: '1907061753', profissao: 'Assessora Pessoal' },
  { name: 'FAZ TUDO', gid: '1904904600', profissao: 'Faz Tudo' },
  { name: 'MOTORISTA', gid: '1876181437', profissao: 'Motorista' },
  { name: 'JARDINEIRO', gid: '1078997044', profissao: 'Jardineiro' },
  { name: 'PROFESSOR PARTICULAR', gid: '1107946643', profissao: 'Professor Particular' },
  { name: 'PET SHOP', gid: '186251349', profissao: 'Pet Shop' },
  { name: 'CUIDADOR PESSOAL', gid: '1120960220', profissao: 'Cuidador Pessoal' },
  { name: 'DOMÉSTICA', gid: '0', profissao: 'Doméstica' },
  { name: 'COZINHEIRA', gid: '1880002305', profissao: 'Cozinheira' },
  { name: 'BABÁ', gid: '1692451240', profissao: 'Babá' },
  { name: 'PISCINEIRO', gid: '1426491233', profissao: 'Piscineiro' }
];

const CACHE_FILE = path.join(__dirname, '..', 'database', 'sheets_professions.json');

// Normalizador de texto para chave de busca
function normalizarNome(s) {
  if (!s) return '';
  return s.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalizador de Quadra e Lote
function normalizarQuadraLote(texto) {
  if (!texto || texto.trim() === '-' || texto.trim().toUpperCase() === 'SEM LOTE') return 'SEM LOTE';
  const str = texto.toUpperCase().trim();
  const match = str.match(/Q(?:D|UADRA)?\s*0?(\d+)\s*[-/]?\s*L(?:T|OTE)?\s*0?(\d+)/i) || str.match(/0?(\d+)\s*[-/]\s*0?(\d+)/);
  if (match) {
    const q = match[1].padStart(2, '0');
    const l = match[2].padStart(2, '0');
    return `QD ${q} - LT ${l}`;
  }
  return str;
}

// Remove prefixos colados nos valores (ex: "COLABORADOR THIAGO...")
function limparPrefixo(val, regex) {
  if (!val) return '';
  return val.replace(regex, '').trim();
}

// Parser simples e robusto de CSV compatível com exportações do Google Sheets
function parseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentVal.trim());
      if (currentRow.some(c => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }

  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some(c => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

// Requisição HTTPS genérica com timeout e tratamento de redirects
function requestUrl(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HamoaPortariaSync/1.0'
      },
      timeout: 12000
    };

    const req = https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, options, (res2) => {
          let data = '';
          res2.on('data', chunk => data += chunk);
          res2.on('end', () => resolve(data));
        }).on('error', reject);
        return;
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} ao acessar ${url}`));
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout ao acessar ${url}`));
    });
  });
}

// Baixa o CSV de uma aba via HTTPS
function downloadTabCSV(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  return requestUrl(url);
}

// Descoberta dinâmica de abas do Google Sheets (Auto-discovery)
async function descobrirAbasGoogleSheets() {
  try {
    const htmlUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`;
    const html = await requestUrl(htmlUrl);
    const matches = html.matchAll(/items\.push\(\{name:\s*"([^"]+)",[^}]*gid:\s*"(\d+)"/g);
    const discovered = [];

    for (const m of matches) {
      const rawName = m[1];
      const gid = m[2];
      const cleanName = rawName.includes('\\u') ? JSON.parse(`"${rawName}"`) : rawName;
      
      // Ignora abas que não sejam de colaboradores (ex: abas de notas ou auditoria geral)
      if (cleanName.toUpperCase().includes('CORREÇÃO') || cleanName.toUpperCase().includes('RESUMO')) {
        continue;
      }

      // Converte o nome da aba para formato Title Case amigável (ex: "DIÁRISTA" -> "Diarista")
      const profissao = cleanName
        .toLowerCase()
        .replace(/(?:^|\s)\S/g, a => a.toUpperCase())
        .replace(/Di[aá]rista/i, 'Diarista')
        .replace(/Bab[aá]/i, 'Babá')
        .replace(/Dom[eé]stica/i, 'Doméstica');

      discovered.push({
        name: cleanName,
        gid: gid,
        profissao: profissao
      });
    }

    if (discovered.length > 0) {
      return discovered;
    }
  } catch (err) {
    console.warn(`[PAULO-SHEETS] Auto-discovery de abas falhou, usando lista padrão:`, err.message);
  }

  return PAULO_SHEET_TABS_DEFAULT;
}

/**
 * Salva JSON de forma atômica para evitar corrupção por queda de energia
 */
function saveJsonAtomic(filePath, data) {
  const tmpFile = `${filePath}.tmp`;
  try {
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmpFile, content, 'utf-8');
    if (fs.existsSync(filePath)) {
      try {
        fs.renameSync(tmpFile, filePath);
      } catch (e) {
        fs.copyFileSync(tmpFile, filePath);
        try { fs.unlinkSync(tmpFile); } catch (_) {}
      }
    } else {
      fs.renameSync(tmpFile, filePath);
    }
    return true;
  } catch (err) {
    console.error(`[PAULO-SHEETS] Erro ao gravar atômico em ${filePath}:`, err);
    if (fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    }
    return false;
  }
}

/**
 * Lê todas as abas oficiais da planilha do Paulo
 * Suporta descoberta dinâmica de novas abas (ex: se o Paulo adicionar Eletricista)
 */
async function fetchPauloSheetsLive() {
  console.log(`[PAULO-SHEETS] Iniciando leitura online das abas oficiais...`);
  const resultMap = {};
  const allList = [];
  const tabStats = {};

  const tabs = await descobrirAbasGoogleSheets();
  console.log(`[PAULO-SHEETS] ${tabs.length} abas de profissões identificadas na planilha.`);

  for (const tab of tabs) {
    try {
      const csvText = await downloadTabCSV(tab.gid);
      const rows = parseCSV(csvText);
      let count = 0;

      for (const row of rows) {
        if (!row || row.length === 0) continue;
        const col0 = row[0] || '';
        const nameClean = limparPrefixo(col0, /^(COLABORADOR[A]?|EMPRESA|FUNCION[AÁ]RIO|NOME)[:\s\-]+/i);

        // Ignora cabeçalhos vazios ou genéricos
        if (!nameClean || ['COLABORADOR', 'COLABORADORA', 'EMPRESA', 'FUNCIONÁRIO', 'NOME', '-', '--'].includes(nameClean.toUpperCase())) {
          continue;
        }
        if (nameClean.length < 3 || /^\d+$/.test(nameClean)) {
          continue;
        }

        const condomino = limparPrefixo(row[1] || '', /^(COND[OÔ]MINO[S]?|RESPONS[AÁ]VEL|PROPRIET[AÁ]RIO)[:\s\-]+/i);
        const qdLoteRaw = limparPrefixo(row[2] || '', /^(QUADRA\s*E\s*LOTE|QUADRA|LOTE|QD\/LT|QD|LT)[:\s\-]+/i);
        const diasSemana = limparPrefixo(row[3] || '', /^(DIAS\s*DA\s*SEMANA|DIAS|PERIODICIDADE)[:\s\-]+/i);
        let vencimento = limparPrefixo(row[4] || '', /^(VENCIMENTO\s*FACIAL|VENCIMENTO|VALIDADE)[:\s\-]+/i);
        const observacoes = limparPrefixo(row[5] || '', /^(OBSERVA[CÇ][AÃ]O|OBS)[:\s\-]+/i);

        // Limpa vencimento se for traço ou indicação de liberação por app
        if (vencimento === '-' || vencimento === '--' || vencimento.toUpperCase().includes('SEM') || vencimento.toUpperCase().includes('LIBERA')) {
          vencimento = '';
        }

        const normKey = normalizarNome(nameClean);
        const item = {
          nome: nameClean,
          nomeNormalizado: normKey,
          profissao: tab.profissao,
          aba: tab.name,
          condomino: condomino,
          quadraLote: normalizarQuadraLote(qdLoteRaw),
          quadraLoteOriginal: qdLoteRaw,
          diasSemana: diasSemana || 'DIÁRIO',
          vencimentoFacial: vencimento,
          observacoes: observacoes && observacoes !== '-' ? observacoes : '',
          origem: 'Google Sheets (Paulo)',
          atualizadoEm: new Date().toISOString()
        };

        resultMap[normKey] = item;
        allList.push(item);
        count++;
      }

      tabStats[tab.name] = count;
    } catch (err) {
      console.error(`[PAULO-SHEETS] Falha na aba ${tab.name} (${tab.gid}):`, err.message);
    }
  }

  const totalLoaded = Object.keys(resultMap).length;
  console.log(`[PAULO-SHEETS] Leitura online concluída: ${totalLoaded} colaboradores únicos mapeados.`);

  if (totalLoaded > 0) {
    saveJsonAtomic(CACHE_FILE, resultMap);
    console.log(`[PAULO-SHEETS] Cache offline salvo com sucesso.`);
  }

  return {
    sucesso: totalLoaded > 0,
    total: totalLoaded,
    tabStats,
    colaboradores: resultMap,
    lista: allList
  };
}

async function getPauloSheetsData(forceLive = false) {
  try {
    const live = await fetchPauloSheetsLive();
    if (live.sucesso) return live;
  } catch (err) {
    console.warn(`[PAULO-SHEETS] Falha ao consultar online, usando cache local de segurança:`, err.message);
  }

  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      const count = Object.keys(cached).length;
      return {
        sucesso: true,
        offlineFallback: true,
        total: count,
        colaboradores: cached,
        lista: Object.values(cached)
      };
    } catch (e) {
      console.error(`[PAULO-SHEETS] Erro ao ler cache offline:`, e.message);
    }
  }

  return { sucesso: false, total: 0, colaboradores: {}, lista: [] };
}

module.exports = {
  fetchPauloSheetsLive,
  getPauloSheetsData,
  PAULO_SHEET_TABS: PAULO_SHEET_TABS_DEFAULT,
  normalizarNome,
  normalizarQuadraLote,
  saveJsonAtomic
};
