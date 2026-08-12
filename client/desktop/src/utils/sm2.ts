export interface SM2State {
  easeFactor: number
  interval: number
  repetition: number
  nextReviewAt: number
  lastReviewAt: number | null
  status: 'new' | 'learning' | 'review' | 'mastered'
}

export type SM2Quality = 1 | 4

export function sm2Update(state: SM2State, quality: SM2Quality, now: number): SM2State {
  let { easeFactor, interval, repetition, status } = state

  if (quality < 3) {
    repetition = 0
    interval = 1
    easeFactor = Math.max(1.3, easeFactor - 0.2)
  } else {
    if (repetition === 0) {
      interval = 1
    } else if (repetition === 1) {
      interval = 6
    } else {
      interval = Math.round(interval * easeFactor)
    }
    repetition++
    easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  }

  const nextReviewAt = now + interval * 86400000

  if (quality < 3) {
    status = 'learning'
  } else {
    if (status === 'new') {
      status = 'learning'
    } else if (status === 'learning' && repetition >= 2) {
      status = 'review'
    } else if (status === 'review' && interval >= 30) {
      status = 'mastered'
    }
  }

  return {
    easeFactor,
    interval,
    repetition,
    nextReviewAt,
    lastReviewAt: now,
    status,
  }
}

export function sm2InitialState(): SM2State {
  return {
    easeFactor: 2.5,
    interval: 0,
    repetition: 0,
    nextReviewAt: 0,
    lastReviewAt: null,
    status: 'new',
  }
}
