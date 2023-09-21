import {prop, max, sortBy} from "ramda"
import {Tags, reactionKinds, findReplyId, findReplyAndRootIds} from "src/util/nostr"
import {formatTimestampAsLocalISODate, tryJson} from "src/util/misc"
import {derived} from "src/engine2/util/store"
import {events, notificationsLastChecked} from "src/engine2/state"
import {session, userEventsById} from "src/engine2/queries/session"
import {isEventMuted} from "src/engine2/queries/nip51"

export const notifications = derived(
  [session, userEventsById.throttle(500), events.throttle(500)],
  ([$session, $userEventsById, $events]) => {
    if (!$session) {
      return []
    }

    return $events.filter(e => {
      const {root, reply} = findReplyAndRootIds(e)

      if (e.pubkey === $session.pubkey || isEventMuted(e).get()) {
        return false
      }

      return (
        $userEventsById[root] ||
        $userEventsById[reply] ||
        Tags.from(e).pubkeys().includes($session.pubkey)
      )
    })
  }
)

export const hasNewNotifications = derived(
  [notificationsLastChecked, notifications],
  ([$notificationsLastChecked, $notifications]) =>
    $notifications.map(prop("created_at")).reduce(max, 0) > $notificationsLastChecked
)

export const groupNotifications = $notifications => {
  const $userEventsById = userEventsById.get()

  // Convert zaps to zap requests
  const convertZap = e => {
    if (e.kind === 9735) {
      return tryJson(() => JSON.parse(Tags.from(e).asMeta().description as string))
    }

    return e
  }

  const groups = {}

  // Group notifications by event
  for (const ix of $notifications) {
    const eventId = findReplyId(ix)
    const event = $userEventsById[eventId]

    if (reactionKinds.includes(ix.kind) && !event) {
      continue
    }

    // Group and sort by day/event so we can group clustered reactions to the same event
    const key = formatTimestampAsLocalISODate(ix.created_at).slice(0, 11) + (eventId || ix.id)

    groups[key] = groups[key] || {key, event, interactions: []}
    groups[key].interactions.push(convertZap(ix))
  }

  return sortBy(
    g => -g.timestamp,
    Object.values(groups).map((group: any) => {
      const {event, interactions} = group
      const timestamp = interactions
        .map(ix => ix.created_at)
        .concat(event?.created_at || 0)
        .reduce(max, 0)

      return {...group, timestamp}
    })
  )
}
