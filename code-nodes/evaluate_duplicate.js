/**
 * EDITH Duplicate Hash Evaluator
 * 
 * Compares current transcript_hash against historical records retrieved from
 * Google Sheets (Meetings tab).
 */

const items = $input.all();
const results = [];

const hashNode = $('Compute SHA-256 Hash').first()?.json || {};
const currentHash = hashNode.transcript_hash || '';
const chatId = hashNode.chat_id;

// Retrieve rows from Read Meetings Tab node
let existingMeetings = [];
try {
  existingMeetings = $('Read Meetings Tab').all().map(i => i.json);
} catch (e) {
  existingMeetings = [];
}

const match = existingMeetings.find(m => m.transcript_hash === currentHash);

if (match) {
  results.push({
    json: {
      is_duplicate: true,
      transcript_hash: currentHash,
      chat_id: chatId,
      existing_meeting_id: match.meeting_id || 'UNKNOWN',
      existing_title: match.title || 'Untitled',
      existing_processed_at: match.processed_at || 'earlier date'
    }
  });
} else {
  results.push({
    json: {
      ...hashNode,
      is_duplicate: false
    }
  });
}

return results;
