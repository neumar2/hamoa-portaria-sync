const fs = require('fs');
const path = require('path');

const BASE_DIR = path.resolve(__dirname, '..');
const sheetsFile = path.join(BASE_DIR, 'database', 'sheets_professions.json');
const mdcFile = path.join(BASE_DIR, 'database', 'mdc_users_raw.txt');
const outFile = path.join(BASE_DIR, 'public', 'controle-profissoes.html');

const sheets = JSON.parse(fs.readFileSync(sheetsFile, 'utf8'));
const mdcLines = fs.readFileSync(mdcFile, 'utf8').split('\n');

function norm(s) {
  if (!s) return '';
  return s.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extrai estritamente o nome oficial/exato, removendo apelidos ou notas em parênteses
function extrairNomeExato(nomeOriginal) {
  if (!nomeOriginal) return '';
  let s = String(nomeOriginal).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  const matchParenteses = s.match(/^(.*?)\((.*?)\)$/);
  if (matchParenteses) {
    const antes = matchParenteses[1].trim();
    const dentro = matchParenteses[2].trim();
    // Se o que está dentro parece ser o nome completo real (ex: "Chicão (FRANCISCO OLIVEIRA PINTO)")
    if (dentro.split(' ').length > antes.split(' ').length || (dentro === dentro.toUpperCase() && dentro.length > antes.length)) {
      return dentro.replace(/\s+/g, ' ').trim();
    }
    // Caso padrão: apelido/observação entre parênteses no final (ex: "ANTONIO MANOEL DA SILVA (MANUEL - TIO)")
    return antes.replace(/\s+/g, ' ').trim();
  }
  return s;
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
    totalCasas: s.totalCasas || 1,
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

// Contagem por profissão
const profissoesContagem = {};
colaboradores.forEach(c => {
  profissoesContagem[c.profissao] = (profissoesContagem[c.profissao] || 0) + 1;
});

const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Controle Pessoal • Cruzamento de Profissões Planilha vs MDC4</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/@phosphor-icons/web"></script>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-subtle: #334155;
      --border: #334155;
      --border-light: #475569;
      --text: #f8fafc;
      --text-dim: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --info: #06b6d4;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
    }

    body {
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 24px;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    /* HEADER */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-title i {
      font-size: 32px;
      color: var(--primary);
      background: rgba(59, 130, 246, 0.15);
      padding: 10px;
      border-radius: 12px;
    }

    .header-title h1 {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }

    .header-title p {
      font-size: 13px;
      color: var(--text-dim);
      margin-top: 2px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .btn-header {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }

    .btn-header:hover {
      background: var(--card-subtle);
      border-color: var(--primary);
    }

    .btn-header-primary {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }

    .btn-header-primary:hover {
      background: var(--primary-hover);
    }

    /* KPI CARDS */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .kpi-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      flex-shrink: 0;
    }

    .kpi-blue { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
    .kpi-yellow { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
    .kpi-red { background: rgba(239, 68, 68, 0.15); color: #f87171; }
    .kpi-green { background: rgba(16, 185, 129, 0.15); color: #34d399; }

    .kpi-data span {
      font-size: 11.5px;
      color: var(--text-dim);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .kpi-data strong {
      font-size: 24px;
      font-weight: 800;
      display: block;
      line-height: 1.1;
      margin-top: 2px;
    }

    /* PROGRESS BAR */
    .progress-box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 20px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 20px;
    }

    .progress-bar-wrap {
      flex: 1;
      height: 12px;
      background: #0f172a;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--border);
    }

    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #10b981);
      width: 0%;
      transition: width 0.3s ease;
    }

    .progress-text {
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
      white-space: nowrap;
    }

    /* FILTERS SECTION */
    .filters-section {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .search-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .search-input-wrap {
      flex: 1;
      position: relative;
    }

    .search-input-wrap i {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-dim);
      font-size: 18px;
    }

    .search-input {
      width: 100%;
      background: #0f172a;
      border: 1.5px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px 10px 42px;
      color: #fff;
      font-size: 14px;
      outline: none;
      transition: border 0.15s;
    }

    .search-input:focus {
      border-color: var(--primary);
    }

    .pill-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .pill-btn {
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text-dim);
      padding: 5px 11px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }

    .pill-btn:hover {
      background: var(--card-subtle);
      color: #fff;
    }

    .pill-btn.active {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }

    .pill-count {
      background: rgba(255, 255, 255, 0.15);
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 10.5px;
    }

    /* TABLE */
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }

    thead {
      background: #0f172a;
      border-bottom: 2px solid var(--border);
    }

    th {
      padding: 14px 16px;
      font-size: 11.5px;
      font-weight: 800;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    tbody tr {
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      transition: background 0.1s ease;
    }

    tbody tr:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    tbody tr.checked-row {
      background: rgba(16, 185, 129, 0.07);
    }

    tbody tr.checked-row td {
      opacity: 0.65;
    }

    tbody tr.checked-row td:first-child,
    tbody tr.checked-row td:last-child {
      opacity: 1;
    }

    td {
      padding: 12px 16px;
      vertical-align: middle;
    }

    /* BADGES */
    .badge-prof {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 700;
      background: #0f172a;
      border: 1px solid var(--border-light);
      color: #93c5fd;
    }

    .badge-lote {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11.5px;
      font-weight: 700;
      color: #60a5fa;
      background: rgba(59, 130, 246, 0.15);
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }

    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
    }

    .badge-alerta {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .badge-aviso {
      background: rgba(234, 88, 12, 0.15);
      color: #fb923c;
      border: 1px solid rgba(234, 88, 12, 0.3);
    }

    .badge-nao-encontrado {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .badge-sucesso {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    /* ACTION BUTTONS */
    .btn-copy {
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text-dim);
      padding: 4px 8px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s;
    }

    .btn-copy:hover {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }

    .btn-copy.copied {
      background: var(--success) !important;
      border-color: var(--success) !important;
      color: #fff !important;
    }

    .btn-copy-nome {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.45);
      color: #c7d2fe;
      padding: 4px 9px;
      font-size: 11.5px;
      border-radius: 5px;
    }

    .btn-copy-nome:hover {
      background: #4f46e5;
      border-color: #4f46e5;
      color: #fff;
    }

    .colab-nome-click {
      cursor: pointer;
      transition: color 0.15s;
    }

    .colab-nome-click:hover {
      color: #818cf8 !important;
      text-decoration: underline;
    }

    /* CHECKBOX STYLING */
    .custom-check {
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .custom-check input {
      width: 18px;
      height: 18px;
      cursor: pointer;
      accent-color: var(--success);
    }

    /* TOAST */
    .toast-box {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #10b981;
      color: #fff;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.25s ease;
      pointer-events: none;
      z-index: 9999;
    }

    .toast-box.show {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
</head>
<body>

<div class="container">

  <!-- HEADER -->
  <header class="header">
    <div class="header-title">
      <i class="ph-bold ph-clipboard-text"></i>
      <div>
        <h1>Controle Pessoal de Ajuste de Profissões (Planilha do Paulo ➔ MDC4)</h1>
        <p>Lista oficial dos 187 colaboradores com suas profissões e situação atual no sistema MDC 4WEB</p>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn-header" id="btnAtualizarAoVivo" onclick="carregarDadosTempoReal(true)" style="background: rgba(59, 130, 246, 0.2); border-color: rgba(59, 130, 246, 0.5); color: #93c5fd;">
        <i class="ph-bold ph-arrows-clockwise" id="iconAtualizarAoVivo"></i> Atualizar Agora (Tempo Real)
      </button>
      <button class="btn-header" onclick="copiarListaFormatadaTexto()">
        <i class="ph-bold ph-copy"></i> Copiar Tudo em Texto
      </button>
      <button class="btn-header" onclick="exportarCSV()">
        <i class="ph-bold ph-file-csv"></i> Baixar Planilha CSV
      </button>
      <button class="btn-header" onclick="limparMarcadores()">
        <i class="ph-bold ph-arrows-counter-clockwise"></i> Resetar Marcadores
      </button>
      <a href="http://192.168.0.16:3344" class="btn-header btn-header-primary" target="_blank">
        <i class="ph-bold ph-arrow-square-out"></i> Abrir Painel Principal
      </a>
    </div>
  </header>

  <!-- KPI CARDS -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-icon kpi-blue"><i class="ph-bold ph-users"></i></div>
      <div class="kpi-data">
        <span>Total Colaboradores</span>
        <strong id="kpiTotalGeral">${totalGeral}</strong>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-yellow"><i class="ph-bold ph-warning"></i></div>
      <div class="kpi-data">
        <span>No MDC como Prestador Genérico</span>
        <strong id="kpiPrecisaAjustar">${totalPrecisaAjustar}</strong>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-red"><i class="ph-bold ph-user-minus"></i></div>
      <div class="kpi-data">
        <span>Sem Cadastro Facial no MDC</span>
        <strong id="kpiSemCadastro">${totalSemCadastro}</strong>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-green"><i class="ph-bold ph-check-circle"></i></div>
      <div class="kpi-data">
        <span>Classificação Compatível</span>
        <strong id="kpiCompativel">${totalCompativel}</strong>
      </div>
    </div>
  </div>

  <!-- PROGRESS BAR (LOCALSTORAGE) -->
  <div class="progress-box">
    <div style="font-size: 13px; font-weight: 700; color: #94a3b8; display: flex; align-items: center; gap: 6px;">
      <i class="ph-bold ph-check-square"></i> Seu Progresso de Ajuste:
    </div>
    <div class="progress-bar-wrap">
      <div class="progress-bar-fill" id="progressBarFill"></div>
    </div>
    <span class="progress-text" id="progressText">0 de ${totalGeral} ajustados (0%)</span>
    <span id="badgeUltimaAtualizacao" style="margin-left: auto; font-size: 11.5px; color: #64748b;">
      <i class="ph-bold ph-clock"></i> Atualizado ao vivo
    </span>
  </div>

  <!-- FILTROS -->
  <div class="filters-section">
    <div class="search-row">
      <div class="search-input-wrap">
        <i class="ph-bold ph-magnifying-glass"></i>
        <input type="text" id="inputBusca" class="search-input" placeholder="Pesquisar por nome do colaborador, quadra/lote ou condômino..." oninput="filtrarTabela()">
      </div>
      <select id="selectFiltroMDC" class="btn-header" style="padding: 10px 14px;" onchange="filtrarTabela()">
        <option value="TODOS">Todos os Status no MDC</option>
        <option value="AJUSTAR">⚠️ Precisa Ajustar (Genérico / Sec. Lar)</option>
        <option value="SEM_CADASTRO">❌ Não Cadastrados no MDC (Sem Facial)</option>
        <option value="COMPATIVEL">✅ Já Compatíveis no MDC</option>
        <option value="PENDENTES">⏳ Apenas Pendentes (Não Marcados)</option>
        <option value="CONCLUIDOS">✔️ Apenas Concluídos (Marcados)</option>
      </select>
    </div>

    <!-- PILLS DE PROFISSÃO -->
    <div class="pill-filters" id="pillFilters">
      <button class="pill-btn active" onclick="filtrarPorProfissao('TODAS', this)">
        Todas as Profissões <span class="pill-count">${totalGeral}</span>
      </button>
      ${Object.entries(profissoesContagem).map(([p, q]) => `
        <button class="pill-btn" onclick="filtrarPorProfissao('${p}', this)">
          ${p} <span class="pill-count">${q}</span>
        </button>
      `).join('')}
    </div>
  </div>

  <!-- TABELA DE COLABORADORES -->
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th style="width: 50px; text-align: center;">OK</th>
          <th>Colaborador</th>
          <th>Profissão na Planilha</th>
          <th>Residência / Condômino</th>
          <th>Situação Atual no MDC 4WEB</th>
          <th style="text-align: right; width: 220px;">Ações Rápidas</th>
        </tr>
      </thead>
      <tbody id="tbodyColaboradores">
        <!-- Renderizado dinamicamente via JS -->
      </tbody>
    </table>
  </div>

</div>

<!-- TOAST NOTIFICATION -->
<div class="toast-box" id="toastBox">
  <i class="ph-bold ph-check"></i>
  <span id="toastMsg">Copiado para a área de transferência!</span>
</div>

<script>
  let DADOS = ${JSON.stringify(colaboradores, null, 2)};
  let profissaoAtiva = 'TODAS';
  const STORAGE_KEY = 'hamoa_profissoes_concluidas_v1';

  async function carregarDadosTempoReal(forcar = false) {
    const btn = document.getElementById('btnAtualizarAoVivo');
    const icon = document.getElementById('iconAtualizarAoVivo');
    const badgeTime = document.getElementById('badgeUltimaAtualizacao');

    if (btn) btn.disabled = true;
    if (icon) icon.classList.add('ph-spin');
    if (forcar) showToast('🔄 Consultando dados em tempo real...');

    try {
      const res = await fetch('/api/controle-profissoes/live?forcar=' + (forcar ? 'true' : 'false'));
      if (!res.ok) throw new Error('Falha na resposta da API');
      const data = await res.json();

      if (data && Array.isArray(data.colaboradores) && data.colaboradores.length > 0) {
        DADOS = data.colaboradores;

        // Atualiza KPIs
        if (document.getElementById('kpiTotalGeral')) document.getElementById('kpiTotalGeral').textContent = data.totalGeral;
        if (document.getElementById('kpiPrecisaAjustar')) document.getElementById('kpiPrecisaAjustar').textContent = data.totalPrecisaAjustar;
        if (document.getElementById('kpiSemCadastro')) document.getElementById('kpiSemCadastro').textContent = data.totalSemCadastro;
        if (document.getElementById('kpiCompativel')) document.getElementById('kpiCompativel').textContent = data.totalCompativel;

        if (badgeTime) {
          const hora = new Date().toLocaleTimeString('pt-BR');
          badgeTime.innerHTML = '<i class="ph-bold ph-clock"></i> Atualizado às ' + hora + (data.emCache ? ' (cache)' : ' (ao vivo)');
        }

        atualizarProgresso();
        renderTabela();
        if (forcar) showToast('✅ Dados atualizados ao vivo! (' + data.totalGeral + ' colaboradores)');
      }
    } catch (err) {
      console.warn('Modo offline / API indisponível, mantendo dados carregados:', err.message);
      if (forcar) showToast('⚠️ Sem conexão direta com o servidor, usando dados em cache.');
    } finally {
      if (btn) btn.disabled = false;
      if (icon) icon.classList.remove('ph-spin');
    }
  }

  function getConcluidos() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function setConcluidos(arr) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    atualizarProgresso();
  }

  function toggleCheck(id) {
    const list = getConcluidos();
    const idx = list.indexOf(id);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push(id);
    }
    setConcluidos(list);
    renderTabela();
  }

  function atualizarProgresso() {
    const list = getConcluidos();
    const count = list.length;
    const total = DADOS.length;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;

    document.getElementById('progressBarFill').style.width = pct + '%';
    document.getElementById('progressText').textContent = \`\${count} de \${total} ajustados (\${pct}%)\`;
  }

  function showToast(msg) {
    const toast = document.getElementById('toastBox');
    document.getElementById('toastMsg').textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function copiarTexto(texto, el, labelSucesso = 'Copiado!') {
    if (!texto) return;
    // Garante que é ESTRITAMENTE apenas o nome exato (sem quebras de linha, sem tabs, sem espaços duplos nas pontas)
    const textoLimpo = String(texto).replace(/[\\r\\n\\t]+/g, ' ').replace(/\\s+/g, ' ').trim();

    function feedbackSucesso() {
      showToast(\`Copiado: "\${textoLimpo}"\`);
      if (el) {
        const originalHtml = el.innerHTML;
        el.classList.add('copied');
        if (el.tagName === 'BUTTON') {
          el.innerHTML = \`<i class="ph-bold ph-check"></i> \${labelSucesso}\`;
        }
        setTimeout(() => {
          el.classList.remove('copied');
          if (el.tagName === 'BUTTON') {
            el.innerHTML = originalHtml;
          }
        }, 1500);
      }
    }

    // 1. Tenta API moderna do navegador (HTTPS ou localhost)
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(textoLimpo)
        .then(() => feedbackSucesso())
        .catch(() => fallbackCopy(textoLimpo));
    } else {
      fallbackCopy(textoLimpo);
    }

    // 2. Fallback universal (funciona em HTTP via IP de rede 192.168.x.x e outros)
    function fallbackCopy(str) {
      try {
        const ta = document.createElement('textarea');
        ta.value = str;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, 99999);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) {
          feedbackSucesso();
        } else {
          window.prompt('Copie o nome exato com Ctrl+C:', str);
        }
      } catch (err) {
        window.prompt('Copie o nome exato com Ctrl+C:', str);
      }
    }
  }

  function filtrarPorProfissao(prof, btn) {
    profissaoAtiva = prof;
    document.querySelectorAll('#pillFilters .pill-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    filtrarTabela();
  }

  function filtrarTabela() {
    renderTabela();
  }

  function renderTabela() {
    const termo = (document.getElementById('inputBusca').value || '').toLowerCase().trim();
    const filtroMDC = document.getElementById('selectFiltroMDC').value;
    const concluidos = new Set(getConcluidos());

    const filtrados = DADOS.filter(c => {
      // 1. Filtro Profissão
      if (profissaoAtiva !== 'TODAS' && c.profissao !== profissaoAtiva) return false;

      // 2. Filtro Busca Texto
      if (termo) {
        const match = c.nome.toLowerCase().includes(termo) ||
                      c.profissao.toLowerCase().includes(termo) ||
                      c.casasStr.toLowerCase().includes(termo) ||
                      c.condomino.toLowerCase().includes(termo) ||
                      (c.mdc && c.mdc.classificacao.toLowerCase().includes(termo));
        if (!match) return false;
      }

      // 3. Filtro Status MDC
      if (filtroMDC === 'AJUSTAR') {
        if (!c.situacao.startsWith('AJUSTAR')) return false;
      } else if (filtroMDC === 'SEM_CADASTRO') {
        if (c.situacao !== 'SEM_CADASTRO') return false;
      } else if (filtroMDC === 'COMPATIVEL') {
        if (c.situacao !== 'COMPATIVEL') return false;
      } else if (filtroMDC === 'PENDENTES') {
        if (concluidos.has(c.id)) return false;
      } else if (filtroMDC === 'CONCLUIDOS') {
        if (!concluidos.has(c.id)) return false;
      }

      return true;
    });

    const tbody = document.getElementById('tbodyColaboradores');
    if (filtrados.length === 0) {
      tbody.innerHTML = \`
        <tr>
          <td colspan="6" style="padding: 40px; text-align: center; color: var(--text-dim); font-size: 14px;">
            <i class="ph-bold ph-magnifying-glass" style="font-size: 28px; display: block; margin-bottom: 8px;"></i>
            Nenhum colaborador encontrado com estes critérios de filtro.
          </td>
        </tr>
      \`;
      return;
    }

    tbody.innerHTML = filtrados.map(c => {
      const isDone = concluidos.has(c.id);
      const mdcCargo = (c.mdc && c.mdc.cargo) ? \`<span style="color: #cbd5e1; font-size: 11px;">Cargo: \${c.mdc.cargo}</span>\` : '';
      const mdcFace = (c.mdc && c.mdc.fimValidade) ? \`<small style="color: #94a3b8; display: block; font-size: 11px;">Validade: \${c.mdc.fimValidade}</small>\` : '';

      const dadosCompletos = \`Nome: \${c.nome} | Profissão: \${c.profissao} | Residência: \${c.casasStr} | Morador: \${c.condomino}\`;

      return \`
        <tr class="\${isDone ? 'checked-row' : ''}">
          <td style="text-align: center;">
            <label class="custom-check">
              <input type="checkbox" \${isDone ? 'checked' : ''} onchange="toggleCheck('\${c.id}')" title="Marcar como já ajustado no MDC">
            </label>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 3px;">
              <strong class="colab-nome-click" onclick="copiarTexto('\${c.nome.replace(/'/g, "\\\\'")}', this, 'Nome Copiado!')" title="Clique para copiar apenas o nome exato" style="color: #fff; font-size: 13.5px;">\${c.nome}</strong>
              \${c.temApelido ? \`<span style="font-size: 11px; color: var(--text-dim);">(Planilha: \${c.nomeOriginal})</span>\` : ''}
              <div style="display: flex; gap: 6px; align-items: center; margin-top: 2px;">
                <button class="btn-copy btn-copy-nome" onclick="copiarTexto('\${c.nome.replace(/'/g, "\\\\'")}', this, 'Nome Copiado!')" title="Copiar apenas o nome exato">
                  <i class="ph-bold ph-copy"></i> Copiar Nome
                </button>
              </div>
            </div>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="badge-prof">\${c.profissao}</span>
              <button class="btn-copy" onclick="copiarTexto('\${c.profissao}', this, 'Copiado!')" title="Copiar profissão">
                <i class="ph-bold ph-copy"></i>
              </button>
            </div>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 3px;">
              <div><span class="badge-lote">\${c.casasStr}</span></div>
              <span style="font-size: 11.5px; color: var(--text-dim);" title="\${c.condomino}">\${c.condomino}</span>
            </div>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span class="badge-status \${c.situacaoBadge}">\${c.situacaoLabel}</span>
              \${mdcFace}
            </div>
          </td>
          <td style="text-align: right;">
            <div style="display: flex; gap: 6px; justify-content: flex-end;">
              <button class="btn-copy" onclick="copiarTexto('\${dadosCompletos.replace(/'/g, "\\\\'")}', this, 'Copiado!')" title="Copiar linha completa">
                <i class="ph-bold ph-clipboard"></i> Copiar Linha
              </button>
            </div>
          </td>
        </tr>
      \`;
    }).join('');
  }

  function copiarListaFormatadaTexto() {
    const linhas = DADOS.map(c => \`\${c.nome} | \${c.profissao} | \${c.casasStr} | \${c.condomino}\`).join('\\n');
    copiarTexto(linhas, null, 'Copiado!');
  }

  function exportarCSV() {
    let csv = 'Nome;Profissao;Casas;Condomino;Situacao_MDC;Classificacao_MDC;Validade_Facial\\n';
    DADOS.forEach(c => {
      const mdcCat = c.mdc ? (c.mdc.classificacao || '') : '';
      const mdcVal = c.mdc ? (c.mdc.fimValidade || '') : '';
      csv += \`"\${c.nome}";"\${c.profissao}";"\${c.casasStr}";"\${c.condomino}";"\${c.situacao}";"\${mdcCat}";"\${mdcVal}"\\n\`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'cruzamento_profissoes_paulo_mdc4.csv';
    link.click();
    showToast('Download do arquivo CSV iniciado!');
  }

  function limparMarcadores() {
    if (confirm('Deseja realmente resetar todas as marcações de progresso?')) {
      localStorage.removeItem(STORAGE_KEY);
      atualizarProgresso();
      renderTabela();
      showToast('Marcadores resetados com sucesso!');
    }
  }

  // Inicialização
  atualizarProgresso();
  renderTabela();

  // Tenta carregar dados ao vivo se estiver servido por HTTP
  if (window.location.protocol.startsWith('http')) {
    carregarDadosTempoReal(false);
  }
</script>

</body>
</html>
`;

fs.writeFileSync(outFile, htmlContent, 'utf8');
console.log('Arquivo gerado com sucesso em:', outFile);
console.log('Tamanho:', htmlContent.length, 'bytes');

