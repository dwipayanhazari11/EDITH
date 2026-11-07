/**
 * EDITH Transcript Hasher & Deduplication Evaluator
 * 
 * Computes deterministic SHA-256 hash of raw transcript text.
 * Compares against historical meetings fetched from Google Sheets.
 * 
 * Rules:
 * - Normalize line breaks and trim outer whitespace before hashing.
 * - If hash matches an existing meeting in Meetings tab, flag as duplicate.
 */

const crypto = require('crypto');

const items = $input.all();
const results = [];

for (const item of items) {
  const json = item.json;
  
  // Retrieve raw text from payload or binary
  let rawText = json.text || json.raw_text || '';
  if (!rawText && item.binary && item.binary.data) {
    const buffer = Buffer.from(item.binary.data.data, 'base64');
    rawText = buffer.toString('utf-8');
  }

  // Normalize whitespace and carriage returns
  const normalizedText = rawText.replace(/\r\n/g, '\n').trim();

  // Compute SHA-256 hash
  const hash = crypto.createHash('sha256').update(normalizedText, 'utf8').digest('hex');
  const shortHash = hash.substring(0, 10);

  // Retrieve existing meetings passed in context (if pre-fetched from Google Sheets)
  const existingMeetings = json.existing_meetings || [];
  const match = existingMeetings.find(m => m.transcript_hash === hash);

  if (match) {
    results.push({
      json: {
        is_duplicate: true,
        transcript_hash: hash,
        short_hash: shortHash,
        meeting_id: match.meeting_id,
        processed_at: match.processed_at,
        title: match.title,
        chat_id: json.chat_id,
        text: normalizedText
      }
    });
  } else {
    results.push({
      json: {
        is_duplicate: false,
        transcript_hash: hash,
        short_hash: shortHash,
        chat_id: json.chat_id,
        from_user: json.from || {},
        text: normalizedText
      }
    });
  }
}

return results;
