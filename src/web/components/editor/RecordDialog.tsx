import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, Check, Circle, Mic, MonitorUp, RotateCcw, Square } from 'lucide-react';
import type { ClipInput } from '../../../shared/schema';
import { clipEnd } from '../../../shared/timeline';
import { uid } from '../../../shared/ids';
import { api } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { player } from '../../lib/player';
import { waitForAsset } from '../../lib/dnd';
import { cn, errorText, formatClock } from '../../lib/utils';
import { Field, Modal, Segmented, SelectField, Spinner, Switch } from '../ui';

type Mode = 'voice' | 'camera' | 'screen';
type Phase = 'setup' | 'countdown' | 'recording' | 'review' | 'saving';

const pickMime = (video: boolean): string => {
  const options = video ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
};

const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

/** Records voiceover, a camera or the screen straight into the project, placed at the playhead. */
export const RecordDialog: React.FC = () => {
  const mode = useStudio((s) => s.recorder);
  const open = mode !== null;
  const setMode = (m: Mode | null) => useStudio.setState({ recorder: m });
  const [phase, setPhase] = useState<Phase>('setup');
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState('');
  const [camId, setCamId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [playAlong, setPlayAlong] = useState(true);
  const [place, setPlace] = useState(true);
  const [result, setResult] = useState<{ url: string; blob: Blob; mime: string } | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const extra = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);
  const placeAt = useRef(0);
  const restoreMute = useRef<(() => void) | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);

  const release = useCallback(() => {
    stopStream(stream.current);
    stopStream(extra.current);
    stream.current = null;
    extra.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
  }, []);

  /** Level meter on the microphone track, drawn straight into the DOM. */
  const watchLevel = useCallback((s: MediaStream) => {
    if (!s.getAudioTracks().length) return;
    const ctx = new AudioContext();
    audioCtx.current = ctx;
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(s).connect(an);
    const buf = new Float32Array(an.fftSize);
    const tick = () => {
      if (audioCtx.current !== ctx) return;
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-6);
      const level = Math.max(0, Math.min(1, (db + 60) / 60));
      if (meter.current) {
        meter.current.style.width = `${level * 100}%`;
        meter.current.style.background = db > -3 ? '#ff4d6d' : db > -12 ? '#ffb020' : '#22d39a';
      }
      requestAnimationFrame(tick);
    };
    tick();
  }, []);

  /** (Re)open the input devices for the current mode. */
  const acquire = useCallback(async () => {
    release();
    setError(null);
    if (!mode) return;
    try {
      const audio: MediaTrackConstraints = { deviceId: micId ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (mode === 'screen') {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
        const mic = await navigator.mediaDevices.getUserMedia({ audio }).catch(() => null);
        extra.current = display;
        stream.current = new MediaStream([...display.getVideoTracks(), ...(mic?.getAudioTracks() ?? [])]);
        display.getVideoTracks()[0]?.addEventListener('ended', () => recorder.current?.state === 'recording' && recorder.current.stop());
      } else {
        stream.current = await navigator.mediaDevices.getUserMedia({
          audio,
          video: mode === 'camera' ? { deviceId: camId ? { exact: camId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 } } : false,
        });
      }
      if (video.current && mode !== 'voice') {
        video.current.srcObject = stream.current;
        void video.current.play().catch(() => undefined);
      }
      watchLevel(stream.current);
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMics(devices.filter((d) => d.kind === 'audioinput'));
      setCams(devices.filter((d) => d.kind === 'videoinput'));
    } catch (err) {
      const name = (err as DOMException).name;
      setError(name === 'NotAllowedError' ? 'Permission denied. Allow access to your microphone/camera in the browser (address bar → site settings), then try again.' : errorText(err));
    }
  }, [mode, micId, camId, release, watchLevel]);

  useEffect(() => {
    if (!open) return;
    setPhase('setup');
    setResult(null);
    void acquire();
    return release;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, micId, camId]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 250);
    return () => clearInterval(t);
  }, [phase]);

  const begin = () => {
    if (!stream.current) return;
    setPhase('countdown');
    setCount(3);
    let n = 3;
    const t = setInterval(() => {
      n -= 1;
      if (n > 0) return setCount(n);
      clearInterval(t);
      start();
    }, 800);
  };

  const start = () => {
    const s = stream.current;
    if (!s) return;
    const mime = pickMime(mode !== 'voice');
    const rec = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 192_000, videoBitsPerSecond: 8_000_000 } : undefined);
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      restoreMute.current?.();
      restoreMute.current = null;
      if (playAlong) player.pause();
      const type = rec.mimeType || mime || (mode === 'voice' ? 'audio/webm' : 'video/webm');
      const blob = new Blob(chunks.current, { type });
      setResult({ url: URL.createObjectURL(blob), blob, mime: type });
      setPhase('review');
    };
    recorder.current = rec;
    placeAt.current = useStudio.getState().time;
    if (playAlong && mode === 'voice' && (useStudio.getState().project?.tracks.some((t) => t.clips.length) ?? false)) {
      restoreMute.current = player.muteTemporarily();
      player.play();
    }
    rec.start(1000);
    startedAt.current = Date.now();
    setElapsed(0);
    setPhase('recording');
  };

  const stop = () => recorder.current?.state === 'recording' && recorder.current.stop();

  const save = async () => {
    const st = useStudio.getState();
    const p = st.project;
    if (!result || !p || !mode) return;
    setPhase('saving');
    try {
      const ext = result.mime.includes('mp4') ? (mode === 'voice' ? '.m4a' : '.mp4') : '.webm';
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
      const name = `${mode === 'voice' ? 'Voiceover' : mode === 'camera' ? 'Camera' : 'Screen'} recording ${stamp}${ext}`;
      const { assets } = await api.upload(p.id, [new File([result.blob], name, { type: result.mime })]);
      const asset = assets[0];
      if (!asset) throw new Error('Upload failed');
      if (place) {
        const ready = await waitForAsset(asset.id);
        if (!ready || ready.status === 'error') throw new Error(ready?.error ?? 'The recording could not be read');
        const fresh = useStudio.getState().project!;
        const at = placeAt.current;
        const dur = ready.meta.duration ?? elapsed;
        const free = (name: string) => {
          const t = fresh.tracks.find((x) => x.name === name);
          return t && !t.locked && !t.clips.some((c) => at < clipEnd(c) - 1e-3 && at + dur > c.start + 1e-3) ? t : null;
        };
        let clip: ClipInput;
        let trackId: string | undefined;
        if (mode === 'voice') {
          clip = { id: uid('clip'), type: 'audio', role: 'voiceover', assetId: asset.id, start: at, duration: dur };
          trackId = fresh.tracks.find((t) => t.name === 'Voiceover')?.id ?? fresh.tracks.find((t) => t.kind === 'audio')?.id;
        } else if (free('Main')) {
          clip = { id: uid('clip'), type: 'video', assetId: asset.id, start: at, duration: dur };
          trackId = free('Main')!.id;
        } else {
          // the main picture is busy: a camera becomes a picture-in-picture, a screen a full-frame cutaway
          clip =
            mode === 'camera'
              ? { id: uid('clip'), type: 'video', assetId: asset.id, start: at, duration: dur, box: { x: 0.66, y: 0.62, w: 0.3, h: 0.3 }, radius: 24, shadow: true }
              : { id: uid('clip'), type: 'video', assetId: asset.id, start: at, duration: dur };
          trackId = fresh.tracks.find((t) => t.name === 'B-roll')?.id;
        }
        const res = await st.edit([{ op: 'addClip', clip, trackId, onConflict: 'new-track' }], `Add ${mode} recording`);
        if (res) useStudio.setState({ selection: [clip.id!] });
      }
      toast.success(place ? 'Recording added to the timeline' : 'Recording saved to Media');
      URL.revokeObjectURL(result.url);
      setMode(null);
    } catch (err) {
      toast.error(errorText(err));
      setPhase('review');
    }
  };

  const close = (o: boolean) => {
    if (o) return;
    if (phase === 'recording') stop();
    if (result) URL.revokeObjectURL(result.url);
    release();
    setMode(null);
  };

  const live = phase === 'countdown' || phase === 'recording';
  return (
    <Modal open={open} onOpenChange={close} title="Record" description="Narrate, film yourself or capture your screen; the take lands on the timeline at the playhead." className="w-[min(720px,96vw)]">
      <div className="flex flex-col gap-4">
        <Segmented
          value={mode ?? 'voice'}
          onChange={(m) => !live && setMode(m)}
          options={[
            { value: 'voice', label: <><Mic className="size-3.5" /> Voiceover</> },
            { value: 'camera', label: <><Camera className="size-3.5" /> Camera</> },
            { value: 'screen', label: <><MonitorUp className="size-3.5" /> Screen</> },
          ]}
        />

        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-line bg-black/50">
          {mode !== 'voice' && phase !== 'review' && <video ref={video} muted playsInline className={cn('size-full object-contain', mode === 'camera' && '-scale-x-100')} />}
          {mode === 'voice' && phase !== 'review' && (
            <div className="flex flex-col items-center gap-3 text-muted">
              <span className={cn('tile size-16 rounded-full text-hue-green', phase === 'recording' && 'animate-pulse')}>
                <Mic className="size-7" />
              </span>
              <span className="text-xs">{phase === 'recording' ? 'Recording your voice…' : 'Speak to check your level'}</span>
            </div>
          )}
          {phase === 'review' && result && (mode === 'voice' ? <audio src={result.url} controls className="w-4/5" /> : <video src={result.url} controls className="size-full object-contain" />)}
          {phase === 'countdown' && <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-7xl font-black text-white">{count}</div>}
          {phase === 'recording' && (
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white">
              <span className="size-2 animate-pulse rounded-full bg-danger" /> REC {formatClock(elapsed)}
            </div>
          )}
          {error && <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center text-sm text-danger">{error}</div>}
        </div>

        {phase !== 'review' && phase !== 'saving' && (
          <div className="h-1.5 overflow-hidden rounded-full bg-panel-3" title="Input level">
            <div ref={meter} className="h-full w-0 rounded-full transition-[width] duration-75" />
          </div>
        )}

        {(phase === 'setup' || phase === 'review') && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Microphone">
              <SelectField value={micId} onChange={setMicId} options={mics.map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` }))} placeholder="Default microphone" />
            </Field>
            {mode === 'camera' && (
              <Field label="Camera">
                <SelectField value={camId} onChange={setCamId} options={cams.map((d, i) => ({ value: d.deviceId, label: d.label || `Camera ${i + 1}` }))} placeholder="Default camera" />
              </Field>
            )}
            {mode === 'voice' && <Switch label="Play the video while recording (muted)" checked={playAlong} onChange={setPlayAlong} />}
            <Switch label="Add to the timeline at the playhead" checked={place} onChange={setPlace} />
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {phase === 'setup' && (
            <button className="btn btn-primary px-4" disabled={!stream.current || Boolean(error)} onClick={begin}>
              <Circle className="size-3.5" fill="currentColor" /> Start recording
            </button>
          )}
          {phase === 'countdown' && (
            <button className="btn" disabled>
              Get ready…
            </button>
          )}
          {phase === 'recording' && (
            <button className="btn border-danger/50 bg-danger/20 text-danger" onClick={stop}>
              <Square className="size-3.5" fill="currentColor" /> Stop
            </button>
          )}
          {phase === 'review' && (
            <>
              <button
                className="btn"
                onClick={() => {
                  if (result) URL.revokeObjectURL(result.url);
                  setResult(null);
                  setPhase('setup');
                  void acquire();
                }}
              >
                <RotateCcw className="size-3.5" /> Retake
              </button>
              <button className="btn btn-primary px-4" onClick={() => void save()}>
                <Check className="size-4" /> Use this take
              </button>
            </>
          )}
          {phase === 'saving' && (
            <button className="btn btn-primary" disabled>
              <Spinner /> Saving…
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
