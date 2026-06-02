<template>
  <div class="h-full flex flex-col relative gap-4">
    <!-- 1. HEADER PANEL: Matched to Top Bar -->
    <AlbumsListHeader @close="$emit('close')" />

    <!-- 2. CONTENT WRAPPER: Albums scrollable, controls fixed at bottom -->
    <div class="grow relative flex flex-col min-h-0 gap-4">
      <!-- SCROLLABLE ALBUMS AREA -->
      <div class="grow overflow-y-auto custom-scrollbar min-h-0">
        <!-- A. ALBUMS & PLAYLISTS LIST CARD -->
        <div class="px-2 py-4 glass-panel rounded-xl">
          <!-- SECTION: ALBUMS -->
          <AlbumsSection />

          <!-- SECTION: SMART PLAYLISTS -->
          <PlaylistsSection />

          <!-- SECTION: PLAYBACK QUEUE -->
          <QueueSection class="mt-4" />
        </div>
      </div>
      <!-- End of scrollable albums area -->

      <!-- B. SLIDESHOW SETTINGS CARD -->
      <SlideshowSettings />

      <!-- C. TIMER PANEL CARD -->
      <TimerPanel />
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
import AlbumsListHeader from './AlbumsList/AlbumsListHeader.vue';
import AlbumsSection from './AlbumsList/AlbumsSection.vue';
import PlaylistsSection from './AlbumsList/PlaylistsSection.vue';
import QueueSection from './AlbumsList/QueueSection.vue';
import SlideshowSettings from './AlbumsList/SlideshowSettings.vue';
import TimerPanel from './AlbumsList/TimerPanel.vue';

defineEmits(['close']);
</script>
