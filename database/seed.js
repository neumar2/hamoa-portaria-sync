const fs = require('fs');
const path = require('path');
const db = require('./db');

const SHEETS_DIR = path.join(__dirname, '..', '..', 'sheets_data');

function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  const rows = [];
  for (const line of lines) {
    // simple csv parser handling quotes
    const row = [];
    let inQuotes = false;
    let curr = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        row.push(curr.trim());
        curr = '';
      } else {
        curr += c;
      }
    }
    row.push(curr.trim());
    rows.push(row);
  }
  return rows;
}

function normalizeQuadraLote(rawQdLote) {
  if (!rawQdLote || rawQdLote === '-' || rawQdLote.trim() === '') return { chave: 'SEM LOTE', quadra: '', lote: '' };
  
  // Clean raw
  let cleaned = rawQdLote.replace(/quadra/i, '').replace(/lote/i, '').replace(/qd/i, '').replace(/lt/i, '').trim();
  // match patterns like "06-08" or "06 - 08" or "6/8" or "6-8"
  const m = cleaned.match(/(\d+)\s*[-/]\s*(\d+)/);
  if (m) {
    const qd = m[1].padStart(2, '0');
    const lt = m[2].padStart(2, '0');
    return { chave: `QD ${qd} - LT ${lt}`, quadra: qd, lote: lt };
  }
  return { chave: rawQdLote.trim().toUpperCase(), quadra: '', lote: '' };
}

