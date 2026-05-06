<template>
  <!-- Overall Container: Transparent Flexbox to space out 3 glass segments -->
  <div class="h-full flex flex-col relative gap-4">
    <!-- 1. HEADER PANEL: Matched to Top Bar -->
    <div
      class="shrink-0 flex items-center justify-between p-3 glass-panel rounded-lg z-10"
    >
      <!-- Mobile Close Button (only visible on mobile) -->
      <button
        class="md:hidden text-muted hover:text-accent mr-2"
        aria-label="Close Sidebar"
        title="Close Sidebar"
        @click="$emit('close')"
      >
        <CloseIcon class="w-5 h-5" />
      </button>

      <h2 class="text-color font-bold tracking-tight text-sm uppercase">
        Library
      </h2>

      <div class="flex items-center gap-1">
        <button
          class="p-2 text-muted hover:text-accent hover:bg-black/5 rounded-md transition-colors"
          title="Manage Sources"
          aria-label="Manage Sources"
          @click="openModal"
        >
          <SettingsIcon class="w-5 h-5" />
        </button>

        <button
          class="p-2 text-muted hover:text-accent hover:bg-black/5 rounded-md transition-colors"
          title="Add Playlist"
          aria-label="Add Playlist"
          @click="openSmartPlaylistModal"
        >
          <PlaylistAddIcon class="w-5 h-5" />
        </button>

        <!-- Theme Selector Dropdown -->
        <div class="relative">
          <button
            class="p-2 text-muted hover:text-accent hover:bg-black/5 rounded-md transition-all duration-200"
            aria-label="Select Theme"
            :title="`Current Theme: ${themeMode}`"
            @click.stop="isThemeDropdownOpen = !isThemeDropdownOpen"
          >
            <ThemeIcon :mode="themeMode" class="w-5 h-5" />
          </button>

          <!-- Dropdown Menu -->
          <transition name="fade-slide-up">
            <div
              v-if="isThemeDropdownOpen"
              ref="themeDropdownRef"
              class="absolute top-full right-0 mt-2 w-36 glass-panel rounded-xl shadow-2xl py-2 z-60 overflow-hidden"
            >
              <button
                v-for="theme in AVAILABLE_THEMES"
                :key="theme.id"
                class="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-200 text-left"
                :class="
                  themeMode === theme.id
                    ? 'bg-accent/20 text-button-text font-bold'
                    : 'text-muted hover:bg-black/10 hover:text-accent'
                "
                @click="selectTheme(theme.id)"
              >
                <ThemeIcon :mode="theme.id" class="w-4 h-4 shrink-0" />
                <span>{{ theme.label }}</span>
              </button>
            </div>
          </transition>
        </div>
      </div>
    </div>

    <!-- 2. CONTENT WRAPPER: Scrollable container -->
    <div class="grow relative flex flex-col min-h-0">
      <!-- SINGLE SCROLLABLE AREA -->
      <div class="grow overflow-y-auto custom-scrollbar flex flex-col gap-4">
        <!-- A. ALBUMS & PLAYLISTS LIST CARD -->
        <div class="shrink-0 px-2 py-4 glass-panel rounded-xl">
          <!-- SECTION: ALBUMS -->
          <div class="mb-6">
            <h3
              class="px-3 text-xs font-bold text-muted uppercase tracking-wider mb-2"
            >
              Albums
            </h3>
            <ul class="space-y-0.5">
              <li v-if="mediaDirectories.length === 0" class="px-1">
                <button
                  class="w-full text-left text-sm text-accent hover:text-accent-secondary hover:bg-white/5 p-2 rounded-md transition-colors flex items-center gap-2 group focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  @click="openModal"
                >
                  <div
                    class="bg-accent/20 p-1.5 rounded-md group-hover:bg-accent/30 transition-colors"
                  >
                    <PlaylistAddIcon class="w-4 h-4" />
                  </div>
                  <span>Add your first source...</span>
                </button>
              </li>
              <li
                v-else-if="allAlbums.length === 0"
                class="px-3 py-4 text-center"
              >
                <p class="text-xs text-muted mb-2">
                  No albums found in your sources.
                </p>
                <button
                  class="text-xs text-accent hover:text-accent-secondary underline"
                  @click="openModal"
                >
                  Manage Sources
                </button>
              </li>
              <AlbumTree
                v-for="album in allAlbums"
                :key="album.id"
                :album="album"
                :selection="albumsSelectedForSlideshow"
                @toggle-selection="handleToggleSelection"
                @album-click="handleClickAlbum"
              />
            </ul>
          </div>

          <!-- SECTION: SMART PLAYLISTS -->
          <div class="mb-4">
            <h3
              class="px-3 text-xs font-bold text-muted uppercase tracking-wider mb-2"
            >
              Playlists
            </h3>
            <ul class="space-y-0.5">
              <!-- RECENTLY PLAYED -->
              <li>
                <div
                  class="group flex items-center justify-between px-3 py-2 rounded-md hover:bg-white/5 transition-colors"
                >
                  <!-- Name (Main Action - Slideshow) -->
                  <button
                    class="grow flex items-center gap-2 truncate text-sm text-color group-hover:text-accent text-left focus:outline-none cursor-pointer min-w-0"
                    aria-label="Recently Played Slideshow"
                    :disabled="!!loadingAction"
                    @click="handleHistorySlideshow"
                  >
                    <span class="text-accent-secondary shrink-0">
                      <svg
                        v-if="loadingAction === 'history-slideshow'"
                        class="animate-spin w-4 h-4"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          class="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="4"
                        ></circle>
                        <path
                          class="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      <HistoryIcon v-else class="w-4 h-4" />
                    </span>
                    <span class="truncate">Recently Played</span>
                  </button>

                  <!-- Controls on Hover -->
                  <div
                    class="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity ml-2"
                  >
                    <!-- Grid Button for History -->
                    <button
                      class="text-xs text-muted hover:text-accent p-1"
                      title="Open in Grid"
                      aria-label="Open History in Grid"
                      :disabled="!!loadingAction"
                      @click.stop="handleHistoryGrid"
                    >
                      <svg
                        v-if="loadingAction === 'history-grid'"
                        class="animate-spin w-4 h-4"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          class="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="4"
                        ></circle>
                        <path
                          class="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      <GridIcon v-else class="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>

              <li v-for="playlist in smartPlaylists" :key="playlist.id">
                <div
                  class="group flex items-center justify-between px-3 py-2 rounded-md hover:bg-white/5 transition-colors"
                >
                  <!-- Name (Main Action) -->
                  <button
                    class="grow flex items-center gap-2 truncate text-sm text-color group-hover:text-accent text-left focus:outline-none cursor-pointer min-w-0"
                    :aria-label="'Play ' + playlist.name"
                    :disabled="!!loadingAction"
                    @click="handleSmartPlaylistSlideshow(playlist)"
                  >
                    <span class="text-accent shrink-0">
                      <svg
                        v-if="loadingAction === `playlist-${playlist.id}`"
                        class="animate-spin w-4 h-4"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          class="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="4"
                        ></circle>
                        <path
                          class="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      <!-- Small Playlist Icon -->
                      <PlaylistIcon v-else class="w-4 h-4" />
                    </span>
                    <span class="truncate">{{ playlist.name }}</span>
                  </button>

                  <!-- Controls on Hover -->
                  <div
                    class="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity ml-2"
                  >
                    <!-- Grid Button for Playlist -->
                    <button
                      class="text-xs text-muted hover:text-accent p-1"
                      title="Open in Grid"
                      :aria-label="'Open ' + playlist.name + ' in Grid'"
                      :disabled="!!loadingAction"
                      @click.stop="handleSmartPlaylistGrid(playlist)"
                    >
                      <svg
                        v-if="loadingAction === `playlist-grid-${playlist.id}`"
                        class="animate-spin w-4 h-4"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          class="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="4"
                        ></circle>
                        <path
                          class="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      <GridIcon v-else class="w-4 h-4" />
                    </button>
                    <button
                      class="text-xs text-gray-500 hover:text-blue-400 p-1"
                      title="Edit"
                      :aria-label="'Edit ' + playlist.name"
                      @click.stop="editPlaylist(playlist)"
                    >
                      <EditIcon class="w-3.5 h-3.5" />
                    </button>
                    <button
                      class="text-xs text-gray-500 hover:text-red-400 p-1"
                      title="Delete"
                      :aria-label="'Delete ' + playlist.name"
                      @click.stop="deletePlaylist(playlist.id)"
                    >
                      <DeleteIcon class="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>
              <li
                v-if="smartPlaylists.length === 0"
                class="px-3 text-sm text-gray-600 italic"
              >
                No playlists created.
              </li>
            </ul>
          </div>
        </div>
        <!-- End of list content -->

        <!-- B. SLIDESHOW SETTINGS CARD -->
        <div class="shrink-0 p-3 flex flex-col gap-2 glass-panel rounded-xl">
          <!-- Media Type Filters -->
          <div class="flex justify-center bg-black/20 rounded-lg p-1 gap-1">
            <button
              v-for="filter in MEDIA_FILTERS"
              :key="filter"
              class="flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-all duration-200"
              :class="
                mediaFilter === filter
                  ? 'bg-accent text-button-text shadow-sm'
                  : 'text-muted hover:text-accent hover:bg-black/5'
              "
              :aria-pressed="mediaFilter === filter"
              @click="setFilter(filter)"
            >
              {{ filter }}
            </button>
          </div>

          <!-- Toggles -->
          <div class="flex gap-2">
            <label class="flex-1 glass-toggle-btn cursor-pointer group">
              <input
                v-model="pauseTimerOnPlay"
                type="checkbox"
                class="peer sr-only"
              />
              <div
                class="h-full px-3 py-2 rounded-md bg-black/20 border border-white/5 peer-checked:bg-accent/20 peer-checked:border-accent/50 peer-focus-visible:ring-2 peer-focus-visible:ring-accent transition-all flex items-center justify-center gap-2"
              >
                <div
                  class="w-3 h-3 rounded-sm border border-muted peer-checked:bg-accent peer-checked:border-accent flex items-center justify-center"
                >
                  <svg
                    v-if="pauseTimerOnPlay"
                    class="w-2.5 h-2.5 text-white"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="4"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
                <span
                  class="text-[10px] font-medium text-muted group-hover:text-color peer-checked:text-accent-secondary"
                  >Pause Timer</span
                >
              </div>
            </label>
          </div>
        </div>

        <!-- C. TIMER PANEL CARD -->
        <div
          class="shrink-0 p-3 flex items-end gap-3 relative overflow-hidden glass-panel rounded-xl"
        >
          <div class="flex flex-col gap-1 grow">
            <label
              for="timer-input"
              class="text-[10px] font-bold text-gray-500 uppercase tracking-widest"
              >Timer Duration</label
            >
            <div class="relative">
              <input
                id="timer-input"
                v-model.number="timerDuration"
                type="number"
                min="1"
                step="1"
                placeholder="5"
                aria-label="Slideshow timer duration in seconds"
                class="w-full glass-input text-sm pl-3 pr-10 py-2 rounded-lg no-spinner"
                @blur="
                  timerDuration = Math.max(1, Math.floor(timerDuration) || 5)
                "
              />
              <span
                class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none"
                >sec</span
              >
            </div>
          </div>

          <!-- Shuffle All Sources -->
          <button
            class="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-accent hover:bg-black/5 transition-colors"
            title="Shuffle All Sources"
            aria-label="Shuffle All Sources"
            @click="slideshow.startSlideshow()"
          >
            <ShuffleIcon class="w-5 h-5" />
          </button>

          <!-- Primary Play Action -->
          <button
            class="timer-button h-10 w-14 shrink-0 flex items-center justify-center rounded-lg glass-button-primary"
            data-testid="timer-button"
            :title="
              isTimerRunning ? 'Pause Slideshow' : 'Start/Resume Slideshow'
            "
            :aria-label="
              isTimerRunning ? 'Pause Slideshow' : 'Start/Resume Slideshow'
            "
            @click="handleToggleTimer"
          >
            <PauseIcon v-if="isTimerRunning" class="w-6 h-6 fill-current" />
            <PlayIcon v-else class="w-6 h-6 fill-current ml-1" />
          </button>

          <!-- Global Progress Bar (if running, inside timer pane bottom) -->
          <div
            v-if="isTimerRunning"
            class="absolute bottom-0 left-0 w-full h-1 bg-gray-800"
            data-testid="slideshow-progress"
          >
            <div
              class="h-full bg-accent transition-all duration-100 ease-linear"
              :style="{ width: `${timerProgress}%` }"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file This component displays the list of all available media albums in a tree structure.
 * It provides controls for starting a global slideshow, managing the timer,
 * opening the sources modal, and selecting/deselecting albums for the slideshow.
 * Clicking on an album's name starts a slideshow for that specific album and its sub-albums.
 */
