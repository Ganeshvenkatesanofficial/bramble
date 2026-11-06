/** Synthetic openings and mirror bytes. Imported only by the explicitly labeled fixture page and tests. */
import fixture from '../fixtures/hcs-audit.json'
import { MirrorTopicReader } from '../../../hedera-audit/src/mirror'
import type { AuditOpening } from '../../../hedera-audit/src/types'
import { verifyAuditFeed } from './audit-verification'

export function fixtureAuditFeed() {
  return verifyAuditFeed(
    {
      list: () => fixture.rows,
      opening: (id) => fixture.openings[id as keyof typeof fixture.openings] as AuditOpening,
    },
    new MirrorTopicReader({
      mirrorBaseUrl: 'https://fixture.invalid',
      fetch: async (url) => {
        const after = Number(new URL(url).searchParams.get('sequencenumber')?.split(':')[1] ?? 0)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messages: fixture.messages.filter((message) => message.sequence_number > after).slice(0, 1),
          }),
        }
      },
    })
  )
}
