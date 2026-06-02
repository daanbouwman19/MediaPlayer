<template>
  <div class="mb-6">
    <h3 class="px-3 text-xs font-bold text-muted uppercase tracking-wider mb-2">
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
      <li v-else-if="allAlbums.length === 0" class="px-3 py-4 text-center">
        <p class="text-xs text-muted mb-2">No albums found in your sources.</p>
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
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useLibraryStore } from '../../composables/useLibraryStore';
import { useUIStore } from '../../composables/useUIStore';
import { useSlideshow } from '../../composables/useSlideshow';
import {
  getAlbumAndChildrenIds,
  collectTexturesRecursive,
} from '../../utils/albumUtils';
import type { Album } from '../../../core/media/types';
import AlbumTree from '../AlbumTree.vue';
import PlaylistAddIcon from '../icons/PlaylistAddIcon.vue';

const libraryStore = useLibraryStore();
const uiStore = useUIStore();
const slideshow = useSlideshow();

const { allAlbums, albumsSelectedForSlideshow, mediaDirectories } =
  storeToRefs(libraryStore);
const { isSourcesModalVisible, isHistoryMode } = storeToRefs(uiStore);

const openModal = () => {
  isSourcesModalVisible.value = true;
};

const handleToggleSelection = ({
  album,
  recursive,
}: {
  album: Album;
  recursive: boolean;
}) => {
  if (recursive) {
    const ids = getAlbumAndChildrenIds(album);
    const newSelectionState = ids.some(
      (id) => !albumsSelectedForSlideshow.value[id],
    );

    for (const id of ids) {
      slideshow.toggleAlbumSelection(id, newSelectionState);
    }
  } else {
    const current = albumsSelectedForSlideshow.value[album.id];
    slideshow.toggleAlbumSelection(album.id, !current);
  }
};

const handleClickAlbum = (album: Album) => {
  isHistoryMode.value = false;
  const textures = collectTexturesRecursive(album);
  const albumWithAllTextures = { ...album, textures };
  slideshow.startIndividualAlbumSlideshow(albumWithAllTextures);
};
</script>
