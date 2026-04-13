<template>
  <div class="app-container min-h-screen flex flex-col relative">
    <a
      href="#main-content"
      class="absolute top-4 left-4 z-[100] -translate-y-[150%] focus:translate-y-0 transition-transform bg-indigo-600 text-white px-4 py-2 rounded-md font-bold shadow-lg focus:outline-none focus:ring-2 focus:ring-white"
    >
      Skip to content
    </a>
    <AmbientBackground />

    <!-- Main Content Layer -->
    <main
      class="relative z-10 grow flex flex-col md:flex-row p-0 md:p-6 gap-0 md:gap-6 overflow-hidden h-[100dvh] transition-all duration-300 ease-in-out"
    >
      <!-- Sidebar (Collapsible/Floating) -->
      <!-- Mobile: Fixed Overlay, Desktop: Static Sidebar with Width Transition -->
      <transition name="slide-fade">
        <AlbumsList
          v-if="isSidebarVisible"
          class="fixed inset-0 z-50 md:static md:shrink-0 w-full md:w-80 h-full bg-transparent p-0"
          @close="isSidebarVisible = false"
        />
      </transition>

      <!-- Main Media Area -->
      <div
        id="main-content"
        tabindex="-1"
        class="grow flex flex-col h-full relative w-full min-w-0 outline-none"
        :class="{
          'glass-panel md:rounded-xl overflow-hidden': viewMode === 'player',
        }"
        data-testid="main-content-area"
        @mousemove="handleMouseMove"
        @touchstart="handleInteraction"
        @click="handleInteraction"
        @mouseleave="handleMouseLeave"
      >
        <!-- Gradient Overlay (Player Mode Only) -->

        <!-- Top Bar (Toggle Sidebar & Title) -->
        <div
          class="absolute top-0 left-0 w-full flex justify-between items-center p-3 transition-opacity duration-500 ease-in-out z-40 pointer-events-none"
          :class="[
            viewMode === 'player' ? '' : 'glass-panel md:rounded-lg',
            {
              'opacity-0': !isControlsVisible && viewMode === 'player',
            },
          ]"
        >
          <button
            class="icon-button p-2 rounded-full hover:bg-white/10 transition-colors pointer-events-auto"
            :aria-label="isSidebarVisible ? 'Hide Albums' : 'Show Albums'"
            @click="isSidebarVisible = !isSidebarVisible"
          >
            <MenuIcon class="w-6 h-6" />
          </button>

          <!-- Title / Filename -->
          <h1
            class="text-lg font-bold bg-clip-text text-transparent bg-linear-to-r from-blue-400 to-indigo-500 truncate mx-4"
          >
            {{
              viewMode === 'player' && currentMediaItem
                ? currentMediaItem.name
                : 'MediaPlayer'
            }}
          </h1>

          <button
            class="icon-button p-2 rounded-full hover:bg-white/10 transition-colors pointer-events-auto"
            aria-label="Keyboard Shortcuts"
            title="Keyboard Shortcuts"
            @click="isShortcutsModalOpen = true"
          >
            <HelpIcon class="w-6 h-6" />
          </button>
        </div>

        <!-- Media Display -->
        <MediaGrid
          v-if="viewMode === 'grid'"
          class="grow glass-panel md:rounded-xl overflow-hidden"
        />
        <MediaDisplay
          v-else
          class="grow md:rounded-xl overflow-hidden"
          @open-shortcuts="isShortcutsModalOpen = true"
        />
      </div>
    </main>

    <SourcesModal />
    <SmartPlaylistModal
      :playlist-to-edit="playlistToEdit"
      @close="playlistToEdit = null"
    />
    <KeyboardShortcutsModal
      :is-open="isShortcutsModalOpen"
      @close="isShortcutsModalOpen = false"
    />
    <ToastContainer />
    <LoadingMask v-if="isScanning" />
    <LockScreen v-if="isAuthInitialized && isLocked" />
  </div>
</template>

<script setup lang="ts">
/**
 * @file The main Vue component for the application.
 * It sets up the overall layout, initializes the application state,
 * and handles global keyboard shortcuts for media navigation.
 */
import { onMounted, onBeforeUnmount, watch, ref } from 'vue';
import AmbientBackground from './components/AmbientBackground.vue';
import AlbumsList from './components/AlbumsList.vue';
import MediaDisplay from './components/MediaDisplay.vue';
import MediaGrid from './components/MediaGrid.vue';
import SourcesModal from './components/SourcesModal.vue';
import SmartPlaylistModal from './components/SmartPlaylistModal.vue';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal.vue';
import ToastContainer from './components/ToastContainer.vue';
import LoadingMask from './components/LoadingMask.vue';
import LockScreen from './components/LockScreen.vue';
import MenuIcon from './components/icons/MenuIcon.vue';
import HelpIcon from './components/icons/HelpIcon.vue';
import { useLibraryStore } from './composables/useLibraryStore';
import { usePlayerStore } from './composables/usePlayerStore';
import { usePlaylistStore } from './composables/usePlaylistStore';
import { useUIStore } from './composables/useUIStore';
import { useAuthStore } from './composables/useAuthStore';
import { useSlideshow } from './composables/useSlideshow';
import { useTheme } from './composables/useTheme';
import { CONTROLS_HIDE_TIMEOUT_MS } from '../core/constants';