import { nextTick, ref, onMounted, onBeforeUnmount } from 'vue';
import { AVAILABLE_THEMES, type ThemeId } from '../../core/themes';
import { useLibraryStore } from '../composables/useLibraryStore';
import { usePlayerStore } from '../composables/usePlayerStore';
import { useUIStore } from '../composables/useUIStore';
import { useSlideshow } from '../composables/useSlideshow';
import { useToast } from '../composables/useToast';
import AlbumTree from './AlbumTree.vue';
import CloseIcon from './icons/CloseIcon.vue';
import PlayIcon from './icons/PlayIcon.vue';
import PauseIcon from './icons/PauseIcon.vue';
import ShuffleIcon from './icons/ShuffleIcon.vue';
import SettingsIcon from './icons/SettingsIcon.vue';
import PlaylistAddIcon from './icons/PlaylistAddIcon.vue';
import PlaylistIcon from './icons/PlaylistIcon.vue';
import GridIcon from './icons/GridIcon.vue';
import EditIcon from './icons/EditIcon.vue';
import DeleteIcon from './icons/DeleteIcon.vue';
import HistoryIcon from './icons/HistoryIcon.vue';
import ThemeIcon from './icons/ThemeIcon.vue';
import { api } from '../api';
import {
  getAlbumAndChildrenIds,
  collectTexturesRecursive,
} from '../utils/albumUtils';
import type { Album, SmartPlaylist, MediaFile } from '../../core/types';
import { MEDIA_FILTERS, type MediaFilter } from '../../core/constants';
import { RECENTLY_PLAYED_FETCH_LIMIT } from '../../core/constants';

