import { useSyncExternalStore } from 'react'
import { tasksStore, peopleStore, cursorsStore, connStore, undoStore } from './collab'
import { threadsStore, threadMsgsStore, threadsMetaStore } from './threads'
import { authStore } from './auth'

export const useTasks = () => useSyncExternalStore(tasksStore.subscribe, tasksStore.get)
export const usePeople = () => useSyncExternalStore(peopleStore.subscribe, peopleStore.get)
export const useCursors = () => useSyncExternalStore(cursorsStore.subscribe, cursorsStore.get)
export const useConnection = () => useSyncExternalStore(connStore.subscribe, connStore.get)
export const useAuth = () => useSyncExternalStore(authStore.subscribe, authStore.get)
// Ångra-/gör-om-tillstånd (knapparnas av/på + globalt läge).
export const useUndo = () => useSyncExternalStore(undoStore.subscribe, undoStore.get)
// Diskussionstrådar: per kort (taskId -> trådar) resp. per tråd (threadId -> meddelanden) + meta.
export const useThreads = () => useSyncExternalStore(threadsStore.subscribe, threadsStore.get)
export const useThreadMsgs = () => useSyncExternalStore(threadMsgsStore.subscribe, threadMsgsStore.get)
export const useThreadsMeta = () => useSyncExternalStore(threadsMetaStore.subscribe, threadsMetaStore.get)