function runSeed() {
  console.log('Iniciando carga de dados das planilhas...');
  if (!fs.existsSync(SHEETS_DIR)) {
    console.error('Diretório sheets_data não encontrado:', SHEETS_DIR);
    return;
  }

  const files = fs.readdirSync(SHEETS_DIR).filter(f => f.endsWith('.csv'));
  const unidadesMap = new Map(); // key -> Unidade obj
  const prestadores = [];
  const obras = [];

  let prestadorCounter = 1;

  for (const file of files) {
    const filePath = path.join(SHEETS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const rows = parseCSV(content);
    if (rows.length < 2) continue;

    const headers = rows[0].map(h => h.toUpperCase());

    // Se for a aba de auditoria de obras/cadastros
    if (file.includes('CORRE')) {
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length < 4) continue;
        const num = r[0] || i;
        const cond = r[1] || '';
        const qd = (r[2] || '').trim().padStart(2, '0');
        const lt = (r[3] || '').trim().padStart(2, '0');
        const chave = (qd && lt) ? `QD ${qd} - LT ${lt}` : 'SEM LOTE';

        obras.push({
          id: 'obr_' + num,
          condomino: cond,
          quadra: qd,
          lote: lt,
          chavePrimaria: chave,
          mensagem: r[4] || '',
          contrato: r[5] || '',
          documentacao: r[6] || '',
          numCondominos: r[7] || '',
          parentesco: r[8] || '',
          funcionario: r[9] || '',
          obraStatus: r[10] || 'CORRIGIR'
        });

        // Garantir que a unidade exista no mapa
        if (chave !== 'SEM LOTE' && !unidadesMap.has(chave)) {
          unidadesMap.set(chave, {
            id: 'uni_' + qd + '_' + lt,
            quadra: qd,
            lote: lt,
            chavePrimaria: chave,
            condominos: cond ? [{ nome: cond, telefone: '', email: '' }] : [],
            observacoes: '',
            criadoEm: new Date().toISOString()
          });
        }
      }
      continue;
    }

    // Abas de prestadores (Doméstica, Piscineiro, etc.)
    // Extrair o nome da categoria do nome do arquivo
    let catName = file.replace(/^\d+_/, '').replace('.csv', '').replace(/_/g, ' ');
    // Ajustar nomes com acentuação se tiver quebrado
    if (catName.includes('DOM')) catName = 'Doméstica';
    else if (catName.includes('DI')) catName = 'Diarista';
    else if (catName.includes('BAB')) catName = 'Babá';
    else if (catName.includes('JARD')) catName = 'Jardineiro';
    else if (catName.includes('PISC')) catName = 'Piscineiro';
    else if (catName.includes('MOTOR')) catName = 'Motorista';
    else if (catName.includes('PROFESSOR')) catName = 'Professor Particular';
    else if (catName.includes('PET')) catName = 'Pet Shop';
    else if (catName.includes('CUIDADOR')) catName = 'Cuidador Pessoal';
    else if (catName.includes('ASSESSORA')) catName = 'Assessora Pessoal';
    else if (catName.includes('COZINHEIRA')) catName = 'Cozinheira';
    else if (catName.includes('FAZ TUDO')) catName = 'Faz Tudo';

    db.addCategoria(catName);

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.every(cell => !cell)) continue;

      const colabNome = (r[0] || '').trim();
      const condNome = (r[1] || '').trim();
      const rawQdLote = (r[2] || '').trim();
      const dias = (r[3] || '').trim();
      const venc = (r[4] || '').trim();
      const obs = (r[5] || '').trim();

      const { chave, quadra, lote } = normalizeQuadraLote(rawQdLote);

      // Atualizar Unidade
      if (chave !== 'SEM LOTE') {
        if (!unidadesMap.has(chave)) {
          unidadesMap.set(chave, {
            id: `uni_${quadra || 'X'}_${lote || 'Y'}`,
            quadra: quadra || '',
            lote: lote || '',
            chavePrimaria: chave,
            condominos: condNome ? [{ nome: condNome, telefone: '', email: '' }] : [],
            observacoes: '',
            criadoEm: new Date().toISOString()
          });
        } else if (condNome) {
          const u = unidadesMap.get(chave);
          if (!u.condominos.some(c => c.nome.toLowerCase() === condNome.toLowerCase())) {
            u.condominos.push({ nome: condNome, telefone: '', email: '' });
          }
        }
      }

      // Adicionar prestador se tiver nome ou indicação de demanda
      if (colabNome || condNome) {
        prestadores.push({
          id: 'pres_' + (prestadorCounter++),
          nome: colabNome || `[A Definir - ${catName}]`,
          categoria: catName,
          quadraLote: chave,
          condominoResponsavel: condNome,
          vencimentoFacial: venc,
          diasSemana: dias,
          observacoes: obs,
          origem: 'Importado Planilha',
          status: venc.toUpperCase().includes('SEM FACIAL') ? 'Sem Facial' : 'Ativo',
          criadoEm: new Date().toISOString()
        });
      }
    }
  }

  // Inserir registro de exemplo
  const qdExemplo = 'QD 01 - LT 01';
  if (!unidadesMap.has(qdExemplo)) {
    unidadesMap.set(qdExemplo, {
      id: 'uni_01_01',
      quadra: '01',
      lote: '01',
      chavePrimaria: qdExemplo,
      condominos: [{ nome: 'Morador Exemplo', telefone: '', email: '' }],
      observacoes: 'Residência demonstrativa',
      criadoEm: new Date().toISOString()
    });
  }

  prestadores.push({
    id: 'pres_exemplo_01',
    matricula: '00000000000001',
    cracha: '00000000000001',
    nome: 'PRESTADOR EXEMPLO SILVA',
    nomeAbreviado: 'PRESTADOR EXEMPLO',
    categoria: 'Prestador Geral / Obras',
    quadraLote: qdExemplo,
    condominoResponsavel: 'Morador Exemplo',
    vencimentoFacial: '16/11/2026',
    dtCadFace: '16/10/2026',
    diasSemana: 'DIÁRIO',
    observacoes: 'Registro demonstrativo de teste',
    origem: 'Demonstração',
    status: 'Ativo',
    operador: 'sistema',
    criadoEm: new Date().toISOString()
  });

  // Salvar no Banco
  db.data.unidades = Array.from(unidadesMap.values()).sort((a, b) => a.chavePrimaria.localeCompare(b.chavePrimaria));
  db.data.prestadores = prestadores;
  db.data.obras = obras;
  db.addSyncLog({
    origem: 'Carga Inicial',
    detalhes: `Importados ${unidadesMap.size} lotes, ${prestadores.length} prestadores e ${obras.length} auditorias de obras.`
  });
  db.save();

  console.log(`Carga concluída com sucesso!`);
  console.log(` - Unidades cadastradas: ${db.data.unidades.length}`);
  console.log(` - Prestadores cadastrados: ${db.data.prestadores.length}`);
  console.log(` - Obras auditadas: ${db.data.obras.length}`);
}

runSeed();
