import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const background =
  fs.readFileSync(
    new URL(
      '../src/background.js',
      import.meta.url
    ),
    'utf8'
  );

const panelJs =
  fs.readFileSync(
    new URL(
      '../ui/panel.js',
      import.meta.url
    ),
    'utf8'
  );

const panelHtml =
  fs.readFileSync(
    new URL(
      '../ui/panel.html',
      import.meta.url
    ),
    'utf8'
  );

test(
  'background exposes Parser Blueprint artifacts on demand',
  () => {
    assert.match(
      background,
      /BRT_GET_PARSER_BLUEPRINT/
    );

    assert.match(
      background,
      /generateParserBlueprint/
    );

    assert.match(
      background,
      /renderParserBlueprintMarkdown/
    );

    assert.match(
      background,
      /sendResponse\s*\(\s*\{[\s\S]*blueprint[\s\S]*markdown/
    );
  }
);

test(
  'raw session export remains backwards compatible',
  () => {
    assert.match(
      panelJs,
      /JSON\.stringify\s*\(\s*currentSession\s*,\s*null\s*,\s*2\s*\)/
    );

    assert.match(
      panelJs,
      /BRT_IMPORT_SESSION/
    );
  }
);

test(
  'side panel contains a dedicated Blueprint view',
  () => {
    assert.match(
      panelHtml,
      /data-tab=["']blueprint["']/
    );

    assert.match(
      panelHtml,
      /id=["']tab-blueprint["']/
    );

    assert.match(
      panelHtml,
      /id=["']blueprintOutput["']/
    );
  }
);

test(
  'Blueprint view has explicit generation and export controls',
  () => {
    for (const id of [
      'blueprintRefreshBtn',
      'blueprintJsonBtn',
      'blueprintMarkdownBtn'
    ]) {
      assert.match(
        panelHtml,
        new RegExp(
          `id=["']${id}["']`
        )
      );
    }
  }
);

test(
  'panel requests Blueprint only through explicit Blueprint flow',
  () => {
    assert.match(
      panelJs,
      /BRT_GET_PARSER_BLUEPRINT/
    );

    assert.match(
      panelJs,
      /blueprintRefreshBtn/
    );

    assert.doesNotMatch(
      panelJs,
      /async function refresh\(\)[\s\S]{0,2500}BRT_GET_PARSER_BLUEPRINT/
    );
  }
);

test(
  'Blueprint exports use dedicated JSON and Markdown filenames',
  () => {
    assert.match(
      panelJs,
      /brt-parser-blueprint-[^"'`]*\.json/
    );

    assert.match(
      panelJs,
      /brt-parser-blueprint-[^"'`]*\.md/
    );
  }
);

test(
  'Blueprint exports refresh stale same-session derivations',
  () => {
    assert.match(
      panelJs,
      /function blueprintMatchesCurrentSession/
    );

    assert.match(
      panelJs,
      /currentBlueprint\?\.source\?\.sessionSequence/
    );

    assert.match(
      panelJs,
      /currentSession\?\.sequence/
    );

    assert.match(
      panelJs,
      /if\s*\(\s*!blueprintMatchesCurrentSession\(\)\s*\)/
    );
  }
);
