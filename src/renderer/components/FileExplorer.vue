<template>
  <div
    class="file-explorer-container flex flex-col h-full bg-secondary-bg text-color rounded-lg overflow-hidden border border-border-color"
  >
    <!-- Header: Current Path and Up Button -->
    <div
      class="header p-3 bg-secondary-bg border-b border-border-color flex items-center gap-2"
    >
      <button
        class="p-2 rounded-lg hover:bg-black/10 transition-colors flex items-center gap-2 text-muted hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent ml-2 md:ml-0"
        :disabled="!parentPath"
        title="Go Up"
        aria-label="Go to parent directory"
        @click="navigateUp"
      >
        <ArrowUpIcon class="w-5 h-5" />
      </button>
      <div
        class="current-path grow font-mono text-sm truncate bg-black/5 p-2 rounded border border-border-color"
      >
        {{ displayPath }}
      </div>
      <button
        class="p-2 rounded hover:bg-black/10 focus:outline-none focus:ring-2 focus:ring-accent text-muted hover:text-accent transition-colors"
        :title="
          viewMode === 'list' ? 'Switch to Grid View' : 'Switch to List View'
        "
        :aria-label="
          viewMode === 'list' ? 'Switch to Grid View' : 'Switch to List View'
        "
        @click="toggleViewMode"
      >
        <GridIcon v-if="viewMode === 'list'" class="w-5 h-5" />
        <ListIcon v-else class="w-5 h-5" />
      </button>
      <button
        class="p-2 rounded hover:bg-black/10 focus:outline-none focus:ring-2 focus:ring-accent text-muted hover:text-accent transition-colors"
        title="Refresh"
        aria-label="Refresh directory"
        @click="refresh"
      >
        <RefreshIcon class="w-5 h-5" />
      </button>
    </div>

    <!-- Screen Reader Announcement for Selection -->
    <div class="sr-only" aria-live="polite" aria-atomic="true">
      {{
        selectedPath
          ? `Selected: ${selectedPath.split(/[/\\]/).pop() || selectedPath}`
          : 'Selection cleared'
      }}
    </div>

    <!-- File List -->
    <div class="file-list grow overflow-y-auto p-2 relative">
      <!-- Loading Overlay -->
      <div
        v-if="isLoading"
        class="absolute inset-0 bg-secondary-bg/50 flex items-center justify-center z-10"
        role="status"
        aria-live="polite"
        aria-label="Loading directory contents"
      >
        <div
          class="text-color bg-secondary-bg p-4 rounded flex flex-col items-center gap-2 shadow-lg border border-border-color"
        >
          <div
            class="animate-spin rounded-full h-6 w-6 border-4 border-accent border-t-transparent"
          ></div>
          <span>Loading...</span>
        </div>
      </div>

      <div v-if="error" class="text-center p-4 text-red-500" role="alert">
        {{ error }}
      </div>

      <!-- Grid View -->
      <div
        v-else-if="viewMode === 'grid'"
        class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2"
      >
        <button
          v-for="entry in sortedEntries"
          :key="entry.path"
          type="button"
          class="flex flex-col items-center p-2 rounded-lg transition-all duration-200 aspect-square justify-center border border-transparent hover:border-accent/30 cursor-pointer hover:bg-black/10 focus:outline-none focus:ring-2 focus:ring-accent w-full h-full"
          :class="{
            'bg-accent/20 border-accent/50 text-accent':
              entry.path === selectedPath,
          }"
          :aria-current="entry.path === selectedPath ? 'true' : undefined"
          :aria-label="`${entry.isDirectory ? 'Folder' : 'File'}: ${entry.name}`"
          @click="handleEntryClick(entry)"
          @dblclick="handleEntryDoubleClick(entry)"
          @keydown.enter.prevent="handleEntryDoubleClick(entry)"
        >
          <span class="text-4xl mb-2">{{
            entry.isDirectory ? (isDriveRoot(entry.path) ? '💾' : '📁') : '📄'
          }}</span>
          <span class="text-xs text-center break-all line-clamp-2 w-full">{{
            entry.name
          }}</span>
        </button>
      </div>

      <!-- List View -->
      <ul v-else class="space-y-1">
        <li v-for="entry in sortedEntries" :key="entry.path">
          <button
            type="button"
            class="folder-item group flex items-center p-3 rounded-lg border transition-all duration-200 w-full text-left gap-3"
            :class="
              selectedPath === entry.path
                ? 'bg-accent/20 border-accent/50 text-accent font-medium'
                : 'bg-black/5 border-transparent hover:bg-black/10 text-color hover:border-accent/30'
            "
            :aria-current="selectedPath === entry.path ? 'true' : undefined"
            :aria-label="`${entry.isDirectory ? 'Folder' : 'File'}: ${entry.name}`"
            @click="handleEntryClick(entry)"
            @dblclick="handleEntryDoubleClick(entry)"
            @keydown.enter.prevent="handleEntryDoubleClick(entry)"
          >
            <span class="icon">{{
              entry.isDirectory ? (isDriveRoot(entry.path) ? '💾' : '📁') : '📄'
            }}</span>
            <span class="name grow truncate">{{ entry.name }}</span>
            <span v-if="entry.isDirectory" class="text-xs text-gray-500">{{
              isDriveRoot(entry.path) ? 'DRIVE' : 'DIR'
            }}</span>
          </button>
        </li>
      </ul>

      <div
        v-if="entries.length === 0 && !isLoading"
        class="text-gray-500 text-center p-4"
      >
        Empty directory
      </div>
    </div>

    <!-- Footer: Selection Actions -->
    <div
      class="footer p-3 bg-secondary-bg border-t border-border-color flex justify-end gap-3"
    >
      <button
        class="px-4 py-2 rounded text-muted hover:text-color focus:outline-none focus:ring-2 focus:ring-accent"
        @click="$emit('cancel')"
      >
        Cancel
      </button>
      <button
        class="px-4 py-2 rounded bg-accent hover:bg-accent-hover text-button-text disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent"
        :disabled="!selectedPath"
        @click="confirmSelection"
      >
        Select Directory
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '../api';
import type { FileSystemEntry } from '../../core/file-system';
import ArrowUpIcon from './icons/ArrowUpIcon.vue';
import GridIcon from './icons/GridIcon.vue';
import ListIcon from './icons/ListIcon.vue';
import RefreshIcon from './icons/RefreshIcon.vue';

