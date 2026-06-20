const axios = require('axios');
const { ensureLoggedIn } = require('./auth');
const {
  mainMenuTeacher, termKeyboard, sessionKeyboard,
  uploadMethodKeyboard, cancelKeyboard, buildClassKeyboard, backToMenuKeyboard,
} = require('../keyboards/menus');
const api   = require('../services/api');
const excel = require('../services/excel');
const sheets = require('../services/sheets');

// ── Get Result Template ───────────────────────────────────────────────────────

async function startTemplate(ctx) {
  if (!await ensureLoggedIn(ctx)) return;

  const wait = await ctx.reply('🔄 Loading your classes...');
  try {
    const classes = await api.getMyClasses(ctx.session.token);
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});

    if (!classes.length) {
      return ctx.reply(
        'No classes found for your account. Please contact the admin.',
        { reply_markup: backToMenuKeyboard('teacher') }
      );
    }

    ctx.session.state         = 'TEMPLATE_SELECT_CLASS';
    ctx.session._pendingAction = 'template';

    await ctx.reply(
      '📚 *Select a class to generate the template for:*',
      { parse_mode: 'Markdown', reply_markup: buildClassKeyboard(classes) }
    );
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ Error loading classes: ${err.response?.data?.message || err.message}`);
  }
}

async function onClassSelected(ctx, classId, className) {
  ctx.session.classId   = classId;
  ctx.session.className = className;
  await ctx.answerCallbackQuery();

  if (ctx.session._pendingAction === 'template') {
    ctx.session.state = 'TEMPLATE_SELECT_SESSION';
  } else if (ctx.session._pendingAction === 'upload') {
    ctx.session.state = 'UPLOAD_SELECT_SESSION';
  } else if (ctx.session._pendingAction === 'payment') {
    ctx.session.state = 'PAYMENT_SELECT_SESSION';
  }

  await ctx.editMessageText(
    `✅ Class: *${className}*\n\nSelect the academic session:`,
    { parse_mode: 'Markdown', reply_markup: sessionKeyboard }
  );
}

async function onSessionSelected(ctx, session) {
  ctx.session.session = session;
  await ctx.answerCallbackQuery();

  const action = ctx.session._pendingAction;
  ctx.session.state = action === 'template' ? 'TEMPLATE_SELECT_TERM'
    : action === 'payment' ? 'PAYMENT_SELECT_TERM'
    : 'UPLOAD_SELECT_TERM';

  await ctx.editMessageText(
    `✅ Session: *${session}*\n\nSelect the term:`,
    { parse_mode: 'Markdown', reply_markup: termKeyboard }
  );
}

async function onTermSelectedForTemplate(ctx, term) {
  ctx.session.term  = term;
  ctx.session.state = 'IDLE';
  await ctx.answerCallbackQuery('Generating template...');

  const wait = await ctx.reply('⏳ Fetching student list and generating template...');
  try {
    const { className, students } = await api.getClassStudents(ctx.session.token, ctx.session.classId);

    if (!students.length) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      return ctx.reply(
        '⚠️ No students found in this class.',
        { reply_markup: backToMenuKeyboard('teacher') }
      );
    }

    // Fetch class subjects from classes list
    let subjects = [];
    try {
      const classes = await api.getClasses(ctx.session.token);
      const cls = classes.find(c => String(c._id) === String(ctx.session.classId));
      subjects  = cls?.subjects?.map(s => (typeof s === 'string' ? s : s.name || s.subjectName)) || [];
      subjects  = subjects.filter(Boolean);
    } catch (_) {}

    const buffer = await excel.generateTemplate({
      students,
      className: className || ctx.session.className,
      classId:   ctx.session.classId,
      session:   ctx.session.session,
      term:      ctx.session.term,
      subjects,
    });

    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});

    const safeClass = (className || ctx.session.className).replace(/[^a-zA-Z0-9]/g, '_');
    const fileName  = `Results_Template_${safeClass}_${term.replace(/\s+/g, '_')}.xlsx`;

    await ctx.replyWithDocument(
      { source: buffer, filename: fileName },
      {
        caption:
          `📄 *Result Template*\n` +
          `🏫 Class: ${className || ctx.session.className}\n` +
          `📅 Term: ${term} | Session: ${ctx.session.session}\n` +
          `👥 Students: ${students.length}\n\n` +
          `Fill in the *yellow score columns* and send the file back to upload results.`,
        parse_mode: 'Markdown',
        reply_markup: backToMenuKeyboard('teacher'),
      }
    );
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(
      `❌ Failed to generate template: ${err.response?.data?.message || err.message}`,
      { reply_markup: backToMenuKeyboard('teacher') }
    );
  }
}

// ── Upload Result ─────────────────────────────────────────────────────────────

async function startUpload(ctx) {
  if (!await ensureLoggedIn(ctx)) return;

  const wait = await ctx.reply('🔄 Loading your classes...');
  try {
    const classes = await api.getMyClasses(ctx.session.token);
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});

    if (!classes.length) {
      return ctx.reply('No classes found. Contact the admin.', { reply_markup: backToMenuKeyboard('teacher') });
    }

    ctx.session.state         = 'UPLOAD_SELECT_CLASS';
    ctx.session._pendingAction = 'upload';

    await ctx.reply(
      '📤 *Upload Result — Step 1/4*\n\nSelect the class:',
      { parse_mode: 'Markdown', reply_markup: buildClassKeyboard(classes) }
    );
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ Error: ${err.response?.data?.message || err.message}`);
  }
}

