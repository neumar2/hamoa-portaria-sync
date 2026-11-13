const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getPauloSheetsData, normalizarNome, normalizarQuadraLote, saveJsonAtomic } = require('../services/googleSheetsLiveService');

const BASE_DIR = path.join(__dirname, '..');
const DB_FILE = path.join(BASE_DIR, 'database', 'data.json');
const RAW_FILE = path.join(BASE_DIR, 'database', 'mdc_users_raw.txt');

console.log('================================================================');
console.log('   PROCESSADOR DE SINCRONIZACAO MDC 4WEB -> vencimento.hamoa');
console.log(' (DATA OFICIAL: MDC 4WEB | PROFISSAO E RESIDENCIA: PLANILHA PAULO)');
console.log('================================================================');

function mapearSetorOuLote(texto, sheetMatch) {
  if (sheetMatch && sheetMatch.quadraLote && sheetMatch.quadraLote !== 'SEM LOTE' && sheetMatch.quadraLote !== 'QD 00 - LT 00') {
    return sheetMatch.quadraLote;
  }

  if (!texto) return 'Geral';
  const str = texto.toUpperCase().trim();

  const match = str.match(/Q(?:D|UADRA)?\s*0?(\d+)\s*[-/]?\s*L(?:T|OTE)?\s*0?(\d+)/i) || str.match(/0?(\d+)\s*[-/]\s*0?(\d+)/);
  if (match) {
    const q = match[1].padStart(2, '0');
    const l = match[2].padStart(2, '0');
    return `QD ${q} - LT ${l}`;
  }

  if (str.includes('HAMOA')) return 'Corporativo / Hamoa';
  if (str.includes('AUSEC')) return 'Corporativo / Ausec';
  if (str.includes('EMPORIO') || str.includes('KAUAI')) return 'Comércio / Empório Kauai';
  if (str.includes('PARQUE AQUATICO') || str.includes('AQUATICO')) return 'Área Comum / Parque Aquático';
  if (str.includes('BRINQUEDOTECA') || str.includes('RECREA')) return 'Área Comum / Brinquedoteca';
  if (str.includes('MINE MERCADO') || str.includes('MERCADO')) return 'Comércio / Minimercado';
  if (str.includes('INPAV')) return 'Obras / Inpav Pavimentação';
  if (str.includes('ACADEMIA')) return 'Área Comum / Academia';

  return 'Geral';
}

function ehRegistroDescartavel(nome, tipo, cat, cargo, empresaRazao, empresaFantasia) {
  const n = (nome || '').toUpperCase();
  const t = (tipo || '').toUpperCase();
  const c = (cat || '').toUpperCase();
  const cg = (cargo || '').toUpperCase();
  const er = (empresaRazao || '').toUpperCase();
  const ef = (empresaFantasia || '').toUpperCase();

  // 1. Visitantes
  if (n.startsWith('VISIT:') || n.startsWith('VISITANTE')) return true;
  if (t === 'V' || t === 'VIS') return true;
  if (c.includes('VISIT') || cg.includes('VISIT')) return true;

  // 2. Registros inativos ou de lixeira do MDC
  if (er.includes('PREST SERV INATIVOS') || ef.includes('PREST SERV INATIVOS')) return true;
  if (er.includes('EX CONDOMINO') || ef.includes('EX CONDOMINO') || c.includes('EX CONDOMINO')) return true;

  return false;
}

function ehMoradorOuCondomino(tipo, categoria, cargo) {
  const t = (tipo || '').toUpperCase();
  const cat = (categoria || '').toUpperCase();
  const cg = (cargo || '').toUpperCase();

  if (['M', 'MOR', 'RES', 'PROP', 'C'].includes(t)) return true;
  if (cat.includes('COND') || cat.includes('RESID') || cat.includes('MORA') || cat.includes('PROP') || cat.includes('DEPEND') || cat.includes('HOSPEDE')) return true;
  if (cg.includes('MORADOR') || cg.includes('CONDOMINO') || cg.includes('PROPRIETARIO') || cg.includes('DEPENDENTE')) return true;

  return false;
}