const libraryStore = useLibraryStore();
const playerStore = usePlayerStore();
const uiStore = useUIStore();
const { themeMode } = uiStore;

const isThemeDropdownOpen = ref(false);
const themeDropdownRef = ref<HTMLElement | null>(null);

const selectTheme = (id: ThemeId) => {
  themeMode.value = id;
  isThemeDropdownOpen.value = false;
};

const handleOutsideClick = (event: MouseEvent) => {
  if (
    isThemeDropdownOpen.value &&
    themeDropdownRef.value &&
    !themeDropdownRef.value.contains(event.target as Node)
  ) {
    isThemeDropdownOpen.value = false;
  }
};

onMounted(() => {
  window.addEventListener('click', handleOutsideClick);
});

onBeforeUnmount(() => {
  window.removeEventListener('click', handleOutsideClick);
});

const {
  allAlbums,
  albumsSelectedForSlideshow,
  smartPlaylists,
  mediaDirectories,
} = libraryStore;

const {
  timerDuration,
  isTimerRunning,
  timerProgress,
  isSlideshowActive,
  pauseTimerOnPlay,
} = playerStore;

const {
  isSourcesModalVisible,
  isSmartPlaylistModalVisible,
  gridMediaFiles,
  viewMode,
  playlistToEdit,
  mediaFilter,
  isHistoryMode,
} = uiStore;

