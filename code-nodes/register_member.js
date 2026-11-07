/**
 * EDITH Member Registration (code-nodes/register_member.js)
 * 
 * Handles /register <your name>:
 * - Extracts sender's name, telegram_username, telegram_id, and chat_id
 * - Upserts in Members Google Sheets tab
 * - Emits confirmation: "Registered. EDITH will now send your reminders directly."
 */

function processRegisterMember(items, existingMembers = []) {
  const results = [];

  for (const item of items) {
    const json = item.json;

    const fromUser = json.from || {};
    const chatId = String(json.chat_id || fromUser.id || '');
    const telegramId = String(fromUser.id || '');
    const telegramUsername = (fromUser.username || '').replace(/^@/, '');
    const fallbackName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || telegramUsername || 'Team Member';

    // Extract name from command args: /register <your name>
    const text = (json.text || json.raw_text || '').trim();
    const commandArgs = (json.command_args || text.replace(/^\/register(?:@\w+)?\s*/i, '')).trim();
    const registeredName = commandArgs || fallbackName;

    // Check if member already exists in Members tab (match by telegram_id or case-insensitive name)
    const existing = existingMembers.find(m => 
      (m.telegram_id && String(m.telegram_id) === telegramId) ||
      (m.name && m.name.trim().toLowerCase() === registeredName.toLowerCase())
    );

    const memberRecord = {
      name: registeredName,
      telegram_username: telegramUsername,
      telegram_id: telegramId,
      chat_id: chatId
    };

    results.push({
      json: {
        chat_id: chatId,
        is_update: Boolean(existing),
        member_record: memberRecord,
        reply_message: 'Registered. EDITH will now send your reminders directly.'
      }
    });
  }

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processRegisterMember
  };
}

if (typeof $input !== 'undefined') {
  let membersList = [];
  try {
    if (typeof $ !== 'undefined') {
      membersList = $('Read Members Tab').all().map(i => i.json);
    }
  } catch (e) {
    membersList = [];
  }

  return processRegisterMember($input.all(), membersList);
}
