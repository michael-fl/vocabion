/**
 * Root application component.
 *
 * Manages top-level screen state using a discriminated union. Screens:
 * - `home`     — start or continue a session
 * - `training` — active training session
 * - `summary`  — end-of-session results
 * - `vocab`    — vocabulary list
 *
 * A persistent header displays the current credit count on all screens.
 *
 * @example
 * ```tsx
 * <App />
 * ```
 */
import { useState, useEffect, useCallback } from 'react'

import type { Session } from '../../shared/types/Session.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
import { getCredits } from '../api/creditsApi.ts'
import { getStreak } from '../api/streakApi.ts'
import type { StreakInfo } from '../api/streakApi.ts'
import { HomeScreen } from '../screens/HomeScreen.tsx'
import { TrainingScreen } from '../screens/TrainingScreen.tsx'
import { SummaryScreen } from '../screens/SummaryScreen.tsx'
import { VocabListScreen } from '../screens/VocabListScreen.tsx'

type AppScreen =
  | { name: 'home' }
  | { name: 'training'; session: Session; vocabMap: Map<string, VocabEntry> }
  | { name: 'summary'; session: Session; sessionCost: number; creditsEarned: number; creditsSpent: number; perfectBonus: number; streakCredit: number; milestoneLabel?: string }
  | { name: 'vocab' }

function App() {
  const [screen, setScreen] = useState<AppScreen>({ name: 'home' })
  const [credits, setCredits] = useState<number | null>(null)
  const [streak, setStreak] = useState<StreakInfo | null>(null)

  const refreshCredits = useCallback(() => {
    getCredits()
      .then((c) => { setCredits(c) })
      .catch(() => undefined)
  }, [])

  const refreshStreak = useCallback(() => {
    getStreak()
      .then((s) => { setStreak(s) })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshCredits()
    refreshStreak()
  }, [refreshCredits, refreshStreak])

  if (screen.name === 'training') {
    return (
      <>
        <header>
          {credits !== null && <p>Credits: {credits}</p>}
        </header>
        <TrainingScreen
          session={screen.session}
          vocabMap={screen.vocabMap}
          onComplete={(session, sessionCost, creditsEarned, creditsSpent, perfectBonus, streakCredit, milestoneLabel) => {
            refreshCredits()
            refreshStreak()
            setScreen({ name: 'summary', session, sessionCost, creditsEarned, creditsSpent, perfectBonus, streakCredit, milestoneLabel })
          }}
          onAnswerSubmitted={refreshCredits}
          credits={credits}
        />
      </>
    )
  }

  if (screen.name === 'summary') {
    return (
      <>
        <header>
          {credits !== null && <p>Credits: {credits}</p>}
        </header>
        <SummaryScreen
          session={screen.session}
          sessionCost={screen.sessionCost}
          creditsEarned={screen.creditsEarned}
          creditsSpent={screen.creditsSpent}
          perfectBonus={screen.perfectBonus}
          streakCredit={screen.streakCredit}
          milestoneLabel={screen.milestoneLabel}
          onBack={() => {
            refreshStreak()
            setScreen({ name: 'home' })
          }}
        />
      </>
    )
  }

  if (screen.name === 'vocab') {
    return (
      <>
        <header>
          {credits !== null && <p>Credits: {credits}</p>}
        </header>
        <VocabListScreen onBack={() => { setScreen({ name: 'home' }) }} />
      </>
    )
  }

  return (
    <>
      <header>
        {credits !== null && <p>Credits: {credits}</p>}
      </header>
      <HomeScreen
        onStartTraining={(session, vocabMap) => {
          setScreen({ name: 'training', session, vocabMap })
        }}
        onViewVocab={() => { setScreen({ name: 'vocab' }) }}
        onStreakRefresh={refreshStreak}
        credits={credits}
        streak={streak}
      />
    </>
  )
}

export default App
