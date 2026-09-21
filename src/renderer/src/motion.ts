import { computed, onMounted, onUnmounted, ref } from 'vue'
import { store } from './store'
import { motionReduced } from '@shared/settingsCatalog'

/** Each consumer owns its listeners; no background animation survives route disposal. */
export function useMotion() {
  const query = matchMedia('(prefers-reduced-motion: reduce)')
  const system = ref(query.matches), hidden = ref(document.hidden)
  const update = () => { system.value = query.matches; hidden.value = document.hidden }
  onMounted(() => { query.addEventListener('change', update); document.addEventListener('visibilitychange', update) })
  onUnmounted(() => { query.removeEventListener('change', update); document.removeEventListener('visibilitychange', update) })
  const reduced = computed(() => motionReduced(store.settings?.reduceMotion, system.value))
  return { reduced, hidden, decorativeActive: computed(() => !hidden.value && !reduced.value) }
}
