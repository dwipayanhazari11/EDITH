/**
 * EDITH Action Items Splitter
 * Flattens the action_items_rows array into discrete items for Google Sheets batch append.
 */
const first = $input.first()?.json || {};
const rows = first.action_items_rows || [];

return rows.map(row => ({
  json: row
}));
