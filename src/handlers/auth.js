const { mainMenuTeacher, mainMenuStaff } = require('../keyboards/menus');
const api = require('../services/api');

const STAFF_ROLES = new Set(['hoa', 'secretary', 'bursar', 'admin', 'principal']);

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: /start — ask for email
// ─────────────────────────────────────────────────────────────────────────────
async function handleStart(ctx) {
  ctx.session = {
    token: null, role: null, user: null,
    state: 'AWAIT_EMAIL',
    classId: null, className: null,
    session: null, term: null,
    uploadMode: null, paymentType: null,
  };

  await ctx.reply(
    '👋 *Welcome to the School Management Bot!*\n\n' +
    'Please enter your school email address to log in:',
    { parse_mode: 'Markdown' }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Email received → ask for password
// ─────────────────────────────────────────────────────────────────────────────
async function handleEmail(ctx) {
  const email = ctx.message.text.trim();

  if (!email.includes('@')) {
    return ctx.reply('That doesn\'t look like a valid email. Please enter your email address:');
  }

  ctx.session.email = email;
  ctx.session.state = 'AWAIT_PASSWORD';

  await ctx.reply('🔐 Enter your password:');
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Password received → attempt login
// ─────────────────────────────────────────────────────────────────────────────
async function handlePassword(ctx) {
  const password = ctx.message.text.trim();

  // Delete the password message immediately for security
  try { await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id); } catch (_) {}

  const waitMsg = await ctx.reply('🔄 Logging you in...');

  try {
    const result = await api.login(ctx.session.email, password);

    if (!result.success || !result.token) {
      throw new Error(result.message || 'Invalid credentials');
    }

    const role = (result.user?.role || '').toLowerCase();
    ctx.session.token = result.token;
    ctx.session.role  = role;
    ctx.session.user  = result.user;
    ctx.session.state = 'IDLE';
    delete ctx.session.email;

    await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

    const name    = result.user?.fullname || result.user?.name || ctx.from.first_name;
    const roleTag = role.toUpperCase();

    if (role === 'teacher') {
      await ctx.reply(
        `✅ *Login successful!*\n\nWelcome, *${name}* (${roleTag})\n\nWhat would you like to do?`,
        { parse_mode: 'Markdown', reply_markup: mainMenuTeacher }
      );
    } else if (STAFF_ROLES.has(role)) {
      await ctx.reply(
        `✅ *Login successful!*\n\nWelcome, *${name}* (${roleTag})\n\nWhat would you like to do?`,
        { parse_mode: 'Markdown', reply_markup: mainMenuStaff }
      );
    } else {
      // Developer or unsupported role — just confirm login
      await ctx.reply(
        `✅ Logged in as *${name}* (${roleTag}).\n\n` +
        'This bot is designed for Teachers and Staff (HOA, Secretary, Bursar). ' +
        'Your role does not have any available actions here.',
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

    const msg = err.response?.data?.message || err.message || 'Login failed.';
    ctx.session.state = 'AWAIT_EMAIL';
    delete ctx.session.email;

    await ctx.reply(
      `❌ *Login failed:* ${msg}\n\nPlease send your email to try again:`,
      { parse_mode: 'Markdown' }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: ensure user is logged in, redirect to login if not
// ─────────────────────────────────────────────────────────────────────────────
async function ensureLoggedIn(ctx) {
  if (!ctx.session?.token) {
    ctx.session = ctx.session || {};
    ctx.session.state = 'AWAIT_EMAIL';
    await ctx.reply('You are not logged in. Please enter your email to log in:');
    return false;
  }
  return true;
}

module.exports = { handleStart, handleEmail, handlePassword, ensureLoggedIn, STAFF_ROLES };
