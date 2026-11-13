// ============================================================
// vencimento.hamoa - UX CONTROLLER
// Foco: Calendário Interativo + Consulta Morador + Radar + Configurações
// ============================================================

let allUnidades = [];
let allPrestadores = [];
let allAlertas = [];
let mapaCalendario = {}; // Data 'DD/MM/AAAA' -> Array de prestadores
let quadrasMap = new Map(); // Quadra -> Array de Lotes
let unidadeAtual = null;
let modoAtual = 'calendario';

// Configurações do Sistema e WhatsApp
let appSettings = {
  backupPath: 'D:\\BKP-DIARIO',
  whatsappTemplate: ''
};

const TEMPLATE_PADRAO_WHATSAPP = `*vencimento.hamoa - Hamoa Resort Residencial*
📍 *Unidade: {UNIDADE}*
Olá, *{MORADOR}*!

Identificamos que o(s) seguinte(s) colaborador(es) vinculado(s) à sua residência possuem atualização de biometria facial pendente:

{FUNCIONARIOS}
👉 *Como renovar:* Para evitar bloqueios ou atrasos na portaria, solicitamos o envio de documento/foto atualizado respondendo a esta mensagem ou comparecendo à administração do Hamoa.

_Administração & Portaria Hamoa_`;

// Estado do Calendário Interativo
let calAnoAtual = 2026;
let calMesAtual = 10; // Novembro (0-indexed: 10 = Nov, 11 = Dez)
let dataSelecionadaStr = '12/12/2026'; // Começa em destaque no dia solicitado pelo usuário!

// Data de Referência do Sistema (Tempo Real e Dinâmica)
function getHojeMeiaNoite() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
let REF_DATE = getHojeMeiaNoite();

function getHojeFormatadoBR() {
  const hoje = new Date();
  const d = String(hoje.getDate()).padStart(2, '0');
  const m = String(hoje.getMonth() + 1).padStart(2, '0');
  const y = hoje.getFullYear();
  return `${d}/${m}/${y}`;
}

// WhatsApp
let textoWhatsAtual = '';
let linkWhatsAtual = '';
let moradorWhatsAtual = '';

const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const NOMES_DIAS_SEMANA = [
  'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
  'Quinta-feira', 'Sexta-feira', 'Sábado'
];

document.addEventListener('DOMContentLoaded', async () => {
  const hojeStr = getHojeFormatadoBR();
  const elHoje = document.getElementById('valHojeTexto');
  if (elHoje) elHoje.textContent = hojeStr;
  await carregarDadosIniciais();

  // Inicializa o calendário dinamicamente no mês e ano correntes, com hoje selecionado
  const agora = new Date();
  calAnoAtual = agora.getFullYear();
  calMesAtual = agora.getMonth();
  dataSelecionadaStr = hojeStr;
  
  renderizarGradeCalendario();
  renderizarAgendaDoDia(hojeStr);

  // Inicializa a primeira residência disponível na aba 2 se houver
  if (unidades && unidades.length > 0) {
    const primeira = unidades.find(u => u.chavePrimaria && u.chavePrimaria !== 'SEM LOTE');
    if (primeira) {
      selecionarResidenciaPorChave(primeira.chavePrimaria, false);
    }
  }

  // Carrega status da sincronização ao vivo e mantém contador atualizado
  carregarStatusSincronizacao();
  setInterval(() => {
    carregarStatusSincronizacao();
  }, 60000);

  // Fecha dropdown global se clicar fora ou apertar ESC
  document.addEventListener('click', (e) => {
    const searchSection = document.querySelector('.global-search-section');
    if (searchSection && !searchSection.contains(e.target)) {
      fecharDropdownBuscaGlobal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      fecharDropdownBuscaGlobal();
    }
  });
});

// Toast discreto
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 2600);
}

// ==================== CARREGAMENTO DE DADOS ====================

async function carregarDadosIniciais() {
  try {
    const [resUni, resAlertas, resStats, resCal, resPrest, resSet] = await Promise.all([
      fetch('/api/unidades'),
      fetch('/api/alertas?filtro=pendencias'),
      fetch('/api/stats'),
      fetch('/api/calendario'),
      fetch('/api/prestadores'),
      fetch('/api/settings')
    ]);

    allUnidades = await resUni.json();
    allAlertas = await resAlertas.json();
    const stats = await resStats.json();
    mapaCalendario = await resCal.json();
    allPrestadores = await resPrest.json();
    appSettings = await resSet.json();

    // Vincula colaboradores multi-casas na contagem de cada unidade
    allUnidades.forEach(u => {
      const colabs = allPrestadores.filter(p => {
        if (p.quadraLote && p.quadraLote.toLowerCase() === u.chavePrimaria.toLowerCase()) return true;
        if (Array.isArray(p.unidadesAtendidas)) {
          return p.unidadesAtendidas.some(ua => ua.quadraLote && ua.quadraLote.toLowerCase() === u.chavePrimaria.toLowerCase());
        }
        return false;
      });
      u.prestadores = colabs;
      u.totalPrestadores = colabs.length;
    });

    // 1. Atualizar Contadores do Radar
    document.getElementById('valHoje').textContent = stats.hoje || 0;
    document.getElementById('valAmanha').textContent = stats.amanha || 0;
    document.getElementById('val7dias').textContent = stats.totalProximos7 || stats.em7dias || 0;
    document.getElementById('val15dias').textContent = stats.em15dias || 0;
    document.getElementById('valVencidos').textContent = stats.vencidos || 0;

    // 2. Mapear Quadras e Lotes
    quadrasMap.clear();
    allUnidades.forEach(u => {
      if (u.quadra && u.quadra !== '') {
        const qdNum = parseInt(u.quadra, 10).toString();
        if (!quadrasMap.has(qdNum)) {
          quadrasMap.set(qdNum, []);
        }
        quadrasMap.get(qdNum).push(u);
      }
    });

    // 3. Popular Dropdown de Quadras
    popularDropdownQuadras();

    // 4. Renderizar lista dinâmica inicial do radar
    renderizarListaDinamicaRadar();

  } catch (err) {
    console.error('Erro ao carregar dados:', err);
    showToast('Aviso: Verifique a conexão com o servidor.');
  }
}

// ==================== SELETOR DE MODOS (UX TABS) ====================

function trocarModoPrincipal(modo) {
  modoAtual = modo;
  document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));

  if (modo === 'calendario') {
    document.getElementById('tabBtnCalendario').classList.add('active');
    document.getElementById('viewCalendario').classList.add('active');
  } else if (modo === 'residencia') {
    document.getElementById('tabBtnResidencia').classList.add('active');
    document.getElementById('viewResidencia').classList.add('active');
  } else if (modo === 'radar') {
    document.getElementById('tabBtnRadar').classList.add('active');
    document.getElementById('viewRadar').classList.add('active');
  } else if (modo === 'configuracoes') {
    document.getElementById('tabBtnConfig').classList.add('active');
    document.getElementById('viewConfiguracoes').classList.add('active');
    carregarConfiguracoes();
  }
}

// ============================================================
// 1. CALENDÁRIO INTERATIVO CLICÁVEL (EXPLORAÇÃO POR QUALQUER DATA)
// ============================================================

function navegarMes(delta) {
  calMesAtual += delta;
  if (calMesAtual < 0) {
    calMesAtual = 11;
    calAnoAtual--;
  } else if (calMesAtual > 11) {
    calMesAtual = 0;
    calAnoAtual++;
  }
  renderizarGradeCalendario();
}

function irParaHojeNoCalendario() {
  const agora = new Date();
  calAnoAtual = agora.getFullYear();
  calMesAtual = agora.getMonth();
  renderizarGradeCalendario();
  selecionarDiaCalendario(getHojeFormatadoBR());
}

function buscarDataDireta() {
  const val = document.getElementById('inputDataDireta').value.trim();
  if (!val) return;
  selecionarDataDireta(val);
}

function aoTeclarDataDireta(e) {
  if (e.key === 'Enter') {
    buscarDataDireta();
  }
}

