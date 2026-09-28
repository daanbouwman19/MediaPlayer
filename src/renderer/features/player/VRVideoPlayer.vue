<template>
  <div ref="container" class="vr-container relative w-full h-full bg-black">
    <!-- Overlay for when video is not playing/loading, if needed -->
    <div
      v-if="!isPlaying"
      class="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
    >
      <!-- Optional: Play icon or similar overlay -->
    </div>

    <!-- VR Controls Overlay (Moved down to avoid Header overlap) -->
    <transition name="fade">
      <div
        v-if="isControlsVisible"
        class="absolute left-4 right-4 z-20 flex justify-between items-start pointer-events-none"
        :class="[isFullscreen ? 'top-6' : 'top-24']"
        data-testid="vr-controls-container"
      >
        <div class="flex gap-2 pointer-events-auto">
          <!-- Play/Pause Button -->
          <button
            class="bg-black/50 text-white p-3 rounded-full hover:bg-white/20 border border-white/20 backdrop-blur-sm transition-colors flex items-center justify-center pointer-events-auto"
            :aria-label="isPlaying ? 'Pause video' : 'Play video'"
            :title="isPlaying ? 'Pause video' : 'Play video'"
            @click="togglePlayback"
          >
            <component :is="isPlaying ? PauseIcon : PlayIcon" class="w-5 h-5" />
          </button>

          <!-- Mode Toggle -->
          <button
            class="bg-black/50 text-white px-8 py-3 rounded-full text-sm font-medium hover:bg-black/70 border border-white/20 backdrop-blur-sm whitespace-nowrap transition-colors pointer-events-auto"
            @click="toggleStereo"
          >
            {{ isStereo ? 'Mode: 3D (SBS)' : 'Mode: 2D (Mono)' }}
          </button>
        </div>

        <div class="flex gap-2 pointer-events-auto">
          <!-- Recenter Button (VR Motion Mode) -->
          <button
            class="bg-black/50 p-3 rounded-full hover:bg-accent/80 border border-white/20 backdrop-blur-sm transition-colors pointer-events-auto"
            :class="isMotionControlActive ? 'text-accent' : 'text-white'"
            title="Recenter VR View"
            aria-label="Recenter VR View"
            @click="recenterVR"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
              />
            </svg>
          </button>

          <!-- Close / Exit Fullscreen Button (Only in Fullscreen) -->
          <button
            v-if="isFullscreen"
            class="bg-black/50 text-white p-3 rounded-full hover:bg-red-500/80 border border-white/20 backdrop-blur-sm transition-colors pointer-events-auto"
            aria-label="Exit Fullscreen"
            title="Exit Fullscreen"
            @click="toggleFullscreen"
          >
            <CloseIcon class="w-5 h-5" />
          </button>
        </div>
      </div>
    </transition>

    <!-- Permission Denied Toast -->
    <transition name="fade">
      <div
        v-if="showPermissionDeniedToast"
        class="absolute bottom-24 left-1/2 transform -translate-x-1/2 z-50 bg-red-500/90 text-white px-6 py-3 rounded-full text-sm font-bold shadow-lg backdrop-blur-md transition-all duration-300"
      >
        Motion control permission denied
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import PlayIcon from '@/components/atoms/icons/PlayIcon.vue';
import PauseIcon from '@/components/atoms/icons/PauseIcon.vue';
import CloseIcon from '@/components/atoms/icons/CloseIcon.vue';
import {
  attachHlsSource,
  needsHlsJs,
  type HlsSource,
} from '@/utils/hlsPlayback';

const STEREO_ASPECT_RATIO_THRESHOLD = 1.9;
const SPHERE_RADIUS = 500;
const SPHERE_WIDTH_SEGMENTS = 60;
const SPHERE_HEIGHT_SEGMENTS = 40;

const props = defineProps<{
  src: string;
  poster?: string | undefined;
  isPlaying: boolean;
  initialTime?: number;
  isControlsVisible: boolean;
}>();

const emit = defineEmits<{
  (e: 'timeupdate', time: number): void;
  (e: 'update:video-element', el: HTMLVideoElement | null): void;
  (e: 'play'): void;
  (e: 'pause'): void;
  (e: 'playing'): void;
  (e: 'ended'): void;
  (e: 'error', error: Event | Error): void;
  (e: 'buffering', isBuffering: boolean): void;
  (e: 'loadedmetadata', event: Event): void;
}>();

const container = ref<HTMLElement | null>(null);
const isStereo = ref(false);
const isFullscreen = ref(false);
const isMotionControlActive = ref(false);
const showPermissionDeniedToast = ref(false);

