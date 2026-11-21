import type { Page } from 'playwright';
import type { AppEvents } from '../../src/utils/event-bus.ts';

type ProbeEventName = 'history:undo' | 'workspace:marqueeCommit' | 'workspace:groupMoveCommit' | 'player:importModuleAtTarget';
type ProbeEvent = { [K in ProbeEventName]: [K, ...AppEvents[K]] }[ProbeEventName];

export function emitEditorEvent(page: Page, ...event: ProbeEvent) {
  return page.evaluate(async (event: ProbeEvent) => {
    const { eventBus } = await import('/src/utils/event-bus.ts');
    switch (event[0]) {
      case 'history:undo': return eventBus.emit(event[0]);
      case 'workspace:marqueeCommit': return eventBus.emit(event[0], event[1]);
      case 'workspace:groupMoveCommit': return eventBus.emit(event[0], event[1]);
      case 'player:importModuleAtTarget': return eventBus.emit(event[0], event[1]);
    }
  }, event);
}
