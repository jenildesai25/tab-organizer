import { describe, expect, it } from 'vitest'
import { ONBOARDING_STEPS, parseOnboardingDone, shouldShowOnboarding } from './onboarding.js'

describe('onboarding', () => {
  it('shows until marked done', () => {
    expect(parseOnboardingDone(undefined)).toBe(false)
    expect(shouldShowOnboarding(false)).toBe(true)
    expect(shouldShowOnboarding(true)).toBe(false)
    expect(ONBOARDING_STEPS).toHaveLength(3)
  })
})
