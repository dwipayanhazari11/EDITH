/**
 * EDITH Deterministic ID Generator (code-nodes/make_ids.js)
 * 
 * Rules:
 * - normalise transcript: lowercase, strip timestamps, collapse whitespace
 * - transcript_hash = SHA-256(normalised transcript + chat_id)
 * - meeting_id = "MTG-" + first 8 chars of the hash (uppercase)
 * - task_id = "TSK-" + first 6 chars of SHA-256(meeting_id + normalised task text + (owner || "none")) (uppercase)
 * - question_id = "QST-" + first 6 chars of SHA-256(meeting_id + normalised question text) (uppercase)
 */

const crypto = require('crypto');

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function normaliseTranscriptForHashing(text) {
  return (text || '')
    .toLowerCase()
    .replace(/\[\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[apap][mm])?\s*\]/g, '')
    .replace(/\(\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[apap][mm])?\s*\)/g, '')
    .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[apap][mm])?\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseTaskText(task) {
  return (task || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateMeetingId(transcriptHash) {
  return 'MTG-' + transcriptHash.substring(0, 8).toUpperCase();
}

function generateTaskId(meetingId, taskText, owner) {
  const normTask = normaliseTaskText(taskText);
  const normOwner = (owner || 'none').toLowerCase().trim();
  const seed = `${meetingId}_${normTask}_${normOwner}`;
  const hash = sha256(seed);
  return 'TSK-' + hash.substring(0, 6).toUpperCase();
}

function generateQuestionId(meetingId, questionText) {
  const normQ = normaliseTaskText(questionText);
  const seed = `${meetingId}_${normQ}`;
  const hash = sha256(seed);
  return 'QST-' + hash.substring(0, 6).toUpperCase();
}

function processMakeIds(items) {
  const results = [];

  for (const item of items) {
    const json = item.json;
    const rawText = json.normalised_text || json.original_text || json.text || '';
    const chatId = String(json.chat_id || '');

    const normalisedForHash = normaliseTranscriptForHashing(rawText);
    const transcriptHash = sha256(normalisedForHash + chatId);
    const meetingId = generateMeetingId(transcriptHash);

    results.push({
      json: {
        ...json,
        transcript_hash: transcriptHash,
        meeting_id: meetingId,
        normalised_for_hash: normalisedForHash
      }
    });
  }

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sha256,
    normaliseTranscriptForHashing,
    normaliseTaskText,
    generateMeetingId,
    generateTaskId,
    generateQuestionId,
    processMakeIds
  };
}

if (typeof $input !== 'undefined') {
  return processMakeIds($input.all());
}