// Three.js instances
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let controls: OrbitControls | null = null;
let video: HTMLVideoElement | null = null;
let hlsSource: HlsSource | null = null;
let videoTexture: THREE.VideoTexture | null = null;
let sphereGeometry: THREE.SphereGeometry | null = null;
let sphereMaterial: THREE.MeshBasicMaterial | null = null;
let sphereMesh: THREE.Mesh | null = null;
let animationId: number | null = null;

// Motion Control State: the latest real (non-null) sensor reading, in degrees
let deviceOrientation: { alpha: number; beta: number; gamma: number } | null =
  null;
let screenOrientation = 0;
let initialOffsetAlpha = 0; // For recentering
let isListeningForOrientation = false;

/** iOS 13+ gates orientation events behind a permission prompt. */
interface OrientationPermissionApi {
  requestPermission?: () => Promise<string>;
}

const onDeviceOrientation = (event: DeviceOrientationEvent) => {
  // Desktop browsers may fire an all-null event without any sensor. Using
  // it would point the camera straight down and freeze the view.
  if (event.alpha === null || event.beta === null || event.gamma === null) {
    return;
  }
  deviceOrientation = {
    alpha: event.alpha,
    beta: event.beta,
    gamma: event.gamma,
  };
  if (!isMotionControlActive.value) {
    // Real sensor data: switch from mouse/touch look to motion control,
    // centred on the heading the device has right now.
    isMotionControlActive.value = true;
    initialOffsetAlpha = event.alpha;
    if (controls) {
      controls.enabled = false; // Disable orbit controls
    }
  }
};

const onScreenOrientationChange = () => {
  screenOrientation = window.orientation || 0;
};

const stopListeningForOrientation = () => {
  isListeningForOrientation = false;
  window.removeEventListener('deviceorientation', onDeviceOrientation);
  window.removeEventListener('orientationchange', onScreenOrientationChange);
};

/**
 * Starts listening for orientation readings. Motion control only takes over
 * once a real (non-null) reading arrives, so devices without sensors keep
 * the orbit controls.
 */
const listenForOrientation = () => {
  if (isListeningForOrientation) return;
  isListeningForOrientation = true;
  window.addEventListener('deviceorientation', onDeviceOrientation);
  window.addEventListener('orientationchange', onScreenOrientationChange);
  onScreenOrientationChange();
};

/** Leaves motion control and hands the camera back to the orbit controls. */
const exitMotionControl = () => {
  stopListeningForOrientation();
  deviceOrientation = null;
  isMotionControlActive.value = false;
  if (controls) {
    controls.enabled = true;
  }
};

const handleCanvasPointerDown = () => {
  // Dragging the view is the way out of motion mode.
  if (isMotionControlActive.value) exitMotionControl();
};

const recenterVR = () => {
  if (isMotionControlActive.value) {
    // Already active, just recenter (reset offset)
    if (deviceOrientation) {
      initialOffsetAlpha = deviceOrientation.alpha;
    }
    return;
  }

  // Point the mouse/touch-driven view back at the front of the video.
  controls?.reset();

  const orientationApi = (
    window as unknown as { DeviceOrientationEvent?: OrientationPermissionApi }
  ).DeviceOrientationEvent;
  if (!orientationApi) return;

  // Request permission on iOS 13+
  if (typeof orientationApi.requestPermission === 'function') {
    orientationApi
      .requestPermission()
      .then((response) => {
        if (response === 'granted') {
          listenForOrientation();
        } else {
          showPermissionDenied();
        }
      })
      .catch(console.error);
  } else {
    listenForOrientation();
  }
};

const showPermissionDenied = () => {
  showPermissionDeniedToast.value = true;
  setTimeout(() => {
    showPermissionDeniedToast.value = false;
  }, 3000);
};

const togglePlay = () => {
  if (!video) return;
  if (video.paused) {
    video.play().catch(() => {});
  } else {
    video.pause();
  }
};

const togglePlayback = () => togglePlay(); // Alias for backwards compatibility

const toggleStereo = () => {
  isStereo.value = !isStereo.value;
  updateTextureMapping();
};