// Extrai e deduplica os titulares principais (máximo 2), eliminando repetições (ex: maiúsculas/minúsculas)
function extrairTitularesDeduplicados(listaOuString, maxTitulares = 2) {
  if (!listaOuString) return '';
  const rawList = Array.isArray(listaOuString) ? listaOuString : [listaOuString];
  const uniqueNames = [];
  const seen = new Set();

  rawList.forEach(item => {
    if (!item) return;
    const str = typeof item === 'object' ? (item.nome || '') : String(item);
    const partes = str.split(/[\/\\;]/);
    partes.forEach(p => {
      const limpo = p.trim();
      if (limpo.length < 3) return;
      const chaveNorm = normalizarNome(limpo);
      if (!seen.has(chaveNorm)) {
        seen.add(chaveNorm);
        uniqueNames.push(limpo);
      }
    });
  });

  return uniqueNames.slice(0, maxTitulares).join(' / ');
}

// Sanitiza caracteres corrompidos por encoding (mojibake / \uFFFD)
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

const { execSync } = require('child_process');

function extrairDadosMdcSql() {
  const sqlScript = path.join(BASE_DIR, 'scripts', 'export_mdc_users.sql');
  if (!fs.existsSync(sqlScript)) {
    console.warn(`[MDC-SQL] Script ${sqlScript} não localizado.`);
    return false;
  }

  try {
    console.log(`[MDC-SQL] Conectando diretamente ao SQL Server ${config.MDC_SQL_SERVER} (${config.MDC_SQL_DATABASE})...`);
    const cmd = `sqlcmd -S "${config.MDC_SQL_SERVER}" -U "${config.MDC_SQL_USER}" -P "${config.MDC_SQL_PASSWORD}" -d "${config.MDC_SQL_DATABASE}" -i "${sqlScript}" -s "|" -W -w 4000 -h -1 -o "${RAW_FILE}"`;
    execSync(cmd, { stdio: 'pipe', timeout: 45000 });
    console.log('[MDC-SQL] Dados atualizados do SQL Server extraídos com sucesso!');
    return true;
  } catch (err) {
    console.warn('[MDC-SQL] Aviso na extração direta (mantendo dados em cache do arquivo bruto):', err.message);
    return false;
  }
}