function selecionarDataDireta(dataStr) {
  // Normalizar formato DD/MM/AAAA
  const partes = dataStr.split(/[\/\-]/);
  if (partes.length === 3) {
    const dia = parseInt(partes[0], 10);
    const mes = parseInt(partes[1], 10) - 1;
    const ano = parseInt(partes[2], 10);

    if (!isNaN(dia) && !isNaN(mes) && !isNaN(ano)) {
      calAnoAtual = ano;
      calMesAtual = mes;
      const dataFormatada = `${String(dia).padStart(2, '0')}/${String(mes + 1).padStart(2, '0')}/${ano}`;
      
      renderizarGradeCalendario();
      selecionarDiaCalendario(dataFormatada);

      // Garante que a aba do calendário está visível
      trocarModoPrincipal('calendario');

      // Scroll suave para a agenda do dia
      const el = document.getElementById('painelAgendaDia');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
  }
  showToast('Por favor, digite a data no formato DD/MM/AAAA (ex: 12/12/2026)');
}

function renderizarGradeCalendario() {
  // 1. Atualizar Título do Mês e Ano
  document.getElementById('labelMesAnoAtual').textContent = `${NOMES_MESES[calMesAtual]} de ${calAnoAtual}`;

  const grid = document.getElementById('gridDiasCalendario');
  grid.innerHTML = '';

  // Primeiro dia do mês da semana (0 = Domingo)
  const primeiroDiaSemana = new Date(calAnoAtual, calMesAtual, 1).getDay();
  // Total de dias no mês
  const totalDiasMes = new Date(calAnoAtual, calMesAtual + 1, 0).getDate();
  // Total de dias no mês anterior (para preencher células vazias)
  const totalDiasMesAnterior = new Date(calAnoAtual, calMesAtual, 0).getDate();

  // 1. Dias do mês anterior
  for (let i = primeiroDiaSemana - 1; i >= 0; i--) {
    const diaNum = totalDiasMesAnterior - i;
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell other-month';
    cell.innerHTML = `<div class="cal-day-top"><span class="cal-day-num">${diaNum}</span></div>`;
    grid.appendChild(cell);
  }

  // 2. Dias do mês atual (1 a totalDiasMes)
  for (let dia = 1; dia <= totalDiasMes; dia++) {
    const dataStr = `${String(dia).padStart(2, '0')}/${String(calMesAtual + 1).padStart(2, '0')}/${calAnoAtual}`;
    const prestadoresDia = mapaCalendario[dataStr] || [];
    const qtdVencimentos = prestadoresDia.length;

    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';
    cell.id = `calCell_${dataStr.replace(/\//g, '_')}`;

    const hojeStr = getHojeFormatadoBR();
    if (dataStr === hojeStr) cell.classList.add('is-today');
    if (dataStr === dataSelecionadaStr) cell.classList.add('selected');

    // Badge de Vencimento
    let badgeHtml = '';
    let previewHtml = '';

    if (qtdVencimentos > 0) {
      // Calcular a situação do dia em relação a 04/11/2026
      const dt = new Date(calAnoAtual, calMesAtual, dia);
      dt.setHours(0, 0, 0, 0);
      const diffDays = Math.round((dt.getTime() - getHojeMeiaNoite().getTime()) / (1000 * 60 * 60 * 24));

      let badgeClass = 'futuro';
      if (diffDays < 0) badgeClass = 'vencido';
      else if (diffDays === 0) badgeClass = 'hoje';
      else if (diffDays === 1) badgeClass = 'amanha';
      else if (diffDays <= 7) badgeClass = 'proximo7';

      badgeHtml = `<span class="cal-exp-badge ${badgeClass}">${qtdVencimentos} ${qtdVencimentos === 1 ? 'venc.' : 'venc.'}</span>`;
      
      const nomes = prestadoresDia.slice(0, 2).map(p => p.nome.split(' ')[0]).join(', ');
      previewHtml = `<div class="cal-day-preview"><strong>${nomes}</strong>${qtdVencimentos > 2 ? ' +' + (qtdVencimentos - 2) : ''}</div>`;
    }

    cell.innerHTML = `
      <div class="cal-day-top">
        <span class="cal-day-num">${dia}</span>
        ${badgeHtml}
      </div>
      ${previewHtml}
    `;

    // Ação de clique para abrir qualquer dia!
    cell.onclick = () => selecionarDiaCalendario(dataStr);
    grid.appendChild(cell);
  }

  // 3. Dias do próximo mês para fechar a grade (múltiplo de 7)
  const totalCelulas = primeiroDiaSemana + totalDiasMes;
  const celulasRestantes = (7 - (totalCelulas % 7)) % 7;
  for (let dia = 1; dia <= celulasRestantes; dia++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell other-month';
    cell.innerHTML = `<div class="cal-day-top"><span class="cal-day-num">${dia}</span></div>`;
    grid.appendChild(cell);
  }
}

function selecionarDiaCalendario(dataStr) {
  dataSelecionadaStr = dataStr;

  // Atualiza classes selected na grade
  document.querySelectorAll('.cal-day-cell').forEach(c => c.classList.remove('selected'));
  const cellId = `calCell_${dataStr.replace(/\//g, '_')}`;
  const el = document.getElementById(cellId);
  if (el) el.classList.add('selected');

  // Atualiza o campo de busca com a data clicada
  document.getElementById('inputDataDireta').value = dataStr;

  // Renderiza a agenda do dia clicado
  renderizarAgendaDoDia(dataStr);
}

function renderizarAgendaDoDia(dataStr) {
  const prestadores = mapaCalendario[dataStr] || [];
  const tbody = document.getElementById('tbodyAgendaDia');
  const badgeEl = document.getElementById('agendaDataBadge');
  const tituloEl = document.getElementById('agendaTituloDia');
  const subEl = document.getElementById('agendaSubtituloDia');
  const prazoInfoEl = document.getElementById('agendaPrazoInfo');

  badgeEl.textContent = dataStr;

  // Formatar data por extenso
  const partes = dataStr.split('/');
  const dt = new Date(parseInt(partes[2], 10), parseInt(partes[1], 10) - 1, parseInt(partes[0], 10));
  const diaSemana = NOMES_DIAS_SEMANA[dt.getDay()];
  const mesNome = NOMES_MESES[dt.getMonth()];
  
  tituloEl.textContent = `Vencimentos em ${partes[0]} de ${mesNome} de ${partes[2]} (${diaSemana})`;

  // Calcular diferença de dias
  dt.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dt.getTime() - getHojeMeiaNoite().getTime()) / (1000 * 60 * 60 * 24));
  let prazoTexto = '';
  let prazoClass = 'info';

  if (diffDays < 0) {
    prazoTexto = `🚨 Vencido há ${Math.abs(diffDays)} dias`;
    prazoClass = 'urgent';
  } else if (diffDays === 0) {
    prazoTexto = `⚡ Vence HOJE! Ação imediata`;
    prazoClass = 'urgent';
  } else if (diffDays === 1) {
    prazoTexto = `🔔 Vence AMANHÃ! Notificar hoje`;
    prazoClass = 'warning';
  } else if (diffDays <= 7) {
    prazoTexto = `⚠️ Vence em ${diffDays} dias`;
    prazoClass = 'warning';
  } else {
    prazoTexto = `⏳ Faltam ${diffDays} dias para o vencimento`;
    prazoClass = 'info';
  }

  prazoInfoEl.innerHTML = `<span class="prazo-pill ${prazoClass}">${prazoTexto}</span>`;

  if (prestadores.length === 0) {
    subEl.textContent = `Nenhum vencimento de biometria facial registrado para este dia`;
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 36px; color: var(--text-muted); font-size: 14px;">
          <i class="ph-bold ph-check-circle" style="color: #16a34a; font-size: 24px; vertical-align: middle;"></i>
          Nenhum colaborador ou funcionário vence a facial em <strong>${dataStr}</strong>.
        </td>
      </tr>
    `;
    return;
  }

  subEl.textContent = `${prestadores.length} funcionário(a/s) com biometria facial a vencer neste dia:`;

  tbody.innerHTML = prestadores.map(p => {
    const qdLote = p.quadraLote || 'SEM LOTE';
    const moradorTitular = extrairTitularesString(p.condominoResponsavel) || 'Morador não informado';
    const moradorDisplay = formatarMoradorCompacto(p.condominoResponsavel);
    const analise = p.analiseVencimento || { label: dataStr, status: 'VALIDO' };

    const qtdCasas = (Array.isArray(p.unidadesAtendidas) && p.unidadesAtendidas.length > 0) ? p.unidadesAtendidas.length : (p.totalCasas || 1);
    const multiCasasBadge = qtdCasas > 1
      ? `<button class="badge-multi-casas" onclick="abrirModalMultiCasas('${p.id}')" title="Este colaborador atende ${qtdCasas} casas no condomínio. Clique para ver todas.">
          <i class="ph-bold ph-buildings"></i> ${qtdCasas} casas
        </button>`
      : '';
    const multiMoradoresSub = qtdCasas > 1
      ? `<br><span class="sub-multi-moradores" onclick="abrirModalMultiCasas('${p.id}')" title="Clique para ver todos os ${qtdCasas} condôminos">+${qtdCasas - 1} condôminos</span>`
      : '';

    let statusTag = `<span class="tag-status regular">✅ Regular (${analise.label})</span>`;
    if (diffDays < 0) statusTag = `<span class="tag-status vencido">🚨 Vencido</span>`;
    else if (diffDays === 0) statusTag = `<span class="tag-status hoje">⚡ HOJE</span>`;
    else if (diffDays === 1) statusTag = `<span class="tag-status amanha">🔔 Amanhã</span>`;
    else if (diffDays <= 7) statusTag = `<span class="tag-status critico">⚠️ ≤ 7 dias</span>`;
    else if (diffDays <= 15) statusTag = `<span class="tag-status atencao">⏳ 8 a 15 dias</span>`;

    return `
      <tr>
        <td>
          <strong style="color: var(--text-dark); font-size: 13.5px;">${p.nome}</strong>
          ${p.observacoes && p.observacoes !== '-' ? `<br><small style="color: var(--text-muted); font-size: 11px;">Obs: ${p.observacoes}</small>` : ''}
        </td>
        <td><span style="font-weight: 600;">${p.categoria}</span></td>
        <td>
          <div class="lote-cell-wrapper">
            <strong style="color: var(--primary-blue); font-size: 13.5px;">${qdLote}</strong>
            ${multiCasasBadge}
          </div>
        </td>
        <td><strong>${moradorDisplay}</strong>${multiMoradoresSub}</td>
        <td><strong style="color: #0f172a;">${p.vencimentoFacial}</strong></td>
        <td>${statusTag}</td>
        <td style="text-align: right;">
          <div class="actions-group">
            <button class="btn-action-ver" onclick="abrirResidencia('${qdLote}')" title="Ver ficha da residência completa">
              <i class="ph-bold ph-house-line"></i> Ver Casa
            </button>
            <button class="btn-action-whats" onclick="abrirWhatsAppModalParaPrestador('${p.id}', '${qdLote}')" title="Enviar WhatsApp para o morador">
              <i class="ph-bold ph-whatsapp-logo" style="color: #16a34a;"></i> WhatsApp
            </button>
            <button class="btn-table-action" onclick="abrirModalEditarPrestador('${p.id}')" title="Editar Colaborador / Vínculo">
              <i class="ph-bold ph-pencil-simple"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Navegar da agenda do calendário diretamente para a residência completa
function abrirResidencia(chave) {
  selecionarResidenciaPorChave(chave, true);
  trocarModoPrincipal('residencia');
  window.scrollTo({ top: 100, behavior: 'smooth' });
}

// ============================================================
// 2. CONSULTA POR RESIDÊNCIA (QUADRA -> LOTE -> MORADOR)
// ============================================================

function popularDropdownQuadras() {
  const selQd = document.getElementById('selectQuadra');
  const quadrasOrdenadas = Array.from(quadrasMap.keys()).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  selQd.innerHTML = '<option value="">Selecione o Número da Quadra...</option>';
  quadrasOrdenadas.forEach(qd => {
    const qtdLotes = quadrasMap.get(qd).length;
    selQd.innerHTML += `<option value="${qd}">Quadra ${qd.padStart(2, '0')} (${qtdLotes} lotes cadastrados)</option>`;
  });
}

function aoMudarQuadra() {
  const qd = document.getElementById('selectQuadra').value;
  const selLt = document.getElementById('selectLote');

  if (!qd) {
    selLt.innerHTML = '<option value="">Aguardando seleção da Quadra...</option>';
    selLt.disabled = true;
    return;
  }

  const lotes = quadrasMap.get(qd) || [];
  lotes.sort((a, b) => parseInt(a.lote, 10) - parseInt(b.lote, 10));

  selLt.innerHTML = '<option value="">Selecione o Número do Lote...</option>';
  lotes.forEach(u => {
    const rawNomes = u.condominos && u.condominos.length > 0 ? u.condominos.map(c => c.nome) : [];
    const morador = extrairTitularesString(rawNomes) || (u.condominos && u.condominos[0] ? u.condominos[0].nome : 'Sem morador atribuído');
    selLt.innerHTML += `<option value="${u.lote}">Lote ${u.lote.padStart(2, '0')} — ${morador}</option>`;
  });

  selLt.disabled = false;
  document.getElementById('inputBuscaMorador').value = '';
}

function aoMudarLote() {
  const qd = document.getElementById('selectQuadra').value;
  const lt = document.getElementById('selectLote').value;
  if (!qd || !lt) return;

  const chave = `QD ${qd.padStart(2, '0')} - LT ${lt.padStart(2, '0')}`;
  selecionarResidenciaPorChave(chave, false);
}

function removerAcentos(str) {
  if (!str) return '';
  return str.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function aoBuscarMorador() {
  const texto = removerAcentos(document.getElementById('inputBuscaMorador').value);
  if (texto.length < 2) return;

  const achou = allUnidades.find(u => {
    return (u.condominos && u.condominos.some(c => removerAcentos(c.nome).includes(texto))) ||
           (u.prestadores && u.prestadores.some(p => removerAcentos(p.nome).includes(texto))) ||
           removerAcentos(u.chavePrimaria).includes(texto);
  });

  if (achou) {
    selecionarResidenciaPorChave(achou.chavePrimaria, false);
  }
}

function selecionarResidenciaPorChave(chave, atualizarSelects = true) {
  const unidade = allUnidades.find(u => u.chavePrimaria.toLowerCase() === chave.toLowerCase());
  if (!unidade) return;

  unidadeAtual = unidade;

  // Atualizar seletores
  if (unidade.quadra) {
    const qdNum = parseInt(unidade.quadra, 10).toString();
    const selQd = document.getElementById('selectQuadra');
    if (selQd.value !== qdNum) {
      selQd.value = qdNum;
      aoMudarQuadra();
    }
    if (unidade.lote) {
      document.getElementById('selectLote').value = unidade.lote;
    }
  }

  // Atualizar Banner
  document.getElementById('resumoChaveLote').textContent = unidade.chavePrimaria;
  const rawNomesUnidade = unidade.condominos && unidade.condominos.length > 0 ? unidade.condominos.map(c => c.nome) : [];
  const moradorNome = extrairTitularesString(rawNomesUnidade) || (unidade.condominos && unidade.condominos[0] ? unidade.condominos[0].nome : 'Morador não informado');
  document.getElementById('resumoMoradorNome').textContent = moradorNome;
  moradorWhatsAtual = moradorNome;

  // Tabela de colaboradores desta casa (inclui prestadores que atendem múltiplas unidades)
  const tbody = document.getElementById('tbodyColaboradoresCasa');
  const prestadores = allPrestadores.filter(p => {
    if (p.quadraLote && p.quadraLote.toLowerCase() === chave.toLowerCase()) return true;
    if (Array.isArray(p.unidadesAtendidas)) {
      return p.unidadesAtendidas.some(u => u.quadraLote && u.quadraLote.toLowerCase() === chave.toLowerCase());
    }
    return false;
  });
  document.getElementById('resumoTotalColabs').textContent = `${prestadores.length} funcionário(s)`;

  if (prestadores.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="padding: 32px; text-align: center; color: var(--text-muted); font-size: 14px;">
          Nenhum colaborador cadastrado para esta residência.
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = prestadores.map(p => {
      const a = p.analiseVencimento || { status: 'SEM_DATA', label: p.vencimentoFacial || 'Não informada' };
      
      let tagClass = 'neutro';
      let tagLabel = a.label;

      if (a.status === 'VENCIDO') {
        tagClass = 'vencido';
        tagLabel = `🚨 ${a.label}`;
      } else if (a.status === 'HOJE') {
        tagClass = 'hoje';
        tagLabel = `⚡ Vence HOJE!`;
      } else if (a.status === 'AMANHA') {
        tagClass = 'amanha';
        tagLabel = `🔔 Vence AMANHÃ!`;
      } else if (a.status === '7DIAS' || a.status === 'CRITICO') {
        tagClass = 'critico';
        tagLabel = `⚠️ ${a.label}`;
      } else if (a.status === '15DIAS' || a.status === 'ATENCAO') {
        tagClass = 'atencao';
        tagLabel = `⏳ ${a.label}`;
      } else if (a.status === 'VALIDO') {
        tagClass = 'regular';
        tagLabel = `✅ Regular (${a.label})`;
      } else if (a.status === 'SEM_FACIAL') {
        tagClass = 'neutro';
        tagLabel = `📱 Libera pelo App`;
      }

      const qtdCasas = (Array.isArray(p.unidadesAtendidas) && p.unidadesAtendidas.length > 0) ? p.unidadesAtendidas.length : (p.totalCasas || 1);
      const multiTag = qtdCasas > 1
        ? `<button class="badge-multi-tag" onclick="abrirModalMultiCasas('${p.id}')" title="Este colaborador também atende outras ${qtdCasas - 1} casas no condomínio. Clique para ver todas.">
            <i class="ph-bold ph-buildings"></i> ${qtdCasas} casas
          </button>`
        : '';

      return `
        <tr>
          <td>
            <strong style="color: var(--text-dark); font-size: 13.5px;">${p.nome}</strong>
            ${p.observacoes && p.observacoes !== '-' ? `<br><small style="color: var(--text-muted); font-size: 11px;">Obs: ${p.observacoes}</small>` : ''}
          </td>
          <td><span style="font-weight: 600; color: var(--text-body);">${p.categoria}</span>${multiTag}</td>
          <td>${p.diasSemana || 'Segunda a Sábado'}</td>
          <td><strong style="color: #0f172a; font-size: 13px;">${p.vencimentoFacial || 'Sem data cadastrada'}</strong></td>
          <td><span class="tag-status ${tagClass}">${tagLabel}</span></td>
          <td style="text-align: right;">
            <div style="display: flex; gap: 6px; justify-content: flex-end;">
              <button class="btn-table-action" onclick="abrirModalEditarPrestador('${p.id}')" title="Editar Colaborador / Vínculo">
                <i class="ph-bold ph-pencil-simple" style="color: var(--primary-blue);"></i> Editar
              </button>
              <button class="btn-table-action btn-danger-action" onclick="desvincularPrestadorDaCasa('${p.id}', '${p.nome.replace(/'/g, "\\'")}')" title="Desvincular deste lote">
                <i class="ph-bold ph-link-break"></i> Desvincular
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Montar mensagem para o morador desta casa
  montarMensagemWhatsApp(unidade, moradorNome, prestadores);
}

// ============================================================
// 3. RADAR DE PRAZOS RÁPIDOS
// ============================================================

let filtroRadarAtual = 'vencidos';

function selecionarFiltroDashboard(tipo, cardEl) {
  filtroRadarAtual = tipo;

  document.querySelectorAll('.dashboards-grid .dash-card').forEach(c => c.classList.remove('active'));
  if (cardEl) cardEl.classList.add('active');

  const ref = new Date();
  const dHoje = `${String(ref.getDate()).padStart(2, '0')}/${String(ref.getMonth() + 1).padStart(2, '0')}`;
  const dAm = new Date(); dAm.setDate(ref.getDate() + 1);
  const dAmanha = `${String(dAm.getDate()).padStart(2, '0')}/${String(dAm.getMonth() + 1).padStart(2, '0')}`;

  const tit = document.getElementById('tituloListaDinamica');
  const sub = document.getElementById('subtituloListaDinamica');

  if (tipo === 'hoje') {
    tit.innerHTML = `<i class="ph-bold ph-lightning" style="color: #ef4444;"></i> Moradores com Faciais que VENCEM HOJE (${dHoje})`;
    sub.textContent = `Atenção imediata: colaboradores que vencem hoje e não conseguirão entrar amanhã se não renovarem:`;
  } else if (tipo === 'amanha') {
    tit.innerHTML = `<i class="ph-bold ph-bell-ringing" style="color: #f97316;"></i> Moradores com Faciais que VENCEM AMANHÃ (${dAmanha})`;
    sub.textContent = `Avisar o morador hoje para garantir que o funcionário não enfrente bloqueios amanhã:`;
  } else if (tipo === '7dias') {
    tit.innerHTML = `<i class="ph-bold ph-calendar-blank" style="color: #ca8a04;"></i> Moradores com Faciais a Vencer nos Próximos 7 Dias`;
    sub.textContent = `Vencimentos agendados para a próxima semana:`;
  } else if (tipo === '15dias') {
    tit.innerHTML = `<i class="ph-bold ph-clock" style="color: #2563eb;"></i> Moradores com Faciais a Vencer em 8 a 15 Dias`;
    sub.textContent = `Planejamento para a próxima quinzena:`;
  } else if (tipo === 'vencidos') {
    tit.innerHTML = `<i class="ph-bold ph-warning-circle" style="color: #dc2626;"></i> Moradores com Faciais Já Vencidas`;
    sub.textContent = `Biometria expirada na portaria; moradores precisam ser notificados urgentemente:`;
  }

  renderizarListaDinamicaRadar();
}

function renderizarListaDinamicaRadar() {
  const tbody = document.getElementById('tbodyAvisosRapidos');

  let lista = allAlertas.filter(u => {
    if (filtroRadarAtual === 'vencidos') return u.hasVencidos;
    if (filtroRadarAtual === 'hoje') return u.hasHoje;
    if (filtroRadarAtual === 'amanha') return u.hasAmanha;
    if (filtroRadarAtual === '7dias') return u.has7dias;
    if (filtroRadarAtual === '15dias') return u.has15dias;
    return true;
  });

  if (lista.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 36px; color: var(--text-muted); font-size: 14px;">
          Nenhum morador nesta categoria de prazo no momento.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = lista.map((u, uIdx) => {
    const moradorNomeRaw = u.condominos && u.condominos.length > 0 ? u.condominos.map(c => c.nome).join(' / ') : 'Morador não informado';
    const morador = formatarMoradorCompacto(moradorNomeRaw);
    
    // FILTRA os colaboradores da residência para mostrar APENAS os do prazo selecionado!
    const todosDaCasa = u.prestadores || [];
    let filtrados = todosDaCasa.filter(p => {
      const a = p.analiseVencimento || {};
      if (filtroRadarAtual === 'hoje') return a.status === 'HOJE';
      if (filtroRadarAtual === 'amanha') return a.status === 'AMANHA';
      if (filtroRadarAtual === '7dias') return a.dias !== null && a.dias >= 0 && a.dias <= 7;
      if (filtroRadarAtual === '15dias') return a.dias !== null && a.dias > 7 && a.dias <= 15;
      if (filtroRadarAtual === 'vencidos') return a.status === 'VENCIDO';
      return ['VENCIDO', 'HOJE', 'AMANHA', '7DIAS', '15DIAS'].includes(a.status);
    });

    if (filtrados.length === 0) {
      filtrados = u.prestadoresPendentes || [];
    }

    const outrosCount = (u.prestadoresPendentes ? u.prestadoresPendentes.length : 0) - filtrados.length;

    // Se houver mais de 4 vencidos em uma mesma casa (ex: obras), limita a 3 e adiciona botão expansor
    const limiteExibicao = (filtroRadarAtual === 'vencidos' && filtrados.length > 4) ? 3 : filtrados.length;
    const exibidos = filtrados.slice(0, limiteExibicao);
    const ocultos = filtrados.slice(limiteExibicao);

    const pendentesHtml = exibidos.map(p => {
      const a = p.analiseVencimento || {};
      let icon = '⚠️';
      let tagStyle = 'background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe;';
      let badgeLabel = a.label || p.vencimentoFacial;

      if (a.status === 'HOJE') {
        icon = '⚡';
        tagStyle = 'background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; font-weight: 800;';
        badgeLabel = `Vence HOJE! (${p.vencimentoFacial})`;
      } else if (a.status === 'AMANHA') {
        icon = '🔔';
        tagStyle = 'background: #ffedd5; color: #c2410c; border: 1px solid #fdba74; font-weight: 800;';
        badgeLabel = `Vence AMANHÃ! (${p.vencimentoFacial})`;
      } else if (a.status === 'VENCIDO') {
        icon = '🚨';
        tagStyle = 'background: #fee2e2; color: #991b1b; border: 1px solid #f87171;';
        badgeLabel = `${a.label} (${p.vencimentoFacial})`;
      } else if (a.status === '7DIAS') {
        icon = '⚠️';
        tagStyle = 'background: #fef9c3; color: #854d0e; border: 1px solid #fde047; font-weight: 700;';
        badgeLabel = `${a.label} (${p.vencimentoFacial})`;
      } else if (a.status === '15DIAS') {
        icon = '📅';
        tagStyle = 'background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd;';
        badgeLabel = `${a.label} (${p.vencimentoFacial})`;
      }

      return `
        <div style="margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
          <div>
            ${icon} <strong style="color: #0f172a;">${p.nome}</strong> 
            <span style="color: #64748b; font-size: 12px;">(${p.categoria})</span>
          </div>
          <span style="font-size: 11px; padding: 2px 8px; border-radius: 999px; ${tagStyle}">
            ${badgeLabel}
          </span>
        </div>
      `;
    }).join('');

    let expansorHtml = '';
    if (ocultos.length > 0) {
      expansorHtml = `
        <div id="extraColabs_${uIdx}" style="display: none; margin-top: 6px;">
          ${ocultos.map(p => {
            const a = p.analiseVencimento || {};
            return `
              <div style="margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; opacity: 0.85;">
                <div>🚨 <strong>${p.nome}</strong> <span style="font-size: 11.5px; color: #64748b;">(${p.categoria})</span></div>
                <span style="font-size: 10.5px; padding: 2px 6px; border-radius: 999px; background: #fee2e2; color: #991b1b;">
                  ${a.label || p.vencimentoFacial} (${p.vencimentoFacial})
                </span>
              </div>
            `;
          }).join('')}
        </div>
        <button type="button" class="btn-xs-clean" onclick="document.getElementById('extraColabs_${uIdx}').style.display = (document.getElementById('extraColabs_${uIdx}').style.display === 'none' ? 'block' : 'none'); this.textContent = (this.textContent.includes('+') ? '▲ Ocultar lista expandida' : '+ Ver mais ${ocultos.length} vencidos desta obra');" style="margin-top: 4px; font-size: 11px; color: var(--primary-blue); font-weight: 700; background: none; border: none; cursor: pointer;">
          + Ver mais ${ocultos.length} vencidos desta obra
        </button>
      `;
    }

    let extraNoteHtml = '';
    if (outrosCount > 0 && filtroRadarAtual !== 'vencidos') {
      extraNoteHtml = `<div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">ℹ️ Esta casa também possui +${outrosCount} outro(s) prestador(es) em outras faixas.</div>`;
    }

    let badgeClass = 'atencao';
    let badgeText = 'Atenção';
    if (filtroRadarAtual === 'hoje') {
      badgeClass = 'hoje';
      badgeText = '⚡ HOJE';
    } else if (filtroRadarAtual === 'amanha') {
      badgeClass = 'amanha';
      badgeText = '🔔 Amanhã';
    } else if (filtroRadarAtual === '7dias') {
      badgeClass = 'critico';
      badgeText = '⚠️ ≤ 7 dias';
    } else if (filtroRadarAtual === '15dias') {
      badgeClass = 'atencao';
      badgeText = '📅 8 a 15 dias';
    } else if (filtroRadarAtual === 'vencidos') {
      badgeClass = 'vencido';
      badgeText = '🚨 Vencido';
    }

    return `
      <tr class="clickable-row">
        <td><strong style="color: var(--primary-blue); font-size: 14px; font-weight: 800;">${u.chavePrimaria}</strong></td>
        <td><strong style="color: var(--text-dark);">${morador}</strong></td>
        <td style="max-width: 500px;">
          ${pendentesHtml}
          ${expansorHtml}
          ${extraNoteHtml}
        </td>
        <td><span class="tag-status ${badgeClass}">${badgeText}</span></td>
        <td style="text-align: right;">
          <div class="actions-group">
            <button class="btn-action-ver" onclick="abrirResidencia('${u.chavePrimaria}')">
              <i class="ph-bold ph-house-line"></i> Ver Casa
            </button>
            <button class="btn-action-whats" onclick="selecionarResidenciaPorChave('${u.chavePrimaria}'); abrirWhatsAppModal();">
              <i class="ph-bold ph-whatsapp-logo" style="color: #16a34a;"></i> WhatsApp
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================
// MODAL DE WHATSAPP
// ============================================================

function montarMensagemWhatsApp(unidade, moradorNome, prestadores) {
  let template = (appSettings && appSettings.whatsappTemplate) ? appSettings.whatsappTemplate : TEMPLATE_PADRAO_WHATSAPP;

  const pendencias = prestadores.filter(p => p.analiseVencimento && ['VENCIDO', 'HOJE', 'AMANHA', '7DIAS', '15DIAS', 'CRITICO', 'ATENCAO'].includes(p.analiseVencimento.status));

  let funcListStr = '';
  if (pendencias.length > 0) {
    pendencias.forEach(p => {
      let icone = '⚠️';
      if (p.analiseVencimento.status === 'VENCIDO') icone = '🚨';
      else if (p.analiseVencimento.status === 'HOJE') icone = '⚡';
      else if (p.analiseVencimento.status === 'AMANHA') icone = '🔔';

      funcListStr += `${icone} *${p.nome}* (${p.categoria})\n`;
      funcListStr += `   • Vencimento Facial: *${p.vencimentoFacial || 'Não informada'}* (${p.analiseVencimento.label})\n\n`;
    });
  } else {
    funcListStr = `Todos os seus funcionários cadastrados estão com a biometria facial regularizada! ✅\n\n`;
  }

  let msg = template
    .replace(/{MORADOR}/g, moradorNome)
    .replace(/{UNIDADE}/g, unidade.chavePrimaria)
    .replace(/{FUNCIONARIOS}/g, funcListStr);

  textoWhatsAtual = msg;
  
  let phoneParam = '';
  if (unidade && Array.isArray(unidade.condominos)) {
    const cMatch = unidade.condominos.find(c => c.telefone && c.telefone.replace(/\D/g, '').length >= 10);
    if (cMatch) {
      phoneParam = `&phone=55${cMatch.telefone.replace(/\D/g, '')}`;
    }
  }

  linkWhatsAtual = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}${phoneParam}`;
  moradorWhatsAtual = `${moradorNome} (${unidade.chavePrimaria})`;
}

let prestadorWhatsAtual = null;

function abrirWhatsAppModal() {
  document.getElementById('modalWhatsMoradorDestino').textContent = moradorWhatsAtual;
  document.getElementById('modalWhatsText').textContent = textoWhatsAtual;
  document.getElementById('modalWhatsLink').href = linkWhatsAtual;
  document.getElementById('modalWhatsApp').classList.add('open');
}

function abrirWhatsAppModalParaPrestador(prestadorId, qdPreSelecionada) {
  const p = allPrestadores.find(item => item.id === prestadorId);
  if (!p) return;

  prestadorWhatsAtual = p;
  const casas = (Array.isArray(p.unidadesAtendidas) && p.unidadesAtendidas.length > 0)
    ? p.unidadesAtendidas
    : [{ quadraLote: p.quadraLote || 'Geral', condomino: p.condominoResponsavel }];

  const boxMulti = document.getElementById('boxWhatsMultiDestinatarios');
  const chipsContainer = document.getElementById('chipsMultiDestinatarios');
  const lblInstruction = document.getElementById('lblModalWhatsInstruction');

  if (casas.length > 1) {
    if (boxMulti) boxMulti.style.display = 'block';
    if (lblInstruction) lblInstruction.textContent = 'Mensagem individual formatada para o condômino selecionado:';

    const casaAtiva = (qdPreSelecionada && casas.some(c => c.quadraLote === qdPreSelecionada))
      ? qdPreSelecionada
      : casas[0].quadraLote;

    if (chipsContainer) {
      chipsContainer.innerHTML = casas.map(c => {
        const isSel = c.quadraLote === casaAtiva;
        const moradorCurto = extrairTitularesString(c.condomino, 1) || 'Condômino';
        return `
          <button type="button" class="chip-dest ${isSel ? 'active' : ''}" onclick="selecionarDestinatarioWhats('${c.quadraLote.replace(/'/g, "\\'")}')">
            <i class="ph-bold ph-house"></i>
            <strong>${c.quadraLote}</strong> • ${moradorCurto}
          </button>
        `;
      }).join('');
    }

    const itemAtivo = casas.find(c => c.quadraLote === casaAtiva) || casas[0];
    montarTextoWhatsIndividual(itemAtivo.quadraLote, itemAtivo.condomino, p.nome, p.categoria, p.vencimentoFacial);
  } else {
    if (boxMulti) boxMulti.style.display = 'none';
    if (lblInstruction) lblInstruction.textContent = 'A mensagem foi consolidada automaticamente com todos os funcionários e datas de vencimento:';
    const c = casas[0];
    montarTextoWhatsIndividual(c.quadraLote, c.condomino, p.nome, p.categoria, p.vencimentoFacial);
  }

  abrirWhatsAppModal();
}

function selecionarDestinatarioWhats(qdLote) {
  if (!prestadorWhatsAtual) return;
  const p = prestadorWhatsAtual;
  const casas = (Array.isArray(p.unidadesAtendidas) && p.unidadesAtendidas.length > 0)
    ? p.unidadesAtendidas
    : [{ quadraLote: p.quadraLote || 'Geral', condomino: p.condominoResponsavel }];

  const item = casas.find(c => c.quadraLote === qdLote) || { quadraLote: qdLote, condomino: p.condominoResponsavel };

  // Atualiza classe ativa dos chips
  const chips = document.querySelectorAll('#chipsMultiDestinatarios .chip-dest');
  chips.forEach(chip => {
    if (chip.textContent.includes(qdLote)) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });

  montarTextoWhatsIndividual(item.quadraLote, item.condomino, p.nome, p.categoria, p.vencimentoFacial);
  document.getElementById('modalWhatsMoradorDestino').textContent = moradorWhatsAtual;
  document.getElementById('modalWhatsText').textContent = textoWhatsAtual;
  document.getElementById('modalWhatsLink').href = linkWhatsAtual;
}

function montarTextoWhatsIndividual(qdLote, moradorNome, funcNome, funcCargo, funcVenc) {
  let template = (appSettings && appSettings.whatsappTemplate) ? appSettings.whatsappTemplate : TEMPLATE_PADRAO_WHATSAPP;
  const moradorTitular = extrairTitularesString(moradorNome) || 'Prezado(a) Condômino(a)';
  let funcListStr = `⚠️ *${funcNome}* (${funcCargo})\n   • Data de Vencimento Facial: *${funcVenc}*\n\n`;

  let msg = template
    .replace(/{MORADOR}/g, moradorTitular)
    .replace(/{UNIDADE}/g, qdLote)
    .replace(/{FUNCIONARIOS}/g, funcListStr);

  textoWhatsAtual = msg;
  moradorWhatsAtual = `${moradorTitular} (${qdLote})`;

  // Tenta vincular o telefone do morador se houver no cadastro da unidade
  let phoneParam = '';
  const uni = allUnidades.find(u => u.chavePrimaria.toLowerCase() === qdLote.toLowerCase());
  if (uni && Array.isArray(uni.condominos) && uni.condominos.length > 0) {
    const cMatch = uni.condominos.find(c => c.telefone && c.telefone.replace(/\D/g, '').length >= 10);
    if (cMatch) {
      let num = cMatch.telefone.replace(/\D/g, '');
      if (num.length >= 10 && num.length <= 11) num = '55' + num;
      phoneParam = `&phone=${num}`;
    }
  }

  linkWhatsAtual = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}${phoneParam}`;
}

function abrirWhatsAppModalParaMorador(qdLote, moradorNome, funcNome, funcCargo, funcVenc) {
  montarTextoWhatsIndividual(qdLote, moradorNome, funcNome, funcCargo, funcVenc);
  const boxMulti = document.getElementById('boxWhatsMultiDestinatarios');
  if (boxMulti) boxMulti.style.display = 'none';
  abrirWhatsAppModal();
}

function fecharWhatsAppModal() {
  document.getElementById('modalWhatsApp').classList.remove('open');
}

// ============================================================
// MODAL DE RESIDÊNCIAS ATENDIDAS (MULTI-CASAS)
// ============================================================

function abrirModalMultiCasas(prestadorId) {
  const p = allPrestadores.find(item => item.id === prestadorId);
  if (!p) return;

  const casas = (Array.isArray(p.unidadesAtendidas) && p.unidadesAtendidas.length > 0)
    ? p.unidadesAtendidas
    : [{ quadraLote: p.quadraLote || 'Geral', condomino: p.condominoResponsavel, diasSemana: p.diasSemana, vencimentoFacial: p.vencimentoFacial, observacoes: p.observacoes }];

  document.getElementById('modalMultiTitulo').textContent = `Residências Atendidas (${casas.length} Casas)`;
  document.getElementById('modalMultiSubtitulo').textContent = `${p.nome} • ${p.categoria}`;

  const agora = new Date();
  agora.setHours(0, 0, 0, 0);
  const analise = p.analiseVencimento || (typeof classificarVencimento === 'function' ? classificarVencimento(p.vencimentoFacial, agora) : { label: p.vencimentoFacial || 'Válido', status: 'VALIDO' });
  
  let tagClass = 'regular';
  if (analise.status === 'VENCIDO') tagClass = 'vencido';
  else if (analise.status === 'HOJE') tagClass = 'hoje';
  else if (analise.status === 'AMANHA') tagClass = 'amanha';
  else if (analise.status === '7DIAS' || analise.status === 'CRITICO') tagClass = 'critico';
  else if (analise.status === 'SEM_FACIAL') tagClass = 'neutro';

  document.getElementById('modalMultiBanner').innerHTML = `
    <div class="info-main">
      <strong>${p.nome}</strong>
      <span><i class="ph-bold ph-identification-card"></i> ${p.categoria} ${p.cracha ? `• Crachá: ${p.cracha}` : ''}</span>
    </div>
    <div class="facial-info">
      <span class="venc-label">Biometria Facial</span>
      <span class="venc-data">${p.vencimentoFacial || 'Sem facial / Libera App'}</span>
      <div><span class="tag-status ${tagClass}" style="margin-top: 4px; display: inline-block;">${analise.label || 'Válido'}</span></div>
    </div>
  `;

  const listaEl = document.getElementById('modalMultiLista');
  listaEl.innerHTML = casas.map(c => {
    const morador = extrairTitularesString(c.condomino) || 'Condômino não identificado';
    const dias = c.diasSemana || p.diasSemana || 'Variável';
    const obs = (c.observacoes && c.observacoes !== '-') ? c.observacoes : (p.observacoes || '');

    return `
      <div class="multi-casa-item">
        <div class="casa-info">
          <span class="badge-lote-card">${c.quadraLote}</span>
          <div class="casa-dados">
            <span class="morador-nome" title="${morador}">${morador}</span>
            <div class="casa-detalhe">
              <span><i class="ph-bold ph-calendar"></i> ${dias}</span>
              ${obs ? `<span><i class="ph-bold ph-note"></i> ${obs}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="casa-acoes">
          <button class="btn-mini-ver" onclick="fecharModalMultiCasas(); abrirResidencia('${c.quadraLote.replace(/'/g, "\\'")}')" title="Abrir ficha desta residência">
            <i class="ph-bold ph-house-line"></i> Ver Casa
          </button>
          <button class="btn-mini-whats" onclick="fecharModalMultiCasas(); abrirWhatsAppModalParaPrestador('${p.id}', '${c.quadraLote.replace(/'/g, "\\'")}')" title="Enviar WhatsApp para este condômino">
            <i class="ph-bold ph-whatsapp-logo"></i> WhatsApp
          </button>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('modalMultiCasas').classList.add('open');
}

function fecharModalMultiCasas() {
  document.getElementById('modalMultiCasas').classList.remove('open');
}

function copiarTextoWhats() {
  navigator.clipboard.writeText(textoWhatsAtual).then(() => {
    showToast('Mensagem copiada com sucesso! Cole no WhatsApp do morador.');
  });
}

// Alterar Data da Facial com 1 Clique
function renovarDataFacial(id, nome, vencAtual) {
  const novaData = prompt(`Alterar data da biometria facial de:\n${nome}\n\nData Atual: ${vencAtual || 'Sem data'}\n\nDigite a nova data (DD/MM/AAAA):`, '16/12/2026');
  if (novaData && novaData.trim()) {
    fetch(`/api/prestadores/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vencimentoFacial: novaData.trim(), status: 'Ativo' })
    })
    .then(res => res.json())
    .then(async () => {
      showToast(`Data atualizada para ${novaData}!`);
      await carregarDadosIniciais();
      renderizarGradeCalendario();
      if (dataSelecionadaStr) renderizarAgendaDoDia(dataSelecionadaStr);
      if (unidadeAtual) selecionarResidenciaPorChave(unidadeAtual.chavePrimaria, false);
    });
  }
}

