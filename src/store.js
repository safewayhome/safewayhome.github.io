import { useSyncExternalStore } from 'react'
import { tasksStore, peopleStore, cursorsStore, connStore } from './collab'

export const useTasks = () => useSyncExternalStore(tasksStore.subscribe, tasksStore.get)
export const usePeople = () => useSyncExternalStore(peopleStore.subscribe, peopleStore.get)
export const useCursors = () => useSyncExternalStore(cursorsStore.subscribe, cursorsStore.get)
export const useConnection = () => useSyncExternalStore(connStore.subscribe, connStore.get)
