// Motor de Análise de Prazos e Geração de Alertas por Quadra/Lote - Hamoa Resort Residencial
// Blindado contra desvios de fuso horário, formatos atípicos e com data dinâmica em tempo real

function normalizarMeiaNoite(date) {
  if (!date) return null;
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDataBR(strDate) {
  if (!strDate) return null;
  const s = strDate.trim();

  // Ignora explicitamente valores que não são datas
  if (['-', '--', 'N/A', 'SEM FACIAL', 'SEM VENCIMENTO', 'LIBERA PELO APP', 'SEM FOTO', 'ISENTO'].includes(s.toUpperCase())) {
    return null;
  }

  // 1. Formato DD/MM/AAAA ou DD-MM-AAAA
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const dia = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10) - 1;
    const ano = parseInt(m[3], 10);
    if (mes < 0 || mes > 11 || dia < 1 || dia > 31) return null;
    const d = new Date(ano, mes, dia);
    d.setHours(0, 0, 0, 0);
    // Validação estrita de calendário: impede que JavaScript faça rollover (ex: 31/02 virar 03/03)
    if (d.getDate() !== dia || d.getMonth() !== mes || d.getFullYear() !== ano) {
      return null;
    }
    return d;
  }

  // 2. Formato ISO AAAA-MM-DD
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) {
    const ano = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10) - 1;
    const dia = parseInt(m[3], 10);
    if (mes < 0 || mes > 11 || dia < 1 || dia > 31) return null;
    const d = new Date(ano, mes, dia);
    d.setHours(0, 0, 0, 0);
    if (d.getDate() !== dia || d.getMonth() !== mes || d.getFullYear() !== ano) {
      return null;
    }
    return d;
  }

  // 3. Formato DD/MM/AA (ano com 2 dígitos)
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m) {
    const dia = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10) - 1;
    let ano = parseInt(m[3], 10);
    ano += ano < 70 ? 2000 : 1900;
    if (mes < 0 || mes > 11 || dia < 1 || dia > 31) return null;
    const d = new Date(ano, mes, dia);
    d.setHours(0, 0, 0, 0);
    if (d.getDate() !== dia || d.getMonth() !== mes || d.getFullYear() !== ano) {
      return null;
    }
    return d;
  }

  return null;
}

function formatDataBR(date) {
  if (!date) return '-';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function classificarVencimento(vencimentoStr, refDate = new Date()) {
  if (!vencimentoStr) {
    return { status: 'SEM_FACIAL', label: 'Sem Facial / Libera App', dias: null, badge: 'info' };
  }
  
  const upper = vencimentoStr.trim().toUpperCase();
  if (upper === '-' || upper === '--' || upper.includes('SEM FACIAL') || upper.includes('LIBERA PELO APP') || upper.includes('SEM VENCIMENTO') || upper.includes('SEM FOTO')) {
    return { status: 'SEM_FACIAL', label: 'Sem Facial / Libera App', dias: null, badge: 'info' };
  }

  const dt = parseDataBR(vencimentoStr);
  if (!dt) {
    return { status: 'SEM_FACIAL', label: vencimentoStr, dias: null, badge: 'secondary' };
  }

  const ref = normalizarMeiaNoite(refDate) || normalizarMeiaNoite(new Date());
  const diffTime = dt.getTime() - ref.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { status: 'VENCIDO', label: `Vencido há ${Math.abs(diffDays)} dias`, dias: diffDays, badge: 'danger' };
  } else if (diffDays === 0) {
    return { status: 'HOJE', label: 'Vence HOJE!', dias: 0, badge: 'urgent' };
  } else if (diffDays === 1) {
    return { status: 'AMANHA', label: 'Vence AMANHÃ!', dias: 1, badge: 'warning-urgent' };
  } else if (diffDays <= 7) {
    return { status: '7DIAS', label: `Vence em ${diffDays} dias`, dias: diffDays, badge: 'warning' };
  } else if (diffDays <= 15) {
    return { status: '15DIAS', label: `Vence em ${diffDays} dias`, dias: diffDays, badge: 'info' };
  } else if (diffDays <= 30) {
    return { status: 'PLANEJAMENTO', label: `Vence em ${diffDays} dias`, dias: diffDays, badge: 'info' };
  } else {
    return { status: 'VALIDO', label: `Válido (${diffDays} dias)`, dias: diffDays, badge: 'success' };
  }
}