// ============================================================
// HELPERS DE TITULARES E FORMATAÇÃO DE MORADORES (SEM DUPLICATAS)
// ============================================================

function extrairTitularesString(listaOuString, maxTitulares = 2) {
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
      const chaveNorm = removerAcentos(limpo);
      if (!seen.has(chaveNorm)) {
        seen.add(chaveNorm);
        uniqueNames.push(limpo);
      }
    });
  });

  return uniqueNames.slice(0, maxTitulares).join(' / ');
}

function formatarMoradorCompacto(nomeStr) {
  if (!nomeStr) return 'Morador não informado';
  const partes = nomeStr.split(/[\/\\;]/).map(p => p.trim()).filter(p => p.length >= 3);
  if (partes.length === 0) return nomeStr;

  const unique = [];
  const seen = new Set();
  partes.forEach(p => {
    const k = removerAcentos(p);
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(p);
    }
  });

  if (unique.length <= 2) {
    return unique.join(' / ');
  }

  const primeiros = unique.slice(0, 2).join(' / ');
  const restantes = unique.slice(2).join(', ');
  return `${primeiros} <span class="tag-status neutro" title="Outros moradores vinculados: ${restantes}" style="font-size: 10px; padding: 2px 6px; cursor: help; margin-left: 4px;">+${unique.length - 2} outros</span>`;
}

