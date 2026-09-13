export function captureScriptTarget(
  tabId,
  frameId = null,
  documentId = null
) {
  if (typeof documentId === 'string' && documentId) {
    return {
      tabId,
      documentIds: [documentId]
    };
  }

  if (Number.isInteger(frameId)) {
    return {
      tabId,
      frameIds: [frameId]
    };
  }

  return {
    tabId,
    allFrames: true
  };
}

export function createCaptureRouting(chromeApi) {
  if (!chromeApi?.scripting?.executeScript) {
    throw new TypeError('chrome.scripting.executeScript is required.');
  }

  async function injectBridge(
    tabId,
    frameId = null,
    documentId = null
  ) {
    await chromeApi.scripting.executeScript({
      target: captureScriptTarget(
        tabId,
        frameId,
        documentId
      ),
      files: ['src/content-bridge.js']
    });
  }

  async function injectAgent(
    tabId,
    frameId = null,
    documentId = null
  ) {
    await chromeApi.scripting.executeScript({
      target: captureScriptTarget(
        tabId,
        frameId,
        documentId
      ),
      files: ['dist/page-agent.js'],
      world: 'MAIN'
    });
  }

  return {
    injectBridge,
    injectAgent
  };
}
