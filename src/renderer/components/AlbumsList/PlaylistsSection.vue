<template>
  <div class="mb-4">
    <h3 class="px-3 text-xs font-bold text-muted uppercase tracking-wider mb-2">
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

      <!-- SMART PLAYLISTS -->
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
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useLibraryStore } from '../../composables/useLibraryStore';
import { useUIStore } from '../../composables/useUIStore';
import { useSlideshow } from '../../composables/useSlideshow';
import { useToast } from '../../composables/useToast';
import { api } from '../../api';
import type { Album, SmartPlaylist, MediaFile } from '../../../core/types';
import { RECENTLY_PLAYED_FETCH_LIMIT } from '../../../core/constants';
import HistoryIcon from '../icons/HistoryIcon.vue';
import GridIcon from '../icons/GridIcon.vue';
import PlaylistIcon from '../icons/PlaylistIcon.vue';
import EditIcon from '../icons/EditIcon.vue';
import DeleteIcon from '../icons/DeleteIcon.vue';

const libraryStore = useLibraryStore();
const uiStore = useUIStore();
const slideshow = useSlideshow();
const toast = useToast();

const { allAlbums, smartPlaylists } = storeToRefs(libraryStore);
const {
  isSmartPlaylistModalVisible,
  gridMediaFiles,
  viewMode,
  playlistToEdit,
  isHistoryMode,
} = storeToRefs(uiStore);

const loadingAction = ref<string | null>(null);

const getMediaForPlaylist = async (
  playlist: SmartPlaylist,
): Promise<MediaFile[]> => {
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

  const dbItems = await api.executeSmartPlaylist(playlist.criteria);
  const result: MediaFile[] = [];

  for (const item of dbItems) {
    const file = fileMap.get(item.file_path);
    if (file) {
      result.push({
        ...file,
        viewCount: item.view_count || 0,
        rating: item.rating || 0,
        duration: item.duration || 0,
        playbackPosition: item.playback_position || 0,
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

const loadHistory = async () => {
  await libraryStore.fetchHistory(RECENTLY_PLAYED_FETCH_LIMIT);
  if (libraryStore.historyMedia.length === 0) {
    throw new Error('No history items found');
  }
};

const handleHistoryGrid = async () => {
  if (loadingAction.value) return;
  loadingAction.value = 'history-grid';
  try {
    await loadHistory();
    gridMediaFiles.value = libraryStore.historyMedia;
    await nextTick();
    isHistoryMode.value = true;
    viewMode.value = 'grid';
  } catch (e) {
    console.error('Error opening history grid', e);
  } finally {
    loadingAction.value = null;
  }
};

const handleHistorySlideshow = async () => {
  if (loadingAction.value) return;
  loadingAction.value = 'history-slideshow';
  try {
    await loadHistory();
    const historyMedia = libraryStore.historyMedia;
    slideshow.startHistorySlideshow(historyMedia);
  } catch (e) {
    console.error('Error starting history slideshow', e);
  } finally {
    loadingAction.value = null;
  }
};
</script>
