const { ensureLoggedIn } = require('./auth');
const { buildClassKeyboard, sessionKeyboard, termKeyboard, backToMenuKeyboard } = require('../keyboards/menus');
const { InlineKeyboard } = require('grammy');
const api   = require('../services/api');
const excel = require('../services/excel');

// Payment type stored in session so the class/session/term picker knows what to do
// after selection.

// ── Entry points ──────────────────────────────────────────────────────────────

async function startPaymentReport(ctx, type) {
  if (!await ensureLoggedIn(ctx)) return;

  ctx.session.paymentType    = type; // 'paid' | 'unpaid' | 'full'
  ctx.session._pendingAction = 'payment';

  const wait = await ctx.reply('🔄 Loading classes...');
  try {
    const classes = await api.getClasses(ctx.session.token);
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});

    if (!classes.length) {
      return ctx.reply('No classes found. Contact the admin.', { reply_markup: backToMenuKeyboard(ctx.session.role) });
    }

    ctx.session.state = 'PAYMENT_SELECT_CLASS';
    const title = type === 'paid' ? '💰 Paid Students'
      : type === 'unpaid' ? '❌ Unpaid Students'
      : '📋 Full Payment Report';

    await ctx.reply(
      `*${title}*\n\nSelect a class:`,
      { parse_mode: 'Markdown', reply_markup: buildClassKeyboard(classes) }
    );
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ ${err.response?.data?.message || err.message}`);
  }
}

// ── After class / session / term selected ─────────────────────────────────────

async function onTermSelectedForPayment(ctx, term) {
  ctx.session.term  = term;
  ctx.session.state = 'IDLE';
  await ctx.answerCallbackQuery('Fetching payment data...');

  try {
    await generateAndSendReport(ctx);
  } catch (err) {
    console.error('onTermSelectedForPayment error:', err.message);
    await ctx.reply(
      `❌ Unexpected error: ${err.message}`,
      { reply_markup: backToMenuKeyboard(ctx.session.role) }
    );
  }
}

// ── Core: fetch payments, filter, generate report ─────────────────────────────

async function generateAndSendReport(ctx) {
  const wait = await ctx.reply('⏳ Fetching payment data...');

  try {
    const allPayments = await api.getPaidStudents(ctx.session.token);

    // Filter by class and term/session
    const classId = ctx.session.classId;
    const session = ctx.session.session;
    const term    = ctx.session.term;
    const type    = ctx.session.paymentType;
    const className = ctx.session.className;

    // Payments for this class + session + term
    const filtered = allPayments.filter(p => {
      const matchClass   = p.class && (String(p.class._id || p.class) === classId || p.class?.name === className);
      const matchSession = !session || p.fee?.session === session || !p.fee?.session;
      const matchTerm    = !term    || p.fee?.term    === term    || !p.fee?.term;
      return matchClass && matchSession && matchTerm;
    });

    // For "unpaid": get all students in the class, subtract those who have paid
    let displayPayments = [];
    let title           = '';

    if (type === 'paid') {
      displayPayments = filtered.filter(p => (p.amountPaid || 0) > 0);
      title = `Paid Students — ${className} | ${term} | ${session}`;
    } else if (type === 'full') {
      displayPayments = filtered;
      title = `Full Payment Report — ${className} | ${term} | ${session}`;
    } else {
      // 'unpaid': fetch all students, subtract fully paid
      const students   = await api.getAllStudents(ctx.session.token, classId);
      const paidRegNos = new Set(
        filtered
          .filter(p => p.status === 'paid')
          .map(p => p.student?.registrationNumber)
          .filter(Boolean)
      );

      displayPayments = students
        .filter(s => !paidRegNos.has(s.registrationNumber))
        .map(s => ({
          student: { fullname: s.fullname, registrationNumber: s.registrationNumber },
          fee: { title: 'N/A', term, session },
          amountPaid: 0,
          balance: 0,
          status: 'not_paid',
        }));
      title = `Unpaid Students — ${className} | ${term} | ${session}`;
    }

    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});

    if (!displayPayments.length) {
      return ctx.reply(
        `ℹ️ No records found for *${title}*.`,
        { parse_mode: 'Markdown', reply_markup: backToMenuKeyboard(ctx.session.role) }
      );
    }

    // Send short summary in chat
    const summary = buildSummaryText(displayPayments, title, type);
    await ctx.reply(summary, { parse_mode: 'Markdown' });

    // Generate and send Excel
    const buffer   = await excel.generatePaymentReport({ payments: displayPayments, title });
    const fileName = title.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 60) + '.xlsx';

    await ctx.replyWithDocument(
      { source: buffer, filename: fileName },
      {
        caption: `📊 *${title}*\n${displayPayments.length} record(s)`,
        parse_mode: 'Markdown',
        reply_markup: backToMenuKeyboard(ctx.session.role),
      }
    );
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(
      `❌ Error: ${err.response?.data?.message || err.message}`,
      { reply_markup: backToMenuKeyboard(ctx.session.role) }
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSummaryText(payments, title, type) {
  const lines = [`📊 *${title}*\n`];
  const slice = payments.slice(0, 10);

  if (type === 'unpaid') {
    slice.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.student?.fullname || '—'} — ❌ Not Paid`);
    });
  } else {
    slice.forEach((p, i) => {
      const status  = p.status === 'paid' ? '✅' : p.status === 'partial' ? '⚠️' : '❌';
      const paid    = `₦${(p.amountPaid || 0).toLocaleString()}`;
      const balance = `₦${(p.balance || 0).toLocaleString()}`;
      lines.push(`${i + 1}. ${p.student?.fullname || '—'} — ${status} ${paid} (Bal: ${balance})`);
    });
  }

  if (payments.length > 10) {
    lines.push(`\n_...and ${payments.length - 10} more. See the Excel file below._`);
  }

  return lines.join('\n');
}

module.exports = { startPaymentReport, onTermSelectedForPayment };
