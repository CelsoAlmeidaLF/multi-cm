import { Shift } from '../../domain/entities/Shift.js';
import { from } from '../../stk-pkt-linq.js';

/**
 * Serviço de Aplicação: Gestão e Conferência de Turnos de Caixa
 */
export class ShiftService {
  getActiveShift(database) {
    return from(database.turnosCaixa).firstOrDefault(t => t.status === 'aberto', null);
  }

  calculateShiftTotals(database, shift) {
    if (!shift) return null;
    const qMovements = from(database.caixa).where(c => c.turnoId === shift.id);

    const entradas = Math.round((qMovements.where(c => c.tipo === 'entrada').sum(c => Number(c.valor || 0)) + Number.EPSILON) * 100) / 100;
    const saidas = Math.round((qMovements.where(c => c.tipo === 'saida').sum(c => Number(c.valor || 0)) + Number.EPSILON) * 100) / 100;
    const cashIn = Math.round((qMovements.where(c => c.tipo === 'entrada' && c.formaPagamento === 'dinheiro').sum(c => Number(c.valor || 0)) + Number.EPSILON) * 100) / 100;
    const cashOut = Math.round((qMovements.where(c => c.tipo === 'saida').sum(c => Number(c.valor || 0)) + Number.EPSILON) * 100) / 100;
    const esperado = Math.round((shift.fundoInicial + cashIn - cashOut + Number.EPSILON) * 100) / 100;

    return {
      entradas,
      saidas,
      cashIn,
      cashOut,
      esperado
    };
  }

  openShift(database, fundoinicial, operador) {
    const existing = this.getActiveShift(database);
    if (existing) throw new Error('Já existe um turno aberto no momento.');

    const fundo = Math.round((Number(fundoinicial) + Number.EPSILON) * 100) / 100;
    if (!Number.isFinite(fundo) || fundo < 0) throw new Error('Fundo inicial inválido.');

    const shift = new Shift({
      status: 'aberto',
      operador: operador || 'Sistema',
      fundoInicial: fundo
    });
    shift.validate();
    (database.turnosCaixa ||= []).push(shift.toJSON());
    return shift.toJSON();
  }

  closeShift(database, contado, operador, observacoes = '') {
    const shift = this.getActiveShift(database);
    if (!shift) throw new Error('Nenhum turno aberto para fechar.');

    const count = Math.round((Number(contado) + Number.EPSILON) * 100) / 100;
    if (!Number.isFinite(count) || count < 0) throw new Error('Valor contado inválido.');

    const totals = this.calculateShiftTotals(database, shift);
    shift.esperado = totals.esperado;
    shift.contado = count;
    shift.diferenca = Math.round((count - totals.esperado + Number.EPSILON) * 100) / 100;
    shift.status = 'fechado';
    shift.fechadoEm = new Date().toISOString();
    shift.fechadoPor = operador;
    shift.observacoes = String(observacoes || '');
    return shift;
  }

