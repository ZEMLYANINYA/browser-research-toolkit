import {
  captureOriginPattern,
  requestCaptureOriginPermission
} from './capture-origin-permission.js';

const startButton = document.getElementById('startBtn');
const pageInfo = document.getElementById('pageInfo');
const version = document.getElementById('extensionVersion');

if (version) {
  version.textContent = `v${chrome.runtime.getManifest().version}`;
}

let activeTabSnapshot = null;
let replayingStart = false;
let refreshToken = 0;

function setActiveTabSnapshot(tab) {
  activeTabSnapshot = tab || null;

  if (startButton) {
    startButton.disabled = !captureOriginPattern(activeTabSnapshot?.url);
  }
}

async function refreshActiveTabSnapshot() {
  const token = ++refreshToken;
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (token !== refreshToken) return;
  setActiveTabSnapshot(tab || null);
}

function showStartMessage(message) {
  if (pageInfo) pageInfo.textContent = message;
}

if (startButton) {
  startButton.addEventListener(
    'click',
    event => {
      if (replayingStart) return;

      /*
       * Stop panel.js from sending BRT_START until the current research origin
       * has explicit optional host access. This listener runs in capture phase,
       * so the existing bubble-phase START handler is not reached on denial.
       */
      event.preventDefault();
      event.stopImmediatePropagation();

      const snapshot = activeTabSnapshot;
      const originPattern = captureOriginPattern(snapshot?.url);

      if (!snapshot?.id || !originPattern) {
        showStartMessage(
          'Capture not started: open a normal http/https page first.'
        );
        void refreshActiveTabSnapshot();
        return;
      }

      startButton.setAttribute('aria-busy', 'true');

      /*
       * Do not await any other browser API before this call. Chrome requires
       * permissions.request() to remain attached to the explicit Start gesture.
       */
      requestCaptureOriginPermission(chrome, snapshot.url)
        .then(async result => {
          if (!result.granted) {
            startButton.title =
              'Host access was denied. Capture was not started.';
            showStartMessage(
              `Capture not started: allow host access for ${new URL(snapshot.url).origin} to preserve capture across hard navigations.`
            );
            return;
          }

          const [currentTab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
          });

          const currentPattern =
            captureOriginPattern(currentTab?.url);

          setActiveTabSnapshot(currentTab || null);

          if (
            currentTab?.id !== snapshot.id ||
            currentPattern !== result.originPattern
          ) {
            startButton.title =
              'The active tab changed while host access was being granted.';
            showStartMessage(
              'Capture not started: the active tab changed. Click Start again on the page you want to inspect.'
            );
            return;
          }

          startButton.title = '';
          replayingStart = true;

          try {
            startButton.click();
          } finally {
            replayingStart = false;
          }
        })
        .catch(error => {
          startButton.title =
            'Host permission request failed. Capture was not started.';
          showStartMessage(
            `Capture host permission failed: ${error?.message || error}`
          );
        })
        .finally(() => {
          startButton.removeAttribute('aria-busy');
        });
    },
    true
  );
}

chrome.tabs.onActivated?.addListener(() => {
  void refreshActiveTabSnapshot();
});

chrome.tabs.onUpdated?.addListener((_tabId, changeInfo, tab) => {
  if (!tab?.active) return;
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  setActiveTabSnapshot(tab);
});

window.addEventListener('focus', () => {
  void refreshActiveTabSnapshot();
});

void refreshActiveTabSnapshot();