// Agrupamento Consolidado por Residência (Quadra e Lote)
function gerarAlertasConsolidados(prestadores, unidades, refDate = new Date()) {
  const unidadesMap = new Map();
  const ref = normalizarMeiaNoite(refDate) || normalizarMeiaNoite(new Date());

  // Indexar unidades
  unidades.forEach(u => {
    unidadesMap.set(u.chavePrimaria, {
      ...u,
      prestadores: [],
      hasVencidos: false,
      hasHoje: false,
      hasAmanha: false,
      has7dias: false,
      has15dias: false,
      totalPrestadores: 0
    });
  });

  // Garantir a chave SEM LOTE se houver prestadores sem casa
  if (!unidadesMap.has('Geral') && !unidadesMap.has('SEM LOTE')) {
    unidadesMap.set('Geral', {
      id: 'geral',
      quadra: '',
      lote: '',
      chavePrimaria: 'Geral',
      condominos: [{ nome: 'Administração / Portaria Hamoa' }],
      observacoes: 'Prestadores sem residência atribuída',
      prestadores: [],
      hasVencidos: false,
      hasHoje: false,
      hasAmanha: false,
      has7dias: false,
      has15dias: false,
      totalPrestadores: 0
    });
  }

  prestadores.forEach(p => {
    const unidadesParaAlertar = (Array.isArray(p.unidadesAtendidas) && p.unidadesAtendidas.length > 0)
      ? p.unidadesAtendidas.map(u => u.quadraLote).filter(Boolean)
      : [p.quadraLote || 'Geral'];

    const unidadesUnicas = Array.from(new Set(unidadesParaAlertar));
    const classificacao = classificarVencimento(p.vencimentoFacial, ref);
    const prestadorComStatus = {
      ...p,
      analiseVencimento: classificacao
    };

    unidadesUnicas.forEach(qdLote => {
      let uni = unidadesMap.get(qdLote);
      if (!uni) {
        uni = {
          id: 'uni_' + qdLote.replace(/[^a-zA-Z0-9]/g, '_'),
          chavePrimaria: qdLote,
          quadra: '',
          lote: '',
          condominos: p.condominoResponsavel ? [{ nome: p.condominoResponsavel }] : [],
          prestadores: [],
          hasVencidos: false,
          hasHoje: false,
          hasAmanha: false,
          has7dias: false,
          has15dias: false,
          totalPrestadores: 0
        };
        unidadesMap.set(qdLote, uni);
      }

      uni.prestadores.push(prestadorComStatus);
      uni.totalPrestadores++;

      if (classificacao.status === 'VENCIDO') uni.hasVencidos = true;
      if (classificacao.status === 'HOJE') uni.hasHoje = true;
      if (classificacao.status === 'AMANHA') uni.hasAmanha = true;
      if (['HOJE', 'AMANHA', '7DIAS'].includes(classificacao.status)) uni.has7dias = true;
      if (classificacao.status === '15DIAS') uni.has15dias = true;
    });
  });

  const resultado = Array.from(unidadesMap.values())
    .filter(u => u.prestadores.length > 0)
    .map(u => {
      const pendencias = u.prestadores.filter(p => ['VENCIDO', 'HOJE', 'AMANHA', '7DIAS', '15DIAS'].includes(p.analiseVencimento.status));
      
      const condNome = u.condominos && u.condominos[0] ? u.condominos[0].nome : 'Prezado(a) Condômino(a)';
      let msg = `*Hamoa Resort Residencial - Controle de Acesso Facial*\n`;
      msg += `📍 *Unidade: ${u.chavePrimaria}*\n`;
      msg += `Olá, *${condNome}*!\n\n`;
      msg += `Identificamos que o(s) seguinte(s) colaborador(es) vinculado(s) à sua residência possuem atualização facial necessária:\n\n`;

      if (pendencias.length > 0) {
        pendencias.forEach(p => {
          const icone = p.analiseVencimento.status === 'VENCIDO' ? '🚨' : (p.analiseVencimento.status === 'HOJE' ? '⚡' : '⚠️');
          msg += `${icone} *${p.nome}* (${p.categoria})\n`;
          msg += `   • Validade Facial: *${p.vencimentoFacial || 'Não informada'}* (${p.analiseVencimento.label})\n`;
          if (p.observacoes && p.observacoes !== '-') {
            msg += `   • Obs: _${p.observacoes}_\n`;
          }
          msg += `\n`;
        });
        msg += `👉 *Como proceder:* Para evitar retenções ou bloqueios na portaria, favor providenciar a foto/documento atualizado respondendo a esta mensagem ou comparecendo à administração.\n\n`;
        msg += `_Administração & Segurança Hamoa_`;
      } else {
        msg += `Todos os seus prestadores cadastrados estão com acesso e biometria regularizados! ✅\n\n`;
        msg += `_Administração & Segurança Hamoa_`;
      }

      return {
        ...u,
        totalPendencias: pendencias.length,
        prestadoresPendentes: pendencias,
        mensagemWhatsApp: msg,
        linkWhatsApp: `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`
      };
    });

  return resultado.sort((a, b) => {
    if (a.hasHoje !== b.hasHoje) return a.hasHoje ? -1 : 1;
    if (a.hasVencidos !== b.hasVencidos) return a.hasVencidos ? -1 : 1;
    if (a.hasAmanha !== b.hasAmanha) return a.hasAmanha ? -1 : 1;
    if (a.has7dias !== b.has7dias) return a.has7dias ? -1 : 1;
    if (a.has15dias !== b.has15dias) return a.has15dias ? -1 : 1;
    return a.chavePrimaria.localeCompare(b.chavePrimaria);
  });
}

module.exports = {
  classificarVencimento,
  gerarAlertasConsolidados,
  parseDataBR,
  formatDataBR,
  normalizarMeiaNoite
};