const libraryStore = useLibraryStore();
const uiStore = useUIStore();
const playerStore = usePlayerStore(); // Call the store to get the instance
const playlistStore = usePlaylistStore();
const authStore = useAuthStore();
const { isScanning } = libraryStore;
const { viewMode, playlistToEdit, isControlsVisible, isSidebarVisible } =
  uiStore;
const { isSlideshowActive, mainVideoElement } = playerStore; // Destructure from the instance
const { currentItem: currentMediaItem } = playlistStore;
const { isLocked, isInitialized: isAuthInitialized } = authStore;
const initializeApp = libraryStore.loadInitialData;
const { navigateMedia, toggleSlideshowTimer } = useSlideshow();
const { initTheme, cleanupTheme } = useTheme();
initTheme();

const isShortcutsModalOpen = ref(false);

let controlsTimeout: NodeJS.Timeout | null = null;

const handleInteraction = () => {
  // Show controls on any interaction (touch, click, mouse move)
  if (!isControlsVisible.value) {
    isControlsVisible.value = true;
  }

  if (controlsTimeout) clearTimeout(controlsTimeout);

  // Only auto-hide if in player mode
  if (viewMode.value === 'player') {
    controlsTimeout = setTimeout(() => {
      // Only hide if video is playing (not paused)
      const isVideoPaused =
        mainVideoElement.value && mainVideoElement.value.paused;

      if (!isVideoPaused) {
        isControlsVisible.value = false;
      }
    }, CONTROLS_HIDE_TIMEOUT_MS);
  }
};

const handleMouseMove = () => {
  handleInteraction();
};

const handleMouseLeave = () => {
  // If we leave the app window or main area, hide immediately unless paused
  const isVideoPaused = mainVideoElement.value && mainVideoElement.value.paused;
  // console.error debugging removed
  if (!isVideoPaused && viewMode.value === 'player') {
    isControlsVisible.value = false;
  }
};

/**
 * Handles global keydown events for slideshow control.
 * @param event - The keyboard event object.
 */
const handleKeydown = (event: KeyboardEvent) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    (event.target as HTMLElement).isContentEditable
  ) {
    return;
  }

  // Handle navigation (Z = Previous, X = Next)
  // We allow this globally as Z/X are unlikely to conflict with standard typing unless focused on input (handled above)
  switch (event.key.toLowerCase()) {
    case 'z':
      event.preventDefault();
      navigateMedia(-1); // Navigate to the previous media item
      break;
    case 'x':
      event.preventDefault();
      navigateMedia(1); // Navigate to the next media item
      break;
    case ' ':
      // In grid view, spacebar toggles the slideshow timer.
      // In player view, this is handled by the MediaDisplay component.
      if (viewMode.value === 'grid') {
        event.preventDefault();
        toggleSlideshowTimer();
      }
      break;
    case '?':
      // Shift + / usually
      event.preventDefault();
      isShortcutsModalOpen.value = !isShortcutsModalOpen.value;
      break;
  }
};

// On component mount, initialize the app and add the keyboard event listener
onMounted(async () => {
  await authStore.checkLockStatus();
  if (!isLocked.value) {
    await initializeApp();
  }
  document.addEventListener('keydown', handleKeydown);
});

// Watch for slideshow active state to auto-close sidebar
// This improves the experience on mobile and desktop by clearing clutter
watch(
  isSlideshowActive, // Watch the ref directly
  (isActive) => {
    if (isActive) {
      isSidebarVisible.value = false;
    }
  },
);

// Before unmounting, clean up by removing the event listener
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
  cleanupTheme();
});
</script>

<style scoped>
.app-container {
  /* Background handled by AmbientBackground */
  background-color: transparent;
}

.text-accent {
  color: var(--accent-color);
}

.font-header {
  font-family: var(--header-font);
}

.icon-button {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-weight: 600;
  transition: color 0.2s;
}

.icon-button:hover {
  color: var(--accent-color);
}

/* Transitions */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s ease-out;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(-20px);
  opacity: 0;
}

@media (min-width: 768px) {
  .slide-fade-enter-active,
  .slide-fade-leave-active {
    /* Explicitly animate width and margin for smooth resize */
    transition:
      width 0.3s ease-out,
      margin-right 0.3s ease-out,
      opacity 0.2s ease-out,
      transform 0.3s ease-out;
    width: 20rem; /* w-80 */
    margin-right: 1.5rem; /* mr-6 */
    overflow: hidden; /* Prevent content spill during resize */
  }

  .slide-fade-enter-from,
  .slide-fade-leave-to {
    width: 0;
    margin-right: 0;
    opacity: 0;
    transform: translateX(-30px);
  }
}
</style>
