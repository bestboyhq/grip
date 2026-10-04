import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BufferSource, BufferTarget, EncodedAudioPacketSource, EncodedPacket, Input, MP4, Mp4OutputFormat, Output } from 'mediabunny'
import { AAC_PRIMING, setEditDuration } from './mp4.ts'

test('AAC priming is skipped and the audio edit ends exactly at the video length', async () => {
  const seconds = 2.5 // 120000 samples: not a multiple of 1024, so the last packet is padded
  const packets = Math.ceil((seconds * 48000 + AAC_PRIMING) / 1024)
  let moov: { data: Uint8Array; position: number } | null = null
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory', onMoov: (data, position) => (moov = { data: data.slice(), position }) }), target })
  const source = new EncodedAudioPacketSource('aac')
  output.addAudioTrack(source)
  await output.start()
  const description = new Uint8Array([0x11, 0x90]) // AudioSpecificConfig: AAC-LC, 48 kHz, stereo
  for (let i = 0; i < packets; i++) {
    const packet = new EncodedPacket(new Uint8Array(8), 'key', (i * 1024 - AAC_PRIMING) / 48000, 1024 / 48000)
    await source.add(packet, i ? undefined : { decoderConfig: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, description } })
  }
  await output.finalize()
  const file = new Uint8Array(target.buffer!)
  const { data, position } = moov!
  setEditDuration(data, seconds)
  file.set(data, position)

  const input = new Input({ source: new BufferSource(file), formats: [MP4] })
  const track = (await input.getPrimaryAudioTrack())!
  assert.equal(await track.getFirstTimestamp(), -AAC_PRIMING / 48000, 'priming sits before 0, so players skip it')
  // Packets still cover the padded tail; the edit is what players honor.
  const text = new TextDecoder('latin1').decode(file)
  const elst = text.indexOf('elst')
  const view = new DataView(file.buffer)
  const version = file[elst + 4]
  const duration = version ? Number(view.getBigUint64(elst + 12)) : view.getUint32(elst + 12)
  const mediaTime = version ? Number(view.getBigInt64(elst + 20)) : view.getInt32(elst + 16)
  assert.equal(duration, seconds * 57600, 'edit length = video length (movie timescale)')
  assert.equal(mediaTime, AAC_PRIMING, 'edit starts after the priming samples')
})