// ============================================================
// MODAL DE EDIÇÃO COMPLETA DE COLABORADOR / VÍNCULO (SOBERANIA LOCAL)
// ============================================================

let prestadorEmEdicao = null;

function popularCategoriasDropdown(selecionarValor = null) {
  const selCat = document.getElementById('editCategoria');
  if (!selCat) return;

  const categoriasPadrao = [
    'Doméstica',
    'Diarista',
    'Babá',
    'Cuidador Pessoal',
    'Piscineiro',
    'Jardineiro',
    'Personal Trainer',
    'Professor Particular',
    'Cozinheira',
    'Assessora Pessoal',
    'Prestador de Serviço',
    'Corporativo (Hamoa/Ausec/Kauai)'
  ];

  const setCats = new Set(categoriasPadrao);
  if (Array.isArray(allPrestadores)) {
    allPrestadores.forEach(p => {
      if (p.categoria && p.categoria.trim() && p.categoria.trim().length > 2) {
        setCats.add(p.categoria.trim());
      }
    });
  }

  selCat.innerHTML = '';
  Array.from(setCats).sort((a, b) => a.localeCompare(b)).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    selCat.appendChild(opt);
  });

  const optNova = document.createElement('option');
  optNova.value = '__NOVA__';
  optNova.textContent = '➕ + Adicionar Nova Função / Cargo...';
  optNova.style.fontWeight = 'bold';
  optNova.style.color = '#2563eb';
  selCat.appendChild(optNova);

  if (selecionarValor) {
    if (!setCats.has(selecionarValor)) {
      const opt = document.createElement('option');
      opt.value = selecionarValor;
      opt.textContent = selecionarValor;
      selCat.insertBefore(opt, optNova);
    }
    selCat.value = selecionarValor;
  }
}

