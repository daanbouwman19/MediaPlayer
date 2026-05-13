<template>
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
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { useUIStore } from '../../composables/useUIStore';
import { AVAILABLE_THEMES, type ThemeId } from '../../../core/themes';
import CloseIcon from '../icons/CloseIcon.vue';
import SettingsIcon from '../icons/SettingsIcon.vue';
import PlaylistAddIcon from '../icons/PlaylistAddIcon.vue';
import ThemeIcon from '../icons/ThemeIcon.vue';

defineEmits(['close']);

const uiStore = useUIStore();
const { themeMode, isSourcesModalVisible, isSmartPlaylistModalVisible } =
  storeToRefs(uiStore);

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

const openModal = () => {
  isSourcesModalVisible.value = true;
};

const openSmartPlaylistModal = () => {
  isSmartPlaylistModalVisible.value = true;
};
</script>
