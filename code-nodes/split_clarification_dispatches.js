/**
 * EDITH Split Clarification Dispatches (code-nodes/split_clarification_dispatches.js)
 * 
 * Flattens array of clarification messages into individual n8n items
 * so the Telegram node sends a dedicated message with inline buttons
 * for each incomplete task.
 */

const items = $input.all();
const results = [];

for (const item of items) {
  const dispatches = item.json.clarification_dispatches || [];
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
