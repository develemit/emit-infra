'use client'

import { usePushNotifications } from './use-push-notifications'
import { Icon } from './icon'

const TITLES: Record<string, string> = {
  ready: 'Push notifications on — click to disable',
  unsupported: 'Push notifications not supported in this browser',
  'ios-needs-pwa': 'Add to Home Screen to enable push notifications on iOS',
  'permission-denied': 'Notification permission denied — enable in browser settings',
  'permission-needed': 'Enable push notifications for server alerts',
}

export function PushSubscribeButton() {
  const { requirement, subscribed, busy, subscribe, unsubscribe } = usePushNotifications()

  const disabled = busy || requirement === 'unsupported' || requirement === 'ios-needs-pwa' || requirement === 'permission-denied'
  const active = subscribed && requirement === 'ready'

  function handleClick() {
    if (disabled) return
    if (subscribed) void unsubscribe()
    else void subscribe()
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      title={TITLES[requirement] ?? 'Push notifications'}
      aria-label={TITLES[requirement] ?? 'Push notifications'}
      className={[
        'flex items-center justify-center rounded-lg border transition-colors',
        'w-[34px] h-[34px] shrink-0',
        active
          ? 'border-accent text-accent bg-accent/10 hover:bg-accent/20'
          : 'border-border text-subtle hover:text-fg hover:border-fg/30',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      {busy ? (
        <span className="block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : (
        <Icon name="zap" size={14} />
      )}
    </button>
  )
}
