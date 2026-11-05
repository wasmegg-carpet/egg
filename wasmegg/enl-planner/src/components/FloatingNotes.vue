<template>
  <div
    class="fixed left-4 top-20 z-50 flex flex-col items-center p-1.5 shadow-2xl transition-all duration-300 bg-white/95 backdrop-blur-xl rounded-2xl border border-slate-100"
    :class="[isCollapsed ? 'w-12' : 'p-4 min-w-[300px] w-80 max-w-[90vw] max-h-[80vh] overflow-y-auto overflow-x-hidden']"
  >
    <!-- Toggle Handler -->
    <button
      @click="isCollapsed = !isCollapsed"
      class="w-full flex flex-col items-center group/toggle transition-colors"
      v-tippy="isCollapsed ? 'Expand Notes' : 'Collapse Notes'"
    >
      <!-- Chevron Indicator -->
      <div class="text-slate-300 group-hover/toggle:text-slate-500 transition-colors mb-1">
        <svg
          class="w-4 h-4 transition-transform duration-300"
          :class="{ 'rotate-180': isCollapsed }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      <!-- Notes Icon -->
      <div
        class="relative bg-yellow-50/50 rounded-xl border border-yellow-200/50 shadow-inner overflow-visible transition-all duration-300 flex items-center justify-center text-yellow-600"
        :class="[isCollapsed ? 'w-9 h-9 p-1' : 'w-12 h-12 p-1.5 mb-2 group-hover/toggle:scale-105']"
      >
        <svg fill="currentColor" viewBox="0 0 20 20" class="w-full h-full p-0.5">
          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
          <path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd" />
        </svg>
        <span
          v-if="isCollapsed && notesStore.notes.length > 0"
          class="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none shadow ring-2 ring-white"
        >{{ notesStore.notes.length > 99 ? '99+' : notesStore.notes.length }}</span>
      </div>

      <!-- Title -->
      <div v-if="!isCollapsed" class="text-lg font-bold text-slate-800 tracking-tight leading-none mb-1 shadow-sm">
        Plan Notes
      </div>
    </button>

    <!-- Collapsible Content -->
    <div v-if="!isCollapsed" class="flex flex-col items-center w-full transition-all mt-4 w-full">
      
      <!-- Notes List -->
      <div class="w-full flex flex-col gap-3">
        <div
          v-for="(note, index) in notesStore.notes"
          :key="note.id"
          class="w-full relative group/note rounded-xl p-3 shadow-sm border transition-all duration-200"
          :class="[
            note.completed ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-yellow-50 border-yellow-100',
            draggedIndex === index ? 'opacity-30' : ''
          ]"
          draggable="true"
          @dragstart="onDragStart(index)"
          @dragover.prevent
          @drop="onDrop(index)"
          @dragenter.prevent
        >
          <!-- Drag Handle -->
          <div class="absolute left-1 top-1 bottom-1 w-4 opacity-0 group-hover/note:opacity-40 hover:!opacity-100 cursor-grab active:cursor-grabbing flex flex-col justify-center items-center text-slate-400">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16" />
            </svg>
          </div>

          <!-- Note Content / Edit View -->
          <div class="pl-3 w-full">
            <template v-if="editingId === note.id">
              <textarea
                v-model="editDraft"
                class="w-full bg-white/80 border border-yellow-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-yellow-400 focus:outline-none resize-y min-h-[80px]"
                rows="3"
                @keydown.enter.ctrl="saveEdit"
                @keydown.enter.meta="saveEdit"
                @keydown.esc="cancelEdit"
                :ref="(el) => { if (el) (el as HTMLTextAreaElement).focus() }"
              ></textarea>
              <div class="flex justify-end gap-2 mt-2">
                <button @click="cancelEdit" class="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Cancel</button>
                <button @click="saveEdit" class="text-xs font-bold text-white bg-yellow-500 hover:bg-yellow-600 rounded px-2 py-1 shadow-sm">Save</button>
              </div>
            </template>
            <template v-else>
              <div 
                class="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed min-h-[20px]"
                :class="{ 'line-through text-slate-500': note.completed }"
              >{{ note.text }}</div>
              
              <!-- Action Buttons -->
              <div :class="['absolute top-2 right-2 flex items-center gap-1 p-0.5 rounded-lg shadow-sm opacity-0 group-hover/note:opacity-100 transition-opacity z-10 border backdrop-blur-md', note.completed ? 'bg-slate-50/80 border-slate-200' : 'bg-yellow-50/80 border-yellow-200']">
                <!-- Toggle Complete -->
                <button @click="notesStore.toggleCompleted(note.id)" class="p-1 rounded hover:bg-black/5 text-slate-400 hover:text-emerald-500 transition-colors" v-tippy="note.completed ? 'Mark Incomplete' : 'Mark Complete'">
                  <svg class="w-4 h-4" :class="{'text-emerald-500': note.completed}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <!-- Edit -->
                <button @click="startEdit(note)" class="p-1 rounded hover:bg-black/5 text-slate-400 hover:text-blue-500 transition-colors" v-tippy="'Edit (Cmd/Ctrl+Enter to save)'">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
                <!-- Delete -->
                <button @click="notesStore.deleteNote(note.id)" class="p-1 rounded hover:bg-black/5 text-slate-400 hover:text-red-500 transition-colors" v-tippy="'Delete'">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Add Note Area -->
      <div class="w-full mt-4 pt-4 border-t border-slate-200/50">
        <textarea
          v-model="newNoteText"
          placeholder="Add a new note..."
          class="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 focus:outline-none resize-y transition-all min-h-[80px]"
          rows="3"
          @keydown.enter.ctrl="addNewNote"
          @keydown.enter.meta="addNewNote"
        ></textarea>
        <button
          @click="addNewNote"
          :disabled="!newNoteText.trim()"
          class="mt-2 w-full py-2 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-bold text-xs uppercase tracking-widest rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          Add Note
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { useNotesStore } from '@/stores/notes';
import type { PlannerNote } from '@/stores/notes';

const notesStore = useNotesStore();

const isCollapsed = ref(true);

const newNoteText = ref('');

// Editing State
const editingId = ref<string | null>(null);
const editDraft = ref('');

function addNewNote() {
  if (newNoteText.value.trim()) {
    notesStore.addNote(newNoteText.value);
    newNoteText.value = '';
  }
}

function startEdit(note: PlannerNote) {
  editingId.value = note.id;
  editDraft.value = note.text;
}

function saveEdit() {
  if (editingId.value) {
    notesStore.editNoteText(editingId.value, editDraft.value);
    editingId.value = null;
    editDraft.value = '';
  }
}

function cancelEdit() {
  editingId.value = null;
  editDraft.value = '';
}

// Drag & Drop
const draggedIndex = ref<number | null>(null);

function onDragStart(index: number) {
  draggedIndex.value = index;
}

function onDrop(dropIndex: number) {
  if (draggedIndex.value !== null && draggedIndex.value !== dropIndex) {
    notesStore.reorderNotes(draggedIndex.value, dropIndex);
  }
  draggedIndex.value = null;
}
</script>
