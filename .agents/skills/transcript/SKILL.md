---
name: transcript
description: Transcription, captions, and edit by transcript. Use when changing speech to text, word timings, subtitle export, filler word and pause detection, or caption styling.
---

# Transcript

Speech to text, captions, and editing video by editing text.

- Transcribe on device by default with NVIDIA Parakeet v3, which keeps filler words and gives word-level timings.
  It covers 25 European languages; other languages need a fallback model.
  Overlap audio chunks, since Parakeet drops speech at chunk edges.
- The transcript lives in source time; SRT and VTT exports map it through cuts and speed changes.
- Deleting words from the transcript cuts them from the video.
- Filler words and long pauses are detected and offered as cuts the user confirms.
- Voiceover takes get words of their own, in take seconds and in the recording's language, as they land once the recording is transcribed, or with it on its first Transcribe.
  Captions, the Transcript tab, SRT and VTT, exports, and agents read one merged transcript (spoken() in src/engine/transcript): the recording's words but those under a voiceover that mutes the mic, and each voiceover's words where it plays.
  A word belongs where its middle plays, so a word the video cut through stays where most of it was heard.
  A caption fix on a voiceover's word is keyed "<take id>:<index>" (Word.key), so it stays on its word as items move and other takes land.
- Captions: font, color, position; line-by-line or word-by-word; appear, fade, or slide in; legible on vertical video.
  Moving captions shut out viewers who find motion hard to read: Line with Appear shows whole lines that never move, and SRT and VTT leave size and contrast to the viewer's player.

Done when after any sequence of cuts and speed changes, every caption word lands on the frame where it is spoken.