async function onTermSelectedForUpload(ctx, term) {
  ctx.session.term  = term;
  ctx.session.state = 'AWAIT_UPLOAD_METHOD';
  await ctx.answerCallbackQuery();

  await ctx.editMessageText(
    `✅ *Upload Configuration*\n\n` +
    `📚 Class: *${ctx.session.className}*\n` +
    `📅 Term: *${term}*\n` +
    `🗓 Session: *${ctx.session.session}*\n\n` +
    `How do you want to provide the filled result file?`,
    { parse_mode: 'Markdown', reply_markup: uploadMethodKeyboard }
  );
}

async function onUploadMethodSelected(ctx, method) {
  ctx.session.uploadMode = method;
  await ctx.answerCallbackQuery();

  if (method === 'file') {
    ctx.session.state = 'AWAIT_EXCEL_FILE';
    await ctx.editMessageText(
      '📎 *Send the filled Excel file now.*\n\n' +
      'Make sure you saved it after filling in the scores.',
      { parse_mode: 'Markdown', reply_markup: cancelKeyboard }
    );
  } else {
    ctx.session.state = 'AWAIT_SHEETS_LINK';
    await ctx.editMessageText(
      '🔗 *Send the Google Sheets link.*\n\n' +
      '⚠️ The sheet must be set to "Anyone with the link can view".',
      { parse_mode: 'Markdown', reply_markup: cancelKeyboard }
    );
  }
}

// ── Process uploaded Excel file ───────────────────────────────────────────────

async function handleExcelFile(ctx) {
  if (!await ensureLoggedIn(ctx)) return;
  if (ctx.session.state !== 'AWAIT_EXCEL_FILE') return;

  const doc = ctx.message.document;
  const name = doc.file_name || '';

  if (!name.match(/\.(xlsx|xls)$/i)) {
    return ctx.reply('Please send an Excel file (.xlsx or .xls).');
  }

  await processUpload(ctx, async () => {
    const fileUrl  = await ctx.api.getFile(doc.file_id);
    const fullUrl  = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileUrl.file_path}`;
    const response = await axios.get(fullUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  }, name);
}

// ── Process Google Sheets link ────────────────────────────────────────────────

async function handleSheetsLink(ctx) {
  if (!await ensureLoggedIn(ctx)) return;
  if (ctx.session.state !== 'AWAIT_SHEETS_LINK') return;

  const url = ctx.message.text.trim();
  if (!url.includes('docs.google.com/spreadsheets')) {
    return ctx.reply(
      '❌ That doesn\'t look like a Google Sheets link.\n\n' +
      'Please send a link like:\nhttps://docs.google.com/spreadsheets/d/...'
    );
  }

  await processUpload(ctx, () => sheets.fetchSheetAsBuffer(url), 'results_from_sheets.xlsx');
}

// ── Shared upload processor ───────────────────────────────────────────────────

async function processUpload(ctx, getBuffer, originalName) {
  const wait = await ctx.reply('⏳ Processing and uploading results...');

  try {
    const rawBuffer = await getBuffer();

    // Clean the Excel (strips Student Name column, validates structure)
    const { buffer, preview, subjectCount } = await excel.cleanResultsExcel(rawBuffer);

    // POST to backend
    const result = await api.uploadResults(
      ctx.session.token,
      buffer,
      originalName.replace(/\.(xls)$/i, '.xlsx'),
      ctx.session.classId,
      ctx.session.term,
      ctx.session.session
    );

    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});

    // Build preview text (top 5 students)
    const previewText = preview.slice(0, 5).map((s, i) =>
      `${i + 1}. ${s.name} — Total: ${s.total} | Avg: ${s.avg} | Grade: ${s.grade}`
    ).join('\n');

    ctx.session.state = 'IDLE';

    await ctx.reply(
      `✅ *Results Uploaded Successfully!*\n\n` +
      `📚 Class: ${ctx.session.className}\n` +
      `📅 Term: ${ctx.session.term} | Session: ${ctx.session.session}\n` +
      `👥 Students: ${preview.length} | Subjects: ${subjectCount}\n\n` +
      (previewText ? `*Preview (first 5):*\n${previewText}\n` : '') +
      (result.message ? `\n_${result.message}_` : ''),
      { parse_mode: 'Markdown', reply_markup: backToMenuKeyboard('teacher') }
    );
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    ctx.session.state = 'IDLE';

    await ctx.reply(
      `❌ *Upload failed*\n\n${err.response?.data?.message || err.message}`,
      { parse_mode: 'Markdown', reply_markup: backToMenuKeyboard('teacher') }
    );
  }
}

// ── Show teacher's class list ─────────────────────────────────────────────────

async function showMyClasses(ctx) {
  if (!await ensureLoggedIn(ctx)) return;

  const wait = await ctx.reply('🔄 Loading...');
  try {
    const classes = await api.getMyClasses(ctx.session.token);
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});

    if (!classes.length) {
      return ctx.reply('No classes assigned to your account.', { reply_markup: backToMenuKeyboard('teacher') });
    }

    const list = classes.map((c, i) => `${i + 1}. *${c.name}*`).join('\n');
    await ctx.reply(
      `📊 *Your Classes (${classes.length})*\n\n${list}`,
      { parse_mode: 'Markdown', reply_markup: backToMenuKeyboard('teacher') }
    );
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ ${err.response?.data?.message || err.message}`, { reply_markup: backToMenuKeyboard('teacher') });
  }
}

module.exports = {
  startTemplate,
  startUpload,
  showMyClasses,
  onClassSelected,
  onSessionSelected,
  onTermSelectedForTemplate,
  onTermSelectedForUpload,
  onUploadMethodSelected,
  handleExcelFile,
  handleSheetsLink,
};