const loadingAction = ref<string | null>(null);

defineEmits(['close']);

const slideshow = useSlideshow();
const toast = useToast();
// libraryStore is already defined above

/**
 * Toggles the selection of an album. Can be recursive (children included) or single.
 * @param payload - The event payload containing the album and recursive flag.
 */
const handleToggleSelection = ({
  album,
  recursive,
}: {
  album: Album;
  recursive: boolean;
}) => {
  if (recursive) {
    const ids = getAlbumAndChildrenIds(album);
    // Determine the new state: if any child is unselected, the new state is "selected" (true).
    // Otherwise, if all are selected, the new state is "unselected" (false).
    const newSelectionState = ids.some(
      (id) => !albumsSelectedForSlideshow.value[id],
    );

    for (const id of ids) {
      slideshow.toggleAlbumSelection(id, newSelectionState);
    }
  } else {
    // Single mode: Toggle only this album
    const current = albumsSelectedForSlideshow.value[album.id];
    slideshow.toggleAlbumSelection(album.id, !current);
  }
};

/**
 * Starts a slideshow for a single album and all its sub-albums.
 * @param album - The album to start the slideshow for.
 */
const handleClickAlbum = (album: Album) => {
  isHistoryMode.value = false;
  const textures = collectTexturesRecursive(album);
  const albumWithAllTextures = { ...album, textures };
  slideshow.startIndividualAlbumSlideshow(albumWithAllTextures);
};

/**
 * Toggles the slideshow timer (play/pause).
 */
const handleToggleTimer = () => {
  if (!isSlideshowActive.value) {
    slideshow.startSlideshow();
  }
  slideshow.toggleSlideshowTimer();
};

/**
 * Opens the 'Manage Sources' modal.
 */
const openModal = () => {
  isSourcesModalVisible.value = true;
};

const openSmartPlaylistModal = () => {
  isSmartPlaylistModalVisible.value = true;
};

