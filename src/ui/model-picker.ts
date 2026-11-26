/** Accessible model listbox — opens below the trigger (flips above if needed). */

export type ModelPickerOption = {
  value: string
  label: string
}

export type ModelPickerController = {
  setOptions: (options: ModelPickerOption[], selected: string, emptyLabel?: string) => void
  getValue: () => string
  close: () => void
}

type BindOptions = {
  emptyLabel?: string
  onChange: (value: string) => void
}

function placeMenu(trigger: HTMLElement, menu: HTMLElement): void {
  menu.classList.remove('is-above')
  const triggerRect = trigger.getBoundingClientRect()
  const menuHeight = menu.getBoundingClientRect().height
  const gap = 4
  const spaceBelow = window.innerHeight - triggerRect.bottom - gap
  const spaceAbove = triggerRect.top - gap
  if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
    menu.classList.add('is-above')
  }
}

/** Wire a `.model-picker` root (trigger button + listbox menu). */
export function bindModelPicker(root: HTMLElement, opts: BindOptions): ModelPickerController {
  const trigger = root.querySelector<HTMLButtonElement>('.model-picker-trigger')
  const valueEl = root.querySelector<HTMLElement>('.model-picker-value')
  const menu = root.querySelector<HTMLElement>('.model-picker-menu')
  if (!trigger || !valueEl || !menu) {
    throw new Error('model-picker markup missing trigger, value, or menu')
  }

  let emptyLabel = opts.emptyLabel ?? 'Choose a model'
  let options: ModelPickerOption[] = []
  let value = ''
  let open = false

  const syncTrigger = (): void => {
    const match = options.find((option) => option.value === value)
    valueEl.textContent = match ? match.label : emptyLabel
    trigger.disabled = options.length === 0 && emptyLabel === 'No models'
  }

  const setExpanded = (next: boolean): void => {
    open = next
    trigger.setAttribute('aria-expanded', next ? 'true' : 'false')
    menu.hidden = !next
    root.classList.toggle('is-open', next)
    if (next) {
      placeMenu(trigger, menu)
      const selected = menu.querySelector<HTMLElement>('[aria-selected="true"]')
      ;(selected ?? menu.querySelector<HTMLElement>('[role="option"]'))?.focus()
    } else {
      menu.classList.remove('is-above')
    }
  }

  const close = (): void => {
    if (open) setExpanded(false)
  }

  const paintOptions = (): void => {
    menu.replaceChildren()
    for (const option of options) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'model-picker-option'
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', option.value === value ? 'true' : 'false')
      item.dataset.value = option.value
      item.textContent = option.label
      item.tabIndex = -1
      item.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (value !== option.value) {
          value = option.value
          syncTrigger()
          paintOptions()
          opts.onChange(option.value)
        }
        close()
        trigger.focus()
      })
      menu.append(item)
    }
  }

  trigger.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (trigger.disabled) return
    setExpanded(!open)
  })

  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) setExpanded(true)
    } else if (event.key === 'Escape') {
      close()
    }
  })

  menu.addEventListener('keydown', (event) => {
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="option"]'))
    if (items.length === 0) return
    const current = document.activeElement as HTMLElement | null
    const index = items.indexOf(current as HTMLElement)

    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      trigger.focus()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(index + 1 + items.length) % items.length]?.focus()
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus()
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus()
    }
  })

  document.addEventListener('click', (event) => {
    if (!open) return
    const target = event.target as Node | null
    if (target && root.contains(target)) return
    close()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) close()
  })

  return {
    setOptions(nextOptions, selected, nextEmptyLabel) {
      if (typeof nextEmptyLabel === 'string') emptyLabel = nextEmptyLabel
      options = nextOptions
      value = selected
      syncTrigger()
      paintOptions()
      if (open) placeMenu(trigger, menu)
    },
    getValue: () => value,
    close,
  }
}
