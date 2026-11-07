/**
 * EDITH Input Validator & Normalizer (code-nodes/validate_input.js)
 * Validates raw transcript submissions, normalizes conferencing formats,
 * and extracts meeting date context in Asia/Kolkata.
 */

const MAX_BYTES = 200 * 1024; // ~200 KB limit

function processValidateInput(items) {
  const results = [];

  for (const item of items) {
    const json = item.json;

    const chatId = json.chat_id;
    const userId = json.user_id;
    const username = json.username || '';
    const messageDate = json.message_date;
    const caption = (json.caption || '').trim();
    const fileInfo = json.file_info || {};

    // 1. Extract raw text from text field or binary buffer
    let rawText = (json.text || '').trim();
    let binarySize = 0;

    if (item.binary && item.binary.data) {
      const buffer = Buffer.from(item.binary.data.data, 'base64');
      binarySize = buffer.length;
      rawText = buffer.toString('utf-8').trim();
    } else if (fileInfo.file_size) {
      binarySize = fileInfo.file_size;
    }

    // 2. Validate file type and extension (if document)
    if (fileInfo.file_name || fileInfo.mime_type) {
      const fileName = (fileInfo.file_name || '').toLowerCase();
      const mimeType = (fileInfo.mime_type || '').toLowerCase();

      const isTxt = fileName.endsWith('.txt') || mimeType === 'text/plain';
      if (!isTxt) {
        results.push({
          json: {
            is_valid: false,
            error_code: 'UNSUPPORTED_TYPE',
            error_reason: 'Unsupported file format. Only plain text (.txt) files are supported.',
            chat_id: chatId
          }
        });
        continue;
      }
    }

    // 3. Validate size
    const totalLength = rawText.length;
    if (binarySize > MAX_BYTES || totalLength > MAX_BYTES) {
      results.push({
        json: {
          is_valid: false,
          error_code: 'FILE_TOO_LARGE',
          error_reason: 'File size exceeds the 200 KB limit. Please split or summarize the transcript.',
          chat_id: chatId
        }
      });
      continue;
    }

    // 4. Validate empty / whitespace
    if (!rawText || rawText.replace(/\s+/g, '').length === 0) {
      results.push({
        json: {
          is_valid: false,
          error_code: 'EMPTY',
          error_reason: 'The provided text or file is completely empty.',
          chat_id: chatId
        }
      });
      continue;
    }

    // 5. Gibberish & word ratio check (Check before speaker count)
    const tokens = rawText.split(/\s+/).filter(Boolean);
    const alphaWords = tokens.filter(t => /^[A-Za-z]{2,}[.,?!:;]?$/.test(t));
    const alphaRatio = tokens.length > 0 ? (alphaWords.length / tokens.length) : 0;

    const wordsWithVowels = alphaWords.filter(w => /[aeiouyAEIOUY]/.test(w));
    const vowelRatio = alphaWords.length > 0 ? (wordsWithVowels.length / alphaWords.length) : 0;

    if (tokens.length >= 8 && (alphaRatio < 0.45 || vowelRatio < 0.60)) {
      results.push({
        json: {
          is_valid: false,
          error_code: 'GIBBERISH',
          error_reason: 'Input text appears to be unreadable or contains an excessive proportion of random symbols.',
          chat_id: chatId
        }
      });
      continue;
    }

    // 6. Speaker line & length heuristic
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const speakerRegex = /^(?:\[[\d:apmAPM\s]+\]\s*|\([\d:apmAPM\s]+\)\s*|\d{1,2}:\d{2}(?::\d{2})?\s*(?:[apAP][mM])?\s*)?(?:[A-Za-z0-9_ -]+:|\([A-Za-z0-9_ -]+\):?)/;

    let speakerLinesCount = 0;
    for (const line of lines) {
      if (speakerRegex.test(line)) {
        speakerLinesCount++;
      }
    }

    if (speakerLinesCount < 3 && totalLength < 300) {
      results.push({
        json: {
          is_valid: false,
          error_code: 'TOO_SHORT',
          error_reason: 'Transcript is too brief. Meeting transcripts must contain at least 300 characters or 3 distinct speaker turns.',
          chat_id: chatId
        }
      });
      continue;
    }

    // 7. Normalization of Google Meet / conferencing transcripts
    let normalised = rawText
      .replace(/\[\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[apAP][mM])?\s*\]/g, '')
      .replace(/\(\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[apAP][mM])?\s*\)/g, '')
      .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[apAP][mM])?\s+/gm, '')
      .replace(/^\s*\(([A-Za-z0-9_ -]+)\)\s*:?/gm, '$1:')
      .replace(/^\s*\[([A-Za-z0-9_ -]+)\]\s*:?/gm, '$1:')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // 8. Meeting Date Resolution
    let resolvedDate = null;
    const headerSlice = [caption, ...lines.slice(0, 10)].join('\n');

    const isoMatch = headerSlice.match(/(?:Date:\s*)?(\b20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b)/i);
    const ukMatch = headerSlice.match(/(?:Date:\s*)?(\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2}\b)/i);
    const usMatch = headerSlice.match(/(?:Date:\s*)?(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}\b)/i);

    if (isoMatch) {
      resolvedDate = isoMatch[1];
    } else if (ukMatch) {
      const parsed = new Date(ukMatch[1]);
      if (!isNaN(parsed.getTime())) {
        resolvedDate = parsed.toISOString().slice(0, 10);
      }
    } else if (usMatch) {
      const parsed = new Date(usMatch[1]);
      if (!isNaN(parsed.getTime())) {
        resolvedDate = parsed.toISOString().slice(0, 10);
      }
    }

    if (!resolvedDate && messageDate) {
      try {
        const msgTimestamp = typeof messageDate === 'number' ? messageDate * 1000 : new Date(messageDate).getTime();
        if (!isNaN(msgTimestamp)) {
          const istDate = new Date(msgTimestamp + (330 * 60 * 1000));
          resolvedDate = istDate.toISOString().slice(0, 10);
        }
      } catch (e) {
        resolvedDate = null;
      }
    }

    if (!resolvedDate) {
      results.push({
        json: {
          is_valid: false,
          error_code: 'MISSING_DATE',
          error_reason: 'Could not identify a meeting date in the text or header, and message timestamp is missing. Please provide the meeting date (e.g., "Date: YYYY-MM-DD").',
          chat_id: chatId
        }
      });
      continue;
    }

    results.push({
      json: {
        is_valid: true,
        chat_id: chatId,
        user_id: userId,
        username: username,
        meeting_date: resolvedDate,
        original_text: rawText,
        normalised_text: normalised,
        speaker_turns: speakerLinesCount,
        char_count: totalLength
      }
    });
  }

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processValidateInput
  };
}

if (typeof $input !== 'undefined') {
  return processValidateInput($input.all());
}
