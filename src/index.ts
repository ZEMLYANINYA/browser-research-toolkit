import { ResearchCollector } from './collector.js';
import type { ResearchConfig } from './types.js';

declare global {
  interface Window {
    RESEARCH_CONFIG?: Partial<ResearchConfig> & { autoExportOnUnload?: boolean; beaconUrl?: string };
    research: ResearchCollector;
    getEndpoints: () => ReturnType<ResearchCollector['getEndpoints']>;
    getJsonData: () => ReturnType<ResearchCollector['getJsonResponses']>;
    getResearchStats: () => ReturnType<ResearchCollector['getSummary']>;
    exportResearch: () => ReturnType<ResearchCollector['exportData']>;
  }
}

const collector = new ResearchCollector(window.RESEARCH_CONFIG);
window.research = collector;

window.getEndpoints = () => collector.getEndpoints();
window.getJsonData = () => collector.getJsonResponses();
window.getResearchStats = () => collector.getSummary();
window.exportResearch = () => collector.exportData();

if (window.RESEARCH_CONFIG?.autoExportOnUnload) {
  window.addEventListener('beforeunload', () => {
    try {
      const data = collector.exportData();
      const beaconUrl = window.RESEARCH_CONFIG?.beaconUrl;
      if (typeof navigator !== 'undefined' && navigator.sendBeacon && beaconUrl) {
        navigator.sendBeacon(beaconUrl, JSON.stringify(data));
      }
    } catch (e) {
      console.error('Auto-export failed', e);
    }
  });
}

export { ResearchCollector };
export type { ResearchConfig };
