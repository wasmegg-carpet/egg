import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface PlannerNote {
  id: string;
  text: string;
  completed: boolean;
}

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<PlannerNote[]>([]);

  function addNote(text: string) {
    if (!text.trim()) return;
    notes.value.push({
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString() + Math.random().toString(36).substring(2),
      text: text.trim(),
      completed: false,
    });
  }

  function editNoteText(id: string, newText: string) {
    const note = notes.value.find(n => n.id === id);
    if (note && newText.trim()) {
      note.text = newText.trim();
    }
  }

  function deleteNote(id: string) {
    notes.value = notes.value.filter(n => n.id !== id);
  }

  function toggleCompleted(id: string) {
    const note = notes.value.find(n => n.id === id);
    if (note) {
      note.completed = !note.completed;
    }
  }

  function reorderNotes(fromIndex: number, toIndex: number) {
    if (fromIndex >= 0 && fromIndex < notes.value.length && toIndex >= 0 && toIndex < notes.value.length) {
      const item = notes.value.splice(fromIndex, 1)[0];
      notes.value.splice(toIndex, 0, item);
    }
  }

  function setNotes(loadedNotes: PlannerNote[]) {
    notes.value = loadedNotes || [];
  }

  function $reset() {
    notes.value = [];
  }

  return {
    notes,
    addNote,
    editNoteText,
    deleteNote,
    toggleCompleted,
    reorderNotes,
    setNotes,
    $reset,
  };
});
