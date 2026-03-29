/**
 * Root application component.
 *
 * Manages top-level screen state using a discriminated union and renders
 * the appropriate screen inside the persistent `AppLayout` shell.
 *
 * Screens:
 * - `home`     — start or continue a session
 * - `training` — active training session
 * - `summary`  — end-of-session results
 * - `vocab`    — vocabulary list
 * - `settings` — app settings (theme picker, future options)
 *
 * Navigation between home / vocab / settings is driven by the sidebar.
 * Training and summary are pushed on top by the session flow.
 *
 * @example
 * ```tsx
 * <App />
 * ```
 */
import { useState, useEffect, useCallback } from 'react'

import type { Session } from '../../shared/types/Session.ts'
import type { VocabEntry } from '../../shared/types/VocabEntry.ts'
import { getCreditsInfo } from '../api/creditsApi.ts'
import { getStreak } from '../api/streakApi.ts'
import { createReplaySession } from '../api/sessionApi.ts'
import { listVocab } from '../api/vocabApi.ts'
import type { StreakInfo } from '../api/streakApi.ts'
import { useTheme } from '../hooks/useTheme.ts'
import { AppLayout } from '../components/AppLayout/AppLayout.tsx'
import type { NavItem } from '../components/AppLayout/Sidebar.tsx'
import { HomeScreen } from '../screens/HomeScreen.tsx'
import { TrainingScreen } from '../screens/TrainingScreen.tsx'
import { DiscoveryQuizScreen } from '../screens/DiscoveryQuizScreen.tsx'
import { FocusQuizScreen } from '../screens/FocusQuizScreen.tsx'
import { SummaryScreen } from '../screens/SummaryScreen.tsx'
import { VocabListScreen } from '../screens/VocabListScreen.tsx'
import { SettingsScreen } from '../screens/SettingsScreen.tsx'

const APP_VERSION: string = __APP_VERSION__

type AppScreen =
  | { name: 'home' }
  | { name: 'training'; session: Session; vocabMap: Map<string, VocabEntry>; replayCount?: number }
  | { name: 'summary'; session: Session; sessionCost: number; creditsEarned: number; creditsSpent: number; perfectBonus: number; streakCredit: number; milestoneLabel?: string; bucketMilestoneBonus: number; replayCount?: number }
  | { name: 'vocab' }
  | { name: 'settings' }

function activeNav(screen: AppScreen): NavItem {
  if (screen.name === 'vocab') { return 'vocab' }
  if (screen.name === 'settings') { return 'settings' }

  return 'home'
}

function App() {
  const [screen, setScreen] = useState<AppScreen>({ name: 'home' })
  const [credits, setCredits] = useState<number | null>(null)
  const [stars, setStars] = useState<number | null>(null)
  const [streak, setStreak] = useState<StreakInfo | null>(null)
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const { theme, setTheme, mode, setMode } = useTheme()

  const refreshCredits = useCallback(() => {
    getCreditsInfo()
      .then(({ credits: c, stars: s }) => {
        setCredits(c)
        setStars(s)
      })
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

  function handleNavigate(item: NavItem) {
    if (item === 'home') {
      setScreen({ name: 'home' })
    } else if (item === 'vocab') {
      setScreen({ name: 'vocab' })
    } else {
      setScreen({ name: 'settings' })
    }
  }

  function renderScreen() {
    if (screen.name === 'training') {
      const trainingScreen = screen

      function handleTrainingComplete(session: Session, sessionCost: number, creditsEarned: number, creditsSpent: number, perfectBonus: number, streakCredit: number, milestoneLabel: string | undefined, bucketMilestoneBonus: number) {
        refreshCredits()
        refreshStreak()
        setScreen({ name: 'summary', session, sessionCost, creditsEarned, creditsSpent, perfectBonus, streakCredit, milestoneLabel, bucketMilestoneBonus, replayCount: trainingScreen.replayCount })
      }

      if (screen.session.type === 'focus_quiz') {
        return (
          <FocusQuizScreen
            session={screen.session}
            vocabMap={screen.vocabMap}
            onComplete={handleTrainingComplete}
            onAnswerSubmitted={refreshCredits}
          />
        )
      }

      if (screen.session.type === 'discovery') {
        return (
          <DiscoveryQuizScreen
            session={screen.session}
            vocabMap={screen.vocabMap}
            onComplete={handleTrainingComplete}
            onAnswerSubmitted={refreshCredits}
          />
        )
      }

      return (
        <TrainingScreen
          session={screen.session}
          vocabMap={screen.vocabMap}
          onComplete={handleTrainingComplete}
          onAnswerSubmitted={refreshCredits}
          credits={credits}
        />
      )
    }

    if (screen.name === 'summary') {
      const summaryScreen = screen

      async function handleReplay() {
        try {
          const [replaySession, entries] = await Promise.all([
            createReplaySession(summaryScreen.session.id),
            listVocab(),
          ])

          const vocabMap = new Map(entries.map((e) => [e.id, e]))

          setScreen({ name: 'training', session: replaySession, vocabMap, replayCount: (summaryScreen.replayCount ?? 0) + 1 })
        } catch {
          // If the replay fails (e.g. a session is already open), do nothing.
        }
      }

      return (
        <SummaryScreen
          session={screen.session}
          sessionCost={screen.sessionCost}
          creditsEarned={screen.creditsEarned}
          creditsSpent={screen.creditsSpent}
          perfectBonus={screen.perfectBonus}
          streakCredit={screen.streakCredit}
          milestoneLabel={screen.milestoneLabel}
          bucketMilestoneBonus={screen.bucketMilestoneBonus}
          replayCount={screen.replayCount}
          onReplay={() => { void handleReplay() }}
          onBack={() => {
            refreshStreak()
            setScreen({ name: 'home' })
          }}
        />
      )
    }

    if (screen.name === 'vocab') {
      return (
        <VocabListScreen />
      )
    }

    if (screen.name === 'settings') {
      return (
        <SettingsScreen theme={theme} onThemeChange={setTheme} mode={mode} onModeChange={setMode} />
      )
    }

    return (
      <HomeScreen
        onStartTraining={(session, vocabMap) => {
          setScreen({ name: 'training', session, vocabMap })
        }}
        onStreakRefresh={refreshStreak}
        onCreditsRefresh={refreshCredits}
        credits={credits}
        streak={streak}
      />
    )
  }

  return (
    <AppLayout
      credits={credits}
      stars={stars}
      streak={streak}
      activeNav={activeNav(screen)}
      rightPanelOpen={rightPanelOpen}
      onToggleRightPanel={() => { setRightPanelOpen((o) => !o) }}
      onNavigate={handleNavigate}
      version={APP_VERSION}
    >
      {renderScreen()}
    </AppLayout>
  )
}

export default App