const getMediaForPlaylist = async (
  playlist: SmartPlaylist,
): Promise<MediaFile[]> => {
  // 1. Get all known media files from the loaded albums (Source of Truth for existence)
  const fileMap = new Map<string, MediaFile>();
  const traverse = (albums: Album[]) => {
    for (const album of albums) {
      if (album.textures) {
        for (const file of album.textures) {
          fileMap.set(file.path, file);
        }
      }
      if (album.children) traverse(album.children);
    }
  };
  traverse(allAlbums.value);

  // 2. Get MATCHING metadata/stats from DB using criteria
  // Bolt Optimization: Filter in DB to reduce IPC/Memory and avoid fetching entire library
  const dbItems = await api.executeSmartPlaylist(playlist.criteria);

  // 3. Map DB items to MediaFiles (only if they exist in library)
  const result: MediaFile[] = [];

  for (const item of dbItems) {
    const file = fileMap.get(item.file_path);
    if (file) {
      result.push({
        ...file,
        viewCount: item.view_count || 0,
        rating: item.rating || 0,
        duration: item.duration || 0,
      });
    }
  }

  return result;
};

const handleSmartPlaylistSlideshow = async (playlist: SmartPlaylist) => {
  if (loadingAction.value) return;
  loadingAction.value = `playlist-${playlist.id}`;
  try {
    const mediaFiles = await getMediaForPlaylist(playlist);
    if (mediaFiles.length === 0) {
      toast.error(
        'Playlist is empty. Please ensure your criteria match existing media files.',
      );
      return;
    }

    const fakeAlbum: Album = {
      id: `playlist-${playlist.id}`,
      name: playlist.name,
      textures: mediaFiles,
      children: [],
    };
    isHistoryMode.value = false;
    slideshow.startIndividualAlbumSlideshow(fakeAlbum);
  } catch (error) {
    console.error('Error starting playlist slideshow', error);
  } finally {
    loadingAction.value = null;
  }
};

const handleSmartPlaylistGrid = async (playlist: SmartPlaylist) => {
  if (loadingAction.value) return;
  loadingAction.value = `playlist-grid-${playlist.id}`;
  try {
    const mediaFiles = await getMediaForPlaylist(playlist);
    gridMediaFiles.value = mediaFiles;
    // Use nextTick to allow event bubbling to complete before potentially unmounting components (fix for happy-dom/tests)
    await nextTick();
    isHistoryMode.value = false;
    viewMode.value = 'grid';
  } catch (error) {
    console.error('Error opening playlist grid', error);
  } finally {
    loadingAction.value = null;
  }
};

const deletePlaylist = async (id: number) => {
  if (!confirm('Delete this playlist?')) return;
  try {
    await api.deleteSmartPlaylist(id);
    smartPlaylists.value = await api.getSmartPlaylists();
    toast.success('Playlist deleted');
  } catch (e) {
    console.error('Failed to delete playlist', e);
    toast.error(
      'Failed to delete playlist. Please try again or check the logs for more details.',
    );
  }
};

const editPlaylist = (playlist: SmartPlaylist) => {
  playlistToEdit.value = playlist;
  isSmartPlaylistModalVisible.value = true;
};

// History Handling
const loadHistory = async () => {
  await libraryStore.fetchHistory(RECENTLY_PLAYED_FETCH_LIMIT);
  // Ensure we have actual media files
  if (libraryStore.state.historyMedia.length === 0) {
    throw new Error('No history items found');
  }
};

const handleHistoryGrid = async () => {
  if (loadingAction.value) return;
  loadingAction.value = 'history-grid';
  try {
    await loadHistory();
    gridMediaFiles.value = libraryStore.state.historyMedia;
    await nextTick();
    isHistoryMode.value = true;
    viewMode.value = 'grid';
  } catch (e) {
    console.error('Error opening history grid', e);
    // Optional: show user feedback
  } finally {
    loadingAction.value = null;
  }
};

const { reapplyFilter } = slideshow;

const setFilter = async (filter: MediaFilter) => {
  mediaFilter.value = filter;
  await reapplyFilter();
};

const handleHistorySlideshow = async () => {
  if (loadingAction.value) return;
  loadingAction.value = 'history-slideshow';
  try {
    await loadHistory();
    const historyMedia = libraryStore.state.historyMedia;
    slideshow.startHistorySlideshow(historyMedia);
  } catch (e) {
    console.error('Error starting history slideshow', e);
    // Optional: show user feedback
  } finally {
    loadingAction.value = null;
  }
};
</script>

<style scoped>
/* Chrome, Safari, Edge, Opera */
.no-spinner::-webkit-outer-spin-button,
.no-spinner::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Firefox */
.no-spinner {
  appearance: textfield;
  -moz-appearance: textfield;
}
</style>