const toggleFullscreen = () => {
  if (!container.value) return;

  if (!document.fullscreenElement) {
    container.value.requestFullscreen().catch((err) => {
      console.warn(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
};

const updateTextureMapping = () => {
  if (!videoTexture) return;

  // Need to update the texture transform
  if (isStereo.value) {
    // Side-by-Side: Show left eye only (left half of texture)
    // Repeat X = 0.5 (show half width)
    // Offset X = 0 (start from left)
    videoTexture.repeat.set(0.5, 1);
    videoTexture.offset.set(0, 0);
  } else {
    // Mono: Full texture
    videoTexture.repeat.set(1, 1);
    videoTexture.offset.set(0, 0);
  }
};

const checkAspectRatioAndSetMode = () => {
  if (!video) return;
  const { videoWidth, videoHeight } = video;
  if (videoWidth && videoHeight) {
    const ar = videoWidth / videoHeight;
    // SBS 180 videos are typically 2:1 (e.g. 5760x2880) or similar.
    // Standard 16:9 is 1.77.
    // Let's use 1.9 as threshold.
    if (ar > STEREO_ASPECT_RATIO_THRESHOLD) {
      isStereo.value = true;
    } else {
      isStereo.value = false;
    }
    updateTextureMapping();
  }
};

const handleTimeUpdate = () => {
  if (video) emit('timeupdate', video.currentTime);
};

const handleLoadedMetadata = (event?: Event) => {
  checkAspectRatioAndSetMode();
  if (event) {
    emit('loadedmetadata', event);
  }
};

// Named so every listener can be removed again on unmount.
const handlePlay = () => emit('play');
const handlePause = () => emit('pause');
const handlePlaying = () => emit('playing');
const handleEnded = () => emit('ended');
const handleError = (event: Event) => emit('error', event);
const handleWaiting = () => emit('buffering', true);
const handleCanPlay = () => emit('buffering', false);

const videoListeners: [keyof HTMLMediaElementEventMap, (e: Event) => void][] = [
  ['timeupdate', handleTimeUpdate],
  ['loadedmetadata', handleLoadedMetadata],
  ['play', handlePlay],
  ['pause', handlePause],
  ['playing', handlePlaying],
  ['ended', handleEnded],
  ['error', handleError],
  ['waiting', handleWaiting],
  ['canplay', handleCanPlay],
];

const playVideo = () => {
  video?.play().catch((e: unknown) => console.warn('Autoplay prevented:', e));
};

const destroyHls = () => {
  if (hlsSource) {
    hlsSource.destroy();
    hlsSource = null;
  }
};

/**
 * Points the off-screen video at `src`: HLS playlists (transcoded legacy
 * formats) go through hls.js like in VideoPlayer, everything else is set
 * directly.
 */
const loadSource = (src: string) => {
  if (!video) return;
  destroyHls();

  if (needsHlsJs(src)) {
    hlsSource = attachHlsSource(video, src, {
      startPosition: props.initialTime,
      onManifestParsed: () => {
        if (props.isPlaying) playVideo();
      },
      onFatalError: (error) => {
        hlsSource = null;
        emit('error', error);
      },
    });
    return;
  }

  video.src = src;
  if (props.initialTime && props.initialTime > 0) {
    video.currentTime = props.initialTime;
  }
  if (props.isPlaying) playVideo();
};

/** Stops playback and releases the current source (e.g. on item change). */
const reset = () => {
  destroyHls();
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
};

const initThree = () => {
  if (!container.value) return;

  // Scene
  scene = new THREE.Scene();

  // Camera - Offset slightly for OrbitControls to work (non-zero radius)
  const width = container.value.clientWidth;
  const height = container.value.clientHeight;
  camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  // Reset camera position logic if needed, but 0,0,0.1 is fine for initial
  camera.position.set(0, 0, 0.1);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  container.value.appendChild(renderer.domElement);

  // Video Element (off-screen)
  video = document.createElement('video');
  if (props.poster) {
    video.poster = props.poster;
  }
  // No loop: 'ended' must reach MediaDisplay, which replays short videos
  // while the slideshow timer runs and advances otherwise.
  video.muted = false; // Muted by default or handle volume
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.setAttribute('webkit-playsinline', 'true'); // iOS support

  // Playback, error and metadata (AR detection) events for the parent.
  for (const [type, listener] of videoListeners) {
    video.addEventListener(type, listener);
  }

  // Emit the video element so parent can control it (seeking, etc.)
  emit('update:video-element', video);

  loadSource(props.src);

  // Texture
  videoTexture = new THREE.VideoTexture(video);
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  videoTexture.wrapS = THREE.ClampToEdgeWrapping; // Important for non-power-2 videos sometimes
  videoTexture.wrapT = THREE.ClampToEdgeWrapping;

  updateTextureMapping();

  // Geometry: Half sphere for 180 video
  // Radius 500, 60 width segments, 40 height segments
  // phiStart: 0, phiLength: Math.PI (180 degrees)
  sphereGeometry = new THREE.SphereGeometry(
    SPHERE_RADIUS,
    SPHERE_WIDTH_SEGMENTS,
    SPHERE_HEIGHT_SEGMENTS,
    0,
    Math.PI,
    0,
    Math.PI,
  );
  // Invert geometry to view from inside
  sphereGeometry.scale(-1, 1, 1);

  sphereMaterial = new THREE.MeshBasicMaterial({ map: videoTexture });
  sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);

  // The SphereGeometry (0 to PI) is already centered at -Z (Front) relative to the camera
  // so no rotation is needed.
  sphereMesh.rotation.y = 0;

  scene.add(sphereMesh);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0); // Orbit around center
  controls.enableZoom = false; // Disable zoom
  controls.enablePan = false; // Disable pan
  controls.enableDamping = true; // Smooth movement
  controls.dampingFactor = 0.05;
  controls.rotateSpeed = -0.5; // Drag direction natural feel
  controls.update();
  renderer.domElement.addEventListener('pointerdown', handleCanvasPointerDown);

  // Resize listener
  window.addEventListener('resize', handleResize);
  document.addEventListener('fullscreenchange', handleResize);

  // Start loop
  animate();
};

const handleResize = () => {
  if (!container.value || !camera || !renderer) return;

  // Update fullscreen state
  isFullscreen.value = !!document.fullscreenElement;

  const width = container.value.clientWidth;
  const height = container.value.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
};

const animate = () => {
  animationId = window.requestAnimationFrame(animate);

  if (isMotionControlActive.value && camera && deviceOrientation) {
    // Custom Device Orientation Logic (Simplified from Three.js examples)
    const alpha = THREE.MathUtils.degToRad(
      deviceOrientation.alpha - initialOffsetAlpha,
    ); // Z
    const beta = THREE.MathUtils.degToRad(deviceOrientation.beta); // X'
    const gamma = THREE.MathUtils.degToRad(deviceOrientation.gamma); // Y''
    const orient = screenOrientation
      ? THREE.MathUtils.degToRad(screenOrientation)
      : 0; // O

    const euler = new THREE.Euler();
    const q0 = new THREE.Quaternion();
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // - PI/2 around the x-axis

    euler.set(beta, alpha, -gamma, 'YXZ'); // 'ZXY' for the device, but 'YXZ' for us

    const quaternion = new THREE.Quaternion();
    quaternion.setFromEuler(euler);
    quaternion.multiply(q1); // camera looks out the back of the device, not the top
    quaternion.multiply(
      q0.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient),
    ); // adjust for screen orientation

    camera.quaternion.copy(quaternion);
  } else if (controls) {
    controls.update();
  }

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
};

onMounted(() => {
  // Wait for container lay out
  nextTick(() => {
    initThree();
  });
});

onBeforeUnmount(() => {
  if (animationId) cancelAnimationFrame(animationId);
  window.removeEventListener('resize', handleResize);
  document.removeEventListener('fullscreenchange', handleResize);
  stopListeningForOrientation();

  // Dispose GPU-side resources explicitly: renderer.dispose() does not free
  // scene geometries, materials, or textures, and OrbitControls keeps DOM
  // listeners on the canvas — without this, repeated VR open/close leaks.
  if (controls) {
    controls.dispose();
    controls = null;
  }
  if (sphereMesh && scene) {
    scene.remove(sphereMesh);
  }
  sphereMesh = null;
  if (sphereGeometry) {
    sphereGeometry.dispose();
    sphereGeometry = null;
  }
  if (sphereMaterial) {
    sphereMaterial.dispose();
    sphereMaterial = null;
  }
  if (videoTexture) {
    videoTexture.dispose();
    videoTexture = null;
  }
  if (renderer) {
    renderer.domElement.removeEventListener(
      'pointerdown',
      handleCanvasPointerDown,
    );
    renderer.dispose();
  }
  destroyHls();
  if (video) {
    // Detach the listeners first: releasing the source queues media events
    // (pause, emptied...) that must not reach the parent any more.
    for (const [type, listener] of videoListeners) {
      video.removeEventListener(type, listener);
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    video = null;
    emit('update:video-element', null);
  }
  if (container.value && renderer) {
    container.value.removeChild(renderer.domElement);
  }
});

// Watch src changes (e.g. the direct-play -> HLS fallback)
watch(
  () => props.src,
  (newSrc) => {
    loadSource(newSrc);
  },
);

// Watch playing state
watch(
  () => props.isPlaying,
  (newVal) => {
    if (!video) return;
    if (newVal) {
      video.play().catch((e) => console.warn('Play failed', e));
    } else {
      video.pause();
    }
  },
);

defineExpose({
  handleTimeUpdate,
  handleLoadedMetadata,
  initThree,
  toggleFullscreen,
  isFullscreen,
  togglePlay,
  togglePlayback,
  reset,
});
</script>

<style scoped>
.vr-container {
  overflow: hidden;
  cursor: grab;
}
.vr-container:active {
  cursor: grabbing;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
