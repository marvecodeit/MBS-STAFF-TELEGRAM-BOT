const axios = require('axios');

/**
 * Extract the spreadsheet file ID from a Google Sheets URL.
 * Supports: /d/<ID>/edit, /d/<ID>/view, /d/<ID>
 */
function extractFileId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (!match) {
    throw new Error(
      'Invalid Google Sheets URL.\n\n' +
      'Make sure you copy the full link from your browser, e.g.:\n' +
      'https://docs.google.com/spreadsheets/d/ABC123.../edit'
    );
  }
  return match[1];
}

/**
 * Download a Google Sheet as an xlsx buffer.
 * The sheet MUST be shared as "Anyone with the link can view".
 */
async function fetchSheetAsBuffer(url) {
  const fileId    = extractFileId(url);
  const exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`;

  let response;
  try {
    response = await axios.get(exportUrl, {
      responseType: 'arraybuffer',
      timeout:      30_000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
  } catch (err) {
    const status = err.response?.status;

    if (status === 401 || status === 403) {
      throw new Error(
        '🔒 Access denied to this Google Sheet.\n\n' +
        'Please make it publicly viewable:\n' +
        '1. Open the sheet → Share → Change to "Anyone with the link"\n' +
        '2. Set role to "Viewer"\n' +
        '3. Copy the link and send it again.'
      );
    }

    if (status === 404) {
      throw new Error('The Google Sheet was not found. Check that the link is correct.');
    }

    throw new Error(`Could not download the sheet: ${err.message}`);
  }

  if (!response.data || response.data.byteLength < 100) {
    throw new Error('Downloaded file appears empty. Make sure the Google Sheet has data.');
  }

  return Buffer.from(response.data);
}

module.exports = { fetchSheetAsBuffer };
