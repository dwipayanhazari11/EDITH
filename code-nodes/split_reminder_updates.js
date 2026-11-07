/**
 * EDITH Split Reminder Updates (code-nodes/split_reminder_updates.js)
 * 
 * Flattens tasks_to_update array into individual items for Google Sheets batch appendOrUpdate.
 */

const items = $input.all();
const results = [];

for (const item of items) {
  const rows = item.json.tasks_to_update || [];
  for (const r of rows) {
    results.push({ json: r });
  }
}

if (results.length === 0) {
  try {
    const first = $('Evaluate Staged Reminders').first()?.json || {};
    const rows = first.tasks_to_update || [];
    return rows.map(r => ({ json: r }));
  } catch (e) {
    return [];
  }
}

return results;
