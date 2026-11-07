/**
 * EDITH SHA-256 Hasher & Deduplication Checker
 * 
 * Computes deterministic SHA-256 hash of normalised_text.
 * Checks whether this transcript hash has already been stored in Google Sheets (Meetings tab).
 */

const crypto = require('crypto');

const items = $input.all();
const results = [];

// Retrieve historical meetings from previous Google Sheets node (if any)
let historicalMeetings = [];
try {
  historicalMeetings = $('Read Meetings Tab').all().map(i => i.json);
} catch (e) {
  // If no prior meetings exist or node not executed yet
  historicalMeetings = [];
}

for (const item of items) {
  const json = item.json;
  const normalisedText = (json.normalised_text || json.original_text || '').trim();

  // Deterministic SHA-256 hash
  const hash = crypto.createHash('sha256').update(normalisedText, 'utf8').digest('hex');
  const shortHash = hash.substring(0, 10);

  // Look for match in historical meetings
  const match = historicalMeetings.find(m => m.transcript_hash === hash);

  if (match) {
    results.push({
      json: {
        is_duplicate: true,
        transcript_hash: hash,
        short_hash: shortHash,
        existing_meeting_id: match.meeting_id,
        existing_title: match.title,
        existing_processed_at: match.processed_at,
        chat_id: json.chat_id
      }
    });
  } else {
    results.push({
      json: {
        is_duplicate: false,
        transcript_hash: hash,
        short_hash: shortHash,
        chat_id: json.chat_id,
        user_id: json.user_id,
        username: json.username,
        meeting_date: json.meeting_date,
        original_text: json.original_text,
        normalised_text: normalisedText
      }
    });
  }
}

return results;
