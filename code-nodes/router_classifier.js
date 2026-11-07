/**
 * EDITH Router Classifier
 * Classifies incoming Telegram updates into discrete execution routes.
 * 
 * Routes:
 * - command: /start, /help, /register, /tasks, /update, /ask
 * - doc_txt: Plain text (.txt) document upload
 * - transcript_text: Long text (>300 chars) or /upload_meeting command
 * - callback: Telegram inline button callback_query
 * - reply: Reply to a bot message (clarification response)
 * - fallback: Unrecognized or unsupported input
 */

const items = $input.all();
const results = [];

for (const item of items) {
  const json = item.json;

  // 1. Check for Callback Query (Inline keyboard buttons)
  if (json.callback_query) {
    const cb = json.callback_query;
    results.push({
      json: {
        route: 'callback',
        update_id: json.update_id,
        chat_id: cb.message?.chat?.id || cb.from?.id,
        message_id: cb.message?.message_id,
        callback_query_id: cb.id,
        callback_data: cb.data || '',
        from_id: cb.from?.id,
        from_username: cb.from?.username || '',
        from_name: [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(' ')
      }
    });
    continue;
  }

  // Extract standard message
  const msg = json.message || json.channel_post || json.edited_message;
  if (!msg) {
    results.push({
      json: {
        route: 'fallback',
        update_id: json.update_id,
        reason: 'no_message_found'
      }
    });
    continue;
  }

  const chatId = msg.chat?.id;
  const messageId = msg.message_id;
  const text = (msg.text || msg.caption || '').trim();
  const from = msg.from || {};
  const fromUser = {
    id: from.id,
    username: from.username || '',
    name: [from.first_name, from.last_name].filter(Boolean).join(' ')
  };

  // 2. Check for Reply to Bot (Clarification responses)
  if (msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.is_bot) {
    results.push({
      json: {
        route: 'reply',
        chat_id: chatId,
        message_id: messageId,
        reply_to_message_id: msg.reply_to_message.message_id,
        reply_to_text: msg.reply_to_message.text || '',
        text: text,
        from: fromUser
      }
    });
    continue;
  }

  // 3. Check for .txt document upload
  if (msg.document) {
    const doc = msg.document;
    const isTxt = doc.mime_type === 'text/plain' || (doc.file_name && doc.file_name.toLowerCase().endsWith('.txt'));
    if (isTxt) {
      results.push({
        json: {
          route: 'doc_txt',
          chat_id: chatId,
          message_id: messageId,
          file_id: doc.file_id,
          file_name: doc.file_name || 'transcript.txt',
          file_size: doc.file_size || 0,
          mime_type: doc.mime_type || 'text/plain',
          caption: text,
          from: fromUser
        }
      });
      continue;
    }
  }

  // 4. Check for recognized slash commands
  const commandMatch = text.match(/^\/(start|help|register|tasks|update|ask)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (commandMatch) {
    const command = commandMatch[1].toLowerCase();
    const args = (commandMatch[2] || '').trim();
    results.push({
      json: {
        route: 'command',
        chat_id: chatId,
        message_id: messageId,
        command: command,
        command_args: args,
        raw_text: text,
        from: fromUser
      }
    });
    continue;
  }

  // 5. Check for transcript text (>300 chars or /upload_meeting)
  if (text.startsWith('/upload_meeting') || text.length > 300) {
    const cleanText = text.replace(/^\/upload_meeting(?:@\w+)?\s*/i, '').trim();
    results.push({
      json: {
        route: 'transcript_text',
        chat_id: chatId,
        message_id: messageId,
        text: cleanText,
        text_length: cleanText.length,
        from: fromUser
      }
    });
    continue;
  }

  // 6. Fallback route for all other inputs
  results.push({
    json: {
      route: 'fallback',
      chat_id: chatId,
      message_id: messageId,
      text: text,
      from: fromUser
    }
  });
}

return results;