  getClosingSummary(database, tipo = 'diario', ref = null) {
    const now = new Date();
    const prefix = tipo === 'mensal'
      ? (ref || now.toISOString().slice(0, 7))
      : (ref || now.toISOString().slice(0, 10));

    const localDay = d => {
      const dt = new Date(d);
      return Number.isNaN(dt.getTime()) ? '' : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };
    const localMonth = d => {
      const dt = new Date(d);
      return Number.isNaN(dt.getTime()) ? '' : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    };

    const qMovements = from(database.caixa).where(c => {
      if (!c.data) return false;
      if (c.data.startsWith(prefix)) return true;
      if (tipo === 'mensal') return localMonth(c.data) === prefix;
      return localDay(c.data) === prefix;
    });

    const qEntradas = qMovements.where(c => c.tipo === 'entrada');
    const qSaidas = qMovements.where(c => c.tipo === 'saida');

    const totalVendas = Math.round((qEntradas.sum(c => Number(c.valor || 0)) + Number.EPSILON) * 100) / 100;
    const totalSaidas = Math.round((qSaidas.sum(c => Number(c.valor || 0)) + Number.EPSILON) * 100) / 100;

    const dinheiro = Math.round((qEntradas.where(c => c.formaPagamento === 'dinheiro').sum(c => Number(c.valor || 0)) + Number.EPSILON) * 100) / 100;
    const pix = Math.round((qEntradas.where(c => c.formaPagamento === 'pix').sum(c => Number(c.valor || 0)) + Number.EPSILON) * 100) / 100;
    const debito = Math.round((qEntradas.where(c => c.formaPagamento === 'debito').sum(c => Number(c.valor || 0)) + Number.EPSILON) * 100) / 100;
    const credito = Math.round((qEntradas.where(c => c.formaPagamento === 'credito').sum(c => Number(c.valor || 0)) + Number.EPSILON) * 100) / 100;
    const outros = Math.round((qEntradas.where(c => !['dinheiro', 'pix', 'debito', 'credito'].includes(c.formaPagamento)).sum(c => Number(c.valor || 0)) + Number.EPSILON) * 100) / 100;

    const activeShift = this.getActiveShift(database);
    const fundoInicial = activeShift ? Number(activeShift.fundoInicial || 0) : 0;
    const saidasDinheiro = Math.round((qSaidas.sum(c => Number(c.valor || 0)) + Number.EPSILON) * 100) / 100;
    const dinheiroEsperado = Math.round((fundoInicial + dinheiro - saidasDinheiro + Number.EPSILON) * 100) / 100;

    return {
      tipo,
      referencia: prefix,
      totalVendas,
      totalSaidas,
      saldoLiquido: Math.round((totalVendas - totalSaidas + Number.EPSILON) * 100) / 100,
      quantidadeVendas: qEntradas.count(),
      quantidadeSaidas: qSaidas.count(),
      pagamentos: { dinheiro, pix, debito, credito, outros },
      fundoInicial,
      dinheiroEsperado,
      hasActiveShift: !!activeShift
    };
  }

  closeDailyCash(database, contado, operador, observacoes = '') {
    const summary = this.getClosingSummary(database, 'diario');
    const count = Math.round((Number(contado) + Number.EPSILON) * 100) / 100;
    if (!Number.isFinite(count) || count < 0) throw new Error('Valor contado em dinheiro inválido.');

    const activeShift = this.getActiveShift(database);
    let shiftFechado = null;
    if (activeShift) {
      shiftFechado = this.closeShift(database, count, operador, observacoes);
    }

    const diferenca = Math.round((count - summary.dinheiroEsperado + Number.EPSILON) * 100) / 100;
    const record = {
      id: `FECH-DIA-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
      tipo: 'diario',
      dataReferencia: summary.referencia,
      fechadoEm: new Date().toISOString(),
      operador: operador || 'Sistema',
      totalVendas: summary.totalVendas,
      totalSaidas: summary.totalSaidas,
      saldoLiquido: summary.saldoLiquido,
      pagamentos: summary.pagamentos,
      fundoInicial: summary.fundoInicial,
      dinheiroEsperado: summary.dinheiroEsperado,
      dinheiroContado: count,
      diferenca,
      observacoes: String(observacoes || ''),
      turnoId: shiftFechado?.id || null
    };

    (database.fechamentosCaixa ||= []).unshift(record);
    return record;
  }

  closeMonthlyCash(database, operador, mesRef = null, observacoes = '') {
    const summary = this.getClosingSummary(database, 'mensal', mesRef);
    const record = {
      id: `FECH-MES-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
      tipo: 'mensal',
      mesReferencia: summary.referencia,
      fechadoEm: new Date().toISOString(),
      operador: operador || 'Sistema',
      totalVendas: summary.totalVendas,
      totalSaidas: summary.totalSaidas,
      saldoLiquido: summary.saldoLiquido,
      quantidadeVendas: summary.quantidadeVendas,
      pagamentos: summary.pagamentos,
      observacoes: String(observacoes || '')
    };

    (database.fechamentosCaixa ||= []).unshift(record);
    return record;
  }
}
