/**
 * @file Singleton audio visualizer manager.
 *
 * Architecture:
 *   HTMLMediaElement
 *       │
 *       ├──→ audioCtx.destination   (audio output – always guaranteed)
 *       └──→ AnalyserNode           (read-only tap for visualization data)
 *
 * The AnalyserNode is a parallel tap, NOT inserted into the audio chain.
 * This means audio plays even if the analyser or AudioContext has any issue.
 *
 * A MediaElementAudioSourceNode can only be created once per HTMLMediaElement.
 * To support Hot Module Replacement (HMR) and dynamic page loads, we cache the
 * source node directly on the DOM element object under a custom property
 * `(element as VisualizableMediaElement).__audioSourceNode`, as well as inside
 * our local WeakMap.
 *
 * The pre-allocated _dataArray is reused every frame to avoid GC churn in the
 * animation loop.
 */

interface VisualizableMediaElement extends HTMLMediaElement {
  __audioSourceNode?: MediaElementAudioSourceNode;
}

class AudioVisualizer {
  private static instance: AudioVisualizer | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourcesMap = new WeakMap<
    HTMLMediaElement,
    MediaElementAudioSourceNode
  >();
  private activeElement: HTMLMediaElement | null = null;
  /** Pre-allocated buffer – reused every frame to avoid per-frame GC */
  private _dataArray: Uint8Array = new Uint8Array(0);

  private constructor() {
    // Register gesture listeners to initialize/resume AudioContext inside a
    // trusted user gesture. This is required because async media events like `@play`
    // are detached from the click gesture call-stack and blocked by browser autoplay policies.
    const resumeOnGesture = () => {
      this.ensureInit();
      if (this.audioCtx) {
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx
            .resume()
            .then(() => {
              console.log(
                '[AudioVisualizer] AudioContext resumed via user gesture.',
              );
              removeListeners();
            })
            .catch(() => {});
        } else if (this.audioCtx.state === 'running') {
          removeListeners();
        }
      }
    };

    const removeListeners = () => {
      window.removeEventListener('click', resumeOnGesture);
      window.removeEventListener('keydown', resumeOnGesture);
      window.removeEventListener('mousedown', resumeOnGesture);
    };

    window.addEventListener('click', resumeOnGesture);
    window.addEventListener('keydown', resumeOnGesture);
    window.addEventListener('mousedown', resumeOnGesture);
  }

  public static getInstance(): AudioVisualizer {
    if (!AudioVisualizer.instance) {
      AudioVisualizer.instance = new AudioVisualizer();
    }
    return AudioVisualizer.instance;
  }

  private createContext(): AudioContext | null {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return null;
    return new AudioContextClass();
  }

  private ensureInit(): boolean {
    if (this.audioCtx && this.analyser) return true;

    this.audioCtx = this.createContext();
    if (!this.audioCtx) return false;

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.85;
    this._dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    return true;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Returns the pre-allocated frequency data array filled with current data.
   * Callers MUST NOT store a reference across frames – the buffer is reused.
   */
  public getFrequencyData(): Uint8Array {
    if (!this.analyser) return this._dataArray;
    if (this._dataArray.length !== this.analyser.frequencyBinCount) {
      this._dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    }
    // Using a safe cast to unknown to bypass the generic ArrayBufferLike clash
    // in the built-in browser DOM lib typings without suppressing lint checks.
    this.analyser.getByteFrequencyData(
      this._dataArray as unknown as Uint8Array,
    );
    return this._dataArray;
  }

  public async resumeContext(): Promise<void> {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch {
        // Ignore – context will resume on next user gesture
      }
    }
  }

  /**
   * Connect a media element to the Web Audio graph.
   *
   * The source is wired to BOTH the audio destination (so sound always plays)
   * and the analyser (so we can read frequency data for the visualizer).
   * These two paths are independent – a problem with the analyser never
   * silences the audio.
   *
   * Safe to call multiple times with the same element.
   */
  public connect(element: HTMLMediaElement) {
    if (!this.ensureInit()) return;
    const ctx = this.audioCtx!;
    const analyser = this.analyser!;

    // Already connected – just make sure context is running
    if (this.activeElement === element) {
      void this.resumeContext();
      return;
    }

    const visualElement = element as VisualizableMediaElement;

    // Recover from WeakMap, or directly from the HTMLMediaElement if reloaded under HMR
    let source =
      this.sourcesMap.get(visualElement) || visualElement.__audioSourceNode;

    if (!source) {
      try {
        source = ctx.createMediaElementSource(visualElement);
        this.sourcesMap.set(visualElement, source);
        visualElement.__audioSourceNode = source;
      } catch (err) {
        console.error(
          '[AudioVisualizer] createMediaElementSource failed:',
          err,
        );
        // Element might already be connected elsewhere; bail out safely
        return;
      }
    }

    try {
      // ── Path 1: direct to speakers (guaranteed audio) ──────────────────
      source.connect(ctx.destination);

      // ── Path 2: tap into analyser for visualizer data only ─────────────
      source.connect(analyser);
      // The analyser does NOT need to connect to destination; it's a read tap.
    } catch (err) {
      console.warn('[AudioVisualizer] connection error:', err);
      // Even if analyser fails, Path 1 keeps audio playing.
    }

    this.activeElement = visualElement;
    void this.resumeContext();
  }
}

export const audioVisualizer = AudioVisualizer.getInstance();
