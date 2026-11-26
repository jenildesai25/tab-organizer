export const ONBOARDING_DONE_KEY = 'onboardingDone'

export type OnboardingStep = {
  id: string
  title: string
  body: string
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'organize',
    title: 'Organize',
    body: 'Click Organize to file open tabs in this window into Chrome groups by site and title.',
  },
  {
    id: 'protect',
    title: 'Protect what matters',
    body: 'In Settings, protect Mail or a site you never want auto-closed. Clean up stays off until you turn it on.',
  },
  {
    id: 'ollama',
    title: 'Optional local model',
    body: 'Turn on Local model only if Ollama is running on this machine. Nothing is sent to a Tab Organizer server.',
  },
] as const

export function parseOnboardingDone(raw: unknown): boolean {
  return raw === true
}

export function shouldShowOnboarding(done: boolean): boolean {
  return !done
}