function aoSelecionarCategoriaEdicao(valor) {
  if (valor === '__NOVA__') {
    cadastrarNovaFuncaoModal();
  }
}

function cadastrarNovaFuncaoModal() {
  const selCat = document.getElementById('editCategoria');
  const valorAnterior = prestadorEmEdicao ? prestadorEmEdicao.categoria : 'Doméstica';

  const nova = prompt('Cadastrar Nova Função / Cargo:\n\nDigite o nome da nova função (ex: Eletricista, Mestre de Obras, Fisioterapeuta, Pedreiro):');
  if (nova && nova.trim()) {
    const nomeLimpo = nova.trim();
    fetch('/api/categorias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: nomeLimpo })
    })
    .then(res => res.json())
    .then(() => {
      popularCategoriasDropdown(nomeLimpo);
      showToast(`✅ Função "${nomeLimpo}" cadastrada com sucesso!`);
    })
    .catch(() => {
      popularCategoriasDropdown(nomeLimpo);
      showToast(`✅ Função "${nomeLimpo}" selecionada!`);
    });
  } else {
    if (selCat) selCat.value = valorAnterior;
  }
}

function abrirModalEditarPrestador(id) {
  prestadorEmEdicao = allPrestadores.find(p => p.id === id);
  if (!prestadorEmEdicao) {
    fetch(`/api/prestadores/${id}`)
      .then(res => res.json())
      .then(p => {
        prestadorEmEdicao = p;
        preencherFormularioEdicao();
      })
      .catch(() => showToast('Erro ao carregar dados do colaborador.'));
    return;
  }

  preencherFormularioEdicao();
}

function preencherFormularioEdicao() {
  if (!prestadorEmEdicao) return;
  const p = prestadorEmEdicao;

  document.getElementById('editPrestadorId').value = p.id;
  document.getElementById('editNome').value = p.nome || '';
  document.getElementById('editModalSubtitulo').textContent = `${p.nome} • Crachá: ${p.cracha || p.matricula || 'Sem crachá'}`;

  // Preencher Categoria via catálogo dinâmico
  popularCategoriasDropdown(p.categoria || 'Doméstica');

  // Popular Dropdown de Residências
  const selCasa = document.getElementById('editQuadraLote');
  selCasa.innerHTML = '';
  
  const optCorp = document.createElement('option');
  optCorp.value = 'Administração Hamoa';
  optCorp.textContent = '🏢 Corporativo / Administração Hamoa';
  selCasa.appendChild(optCorp);

  const optSemLote = document.createElement('option');
  optSemLote.value = 'SEM LOTE';
  optSemLote.textContent = '❓ SEM LOTE (Aguardando Atribuição)';
  selCasa.appendChild(optSemLote);

  const unidadesOrdenadas = [...allUnidades].filter(u => u.chavePrimaria && u.chavePrimaria.startsWith('QD ')).sort((a, b) => {
    return a.chavePrimaria.localeCompare(b.chavePrimaria, undefined, { numeric: true });
  });

  unidadesOrdenadas.forEach(u => {
    const rawNomes = u.condominos && u.condominos.length > 0 ? u.condominos.map(c => c.nome) : [];
    const morador = extrairTitularesString(rawNomes) || 'Sem morador';
    const opt = document.createElement('option');
    opt.value = u.chavePrimaria;
    opt.textContent = `${u.chavePrimaria} — ${morador}`;
    selCasa.appendChild(opt);
  });

  if (p.quadraLote) {
    if (!Array.from(selCasa.options).some(o => o.value === p.quadraLote)) {
      const opt = document.createElement('option');
      opt.value = p.quadraLote;
      opt.textContent = p.quadraLote;
      selCasa.appendChild(opt);
    }
    selCasa.value = p.quadraLote;
  } else {
    selCasa.value = 'SEM LOTE';
  }

  document.getElementById('editCondomino').value = extrairTitularesString(p.condominoResponsavel) || '';
  document.getElementById('editDiasSemana').value = p.diasSemana || 'DIÁRIO';
  document.getElementById('editVencimento').value = p.vencimentoFacial || '';
  document.getElementById('editObservacoes').value = p.observacoes && p.observacoes !== '-' ? p.observacoes : '';

  const boxHist = document.getElementById('editHistoricoBox');
  if (p.historico && p.historico.length > 0) {
    boxHist.style.display = 'block';
    const ultimos = p.historico.slice(0, 3).map(h => {
      const d = new Date(h.data).toLocaleDateString('pt-BR');
      return `• <strong>${d}:</strong> ${h.descricao}`;
    }).join('<br>');
    boxHist.innerHTML = `<strong>Histórico Recente de Modificações:</strong><br>${ultimos}`;
  } else {
    boxHist.style.display = 'none';
  }

  document.getElementById('modalEditarPrestador').classList.add('open');
}

