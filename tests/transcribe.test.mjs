import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanTranscription } from '../dist/main/transcribe.js';

describe('cleanTranscription', () => {
  it('reduces whisper silence / noise annotations to an empty string', () => {
    for (const raw of ['[BLANK_AUDIO]', ' [ Silence ] ', '(upbeat music)', '[MUSIC]\n(coughs)']) {
      assert.equal(cleanTranscription(raw), '', raw);
    }
  });

  it('keeps real speech and strips annotations around it', () => {
    assert.equal(
      cleanTranscription('[BLANK_AUDIO]\n Add a retry button. (coughs) Thanks.'),
      'Add a retry button. Thanks.',
    );
  });

  it('leaves ordinary parentheses alone', () => {
    assert.equal(
      cleanTranscription('Call foo (the helper) twice.'),
      'Call foo (the helper) twice.',
    );
  });
});