async function executarSincronizacao(opcoes = {}) {
  const extrairSql = opcoes && opcoes.extrairSql !== undefined ? opcoes.extrairSql : true;
  if (extrairSql) {
    extrairDadosMdcSql();
  }

  if (!fs.existsSync(RAW_FILE)) {
    console.error(`[ERRO] Arquivo de extracao nao encontrado: ${RAW_FILE}`);
    throw new Error(`Arquivo de extracao nao encontrado: ${RAW_FILE}`);
  }

  // Proteção contra extração incompleta ou corrompida (ex: 0 bytes)
  const statRaw = fs.statSync(RAW_FILE);
  if (statRaw.size < 1000) {
    console.warn(`[AVISO DE SEGURANÇA] Arquivo ${RAW_FILE} com tamanho suspeito (${statRaw.size} bytes). Abortando para proteger a base.`);
    return dbData;
  }

  // 1. Carrega o banco atual com auto-higienização de encoding
  let dbData = { unidades: [], prestadores: [], categorias: [], customColumns: [], syncLogs: [] };
  if (fs.existsSync(DB_FILE)) {
    try {
      const rawDb = fs.readFileSync(DB_FILE, 'utf-8');
      const sanitizedDb = rawDb.includes('\uFFFD') ? limparMojibakeString(rawDb) : rawDb;
      dbData = JSON.parse(sanitizedDb);
    } catch (err) {
      console.error('[AVISO] Falha ao ler data.json existente, iniciando estrutura nova:', err.message);
    }
  }

  // 2. Consulta a planilha oficial do Paulo (online com fallback de cache)
  console.log('[1/4] Consultando tabela oficial do Paulo (Google Sheets)...');
  const sheetsResult = await getPauloSheetsData(true);
  const sheetsMap = sheetsResult.colaboradores || {};
  console.log(`[INFO] Tabela do Paulo carregada: ${Object.keys(sheetsMap).length} colaboradores ativos.`);

  // Algoritmo Seguro de Match
  function buscarProfissaoSheets(nome) {
    if (!nome) return null;
    const n = normalizarNome(nome);
    if (sheetsMap[n]) return sheetsMap[n];

    const tokensN = n.split(' ').filter(t => t.length > 2 && !['DOS', 'DAS', 'DE', 'DA', 'DO', 'E'].includes(t));
    if (tokensN.length < 2) return null;

    const keys = Object.keys(sheetsMap);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const tokensK = k.split(' ').filter(t => t.length > 2 && !['DOS', 'DAS', 'DE', 'DA', 'DO', 'E'].includes(t));
      if (tokensK.length < 2) continue;

      if (tokensN[0] !== tokensK[0]) continue;
      if (tokensN[tokensN.length - 1] !== tokensK[tokensK.length - 1]) continue;

      const [shorter, longer] = tokensN.length <= tokensK.length ? [tokensN, tokensK] : [tokensK, tokensN];
      const allMatch = shorter.every(tok => longer.includes(tok));
      if (allMatch && shorter.length >= 2) {
        return sheetsMap[k];
      }
    }
    return null;
  }

  // Limpar e deduplicar moradores de cada unidade existente
  (dbData.unidades || []).forEach(u => {
    if (u.condominos && u.condominos.length > 0) {
      const dedupMap = new Map();
      u.condominos.forEach(c => {
        const partes = (c.nome || '').split(/[\/\\;]/);
        partes.forEach(p => {
          const limpo = p.trim();
          if (limpo.length < 3) return;
          const k = normalizarNome(limpo);
          if (!dedupMap.has(k)) {
            dedupMap.set(k, {
              nome: limpo,
              telefone: c.telefone || '',
              email: c.email || '',
              matricula: c.matricula || '',
              cpf: c.cpf || ''
            });
          }
        });
      });
      u.condominos = Array.from(dedupMap.values());
    }
  });

  const unidadeMap = new Map();
  (dbData.unidades || []).forEach(u => {
    if (u.chavePrimaria) unidadeMap.set(u.chavePrimaria.toUpperCase().trim(), u);
  });

  // 3. Lê linhas do arquivo bruto do SQL com auto-detecção de codificação ANSI/Latin-1 vs UTF-8
  console.log('[2/4] Processando dados do MDC e aplicando regras de negocio...');
  const rawBuf = fs.readFileSync(RAW_FILE);
  let rawContent = rawBuf.toString('utf-8');
  if (rawContent.includes('\uFFFD')) {
    console.log('[INFO] Detectada codificacao ANSI/Latin-1 do SQL Server. Decodificando com latin1...');
    rawContent = rawBuf.toString('latin1');
  }
  const lines = rawContent.split(/\r?\n/).filter(l => l.trim().length > 0);
  console.log(`[INFO] Total de linhas brutas: ${lines.length}`);

  let totalMoradoresAtualizados = 0;
  let totalSheetsMatched = 0;
  let totalMdcClassificados = 0;
  let totalDescartados = 0;

  const novosPrestadores = [];
  const prestadoresExistentesMap = new Map();
  const processadosNomes = new Set();

  (dbData.prestadores || []).forEach(p => {
    if (p.id) prestadoresExistentesMap.set(p.id, p);
    if (p.matricula) prestadoresExistentesMap.set(p.matricula, p);
    const n = normalizarNome(p.nome);
    if (n) prestadoresExistentesMap.set(n, p);
  });

  lines.forEach((line) => {
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 5) return;

    const idUsuario = parts[0];
    const matricula = parts[1] || '';
    const cracha = parts[2] || '';
    const nomeCompleto = parts[3] || '';
    const cpf = parts[4] || '';
    const tipo = parts[5] || '';
    const inicioValidade = parts[6] || '';
    const fimValidade = parts[7] || '';
    const dtCadFace = parts[8] || '';
    const permissaoAcesso = parts[9] || 'S';
    const telefone = parts[10] || '';
    const quadraLoteRaw = parts[11] || '';
    const loteFantasia = parts[12] || '';
    const ehPrestadora = parts[13] === '1';
    const categoriaRaw = parts[14] || '';
    const cargoRaw = parts[15] || '';
    const proprietarioRespRaw = parts[16] || '';

    // DESCARTA SE FOR BAIXA NO SISTEMA (PERMISSAOACESSO == 'N')
    if (permissaoAcesso === 'N') return;
    if (!nomeCompleto || nomeCompleto.length < 3) return;

    if (ehRegistroDescartavel(nomeCompleto, tipo, categoriaRaw, cargoRaw, quadraLoteRaw, loteFantasia)) {
      totalDescartados++;
      return;
    }

    const sheetMatch = buscarProfissaoSheets(nomeCompleto);

    const uniqueId = `pres_mdc_${matricula || idUsuario}`;
    const existing = prestadoresExistentesMap.get(uniqueId) || 
                     (matricula ? prestadoresExistentesMap.get(matricula) : null) ||
                     prestadoresExistentesMap.get(normalizarNome(nomeCompleto));

    // PROTEÇÃO TOTAL: Se o colaborador já foi editado na interface do sistema,
    // ele possui soberania local (editadoManualmente: true). NUNCA vira morador e NUNCA é sobrescrito!
    const isEditadoManualmente = !!(existing && existing.editadoManualmente);
    const isPrestadorConfirmado = !!sheetMatch || isEditadoManualmente;
    const isMorador = !isPrestadorConfirmado && ehMoradorOuCondomino(tipo, categoriaRaw, cargoRaw);

    // Se for morador autêntico (não listado no Paulo nem editado no sistema), associa à residência e NÃO cria prestador
    if (isMorador) {
      const setorMorador = mapearSetorOuLote(quadraLoteRaw || loteFantasia, null);
      if (setorMorador.startsWith('QD ')) {
        let uni = unidadeMap.get(setorMorador);
        if (!uni) {
          const partsQL = setorMorador.split('-');
          const qNum = partsQL[0] ? partsQL[0].replace(/\D/g, '').padStart(2, '0') : '00';
          const lNum = partsQL[1] ? partsQL[1].replace(/\D/g, '').padStart(2, '0') : '00';
          uni = {
            id: `uni_${qNum}_${lNum}`,
            quadra: qNum,
            lote: lNum,
            chavePrimaria: setorMorador,
            condominos: [],
            observacoes: '',
            criadoEm: new Date().toISOString()
          };
          dbData.unidades.push(uni);
          unidadeMap.set(setorMorador, uni);
        }

        const partesMorador = nomeCompleto.split(/[\/\\;]/);
        partesMorador.forEach(pm => {
          const limpoM = pm.trim();
          if (limpoM.length < 3) return;
          const kM = normalizarNome(limpoM);
          const jaExiste = uni.condominos.some(c => normalizarNome(c.nome) === kM);
          if (!jaExiste) {
            uni.condominos.push({
              nome: limpoM,
              telefone: telefone || '',
              email: '',
              matricula: matricula,
              cpf: cpf
            });
            totalMoradoresAtualizados++;
          }
        });
      }
      return;
    }

    // REGRA DE PRECEDÊNCIA HÍBRIDA COM PROTEÇÃO DE SOBERANIA LOCAL:
    // 1. DADOS EDITADOS MANUALMENTE NO SISTEMA: Prioridade máxima absoluta!
    // 2. CARGO / PROFISSÃO / RESIDÊNCIA DA PLANILHA DO PAULO: Segunda prioridade
    // 3. DADOS BRUTOS DO MDC 4WEB: Terceira prioridade
    // 4. DATA DE VALIDADE DA FACIAL: Sistema MDC 4WEB (FIMVALIDADE) é a autoridade máxima!
    let categoriaFinal = '';
    let cargoFinal = '';
    let origemFinal = '';
    let respNomeFinal = proprietarioRespRaw;
    let setorOuLote = mapearSetorOuLote(quadraLoteRaw || loteFantasia, sheetMatch);
    let diasSemanaFinal = sheetMatch ? sheetMatch.diasSemana : 'DIÁRIO';

    if (isEditadoManualmente) {
      // Mantém fielmente a customização feita pelo operador na tela
      categoriaFinal = existing.categoria;
      cargoFinal = existing.funcaoCargo || existing.categoria;
      origemFinal = existing.origem || 'Sistema Local (Editado)';
      setorOuLote = existing.quadraLote || setorOuLote;
      respNomeFinal = existing.condominoResponsavel || respNomeFinal;
      diasSemanaFinal = existing.diasSemana || diasSemanaFinal;
    } else if (sheetMatch) {
      categoriaFinal = sheetMatch.profissao;
      cargoFinal = sheetMatch.profissao;
      origemFinal = 'Google Sheets (Paulo)';
      totalSheetsMatched++;

      if (!respNomeFinal && sheetMatch.condomino) {
        respNomeFinal = sheetMatch.condomino;
      }
    } else {
      categoriaFinal = categoriaRaw || cargoRaw || (setorOuLote.startsWith('Corporativo') ? 'Corporativo' : 'Prestador de Serviço');
      cargoFinal = cargoRaw || categoriaRaw || 'Prestador de Serviço';
      origemFinal = 'MDC 4WEB (Classificação)';
      totalMdcClassificados++;
    }

    if (!respNomeFinal && setorOuLote.startsWith('QD ')) {
      const uni = unidadeMap.get(setorOuLote);
      if (uni && uni.condominos && uni.condominos.length > 0) {
        respNomeFinal = uni.condominos.map(c => c.nome).join(' / ');
      }
    }

    // SEMPRE deduplica e extrai no máximo os 2 titulares principais, eliminando repetições e listas gigantes!
    const condominoRespFormatado = extrairTitularesDeduplicados(respNomeFinal, 2) || 
      (setorOuLote.startsWith('Corporativo') ? 'Administração Hamoa' : 'Condômino da Unidade');

    // Garantir que a unidade atribuída ao prestador exista no mapa de residências
    if (setorOuLote.startsWith('QD ') && !unidadeMap.has(setorOuLote)) {
      const partsQL = setorOuLote.split('-');
      const qNum = partsQL[0] ? partsQL[0].replace(/\D/g, '').padStart(2, '0') : '00';
      const lNum = partsQL[1] ? partsQL[1].replace(/\D/g, '').padStart(2, '0') : '00';
      const novaUni = {
        id: `uni_${qNum}_${lNum}`,
        quadra: qNum,
        lote: lNum,
        chavePrimaria: setorOuLote,
        condominos: condominoRespFormatado ? [{ nome: condominoRespFormatado }] : [],
        observacoes: '',
        criadoEm: new Date().toISOString()
      };
      dbData.unidades.push(novaUni);
      unidadeMap.set(setorOuLote, novaUni);
    }

    // A validade facial oficial vem do MDC 4WEB (FIMVALIDADE).
    // Se não tiver no MDC, usa como contingência a data da planilha ou a existente.
    let vencimentoFacial = fimValidade || dtCadFace || (existing ? existing.vencimentoFacial : '') || (sheetMatch ? sheetMatch.vencimentoFacial : '');
    let statusFinal = 'Ativo';
    if (!vencimentoFacial || vencimentoFacial === '-' || vencimentoFacial === '--' || vencimentoFacial.toUpperCase().includes('SEM')) {
      statusFinal = 'Sem Facial';
      vencimentoFacial = '';
    }

    const observacaoPreservada = (existing && existing.observacoes && existing.observacoes !== '-') ? 
                                 existing.observacoes : (sheetMatch ? sheetMatch.observacoes : '');

    let unidadesAtendidas = [];
    if (isManual && existing && Array.isArray(existing.unidadesAtendidas)) {
      unidadesAtendidas = existing.unidadesAtendidas;
    } else if (sheetMatch && Array.isArray(sheetMatch.unidadesAtendidas) && sheetMatch.unidadesAtendidas.length > 0) {
      unidadesAtendidas = [...sheetMatch.unidadesAtendidas];
      if (existing && Array.isArray(existing.unidadesAtendidas)) {
        existing.unidadesAtendidas.forEach(eu => {
          if (!unidadesAtendidas.some(u => u.quadraLote && u.quadraLote.toUpperCase() === eu.quadraLote.toUpperCase())) {
            unidadesAtendidas.push(eu);
          }
        });
      }
    } else if (existing && Array.isArray(existing.unidadesAtendidas) && existing.unidadesAtendidas.length > 0) {
      unidadesAtendidas = existing.unidadesAtendidas;
    }

    if (unidadesAtendidas.length === 0 && setorOuLote.startsWith('QD ')) {
      unidadesAtendidas = [{
        quadraLote: setorOuLote,
        quadraLoteOriginal: setorOuLote,
        condomino: condominoRespFormatado,
        diasSemana: diasSemanaFinal,
        vencimentoFacial: vencimentoFacial,
        observacoes: observacaoPreservada
      }];
    }

    // Garante que todas as unidades atendidas existam no cadastro e seus condôminos estejam vinculados
    unidadesAtendidas.forEach(u => {
      if (u.quadraLote && u.quadraLote.startsWith('QD ')) {
        if (!unidadeMap.has(u.quadraLote)) {
          const partsQL = u.quadraLote.split('-');
          const qNum = partsQL[0] ? partsQL[0].replace(/\D/g, '').padStart(2, '0') : '00';
          const lNum = partsQL[1] ? partsQL[1].replace(/\D/g, '').padStart(2, '0') : '00';
          const novaUni = {
            id: `uni_${qNum}_${lNum}`,
            quadra: qNum,
            lote: lNum,
            chavePrimaria: u.quadraLote,
            condominos: u.condomino ? [{ nome: extrairTitularesDeduplicados(u.condomino, 2) }] : [],
            observacoes: '',
            criadoEm: new Date().toISOString()
          };
          dbData.unidades.push(novaUni);
          unidadeMap.set(u.quadraLote, novaUni);
        } else if (u.condomino) {
          const uni = unidadeMap.get(u.quadraLote);
          const condFormatado = extrairTitularesDeduplicados(u.condomino, 2);
          if (condFormatado && (!uni.condominos || !uni.condominos.some(c => normalizarNome(c.nome) === normalizarNome(condFormatado)))) {
            if (!uni.condominos) uni.condominos = [];
            uni.condominos.push({ nome: condFormatado });
          }
        }
      }
    });

    const prestadorObj = {
      id: uniqueId,
      nome: nomeCompleto,
      matricula: matricula || (existing ? existing.matricula : ''),
      cpf: cpf || (existing ? existing.cpf : ''),
      cracha: cracha || (existing ? existing.cracha : ''),
      categoria: categoriaFinal,
      funcaoCargo: cargoFinal,
      quadraLote: setorOuLote,
      condominoResponsavel: condominoRespFormatado,
      unidadesAtendidas: unidadesAtendidas,
      totalCasas: unidadesAtendidas.length || 1,
      telefoneResponsavel: (existing && existing.telefoneResponsavel) ? existing.telefoneResponsavel : (telefone || ''),
      vencimentoFacial: vencimentoFacial,
      diasSemana: diasSemanaFinal,
      observacoes: observacaoPreservada,
      customFields: existing ? (existing.customFields || {}) : {},
      origem: origemFinal,
      status: statusFinal,
      editadoManualmente: isEditadoManualmente,
      historico: existing && existing.historico ? existing.historico : [],
      atualizadoEm: new Date().toISOString(),
      criadoEm: existing ? existing.criadoEm : new Date().toISOString()
    };

    novosPrestadores.push(prestadorObj);
    processadosNomes.add(normalizarNome(nomeCompleto));
  });

  // 4. Integrar colaboradores restantes da planilha do Paulo (que não constavam no MDC)
  console.log('[3/4] Integrando colaboradores restantes da planilha do Paulo...');
  let extraSheetsAdicionados = 0;
  Object.keys(sheetsMap).forEach((normKey, idx) => {
    if (!processadosNomes.has(normKey)) {
      const s = sheetsMap[normKey];
      const existing = prestadoresExistentesMap.get(normKey);
      const isManual = !!(existing && existing.editadoManualmente);

      let statusFinal = 'Ativo';
      let venc = (isManual && existing.vencimentoFacial) ? existing.vencimentoFacial : (s.vencimentoFacial || '');
      if (!venc || venc === '-' || venc === '--' || venc.toUpperCase().includes('SEM')) {
        statusFinal = 'Sem Facial';
        venc = '';
      }

      const observacaoPreservada = (existing && existing.observacoes && existing.observacoes !== '-') ? 
                                   existing.observacoes : (s.observacoes || '');

      const catFinal = isManual ? existing.categoria : s.profissao;
      const cargoFinal = isManual ? (existing.funcaoCargo || existing.categoria) : s.profissao;
      const qdFinal = isManual ? existing.quadraLote : (s.quadraLote && s.quadraLote !== 'SEM LOTE' ? s.quadraLote : 'Geral');
      const respFinal = isManual ? existing.condominoResponsavel : (s.condomino || 'Condômino da Unidade');
      const respFormatado = extrairTitularesDeduplicados(respFinal, 2) || 'Condômino da Unidade';
      const diasFinal = isManual ? existing.diasSemana : (s.diasSemana || 'DIÁRIO');

      let unidadesAtendidas = [];
      if (isManual && existing && Array.isArray(existing.unidadesAtendidas)) {
        unidadesAtendidas = existing.unidadesAtendidas;
      } else if (s.unidadesAtendidas && Array.isArray(s.unidadesAtendidas) && s.unidadesAtendidas.length > 0) {
        unidadesAtendidas = [...s.unidadesAtendidas];
        if (existing && Array.isArray(existing.unidadesAtendidas)) {
          existing.unidadesAtendidas.forEach(eu => {
            if (!unidadesAtendidas.some(u => u.quadraLote && u.quadraLote.toUpperCase() === eu.quadraLote.toUpperCase())) {
              unidadesAtendidas.push(eu);
            }
          });
        }
      } else if (existing && Array.isArray(existing.unidadesAtendidas) && existing.unidadesAtendidas.length > 0) {
        unidadesAtendidas = existing.unidadesAtendidas;
      }

      if (unidadesAtendidas.length === 0 && qdFinal.startsWith('QD ')) {
        unidadesAtendidas = [{
          quadraLote: qdFinal,
          quadraLoteOriginal: qdFinal,
          condomino: respFormatado,
          diasSemana: diasFinal,
          vencimentoFacial: venc,
          observacoes: observacaoPreservada
        }];
      }

      // Garante que todas as unidades atendidas existam no cadastro e seus condôminos estejam vinculados
      unidadesAtendidas.forEach(u => {
        if (u.quadraLote && u.quadraLote.startsWith('QD ')) {
          if (!unidadeMap.has(u.quadraLote)) {
            const partsQL = u.quadraLote.split('-');
            const qNum = partsQL[0] ? partsQL[0].replace(/\D/g, '').padStart(2, '0') : '00';
            const lNum = partsQL[1] ? partsQL[1].replace(/\D/g, '').padStart(2, '0') : '00';
            const novaUni = {
              id: `uni_${qNum}_${lNum}`,
              quadra: qNum,
              lote: lNum,
              chavePrimaria: u.quadraLote,
              condominos: u.condomino ? [{ nome: extrairTitularesDeduplicados(u.condomino, 2) }] : [],
              observacoes: '',
              criadoEm: new Date().toISOString()
            };
            dbData.unidades.push(novaUni);
            unidadeMap.set(u.quadraLote, novaUni);
          } else if (u.condomino) {
            const uni = unidadeMap.get(u.quadraLote);
            const condFormatado = extrairTitularesDeduplicados(u.condomino, 2);
            if (condFormatado && (!uni.condominos || !uni.condominos.some(c => normalizarNome(c.nome) === normalizarNome(condFormatado)))) {
              if (!uni.condominos) uni.condominos = [];
              uni.condominos.push({ nome: condFormatado });
            }
          }
        }
      });

      novosPrestadores.push({
        id: existing ? existing.id : `pres_sheet_${String(idx + 1).padStart(4, '0')}`,
        nome: s.nome,
        matricula: existing ? existing.matricula : '',
        cpf: existing ? existing.cpf : '',
        cracha: existing ? existing.cracha : '',
        categoria: catFinal,
        funcaoCargo: cargoFinal,
        quadraLote: qdFinal,
        condominoResponsavel: respFormatado,
        unidadesAtendidas: unidadesAtendidas,
        totalCasas: unidadesAtendidas.length || 1,
        telefoneResponsavel: existing ? existing.telefoneResponsavel : '',
        vencimentoFacial: venc,
        diasSemana: diasFinal,
        observacoes: observacaoPreservada,
        customFields: existing ? (existing.customFields || {}) : {},
        origem: isManual ? (existing.origem || 'Sistema Local (Editado)') : 'Google Sheets (Paulo)',
        status: statusFinal,
        editadoManualmente: isManual,
        historico: existing && existing.historico ? existing.historico : [],
        atualizadoEm: new Date().toISOString(),
        criadoEm: existing ? existing.criadoEm : new Date().toISOString()
      });
      processadosNomes.add(normKey);
      extraSheetsAdicionados++;
    }
  });

  const manuais = (dbData.prestadores || []).filter(p => (p.origem === 'Manual' || p.editadoManualmente) && !processadosNomes.has(normalizarNome(p.nome)));
  dbData.prestadores = [...novosPrestadores, ...manuais];

  const catSet = new Set();
  dbData.prestadores.forEach(p => { if (p.categoria) catSet.add(p.categoria); });
  dbData.categorias = Array.from(catSet).sort();

  const logEntry = {
    tipo: 'Sincronização Híbrida (Google Sheets Paulo + MDC 4WEB)',
    status: 'Concluído',
    data: new Date().toISOString(),
    totalLinhasBrutas: lines.length,
    descartados: totalDescartados,
    totalPrestadoresSincronizados: dbData.prestadores.length,
    totalSheetsMatched: totalSheetsMatched,
    extraSheetsAdicionados: extraSheetsAdicionados,
    totalMdcClassificados: totalMdcClassificados,
    totalMoradoresAtualizados: totalMoradoresAtualizados,
    totalUnidades: dbData.unidades.length,
    mensagem: `Sincronização validada com datas do MDC. ${dbData.prestadores.length} prestadores ativos.`
  };

  if (!dbData.syncLogs) dbData.syncLogs = [];
  dbData.syncLogs.unshift(logEntry);
  if (dbData.syncLogs.length > 50) dbData.syncLogs = dbData.syncLogs.slice(0, 50);

  console.log('[4/4] Gravando banco de dados com protecao atomica...');
  saveJsonAtomic(DB_FILE, dbData);

  console.log('================================================================');
  console.log(`[SUCESSO] Sincronização Finalizada com Sucesso!`);
  console.log(` - Prestadores reais no sistema: ${dbData.prestadores.length}`);
  console.log(` - Colaboradores com dados da planilha do Paulo: ${totalSheetsMatched + extraSheetsAdicionados}`);
  console.log(` - Outros prestadores classificados via MDC: ${totalMdcClassificados}`);
  console.log(` - Residências ativas (QD/LT): ${dbData.unidades.length}`);
  console.log(` - Tamanho do arquivo data.json: ${(fs.statSync(DB_FILE).size / 1024).toFixed(1)} KB`);
  console.log('================================================================');
  return dbData;
}

if (require.main === module) {
  executarSincronizacao().catch(err => {
    console.error('[ERRO FATAL NA SINCRONIZACAO]:', err);
    process.exit(1);
  });
}

module.exports = { executarSincronizacao };