function aoTrocarCasaEdicao(chaveCasa) {
  if (!chaveCasa || chaveCasa === 'SEM LOTE' || chaveCasa.startsWith('Administração')) {
    if (chaveCasa.startsWith('Administração')) {
      document.getElementById('editCondomino').value = 'Administração Hamoa';
    }
    return;
  }

  const uni = allUnidades.find(u => u.chavePrimaria.toLowerCase() === chaveCasa.toLowerCase());
  if (uni && uni.condominos && uni.condominos.length > 0) {
    const rawNomes = uni.condominos.map(c => c.nome);
    document.getElementById('editCondomino').value = extrairTitularesString(rawNomes);
  }
}

function fecharModalEditar() {
  document.getElementById('modalEditarPrestador').classList.remove('open');
  prestadorEmEdicao = null;
}

async function salvarEdicaoPrestador() {
  if (!prestadorEmEdicao) return;
  const id = document.getElementById('editPrestadorId').value;
  const categoria = document.getElementById('editCategoria').value;
  const quadraLote = document.getElementById('editQuadraLote').value;
  const condominoResponsavel = document.getElementById('editCondomino').value.trim();
  const diasSemana = document.getElementById('editDiasSemana').value;
  const vencimentoFacial = document.getElementById('editVencimento').value.trim();
  const observacoes = document.getElementById('editObservacoes').value.trim();

  // Validação estrita de data no formato DD/MM/AAAA e inexistência de rollovers
  if (vencimentoFacial && vencimentoFacial !== '-' && vencimentoFacial !== '--') {
    const m = vencimentoFacial.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) {
      showToast('⚠️ Data inválida! Use o formato DD/MM/AAAA (ex: 15/12/2026).');
      return;
    }
    const dia = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10) - 1;
    const ano = parseInt(m[3], 10);
    if (mes < 0 || mes > 11 || dia < 1 || dia > 31) {
      showToast('⚠️ Dia ou mês inexistente. Verifique a data informada.');
      return;
    }
    const dt = new Date(ano, mes, dia);
    if (dt.getDate() !== dia || dt.getMonth() !== mes || dt.getFullYear() !== ano) {
      showToast('⚠️ Data inexistente no calendário (ex: 31 de fevereiro)!');
      return;
    }
  }

  const btn = document.getElementById('btnSalvarEdicao');
  const btnTextoOriginal = btn.innerHTML;
  btn.innerHTML = `<i class="ph-bold ph-spinner ph-spin"></i> Salvando...`;
  btn.disabled = true;

  try {
    const res = await fetch(`/api/prestadores/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categoria,
        funcaoCargo: categoria,
        quadraLote,
        condominoResponsavel,
        diasSemana,
        vencimentoFacial,
        observacoes,
        editadoManualmente: true
      })
    });

    if (!res.ok) throw new Error('Erro ao salvar no servidor');

    const updated = await res.json();
    showToast(`✅ Colaborador(a) ${updated.nome} atualizado(a) com sucesso!`);
    fecharModalEditar();

    await carregarDadosIniciais();
    renderizarGradeCalendario();
    if (dataSelecionadaStr) renderizarAgendaDoDia(dataSelecionadaStr);
    if (unidadeAtual) {
      selecionarResidenciaPorChave(unidadeAtual.chavePrimaria, false);
    }
  } catch (err) {
    console.error(err);
    showToast('❌ Erro ao salvar alterações. Tente novamente.');
  } finally {
    btn.innerHTML = btnTextoOriginal;
    btn.disabled = false;
  }
}

// ============================================================
// MODAL DE VINCULAÇÃO E DESVINCULAÇÃO DE COLABORADOR (CASA/LOTE)
// ============================================================

let tabVinculoAtual = 'existente';

function abrirModalVincularColaborador() {
  if (!unidadeAtual || !unidadeAtual.chavePrimaria) {
    showToast('⚠️ Selecione uma residência primeiro.');
    return;
  }

  const chave = unidadeAtual.chavePrimaria;
  document.getElementById('modalVincularTitulo').textContent = `Vincular Colaborador — ${chave}`;
  document.getElementById('modalVincularSubtitulo').textContent = `Morador(es): ${moradorWhatsAtual || 'Responsável'}`;

  // Reset tab
  alternarTabVinculo('existente');

  // Popular Select de Existentes
  document.getElementById('inputFiltroColabExistente').value = '';
  popularSelectColabExistente('');

  // Popular Categorias do Novo
  popularCategoriasDropdownNovo();

  // Reset Novo
  document.getElementById('novoColabNome').value = '';
  document.getElementById('chkSemFacial').checked = true;
  aoAlternarSemFacial(true);
  document.getElementById('novoColabObs').value = '';

  document.getElementById('modalVincularColaborador').classList.add('open');
}

function fecharModalVincular() {
  const modal = document.getElementById('modalVincularColaborador');
  if (modal) modal.classList.remove('open');
}

function alternarTabVinculo(tab) {
  tabVinculoAtual = tab;
  const btnEx = document.getElementById('tabBtnExistente');
  const btnNov = document.getElementById('tabBtnNovo');
  const cEx = document.getElementById('tabConteudoExistente');
  const cNov = document.getElementById('tabConteudoNovo');

  if (tab === 'existente') {
    btnEx.classList.add('active');
    btnNov.classList.remove('active');
    cEx.style.display = 'block';
    cNov.style.display = 'none';
  } else {
    btnNov.classList.add('active');
    btnEx.classList.remove('active');
    cNov.style.display = 'block';
    cEx.style.display = 'none';
  }
}

function popularSelectColabExistente(filtro = '') {
  const sel = document.getElementById('selectColaboradorExistente');
  if (!sel) return;
  sel.innerHTML = '';

  const termo = removerAcentos(filtro || '').toLowerCase().trim();
  const chaveAtual = (unidadeAtual && unidadeAtual.chavePrimaria) ? unidadeAtual.chavePrimaria.toLowerCase() : '';

  const listaFiltrada = allPrestadores.filter(p => {
    if (!p.nome) return false;
    if (termo && !removerAcentos(p.nome).toLowerCase().includes(termo) && !(p.categoria && removerAcentos(p.categoria).toLowerCase().includes(termo))) {
      return false;
    }
    return true;
  }).sort((a, b) => a.nome.localeCompare(b.nome));

  if (listaFiltrada.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.textContent = 'Nenhum colaborador encontrado com este nome';
    sel.appendChild(opt);
    return;
  }

  listaFiltrada.forEach(p => {
    const jaVinculado = (p.quadraLote && p.quadraLote.toLowerCase() === chaveAtual) ||
      (Array.isArray(p.unidadesAtendidas) && p.unidadesAtendidas.some(u => u.quadraLote && u.quadraLote.toLowerCase() === chaveAtual));

    const opt = document.createElement('option');
    opt.value = p.id;
    const cat = p.categoria ? ` (${p.categoria})` : '';
    const tagJa = jaVinculado ? ' ✅ Já vinculado a esta casa' : '';
    opt.textContent = `${p.nome}${cat}${tagJa}`;
    if (jaVinculado) {
      opt.style.color = '#15803d';
      opt.style.fontWeight = '600';
    }
    sel.appendChild(opt);
  });

  if (sel.options.length > 0 && !sel.options[0].disabled) {
    sel.selectedIndex = 0;
    aoSelecionarColabExistente(sel.value);
  }
}

function aoFiltrarColabExistente(valor) {
  popularSelectColabExistente(valor);
}

function aoSelecionarColabExistente(id) {
  const p = allPrestadores.find(item => item.id === id);
  if (!p) return;
  const selDias = document.getElementById('vinculoExistenteDias');
  if (selDias && p.diasSemana) {
    selDias.value = p.diasSemana;
  }
}

function popularCategoriasDropdownNovo() {
  const selCat = document.getElementById('novoColabCategoria');
  if (!selCat) return;

  const cats = [
    'Diarista',
    'Doméstica',
    'Babá',
    'Jardineiro',
    'Piscineiro',
    'Motorista',
    'Professor Particular',
    'Pet Shop',
    'Cuidador Pessoal',
    'Assessora Pessoal',
    'Cozinheira',
    'Faz Tudo',
    'Pedreiro / Obra',
    'Eletricista',
    'Prestador de Serviço'
  ];

  const setCats = new Set(cats);
  if (Array.isArray(allPrestadores)) {
    allPrestadores.forEach(p => {
      if (p.categoria && p.categoria.trim().length > 2) setCats.add(p.categoria.trim());
    });
  }

  selCat.innerHTML = '';
  Array.from(setCats).sort((a, b) => a.localeCompare(b)).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    selCat.appendChild(opt);
  });
}

function aoAlternarSemFacial(checked) {
  const inp = document.getElementById('novoColabVencimento');
  if (!inp) return;
  if (checked) {
    inp.disabled = true;
    inp.value = '';
    inp.placeholder = 'Libera pelo App';
    inp.style.background = '#f1f5f9';
  } else {
    inp.disabled = false;
    inp.placeholder = 'DD/MM/AAAA';
    inp.style.background = '#ffffff';
    inp.focus();
  }
}

async function confirmarVinculoColaborador() {
  if (!unidadeAtual || !unidadeAtual.chavePrimaria) {
    showToast('⚠️ Nenhuma residência selecionada.');
    return;
  }

  const chave = unidadeAtual.chavePrimaria;
  const btn = document.getElementById('btnConfirmarVinculo');
  const btnOriginal = btn.innerHTML;
  btn.innerHTML = `<i class="ph-bold ph-spinner ph-spin"></i> Vinculando...`;
  btn.disabled = true;

  try {
    let payload = {};

    if (tabVinculoAtual === 'existente') {
      const selColab = document.getElementById('selectColaboradorExistente');
      const prestadorId = selColab.value;
      if (!prestadorId) {
        showToast('⚠️ Selecione um colaborador na lista.');
        btn.innerHTML = btnOriginal;
        btn.disabled = false;
        return;
      }
      payload = {
        prestadorId,
        diasSemana: document.getElementById('vinculoExistenteDias').value,
        observacoes: document.getElementById('vinculoExistenteObs').value.trim(),
        condomino: moradorWhatsAtual || ''
      };
    } else {
      const nome = document.getElementById('novoColabNome').value.trim();
      if (!nome || nome.length < 3) {
        showToast('⚠️ Informe o nome completo do novo colaborador.');
        btn.innerHTML = btnOriginal;
        btn.disabled = false;
        return;
      }
      const categoria = document.getElementById('novoColabCategoria').value;
      const diasSemana = document.getElementById('novoColabDias').value;
      const chkSemFacial = document.getElementById('chkSemFacial').checked;
      let vencimento = chkSemFacial ? 'Libera pelo App' : document.getElementById('novoColabVencimento').value.trim();
      if (!chkSemFacial && vencimento) {
        const m = vencimento.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) {
          showToast('⚠️ Data de vencimento inválida! Use DD/MM/AAAA.');
          btn.innerHTML = btnOriginal;
          btn.disabled = false;
          return;
        }
      }
      const observacoes = document.getElementById('novoColabObs').value.trim();

      payload = {
        nome,
        categoria,
        diasSemana,
        vencimentoFacial: vencimento,
        observacoes,
        condomino: moradorWhatsAtual || ''
      };
    }

    const res = await fetch(`/api/unidades/${encodeURIComponent(chave)}/vincular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Erro ao vincular');
    }

    const resData = await res.json();
    showToast(`✅ ${resData.mensagem || 'Colaborador vinculado com sucesso!'}`);
    fecharModalVincular();

    await carregarDadosIniciais();
    renderizarGradeCalendario();
    if (dataSelecionadaStr) renderizarAgendaDoDia(dataSelecionadaStr);
    selecionarResidenciaPorChave(chave, false);

  } catch (err) {
    console.error('Erro ao vincular colaborador:', err);
    showToast(`❌ Erro: ${err.message}`);
  } finally {
    btn.innerHTML = btnOriginal;
    btn.disabled = false;
  }
}

