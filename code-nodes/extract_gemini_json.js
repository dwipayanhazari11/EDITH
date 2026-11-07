/**
 * EDITH Gemini JSON Extractor
 * 
 * Safely extracts and parses the JSON response from Gemini API generateContent payload.
 * Strips markdown codeblocks if present, validates schema conformance,
 * and carries forward trigger metadata.
 */

const items = $input.all();
const results = [];

for (const item of items) {
  const json = item.json;

  // Retrieve prior context passed through n8n workflow
  const chatId = json.chat_id || $('Validate & Normalize (Text)').first()?.json?.chat_id || $('Validate & Normalize (File)').first()?.json?.chat_id;
  const meetingDate = json.meeting_date || $('Validate & Normalize (Text)').first()?.json?.meeting_date || $('Validate & Normalize (File)').first()?.json?.meeting_date;
  const transcriptHash = json.transcript_hash || '';

  // 1. Extract text part from Gemini response structure
  let rawText = '';
  if (json.candidates && json.candidates[0]?.content?.parts && json.candidates[0].content.parts.length > 0) {
    rawText = json.candidates[0].content.parts[0].text || '';
  } else if (json.text) {
    rawText = json.text;
  }

  if (!rawText) {
    // Check if blocked or finished unexpectedly
    const finishReason = json.candidates?.[0]?.finishReason || 'NO_CANDIDATE';
    const blockReason = json.promptFeedback?.blockReason || 'UNKNOWN';
    throw new Error(`Gemini returned empty text. FinishReason: ${finishReason}, BlockReason: ${blockReason}`);
  }

  // 2. Strip optional markdown fences: ```json ... ```
  const cleanJson = rawText
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // 3. Parse JSON
  let parsed = null;
  try {
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    throw new Error(`Failed to parse Gemini output as JSON: ${err.message}. Raw text preview: ${rawText.slice(0, 150)}`);
  }

  // 4. Validate top-level schema keys
  const requiredKeys = ['meeting_title', 'meeting_summary', 'key_points', 'decisions', 'action_items', 'open_questions'];
  for (const key of requiredKeys) {
    if (parsed[key] === undefined) {
      throw new Error(`Gemini JSON missing required top-level key: "${key}"`);
    }
  }

  results.push({
    json: {
      chat_id: chatId,
      meeting_date: meetingDate,
      transcript_hash: transcriptHash,
      raw_ai_text: rawText,
      analysis: parsed
    }
  });
}

return results;
