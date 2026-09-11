import { createAntiBotState } from './antibot.js';
import { generateParserBlueprint } from './parser-blueprint.js';
import { renderParserBlueprintMarkdown } from './parser-blueprint-markdown.js';
import { buildApiAnalysis } from './network-analysis.js';
import { searchSession } from './session-search.js';

export function createControlQueryHandlers({
  activeTab,
  loadSession,
  taskRunner,
  getAntiBotAnalysis
}) {
  if (typeof activeTab !== 'function') throw new TypeError('activeTab is required.');
  if (typeof loadSession !== 'function') throw new TypeError('loadSession is required.');
  if (!taskRunner || typeof taskRunner.list !== 'function') throw new TypeError('taskRunner.list is required.');
  if (typeof getAntiBotAnalysis !== 'function') throw new TypeError('getAntiBotAnalysis is required.');

  return Object.freeze({
    BRT_GET_ACTIVE_TAB: async () => {
      const tab = await activeTab();
      return {
        tab: tab
          ? { id: tab.id, title: tab.title, url: tab.url }
          : null
      };
    },

    BRT_GET_SESSION: async () => {
      const tab = await activeTab();
      if (!tab?.id) return { session: null };
      return { session: await loadSession(tab.id) };
    },

    BRT_GET_PARSER_BLUEPRINT: async () => {
      const tab = await activeTab();

      if (!tab?.id) {
        return { blueprint: null, markdown: '' };
      }

      const session = await loadSession(tab.id);
      const blueprint = generateParserBlueprint(session);

      return {
        blueprint,
        markdown: renderParserBlueprintMarkdown(blueprint)
      };
    },

    BRT_GET_TASKS: async () => {
      const tab = await activeTab();
      return {
        tasks: tab?.id == null
          ? []
          : taskRunner.list({ tabId: tab.id })
      };
    },

    BRT_SEARCH: async message => {
      const tab = await activeTab();
      if (!tab?.id) return { results: [] };

      const session = await loadSession(tab.id);

      return {
        results: searchSession(
          session,
          message.query || '',
          message.scopes || {}
        )
      };
    },

    BRT_GET_DIAGNOSTICS: async () => {
      const tab = await activeTab();
      const session = tab?.id
        ? await loadSession(tab.id)
        : null;

      return {
        diagnostics: session?.diagnostics || [],
        correlations: session?.correlations || [],
        inferences: session?.inferences || [],
        api: session ? buildApiAnalysis(session) : [],
        antiBot: session?.antiBot || createAntiBotState(false),
        antiBotAnalysis:
          session && tab?.id != null
            ? getAntiBotAnalysis(tab.id, session)
            : null,
        tasks:
          tab?.id == null
            ? []
            : taskRunner.list({ tabId: tab.id })
      };
    }
  });
}