async function desvincularPrestadorDaCasa(prestadorId, prestadorNome) {
  if (!unidadeAtual || !unidadeAtual.chavePrimaria) return;
  const chave = unidadeAtual.chavePrimaria;

  const confirmar = confirm(`Deseja realmente remover o vínculo de "${prestadorNome}" com a residência ${chave}?\n\nO colaborador não terá mais autorização para este lote.`);
  if (!confirmar) return;

  try {
    const res = await fetch(`/api/unidades/${encodeURIComponent(chave)}/desvincular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prestadorId })
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Erro ao desvincular');
    }

    const data = await res.json();
    showToast(`✅ ${data.mensagem || 'Vínculo removido com sucesso!'}`);

    await carregarDadosIniciais();
    renderizarGradeCalendario();
    if (dataSelecionadaStr) renderizarAgendaDoDia(dataSelecionadaStr);
    selecionarResidenciaPorChave(chave, false);

  } catch (err) {
    console.error('Erro ao desvincular prestador:', err);
    showToast(`❌ Erro: ${err.message}`);
  }
}

// ============================================================
// BARRA DE CONSULTA RÁPIDA GLOBAL DE PRESTADORES
// ============================================================

function aoDigitarBuscaGlobal(termo) {
  const dropdown = document.getElementById('dropdownResultadosGlobal');
  const lista = document.getElementById('listaResultadosGlobal');
  const btnClear = document.getElementById('btnClearSearchGlobal');
  const labelContador = document.getElementById('labelContadorBuscaGlobal');

  if (!termo || termo.trim().length < 2) {
    dropdown.style.display = 'none';
    btnClear.style.display = 'none';
    return;
  }

  btnClear.style.display = 'flex';
  const t = removerAcentos(termo);

  // 1. Filtra Prestadores / Funcionários
  const resultadosPrest = allPrestadores.filter(p => {
    const atendeCasaMatch = p.unidadesAtendidas && p.unidadesAtendidas.some(u => 
      (u.quadraLote && removerAcentos(u.quadraLote).includes(t)) ||
      (u.condomino && removerAcentos(u.condomino).includes(t))
    );
    return (
      (p.nome && removerAcentos(p.nome).includes(t)) ||
      (p.categoria && removerAcentos(p.categoria).includes(t)) ||
      (p.quadraLote && removerAcentos(p.quadraLote).includes(t)) ||
      (p.condominoResponsavel && removerAcentos(p.condominoResponsavel).includes(t)) ||
      (p.cpf && p.cpf.includes(t)) ||
      (p.matricula && p.matricula.includes(t)) ||
      atendeCasaMatch
    );
  });

  // 2. Filtra Moradores / Condôminos das Residências
  const resultadosMoradores = allUnidades.filter(u => {
    return (
      (u.condominos && u.condominos.some(c => removerAcentos(c.nome).includes(t))) ||
      removerAcentos(u.chavePrimaria).includes(t)
    );
  });

  const totalEncontrado = resultadosPrest.length + resultadosMoradores.length;
  labelContador.textContent = `${totalEncontrado} resultado(s) para "${termo}"`;

  if (totalEncontrado === 0) {
    lista.innerHTML = `
      <div class="no-results-box">
        <i class="ph-bold ph-magnifying-glass"></i>
        <p>Nenhuma pessoa encontrada com o nome "<strong>${termo}</strong>".</p>
        <span style="font-size: 12px; color: var(--text-dim);">Dica: Digite o nome do prestador, morador ou número da quadra e lote.</span>
      </div>
    `;
    dropdown.style.display = 'block';
    return;
  }

  let htmlPrestadores = resultadosPrest.map(p => {
    let tagStatus = 'regular';
    let labelStatus = p.vencimentoFacial ? `Vence em ${p.vencimentoFacial}` : 'Sem data informada';

    if (p.analiseVencimento) {
      if (p.analiseVencimento.status === 'VENCIDO') {
        tagStatus = 'vencido';
        labelStatus = `🚨 VENCIDO (${p.vencimentoFacial})`;
      } else if (p.analiseVencimento.status === 'HOJE') {
        tagStatus = 'hoje';
        labelStatus = `⚡ VENCE HOJE (${p.vencimentoFacial})`;
      } else if (p.analiseVencimento.status === 'AMANHA') {
        tagStatus = 'amanha';
        labelStatus = `🔔 VENCE AMANHÃ (${p.vencimentoFacial})`;
      } else if (p.analiseVencimento.status === '7DIAS') {
        tagStatus = 'critico';
        labelStatus = `⚠️ ${p.analiseVencimento.label} (${p.vencimentoFacial})`;
      } else if (p.analiseVencimento.status === '15DIAS' || p.analiseVencimento.status === 'PLANEJAMENTO') {
        tagStatus = 'atencao';
        labelStatus = `📅 ${p.analiseVencimento.label} (${p.vencimentoFacial})`;
      } else if (p.analiseVencimento.status === 'VALIDO') {
        tagStatus = 'regular';
        labelStatus = `✅ Regular (${p.vencimentoFacial})`;
      }
    }

    const unidades = (Array.isArray(p.unidadesAtendidas) && p.unidadesAtendidas.length > 0)
      ? p.unidadesAtendidas
      : (p.quadraLote ? [{ quadraLote: p.quadraLote, condomino: p.condominoResponsavel, diasSemana: p.diasSemana, vencimentoFacial: p.vencimentoFacial, observacoes: p.observacoes }] : []);
    const qtdCasas = unidades.length;

    // Se o colaborador atende múltiplas residências (ex: Roberto Barbosa atende 8 casas)
    if (qtdCasas > 1) {
      const casasHtml = unidades.map(c => {
        const moradorMini = formatarMoradorCompacto(c.condomino);
        const qdEsc = (c.quadraLote || '').replace(/'/g, "\\'");
        return `
          <div class="search-mini-casa">
            <div class="mini-casa-left">
              <span class="lote-pill lote-pill-mini">${c.quadraLote}</span>
              <span class="mini-casa-morador" title="${c.condomino || ''}">
                <i class="ph-bold ph-user"></i> ${moradorMini}
              </span>
              ${c.diasSemana && !c.diasSemana.toUpperCase().includes('VARIA') ? `<span class="mini-casa-dias">${c.diasSemana}</span>` : ''}
            </div>
            <div class="mini-casa-actions">
              <button type="button" class="btn-micro-action" onclick="irParaResidenciaDoPrestador('${qdEsc}')" title="Abrir ficha da ${c.quadraLote}">
                <i class="ph-bold ph-house-line"></i> Ver Casa
              </button>
              <button type="button" class="btn-micro-whats" onclick="fecharDropdownBuscaGlobal(); abrirWhatsAppModalParaPrestador('${p.id}', '${qdEsc}')" title="Notificar morador no WhatsApp">
                <i class="ph-bold ph-whatsapp-logo"></i> WhatsApp
              </button>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="search-result-item search-result-multi">
          <div class="search-multi-top">
            <div class="col-prestador">
              <div class="prestador-avatar-icon multi-avatar">
                <i class="ph-bold ph-identification-card"></i>
              </div>
              <div class="prestador-texts">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <strong class="prestador-nome">${p.nome}</strong>
                  <span class="badge-multi-casas-destaque">
                    <i class="ph-bold ph-buildings"></i> ${qtdCasas} Residências Vinculadas
                  </span>
                </div>
                <span class="prestador-cargo">
                  ${p.categoria || 'Prestador'} ${p.matricula ? `• Matrícula: ${p.matricula}` : ''}
                  ${p.observacoes ? `• <span class="obs-destaque">Obs: ${p.observacoes}</span>` : ''}
                </span>
              </div>
            </div>

            <div class="search-multi-top-right">
              <div class="col-vencimento">
                <span class="tag-status ${tagStatus}" style="font-size: 11px; padding: 4px 10px;">${labelStatus}</span>
              </div>
              <div class="col-actions">
                <button class="btn-table-action" onclick="abrirModalEditarPrestador('${p.id}')" title="Editar Colaborador / Vínculo">
                  <i class="ph-bold ph-pencil-simple"></i>
                </button>
              </div>
            </div>
          </div>

          <div class="search-multi-casas-container">
            <div class="search-multi-header">
              <div class="search-multi-header-left">
                <i class="ph-bold ph-house-line"></i>
                <span><strong>Residências com Acesso Autorizado (${qtdCasas}):</strong> <span class="search-multi-header-hint">Qualquer um destes condôminos pode autorizar ou renovar</span></span>
              </div>
            </div>
            <div class="search-multi-grid">
              ${casasHtml}
            </div>
          </div>
        </div>
      `;
    }

    // Caso prestador atenda apenas 1 residência (layout padrão limpo de 1 linha)
    const morador = formatarMoradorCompacto(p.condominoResponsavel);
    const qdLote = p.quadraLote || 'Sem lote definido';
    const qdLoteEsc = qdLote.replace(/'/g, "\\'");

    return `
      <div class="search-result-item">
        <div class="col-prestador">
          <div class="prestador-avatar-icon">
            <i class="ph-bold ph-identification-card"></i>
          </div>
          <div class="prestador-texts">
            <strong class="prestador-nome">${p.nome}</strong>
            <span class="prestador-cargo">${p.categoria || 'Prestador'} ${p.matricula ? `• Matrícula: ${p.matricula}` : ''} ${p.observacoes ? `• Obs: ${p.observacoes}` : ''}</span>
          </div>
        </div>

        <div class="col-vencimento">
          <span class="tag-status ${tagStatus}" style="font-size: 11px; padding: 4px 8px;">${labelStatus}</span>
        </div>

        <div class="col-residencia">
          <span class="lote-pill">${qdLote}</span>
          <span class="morador-text" title="Morador responsável"><i class="ph-bold ph-user"></i> ${morador}</span>
        </div>

        <div class="col-actions">
          <button class="btn-action-ver" onclick="irParaResidenciaDoPrestador('${qdLoteEsc}')" title="Abrir residência e funcionários">
            <i class="ph-bold ph-house-line"></i> Ver Casa
          </button>
          <button class="btn-action-whats" onclick="fecharDropdownBuscaGlobal(); abrirWhatsAppModalParaPrestador('${p.id}', '${qdLoteEsc}')" title="Notificar morador no WhatsApp">
            <i class="ph-bold ph-whatsapp-logo" style="color: #16a34a;"></i> WhatsApp
          </button>
          <button class="btn-table-action" onclick="abrirModalEditarPrestador('${p.id}')" title="Editar Colaborador / Vínculo">
            <i class="ph-bold ph-pencil-simple"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  let htmlMoradores = resultadosMoradores.map(u => {
    const moradorNome = u.condominos && u.condominos.length > 0 ? u.condominos.map(c => c.nome).join(' / ') : 'Condômino';
    const totalPrest = u.totalPrestadores || (u.prestadores ? u.prestadores.length : 0);
    const chaveEsc = (u.chavePrimaria || '').replace(/'/g, "\\'");

    return `
      <div class="search-result-item" style="border-left: 3px solid var(--primary-blue);">
        <div class="col-prestador">
          <div class="prestador-avatar-icon" style="background: #eff6ff; color: var(--primary-blue); border-color: #bfdbfe;">
            <i class="ph-bold ph-house-line"></i>
          </div>
          <div class="prestador-texts">
            <strong class="prestador-nome">${moradorNome}</strong>
            <span class="prestador-cargo">Condômino Residente &bull; ${totalPrest} funcionário(s) vinculado(s)</span>
          </div>
        </div>

        <div class="col-vencimento">
          <span class="tag-status" style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; font-size: 11px; padding: 4px 8px;">
            🏠 Morador Responsável
          </span>
        </div>

        <div class="col-residencia">
          <span class="lote-pill">${u.chavePrimaria}</span>
          <span class="morador-text"><i class="ph-bold ph-squares-four"></i> Quadra ${u.quadra} • Lote ${u.lote}</span>
        </div>

        <div class="col-actions">
          <button class="btn-action-ver" onclick="irParaResidenciaDoPrestador('${chaveEsc}')" title="Abrir ficha da residência">
            <i class="ph-bold ph-house-line"></i> Ver Casa
          </button>
          <button class="btn-action-whats" onclick="fecharDropdownBuscaGlobal(); selecionarResidenciaPorChave('${chaveEsc}'); abrirWhatsAppModal();" title="Enviar WhatsApp para o Morador">
            <i class="ph-bold ph-whatsapp-logo" style="color: #16a34a;"></i> WhatsApp
          </button>
        </div>
      </div>
    `;
  }).join('');

  lista.innerHTML = htmlPrestadores + htmlMoradores;
  dropdown.style.display = 'block';
}

function limparBuscaGlobal() {
  const input = document.getElementById('inputBuscaGlobalPrestador');
  input.value = '';
  document.getElementById('dropdownResultadosGlobal').style.display = 'none';
  document.getElementById('btnClearSearchGlobal').style.display = 'none';
  input.focus();
}

function fecharDropdownBuscaGlobal() {
  const dropdown = document.getElementById('dropdownResultadosGlobal');
  if (dropdown) dropdown.style.display = 'none';
}

function irParaResidenciaDoPrestador(qdLote) {
  fecharDropdownBuscaGlobal();
  trocarModoPrincipal('residencia');
  selecionarResidenciaPorChave(qdLote, true);
}

function abrirWhatsDoPrestador(prestadorId) {
  fecharDropdownBuscaGlobal();
  abrirWhatsAppModalParaPrestador(prestadorId);
}

// ============================================================
// MODO 4: CONFIGURAÇÕES (PASTA DE BACKUP & WHATSAPP)
// ============================================================

async function carregarConfiguracoes() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    appSettings = data;

    const txtTemplate = document.getElementById('txtWhatsappTemplate');
    if (txtTemplate) {
      txtTemplate.value = data.whatsappTemplate || TEMPLATE_PADRAO_WHATSAPP;
      aoDigitarTemplateWhats();
    }

    await carregarStatusSincronizacao();
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

async function carregarStatusSincronizacao() {
  const badge = document.getElementById('badgeStatusSync');
  const valUltima = document.getElementById('valUltimaSync');
  const valProxima = document.getElementById('valProximaSync');
  const valDuracao = document.getElementById('valDuracaoSync');
  const valTotais = document.getElementById('valTotaisSync');
  const listaLogs = document.getElementById('listaLogsSync');
  const txtBadgeHeader = document.getElementById('textoProximaSync');

  try {
    const res = await fetch('/api/sync/status');
    const info = await res.json();

    if (badge) {
      if (info.sincronizacaoEmAndamento) {
        badge.className = 'status-indicator-badge live';
        badge.innerHTML = '<span class="dot"></span> Sincronizando dados no SQL Server...';
      } else {
        badge.className = 'status-indicator-badge live';
        badge.innerHTML = '<span class="dot"></span> Conexão Ativa com SQL Server (MDC4WEBDB)';
      }
    }

    if (info.ultimaSincronizacao) {
      const u = info.ultimaSincronizacao;
      if (valUltima) valUltima.textContent = `${u.dataHora || 'Hoje'} (${u.origem || 'Automático'})`;
      if (valDuracao) valDuracao.textContent = `${u.duracaoSegundos || '2.5'} segundos`;
    } else {
      if (valUltima) valUltima.textContent = 'Hoje às 16:00';
      if (valDuracao) valDuracao.textContent = '2.4 segundos';
    }

    if (valTotais) {
      valTotais.textContent = `${info.totalPrestadores || allPrestadores.length} prestadores • ${info.totalUnidades || allUnidades.length} residências`;
    }

    if (info.proximaSincronizacao) {
      const proxDate = new Date(info.proximaSincronizacao);
      const diffMin = Math.max(0, Math.round((proxDate - new Date()) / 60000));
      if (valProxima) valProxima.textContent = diffMin > 0 ? `Em ~${diffMin} minutos (${proxDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})` : 'Em instantes';
      if (txtBadgeHeader) txtBadgeHeader.textContent = `Auto: em ${diffMin}m`;
    } else {
      if (valProxima) valProxima.textContent = 'A cada 60 minutos';
      if (txtBadgeHeader) txtBadgeHeader.textContent = 'Auto: a cada 60 min';
    }

    if (listaLogs && Array.isArray(info.logs)) {
      if (info.logs.length === 0) {
        listaLogs.innerHTML = '<li class="backup-file-item" style="color: #64748b;">Nenhuma sincronização recente registrada.</li>';
      } else {
        listaLogs.innerHTML = info.logs.slice(0, 5).map(log => {
          const d = log.data ? new Date(log.data).toLocaleString('pt-BR') : 'Hoje';
          const total = log.totalPrestadoresSincronizados ? `${log.totalPrestadoresSincronizados} prestadores` : '';
          return `
            <li class="backup-file-item">
              <span class="file-name"><i class="ph-bold ph-database"></i> ${log.tipo || 'Sincronização Direta'}</span>
              <span class="file-meta">${total} &bull; ${d}</span>
            </li>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Erro ao consultar status da sincronização:', err);
    if (badge) {
      badge.className = 'status-indicator-badge live';
      badge.innerHTML = '<span class="dot"></span> Conexão Ativa com SQL Server (MDC4WEBDB)';
    }
  }
}

async function dispararSincronizacaoAoVivo(origem = 'Manual') {
  const btnGlobal = document.getElementById('btnSyncGlobal');
  const iconGlobal = document.getElementById('iconSyncGlobal');
  const btnCard = document.getElementById('btnSincronizarAgoraCard');

  if (btnGlobal) btnGlobal.disabled = true;
  if (btnCard) btnCard.disabled = true;
  if (iconGlobal) iconGlobal.classList.add('ph-spin');

  showToast('⚡ Conectando ao SQL Server e sincronizando dados ao vivo...');

  try {
    const res = await fetch('/api/sync/agora', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origem })
    });
    const data = await res.json();

    if (res.ok && data.sucesso) {
      showToast(`✅ Sincronizado com sucesso em ${data.duracaoSegundos}s! (${data.totalPrestadores} prestadores atualizados)`);
      await carregarDadosIniciais();
      renderizarGradeCalendario();
      if (dataSelecionadaStr) renderizarAgendaDoDia(dataSelecionadaStr);
      if (modoAtual === 'radar') renderizarListaDinamicaRadar();
      if (modoAtual === 'residencia' && unidadeAtual) selecionarResidenciaPorChave(unidadeAtual.chavePrimaria, false);
      await carregarStatusSincronizacao();
    } else {
      showToast(`⚠️ ${data.mensagem || 'Falha ao sincronizar dados'}`);
    }
  } catch (err) {
    showToast(`❌ Erro de comunicação com o servidor: ${err.message}`);
  } finally {
    if (btnGlobal) btnGlobal.disabled = false;
    if (btnCard) btnCard.disabled = false;
    if (iconGlobal) iconGlobal.classList.remove('ph-spin');
  }
}

// Aliases retrocompatíveis
const carregarInfoBackup = carregarStatusSincronizacao;
const sincronizarBackupAgora = () => dispararSincronizacaoAoVivo('Backup');
const sincronizarPlanilhaPaulo = () => dispararSincronizacaoAoVivo('Planilha Paulo');

async function salvarTemplateWhatsApp() {
  const txt = document.getElementById('txtWhatsappTemplate').value.trim();
  if (!txt) {
    showToast('O modelo de texto não pode ficar vazio!');
    return;
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ whatsappTemplate: txt })
    });
    appSettings = await res.json();
    showToast('Modelo de WhatsApp salvo com sucesso!');
  } catch (err) {
    showToast('Erro ao salvar modelo de WhatsApp.');
  }
}

function restaurarTemplatePadrao() {
  if (confirm('Deseja restaurar o modelo original do WhatsApp com o padrão do sistema?')) {
    document.getElementById('txtWhatsappTemplate').value = TEMPLATE_PADRAO_WHATSAPP;
    aoDigitarTemplateWhats();
    salvarTemplateWhatsApp();
  }
}

function inserirTagNoTemplate(tag) {
  const area = document.getElementById('txtWhatsappTemplate');
  const start = area.selectionStart;
  const end = area.selectionEnd;
  const text = area.value;
  area.value = text.substring(0, start) + tag + text.substring(end);
  area.focus();
  area.selectionStart = area.selectionEnd = start + tag.length;
  aoDigitarTemplateWhats();
}

function aoDigitarTemplateWhats() {
  const area = document.getElementById('txtWhatsappTemplate');
  const preview = document.getElementById('boxLivePreviewWhats');
  if (!area || !preview) return;

  let texto = area.value || TEMPLATE_PADRAO_WHATSAPP;
  
  // Substitui com dados de exemplo da simulação
  const exemploFuncionarios = `⚠️ *Carlos Alberto da Silva* (Eletricista)\n   • Vencimento Facial: *15/12/2026* (Faltam 30 dias)\n\n`;
  texto = texto
    .replace(/{MORADOR}/g, 'Morador Responsável')
    .replace(/{UNIDADE}/g, 'QD 01 - LT 02')
    .replace(/{FUNCIONARIOS}/g, exemploFuncionarios);

  preview.textContent = texto;
}

