<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="isSmartPlaylistModalVisible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      @click.self="close"
    >
      <div
        class="relative w-full max-w-lg overflow-hidden rounded-2xl bg-gray-900/95 border border-white/10 shadow-2xl backdrop-blur-xl ring-1 ring-white/5 transform transition-all"
        role="dialog"
        aria-modal="true"
      >
        <!-- Decorative top gradient (Indigo/Violet) -->
        <div
          class="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-indigo-500 via-purple-500 to-indigo-500"
        ></div>

        <div class="p-8">
          <!-- Header -->
          <div class="flex justify-between items-start mb-8">
            <div>
              <h2 class="text-2xl font-bold text-white">
                {{ isEditing ? 'Edit' : 'Create' }} Smart Playlist
              </h2>
              <p class="text-sm text-gray-400 mt-1">
                Automate your library with dynamic filters
              </p>
            </div>
            <button
              class="text-gray-500 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10 -mr-2 -mt-2"
              aria-label="Close"
              @click="close"
            >
              <CloseIcon class="w-6 h-6" />
            </button>
          </div>

          <div class="space-y-6">
            <!-- Name Input -->
            <div class="space-y-2">
              <label
                for="playlist-name"
                class="block text-xs font-semibold uppercase tracking-wider text-gray-500"
              >
                Playlist Name
              </label>
              <input
                id="playlist-name"
                v-model="name"
                type="text"
                class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                placeholder="e.g. My Top Rated Videos"
                autofocus
              />
            </div>

            <!-- Rating Criteria -->
            <div
              class="bg-white/5 rounded-xl p-4 border border-white/5 space-y-3"
            >
              <div class="flex justify-between items-center">
                <label
                  for="min-rating"
                  class="text-sm font-medium text-gray-300"
                  >Minimum Rating</label
                >
                <div
                  class="flex items-center gap-1 bg-black/40 px-2 py-1 rounded text-xs font-mono text-indigo-400"
                >
                  <span class="font-bold">{{
                    minRating === 0 ? 'Any' : minRating
                  }}</span>
                  <span v-if="minRating > 0" class="text-gray-600">/</span>
                  <span v-if="minRating > 0" class="text-gray-500">5</span>
                </div>
              </div>
              <input
                id="min-rating"
                v-model.number="minRating"
                type="range"
                min="0"
                max="5"
                step="1"
                class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-colors"
                :aria-valuetext="
                  minRating === 0 ? 'Any rating' : `Minimum ${minRating} stars`
                "
              />
              <div class="flex justify-between text-xs text-gray-600 px-1">
                <span>Any</span>
                <span>5 Stars</span>
              </div>
            </div>

            <!-- Grid Criteria -->
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <label
                  for="min-duration"
                  class="block text-xs font-semibold uppercase tracking-wider text-gray-500"
                >
                  Min Duration (Min)
                </label>
                <input
                  id="min-duration"
                  v-model.number="minDurationMinutes"
                  type="number"
                  min="0"
                  class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                  placeholder="0"
                  aria-describedby="min-duration-desc"
                />
                <p id="min-duration-desc" class="text-xs text-gray-500 mt-1">
                  Minimum duration of the video in minutes.
                </p>
              </div>
              <div class="space-y-2">
                <label
                  for="min-days-untouched"
                  class="block text-xs font-semibold uppercase tracking-wider text-gray-500"
                >
                  Days Untouched
                </label>
                <input
                  id="min-days-untouched"
                  v-model.number="minDaysSinceView"
                  type="number"
                  min="0"
                  class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                  placeholder="Any"
                  aria-describedby="days-untouched-desc"
                />
                <p id="days-untouched-desc" class="text-xs text-gray-500 mt-1">
                  Media not viewed in the last X days.
                </p>
              </div>
            </div>

            <!-- Views Criteria -->
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <label
                  for="min-views"
                  class="block text-xs font-semibold uppercase tracking-wider text-gray-500"
                >
                  Min Views
                </label>
                <input
                  id="min-views"
                  v-model.number="minViews"
                  type="number"
                  min="0"
                  class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                  placeholder="0"
                  aria-describedby="min-views-desc"
                />
                <p id="min-views-desc" class="text-xs text-gray-500 mt-1">
                  Media played at least this many times.
                </p>
              </div>
              <div class="space-y-2">
                <label
                  for="max-views"
                  class="block text-xs font-semibold uppercase tracking-wider text-gray-500"
                >
                  Max Views
                </label>
                <input
                  id="max-views"
                  v-model.number="maxViews"
                  type="number"
                  min="0"
                  class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                  placeholder="Any"
                  aria-describedby="max-views-desc"
                />
                <p id="max-views-desc" class="text-xs text-gray-500 mt-1">
                  Media played at most this many times.
                </p>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div
            class="mt-10 flex justify-end gap-3 border-t border-white/5 pt-6"
          >
            <button
              class="px-5 py-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-all font-medium text-sm"
              @click="close"
            >
              Cancel
            </button>
            <button
              class="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-900/20 transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
              :disabled="!name.trim()"
              @click="save"
            >
              {{ isEditing ? 'Save Changes' : 'Create Playlist' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useUIStore } from '../composables/useUIStore';
import { useLibraryStore } from '../composables/useLibraryStore';
import { useToast } from '../composables/useToast';
import { api } from '../api';
import CloseIcon from './icons/CloseIcon.vue';
import { useEscapeKey } from '../composables/useEscapeKey';

const props = defineProps<{
  playlistToEdit?: {
    id: number;
    name: string;
    criteria: string;
  } | null;
}>();

const emit = defineEmits(['close']);

const uiStore = useUIStore();
const libraryStore = useLibraryStore();
const toast = useToast();

const { isSmartPlaylistModalVisible } = uiStore;
const { smartPlaylists } = libraryStore;

const name = ref('');
const minRating = ref(0);
const minDurationMinutes = ref(0);
const minViews = ref<number | undefined>(undefined);
const maxViews = ref<number | undefined>(undefined);
const minDaysSinceView = ref<number | undefined>(undefined);

const isEditing = computed(() => !!props.playlistToEdit);

// Watch for modal opening to populate/reset form
watch(isSmartPlaylistModalVisible, (visible) => {
  if (visible) {
    if (props.playlistToEdit) {
      name.value = props.playlistToEdit.name;
      try {
        const criteria = JSON.parse(props.playlistToEdit.criteria);
        minRating.value = criteria.minRating || 0;
        minDurationMinutes.value = criteria.minDuration
          ? criteria.minDuration / 60
          : 0;
        minViews.value = criteria.minViews;
        maxViews.value = criteria.maxViews;
        minDaysSinceView.value = criteria.minDaysSinceView;
      } catch (e) {
        console.error('Failed to parse criteria', e);
      }
    }
  } else {
    // Reset form after delay
    setTimeout(() => {
      name.value = '';
      minRating.value = 0;
      minDurationMinutes.value = 0;
      minViews.value = undefined;
      maxViews.value = undefined;
      minDaysSinceView.value = undefined;
      emit('close'); // Notify parent to clear edit selection
    }, 300);
  }
});

const close = () => {
  isSmartPlaylistModalVisible.value = false;
};

const save = async () => {
  if (!name.value.trim()) return;

  const criteria = {
    minRating: minRating.value > 0 ? minRating.value : undefined,
    minDuration:
      minDurationMinutes.value > 0 ? minDurationMinutes.value * 60 : undefined, // Convert to seconds
    minViews: minViews.value,
    maxViews: maxViews.value,
    minDaysSinceView: minDaysSinceView.value,
  };

  try {
    if (isEditing.value && props.playlistToEdit) {
      await api.updateSmartPlaylist(
        props.playlistToEdit.id,
        name.value,
        JSON.stringify(criteria),
      );
      toast.success('Playlist updated');
    } else {
      await api.createSmartPlaylist(name.value, JSON.stringify(criteria));
      toast.success('Playlist created');
    }

    // Optimistically update list or re-fetch
    smartPlaylists.value = await api.getSmartPlaylists();

    close();
  } catch (err) {
    console.error('Failed to save playlist:', err);
    toast.error(
      'Failed to save playlist. Please check your input and try again.',
    );
  }
};

useEscapeKey(isSmartPlaylistModalVisible, close);
</script>
