require('dotenv').config();

const { Bot, session } = require('grammy');

const { handleStart, handleEmail, handlePassword, STAFF_ROLES } = require('./handlers/auth');
const {
  startTemplate, startUpload, showMyClasses,
  onClassSelected, onSessionSelected,
  onTermSelectedForTemplate, onTermSelectedForUpload, onUploadMethodSelected,
  handleExcelFile, handleSheetsLink,
} = require('./handlers/results');
const { startPaymentReport, onTermSelectedForPayment } = require('./handlers/payments');
const { mainMenuTeacher, mainMenuStaff } = require('./keyboards/menus');

// ─────────────────────────────────────────────────────────────────────────────
// Bot bootstrap
// ─────────────────────────────────────────────────────────────────────────────

if (!process.env.BOT_TOKEN) {
  console.error('BOT_TOKEN is not set in .env');
  process.exit(1);
}

const bot = new Bot(process.env.BOT_TOKEN);

// In-memory session storage (per chat)
bot.use(session({
  initial: () => ({
    token: null, role: null, user: null,
    email: null,
    state: 'IDLE',
    classId: null, className: null,
    session: null, term: null,
    uploadMode: null, paymentType: null,
    _pendingAction: null,
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

bot.command('start',  handleStart);
bot.command('logout', async ctx => {
  ctx.session = { token: null, role: null, user: null, state: 'AWAIT_EMAIL' };
  await ctx.reply('👋 Logged out. Send /start to log in again.');
});

bot.command('menu', async ctx => {
  if (!ctx.session?.token) return handleStart(ctx);
  const role = ctx.session.role;
  if (role === 'teacher') {
    await ctx.reply('📋 *Main Menu*', { parse_mode: 'Markdown', reply_markup: mainMenuTeacher });
  } else if (STAFF_ROLES.has(role)) {
    await ctx.reply('📋 *Main Menu*', { parse_mode: 'Markdown', reply_markup: mainMenuStaff });
  } else {
    await ctx.reply('Use /start to log in.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Callback query router
// ─────────────────────────────────────────────────────────────────────────────

bot.on('callback_query:data', async ctx => {
  const data = ctx.callbackQuery.data;

  // ── Navigation ─────────────────────────────────────────────────────────────
  if (data === 'action:cancel') {
    ctx.session.state = 'IDLE';
    await ctx.answerCallbackQuery('Cancelled');
    await ctx.editMessageText('❌ Action cancelled. Use /menu to start again.').catch(() => {});
    return;
  }

  if (data === 'action:logout') {
    const name = ctx.session.user?.fullname || ctx.from.first_name;
    ctx.session = { token: null, role: null, user: null, state: 'AWAIT_EMAIL' };
    await ctx.answerCallbackQuery('Logged out');
    await ctx.editMessageText(
      `👋 Goodbye, *${name}*! You have been logged out.\n\nSend /start to log in again.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (data === 'goto:teacher_menu') {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('📋 *Main Menu*', { parse_mode: 'Markdown', reply_markup: mainMenuTeacher });
    return;
  }

  if (data === 'goto:staff_menu') {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('📋 *Main Menu*', { parse_mode: 'Markdown', reply_markup: mainMenuStaff });
    return;
  }

  // ── Teacher actions ────────────────────────────────────────────────────────
  if (data === 'action:template') { await ctx.answerCallbackQuery(); return startTemplate(ctx); }
  if (data === 'action:upload')   { await ctx.answerCallbackQuery(); return startUpload(ctx); }
  if (data === 'action:classes')  { await ctx.answerCallbackQuery(); return showMyClasses(ctx); }

  // ── Staff / payment actions ────────────────────────────────────────────────
  if (data === 'action:payment:paid')   { await ctx.answerCallbackQuery(); return startPaymentReport(ctx, 'paid'); }
  if (data === 'action:payment:unpaid') { await ctx.answerCallbackQuery(); return startPaymentReport(ctx, 'unpaid'); }
  if (data === 'action:payment:full')   { await ctx.answerCallbackQuery(); return startPaymentReport(ctx, 'full'); }

  // ── Class selection ────────────────────────────────────────────────────────
  if (data.startsWith('class:')) {
    const [, classId, ...rest] = data.split(':');
    const className = rest.join(':'); // rejoin in case name had colons
    return onClassSelected(ctx, classId, className);
  }

  // ── Session selection ──────────────────────────────────────────────────────
  if (data.startsWith('sess:')) {
    const sess = data.slice('sess:'.length);
    return onSessionSelected(ctx, sess);
  }

  // ── Term selection ─────────────────────────────────────────────────────────
  if (data.startsWith('term:')) {
    const term  = data.slice('term:'.length);
    const state = ctx.session.state;
    // Route by state — more reliable than _pendingAction across async hops
    if (state === 'TEMPLATE_SELECT_TERM') return onTermSelectedForTemplate(ctx, term);
    if (state === 'UPLOAD_SELECT_TERM')   return onTermSelectedForUpload(ctx, term);
    if (state === 'PAYMENT_SELECT_TERM')  return onTermSelectedForPayment(ctx, term);
    // Fallback: use _pendingAction if state wasn't set properly
    const action = ctx.session._pendingAction;
    if (action === 'template') return onTermSelectedForTemplate(ctx, term);
    if (action === 'upload')   return onTermSelectedForUpload(ctx, term);
    if (action === 'payment')  return onTermSelectedForPayment(ctx, term);
    await ctx.answerCallbackQuery('Please start again with /menu');
    return;
  }

  // ── Upload method selection ────────────────────────────────────────────────
  if (data.startsWith('upload:')) {
    const method = data.slice('upload:'.length); // 'file' | 'link'
    return onUploadMethodSelected(ctx, method);
  }

  await ctx.answerCallbackQuery('Unknown action');
});

// ─────────────────────────────────────────────────────────────────────────────
// Message router — drives the multi-step conversation state machine
// ─────────────────────────────────────────────────────────────────────────────

bot.on('message', async ctx => {
  const state = ctx.session?.state || 'IDLE';

  // ── Auth states ────────────────────────────────────────────────────────────
  if (state === 'AWAIT_EMAIL' && ctx.message.text) {
    return handleEmail(ctx);
  }

  if (state === 'AWAIT_PASSWORD' && ctx.message.text) {
    return handlePassword(ctx);
  }

  // ── Upload via Excel file ──────────────────────────────────────────────────
  if (state === 'AWAIT_EXCEL_FILE' && ctx.message.document) {
    return handleExcelFile(ctx);
  }

  // Received text instead of file
  if (state === 'AWAIT_EXCEL_FILE' && ctx.message.text) {
    return ctx.reply('Please send the Excel file (.xlsx). Use /menu to cancel.');
  }

  // ── Upload via Google Sheets link ──────────────────────────────────────────
  if (state === 'AWAIT_SHEETS_LINK' && ctx.message.text) {
    return handleSheetsLink(ctx);
  }

  // ── Catch-all for idle users ───────────────────────────────────────────────
  if (!ctx.session?.token) {
    ctx.session.state = 'AWAIT_EMAIL';
    return ctx.reply('Please send your email to log in:');
  }

  // Already logged in — show menu
  const role = ctx.session.role;
  const menu = role === 'teacher' ? mainMenuTeacher : STAFF_ROLES.has(role) ? mainMenuStaff : null;

  if (menu) {
    await ctx.reply('Use the menu below or type /menu:', { reply_markup: menu });
  } else {
    await ctx.reply('Use /menu to see available options.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler
// ─────────────────────────────────────────────────────────────────────────────

bot.catch(err => {
  const ctx = err.ctx;
  console.error(`Error handling update ${ctx?.update?.update_id}:`, err.error);
  ctx?.reply('⚠️ Something went wrong. Please try again or use /menu.').catch(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP server — webhook receiver + health check
// ─────────────────────────────────────────────────────────────────────────────

const http = require('http');
const { webhookCallback } = require('grammy');

const PORT         = process.env.PORT || 3000;
const WEBHOOK_URL  = process.env.WEBHOOK_URL || 'https://mbs-staff-telegram-bot-1.onrender.com';
const WEBHOOK_PATH = '/webhook';

const handleUpdate = webhookCallback(bot, 'http');

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === WEBHOOK_PATH) {
    try {
      await handleUpdate(req, res);
    } catch (err) {
      console.error('Webhook error:', err.message);
      res.writeHead(500).end();
    }
  } else {
    // Health check for all other routes
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('MBS Bot is running ✅');
  }
});

server.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  try {
    await bot.api.setWebhook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);
    console.log(`✅ Webhook set → ${WEBHOOK_URL}${WEBHOOK_PATH}`);
  } catch (err) {
    console.error('Failed to set webhook:', err.message);
  }
});
