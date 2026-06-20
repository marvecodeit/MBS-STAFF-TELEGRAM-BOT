const { InlineKeyboard } = require('grammy');

// ── Role menus ─────────────────────────────────────────────────────────────────
const mainMenuTeacher = new InlineKeyboard()
  .text('📥 Get Result Template', 'action:template').row()
  .text('📤 Upload Result',       'action:upload').row()
  .text('📊 My Classes',          'action:classes').row()
  .text('🚪 Log Out',             'action:logout');

const mainMenuStaff = new InlineKeyboard()
  .text('💰 Students Who Have Paid',     'action:payment:paid').row()
  .text('❌ Students Who Have NOT Paid', 'action:payment:unpaid').row()
  .text('📋 Full Payment Report',        'action:payment:full').row()
  .text('🚪 Log Out',                    'action:logout');

// ── Selection keyboards ────────────────────────────────────────────────────────
const termKeyboard = new InlineKeyboard()
  .text('First Term',  'term:First Term').row()
  .text('Second Term', 'term:Second Term').row()
  .text('Third Term',  'term:Third Term').row()
  .text('❌ Cancel',   'action:cancel');

const sessionKeyboard = new InlineKeyboard()
  .text('2023/2024', 'sess:2023/2024').row()
  .text('2024/2025', 'sess:2024/2025').row()
  .text('2025/2026', 'sess:2025/2026').row()
  .text('2026/2027', 'sess:2026/2027').row()
  .text('❌ Cancel',  'action:cancel');

const uploadMethodKeyboard = new InlineKeyboard()
  .text('📎 Send Excel File',     'upload:file').row()
  .text('🔗 Google Sheets Link',  'upload:link').row()
  .text('❌ Cancel',              'action:cancel');

const cancelKeyboard = new InlineKeyboard()
  .text('❌ Cancel', 'action:cancel');

// ── Dynamic keyboards ──────────────────────────────────────────────────────────

/**
 * Build an inline keyboard from a list of classes.
 * Callback data: class:<_id>:<name> (name encoded for display on next step)
 */
function buildClassKeyboard(classes) {
  const kb = new InlineKeyboard();
  classes.forEach(cls => {
    // Keep callback data under 64 bytes: class: + 24-char id + :name (truncated)
    const safeName = (cls.name || '').slice(0, 20);
    kb.text(cls.name, `class:${cls._id}:${safeName}`).row();
  });
  kb.text('❌ Cancel', 'action:cancel');
  return kb;
}

/**
 * Back-to-menu keyboard after an action completes
 */
function backToMenuKeyboard(role) {
  const isTeacher = role === 'teacher';
  return new InlineKeyboard()
    .text('🏠 Back to Menu', isTeacher ? 'goto:teacher_menu' : 'goto:staff_menu')
    .text('🚪 Log Out', 'action:logout');
}

module.exports = {
  mainMenuTeacher,
  mainMenuStaff,
  termKeyboard,
  sessionKeyboard,
  uploadMethodKeyboard,
  cancelKeyboard,
  buildClassKeyboard,
  backToMenuKeyboard,
};
