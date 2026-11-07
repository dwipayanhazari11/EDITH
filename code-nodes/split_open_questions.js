/**
 * EDITH Open Questions Splitter
 * Flattens the open_questions_rows array into discrete items for Google Sheets batch append.
 */
const first = $('Prepare Sheets Payload').first()?.json || {};
const rows = first.open_questions_rows || [];

return rows.map(row => ({
  json: row
}));