const props = withDefaults(
  defineProps<{
    initialPath?: string;
    mode?: 'local' | 'google-drive';
  }>(),
  {
    mode: 'local',
    initialPath: '',
  },
);

const emit = defineEmits<{
  (e: 'select', path: string): void;
  (e: 'cancel'): void;
}>();

const currentPath = ref<string>('');
const entries = ref<FileSystemEntry[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);
const selectedPath = ref<string | null>(null);
const viewMode = ref<'list' | 'grid'>('grid');

const toggleViewMode = () => {
  viewMode.value = viewMode.value === 'list' ? 'grid' : 'list';
};

const parentPath = ref<string | null>(null);

// For Drive: map ID to Name for display if possible, or just show ID/Name
// We might not have the name of the CURRENT folder unless we fetch metadata.
// For now, in Drive mode, currentPath will show the ID or "Google Drive Root".
const displayPath = computed(() => {
  if (props.mode === 'google-drive') {
    return currentPath.value === 'root' || !currentPath.value
      ? 'Google Drive'
      : `Folder ID: ${currentPath.value}`;
  }
  return currentPath.value || 'Loading...';
});

const sortedEntries = computed(() => {
  return [...entries.value].sort((a, b) => {
    // Directories first
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
});

const isDriveRoot = (path: string) => {
  if (props.mode === 'google-drive') {
    return path === 'root' || !path;
  }
  // Simple check for windows drive root like "C:\" or unix root "/"
  return /^[A-Z]:\\?$/i.test(path) || path === '/';
};

const loadDirectory = async (path: string) => {
  isLoading.value = true;
  error.value = null;

  try {
    console.log(
      `[FileExplorer] loadDirectory mode=${props.mode} path='${path}'`,
    );
    if (props.mode === 'google-drive') {
      const targetId = path || 'root';
      const result = await api.listGoogleDriveDirectory(targetId);
      console.log(
        `[FileExplorer] listGoogleDriveDirectory returned ${result.length} items`,
      );
      entries.value = result;
      currentPath.value = targetId;

      if (targetId === 'root') {
        parentPath.value = null;
      } else {
        try {
          // Get parent
          const parent = await api.getGoogleDriveParent(targetId);
          parentPath.value = parent || 'root';
        } catch {
          parentPath.value = 'root';
        }
      }
    } else {
      // Local Mode
      const targetPath = path || 'ROOT';
      const result = await api.listDirectory(targetPath);
      entries.value = result;

      if (targetPath === 'ROOT') {
        currentPath.value = 'My PC'; // Display name for root
        parentPath.value = null;
      } else {
        currentPath.value = path;
        // Fetch parent path
        try {
          const parent = await api.getParentDirectory(path);
          // If parent is null, it means we can go up to ROOT
          parentPath.value = parent !== null ? parent : 'ROOT';
        } catch {
          parentPath.value = 'ROOT';
        }
      }
    }
  } catch (err) {
    console.error('Failed to list directory:', err);
    error.value = 'Failed to load directory.';
  } finally {
    isLoading.value = false;
  }
};

const navigateUp = () => {
  if (parentPath.value) {
    if (props.mode === 'local' && parentPath.value === 'ROOT') {
      loadDirectory('');
    } else {
      loadDirectory(parentPath.value);
    }
  }
};

const refresh = () => {
  if (props.mode === 'google-drive') {
    loadDirectory(currentPath.value);
    return;
  }
  let path = currentPath.value;
  if (path === 'My PC') path = '';
  loadDirectory(path);
};

const handleEntryClick = (entry: FileSystemEntry) => {
  if (entry.isDirectory) {
    selectedPath.value = entry.path;
  } else {
    selectedPath.value = null;
  }
};

const handleEntryDoubleClick = (entry: FileSystemEntry) => {
  if (entry.isDirectory) {
    loadDirectory(entry.path);
    selectedPath.value = null; // Reset selection on nav
  }
};

const confirmSelection = () => {
  if (selectedPath.value) {
    emit('select', selectedPath.value);
  }
};

onMounted(async () => {
  if (props.initialPath) {
    await loadDirectory(props.initialPath);
  } else {
    // Start at root
    await loadDirectory('');
  }
});
</script>

<style scoped>
.file-explorer-container {
  min-height: 400px;
  max-height: 80vh;
}
</style>
