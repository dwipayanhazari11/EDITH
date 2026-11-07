/**
 * EDITH Split Reminder Dispatches (code-nodes/split_reminder_dispatches.js)
 * 
 * Flattens array of personal reminder messages into individual items
 * for the Telegram node to send to each respective member DM or group.
 */

const items = $input.all();
const results = [];

for (const item of items) {
  const dispatches = item.json.reminder_dispatches || [];
  for (const d of dispatches) {
    results.push({
      json: {
        chat_id: d.chat_id,
        task_id: d.task_id,
        text: d.text,
        reply_markup: d.reply_markup
      }
    });
  }
}

return results;
